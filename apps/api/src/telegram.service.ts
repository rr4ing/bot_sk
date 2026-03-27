import { Injectable, Logger } from "@nestjs/common";
import { LEAD_HOT_THRESHOLD } from "@builderbot/config";
import { Prisma, Unit } from "@prisma/client";
import { TelegramUpdate } from "./types";
import { ConversationService } from "./conversation.service";
import { CatalogService } from "./catalog.service";
import { KnowledgeService } from "./knowledge.service";
import { AiService } from "./ai.service";
import { ResponsePolicyService } from "./response-policy.service";
import { TelegramClient } from "./telegram.client";
import { LeadService } from "./lead.service";
import { SupportService } from "./support.service";
import { JobQueueService } from "./job-queue.service";

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly processedUpdates = new Map<number, number>();
  private readonly processedUpdateTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly conversations: ConversationService,
    private readonly catalog: CatalogService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiService,
    private readonly policy: ResponsePolicyService,
    private readonly telegramClient: TelegramClient,
    private readonly leads: LeadService,
    private readonly support: SupportService,
    private readonly jobs: JobQueueService
  ) {}

  async handleIncomingUpdate(update: TelegramUpdate) {
    if (!update.message?.text && !update.message?.contact) {
      return { status: "ignored", reason: "unsupported_update" };
    }

    if (this.isDuplicateUpdate(update.update_id)) {
      this.logger.warn(`Skipping duplicate telegram update ${update.update_id}`);
      return { status: "ignored", reason: "duplicate_update" };
    }

    const conversation = await this.conversations.ensureConversation(update);
    const messageText =
      update.message?.text ??
      `Контакт: ${update.message?.contact?.phone_number ?? "не указан"}`;
    const normalizedMessageText = this.normalizeInboundText(messageText);
    const customerName = [
      update.message?.from?.first_name ?? update.message?.contact?.first_name,
      update.message?.from?.last_name ?? update.message?.contact?.last_name
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const phone = update.message?.contact?.phone_number ?? null;
    const storedState = this.conversations.readConversationState(conversation.metadata);

    await this.conversations.appendMessage(conversation.id, "user", messageText, update);

    const history = await this.conversations.getHistory(conversation.id);
    const conversationText = this.buildDecisionText(history);
    const activeProject =
      (await this.catalog.getProjectById(storedState?.activeProjectId)) ??
      (await this.catalog.getRelevantProject(conversationText));
    const [candidateUnits, projectEntryUnit, knowledgeDocuments] = await Promise.all([
      this.catalog.findCandidateUnits(conversationText),
      this.catalog.findProjectEntryUnit(activeProject?.id),
      this.knowledge.getRelevantDocuments(conversationText)
    ]);
    const decisionUnits = this.mergeUnits(candidateUnits, projectEntryUnit);
    const conversationState = this.ai.deriveConversationState(normalizedMessageText, {
      activeProject,
      candidateUnits: decisionUnits,
      projectEntryUnit,
      knowledgeDocuments,
      history,
      conversationText,
      conversationState: storedState
    });
    const decision = await this.ai.decide(normalizedMessageText, {
      activeProject,
      candidateUnits: decisionUnits,
      projectEntryUnit,
      knowledgeDocuments,
      history,
      conversationText,
      conversationState
    });
    const safeDecision = this.policy.enforce(decision, decisionUnits);

    await this.conversations.appendMessage(
      conversation.id,
      "assistant",
      safeDecision.reply_text,
      safeDecision
    );

    await this.conversations.updateConversationSummary(
      conversation.id,
      messageText.slice(0, 240),
      safeDecision.intent,
      safeDecision.lead_score,
      this.mergeConversationMetadata(conversation.metadata, {
        conversation_state: conversationState,
        missing_fields: safeDecision.missing_fields,
        policy_flags: safeDecision.policy_flags
      })
    );

    const [lead, supportTicket] = await Promise.all([
      this.leads.syncLeadFromDecision({
        conversationId: conversation.id,
        customerName: customerName || null,
        phone,
        messageText,
        decision: safeDecision
      }),
      this.support.syncTicketFromDecision({
        conversationId: conversation.id,
        customerName: customerName || null,
        phone,
        messageText,
        decision: safeDecision
      })
    ]);

    if (
      lead &&
      (safeDecision.handoff_required || safeDecision.lead_score >= LEAD_HOT_THRESHOLD)
    ) {
      await this.jobs.enqueueManagerNotification({
        type: "lead",
        leadId: lead.id,
        conversationId: conversation.id,
        customerName: customerName || "Неизвестный клиент",
        phone,
        leadScore: safeDecision.lead_score,
        replyPreview: safeDecision.reply_text
      });
    }

    if (supportTicket) {
      await this.jobs.enqueueManagerNotification({
        type: "support_ticket",
        supportTicketId: supportTicket.id,
        conversationId: conversation.id,
        customerName: customerName || "Неизвестный клиент",
        phone,
        topic: supportTicket.topic
      });
    }

    await this.telegramClient.sendMessage({
      chatId: String(update.message?.chat.id),
      text: safeDecision.reply_text
    });

    return {
      status: "processed",
      decision: safeDecision
    };
  }

  private isDuplicateUpdate(updateId: number) {
    const now = Date.now();

    for (const [knownUpdateId, timestamp] of this.processedUpdates.entries()) {
      if (now - timestamp > this.processedUpdateTtlMs) {
        this.processedUpdates.delete(knownUpdateId);
      }
    }

    if (this.processedUpdates.has(updateId)) {
      return true;
    }

    this.processedUpdates.set(updateId, now);
    return false;
  }

  private buildDecisionText(history: Array<{ role: "user" | "assistant"; content: string }>) {
    return history
      .filter((entry) => entry.role === "user")
      .slice(-8)
      .map((entry) => this.normalizeInboundText(entry.content))
      .join("\n");
  }

  private mergeUnits(candidateUnits: Unit[], projectEntryUnit?: Unit | null) {
    if (!projectEntryUnit) {
      return candidateUnits;
    }

    return Array.from(
      new Map([...candidateUnits, projectEntryUnit].map((unit) => [unit.id, unit])).values()
    );
  }

  private normalizeInboundText(messageText: string) {
    const compact = messageText.trim();
    const normalized = compact.toLowerCase();

    const exactMatches: Record<string, string> = {
      "для себя": "Покупаю для себя",
      "для семьи": "Покупаю для семьи",
      "для инвестиций": "Покупаю для инвестиций",
      "для родителей": "Покупаю для родителей",
      "до 20 млн": "Бюджет до 20 млн",
      "20-40 млн": "Бюджет 20-40 млн",
      "40-80 млн": "Бюджет 40-80 млн",
      "80+ млн": "Бюджет 80+ млн",
      "студия": "Нужна студия",
      "1-комнатная": "Нужна 1-комнатная квартира",
      "2-комнатная": "Нужна 2-комнатная квартира",
      "3-комнатная+": "Нужна 3-комнатная квартира или больше",
      "срочно, до месяца": "Нужно срочно, до месяца",
      "1-3 месяца": "Покупка в ближайшие 1-3 месяца",
      "3-6 месяцев": "Покупка в горизонте 3-6 месяцев",
      "пока присматриваюсь": "Пока присматриваюсь, без спешки",
      "подобрать 3 варианта": "Подберите 3 самых подходящих варианта по моему сценарию покупки",
      "сравнить варианты": "Сравните варианты и объясните разницу по выгоде, ликвидности и сценарию покупки",
      "самый выгодный вход": "Покажите минимальную цену входа и самый выгодный формат покупки",
      "хочу скидку": "Хочу скидку или актуальные специальные условия",
      "связаться с менеджером": "Свяжите меня с менеджером"
    };

    return exactMatches[normalized] ?? compact;
  }

  private mergeConversationMetadata(
    metadata: Prisma.JsonValue | null | undefined,
    patch: Record<string, unknown>
  ) {
    const base =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};

    return {
      ...base,
      ...patch
    };
  }

}

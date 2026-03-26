import { Injectable, Logger } from "@nestjs/common";
import { LEAD_HOT_THRESHOLD } from "@builderbot/config";
import { Unit } from "@prisma/client";
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

    await this.conversations.appendMessage(conversation.id, "user", messageText, update);

    const history = await this.conversations.getHistory(conversation.id);
    const conversationText = this.buildDecisionText(history);
    const activeProject = await this.catalog.getRelevantProject(conversationText);
    const [candidateUnits, projectEntryUnit, knowledgeDocuments] = await Promise.all([
      this.catalog.findCandidateUnits(conversationText),
      this.catalog.findProjectEntryUnit(activeProject?.id),
      this.knowledge.getRelevantDocuments(conversationText)
    ]);
    const decisionUnits = this.mergeUnits(candidateUnits, projectEntryUnit);

    const decision = await this.ai.decide(normalizedMessageText, {
      activeProject,
      candidateUnits: decisionUnits,
      projectEntryUnit,
      knowledgeDocuments,
      history,
      conversationText
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
      {
        missing_fields: safeDecision.missing_fields,
        policy_flags: safeDecision.policy_flags
      }
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
      text: safeDecision.reply_text,
      replyMarkup: this.buildReplyKeyboard(safeDecision.missing_fields, safeDecision.intent)
    });

    return {
      status: "processed",
      decision: safeDecision
    };
  }

  private buildReplyKeyboard(missingFields: string[], intent: string) {
    const orderedFields = ["phone", "purpose", "budget", "rooms", "timeline"] as const;
    const nextField = orderedFields.find((field) => missingFields.includes(field));

    if (nextField === "phone") {
      return {
        keyboard: [
          [{ text: "Отправить контакт", request_contact: true }],
          [{ text: "Напишу номер сообщением" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "purpose") {
      return {
        keyboard: [
          [{ text: "Для себя" }, { text: "Для семьи" }],
          [{ text: "Для инвестиций" }, { text: "Для родителей" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "budget") {
      return {
        keyboard: [
          [{ text: "до 20 млн" }, { text: "20-40 млн" }],
          [{ text: "40-80 млн" }, { text: "80+ млн" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "rooms") {
      return {
        keyboard: [
          [{ text: "Студия" }, { text: "1-комнатная" }],
          [{ text: "2-комнатная" }, { text: "3-комнатная+" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "timeline") {
      return {
        keyboard: [
          [{ text: "Срочно, до месяца" }, { text: "1-3 месяца" }],
          [{ text: "3-6 месяцев" }, { text: "Пока присматриваюсь" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (
      !nextField &&
      ["sales_qualification", "clarify_needs", "unit_recommendation"].includes(intent)
    ) {
      return {
        keyboard: [
          [{ text: "Подобрать 3 варианта" }, { text: "Сравнить варианты" }],
          [{ text: "Самый выгодный вход" }, { text: "Хочу скидку" }],
          [{ text: "Связаться с менеджером" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };
    }

    return {
      remove_keyboard: false
    };
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
}

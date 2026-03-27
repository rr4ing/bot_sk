import { Injectable, Logger } from "@nestjs/common";
import { LEAD_HOT_THRESHOLD } from "@builderbot/config";
import { aiDecisionSchema, type AIDecision } from "@builderbot/domain";
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
    const effectiveStoredState = this.shouldResetConversationState(normalizedMessageText)
      ? this.resetConversationState(storedState)
      : storedState;
    const activeProject =
      (await this.catalog.getProjectById(effectiveStoredState?.activeProjectId)) ??
      (await this.catalog.getRelevantProject(conversationText));
    const conversationState = this.ai.deriveConversationState(normalizedMessageText, {
      activeProject,
      candidateUnits: [],
      projectEntryUnit: null,
      knowledgeDocuments: [],
      history,
      conversationText,
      conversationState: effectiveStoredState
    });
    const [candidateUnits, projectEntryUnit, knowledgeDocuments, referencedUnit] =
      await Promise.all([
        this.catalog.findCandidateUnitsForState(conversationState, activeProject?.id),
        this.catalog.findProjectEntryUnit(activeProject?.id),
        this.knowledge.getRelevantDocuments(conversationText),
        this.catalog.findReferencedUnit(normalizedMessageText, activeProject?.id, {
          unitId: effectiveStoredState?.lastRecommendedUnitId ?? null,
          unitCode: effectiveStoredState?.lastRecommendedUnitCode ?? null
        })
      ]);
    const decisionUnits = this.mergeUnits(candidateUnits, projectEntryUnit, referencedUnit);
    const decision =
      referencedUnit && this.isReferencedUnitRequest(normalizedMessageText)
        ? this.buildReferencedUnitDecision(referencedUnit, activeProject?.name ?? null)
        : this.isDirectShortlistRequest(normalizedMessageText, conversationState, candidateUnits)
          ? this.buildShortlistDecision(candidateUnits, activeProject?.name ?? null, conversationState)
        : await this.ai.decide(normalizedMessageText, {
            activeProject,
            candidateUnits: decisionUnits,
            projectEntryUnit,
            knowledgeDocuments,
            history,
            conversationText,
            conversationState
          });
    const safeDecision = this.policy.enforce(decision, decisionUnits);
    const primaryRecommendedUnit =
      referencedUnit ??
      decisionUnits.find((unit) => safeDecision.recommended_unit_ids.includes(unit.id)) ??
      (safeDecision.recommended_unit_ids[0]
        ? await this.catalog.getUnitById(safeDecision.recommended_unit_ids[0])
        : null);

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
        conversation_state: {
          ...conversationState,
          lastRecommendedUnitId: primaryRecommendedUnit?.id ?? null,
          lastRecommendedUnitCode: primaryRecommendedUnit?.code ?? null
        },
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

    await this.sendDecisionReply(
      String(update.message?.chat.id),
      safeDecision,
      referencedUnit && this.isReferencedUnitRequest(normalizedMessageText) ? referencedUnit : null
    );

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

  private mergeUnits(
    candidateUnits: Unit[],
    projectEntryUnit?: Unit | null,
    referencedUnit?: Unit | null
  ) {
    const merged = [...candidateUnits];

    if (projectEntryUnit) {
      merged.push(projectEntryUnit);
    }

    if (referencedUnit) {
      merged.push(referencedUnit);
    }

    return Array.from(new Map(merged.map((unit) => [unit.id, unit])).values());
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

  private shouldResetConversationState(messageText: string) {
    const normalized = messageText.toLowerCase().trim();

    return (
      [
        "по другому запросу",
        "по другому сценарию",
        "другой запрос",
        "сменим запрос",
        "с нуля",
        "заново"
      ].some((token) => normalized.includes(token)) || this.isPureGreeting(normalized)
    );
  }

  private isPureGreeting(messageText: string) {
    return /^(привет|здравствуйте|добрый день|добрый вечер|приветствую|\/start|start)[!. ]*$/i.test(
      messageText
    );
  }

  private resetConversationState(
    state: ReturnType<ConversationService["readConversationState"]>
  ) {
    return {
      purpose: null,
      budgetRub: null,
      rooms: null,
      timeline: null,
      hasPhone: state?.hasPhone ?? false,
      activeProjectId: state?.activeProjectId ?? null,
      activeProjectName: state?.activeProjectName ?? null,
      lastRecommendedUnitId: null,
      lastRecommendedUnitCode: null,
      lastUserMessage: null,
      updatedAt: new Date().toISOString()
    };
  }

  private isReferencedUnitRequest(messageText: string) {
    const normalized = messageText.toLowerCase();

    return [
      "планиров",
      "план ",
      "схем",
      "фото",
      "фотку",
      "изображ",
      "подроб",
      "подробнее",
      "инфо",
      "информац",
      "по лоту",
      "по квартире",
      "скинь",
      "пришли",
      "расскажи по"
    ].some((token) => normalized.includes(token));
  }

  private buildReferencedUnitDecision(unit: Unit, projectName: string | null): AIDecision {
    const roomsLabel = unit.rooms === 0 ? "студия" : `${unit.rooms}-комнатная квартира`;
    const perks = unit.perks.slice(0, 3).join(", ");
    const projectLabel = projectName ? `в ${projectName}` : "в проекте";
    const planNote = unit.planImageUrls.length
      ? "Ниже отправляю карточку лота и планировку по этому варианту."
      : unit.listingUrl
        ? `Планировка в чат пока не загружена, но есть карточка лота: ${unit.listingUrl}`
        : "Планировка в каталог пока не загружена, поэтому сейчас отправляю подробную карточку по лоту.";

    return aiDecisionSchema.parse({
      intent: "unit_recommendation",
      reply_text: `По лоту ${unit.code} ${projectLabel}: ${roomsLabel}, ${unit.areaSqm} м², ${unit.floor}-й этаж, ${this.formatRub(unit.priceRub)}, отделка — ${unit.finishing}. ${
        perks ? `Из сильных сторон: ${perks}. ` : ""
      }${planNote}`,
      recommended_unit_ids: [unit.id],
      lead_score: 78,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: [],
      policy_flags: ["price_unverified"]
    });
  }

  private isDirectShortlistRequest(
    messageText: string,
    state: { budgetRub: number | null; rooms: number | null },
    candidateUnits: Unit[]
  ) {
    const normalized = messageText.toLowerCase();

    if (!candidateUnits.length || state.rooms === null) {
      return false;
    }

    return [
      "скинь",
      "пришли",
      "покажи",
      "посмотрим",
      "какой-нибудь лот",
      "какой нибудь лот",
      "вариант",
      "варианты",
      "подбери лот",
      "интересный лот"
    ].some((token) => normalized.includes(token));
  }

  private buildShortlistDecision(
    candidateUnits: Unit[],
    projectName: string | null,
    state: { purpose?: string | null; budgetRub: number | null; rooms: number | null }
  ): AIDecision {
    const topUnits = candidateUnits.slice(0, 3);
    const first = topUnits[0];
    const projectLabel = projectName ? `в ${projectName}` : "в проекте";
    const roomsLabel =
      state.rooms === 0 ? "студию" : state.rooms ? `${state.rooms}-комнатный формат` : "подходящий формат";
    const budgetLabel = state.budgetRub ? `с ориентиром около ${this.formatRub(state.budgetRub)}` : null;
    const intentBits = [roomsLabel, budgetLabel].filter(Boolean).join(", ");

    return aiDecisionSchema.parse({
      intent: "unit_recommendation",
      reply_text: `Понял, тогда сразу покажу несколько живых вариантов ${projectLabel}${intentBits ? `: ${intentBits}` : ""}. Начну с лота ${first.code} — ${first.rooms === 0 ? "студия" : `${first.rooms}-комнатная`}, ${first.areaSqm} м², ${first.floor}-й этаж, ${this.formatRub(first.priceRub)}. Если хотите, следующим сообщением могу подробно раскрыть любой код из списка и прислать планировку, если она загружена в каталог.`,
      recommended_unit_ids: topUnits.map((unit) => unit.id),
      lead_score: 74,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: [],
      policy_flags: ["price_unverified"]
    });
  }

  private async sendDecisionReply(chatId: string, decision: AIDecision, referencedUnit?: Unit | null) {
    await this.telegramClient.sendMessage({
      chatId,
      text: decision.reply_text
    });

    if (!referencedUnit?.planImageUrls?.length) {
      return;
    }

    for (const [index, imageUrl] of referencedUnit.planImageUrls.entries()) {
      await this.telegramClient.sendPhoto({
        chatId,
        photoUrl: imageUrl,
        caption:
          index === 0
            ? `Карточка лота ${referencedUnit.code}`
            : index === 1
              ? `Планировка ${referencedUnit.code}`
              : undefined
      });
    }
  }

  private formatRub(value: number) {
    return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
  }

}

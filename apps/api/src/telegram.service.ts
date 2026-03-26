import { Injectable, Logger } from "@nestjs/common";
import { LEAD_HOT_THRESHOLD } from "@builderbot/config";
import { Unit, Project } from "@prisma/client";
import type { AIDecision } from "@builderbot/domain";
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
    const directDecision = this.buildStructuredReplyDecision(
      normalizedMessageText,
      conversationText,
      activeProject,
      decisionUnits,
      projectEntryUnit,
      phone
    );
    const decision =
      directDecision ??
      (await this.ai.decide(normalizedMessageText, {
        activeProject,
        candidateUnits: decisionUnits,
        projectEntryUnit,
        knowledgeDocuments,
        history,
        conversationText
      }));
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

  private buildStructuredReplyDecision(
    messageText: string,
    conversationText: string,
    activeProject: Project | null,
    candidateUnits: Unit[],
    projectEntryUnit: Unit | null,
    phone: string | null
  ): AIDecision | null {
    const normalized = messageText.toLowerCase().trim();
    const profile = this.extractConversationProfile(conversationText, phone);
    const missingFields = this.buildMissingFields(profile);
    const projectName = activeProject?.name ?? "проект";

    if (this.isGreetingSignal(normalized)) {
      return {
        intent: "sales_qualification",
        reply_text: `Здравствуйте! Помогу с подбором квартиры${activeProject ? ` в ${projectName}` : ""}. Для начала подскажите, для чего покупаете: для себя, семьи или под инвестицию?`,
        recommended_unit_ids: [],
        lead_score: 28,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields.length ? missingFields : ["purpose", "budget", "rooms", "timeline"],
        policy_flags: []
      };
    }

    if (this.isPurposeSignal(normalized) || this.isBudgetSignal(normalized) || this.isRoomsSignal(normalized) || this.isTimelineSignal(normalized)) {
      const intent = missingFields.length <= 2 ? "clarify_needs" : "sales_qualification";

      if (this.isBudgetSignal(normalized) && activeProject && projectEntryUnit && profile.budgetRub && profile.budgetRub < projectEntryUnit.priceRub) {
        return {
          intent: "clarify_needs",
          reply_text: `Бюджет понял. Скажу честно: если говорим про ${projectName}, текущий публичный вход начинается примерно от ${this.formatRub(projectEntryUnit.priceRub)}, поэтому при бюджете около ${this.formatRub(profile.budgetRub)} прямого попадания в актуальную экспозицию может не быть. Могу показать самый близкий входной формат или предложить другой сценарий под ваш запрос.`,
          recommended_unit_ids: [],
          lead_score: this.calculateLeadScore(profile, candidateUnits.length),
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: missingFields,
          policy_flags: ["price_unverified"]
        };
      }

      const prefix = this.isPurposeSignal(normalized)
        ? `Понял, рассматриваете покупку ${this.describePurpose(profile.purpose)}.`
        : this.isBudgetSignal(normalized)
          ? "Отлично, бюджет понял."
          : this.isRoomsSignal(normalized)
            ? "Формат понял."
            : "По сроку понял.";

      return {
        intent,
        reply_text: `${prefix} ${this.buildGuidedQuestion(missingFields, activeProject)}`,
        recommended_unit_ids: [],
        lead_score: this.calculateLeadScore(profile, candidateUnits.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      };
    }

    if (normalized === "покажите минимальную цену входа и самый выгодный формат покупки" && projectEntryUnit) {
      return {
        intent: "unit_recommendation",
        reply_text: `Если смотреть на самый доступный вход${activeProject ? ` в ${projectName}` : ""}, ориентир сейчас начинается примерно от ${this.formatRub(projectEntryUnit.priceRub)} за ${projectEntryUnit.areaSqm} м². Это нижняя планка проекта по текущей публичной экспозиции. Если хотите, следующим сообщением покажу ещё 1-2 близких по смыслу варианта и объясню, где есть логика доплаты.`,
        recommended_unit_ids: [projectEntryUnit.id],
        lead_score: Math.max(this.calculateLeadScore(profile, candidateUnits.length), 60),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: ["price_unverified"]
      };
    }

    if (normalized === "подберите 3 самых подходящих варианта по моему сценарию покупки") {
      if (candidateUnits.length > 0) {
        return {
          intent: "unit_recommendation",
          reply_text: `Подобрал 2-3 самых релевантных варианта${activeProject ? ` по ${projectName}` : ""}. Ниже покажу shortlist из текущего каталога, а дальше могу сузить его до 1-2 лотов под ваш сценарий покупки.`,
          recommended_unit_ids: candidateUnits.slice(0, 3).map((unit) => unit.id),
          lead_score: Math.max(this.calculateLeadScore(profile, candidateUnits.length), 66),
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: missingFields,
          policy_flags: []
        };
      }

      return {
        intent: "clarify_needs",
        reply_text: this.buildGuidedQuestion(missingFields, activeProject),
        recommended_unit_ids: [],
        lead_score: this.calculateLeadScore(profile, candidateUnits.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      };
    }

    if (normalized === "сравните варианты и объясните разницу по выгоде, ликвидности и сценарию покупки") {
      if (candidateUnits.length >= 2) {
        return {
          intent: "unit_recommendation",
          reply_text: `Сравню варианты не в лоб по цене, а по смыслу: где сильнее входной билет, где лучше сценарий для жизни, а где понятнее логика для инвестиции. Ниже оставлю лучшие варианты из текущего каталога.`,
          recommended_unit_ids: candidateUnits.slice(0, 3).map((unit) => unit.id),
          lead_score: Math.max(this.calculateLeadScore(profile, candidateUnits.length), 68),
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: missingFields,
          policy_flags: []
        };
      }

      return {
        intent: "clarify_needs",
        reply_text: `Чтобы сравнение было полезным, сначала зафиксируем основу. ${this.buildGuidedQuestion(missingFields, activeProject)}`,
        recommended_unit_ids: [],
        lead_score: this.calculateLeadScore(profile, candidateUnits.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      };
    }

    if (normalized === "хочу скидку или актуальные специальные условия") {
      return {
        intent: phone ? "handoff_manager" : "sales_qualification",
        reply_text: phone
          ? "Понял запрос на более сильные условия. Передаю менеджеру ваш кейс, чтобы он проверил актуальные акции и что реально можно сделать по условиям."
          : "Понял запрос на более сильные условия. Персональную скидку заранее не обещаю, но могу передать кейс менеджеру, чтобы он проверил актуальные акции и условия. Если удобно, отправьте контакт.",
        recommended_unit_ids: [],
        lead_score: Math.max(this.calculateLeadScore(profile, candidateUnits.length), 70),
        handoff_required: Boolean(phone),
        support_ticket_required: false,
        missing_fields: phone ? [] : ["phone"],
        policy_flags: phone ? ["discount_out_of_policy", "human_handoff_required"] : ["discount_out_of_policy"]
      };
    }

    if (normalized === "свяжите меня с менеджером") {
      return {
        intent: phone ? "handoff_manager" : "clarify_needs",
        reply_text: phone
          ? "Отлично, передаю вас менеджеру. Он получит ваш контекст по проекту и сможет продолжить разговор предметно."
          : "Подключу менеджера. Отправьте, пожалуйста, удобный номер телефона или контакт, и я передам запрос без потери деталей.",
        recommended_unit_ids: [],
        lead_score: Math.max(this.calculateLeadScore(profile, candidateUnits.length), 78),
        handoff_required: Boolean(phone),
        support_ticket_required: false,
        missing_fields: phone ? [] : ["phone"],
        policy_flags: phone ? ["human_handoff_required"] : []
      };
    }

    return null;
  }

  private extractConversationProfile(conversationText: string, phone: string | null) {
    const normalized = conversationText.toLowerCase();

    return {
      purpose: this.extractPurpose(normalized),
      budgetRub: this.catalog.extractBudget(conversationText),
      rooms: this.catalog.extractRooms(conversationText),
      timeline: this.extractTimeline(normalized),
      hasPhone: Boolean(phone || /контакт:\s*\+?\d|\+7\d{10}|\b8\d{10}\b/.test(normalized))
    };
  }

  private buildMissingFields(profile: {
    purpose: "self" | "family" | "investment" | "parents" | null;
    budgetRub: number | null;
    rooms: number | null;
    timeline: "urgent" | "soon" | "later" | null;
    hasPhone: boolean;
  }) {
    const missingFields: Array<"purpose" | "budget" | "rooms" | "timeline"> = [];

    if (!profile.purpose) {
      missingFields.push("purpose");
    }

    if (!profile.budgetRub) {
      missingFields.push("budget");
    }

    if (profile.rooms === null) {
      missingFields.push("rooms");
    }

    if (!profile.timeline) {
      missingFields.push("timeline");
    }

    return missingFields;
  }

  private buildGuidedQuestion(
    missingFields: string[],
    activeProject: Project | null
  ) {
    const first = missingFields[0];
    const second = missingFields[1];
    const projectPrefix = activeProject ? `Если говорим про ${activeProject.name}, ` : "";

    if (!first) {
      return "Если хотите, уже могу перейти к shortlist и показать 2-3 релевантных варианта.";
    }

    if (first === "purpose") {
      if (second === "budget") {
        return `${projectPrefix}подскажите, для какого сценария покупаете и какой бюджет комфортен?`;
      }

      return `${projectPrefix}подскажите, для какого сценария покупаете: для себя, семьи, инвестиций или родителей?`;
    }

    if (first === "budget") {
      if (second === "rooms") {
        return `${projectPrefix}подскажите комфортный бюджет и какой формат нужен: студия, 1, 2 или 3 комнаты+?`;
      }

      if (second === "timeline") {
        return `${projectPrefix}подскажите комфортный бюджет и в какие сроки планируете решение?`;
      }

      return `${projectPrefix}подскажите комфортный бюджет покупки.`;
    }

    if (first === "rooms") {
      if (second === "timeline") {
        return `${projectPrefix}сколько комнат рассматриваете и в какие сроки планируете решение: срочно, 1-3 месяца или пока присматриваетесь?`;
      }

      return `${projectPrefix}какой формат нужен: студия, 1, 2 или 3 комнаты+?`;
    }

    if (first === "timeline") {
      return `${projectPrefix}по срокам как удобнее: срочно, 1-3 месяца или пока спокойно выбираете?`;
    }

    return `${projectPrefix}уточню ещё один важный момент, чтобы подбор был точным.`;
  }

  private calculateLeadScore(
    profile: {
      purpose: "self" | "family" | "investment" | "parents" | null;
      budgetRub: number | null;
      rooms: number | null;
      timeline: "urgent" | "soon" | "later" | null;
      hasPhone: boolean;
    },
    candidateUnitsCount: number
  ) {
    let score = 32;

    if (profile.purpose) {
      score += 10;
    }

    if (profile.budgetRub) {
      score += 18;
    }

    if (profile.rooms !== null) {
      score += 12;
    }

    if (profile.timeline) {
      score += profile.timeline === "urgent" ? 18 : 10;
    }

    if (candidateUnitsCount > 0) {
      score += 8;
    }

    if (profile.hasPhone) {
      score += 12;
    }

    return Math.min(score, 95);
  }

  private extractPurpose(normalizedText: string) {
    if (this.containsAny(normalizedText, ["инвест", "сдач", "ликвидн"])) {
      return "investment" as const;
    }

    if (this.containsAny(normalizedText, ["семь", "ребен", "дет", "для жизни"])) {
      return "family" as const;
    }

    if (this.containsAny(normalizedText, ["родител", "маме", "папе"])) {
      return "parents" as const;
    }

    if (this.containsAny(normalizedText, ["для себя", "себе", "переезд", "жить"])) {
      return "self" as const;
    }

    return null;
  }

  private extractTimeline(normalizedText: string) {
    if (this.containsAny(normalizedText, ["срочно", "сегодня", "на этой неделе", "до месяца"])) {
      return "urgent" as const;
    }

    if (this.containsAny(normalizedText, ["1-3 месяца", "три месяца", "в ближайшие месяцы", "скоро"])) {
      return "soon" as const;
    }

    if (this.containsAny(normalizedText, ["присматриваюсь", "позже", "пока смотрю", "не спешу", "без спешки"])) {
      return "later" as const;
    }

    return null;
  }

  private containsAny(normalizedText: string, tokens: string[]) {
    return tokens.some((token) => normalizedText.includes(token));
  }

  private describePurpose(purpose: "self" | "family" | "investment" | "parents" | null) {
    switch (purpose) {
      case "investment":
        return "под инвестицию";
      case "family":
        return "для семьи";
      case "parents":
        return "для родителей";
      case "self":
        return "для себя";
      default:
        return "под ваш сценарий";
    }
  }

  private formatRub(value: number) {
    return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
  }

  private isGreetingSignal(normalizedText: string) {
    return [
      "привет",
      "здравствуйте",
      "добрый день",
      "добрый вечер",
      "доброе утро",
      "приветствую",
      "hello",
      "hi"
    ].includes(normalizedText);
  }

  private isPurposeSignal(normalizedText: string) {
    return normalizedText.startsWith("покупаю для ");
  }

  private isBudgetSignal(normalizedText: string) {
    return normalizedText.startsWith("бюджет ");
  }

  private isRoomsSignal(normalizedText: string) {
    return normalizedText.startsWith("нужна ") || /(^| )\d[\s-]?(к|комн|комнат)/.test(normalizedText);
  }

  private isTimelineSignal(normalizedText: string) {
    return normalizedText.startsWith("покупка в ") || normalizedText.startsWith("нужно срочно") || normalizedText.startsWith("пока присматриваюсь");
  }
}

import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import type { AIDecision } from "@builderbot/domain";
import { aiDecisionSchema } from "@builderbot/domain";
import { EnvService } from "./env";
import { DecisionContext } from "./types";
import { CatalogService } from "./catalog.service";

type PurchasePurpose = "self" | "family" | "investment" | "parents" | null;
type PurchaseTimeline = "urgent" | "soon" | "later" | null;

interface SalesSignals {
  budgetRub: number | null;
  rooms: number | null;
  purpose: PurchasePurpose;
  timeline: PurchaseTimeline;
  wantsManager: boolean;
  wantsProjectOverview: boolean;
  wantsPriceAnswer: boolean;
  wantsSelection: boolean;
  wantsCallback: boolean;
  hasPhone: boolean;
  hasNegative: boolean;
  hasSupportIntent: boolean;
  hasMortgageIntent: boolean;
  hasPriceObjection: boolean;
  hasDiscountObjection: boolean;
  hasHesitation: boolean;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;

  constructor(
    private readonly env: EnvService,
    private readonly catalog: CatalogService
  ) {
    this.client = this.env.languageModelApiKey
      ? new OpenAI({
          apiKey: this.env.languageModelApiKey,
          ...(this.env.languageModelBaseUrl
            ? { baseURL: this.env.languageModelBaseUrl }
            : {})
        })
      : null;
  }

  async decide(messageText: string, context: DecisionContext): Promise<AIDecision> {
    if (!this.client) {
      return this.fallbackDecision(messageText, context);
    }

    const signals = this.collectSignals(messageText, context);
    const systemPrompt = [
      "Ты сильный AI-консультант отдела продаж и поддержки застройщика.",
      "Работай только на русском языке и отвечай спокойно, уверенно, по-человечески, без давления и без канцелярита.",
      "Твоя задача: понять сценарий клиента, перевести характеристики в выгоды, снизить тревогу и довести разговор до понятного следующего шага.",
      "Сначала отвечай по сути запроса, потом мягко квалифицируй клиента. Не задавай больше двух вопросов в одном сообщении.",
      "Если проект премиальный, продавай ценность через локацию, архитектуру, виды, приватность, редкость продукта и качество среды, но без пафоса и без обещаний доходности.",
      "Если клиент говорит, что дорого, не спорь: признай ощущение, предложи сравнение, shortlist или альтернативный сценарий внутри бюджета.",
      "Если клиент просит скидку, не обещай ее, а предлагай проверить актуальные условия у менеджера.",
      "Если есть релевантные квартиры в каталоге, рекомендуй максимум 3 и опирайся только на них.",
      "Не выдумывай цены, наличие, сроки, юридические гарантии, акции и ипотечные условия вне контекста.",
      "Если точная цена или наличие не подтверждены, говори об ориентире и предлагай проверку менеджером.",
      "Если не хватает данных, выбирай intent=sales_qualification или clarify_needs и собирай недостающие поля.",
      "Верни только JSON по контракту AIDecision."
    ].join("\n");

    const input = {
      messageText,
      history: context.history,
      signals,
      project: context.activeProject
        ? {
            name: context.activeProject.name,
            city: context.activeProject.city,
            district: context.activeProject.district,
            description: context.activeProject.description,
            salesHeadline: context.activeProject.salesHeadline
          }
        : null,
      units: context.candidateUnits.map((unit) => ({
        id: unit.id,
        projectName: context.activeProject?.name ?? null,
        code: unit.code,
        rooms: unit.rooms,
        floor: unit.floor,
        areaSqm: unit.areaSqm,
        priceRub: unit.priceRub,
        finishing: unit.finishing,
        status: unit.status,
        perks: unit.perks,
        notes: unit.notes
      })),
      knowledge: context.knowledgeDocuments.map((doc) => ({
        title: doc.title,
        kind: doc.kind,
        excerpt: doc.excerpt,
        body_preview: this.truncate(doc.body, 1400),
        tags: doc.tags
      })),
      hints: {
        detectedBudgetRub: signals.budgetRub,
        detectedRooms: signals.rooms,
        purchasePurpose: signals.purpose,
        purchaseTimeline: signals.timeline
      }
    };

    try {
      const response = await this.client.responses.create({
        model: this.env.languageModelName,
        ...(this.env.languageModelProvider === "xai" ? { store: false } : {}),
        input: [
          {
            role: "system",
            content: systemPrompt
          } as never,
          {
            role: "user",
            content: JSON.stringify(input)
          } as never
        ]
      });

      const rawText = (response as { output_text?: string }).output_text ?? "";
      const json = this.extractJson(rawText);
      return aiDecisionSchema.parse(JSON.parse(json));
    } catch (error) {
      this.logger.error("OpenAI Responses API failed, switching to fallback mode", error as Error);
      return this.fallbackDecision(messageText, context);
    }
  }

  private fallbackDecision(messageText: string, context: DecisionContext): AIDecision {
    const signals = this.collectSignals(messageText, context);
    const recommended = context.candidateUnits.slice(0, 3);
    const projectName = context.activeProject?.name ?? "проект";
    const premium = this.isPremiumProject(context);
    const premiumQualifier = premium
      ? "Если важны статус, архитектура и качественная среда, это сильный вариант."
      : "Могу быстро сузить поиск до самых подходящих вариантов.";

    if (signals.hasNegative) {
      return {
        intent: "handoff_manager",
        reply_text:
          "Понимаю, что ситуация неприятная. Подключу менеджера, чтобы разобраться без лишней переписки и помочь быстрее.",
        recommended_unit_ids: [],
        lead_score: 86,
        handoff_required: true,
        support_ticket_required: true,
        missing_fields: signals.hasPhone ? [] : ["phone"],
        policy_flags: ["negative_sentiment", "human_handoff_required"]
      };
    }

    if (signals.hasSupportIntent || signals.hasMortgageIntent) {
      return {
        intent: "support_answer",
        reply_text:
          "Помогу сориентироваться по процессу, документам и следующим шагам. Если нужен статус по вашей конкретной сделке или проверка условий, сразу подключу менеджера.",
        recommended_unit_ids: [],
        lead_score: signals.hasMortgageIntent ? 52 : 44,
        handoff_required: false,
        support_ticket_required: /статус|провер|действующ|моей сделк/i.test(
          this.buildConversationText(messageText, context)
        ),
        missing_fields: [],
        policy_flags: []
      };
    }

    if (signals.wantsManager || signals.wantsCallback) {
      if (!signals.hasPhone) {
        return {
          intent: "clarify_needs",
          reply_text:
            "Подключу менеджера. Отправьте, пожалуйста, удобный номер телефона или контакт в Telegram, и я передам запрос с вашим контекстом без потери деталей.",
          recommended_unit_ids: recommended.map((unit) => unit.id),
          lead_score: this.calculateLeadScore(signals, recommended.length),
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: ["phone"],
          policy_flags: []
        };
      }

      return {
        intent: "handoff_manager",
        reply_text:
          "Отлично, передаю ваш запрос менеджеру. Он уже получит контекст по бюджету, формату и проекту, чтобы разговор был предметным, а не с нуля.",
        recommended_unit_ids: recommended.map((unit) => unit.id),
        lead_score: Math.max(this.calculateLeadScore(signals, recommended.length), 82),
        handoff_required: true,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: ["human_handoff_required"]
      };
    }

    if (signals.hasDiscountObjection) {
      const missingFields = this.buildMissingFields(signals, {
        includePhoneForHotLead: true
      });

      return {
        intent: "sales_qualification",
        reply_text:
          "Понимаю запрос на более сильные условия. Я не обещаю персональную скидку заранее, но могу сузить подбор до самых сильных лотов и отдельно проверить у менеджера, есть ли сейчас акции или гибкость по конкретному варианту.",
        recommended_unit_ids: recommended.map((unit) => unit.id).slice(0, 2),
        lead_score: Math.max(this.calculateLeadScore(signals, recommended.length), 70),
        handoff_required: signals.hasPhone,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: signals.hasPhone ? ["discount_out_of_policy"] : []
      };
    }

    if (signals.hasPriceObjection || signals.hasHesitation) {
      return {
        intent: "sales_qualification",
        reply_text:
          "Понимаю это ощущение. Чтобы не принимать решение вслепую, могу коротко сравнить 2-3 самых подходящих варианта и показать, где вы платите за локацию, вид, метраж или статус проекта, а где можно оптимизировать бюджет без потери смысла покупки.",
        recommended_unit_ids: recommended.map((unit) => unit.id),
        lead_score: Math.max(this.calculateLeadScore(signals, recommended.length), 58),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: []
      };
    }

    if (signals.wantsProjectOverview && context.activeProject) {
      return {
        intent: "sales_qualification",
        reply_text: `${projectName} — ${context.activeProject.salesHeadline} ${premiumQualifier} Если хотите, сразу покажу, какие форматы и бюджеты сейчас ближе именно к вашему сценарию покупки.`,
        recommended_unit_ids: recommended.map((unit) => unit.id),
        lead_score: Math.max(this.calculateLeadScore(signals, recommended.length), 56),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: []
      };
    }

    if (signals.wantsPriceAnswer && context.activeProject && recommended.length > 0) {
      const entryPrice = Math.min(...recommended.map((unit) => unit.priceRub));

      return {
        intent: "sales_qualification",
        reply_text: `Если смотреть на текущую публичную экспозицию${context.activeProject ? ` в ${projectName}` : ""}, ориентир входа сейчас начинается примерно от ${this.formatRub(entryPrice)}. Точную цену и наличие лучше подтверждать на момент обращения, потому что экспозиция меняется. Если хотите, сразу покажу, какие форматы сейчас дают лучший вход по бюджету и сценарию покупки.`,
        recommended_unit_ids: recommended.map((unit) => unit.id),
        lead_score: Math.max(this.calculateLeadScore(signals, recommended.length), 54),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: ["price_unverified"]
      };
    }

    if (recommended.length > 0 && (signals.budgetRub || signals.rooms !== null || signals.wantsSelection)) {
      const fitText = this.describeFit(signals);
      const missingFields = this.buildMissingFields(signals, {
        includePhoneForHotLead:
          signals.timeline === "urgent" || signals.wantsCallback || this.calculateLeadScore(signals, recommended.length) >= 80
      });

      return {
        intent: "unit_recommendation",
        reply_text: `Подобрал несколько квартир${context.activeProject ? ` в ${projectName}` : ""}${fitText}. Сразу покажу самые релевантные варианты из текущего каталога. Если хотите, следующим сообщением сузим shortlist до 1-2 лотов под ваш сценарий и подготовим звонок или просмотр.`,
        recommended_unit_ids: recommended.map((unit) => unit.id),
        lead_score: this.calculateLeadScore(signals, recommended.length),
        handoff_required: signals.timeline === "urgent" && signals.hasPhone,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      };
    }

    if (signals.rooms !== null || signals.budgetRub || signals.purpose || signals.timeline) {
      return {
        intent: "clarify_needs",
        reply_text:
          "Контекст уже понятнее. Чтобы подобрать действительно сильные варианты, уточню один шаг: что сейчас важнее всего — уложиться в бюджет, взять лучший вид/планировку или быстрее выйти на сделку?",
        recommended_unit_ids: [],
        lead_score: this.calculateLeadScore(signals, 0),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: []
      };
    }

    return {
      intent: "sales_qualification",
      reply_text:
        "Помогу подобрать квартиру без лишнего давления. Чтобы сразу уйти в точные варианты, подскажите, для чего покупаете — для себя, семьи или инвестиции, какой бюджет комфортен и в какие сроки планируете решение?",
      recommended_unit_ids: [],
      lead_score: 36,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: ["purpose", "budget", "rooms", "timeline"],
      policy_flags: []
    };
  }

  private extractJson(rawText: string) {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model did not return JSON");
    }

    return rawText.slice(start, end + 1);
  }

  private collectSignals(messageText: string, context: DecisionContext): SalesSignals {
    const transcript = this.buildConversationText(messageText, context);
    const normalized = transcript.toLowerCase();

    return {
      budgetRub: this.catalog.extractBudget(transcript),
      rooms: this.catalog.extractRooms(transcript),
      purpose: this.extractPurpose(normalized),
      timeline: this.extractTimeline(normalized),
      wantsManager: this.containsAny(normalized, [
        "менеджер",
        "свяжите",
        "соедините",
        "передайте",
        "хочу поговорить",
        "живой человек"
      ]),
      wantsProjectOverview: this.containsAny(normalized, [
        "расскажи",
        "расскажите",
        "что за",
        "про жк",
        "про проект",
        "о проекте",
        "о жк",
        "кратко про"
      ]),
      wantsPriceAnswer: this.containsAny(normalized, [
        "сколько стоит",
        "цена",
        "стоимость",
        "от скольки",
        "минимальная цена"
      ]),
      wantsSelection: this.containsAny(normalized, [
        "подбери",
        "подберите",
        "подборка",
        "варианты",
        "покажи варианты",
        "shortlist"
      ]),
      wantsCallback: this.containsAny(normalized, [
        "перезвон",
        "позвон",
        "созвон",
        "звонок",
        "наберите",
        "просмотр",
        "встреч"
      ]),
      hasPhone: /контакт:\s*\+?\d|\+7\d{10}|\b8\d{10}\b/.test(normalized),
      hasNegative: this.containsAny(normalized, ["жалоба", "претенз", "ужас", "плохо", "суд", "бесит"]),
      hasSupportIntent: this.containsAny(normalized, [
        "документ",
        "договор",
        "поддержк",
        "акт",
        "статус сделки",
        "моя сделка"
      ]),
      hasMortgageIntent: normalized.includes("ипотек"),
      hasPriceObjection: this.containsAny(normalized, [
        "дорого",
        "дороговато",
        "высокая цена",
        "слишком дорого"
      ]),
      hasDiscountObjection: this.containsAny(normalized, ["скидк", "дисконт", "уступ"]),
      hasHesitation: this.containsAny(normalized, [
        "подумаю",
        "сомневаюсь",
        "не уверен",
        "боюсь",
        "ошиб",
        "пока отложу"
      ])
    };
  }

  private buildConversationText(messageText: string, context: DecisionContext) {
    return [
      ...context.history
        .filter((entry) => entry.role === "user")
        .map((entry) => entry.content),
      messageText
    ].join("\n");
  }

  private extractPurpose(normalizedText: string): PurchasePurpose {
    if (this.containsAny(normalizedText, ["инвест", "сдач", "ликвидн"])) {
      return "investment";
    }

    if (this.containsAny(normalizedText, ["семь", "ребен", "дет", "для жизни"])) {
      return "family";
    }

    if (this.containsAny(normalizedText, ["родител", "маме", "папе"])) {
      return "parents";
    }

    if (this.containsAny(normalizedText, ["для себя", "себе", "переезд", "жить"])) {
      return "self";
    }

    return null;
  }

  private extractTimeline(normalizedText: string): PurchaseTimeline {
    if (this.containsAny(normalizedText, ["срочно", "сегодня", "на этой неделе", "до месяца"])) {
      return "urgent";
    }

    if (this.containsAny(normalizedText, ["1-3 месяца", "три месяца", "в ближайшие месяцы", "скоро"])) {
      return "soon";
    }

    if (this.containsAny(normalizedText, ["присматриваюсь", "позже", "пока смотрю", "не спешу"])) {
      return "later";
    }

    return null;
  }

  private containsAny(normalizedText: string, tokens: string[]) {
    return tokens.some((token) => normalizedText.includes(token));
  }

  private buildMissingFields(
    signals: SalesSignals,
    options?: { includePhoneForHotLead?: boolean }
  ) {
    const missingFields: AIDecision["missing_fields"] = [];

    if (!signals.purpose) {
      missingFields.push("purpose");
    }

    if (!signals.budgetRub) {
      missingFields.push("budget");
    }

    if (signals.rooms === null) {
      missingFields.push("rooms");
    }

    if (!signals.timeline) {
      missingFields.push("timeline");
    }

    if (options?.includePhoneForHotLead && !signals.hasPhone) {
      missingFields.push("phone");
    }

    return missingFields;
  }

  private calculateLeadScore(signals: SalesSignals, recommendedCount: number) {
    let score = 32;

    if (signals.purpose) {
      score += 10;
    }

    if (signals.budgetRub) {
      score += 18;
    }

    if (signals.rooms !== null) {
      score += 12;
    }

    if (signals.timeline) {
      score += signals.timeline === "urgent" ? 18 : 10;
    }

    if (recommendedCount > 0) {
      score += 10;
    }

    if (signals.wantsCallback || signals.wantsManager) {
      score += 15;
    }

    if (signals.hasDiscountObjection || signals.hasPriceObjection || signals.hasHesitation) {
      score += 4;
    }

    return Math.min(score, 96);
  }

  private describeFit(signals: SalesSignals) {
    if (signals.purpose === "investment") {
      return " с фокусом на входной билет, ликвидность и понятный формат";
    }

    if (signals.purpose === "family") {
      return " с акцентом на семейный сценарий, комфортную планировку и среду";
    }

    if (signals.purpose === "parents") {
      return " под спокойный и комфортный сценарий для родителей";
    }

    if (signals.purpose === "self") {
      return " под ваш личный сценарий жизни";
    }

    return "";
  }

  private isPremiumProject(context: DecisionContext) {
    const haystack = [
      context.activeProject?.salesHeadline,
      context.activeProject?.description,
      ...context.knowledgeDocuments.map((doc) => `${doc.title} ${doc.excerpt}`)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return this.containsAny(haystack, ["преми", "premium", "архитектур", "herzog"]);
  }

  private truncate(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 1)}…`;
  }

  private formatRub(value: number) {
    return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
  }
}

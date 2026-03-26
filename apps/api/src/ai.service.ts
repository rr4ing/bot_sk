import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  isGreeting: boolean;
  isPurposeOnly: boolean;
  isBudgetOnly: boolean;
  isRoomsOnly: boolean;
  isTimelineOnly: boolean;
  isShortReply: boolean;
  wantsManager: boolean;
  wantsProjectOverview: boolean;
  wantsPriceAnswer: boolean;
  wantsSelection: boolean;
  wantsComparison: boolean;
  wantsBestEntry: boolean;
  wantsCallback: boolean;
  hasPhone: boolean;
  hasNegative: boolean;
  hasSupportIntent: boolean;
  hasMortgageIntent: boolean;
  hasPriceObjection: boolean;
  hasDiscountObjection: boolean;
  hasHesitation: boolean;
}

const PROMPT_FILE_PATH = resolve(
  process.cwd(),
  "docs/badaevsky-sales-system-prompt.md"
);

function loadSystemPromptFromFile() {
  try {
    const raw = readFileSync(PROMPT_FILE_PATH, "utf8");
    const promptBlock = raw.match(/```md\s*([\s\S]*?)```/);

    return promptBlock?.[1]?.trim() || raw;
  } catch {
    return [
      "Ты сильный AI-консультант отдела продаж и поддержки застройщика.",
      "Работай только на русском языке и отвечай спокойно, уверенно, по-человечески, без давления и без канцелярита.",
      "Сначала отвечай по сути запроса, потом мягко квалифицируй клиента. Не задавай больше двух вопросов в одном сообщении.",
      "Не выдумывай цены, наличие, сроки, юридические гарантии, акции и ипотечные условия вне контекста.",
      "Если проект премиальный, продавай ценность через локацию, архитектуру, виды, приватность, редкость продукта и качество среды.",
      "Верни только JSON по контракту AIDecision."
    ].join("\n");
  }
}

const BASE_SYSTEM_PROMPT = loadSystemPromptFromFile();

const aiDecisionLooseSchema = aiDecisionSchema.partial().extend({
  intent: aiDecisionSchema.shape.intent,
  reply_text: aiDecisionSchema.shape.reply_text,
  lead_score: aiDecisionSchema.shape.lead_score
});

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
    if (this.shouldUseFastPath(messageText, context)) {
      return this.normalizeDecision(messageText, context, this.fallbackDecision(messageText, context));
    }

    if (!this.client) {
      return this.normalizeDecision(messageText, context, this.fallbackDecision(messageText, context));
    }

    const signals = this.collectSignals(messageText, context);
    const systemPrompt = [
      BASE_SYSTEM_PROMPT,
      "",
      "Дополнительные runtime-правила:",
      "- Если клиент уже дал цель покупки, не спрашивай ее повторно.",
      "- Если клиент уже дал бюджет, не спрашивай его повторно.",
      "- Если клиент уже дал формат квартиры, не спрашивай его повторно.",
      "- Если клиент нажал кнопку или ответил коротко, продолжай текущий шаг диалога, а не начинай разговор заново.",
      "- Если в текущем проекте есть входной лот и клиент спросил про лучший вход, объясни нижнюю планку проекта.",
      "- Если бюджет клиента ниже входного билета проекта, скажи об этом честно и предложи два полезных сценария следующего шага.",
      "- Если уже понятны ключевые данные и клиент просит сравнение или подбор, переходи к конкретике без лишних повторов.",
      "- Если клиент поздоровался, обязательно поздоровайся в ответ."
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
      const decision = this.parseModelDecision(JSON.parse(json));
      return this.normalizeDecision(messageText, context, decision);
    } catch (error) {
      this.logger.error("OpenAI Responses API failed, switching to fallback mode", error as Error);
      return this.normalizeDecision(messageText, context, this.fallbackDecision(messageText, context));
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

    if (signals.wantsComparison && recommended.length >= 2) {
      return {
        intent: "unit_recommendation",
        reply_text:
          "Сравню не в лоб по цифрам, а по смыслу покупки: покажу, где сильнее входной билет, где лучше ликвидность, а где выше ценность для жизни. Ниже оставлю 2-3 варианта, от которых уже есть смысл отталкиваться.",
        recommended_unit_ids: recommended.map((unit) => unit.id).slice(0, 3),
        lead_score: Math.max(this.calculateLeadScore(signals, recommended.length), 68),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: []
      };
    }

    if (signals.wantsBestEntry && context.projectEntryUnit) {
      const entryUnit = context.projectEntryUnit;

      return {
        intent: "unit_recommendation",
        reply_text: `Если смотреть на самый доступный вход${context.activeProject ? ` в ${projectName}` : ""}, то сейчас ориентир начинается примерно от ${this.formatRub(entryUnit.priceRub)} за ${entryUnit.areaSqm} м². Это хороший способ быстро понять нижнюю планку проекта. Если хотите, следующим сообщением покажу, стоит ли брать именно входной лот или лучше доплатить за более сильный формат.`,
        recommended_unit_ids: [entryUnit.id],
        lead_score: Math.max(this.calculateLeadScore(signals, 1), 60),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: ["price_unverified"]
      };
    }

    if (
      context.activeProject &&
      context.projectEntryUnit &&
      signals.budgetRub &&
      signals.budgetRub < context.projectEntryUnit.priceRub
    ) {
      return {
        intent: "clarify_needs",
        reply_text: `Скажу честно: в ${projectName} текущий публичный вход сейчас начинается примерно от ${this.formatRub(
          context.projectEntryUnit.priceRub
        )}, поэтому при бюджете до ${this.formatRub(
          signals.budgetRub
        )} прямого попадания в текущую экспозицию не вижу. Могу сделать два полезных шага: показать самый близкий по входу формат или предложить альтернативный сценарий покупки без потери логики сделки.`,
        recommended_unit_ids: [],
        lead_score: Math.max(this.calculateLeadScore(signals, 0), 58),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: this.buildMissingFields(signals),
        policy_flags: ["price_unverified"]
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

  private parseModelDecision(payload: unknown): AIDecision {
    const looseDecision = aiDecisionLooseSchema.parse(payload);

    return aiDecisionSchema.parse({
      recommended_unit_ids: [],
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: [],
      policy_flags: [],
      ...looseDecision
    });
  }

  private collectSignals(messageText: string, context: DecisionContext): SalesSignals {
    const transcript = context.conversationText?.trim()
      ? context.conversationText
      : this.buildConversationText(messageText, context);
    const normalized = transcript.toLowerCase();
    const currentNormalized = messageText.toLowerCase().trim();
    const budgetRub = this.catalog.extractBudget(transcript);
    const rooms = this.catalog.extractRooms(transcript);
    const purpose = this.extractPurpose(normalized);
    const timeline = this.extractTimeline(normalized);
    const isGreeting = this.isGreetingMessage(currentNormalized);
    const isShortReply = currentNormalized.length <= 24 && !/\d{6,}/.test(currentNormalized);
    const isPurposeOnly =
      this.extractPurpose(currentNormalized) !== null &&
      this.catalog.extractBudget(currentNormalized) === null &&
      this.catalog.extractRooms(currentNormalized) === null &&
      this.extractTimeline(currentNormalized) === null;
    const isBudgetOnly =
      this.catalog.extractBudget(currentNormalized) !== null &&
      this.catalog.extractRooms(currentNormalized) === null &&
      this.extractPurpose(currentNormalized) === null;
    const isRoomsOnly =
      this.catalog.extractRooms(currentNormalized) !== null &&
      this.catalog.extractBudget(currentNormalized) === null &&
      this.extractPurpose(currentNormalized) === null;

    return {
      budgetRub,
      rooms,
      purpose,
      timeline,
      isGreeting,
      isPurposeOnly,
      isBudgetOnly,
      isRoomsOnly,
      isTimelineOnly:
        this.extractTimeline(currentNormalized) !== null &&
        this.catalog.extractBudget(currentNormalized) === null &&
        this.catalog.extractRooms(currentNormalized) === null &&
        this.extractPurpose(currentNormalized) === null,
      isShortReply,
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
        "подобрать",
        "подборка",
        "варианты",
        "покажи варианты",
        "shortlist"
      ]),
      wantsComparison: this.containsAny(normalized, [
        "сравни",
        "сравнить",
        "сравнение"
      ]),
      wantsBestEntry: this.containsAny(normalized, [
        "выгодный вход",
        "минимальную цену входа",
        "самый выгодный вход",
        "входной билет",
        "минимальный вход"
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

  private normalizeDecision(
    messageText: string,
    context: DecisionContext,
    decision: AIDecision
  ): AIDecision {
    const signals = this.collectSignals(messageText, context);
    const canRecommendUnits = this.canRecommendUnits(signals);
    const missingFields = this.reconcileMissingFields(
      decision.missing_fields,
      signals
    );
    const guidedQuestion = this.buildGuidedQuestion(missingFields, context);
    const lastAssistantMessage = context.history
      .filter((entry) => entry.role === "assistant")
      .at(-1)?.content;

    if (signals.isGreeting && !signals.wantsProjectOverview) {
      return aiDecisionSchema.parse({
        intent: "sales_qualification",
        reply_text:
          "Здравствуйте! Помогу подобрать квартиру и коротко сориентировать по Бадаевскому. Для начала подскажите, для чего покупаете: для себя, семьи или инвестиций?",
        recommended_unit_ids: [],
        lead_score: 28,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: ["purpose", "budget", "rooms", "timeline"],
        policy_flags: []
      });
    }

    if (signals.isPurposeOnly) {
      return aiDecisionSchema.parse({
        intent: "sales_qualification",
        reply_text: `Понял, рассматриваете покупку ${this.describePurposeForReply(
          signals.purpose
        )}. ${guidedQuestion}`,
        recommended_unit_ids: [],
        lead_score: Math.max(decision.lead_score, 42),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      });
    }

    if (signals.isBudgetOnly) {
      return aiDecisionSchema.parse({
        intent: "clarify_needs",
        reply_text: `Отлично, бюджет понял. ${guidedQuestion}`,
        recommended_unit_ids: [],
        lead_score: Math.max(decision.lead_score, 46),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      });
    }

    if (signals.isRoomsOnly) {
      return aiDecisionSchema.parse({
        intent: "clarify_needs",
        reply_text: `Формат понял. ${guidedQuestion}`,
        recommended_unit_ids: [],
        lead_score: Math.max(decision.lead_score, 46),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      });
    }

    if (signals.isTimelineOnly && !signals.wantsCallback && !signals.wantsManager) {
      return aiDecisionSchema.parse({
        intent: "clarify_needs",
        reply_text: `По сроку понял. ${guidedQuestion}`,
        recommended_unit_ids: [],
        lead_score: Math.max(decision.lead_score, 46),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      });
    }

    if (
      !canRecommendUnits &&
      decision.recommended_unit_ids.length > 0 &&
      !signals.wantsCallback &&
      !signals.wantsManager &&
      decision.intent !== "clarify_needs" &&
      decision.intent !== "handoff_manager"
    ) {
      return aiDecisionSchema.parse({
        ...decision,
        intent: "sales_qualification",
        reply_text: guidedQuestion,
        recommended_unit_ids: [],
        missing_fields: missingFields
      });
    }

    if (
      lastAssistantMessage &&
      this.normalizeForComparison(lastAssistantMessage) ===
        this.normalizeForComparison(decision.reply_text) &&
      missingFields.length > 0
    ) {
      return aiDecisionSchema.parse({
        ...decision,
        intent: "clarify_needs",
        reply_text: guidedQuestion,
        recommended_unit_ids: canRecommendUnits ? decision.recommended_unit_ids : [],
        missing_fields: missingFields
      });
    }

    if (
      signals.isShortReply &&
      !signals.wantsSelection &&
      !signals.wantsPriceAnswer &&
      decision.reply_text.length > 320
    ) {
      return aiDecisionSchema.parse({
        ...decision,
        reply_text: this.shortenReply(decision.reply_text)
      });
    }

    return decision;
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

  private isGreetingMessage(normalizedText: string) {
    const compact = normalizedText.replace(/[!?.\s]+/g, " ").trim();
    return [
      "привет",
      "здравствуйте",
      "добрый день",
      "добрый вечер",
      "доброе утро",
      "хай",
      "hello",
      "hi"
    ].includes(compact);
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

  private canRecommendUnits(signals: SalesSignals) {
    const hasCoreIntent = Boolean(signals.purpose || signals.timeline);
    const hasSelectionIntent =
      signals.wantsSelection ||
      signals.wantsPriceAnswer ||
      signals.wantsComparison ||
      signals.wantsBestEntry;
    const hasCatalogFit = signals.budgetRub !== null || signals.rooms !== null;

    return hasSelectionIntent || (hasCatalogFit && hasCoreIntent);
  }

  private shouldUseFastPath(messageText: string, context: DecisionContext) {
    const signals = this.collectSignals(messageText, context);

    return Boolean(
      signals.isGreeting ||
        signals.isPurposeOnly ||
        signals.isBudgetOnly ||
        signals.isRoomsOnly ||
        signals.isTimelineOnly ||
        signals.wantsManager ||
        signals.wantsCallback ||
        signals.wantsBestEntry ||
        signals.wantsComparison ||
        signals.hasNegative ||
        signals.hasSupportIntent ||
        signals.hasMortgageIntent ||
        signals.hasPriceObjection ||
        signals.hasDiscountObjection ||
        signals.hasHesitation ||
        (signals.wantsSelection && (signals.budgetRub !== null || signals.rooms !== null || signals.purpose))
    );
  }

  private reconcileMissingFields(
    decisionMissingFields: AIDecision["missing_fields"],
    signals: SalesSignals
  ) {
    const preservedModelFields = decisionMissingFields.filter(
      (field) => field === "location" || field === "name"
    );
    const computedFields = this.buildMissingFields(signals);
    const phoneField =
      decisionMissingFields.includes("phone") && !signals.hasPhone ? ["phone" as const] : [];

    return this.dedupeMissingFields([
      ...preservedModelFields,
      ...computedFields,
      ...phoneField
    ]);
  }

  private buildGuidedQuestion(
    missingFields: AIDecision["missing_fields"],
    context: DecisionContext
  ) {
    const first = missingFields[0];
    const second = missingFields[1];
    const projectPrefix = context.activeProject
      ? `Если говорим про ${context.activeProject.name}, `
      : "";

    if (!first) {
      return "Если хотите, сразу покажу shortlist или сравню 2-3 самых сильных варианта.";
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
        return `${projectPrefix}подскажите комфортный бюджет и как быстро хотите выйти на сделку?`;
      }

      return `${projectPrefix}подскажите комфортный бюджет покупки.`;
    }

    if (first === "rooms") {
      if (second === "timeline") {
        return `${projectPrefix}сколько комнат рассматриваете и в какие сроки планируете решение: срочно, 1-3 месяца или пока присматриваетесь?`;
      }

      if (second === "purpose") {
        return `${projectPrefix}сколько комнат рассматриваете и покупка для жизни, семьи или инвестиций?`;
      }

      return `${projectPrefix}какой формат рассматриваете: студия, 1, 2 или 3 комнаты+?`;
    }

    if (first === "timeline") {
      return `${projectPrefix}по срокам как удобнее: срочно, в ближайшие 1-3 месяца или пока спокойно выбираете?`;
    }

    if (first === "phone") {
      return "Если удобно, отправьте контакт, и я передам менеджеру уже собранный контекст без потери деталей.";
    }

    return `${projectPrefix}уточню ещё один момент, чтобы подбор был предметным, а не общим.`;
  }

  private describePurposeForReply(purpose: PurchasePurpose) {
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

  private dedupeMissingFields(fields: AIDecision["missing_fields"]) {
    return Array.from(new Set(fields));
  }

  private shortenReply(reply: string) {
    const paragraphs = reply.split("\n\n").filter(Boolean);
    return paragraphs.slice(0, 2).join("\n\n");
  }

  private normalizeForComparison(value: string) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
  }
}

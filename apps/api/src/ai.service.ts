import { Injectable, Logger } from "@nestjs/common";
import type { AIDecision } from "@builderbot/domain";
import {
  aiDecisionSchema,
  intentSchema,
  missingFieldSchema,
  policyFlagSchema
} from "@builderbot/domain";
import { zodTextFormat } from "openai/helpers/zod";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CatalogService } from "./catalog.service";
import { EnvService } from "./env";
import {
  ConversationState,
  DecisionContext,
  PurchasePurpose,
  PurchaseTimeline
} from "./types";

interface TurnIntent {
  isGreeting: boolean;
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

const structuredDecisionSchema = z.object({
  intent: intentSchema.nullable(),
  reply_text: z.string().min(1).max(4000).nullable(),
  recommended_unit_ids: z.array(z.string()).max(3).nullable(),
  lead_score: z.number().int().min(0).max(100).nullable(),
  handoff_required: z.boolean().nullable(),
  support_ticket_required: z.boolean().nullable(),
  missing_fields: z.array(missingFieldSchema).nullable(),
  policy_flags: z.array(policyFlagSchema).nullable()
});

const structuredDecisionLooseSchema = structuredDecisionSchema.partial();

const aiDecisionTextFormat = zodTextFormat(structuredDecisionSchema, "ai_decision");

function loadSystemPromptFromFile() {
  try {
    return readFileSync(PROMPT_FILE_PATH, "utf8").trim();
  } catch {
    return [
      "Ты AI-ассистент отдела продаж застройщика.",
      "Работай только на русском языке.",
      "Не повторяй вопросы, если клиент уже дал ответ.",
      "Сначала используй уже известный контекст, потом задавай максимум 1-2 полезных вопроса.",
      "Не выдумывай цены, наличие, скидки, сроки и юридические обещания.",
      "Возвращай только структурированный JSON."
    ].join("\n");
  }
}

const SYSTEM_PROMPT = [
  "Ты сильный AI-консультант отдела продаж крупной строительной компании.",
  "Твоя задача: осмысленно продолжать текущий диалог, а не начинать его заново.",
  "У тебя есть два блока данных: persistent_state и turn_intent.",
  "persistent_state — это уже накопленный контекст клиента. Не спрашивай его повторно.",
  "turn_intent — это смысл только текущего сообщения. Используй его как повод для следующего шага.",
  "Если для shortlist уже достаточно данных, переходи к вариантам сразу.",
  "Если клиент просит цены, подбор, лучший вход или сравнение, отвечай предметно, не уводи в лишнюю qualification.",
  "Если клиент дал новую информацию, она важнее старой.",
  "Отвечай коротко, спокойно, по-человечески, без шаблонного допроса.",
  "Обычно 2-4 предложения. Не больше двух вопросов в одном ответе.",
  "Если проект премиальный, продавай ценность через локацию, архитектуру, приватность, виды, статус и редкость продукта.",
  "Если данных недостаточно, задавай только следующий полезный вопрос, а не весь опросник заново.",
  "Если менеджер или поддержка действительно нужны, эскалируй.",
  "",
  loadSystemPromptFromFile()
].join("\n");

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

  deriveConversationState(messageText: string, context: DecisionContext): ConversationState {
    const previous = context.conversationState ?? this.emptyConversationState();
    const messages = this.getConversationUserMessages(messageText, context);
    const normalizedConversation = this.buildConversationText(messageText, context).toLowerCase();

    return {
      purpose: this.extractLatestPurpose(messages) ?? previous.purpose,
      budgetRub: this.extractLatestBudget(messages) ?? previous.budgetRub,
      rooms: this.extractLatestRooms(messages) ?? previous.rooms,
      timeline: this.extractLatestTimeline(messages) ?? previous.timeline,
      hasPhone: previous.hasPhone || /контакт:\s*\+?\d|\+7\d{10}|\b8\d{10}\b/.test(normalizedConversation),
      activeProjectId: context.activeProject?.id ?? previous.activeProjectId ?? null,
      activeProjectName: context.activeProject?.name ?? previous.activeProjectName ?? null,
      lastUserMessage: messageText.trim() || previous.lastUserMessage || null,
      updatedAt: new Date().toISOString()
    };
  }

  async decide(messageText: string, context: DecisionContext): Promise<AIDecision> {
    const persistentState =
      context.conversationState ?? this.deriveConversationState(messageText, context);
    const turnIntent = this.collectTurnIntent(messageText);

    if (!this.client) {
      return this.normalizeDecision(
        this.degradedDecision(messageText, context, persistentState, turnIntent),
        context,
        persistentState,
        turnIntent
      );
    }

    try {
      const decision = await this.queryModel(messageText, context, persistentState, turnIntent);
      return this.normalizeDecision(decision, context, persistentState, turnIntent);
    } catch (error) {
      this.logger.error("OpenAI Responses API failed, switching to degraded mode", error as Error);
      return this.normalizeDecision(
        this.degradedDecision(messageText, context, persistentState, turnIntent),
        context,
        persistentState,
        turnIntent
      );
    }
  }

  private buildModelInput(
    messageText: string,
    context: DecisionContext,
    persistentState: ConversationState,
    turnIntent: TurnIntent
  ) {
    return {
      message_text: messageText,
      persistent_state: persistentState,
      turn_intent: turnIntent,
      active_project: context.activeProject
        ? {
            id: context.activeProject.id,
            name: context.activeProject.name,
            city: context.activeProject.city,
            district: context.activeProject.district,
            description: this.truncate(context.activeProject.description, 260),
            sales_headline: context.activeProject.salesHeadline
          }
        : null,
      project_entry_unit: context.projectEntryUnit
        ? {
            id: context.projectEntryUnit.id,
            code: context.projectEntryUnit.code,
            rooms: context.projectEntryUnit.rooms,
            floor: context.projectEntryUnit.floor,
            area_sqm: context.projectEntryUnit.areaSqm,
            price_rub: context.projectEntryUnit.priceRub
          }
        : null,
      candidate_units: context.candidateUnits.slice(0, 3).map((unit) => ({
        id: unit.id,
        code: unit.code,
        rooms: unit.rooms,
        floor: unit.floor,
        area_sqm: unit.areaSqm,
        price_rub: unit.priceRub,
        finishing: unit.finishing
      })),
      knowledge: context.knowledgeDocuments.slice(0, 2).map((document) => ({
        title: document.title,
        kind: document.kind,
        excerpt: this.truncate(document.excerpt, 180),
        body_preview: this.truncate(document.body, 280)
      })),
      recent_history: context.history.slice(-6).map((entry) => ({
        role: entry.role,
        content: this.truncate(entry.content, 220)
      }))
    };
  }

  private hydrateDecision(
    decision: z.infer<typeof structuredDecisionLooseSchema>,
    persistentState: ConversationState,
    turnIntent: TurnIntent
  ): AIDecision {
    const defaultMissingFields = this.buildMissingFields(persistentState, {
      includePhoneForHotLead: turnIntent.wantsManager || turnIntent.wantsCallback
    });

    const fallbackIntent =
      defaultMissingFields.length > 0 ? "clarify_needs" : "sales_qualification";

    return aiDecisionSchema.parse({
      intent: decision.intent ?? fallbackIntent,
      reply_text:
        decision.reply_text ??
        "Понял контекст. Продолжу от уже известных данных и не буду гонять вас по кругу вопросами.",
      recommended_unit_ids: decision.recommended_unit_ids ?? [],
      lead_score: decision.lead_score ?? this.calculateLeadScore(persistentState, turnIntent, 0),
      handoff_required: decision.handoff_required ?? false,
      support_ticket_required: decision.support_ticket_required ?? false,
      missing_fields: decision.missing_fields ?? defaultMissingFields,
      policy_flags: decision.policy_flags ?? []
    });
  }

  private async queryModel(
    messageText: string,
    context: DecisionContext,
    persistentState: ConversationState,
    turnIntent: TurnIntent
  ) {
    const request = {
      model: this.env.languageModelName,
      ...(this.env.languageModelProvider === "xai" ? { store: false } : {}),
      text: {
        format: aiDecisionTextFormat
      },
      input: [
        {
          role: "system" as const,
          content: SYSTEM_PROMPT
        },
        {
          role: "user" as const,
          content: JSON.stringify(this.buildModelInput(messageText, context, persistentState, turnIntent))
        }
      ]
    };

    const responsesClient = this.client?.responses as
      | {
          parse?: (payload: unknown) => Promise<{ output_parsed?: z.infer<typeof structuredDecisionSchema> | null }>;
          create?: (payload: unknown) => Promise<{ output_text?: string }>;
        }
      | undefined;

    if (responsesClient?.parse) {
      const response = await responsesClient.parse(request);

      if (!response.output_parsed) {
        throw new Error("Model did not return structured output");
      }

      return this.hydrateDecision(response.output_parsed, persistentState, turnIntent);
    }

    if (responsesClient?.create) {
      const response = await responsesClient.create(request);
      const rawText = response.output_text?.trim();

      if (!rawText) {
        throw new Error("Model did not return structured text output");
      }

      return this.hydrateDecision(
        structuredDecisionLooseSchema.parse(JSON.parse(rawText)),
        persistentState,
        turnIntent
      );
    }

    throw new Error("Language model client does not support parse or create");
  }

  private degradedDecision(
    messageText: string,
    context: DecisionContext,
    persistentState: ConversationState,
    turnIntent: TurnIntent
  ): AIDecision {
    const projectName = context.activeProject?.name ?? "проект";
    const missingFields = this.buildMissingFields(persistentState, {
      includePhoneForHotLead: turnIntent.wantsManager || turnIntent.wantsCallback
    });
    const shortlistReady = this.isShortlistReady(persistentState, context);
    const recommendedIds = context.candidateUnits.slice(0, 3).map((unit) => unit.id);

    if (turnIntent.hasNegative) {
      return aiDecisionSchema.parse({
        intent: "handoff_manager",
        reply_text:
          "Понимаю, что ситуация неприятная. Подключу менеджера, чтобы быстро разобраться и не гонять вас по кругу.",
        recommended_unit_ids: [],
        lead_score: 86,
        handoff_required: true,
        support_ticket_required: true,
        missing_fields: persistentState.hasPhone ? [] : ["phone"],
        policy_flags: ["negative_sentiment", "human_handoff_required"]
      });
    }

    if (turnIntent.hasSupportIntent || turnIntent.hasMortgageIntent) {
      return aiDecisionSchema.parse({
        intent: "support_answer",
        reply_text:
          "Помогу сориентироваться по процессу, документам и следующим шагам. Если нужен разбор вашей конкретной сделки или статуса, сразу подключу менеджера.",
        recommended_unit_ids: [],
        lead_score: turnIntent.hasMortgageIntent ? 54 : 44,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: []
      });
    }

    if (turnIntent.wantsManager || turnIntent.wantsCallback) {
      if (!persistentState.hasPhone) {
        return aiDecisionSchema.parse({
          intent: "clarify_needs",
          reply_text:
            "Подключу менеджера. Отправьте, пожалуйста, удобный номер телефона или контакт, и я передам уже собранный контекст без потери деталей.",
          recommended_unit_ids: [],
          lead_score: 76,
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: ["phone"],
          policy_flags: []
        });
      }

      return aiDecisionSchema.parse({
        intent: "handoff_manager",
        reply_text:
          "Отлично, передаю ваш запрос менеджеру уже с контекстом по сценарию покупки, бюджету и формату.",
        recommended_unit_ids: recommendedIds,
        lead_score: 84,
        handoff_required: true,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: ["human_handoff_required"]
      });
    }

    if (turnIntent.wantsBestEntry && context.projectEntryUnit) {
      return aiDecisionSchema.parse({
        intent: "unit_recommendation",
        reply_text: `Если смотреть на минимальный вход в ${projectName}, текущий ориентир начинается примерно от ${this.formatRub(
          context.projectEntryUnit.priceRub
        )} за ${context.projectEntryUnit.areaSqm} м². Если хотите, дальше покажу, стоит ли брать именно входной лот или лучше немного доплатить за более сильный вариант.`,
        recommended_unit_ids: [context.projectEntryUnit.id],
        lead_score: this.calculateLeadScore(persistentState, turnIntent, 1),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: ["price_unverified"]
      });
    }

    if (turnIntent.wantsComparison && context.candidateUnits.length >= 2) {
      return aiDecisionSchema.parse({
        intent: "unit_recommendation",
        reply_text: this.buildComparisonReply(persistentState, context),
        recommended_unit_ids: recommendedIds,
        lead_score: this.calculateLeadScore(persistentState, turnIntent, recommendedIds.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: ["price_unverified"]
      });
    }

    if ((turnIntent.hasPriceObjection || turnIntent.hasDiscountObjection) && context.candidateUnits.length > 0) {
      return aiDecisionSchema.parse({
        intent: "unit_recommendation",
        reply_text: this.buildObjectionReply(persistentState, context, turnIntent),
        recommended_unit_ids: recommendedIds,
        lead_score: this.calculateLeadScore(persistentState, turnIntent, recommendedIds.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: ["price_unverified"]
      });
    }

    if (turnIntent.hasHesitation && context.candidateUnits.length > 0) {
      return aiDecisionSchema.parse({
        intent: "unit_recommendation",
        reply_text: this.buildHesitationReply(persistentState, context),
        recommended_unit_ids: recommendedIds,
        lead_score: this.calculateLeadScore(persistentState, turnIntent, recommendedIds.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: ["price_unverified"]
      });
    }

    if (shortlistReady && context.candidateUnits.length > 0) {
      return aiDecisionSchema.parse({
        intent: "unit_recommendation",
        reply_text: this.buildShortlistReply(persistentState, context),
        recommended_unit_ids: recommendedIds,
        lead_score: this.calculateLeadScore(persistentState, turnIntent, recommendedIds.length),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: []
      });
    }

    if (turnIntent.wantsPriceAnswer && (context.projectEntryUnit || context.candidateUnits.length > 0)) {
      const anchorUnit = context.projectEntryUnit ?? context.candidateUnits[0];

      return aiDecisionSchema.parse({
        intent: "clarify_needs",
        reply_text: `Если смотреть на текущую публичную экспозицию в ${projectName}, ориентир входа сейчас начинается примерно от ${this.formatRub(
          anchorUnit.priceRub
        )}. ${this.buildGuidedQuestion(missingFields, context)}`,
        recommended_unit_ids: anchorUnit ? [anchorUnit.id] : [],
        lead_score: this.calculateLeadScore(persistentState, turnIntent, anchorUnit ? 1 : 0),
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: ["price_unverified"]
      });
    }

    if (turnIntent.isGreeting) {
      return aiDecisionSchema.parse({
        intent: "sales_qualification",
        reply_text: `Здравствуйте! Помогу с подбором квартиры в ${projectName}. Для начала подскажите, для чего покупаете: для себя, семьи, инвестиций или родителей?`,
        recommended_unit_ids: [],
        lead_score: 28,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: missingFields,
        policy_flags: []
      });
    }

    return aiDecisionSchema.parse({
      intent: missingFields.length > 0 ? "clarify_needs" : "sales_qualification",
      reply_text:
        missingFields.length > 0
          ? `${this.buildKnownFactsSummary(persistentState, context)} ${this.buildGuidedQuestion(
              missingFields,
              context
            )}`
          : `${this.buildKnownFactsSummary(
              persistentState,
              context
            )} Если хотите, сразу покажу shortlist или сравню 2-3 самых сильных варианта.`,
      recommended_unit_ids: shortlistReady ? recommendedIds : [],
      lead_score: this.calculateLeadScore(persistentState, turnIntent, shortlistReady ? recommendedIds.length : 0),
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: shortlistReady ? [] : missingFields,
      policy_flags: []
    });
  }

  private normalizeDecision(
    decision: AIDecision,
    context: DecisionContext,
    persistentState: ConversationState,
    turnIntent: TurnIntent
  ): AIDecision {
    const missingFields = this.reconcileMissingFields(
      decision.missing_fields,
      persistentState,
      turnIntent
    );
    const shortlistReady = this.isShortlistReady(persistentState, context);
    const safeRecommendedIds = decision.recommended_unit_ids
      .filter((id) => context.candidateUnits.some((unit) => unit.id === id))
      .slice(0, 3);
    const recommendedUnitIds =
      shortlistReady && safeRecommendedIds.length === 0
        ? context.candidateUnits.slice(0, 3).map((unit) => unit.id)
        : safeRecommendedIds;
    const knownFactsSummary = this.buildKnownFactsSummary(persistentState, context);
    const guidedQuestion = this.buildGuidedQuestion(missingFields, context);
    const lastAssistantMessage = context.history
      .filter((entry) => entry.role === "assistant")
      .at(-1)?.content;

    let normalized: AIDecision = aiDecisionSchema.parse({
      ...decision,
      recommended_unit_ids: recommendedUnitIds,
      missing_fields: shortlistReady ? [] : missingFields,
      lead_score: Math.max(
        decision.lead_score,
        this.calculateLeadScore(persistentState, turnIntent, recommendedUnitIds.length)
      )
    });

    if (
      turnIntent.wantsBestEntry &&
      context.projectEntryUnit &&
      normalized.intent !== "handoff_manager" &&
      normalized.intent !== "support_answer" &&
      normalized.intent !== "support_ticket"
    ) {
      normalized = aiDecisionSchema.parse({
        ...normalized,
        intent: "unit_recommendation",
        recommended_unit_ids: [context.projectEntryUnit.id],
        policy_flags: Array.from(new Set([...normalized.policy_flags, "price_unverified"]))
      });
    }

    if (
      shortlistReady &&
      context.candidateUnits.length > 0 &&
      normalized.intent !== "handoff_manager" &&
      normalized.intent !== "support_answer" &&
      normalized.intent !== "support_ticket" &&
      this.isReaskingKnownInfo(normalized.reply_text, persistentState)
    ) {
      normalized = aiDecisionSchema.parse({
        ...normalized,
        intent: "unit_recommendation",
        reply_text: this.buildShortlistReply(persistentState, context),
        recommended_unit_ids:
          normalized.recommended_unit_ids.length > 0
            ? normalized.recommended_unit_ids
            : context.candidateUnits.slice(0, 3).map((unit) => unit.id),
        missing_fields: []
      });
    } else if (
      missingFields.length > 0 &&
      normalized.intent !== "handoff_manager" &&
      normalized.intent !== "support_answer" &&
      normalized.intent !== "support_ticket" &&
      (this.isReaskingKnownInfo(normalized.reply_text, persistentState) ||
        (lastAssistantMessage &&
          this.normalizeForComparison(lastAssistantMessage) ===
            this.normalizeForComparison(normalized.reply_text)))
    ) {
      normalized = aiDecisionSchema.parse({
        ...normalized,
        intent: "clarify_needs",
        reply_text: `${knownFactsSummary} ${guidedQuestion}`,
        recommended_unit_ids: []
      });
    }

    if (turnIntent.isShortReply && normalized.reply_text.length > 320) {
      normalized = aiDecisionSchema.parse({
        ...normalized,
        reply_text: this.shortenReply(normalized.reply_text)
      });
    }

    return normalized;
  }

  private collectTurnIntent(messageText: string): TurnIntent {
    const normalized = messageText.toLowerCase().trim();

    return {
      isGreeting: this.isGreetingMessage(normalized),
      isShortReply: normalized.length <= 28 && !/\d{6,}/.test(normalized),
      wantsManager: this.containsAny(normalized, [
        "менеджер",
        "свяжите",
        "соедините",
        "живой человек",
        "человек"
      ]),
      wantsProjectOverview: this.containsAny(normalized, [
        "расскажи",
        "расскажите",
        "что за",
        "про жк",
        "про проект",
        "о проекте"
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
        "варианты",
        "покажи варианты",
        "предложи",
        "shortlist"
      ]),
      wantsComparison: this.containsAny(normalized, ["сравни", "сравнить", "сравнение"]),
      wantsBestEntry: this.containsAny(normalized, [
        "минимальную цену входа",
        "выгодный вход",
        "самый выгодный вход",
        "входной билет",
        "минимальный вход"
      ]),
      wantsCallback: this.containsAny(normalized, [
        "перезвон",
        "позвон",
        "созвон",
        "звонок",
        "встреч",
        "просмотр"
      ]),
      hasPhone: /контакт:\s*\+?\d|\+7\d{10}|\b8\d{10}\b/.test(normalized),
      hasNegative: this.containsAny(normalized, ["жалоба", "претенз", "ужас", "плохо", "бесит"]),
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
        "отложу"
      ])
    };
  }

  private emptyConversationState(): ConversationState {
    return {
      purpose: null,
      budgetRub: null,
      rooms: null,
      timeline: null,
      hasPhone: false,
      activeProjectId: null,
      activeProjectName: null,
      lastUserMessage: null,
      updatedAt: null
    };
  }

  private buildConversationText(messageText: string, context: DecisionContext) {
    return [...context.history.filter((entry) => entry.role === "user").map((entry) => entry.content), messageText]
      .filter(Boolean)
      .join("\n");
  }

  private getConversationUserMessages(messageText: string, context: DecisionContext) {
    const messages = context.history
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.content.trim())
      .filter(Boolean);
    const current = messageText.trim();

    if (current && messages.at(-1)?.toLowerCase() !== current.toLowerCase()) {
      messages.push(current);
    }

    return messages;
  }

  private extractLatestBudget(messages: string[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const budget = this.catalog.extractBudget(messages[index]);
      if (budget !== null) {
        return budget;
      }
    }

    return null;
  }

  private extractLatestRooms(messages: string[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const rooms = this.catalog.extractRooms(messages[index]);
      if (rooms !== null) {
        return rooms;
      }
    }

    return null;
  }

  private extractLatestPurpose(messages: string[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const purpose = this.extractPurpose(messages[index].toLowerCase());
      if (purpose) {
        return purpose;
      }
    }

    return null;
  }

  private extractLatestTimeline(messages: string[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const timeline = this.extractTimeline(messages[index].toLowerCase());
      if (timeline) {
        return timeline;
      }
    }

    return null;
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
    if (
      this.containsAny(normalizedText, [
        "срочно",
        "сегодня",
        "на этой неделе",
        "на следующей неделе",
        "на след неделе",
        "до месяца",
        "1-2 недели",
        "1 2 недели",
        "две недели",
        "пара недель"
      ])
    ) {
      return "urgent";
    }

    if (
      this.containsAny(normalizedText, [
        "1-3 месяца",
        "1 3 месяца",
        "в ближайшие месяцы",
        "скоро",
        "ближайший месяц"
      ])
    ) {
      return "soon";
    }

    if (this.containsAny(normalizedText, ["присматриваюсь", "позже", "пока смотрю", "не спешу"])) {
      return "later";
    }

    return null;
  }

  private buildMissingFields(
    state: ConversationState,
    options?: { includePhoneForHotLead?: boolean }
  ): AIDecision["missing_fields"] {
    const missingFields: AIDecision["missing_fields"] = [];

    if (!state.purpose) {
      missingFields.push("purpose");
    }

    if (!state.budgetRub) {
      missingFields.push("budget");
    }

    if (state.rooms === null) {
      missingFields.push("rooms");
    }

    if (!state.timeline) {
      missingFields.push("timeline");
    }

    if (options?.includePhoneForHotLead && !state.hasPhone) {
      missingFields.push("phone");
    }

    return missingFields;
  }

  private reconcileMissingFields(
    decisionMissingFields: AIDecision["missing_fields"],
    state: ConversationState,
    turnIntent: TurnIntent
  ) {
    const preservedModelFields = decisionMissingFields.filter(
      (field) => field === "location" || field === "name"
    );
    const computed = this.buildMissingFields(state, {
      includePhoneForHotLead: turnIntent.wantsManager || turnIntent.wantsCallback
    });
    const phoneField =
      decisionMissingFields.includes("phone") && !state.hasPhone ? ["phone" as const] : [];

    return this.dedupeMissingFields([...preservedModelFields, ...computed, ...phoneField]);
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

  private buildShortlistReply(state: ConversationState, context: DecisionContext) {
    const [first, second] = context.candidateUnits;
    const projectName = context.activeProject?.name ?? "проект";
    const summary = this.buildKnownFactsSummary(state, context);

    if (!first) {
      return `${summary} Могу сразу сузить подбор до 2-3 сильных вариантов и подсветить, какой из них лучше под ваш сценарий.`;
    }

    const firstReason = this.buildSalesReason(first, state);
    const secondHint = second
      ? ` Если захотите сравнение, следующим сообщением разберу ещё ${second.code} — ${this.describeUnitShort(
          second
        )}.`
      : "";

    return `${summary} Данных уже достаточно, поэтому сразу покажу shortlist по ${projectName}. В первую очередь я бы смотрел ${first.code} — ${this.describeUnitShort(
      first
    )}. Почему: ${firstReason}.${secondHint}`;
  }

  private buildComparisonReply(state: ConversationState, context: DecisionContext) {
    const [first, second] = context.candidateUnits;
    const summary = this.buildKnownFactsSummary(state, context);

    if (!first || !second) {
      return this.buildShortlistReply(state, context);
    }

    const firstLabel = `${first.code} — ${this.describeUnitShort(first)}`;
    const secondLabel = `${second.code} — ${this.describeUnitShort(second)}`;
    const compareAngle =
      first.priceRub === second.priceRub
        ? "один чуть сильнее по формату, другой — по входному билету"
        : first.priceRub < second.priceRub
          ? "первый выглядит как более аккуратный вход по бюджету, второй — как апгрейд по качеству лота"
          : "первый выглядит как апгрейд по качеству лота, второй — как более мягкий вход";

    return `${summary} Если сравнивать предметно, я бы поставил рядом два варианта: ${firstLabel} и ${secondLabel}. Логика такая: ${compareAngle}. Если хотите, следующим сообщением разложу их по схеме «что лучше для жизни / что лучше для инвестиции / что выгоднее по входу».`;
  }

  private buildObjectionReply(
    state: ConversationState,
    context: DecisionContext,
    turnIntent: TurnIntent
  ) {
    const [first, second] = context.candidateUnits;
    const summary = this.buildKnownFactsSummary(state, context);

    if (!first) {
      return `${summary} Могу показать более мягкий вход по бюджету и отдельно — вариант посильнее по характеристикам.`;
    }

    const objectionLead = turnIntent.hasDiscountObjection
      ? "Понимаю запрос на скидку."
      : "Понимаю реакцию на цену.";
    const firstBit = `${first.code} — ${this.describeUnitShort(first)}`;
    const secondBit = second ? ` В запасе могу сразу показать и ${second.code} — ${this.describeUnitShort(second)}.` : "";

    return `${objectionLead} В Бадаевском обычно лучше смотреть не абстрактно на цену, а на соотношение входа, формата и ликвидности. Из того, что сейчас ближе всего к вашему сценарию, я бы начал с ${firstBit}: ${this.buildSalesReason(
      first,
      state
    )}.${secondBit} Если хотите, следующим сообщением покажу либо самый мягкий вход, либо лучший вариант за небольшой апгрейд бюджета.`;
  }

  private buildHesitationReply(state: ConversationState, context: DecisionContext) {
    const [first] = context.candidateUnits;
    const summary = this.buildKnownFactsSummary(state, context);

    if (!first) {
      return `${summary} Давайте без давления: могу просто сузить выбор до 1-2 сильных вариантов и коротко объяснить, на что смотреть в первую очередь.`;
    }

    return `${summary} Это нормальный этап. Чтобы не держать в голове весь рынок, я бы сейчас зафиксировал один базовый ориентир — ${first.code}, ${this.describeUnitShort(
      first
    )}. Так вам будет проще понять, что именно вы получаете за свой бюджет и стоит ли двигаться дальше. Если хотите, я коротко распишу плюсы и риски именно этого лота.`;
  }

  private calculateLeadScore(
    state: ConversationState,
    turnIntent: TurnIntent,
    recommendedCount: number
  ) {
    let score = 28;

    if (state.purpose) {
      score += 10;
    }

    if (state.budgetRub) {
      score += 18;
    }

    if (state.rooms !== null) {
      score += 12;
    }

    if (state.timeline) {
      score += state.timeline === "urgent" ? 18 : 10;
    }

    if (recommendedCount > 0) {
      score += 10;
    }

    if (turnIntent.wantsCallback || turnIntent.wantsManager) {
      score += 12;
    }

    if (turnIntent.hasDiscountObjection || turnIntent.hasPriceObjection || turnIntent.hasHesitation) {
      score += 4;
    }

    return Math.min(score, 96);
  }

  private isShortlistReady(state: ConversationState, context: DecisionContext) {
    return Boolean(
      state.purpose &&
        state.budgetRub !== null &&
        state.rooms !== null &&
        context.candidateUnits.length > 0
    );
  }

  private buildKnownFactsSummary(state: ConversationState, context: DecisionContext) {
    const facts: string[] = [];

    if (context.activeProject?.name) {
      facts.push(`по ${context.activeProject.name}`);
    }

    if (state.purpose) {
      facts.push(this.describePurposeForReply(state.purpose));
    }

    if (state.budgetRub) {
      facts.push(`бюджет около ${this.formatRub(state.budgetRub)}`);
    }

    if (state.rooms !== null) {
      facts.push(state.rooms === 0 ? "рассматриваете студию" : `рассматриваете ${state.rooms}-комнатный формат`);
    }

    if (state.timeline) {
      facts.push(this.describeTimelineForReply(state.timeline));
    }

    if (facts.length === 0) {
      return "Понял контекст.";
    }

    return `Понял: ${facts.join(", ")}.`;
  }

  private buildSalesReason(unit: DecisionContext["candidateUnits"][number], state: ConversationState) {
    const reasons: string[] = [];

    if (state.purpose === "investment") {
      reasons.push("такой формат обычно лучше читается по ликвидности и спросу на аренду");
    } else if (state.purpose === "family") {
      reasons.push("это выглядит как сильный семейный формат без лишней переплаты за метраж");
    } else if (state.purpose === "parents") {
      reasons.push("это понятный и комфортный вариант под покупку для родителей");
    } else {
      reasons.push("это один из самых сбалансированных вариантов для жизни");
    }

    if (state.budgetRub) {
      reasons.push(this.describeBudgetFit(unit.priceRub, state.budgetRub));
    }

    if (unit.perks[0]) {
      reasons.push(`из бонусов — ${unit.perks[0]}`);
    }

    return reasons.join(", ");
  }

  private describeBudgetFit(priceRub: number, budgetRub: number) {
    if (priceRub <= budgetRub) {
      const delta = budgetRub - priceRub;
      if (delta <= 5_000_000) {
        return "лот почти в верхней границе вашего бюджета";
      }

      return "лот уверенно укладывается в ваш бюджет";
    }

    const overshoot = priceRub - budgetRub;
    if (overshoot <= 10_000_000) {
      return "он чуть выше вашего ориентира, но ещё выглядит как разумный апгрейд бюджета";
    }

    return "он заметно выше текущего ориентира, так что его стоит смотреть только если готовы расширить бюджет";
  }

  private describeUnitShort(unit: DecisionContext["candidateUnits"][number]) {
    return `${unit.rooms === 0 ? "студия" : `${unit.rooms}-комнатная`}, ${unit.areaSqm} м², ${
      unit.floor
    }-й этаж, ${this.formatRub(unit.priceRub)}`;
  }

  private isReaskingKnownInfo(replyText: string, state: ConversationState) {
    const normalized = replyText.toLowerCase();

    if (
      state.purpose &&
      this.containsAny(normalized, [
        "для какого сценария",
        "для чего покупаете",
        "для себя, семьи или инвестиций",
        "для себя, семьи, инвестиций или родителей"
      ])
    ) {
      return true;
    }

    if (
      state.budgetRub &&
      this.containsAny(normalized, [
        "какой бюджет",
        "комфортный бюджет",
        "какой бюджет комфортен",
        "подскажите бюджет"
      ])
    ) {
      return true;
    }

    if (
      state.rooms !== null &&
      this.containsAny(normalized, [
        "сколько комнат",
        "какой формат",
        "формат квартиры",
        "какой формат нужен"
      ])
    ) {
      return true;
    }

    if (
      state.timeline &&
      this.containsAny(normalized, [
        "в какие сроки",
        "по срокам",
        "как быстро хотите",
        "планируете решение"
      ])
    ) {
      return true;
    }

    return false;
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

  private describeTimelineForReply(timeline: PurchaseTimeline) {
    switch (timeline) {
      case "urgent":
        return "решение нужно быстро";
      case "soon":
        return "горизонт решения в ближайшие 1-3 месяца";
      case "later":
        return "сейчас спокойно выбираете без спешки";
      default:
        return "срок пока не зафиксирован";
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
      "hello",
      "hi"
    ].includes(compact);
  }

  private truncate(value: string | null | undefined, maxLength: number) {
    if (!value) {
      return "";
    }

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 1)}…`;
  }

  private formatRub(value: number) {
    return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
  }
}

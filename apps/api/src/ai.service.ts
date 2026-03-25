import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import type { AIDecision } from "@builderbot/domain";
import { aiDecisionSchema } from "@builderbot/domain";
import { EnvService } from "./env";
import { DecisionContext } from "./types";
import { CatalogService } from "./catalog.service";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;

  constructor(
    private readonly env: EnvService,
    private readonly catalog: CatalogService
  ) {
    this.client = this.env.values.OPENAI_API_KEY
      ? new OpenAI({ apiKey: this.env.values.OPENAI_API_KEY })
      : null;
  }

  async decide(messageText: string, context: DecisionContext): Promise<AIDecision> {
    if (!this.client) {
      return this.fallbackDecision(messageText, context);
    }

    const systemPrompt = [
      "Ты продажный и сервисный AI-консультант застройщика.",
      "Работай только на русском языке.",
      "Не выдумывай цены, наличие, юридические гарантии, акции и ипотечные условия вне контекста.",
      "Если не хватает данных, выбирай intent=clarify_needs или handoff_manager.",
      "Верни только JSON по контракту AIDecision."
    ].join(" ");

    const input = {
      messageText,
      history: context.history,
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
        code: unit.code,
        rooms: unit.rooms,
        floor: unit.floor,
        areaSqm: unit.areaSqm,
        priceRub: unit.priceRub,
        finishing: unit.finishing,
        status: unit.status,
        perks: unit.perks
      })),
      knowledge: context.knowledgeDocuments.map((doc) => ({
        title: doc.title,
        kind: doc.kind,
        excerpt: doc.excerpt,
        tags: doc.tags
      })),
      hints: {
        detectedBudgetRub: this.catalog.extractBudget(messageText),
        detectedRooms: this.catalog.extractRooms(messageText)
      }
    };

    try {
      const response = await this.client.responses.create({
        model: this.env.values.OPENAI_MODEL,
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
    const normalized = messageText.toLowerCase();
    const hasNegative = ["жалоба", "претенз", "ужас", "плохо", "суд"].some((token) =>
      normalized.includes(token)
    );
    const mentionsDocuments = ["документ", "договор", "ипотек", "поддержк", "акт"].some(
      (token) => normalized.includes(token)
    );
    const budget = this.catalog.extractBudget(messageText);
    const rooms = this.catalog.extractRooms(messageText);
    const recommended = context.candidateUnits.slice(0, 3);

    if (hasNegative) {
      return {
        intent: "handoff_manager",
        reply_text:
          "Понимаю, что ситуация неприятная. Подключу менеджера, чтобы не гонять вас по кругу и помочь быстрее.",
        recommended_unit_ids: [],
        lead_score: 82,
        handoff_required: true,
        support_ticket_required: true,
        missing_fields: [],
        policy_flags: ["negative_sentiment", "human_handoff_required"]
      };
    }

    if (mentionsDocuments) {
      return {
        intent: "support_answer",
        reply_text:
          "Помогу по процессу и документам. Если вопрос требует проверки по конкретной сделке, сразу создам обращение для менеджера.",
        recommended_unit_ids: [],
        lead_score: 45,
        handoff_required: false,
        support_ticket_required: normalized.includes("провер") || normalized.includes("статус"),
        missing_fields: [],
        policy_flags: normalized.includes("провер") ? ["human_handoff_required"] : []
      };
    }

    if (recommended.length > 0 && budget) {
      return {
        intent: "unit_recommendation",
        reply_text:
          "Подобрал несколько квартир под ваш бюджет. Ниже покажу самые релевантные варианты и могу сразу передать вас менеджеру на просмотр или точный расчет.",
        recommended_unit_ids: recommended.map((unit) => unit.id),
        lead_score: rooms !== null ? 78 : 68,
        handoff_required: rooms !== null,
        support_ticket_required: false,
        missing_fields: rooms === null ? ["rooms", "timeline"] : ["timeline"],
        policy_flags: []
      };
    }

    return {
      intent: "sales_qualification",
      reply_text:
        "С радостью помогу подобрать квартиру. Подскажите, пожалуйста, ориентир по бюджету, сколько комнат рассматриваете и для чего покупаете: для жизни или инвестиции?",
      recommended_unit_ids: [],
      lead_score: 35,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: budget ? ["rooms", "timeline", "purpose"] : ["budget", "rooms", "timeline", "purpose"],
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
}

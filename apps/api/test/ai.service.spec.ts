import type { KnowledgeDocument, Project, Unit } from "@prisma/client";
import { AiService } from "../src/ai.service";

describe("AiService fallback sales flow", () => {
  const project: Project = {
    id: "project-1",
    name: "Бадаевский",
    city: "Москва",
    district: "Дорогомилово",
    description:
      "Премиальный жилой комплекс на Кутузовском проспекте у Москвы-реки.",
    salesHeadline:
      "Архитектурный премиум-проект у воды рядом с Москва-Сити.",
    handoffPhone: "+7 495 000-00-00",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };

  const knowledgeDocument: KnowledgeDocument = {
    id: "doc-1",
    title: "ЖК Бадаевский",
    kind: "faq",
    tags: ["badaevsky", "premium"],
    body: "Capital Group и Herzog & de Meuron, проект у воды и рядом с Москва-Сити.",
    excerpt: "Премиальный проект у воды.",
    sourcePath: null,
    embeddingStatus: "ready",
    embedding: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };

  const unit: Unit = {
    id: "unit-1",
    projectId: "project-1",
    code: "BAD-2-765-15",
    rooms: 2,
    floor: 15,
    areaSqm: 76.5,
    priceRub: 107000000,
    finishing: "без отделки",
    status: "available",
    availableFrom: null,
    perks: ["видовой этаж", "рядом Москва-Сити"],
    notes: "Тестовый лот",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };

  const env = {
    values: {
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "gpt-5-mini"
    }
  };

  const catalog = {
    extractBudget: jest.fn((text: string) => {
      const normalized = text.replace(/\s/g, "").toLowerCase();
      const match = normalized.match(/(\d+)(?:млн)/);
      return match ? Number(match[1]) * 1_000_000 : null;
    }),
    extractRooms: jest.fn((text: string) => {
      const normalized = text.toLowerCase();
      if (normalized.includes("2 комнаты") || normalized.includes("2-комнат")) {
        return 2;
      }

      return null;
    })
  };

  it("returns project-aware premium recommendation when enough data is present", async () => {
    const service = new AiService(env as never, catalog as never);

    const decision = await service.decide(
      "Подбери в Бадаевском 2 комнаты до 110 млн для семьи, решение в ближайший месяц.",
      {
        activeProject: project,
        candidateUnits: [unit],
        knowledgeDocuments: [knowledgeDocument],
        history: []
      }
    );

    expect(decision.intent).toBe("unit_recommendation");
    expect(decision.recommended_unit_ids).toEqual(["unit-1"]);
    expect(decision.reply_text).toContain("Бадаев");
    expect(decision.reply_text.toLowerCase()).toContain("сразу покажу");
    expect(decision.lead_score).toBeGreaterThanOrEqual(80);
  });

  it("asks for contact before handing off a callback request", async () => {
    const service = new AiService(env as never, catalog as never);

    const decision = await service.decide("Перезвоните мне сегодня по Бадаевскому", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: []
    });

    expect(decision.intent).toBe("clarify_needs");
    expect(decision.missing_fields).toContain("phone");
    expect(decision.reply_text).toContain("контакт");
  });

  it("does not recommend units on a plain greeting", async () => {
    const service = new AiService(env as never, catalog as never);

    const decision = await service.decide("Привет", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [{ role: "user", content: "Привет" }],
      conversationText: "Привет"
    });

    expect(decision.intent).toBe("sales_qualification");
    expect(decision.recommended_unit_ids).toEqual([]);
    expect(decision.reply_text).toContain("для чего покупаете");
  });

  it("asks the next question after a purpose-only quick reply instead of repeating a project pitch", async () => {
    const service = new AiService(env as never, catalog as never);

    const decision = await service.decide("Для инвестиций", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Интересен Бадаевский" },
        { role: "assistant", content: "Для чего рассматриваете покупку?" },
        { role: "user", content: "Для инвестиций" }
      ],
      conversationText: "Интересен Бадаевский\nДля инвестиций"
    });

    expect(decision.recommended_unit_ids).toEqual([]);
    expect(decision.reply_text).toContain("бюджет");
    expect(decision.reply_text).toContain("какой формат");
  });

  it("answers the best entry action with a concrete premium entry anchor", async () => {
    const service = new AiService(env as never, catalog as never);

    const decision = await service.decide("Покажите минимальную цену входа и самый выгодный формат покупки", {
      activeProject: project,
      candidateUnits: [unit],
      projectEntryUnit: unit,
      knowledgeDocuments: [knowledgeDocument],
      history: [{ role: "user", content: "Самый выгодный вход" }],
      conversationText: "Самый выгодный вход"
    });

    expect(decision.intent).toBe("unit_recommendation");
    expect(decision.recommended_unit_ids).toEqual(["unit-1"]);
    expect(decision.reply_text).toContain("107");
    expect(decision.policy_flags).toContain("price_unverified");
  });

  it("handles timeline-only quick replies by asking the next missing qualification step", async () => {
    const service = new AiService(env as never, catalog as never);

    const decision = await service.decide("Пока присматриваюсь, без спешки", {
      activeProject: project,
      candidateUnits: [unit],
      projectEntryUnit: unit,
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Бадаевский" },
        { role: "assistant", content: "Подскажите бюджет и формат." }
      ],
      conversationText: "Бадаевский\nПока присматриваюсь, без спешки"
    });

    expect(decision.intent).toBe("clarify_needs");
    expect(decision.reply_text).toContain("бюджет");
    expect(decision.reply_text).toContain("сценария");
    expect(decision.missing_fields).toContain("budget");
    expect(decision.missing_fields).toContain("purpose");
  });

  it("fills missing boolean flags from model output instead of crashing on partial JSON", async () => {
    const service = new AiService(
      {
        values: {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "test-model"
        },
        languageModelApiKey: "test-key",
        languageModelName: "test-model",
        languageModelProvider: "openai",
        languageModelBaseUrl: undefined
      } as never,
      catalog as never
    );

    (service as unknown as { client: unknown }).client = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            intent: "clarify_needs",
            reply_text: "Уточню ещё пару деталей.",
            lead_score: 45,
            missing_fields: ["budget", "rooms"]
          })
        })
      }
    };

    const decision = await service.decide("Для себя", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Бадаевский" },
        { role: "assistant", content: "Подскажите сценарий покупки." }
      ],
      conversationText: "Бадаевский\nДля себя"
    });

    expect(decision.intent).toBe("clarify_needs");
    expect(decision.handoff_required).toBe(false);
    expect(decision.support_ticket_required).toBe(false);
  });

  it("does not overwrite a valid model reply for a short purpose answer with fallback template text", async () => {
    const service = new AiService(
      {
        values: {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "test-model"
        },
        languageModelApiKey: "test-key",
        languageModelName: "test-model",
        languageModelProvider: "openai",
        languageModelBaseUrl: undefined
      } as never,
      catalog as never
    );

    (service as unknown as { client: unknown }).client = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            intent: "clarify_needs",
            reply_text:
              "Отлично, семейный сценарий понял. Тогда подскажите, какой бюджет комфортен и рассматриваете ли 1-комнатный или 2-комнатный формат?",
            lead_score: 48,
            missing_fields: ["budget", "rooms", "timeline"]
          })
        })
      }
    };

    const decision = await service.decide("Для семьи", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Привет" },
        { role: "assistant", content: "Для чего покупаете?" }
      ],
      conversationText: "Привет\nПокупаю для семьи"
    });

    expect(decision.reply_text).toContain("семейный сценарий понял");
    expect(decision.reply_text).not.toContain("под ваш сценарий");
  });

  it("replaces repeated qualification questions with a summary of known facts and the next missing step", async () => {
    const service = new AiService(
      {
        values: {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "test-model"
        },
        languageModelApiKey: "test-key",
        languageModelName: "test-model",
        languageModelProvider: "openai",
        languageModelBaseUrl: undefined
      } as never,
      catalog as never
    );

    (service as unknown as { client: unknown }).client = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            intent: "clarify_needs",
            reply_text:
              "Если говорим про Бадаевский, подскажите, для какого сценария покупаете и какой бюджет комфортен?",
            lead_score: 47,
            missing_fields: ["budget", "rooms", "timeline"]
          })
        })
      }
    };

    const decision = await service.decide("Для семьи", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Привет" },
        { role: "assistant", content: "Для чего покупаете?" }
      ],
      conversationText: "Привет\nПокупаю для семьи"
    });

    expect(decision.reply_text).toContain("для семьи");
    expect(decision.reply_text).not.toContain("для какого сценария покупаете");
    expect(decision.reply_text).toContain("бюджет");
  });

  it("jumps to shortlist when purpose, budget, rooms and timeline are already known", async () => {
    const service = new AiService(
      {
        values: {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "test-model"
        },
        languageModelApiKey: "test-key",
        languageModelName: "test-model",
        languageModelProvider: "openai",
        languageModelBaseUrl: undefined
      } as never,
      catalog as never
    );

    (service as unknown as { client: unknown }).client = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            intent: "clarify_needs",
            reply_text:
              "Чтобы подобрать точные варианты, уточните, пожалуйста, для чего покупаете и какой бюджет комфортен?",
            lead_score: 61,
            missing_fields: ["purpose", "budget"]
          })
        })
      }
    };

    const decision = await service.decide("80 млн, 2-комнатная, для семьи, 1-3 месяца", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Интересен Бадаевский" },
        { role: "assistant", content: "Расскажите задачу покупки." }
      ],
      conversationText: "Интересен Бадаевский\nПокупаю для семьи\n80 млн\n2-комнатная\n1-3 месяца"
    });

    expect(decision.intent).toBe("unit_recommendation");
    expect(decision.recommended_unit_ids).toEqual(["unit-1"]);
    expect(decision.reply_text.toLowerCase()).toContain("данных уже достаточно");
    expect(decision.missing_fields).toEqual([]);
  });

  it("prefers the latest purpose, budget, rooms and timeline over older turns", async () => {
    const service = new AiService(
      {
        values: {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "test-model"
        },
        languageModelApiKey: "test-key",
        languageModelName: "test-model",
        languageModelProvider: "openai",
        languageModelBaseUrl: undefined
      } as never,
      {
        ...catalog,
        extractRooms: jest.fn((text: string) => {
          const normalized = text.toLowerCase();
          if (normalized.includes("однуш")) {
            return 1;
          }
          if (normalized.includes("2 комнаты") || normalized.includes("2-комнат")) {
            return 2;
          }

          return null;
        })
      } as never
    );

    (service as unknown as { client: unknown }).client = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            intent: "clarify_needs",
            reply_text:
              "Чтобы подобрать точные варианты, уточните, пожалуйста, для чего покупаете и какой бюджет комфортен?",
            lead_score: 61,
            missing_fields: ["purpose", "budget"]
          })
        })
      }
    };

    const decision = await service.decide("Для себя, 80 млн, однушка, на следующей неделе", {
      activeProject: project,
      candidateUnits: [unit],
      knowledgeDocuments: [knowledgeDocument],
      history: [
        { role: "user", content: "Для семьи" },
        { role: "user", content: "40-80 млн" },
        { role: "user", content: "2-комнатная" }
      ],
      conversationText: "Для семьи\n40-80 млн\n2-комнатная\nДля себя, 80 млн, однушка, на следующей неделе"
    });

    expect(decision.intent).toBe("unit_recommendation");
    expect(decision.reply_text).toContain("для себя");
    expect(decision.reply_text).toContain("80");
    expect(decision.reply_text).toContain("1-комнат");
    expect(decision.reply_text).toContain("быстро");
    expect(decision.missing_fields).toEqual([]);
  });
});

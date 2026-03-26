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
    expect(decision.reply_text).toContain("shortlist");
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
});

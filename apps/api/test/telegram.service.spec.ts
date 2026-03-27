import { TelegramService } from "../src/telegram.service";

describe("TelegramService", () => {
  it("creates notification jobs for hot leads", async () => {
    const appendMessage = jest.fn();
    const updateConversationSummary = jest.fn();
    const jobs = {
      enqueueManagerNotification: jest.fn(),
      enqueueKnowledgeEmbedding: jest.fn()
    };
    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-1", metadata: null }),
        appendMessage,
        readConversationState: jest.fn().mockReturnValue(null),
        getHistory: jest.fn().mockResolvedValue([
          { role: "user", content: "Нужен срочный подбор, перезвоните сегодня" }
        ]),
        updateConversationSummary
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue(null),
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue(null),
        decide: jest.fn().mockResolvedValue({
          intent: "handoff_manager",
          reply_text: "Подключаю менеджера.",
          recommended_unit_ids: [],
          lead_score: 90,
          handoff_required: true,
          support_ticket_required: false,
          missing_fields: [],
          policy_flags: ["human_handoff_required"]
        })
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage: jest.fn(),
        sendPhoto: jest.fn()
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue({ id: "lead-1" })
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      jobs as never
    );

    const result = await service.handleIncomingUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Date.now(),
        text: "Нужен срочный подбор, перезвоните сегодня",
        chat: { id: 10, type: "private" },
        from: { id: 20, is_bot: false, first_name: "Иван" }
      }
    });

    expect(result.status).toBe("processed");
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(jobs.enqueueManagerNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "lead",
        leadId: "lead-1",
        leadScore: 90
      })
    );
  });

  it("sends plain text responses without telegram reply keyboards", async () => {
    const sendMessage = jest.fn();
    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-2", metadata: null }),
        appendMessage: jest.fn(),
        readConversationState: jest.fn().mockReturnValue(null),
        getHistory: jest.fn().mockResolvedValue([{ role: "user", content: "Подберите квартиру" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue(null),
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue(null),
        decide: jest.fn().mockResolvedValue({
          intent: "sales_qualification",
          reply_text: "Помогу с подбором. Для чего покупаете?",
          recommended_unit_ids: [],
          lead_score: 42,
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: ["purpose", "budget", "rooms"],
          policy_flags: []
        })
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage,
        sendPhoto: jest.fn()
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    await service.handleIncomingUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: Date.now(),
        text: "Подберите квартиру",
        chat: { id: 20, type: "private" },
        from: { id: 30, is_bot: false, first_name: "Анна" }
      }
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.any(String)
      })
    );
    expect(sendMessage.mock.calls[0][0].replyMarkup).toBeUndefined();
  });

  it("ignores duplicate telegram updates with the same update_id", async () => {
    const sendMessage = jest.fn();
    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-dup", metadata: null }),
        appendMessage: jest.fn(),
        readConversationState: jest.fn().mockReturnValue(null),
        getHistory: jest.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue(null),
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue(null),
        decide: jest.fn().mockResolvedValue({
          intent: "sales_qualification",
          reply_text: "Здравствуйте! Для чего покупаете?",
          recommended_unit_ids: [],
          lead_score: 40,
          handoff_required: false,
          support_ticket_required: false,
          missing_fields: ["purpose"],
          policy_flags: []
        })
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage,
        sendPhoto: jest.fn()
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    const update = {
      update_id: 99,
      message: {
        message_id: 99,
        date: Date.now(),
        text: "Привет",
        chat: { id: 99, type: "private" },
        from: { id: 199, is_bot: false, first_name: "Нина" }
      }
    };

    await service.handleIncomingUpdate(update);
    await service.handleIncomingUpdate(update);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("builds catalog context from conversation history, not just the latest quick reply", async () => {
    const getRelevantProject = jest.fn().mockResolvedValue(null);
    const findCandidateUnitsForState = jest.fn().mockResolvedValue([]);
    const getRelevantDocuments = jest.fn().mockResolvedValue([]);
    const sendMessage = jest.fn();
    const derivedState = {
      purpose: "investment",
      budgetRub: 20000000,
      rooms: null,
      timeline: null,
      hasPhone: false,
      activeProjectId: null,
      activeProjectName: null,
      lastUserMessage: "Бюджет до 20 млн",
      updatedAt: new Date().toISOString()
    };
    const decide = jest.fn().mockResolvedValue({
      intent: "clarify_needs",
      reply_text: "Уточню еще пару деталей.",
      recommended_unit_ids: [],
      lead_score: 40,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: ["rooms", "timeline"],
      policy_flags: []
    });

    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-3", metadata: null }),
        appendMessage: jest.fn(),
        readConversationState: jest.fn().mockReturnValue(null),
        getHistory: jest.fn().mockResolvedValue([
          { role: "user", content: "Интересен Бадаевский" },
          { role: "assistant", content: "Для чего рассматриваете покупку?" },
          { role: "user", content: "Для инвестиций" },
          { role: "user", content: "До 20 млн" }
        ]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue(null),
        getRelevantProject,
        findCandidateUnitsForState,
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(20000000),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue(derivedState),
        decide
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage,
        sendPhoto: jest.fn()
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    await service.handleIncomingUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: Date.now(),
        text: "До 20 млн",
        chat: { id: 30, type: "private" },
        from: { id: 40, is_bot: false, first_name: "Олег" }
      }
    });

    expect(getRelevantProject).toHaveBeenCalledWith(expect.stringContaining("Бадаевский"));
    expect(findCandidateUnitsForState).toHaveBeenCalledWith(derivedState, undefined);
    expect(getRelevantDocuments).toHaveBeenCalledWith(expect.stringContaining("Бюджет до 20 млн"));
    expect(decide).toHaveBeenCalledWith(
      "Бюджет до 20 млн",
      expect.objectContaining({
        conversationText: expect.stringContaining("Бадаевский")
      })
    );
  });

  it("normalizes action button text before sending it into the AI layer", async () => {
    const decide = jest.fn().mockResolvedValue({
      intent: "clarify_needs",
      reply_text: "Покажу лучший вход.",
      recommended_unit_ids: [],
      lead_score: 55,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: ["purpose", "budget"],
      policy_flags: []
    });

    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-5", metadata: null }),
        appendMessage: jest.fn(),
        readConversationState: jest.fn().mockReturnValue(null),
        getHistory: jest
          .fn()
          .mockResolvedValue([{ role: "user", content: "Самый выгодный вход" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue(null),
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue(null),
        decide
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage: jest.fn(),
        sendPhoto: jest.fn()
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    await service.handleIncomingUpdate({
      update_id: 5,
      message: {
        message_id: 5,
        date: Date.now(),
        text: "Самый выгодный вход",
        chat: { id: 50, type: "private" },
        from: { id: 60, is_bot: false, first_name: "Мира" }
      }
    });

    expect(decide).toHaveBeenCalledWith(
      expect.stringContaining("минимальную цену входа"),
      expect.objectContaining({
        conversationText: expect.stringContaining("минимальную цену входа")
      })
    );
  });

  it("answers a referenced lot request directly and sends a floorplan when media is loaded", async () => {
    const sendMessage = jest.fn();
    const sendPhoto = jest.fn();
    const referencedUnit = {
      id: "unit-594",
      projectId: "project-1",
      code: "BAD-1-594-17",
      rooms: 1,
      floor: 17,
      areaSqm: 59.4,
      priceRub: 95590696,
      finishing: "без отделки",
      status: "available",
      availableFrom: null,
      listingUrl: "https://example.com/bad-1-594-17",
      planImageUrls: ["https://example.com/plan-594.jpg"],
      perks: ["панорамные виды"],
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-6", metadata: null }),
        appendMessage: jest.fn(),
        readConversationState: jest.fn().mockReturnValue(null),
        getHistory: jest.fn().mockResolvedValue([{ role: "user", content: "по 594 скинь планировку" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue(null),
        getRelevantProject: jest.fn().mockResolvedValue({ id: "project-1", name: "Бадаевский" }),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(referencedUnit),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue({
          purpose: null,
          budgetRub: null,
          rooms: null,
          timeline: null,
          hasPhone: false
        }),
        decide: jest.fn()
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage,
        sendPhoto
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    await service.handleIncomingUpdate({
      update_id: 6,
      message: {
        message_id: 6,
        date: Date.now(),
        text: "по 594 скинь планировку",
        chat: { id: 60, type: "private" },
        from: { id: 70, is_bot: false, first_name: "Лев" }
      }
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("BAD-1-594-17")
      })
    );
    expect(sendPhoto).toHaveBeenCalledWith({
      chatId: "60",
      photoUrl: "https://example.com/plan-594.jpg",
      caption: "Карточка лота BAD-1-594-17"
    });
  });

  it("resolves 'this apartment' requests to the last recommended unit from conversation state", async () => {
    const sendMessage = jest.fn();
    const sendPhoto = jest.fn();
    const referencedUnit = {
      id: "unit-600",
      projectId: "project-1",
      code: "BAD-1-600-10",
      rooms: 1,
      floor: 10,
      areaSqm: 60,
      priceRub: 84000000,
      finishing: "не указано",
      status: "available",
      availableFrom: null,
      listingUrl: "https://example.com/bad-1-600-10",
      planImageUrls: [
        "https://example.com/bad-1-600-10-preview.jpg",
        "https://example.com/bad-1-600-10-plan.jpg"
      ],
      perks: ["панорамное остекление"],
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const findReferencedUnit = jest.fn().mockResolvedValue(referencedUnit);
    const updateConversationSummary = jest.fn();

    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({
          id: "conv-7",
          metadata: {
            conversation_state: {
              purpose: "investment",
              budgetRub: 80000000,
              rooms: 1,
              timeline: null,
              hasPhone: false,
              activeProjectId: "project-1",
              activeProjectName: "Бадаевский",
              lastRecommendedUnitId: "unit-600",
              lastRecommendedUnitCode: "BAD-1-600-10"
            }
          }
        }),
        appendMessage: jest.fn(),
        readConversationState: jest.fn().mockReturnValue({
          purpose: "investment",
          budgetRub: 80000000,
          rooms: 1,
          timeline: null,
          hasPhone: false,
          activeProjectId: "project-1",
          activeProjectName: "Бадаевский",
          lastRecommendedUnitId: "unit-600",
          lastRecommendedUnitCode: "BAD-1-600-10"
        }),
        getHistory: jest.fn().mockResolvedValue([
          { role: "assistant", content: "Вот лот BAD-1-600-10" },
          { role: "user", content: "Дай мне планировку этой квартиры и всю инфу по ней" }
        ]),
        updateConversationSummary
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue({ id: "project-1", name: "Бадаевский" }),
        getRelevantProject: jest.fn().mockResolvedValue({ id: "project-1", name: "Бадаевский" }),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit,
        getUnitById: jest.fn().mockResolvedValue(referencedUnit),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest.fn().mockReturnValue({
          purpose: "investment",
          budgetRub: 80000000,
          rooms: 1,
          timeline: null,
          hasPhone: false,
          activeProjectId: "project-1",
          activeProjectName: "Бадаевский",
          lastRecommendedUnitId: "unit-600",
          lastRecommendedUnitCode: "BAD-1-600-10"
        }),
        decide: jest.fn()
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage,
        sendPhoto
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    await service.handleIncomingUpdate({
      update_id: 7,
      message: {
        message_id: 7,
        date: Date.now(),
        text: "Дай мне планировку этой квартиры и всю инфу по ней",
        chat: { id: 70, type: "private" },
        from: { id: 80, is_bot: false, first_name: "Ева" }
      }
    });

    expect(findReferencedUnit).toHaveBeenCalledWith(
      "Дай мне планировку этой квартиры и всю инфу по ней",
      "project-1",
      {
        unitId: "unit-600",
        unitCode: "BAD-1-600-10"
      }
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("BAD-1-600-10")
      })
    );
    expect(sendPhoto).toHaveBeenNthCalledWith(1, {
      chatId: "70",
      photoUrl: "https://example.com/bad-1-600-10-preview.jpg",
      caption: "Карточка лота BAD-1-600-10"
    });
    expect(sendPhoto).toHaveBeenNthCalledWith(2, {
      chatId: "70",
      photoUrl: "https://example.com/bad-1-600-10-plan.jpg",
      caption: "Планировка BAD-1-600-10"
    });
    expect(updateConversationSummary).toHaveBeenCalledWith(
      "conv-7",
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({
        conversation_state: expect.objectContaining({
          lastRecommendedUnitId: "unit-600",
          lastRecommendedUnitCode: "BAD-1-600-10"
        })
      })
    );
  });

  it("treats explicit lot code lookup as the active lot for subsequent follow-up requests", async () => {
    const sendMessage = jest.fn();
    const sendPhoto = jest.fn();
    const referencedUnit = {
      id: "unit-600",
      projectId: "project-1",
      code: "BAD-1-600-10",
      rooms: 1,
      floor: 10,
      areaSqm: 60,
      priceRub: 84000000,
      finishing: "не указано",
      status: "available",
      availableFrom: null,
      listingUrl: "https://example.com/bad-1-600-10",
      planImageUrls: [
        "https://example.com/bad-1-600-10-preview.jpg",
        "https://example.com/bad-1-600-10-plan.jpg"
      ],
      perks: ["панорамное остекление"],
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const updateConversationSummary = jest.fn();
    const decide = jest.fn();

    const service = new TelegramService(
      {
        ensureConversation: jest
          .fn()
          .mockResolvedValueOnce({
            id: "conv-8",
            metadata: {
              conversation_state: {
                purpose: "investment",
                budgetRub: 80000000,
                rooms: 1,
                timeline: null,
                hasPhone: false,
                activeProjectId: "project-1",
                activeProjectName: "Бадаевский",
                lastRecommendedUnitId: "unit-473",
                lastRecommendedUnitCode: "BAD-1-473-13"
              }
            }
          })
          .mockResolvedValueOnce({
            id: "conv-8",
            metadata: {
              conversation_state: {
                purpose: "investment",
                budgetRub: 80000000,
                rooms: 1,
                timeline: null,
                hasPhone: false,
                activeProjectId: "project-1",
                activeProjectName: "Бадаевский",
                lastRecommendedUnitId: "unit-600",
                lastRecommendedUnitCode: "BAD-1-600-10"
              }
            }
          }),
        appendMessage: jest.fn(),
        readConversationState: jest
          .fn()
          .mockReturnValueOnce({
            purpose: "investment",
            budgetRub: 80000000,
            rooms: 1,
            timeline: null,
            hasPhone: false,
            activeProjectId: "project-1",
            activeProjectName: "Бадаевский",
            lastRecommendedUnitId: "unit-473",
            lastRecommendedUnitCode: "BAD-1-473-13"
          })
          .mockReturnValueOnce({
            purpose: "investment",
            budgetRub: 80000000,
            rooms: 1,
            timeline: null,
            hasPhone: false,
            activeProjectId: "project-1",
            activeProjectName: "Бадаевский",
            lastRecommendedUnitId: "unit-600",
            lastRecommendedUnitCode: "BAD-1-600-10"
          }),
        getHistory: jest
          .fn()
          .mockResolvedValueOnce([{ role: "user", content: "BAD-1-600-10 есть?" }])
          .mockResolvedValueOnce([
            { role: "assistant", content: "Да, квартира BAD-1-600-10 есть в текущей экспозиции." },
            { role: "user", content: "Дай мне планировку этой квартиры и всю инфу по ней" }
          ]),
        updateConversationSummary
      } as never,
      {
        getProjectById: jest.fn().mockResolvedValue({ id: "project-1", name: "Бадаевский" }),
        getRelevantProject: jest.fn().mockResolvedValue({ id: "project-1", name: "Бадаевский" }),
        findCandidateUnitsForState: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        findReferencedUnit: jest.fn().mockResolvedValue(referencedUnit),
        getUnitById: jest.fn().mockResolvedValue(referencedUnit),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null),
        extractUnitCode: jest
          .fn()
          .mockImplementation((message: string) =>
            message.includes("BAD-1-600-10") ? "BAD-1-600-10" : null
          )
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        deriveConversationState: jest
          .fn()
          .mockReturnValueOnce({
            purpose: "investment",
            budgetRub: 80000000,
            rooms: 1,
            timeline: null,
            hasPhone: false,
            activeProjectId: "project-1",
            activeProjectName: "Бадаевский",
            lastRecommendedUnitId: "unit-473",
            lastRecommendedUnitCode: "BAD-1-473-13"
          })
          .mockReturnValueOnce({
            purpose: "investment",
            budgetRub: 80000000,
            rooms: 1,
            timeline: null,
            hasPhone: false,
            activeProjectId: "project-1",
            activeProjectName: "Бадаевский",
            lastRecommendedUnitId: "unit-600",
            lastRecommendedUnitCode: "BAD-1-600-10"
          }),
        decide
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage,
        sendPhoto
      } as never,
      {
        syncLeadFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        syncTicketFromDecision: jest.fn().mockResolvedValue(null)
      } as never,
      {
        enqueueManagerNotification: jest.fn(),
        enqueueKnowledgeEmbedding: jest.fn()
      } as never
    );

    await service.handleIncomingUpdate({
      update_id: 8,
      message: {
        message_id: 8,
        date: Date.now(),
        text: "BAD-1-600-10 есть?",
        chat: { id: 80, type: "private" },
        from: { id: 90, is_bot: false, first_name: "Ира" }
      }
    });

    await service.handleIncomingUpdate({
      update_id: 9,
      message: {
        message_id: 9,
        date: Date.now(),
        text: "Дай мне планировку этой квартиры и всю инфу по ней",
        chat: { id: 80, type: "private" },
        from: { id: 90, is_bot: false, first_name: "Ира" }
      }
    });

    expect(decide).not.toHaveBeenCalled();
    expect(sendPhoto).toHaveBeenNthCalledWith(1, {
      chatId: "80",
      photoUrl: "https://example.com/bad-1-600-10-preview.jpg",
      caption: "Карточка лота BAD-1-600-10"
    });
    expect(sendPhoto).toHaveBeenNthCalledWith(2, {
      chatId: "80",
      photoUrl: "https://example.com/bad-1-600-10-plan.jpg",
      caption: "Планировка BAD-1-600-10"
    });
    expect(updateConversationSummary).toHaveBeenLastCalledWith(
      "conv-8",
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({
        conversation_state: expect.objectContaining({
          lastRecommendedUnitId: "unit-600",
          lastRecommendedUnitCode: "BAD-1-600-10"
        })
      })
    );
  });
});

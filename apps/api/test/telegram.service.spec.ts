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
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-1" }),
        appendMessage,
        getHistory: jest.fn().mockResolvedValue([
          { role: "user", content: "Нужен срочный подбор, перезвоните сегодня" }
        ]),
        updateConversationSummary
      } as never,
      {
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnits: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
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
        sendMessage: jest.fn()
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
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-2" }),
        appendMessage: jest.fn(),
        getHistory: jest.fn().mockResolvedValue([{ role: "user", content: "Подберите квартиру" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnits: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
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
        sendMessage
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
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-dup" }),
        appendMessage: jest.fn(),
        getHistory: jest.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnits: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
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
        sendMessage
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
    const findCandidateUnits = jest.fn().mockResolvedValue([]);
    const getRelevantDocuments = jest.fn().mockResolvedValue([]);
    const sendMessage = jest.fn();
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
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-3" }),
        appendMessage: jest.fn(),
        getHistory: jest.fn().mockResolvedValue([
          { role: "user", content: "Интересен Бадаевский" },
          { role: "assistant", content: "Для чего рассматриваете покупку?" },
          { role: "user", content: "Для инвестиций" },
          { role: "user", content: "До 20 млн" }
        ]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getRelevantProject,
        findCandidateUnits,
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(20000000),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments
      } as never,
      {
        decide
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage
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
    expect(findCandidateUnits).toHaveBeenCalledWith(
      expect.stringContaining("Покупаю для инвестиций")
    );
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
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-5" }),
        appendMessage: jest.fn(),
        getHistory: jest
          .fn()
          .mockResolvedValue([{ role: "user", content: "Самый выгодный вход" }]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnits: jest.fn().mockResolvedValue([]),
        findProjectEntryUnit: jest.fn().mockResolvedValue(null),
        extractBudget: jest.fn().mockReturnValue(null),
        extractRooms: jest.fn().mockReturnValue(null)
      } as never,
      {
        getRelevantDocuments: jest.fn().mockResolvedValue([])
      } as never,
      {
        decide
      } as never,
      {
        enforce: jest.fn((decision) => decision)
      } as never,
      {
        sendMessage: jest.fn()
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
});

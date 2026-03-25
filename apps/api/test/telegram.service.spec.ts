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
        getHistory: jest.fn().mockResolvedValue([]),
        updateConversationSummary
      } as never,
      {
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnits: jest.fn().mockResolvedValue([]),
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

  it("offers purpose quick replies before generic qualification", async () => {
    const sendMessage = jest.fn();
    const service = new TelegramService(
      {
        ensureConversation: jest.fn().mockResolvedValue({ id: "conv-2" }),
        appendMessage: jest.fn(),
        getHistory: jest.fn().mockResolvedValue([]),
        updateConversationSummary: jest.fn()
      } as never,
      {
        getRelevantProject: jest.fn().mockResolvedValue(null),
        findCandidateUnits: jest.fn().mockResolvedValue([]),
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
        replyMarkup: expect.objectContaining({
          keyboard: [
            [{ text: "Для себя" }, { text: "Для семьи" }],
            [{ text: "Для инвестиций" }, { text: "Для родителей" }]
          ]
        })
      })
    );
  });
});

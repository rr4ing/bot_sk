"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const telegram_service_1 = require("../src/telegram.service");
describe("TelegramService", () => {
    it("creates notification jobs for hot leads", async () => {
        const appendMessage = jest.fn();
        const updateConversationSummary = jest.fn();
        const jobs = {
            enqueueManagerNotification: jest.fn(),
            enqueueKnowledgeEmbedding: jest.fn()
        };
        const service = new telegram_service_1.TelegramService({
            ensureConversation: jest.fn().mockResolvedValue({ id: "conv-1" }),
            appendMessage,
            getHistory: jest.fn().mockResolvedValue([]),
            updateConversationSummary
        }, {
            getActiveProject: jest.fn().mockResolvedValue(null),
            findCandidateUnits: jest.fn().mockResolvedValue([]),
            extractBudget: jest.fn().mockReturnValue(null),
            extractRooms: jest.fn().mockReturnValue(null)
        }, {
            getRelevantDocuments: jest.fn().mockResolvedValue([])
        }, {
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
        }, {
            enforce: jest.fn((decision) => decision)
        }, {
            sendMessage: jest.fn()
        }, {
            syncLeadFromDecision: jest.fn().mockResolvedValue({ id: "lead-1" })
        }, {
            syncTicketFromDecision: jest.fn().mockResolvedValue(null)
        }, jobs);
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
        expect(jobs.enqueueManagerNotification).toHaveBeenCalledWith(expect.objectContaining({
            type: "lead",
            leadId: "lead-1",
            leadScore: 90
        }));
    });
});

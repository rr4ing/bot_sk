import { Injectable, Logger } from "@nestjs/common";
import { LEAD_HOT_THRESHOLD } from "@builderbot/config";
import { TelegramUpdate } from "./types";
import { ConversationService } from "./conversation.service";
import { CatalogService } from "./catalog.service";
import { KnowledgeService } from "./knowledge.service";
import { AiService } from "./ai.service";
import { ResponsePolicyService } from "./response-policy.service";
import { TelegramClient } from "./telegram.client";
import { LeadService } from "./lead.service";
import { SupportService } from "./support.service";
import { JobQueueService } from "./job-queue.service";

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly conversations: ConversationService,
    private readonly catalog: CatalogService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiService,
    private readonly policy: ResponsePolicyService,
    private readonly telegramClient: TelegramClient,
    private readonly leads: LeadService,
    private readonly support: SupportService,
    private readonly jobs: JobQueueService
  ) {}

  async handleIncomingUpdate(update: TelegramUpdate) {
    if (!update.message?.text && !update.message?.contact) {
      return { status: "ignored", reason: "unsupported_update" };
    }

    const conversation = await this.conversations.ensureConversation(update);
    const messageText =
      update.message?.text ??
      `Контакт: ${update.message?.contact?.phone_number ?? "не указан"}`;
    const customerName = [
      update.message?.from?.first_name ?? update.message?.contact?.first_name,
      update.message?.from?.last_name ?? update.message?.contact?.last_name
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const phone = update.message?.contact?.phone_number ?? null;

    await this.conversations.appendMessage(conversation.id, "user", messageText, update);

    const history = await this.conversations.getHistory(conversation.id);
    const conversationText = this.buildDecisionText(history);

    const [activeProject, candidateUnits, knowledgeDocuments] = await Promise.all([
      this.catalog.getRelevantProject(conversationText),
      this.catalog.findCandidateUnits(conversationText),
      this.knowledge.getRelevantDocuments(conversationText)
    ]);

    const decision = await this.ai.decide(messageText, {
      activeProject,
      candidateUnits,
      knowledgeDocuments,
      history,
      conversationText
    });
    const safeDecision = this.policy.enforce(decision, candidateUnits);

    await this.conversations.appendMessage(
      conversation.id,
      "assistant",
      safeDecision.reply_text,
      safeDecision
    );

    await this.conversations.updateConversationSummary(
      conversation.id,
      messageText.slice(0, 240),
      safeDecision.intent,
      safeDecision.lead_score,
      {
        missing_fields: safeDecision.missing_fields,
        policy_flags: safeDecision.policy_flags
      }
    );

    const [lead, supportTicket] = await Promise.all([
      this.leads.syncLeadFromDecision({
        conversationId: conversation.id,
        customerName: customerName || null,
        phone,
        messageText,
        decision: safeDecision
      }),
      this.support.syncTicketFromDecision({
        conversationId: conversation.id,
        customerName: customerName || null,
        phone,
        messageText,
        decision: safeDecision
      })
    ]);

    if (
      lead &&
      (safeDecision.handoff_required || safeDecision.lead_score >= LEAD_HOT_THRESHOLD)
    ) {
      await this.jobs.enqueueManagerNotification({
        type: "lead",
        leadId: lead.id,
        conversationId: conversation.id,
        customerName: customerName || "Неизвестный клиент",
        phone,
        leadScore: safeDecision.lead_score,
        replyPreview: safeDecision.reply_text
      });
    }

    if (supportTicket) {
      await this.jobs.enqueueManagerNotification({
        type: "support_ticket",
        supportTicketId: supportTicket.id,
        conversationId: conversation.id,
        customerName: customerName || "Неизвестный клиент",
        phone,
        topic: supportTicket.topic
      });
    }

    await this.telegramClient.sendMessage({
      chatId: String(update.message?.chat.id),
      text: safeDecision.reply_text,
      replyMarkup: this.buildReplyKeyboard(safeDecision.missing_fields)
    });

    return {
      status: "processed",
      decision: safeDecision
    };
  }

  private buildReplyKeyboard(missingFields: string[]) {
    const orderedFields = ["phone", "purpose", "budget", "rooms", "timeline"] as const;
    const nextField = orderedFields.find((field) => missingFields.includes(field));

    if (nextField === "phone") {
      return {
        keyboard: [
          [{ text: "Отправить контакт", request_contact: true }],
          [{ text: "Напишу номер сообщением" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "purpose") {
      return {
        keyboard: [
          [{ text: "Для себя" }, { text: "Для семьи" }],
          [{ text: "Для инвестиций" }, { text: "Для родителей" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "budget") {
      return {
        keyboard: [
          [{ text: "до 20 млн" }, { text: "20-40 млн" }],
          [{ text: "40-80 млн" }, { text: "80+ млн" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "rooms") {
      return {
        keyboard: [
          [{ text: "Студия" }, { text: "1-комнатная" }],
          [{ text: "2-комнатная" }, { text: "3-комнатная+" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    if (nextField === "timeline") {
      return {
        keyboard: [
          [{ text: "Срочно, до месяца" }, { text: "1-3 месяца" }],
          [{ text: "3-6 месяцев" }, { text: "Пока присматриваюсь" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
    }

    return {
      remove_keyboard: false
    };
  }

  private buildDecisionText(history: Array<{ role: "user" | "assistant"; content: string }>) {
    return history
      .filter((entry) => entry.role === "user")
      .slice(-8)
      .map((entry) => entry.content)
      .join("\n");
  }
}

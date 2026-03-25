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

    const [activeProject, candidateUnits, knowledgeDocuments, history] = await Promise.all([
      this.catalog.getActiveProject(),
      this.catalog.findCandidateUnits(messageText),
      this.knowledge.getRelevantDocuments(messageText),
      this.conversations.getHistory(conversation.id)
    ]);

    const decision = await this.ai.decide(messageText, {
      activeProject,
      candidateUnits,
      knowledgeDocuments,
      history
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
    if (missingFields.includes("budget")) {
      return {
        keyboard: [[{ text: "до 8 млн" }, { text: "8-15 млн" }, { text: "15+ млн" }]],
        resize_keyboard: true
      };
    }

    if (missingFields.includes("rooms")) {
      return {
        keyboard: [[{ text: "Студия" }, { text: "1-комнатная" }, { text: "2-комнатная" }]],
        resize_keyboard: true
      };
    }

    if (missingFields.includes("timeline")) {
      return {
        keyboard: [[{ text: "Покупка в течение месяца" }, { text: "До 3 месяцев" }]],
        resize_keyboard: true
      };
    }

    return {
      remove_keyboard: false
    };
  }
}

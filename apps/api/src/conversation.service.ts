import { Injectable } from "@nestjs/common";
import { MessageRole, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { ConversationState, TelegramUpdate } from "./types";

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  readConversationState(metadata: Prisma.JsonValue | null | undefined): ConversationState | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }

    const rawState = (metadata as Record<string, unknown>).conversation_state;

    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      return null;
    }

    const state = rawState as Record<string, unknown>;

    return {
      purpose:
        state.purpose === "self" ||
        state.purpose === "family" ||
        state.purpose === "investment" ||
        state.purpose === "parents"
          ? state.purpose
          : null,
      budgetRub: typeof state.budgetRub === "number" ? state.budgetRub : null,
      rooms: typeof state.rooms === "number" ? state.rooms : null,
      timeline:
        state.timeline === "urgent" ||
        state.timeline === "soon" ||
        state.timeline === "later"
          ? state.timeline
          : null,
      hasPhone: Boolean(state.hasPhone),
      activeProjectId: typeof state.activeProjectId === "string" ? state.activeProjectId : null,
      activeProjectName: typeof state.activeProjectName === "string" ? state.activeProjectName : null,
      lastRecommendedUnitId:
        typeof state.lastRecommendedUnitId === "string" ? state.lastRecommendedUnitId : null,
      lastRecommendedUnitCode:
        typeof state.lastRecommendedUnitCode === "string" ? state.lastRecommendedUnitCode : null,
      lastUserMessage: typeof state.lastUserMessage === "string" ? state.lastUserMessage : null,
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null
    };
  }

  async ensureConversation(update: TelegramUpdate) {
    const message = update.message;
    if (!message) {
      throw new Error("Telegram update without message cannot open conversation");
    }

    return this.prisma.conversation.upsert({
      where: {
        telegramChatId: String(message.chat.id)
      },
      update: {
        telegramUserId: message.from ? String(message.from.id) : undefined,
        telegramUsername: message.from?.username,
        firstName: message.from?.first_name ?? message.contact?.first_name,
        lastName: message.from?.last_name ?? message.contact?.last_name
      },
      create: {
        telegramChatId: String(message.chat.id),
        telegramUserId: message.from ? String(message.from.id) : undefined,
        telegramUsername: message.from?.username,
        firstName: message.from?.first_name ?? message.contact?.first_name,
        lastName: message.from?.last_name ?? message.contact?.last_name
      }
    });
  }

  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    rawPayload?: unknown
  ) {
    return this.prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        rawPayload: rawPayload as Prisma.InputJsonValue | undefined
      }
    });
  }

  async getHistory(conversationId: string) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 12
    });

    return messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      })) as Array<{ role: "user" | "assistant"; content: string }>;
  }

  async updateConversationSummary(
    conversationId: string,
    summary: string,
    latestIntent: string,
    leadScore: number,
    metadata?: Record<string, unknown>
  ) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        summary,
        latestIntent,
        leadScore,
        metadata: metadata as Prisma.InputJsonValue | undefined
      }
    });
  }
}

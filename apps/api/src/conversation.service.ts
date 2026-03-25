import { Injectable } from "@nestjs/common";
import { MessageRole, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { TelegramUpdate } from "./types";

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

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

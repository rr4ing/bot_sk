import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES } from "@builderbot/config";
import { EnvService } from "./env";
import { TelegramClient } from "./telegram.client";
import { PrismaService } from "./prisma.service";
import OpenAI from "openai";

@Injectable()
export class JobQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly connection?: IORedis;
  private readonly managerNotifications?: Queue;
  private readonly knowledgeEmbeddings?: Queue;
  private readonly openai: OpenAI | null;

  constructor(
    private readonly env: EnvService,
    private readonly telegramClient: TelegramClient,
    private readonly prisma: PrismaService
  ) {
    this.openai = this.env.values.OPENAI_API_KEY
      ? new OpenAI({ apiKey: this.env.values.OPENAI_API_KEY })
      : null;

    if (this.env.values.QUEUE_MODE === "redis" && this.env.values.REDIS_URL) {
      this.connection = new IORedis(this.env.values.REDIS_URL, {
        maxRetriesPerRequest: null
      });
      this.managerNotifications = new Queue(QUEUE_NAMES.managerNotifications, {
        connection: this.connection
      });
      this.knowledgeEmbeddings = new Queue(QUEUE_NAMES.knowledgeEmbeddings, {
        connection: this.connection
      });
    } else {
      this.logger.log("JobQueueService is running in inline mode");
    }
  }

  async enqueueManagerNotification(payload: Record<string, unknown>) {
    if (this.env.values.QUEUE_MODE === "inline" || !this.managerNotifications) {
      await this.sendManagerNotification(payload);
      return;
    }

    try {
      await this.managerNotifications.add("notify-manager", payload, {
        removeOnComplete: 100,
        removeOnFail: 100
      });
    } catch (error) {
      this.logger.error("Failed to enqueue manager notification", error as Error);
    }
  }

  async enqueueKnowledgeEmbedding(documentId: string) {
    if (this.env.values.QUEUE_MODE === "inline" || !this.knowledgeEmbeddings) {
      await this.embedKnowledgeDocument(documentId);
      return;
    }

    try {
      await this.knowledgeEmbeddings.add(
        "embed-document",
        { documentId },
        {
          removeOnComplete: 100,
          removeOnFail: 100
        }
      );
    } catch (error) {
      this.logger.error("Failed to enqueue knowledge embedding", error as Error);
    }
  }

  private async sendManagerNotification(payload: Record<string, unknown>) {
    if (!this.env.values.TELEGRAM_MANAGER_CHAT_ID) {
      this.logger.warn("TELEGRAM_MANAGER_CHAT_ID is not configured, manager notification skipped");
      return;
    }

    const text =
      payload.type === "support_ticket"
        ? `Новый support ticket\nКлиент: ${payload.customerName}\nТема: ${payload.topic}\nConversation: ${payload.conversationId}`
        : `Новый hot lead\nКлиент: ${payload.customerName}\nScore: ${payload.leadScore}\nConversation: ${payload.conversationId}`;

    await this.telegramClient.sendMessage({
      chatId: this.env.values.TELEGRAM_MANAGER_CHAT_ID,
      text
    });
  }

  private async embedKnowledgeDocument(documentId: string) {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return;
    }

    try {
      const embedding = await this.createEmbedding(document.body);
      await this.prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          embedding,
          embeddingStatus: "ready"
        }
      });
    } catch (error) {
      await this.prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          embeddingStatus: "failed"
        }
      });
      this.logger.error("Inline embedding failed", error as Error);
    }
  }

  private fallbackEmbedding(text: string) {
    const vector = new Array(12).fill(0);
    for (const [index, char] of Array.from(text).entries()) {
      vector[index % vector.length] += char.charCodeAt(0) / 1000;
    }
    return vector.map((value) => Number(value.toFixed(6)));
  }

  private async createEmbedding(text: string) {
    if (!this.openai) {
      return this.fallbackEmbedding(text);
    }

    const response = await this.openai.embeddings.create({
      model: this.env.values.OPENAI_EMBEDDING_MODEL,
      input: text.slice(0, 8000)
    });

    return response.data[0]?.embedding ?? this.fallbackEmbedding(text);
  }

  async onModuleDestroy() {
    const tasks: Array<Promise<unknown>> = [];

    if (this.managerNotifications) {
      tasks.push(this.managerNotifications.close());
    }

    if (this.knowledgeEmbeddings) {
      tasks.push(this.knowledgeEmbeddings.close());
    }

    if (this.connection) {
      tasks.push(this.connection.quit());
    }

    await Promise.all(tasks);
  }
}

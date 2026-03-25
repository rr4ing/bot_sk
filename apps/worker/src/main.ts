import { PrismaClient } from "@prisma/client";
import { QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import OpenAI from "openai";
import { z } from "zod";
import { QUEUE_NAMES } from "@builderbot/config";

const envSchema = z.object({
  REDIS_URL: z.string().default("redis://localhost:6379"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MANAGER_CHAT_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small")
});

const env = envSchema.parse(process.env);
const prisma = new PrismaClient();
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

async function sendManagerNotification(payload: Record<string, unknown>) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_MANAGER_CHAT_ID) {
    console.log("manager notification skipped", payload);
    return;
  }

  const text =
    payload.type === "support_ticket"
      ? `Новый support ticket\nКлиент: ${payload.customerName}\nТема: ${payload.topic}\nConversation: ${payload.conversationId}`
      : `Новый hot lead\nКлиент: ${payload.customerName}\nScore: ${payload.leadScore}\nConversation: ${payload.conversationId}`;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_MANAGER_CHAT_ID,
      text
    })
  });
}

function fallbackEmbedding(text: string) {
  const vector = new Array(12).fill(0);
  for (const [index, char] of Array.from(text).entries()) {
    vector[index % vector.length] += char.charCodeAt(0) / 1000;
  }
  return vector.map((value) => Number(value.toFixed(6)));
}

async function createEmbedding(text: string) {
  if (!openai) {
    return fallbackEmbedding(text);
  }

  const response = await openai.embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: text.slice(0, 8000)
  });

  return response.data[0]?.embedding ?? fallbackEmbedding(text);
}

const managerWorker = new Worker(
  QUEUE_NAMES.managerNotifications,
  async (job) => {
    await sendManagerNotification(job.data as Record<string, unknown>);
  },
  { connection }
);

const knowledgeWorker = new Worker(
  QUEUE_NAMES.knowledgeEmbeddings,
  async (job) => {
    const data = job.data as { documentId: string };
    const document = await prisma.knowledgeDocument.findUnique({
      where: { id: data.documentId }
    });

    if (!document) {
      return;
    }

    try {
      const embedding = await createEmbedding(document.body);
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          embedding,
          embeddingStatus: "ready"
        }
      });
    } catch (error) {
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          embeddingStatus: "failed"
        }
      });
      throw error;
    }
  },
  { connection }
);

new QueueEvents(QUEUE_NAMES.managerNotifications, { connection });
new QueueEvents(QUEUE_NAMES.knowledgeEmbeddings, { connection });

managerWorker.on("completed", (job) => {
  console.log(`manager notification job completed: ${job.id}`);
});

knowledgeWorker.on("completed", (job) => {
  console.log(`knowledge embedding job completed: ${job.id}`);
});

process.on("SIGINT", async () => {
  await Promise.all([
    managerWorker.close(),
    knowledgeWorker.close(),
    prisma.$disconnect(),
    connection.quit()
  ]);
  process.exit(0);
});

console.log("Worker is listening for background jobs");

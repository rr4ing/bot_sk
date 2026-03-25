import { Injectable } from "@nestjs/common";
import { KnowledgeDocumentKind } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { JobQueueService } from "./job-queue.service";
import { z } from "zod";

const knowledgeInputSchema = z.object({
  title: z.string().min(3),
  kind: z.nativeEnum(KnowledgeDocumentKind),
  tags: z.array(z.string()).default([]),
  body: z.string().min(20),
  excerpt: z.string().min(10),
  sourcePath: z.string().optional()
});

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService
  ) {}

  async listDocuments() {
    return this.prisma.knowledgeDocument.findMany({
      orderBy: { updatedAt: "desc" }
    });
  }

  async createDocument(payload: unknown) {
    const input = knowledgeInputSchema.parse(payload);
    const document = await this.prisma.knowledgeDocument.create({
      data: {
        ...input,
        embeddingStatus: "pending"
      }
    });

    await this.jobs.enqueueKnowledgeEmbedding(document.id);
    return document;
  }

  async getRelevantDocuments(messageText: string) {
    const tokens = Array.from(
      new Set(
        messageText
          .toLowerCase()
          .split(/[^a-zа-я0-9]+/i)
          .filter((token) => token.length > 3)
      )
    );

    const docs = await this.prisma.knowledgeDocument.findMany({
      orderBy: { updatedAt: "desc" },
      take: 12
    });

    return docs
      .map((doc) => {
        const haystack = `${doc.title} ${doc.tags.join(" ")} ${doc.body}`.toLowerCase();
        const score = tokens.reduce(
          (acc, token) => acc + (haystack.includes(token) ? 1 : 0),
          0
        );

        return { doc, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((entry) => entry.doc);
  }
}

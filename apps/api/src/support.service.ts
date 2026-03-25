import { Injectable } from "@nestjs/common";
import type { AIDecision } from "@builderbot/domain";
import { PrismaService } from "./prisma.service";
import { z } from "zod";

const supportTicketInputSchema = z.object({
  conversationId: z.string().min(1),
  customerName: z.string().optional(),
  phone: z.string().optional(),
  topic: z.string().min(3),
  summary: z.string().min(10),
  assignedManager: z.string().optional()
});

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async listTickets() {
    return this.prisma.supportTicket.findMany({
      include: { conversation: true },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });
  }

  async createTicket(payload: unknown) {
    const input = supportTicketInputSchema.parse(payload);

    return this.prisma.supportTicket.create({
      data: input
    });
  }

  async syncTicketFromDecision(params: {
    conversationId: string;
    customerName?: string | null;
    phone?: string | null;
    messageText: string;
    decision: AIDecision;
  }) {
    const { conversationId, customerName, phone, messageText, decision } = params;

    if (!decision.support_ticket_required) {
      return null;
    }

    return this.prisma.supportTicket.create({
      data: {
        conversationId,
        customerName: customerName ?? undefined,
        phone: phone ?? undefined,
        topic: decision.intent === "support_ticket" ? "Требуется поддержка" : "Сложный кейс",
        summary: messageText.slice(0, 1000),
        latestAiDecision: decision
      }
    });
  }
}

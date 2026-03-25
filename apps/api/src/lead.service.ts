import { Injectable } from "@nestjs/common";
import { LEAD_HOT_THRESHOLD } from "@builderbot/config";
import type { AIDecision } from "@builderbot/domain";
import { PrismaService } from "./prisma.service";

@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService) {}

  async listLeads() {
    return this.prisma.lead.findMany({
      include: { conversation: true },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });
  }

  async syncLeadFromDecision(params: {
    conversationId: string;
    customerName?: string | null;
    phone?: string | null;
    messageText: string;
    decision: AIDecision;
  }) {
    const { conversationId, customerName, phone, messageText, decision } = params;

    if (
      ![
        "sales_qualification",
        "unit_recommendation",
        "handoff_manager",
        "clarify_needs"
      ].includes(decision.intent) &&
      !decision.handoff_required
    ) {
      return null;
    }

    const status =
      decision.lead_score >= LEAD_HOT_THRESHOLD
        ? "qualified"
        : decision.handoff_required
          ? "assigned"
          : "new";

    return this.prisma.lead.upsert({
      where: { conversationId },
      update: {
        fullName: customerName ?? undefined,
        phone: phone ?? undefined,
        summary: messageText.slice(0, 1000),
        intent: decision.intent,
        leadScore: decision.lead_score,
        status,
        lastAiDecision: decision
      },
      create: {
        conversationId,
        fullName: customerName ?? undefined,
        phone: phone ?? undefined,
        summary: messageText.slice(0, 1000),
        intent: decision.intent,
        leadScore: decision.lead_score,
        status,
        lastAiDecision: decision
      }
    });
  }

  async assignLead(id: string, payload: { managerName: string; managerChat?: string }) {
    return this.prisma.lead.update({
      where: { id },
      data: {
        assignedManagerName: payload.managerName,
        assignedManagerChat: payload.managerChat,
        status: "assigned"
      }
    });
  }
}

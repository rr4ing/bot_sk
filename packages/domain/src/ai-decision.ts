import { z } from "zod";

export const intentSchema = z.enum([
  "sales_qualification",
  "unit_recommendation",
  "support_answer",
  "support_ticket",
  "handoff_manager",
  "clarify_needs"
]);

export const missingFieldSchema = z.enum([
  "budget",
  "rooms",
  "timeline",
  "purpose",
  "location",
  "phone",
  "name"
]);

export const policyFlagSchema = z.enum([
  "price_unverified",
  "availability_unverified",
  "legal_review_required",
  "discount_out_of_policy",
  "negative_sentiment",
  "human_handoff_required"
]);

export const aiDecisionSchema = z.object({
  intent: intentSchema,
  reply_text: z.string().min(1).max(4000),
  recommended_unit_ids: z.array(z.string()).max(3).default([]),
  lead_score: z.number().int().min(0).max(100),
  handoff_required: z.boolean(),
  support_ticket_required: z.boolean(),
  missing_fields: z.array(missingFieldSchema).default([]),
  policy_flags: z.array(policyFlagSchema).default([])
});

export type AIDecision = z.infer<typeof aiDecisionSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type MissingField = z.infer<typeof missingFieldSchema>;
export type PolicyFlag = z.infer<typeof policyFlagSchema>;

export const LEAD_SCORE_BANDS = {
  cold: { min: 0, max: 39 },
  warm: { min: 40, max: 69 },
  hot: { min: 70, max: 100 }
} as const;

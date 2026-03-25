"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEAD_SCORE_BANDS = exports.aiDecisionSchema = exports.policyFlagSchema = exports.missingFieldSchema = exports.intentSchema = void 0;
const zod_1 = require("zod");
exports.intentSchema = zod_1.z.enum([
    "sales_qualification",
    "unit_recommendation",
    "support_answer",
    "support_ticket",
    "handoff_manager",
    "clarify_needs"
]);
exports.missingFieldSchema = zod_1.z.enum([
    "budget",
    "rooms",
    "timeline",
    "purpose",
    "location",
    "phone",
    "name"
]);
exports.policyFlagSchema = zod_1.z.enum([
    "price_unverified",
    "availability_unverified",
    "legal_review_required",
    "discount_out_of_policy",
    "negative_sentiment",
    "human_handoff_required"
]);
exports.aiDecisionSchema = zod_1.z.object({
    intent: exports.intentSchema,
    reply_text: zod_1.z.string().min(1).max(4000),
    recommended_unit_ids: zod_1.z.array(zod_1.z.string()).max(3).default([]),
    lead_score: zod_1.z.number().int().min(0).max(100),
    handoff_required: zod_1.z.boolean(),
    support_ticket_required: zod_1.z.boolean(),
    missing_fields: zod_1.z.array(exports.missingFieldSchema).default([]),
    policy_flags: zod_1.z.array(exports.policyFlagSchema).default([])
});
exports.LEAD_SCORE_BANDS = {
    cold: { min: 0, max: 39 },
    warm: { min: 40, max: 69 },
    hot: { min: 70, max: 100 }
};

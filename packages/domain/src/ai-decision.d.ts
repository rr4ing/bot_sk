import { z } from "zod";
export declare const intentSchema: z.ZodEnum<["sales_qualification", "unit_recommendation", "support_answer", "support_ticket", "handoff_manager", "clarify_needs"]>;
export declare const missingFieldSchema: z.ZodEnum<["budget", "rooms", "timeline", "purpose", "location", "phone", "name"]>;
export declare const policyFlagSchema: z.ZodEnum<["price_unverified", "availability_unverified", "legal_review_required", "discount_out_of_policy", "negative_sentiment", "human_handoff_required"]>;
export declare const aiDecisionSchema: z.ZodObject<{
    intent: z.ZodEnum<["sales_qualification", "unit_recommendation", "support_answer", "support_ticket", "handoff_manager", "clarify_needs"]>;
    reply_text: z.ZodString;
    recommended_unit_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    lead_score: z.ZodNumber;
    handoff_required: z.ZodBoolean;
    support_ticket_required: z.ZodBoolean;
    missing_fields: z.ZodDefault<z.ZodArray<z.ZodEnum<["budget", "rooms", "timeline", "purpose", "location", "phone", "name"]>, "many">>;
    policy_flags: z.ZodDefault<z.ZodArray<z.ZodEnum<["price_unverified", "availability_unverified", "legal_review_required", "discount_out_of_policy", "negative_sentiment", "human_handoff_required"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    intent: "sales_qualification" | "unit_recommendation" | "support_answer" | "support_ticket" | "handoff_manager" | "clarify_needs";
    reply_text: string;
    recommended_unit_ids: string[];
    lead_score: number;
    handoff_required: boolean;
    support_ticket_required: boolean;
    missing_fields: ("name" | "rooms" | "budget" | "timeline" | "purpose" | "location" | "phone")[];
    policy_flags: ("price_unverified" | "availability_unverified" | "legal_review_required" | "discount_out_of_policy" | "negative_sentiment" | "human_handoff_required")[];
}, {
    intent: "sales_qualification" | "unit_recommendation" | "support_answer" | "support_ticket" | "handoff_manager" | "clarify_needs";
    reply_text: string;
    lead_score: number;
    handoff_required: boolean;
    support_ticket_required: boolean;
    recommended_unit_ids?: string[] | undefined;
    missing_fields?: ("name" | "rooms" | "budget" | "timeline" | "purpose" | "location" | "phone")[] | undefined;
    policy_flags?: ("price_unverified" | "availability_unverified" | "legal_review_required" | "discount_out_of_policy" | "negative_sentiment" | "human_handoff_required")[] | undefined;
}>;
export type AIDecision = z.infer<typeof aiDecisionSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type MissingField = z.infer<typeof missingFieldSchema>;
export type PolicyFlag = z.infer<typeof policyFlagSchema>;
export declare const LEAD_SCORE_BANDS: {
    readonly cold: {
        readonly min: 0;
        readonly max: 39;
    };
    readonly warm: {
        readonly min: 40;
        readonly max: 69;
    };
    readonly hot: {
        readonly min: 70;
        readonly max: 100;
    };
};

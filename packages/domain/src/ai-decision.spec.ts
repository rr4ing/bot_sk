import { aiDecisionSchema } from "./ai-decision";

describe("aiDecisionSchema", () => {
  it("accepts a valid decision contract", () => {
    const parsed = aiDecisionSchema.parse({
      intent: "sales_qualification",
      reply_text: "Подберу варианты. Подскажите, пожалуйста, ваш ориентир по бюджету.",
      recommended_unit_ids: ["unit-1"],
      lead_score: 55,
      handoff_required: false,
      support_ticket_required: false,
      missing_fields: ["budget", "timeline"],
      policy_flags: []
    });

    expect(parsed.intent).toBe("sales_qualification");
  });

  it("rejects oversized recommendations", () => {
    expect(() =>
      aiDecisionSchema.parse({
        intent: "unit_recommendation",
        reply_text: "Текст",
        recommended_unit_ids: ["1", "2", "3", "4"],
        lead_score: 60,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: []
      })
    ).toThrow();
  });
});

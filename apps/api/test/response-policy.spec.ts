import { ResponsePolicyService } from "../src/response-policy.service";

describe("ResponsePolicyService", () => {
  const service = new ResponsePolicyService();

  it("filters unknown units and forces handoff", () => {
    const result = service.enforce(
      {
        intent: "unit_recommendation",
        reply_text: "Вот варианты.",
        recommended_unit_ids: ["unit-1", "missing-unit"],
        lead_score: 88,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: [],
        policy_flags: []
      },
      [
        {
          id: "unit-1",
          code: "A-101",
          rooms: 1,
          floor: 10,
          areaSqm: 40,
          priceRub: 12000000,
          finishing: "white box",
          perks: [],
          status: "available"
        }
      ] as never
    );

    expect(result.recommended_unit_ids).toEqual(["unit-1"]);
    expect(result.handoff_required).toBe(true);
    expect(result.policy_flags).toContain("availability_unverified");
  });

  it("does not append catalog previews during qualification replies", () => {
    const result = service.enforce(
      {
        intent: "sales_qualification",
        reply_text: "Сначала уточню сценарий покупки.",
        recommended_unit_ids: ["unit-1"],
        lead_score: 52,
        handoff_required: false,
        support_ticket_required: false,
        missing_fields: ["purpose", "timeline"],
        policy_flags: []
      },
      [
        {
          id: "unit-1",
          code: "BAD-1-473-13",
          rooms: 1,
          floor: 13,
          areaSqm: 47.3,
          priceRub: 75080952,
          finishing: "без отделки",
          perks: [],
          status: "available"
        }
      ] as never
    );

    expect(result.recommended_unit_ids).toEqual([]);
    expect(result.reply_text).toBe("Сначала уточню сценарий покупки.");
  });
});

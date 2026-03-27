import { Injectable } from "@nestjs/common";
import { DISALLOWED_PROMISES, type AIDecision, aiDecisionSchema } from "@builderbot/domain";
import { Unit } from "@prisma/client";

@Injectable()
export class ResponsePolicyService {
  enforce(decision: AIDecision, candidateUnits: Unit[]) {
    const filteredUnits = candidateUnits
      .filter((unit) => decision.recommended_unit_ids.includes(unit.id))
      .slice(0, 3);

    const lowerReply = decision.reply_text.toLowerCase();
    const policyFlags = new Set(decision.policy_flags);
    let replyText = decision.reply_text.trim();
    let handoffRequired = decision.handoff_required;
    const isSpecificLotReply = /^по лоту\s/i.test(replyText);
    const allowCatalogPreview =
      decision.intent === "unit_recommendation" ||
      (decision.intent === "handoff_manager" && decision.handoff_required);

    if (decision.recommended_unit_ids.length !== filteredUnits.length) {
      policyFlags.add("availability_unverified");
    }

    if (DISALLOWED_PROMISES.some((phrase) => lowerReply.includes(phrase))) {
      policyFlags.add("legal_review_required");
      handoffRequired = true;
      replyText =
        "Я помогу сориентироваться по вариантам и условиям, но точные юридические обещания и индивидуальные условия подтвердит менеджер.";
    }

    if (filteredUnits.length === 0 && decision.intent === "unit_recommendation") {
      policyFlags.add("availability_unverified");
      handoffRequired = true;
    }

    if (!allowCatalogPreview && filteredUnits.length > 0) {
      return aiDecisionSchema.parse({
        ...decision,
        reply_text: replyText,
        recommended_unit_ids: [],
        handoff_required: handoffRequired,
        policy_flags: Array.from(policyFlags)
      });
    }

    if (filteredUnits.length > 0 && !isSpecificLotReply) {
      const unitPreview = filteredUnits
        .map(
          (unit) =>
            `• ${unit.code}: ${unit.rooms === 0 ? "студия" : `${unit.rooms}-комн.`}, ${unit.areaSqm} м², ${new Intl.NumberFormat("ru-RU").format(unit.priceRub)} ₽`
        )
        .join("\n");

      replyText = `${replyText}\n\nАктуальные варианты из текущего каталога:\n${unitPreview}\n\nТочную цену и доступность подтверждаем на момент обращения.`;
    }

    return aiDecisionSchema.parse({
      ...decision,
      reply_text: replyText,
      recommended_unit_ids: filteredUnits.map((unit) => unit.id),
      handoff_required: handoffRequired,
      policy_flags: Array.from(policyFlags)
    });
  }
}

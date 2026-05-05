import type {
  Classification,
  ExtractedIntake,
  InboxItem,
} from "../types.js";
import type { TriageDecision } from "./model.js";
import { searchableText } from "./text.js";

export function classifyItem(
  item: InboxItem,
  extracted: ExtractedIntake,
): TriageDecision {
  const text = searchableText(item);

  if (hasSafeguardingSignal(text)) {
    return { classification: "safeguarding", urgency: "P0" };
  }

  if (looksLikeSpam(text)) {
    return { classification: "spam", urgency: "P3" };
  }

  if (
    /\b(today'?s?|same[- ]day)\b/i.test(text) &&
    /\b(cancel|cancellation|reschedule|can't make|cannot make|sick|ill|threw up|vomit)\b/i.test(
      text,
    )
  ) {
    return { classification: "scheduling", urgency: "P1" };
  }

  if (
    /\b(is it normal|should i|worried|advice|before booking|wait until)\b/i.test(
      text,
    )
  ) {
    return { classification: "clinical_question", urgency: "P2" };
  }

  if (
    /\b(billing|bill|invoice|statement|charged|charge|copay|co-pay|claim|superbill|balance|refund|coverage denied|denied claim|authorization denied|auth denied)\b/i.test(
      text,
    )
  ) {
    return { classification: "billing_question", urgency: "P2" };
  }

  if (
    /\b(complaint|unhappy|upset|frustrated|angry|rude|bad experience|never heard back|no one called|wrong provider|wrong appointment)\b/i.test(
      text,
    )
  ) {
    return { classification: "complaint", urgency: "P2" };
  }

  if (
    /\b(provider follow[- ]?up|doctor follow[- ]?up|following up|checking status|progress note|plan of care|signed eval|signed referral|records request|release of information|ROI)\b/i.test(
      text,
    )
  ) {
    return { classification: "provider_followup", urgency: "P2" };
  }

  if (
    /\b(existing patient|current patient|returning patient|already seen|already a patient|has been seeing|sees (?:an?|our) (?:SLP|OT|PT|therapist))\b/i.test(
      text,
    )
  ) {
    return { classification: "existing_patient_request", urgency: "P2" };
  }

  if (
    /\bincomplete referral\b/i.test(text) ||
    /\[blank\]/i.test(text) ||
    (isReferralLike(item) && missingFieldsFor("new_referral", extracted).length >= 3)
  ) {
    return { classification: "missing_paperwork", urgency: "P2" };
  }

  if (isReferralLike(item)) {
    return { classification: "new_referral", urgency: "P2" };
  }

  return { classification: "other", urgency: "P2" };
}

export function missingFieldsFor(
  classification: Classification,
  extracted: ExtractedIntake,
): string[] {
  const required = requiredFieldsFor(classification);

  const labels: Record<keyof ExtractedIntake, string> = {
    child_name: "child name",
    dob_or_age: "date of birth or age",
    parent_contact: "parent or guardian contact",
    discipline: "requested discipline",
    diagnosis_or_concern: "diagnosis or concern",
    payer: "payer",
    member_id: "member ID",
  };

  return required
    .filter((key) => {
      const value = extracted[key];
      return Array.isArray(value) ? value.length === 0 : !value;
    })
    .map((key) => labels[key]);
}

function requiredFieldsFor(
  classification: Classification,
): Array<keyof ExtractedIntake> {
  switch (classification) {
    case "spam":
      return [];
    case "clinical_question":
    case "safeguarding":
    case "scheduling":
      return ["child_name", "dob_or_age", "parent_contact"];
    case "billing_question":
    case "provider_followup":
    case "complaint":
    case "other":
      return ["child_name", "parent_contact"];
    default:
      return [
        "child_name",
        "dob_or_age",
        "parent_contact",
        "discipline",
        "diagnosis_or_concern",
        "payer",
        "member_id",
      ];
  }
}

function hasSafeguardingSignal(text: string): boolean {
  return /\b(abuse|abused|harm|harmed|unsafe|neglect|neglected|rough with|hit|hitting|hurt|violence)\b/i.test(
    text,
  );
}

function isReferralLike(item: InboxItem): boolean {
  const text = searchableText(item);
  return (
    item.channel === "fax_referral" ||
    /\b(referral|evaluation|eval|therapy openings|evaluate|evaluacion)\b/i.test(text)
  );
}

function looksLikeSpam(text: string): boolean {
  return /\b(unsubscribe|crypto|loan offer|seo|advertising|web design|marketing list)\b/i.test(
    text,
  );
}

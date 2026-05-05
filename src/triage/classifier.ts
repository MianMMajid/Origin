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
    hasSchedulingSignal(text) &&
    (hasSameDaySignal(text) || hasTodayAppointmentSignal(text))
  ) {
    return { classification: "scheduling", urgency: "P1" };
  }

  if (hasSchedulingSignal(text)) {
    return { classification: "scheduling", urgency: "P2" };
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

  if (looksLikeLowPriorityFyi(text)) {
    return { classification: "other", urgency: "P3" };
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
      if (key === "member_id" && isSelfPayPayer(extracted.payer)) {
        return false;
      }

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
  const normalized = text.toLowerCase();

  // Specific caregiver-harm patterns are evaluated before generic negation.
  // Example: "no prior abuse, but dad hit him yesterday" must still be P0.
  if (hasCaregiverHarmSignal(normalized)) {
    return true;
  }

  if (!/\b(abuse|abused|neglect|neglected|violence|unsafe caregiving|maltrato)\b/.test(normalized)) {
    return false;
  }

  return !/\b(no|not|denies|denied)\s+(?:prior\s+)?(abuse|neglect|violence|unsafe|unsafe caregiving)\b/.test(
    normalized,
  );
}

function hasCaregiverHarmSignal(normalizedText: string): boolean {
  return (
    /\b(rough with|left (?:him|her|them|the child)?\s*alone|scared to go home|bruises?|le pega|golpea)\b/.test(
      normalizedText,
    ) ||
    /\b(dad|father|mom|mother|parent|caregiver|guardian|stepdad|stepmom)\b.*\b(hit|hits|hitting|hurt|hurting|scares?|shakes?|shaking)\b/.test(
      normalizedText,
    ) ||
    /\b(hit|hits|hitting|hurt|hurting|scares?|shakes?|shaking)\b.*\b(dad|father|mom|mother|parent|caregiver|guardian|stepdad|stepmom)\b/.test(
      normalizedText,
    )
  );
}

function hasSchedulingSignal(text: string): boolean {
  return /\b(cancel|cancellation|reschedule|can't make|cannot make|can'?t come|move (?:the )?(?:appointment|visit)|running late|late arrival|makeup|make-up|no[- ]?show|sick|ill|threw up|vomit)\b/i.test(
    text,
  );
}

function hasSameDaySignal(text: string): boolean {
  return /\b(today'?s?|same[- ]day|this afternoon|this morning|in \d+ minutes?|in an hour|within the hour)\b/i.test(
    text,
  );
}

function hasTodayAppointmentSignal(text: string): boolean {
  return /\b(?:\d{1,2})(?::\d{2})?\s*(?:am|pm)\b/i.test(text) &&
    !/\b(tomorrow|next week|next month|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\b/i.test(
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

function looksLikeLowPriorityFyi(text: string): boolean {
  const normalized = text.toLowerCase();
  const requestText = normalized.replace(
    /\b(no action needed|no reply needed|does not need a response)\b/g,
    "",
  );

  if (
    !/\b(fyi|for your records|no action needed|no reply needed|does not need a response|just letting you know|just an update|heads up|thank you|thanks|newsletter|community resource|announcement)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  // Keep any item with an implied response, care concern, or operational ask in
  // the P2/P1 lanes. P3 is only for reviewable but clearly low-priority FYIs.
  return !(
    hasActionRequestSignal(requestText) || hasHealthConcernSignal(normalized)
  );
}

function hasActionRequestSignal(normalizedText: string): boolean {
  return /\b(please|can you|could you|would you|need you to|needs you to|requesting|call me|call us|follow up|reply|respond|confirm|schedule|reschedule|cancel|book|send|fax|review|question|help)\b/.test(
    normalizedText,
  );
}

function hasHealthConcernSignal(normalizedText: string): boolean {
  return /\b(pain|hurt|hurts|injury|injured|fell|fall|sick|fever|vomit|threw up|seizure|regress|worse|unsafe|abuse|neglect|hit|rough|concern|worried|not eating|not sleeping)\b/.test(
    normalizedText,
  );
}

function isSelfPayPayer(payer: string | null): boolean {
  return Boolean(
    payer &&
      /\b(self[- ]?pay|private pay|cash pay|no insurance|uninsured)\b/i.test(
        payer,
      ),
  );
}

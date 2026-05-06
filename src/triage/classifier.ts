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

  // Safety beats all other routing signals, including spam-like wording.
  if (hasSafeguardingSignal(text)) {
    return { classification: "safeguarding", urgency: "P0" };
  }

  if (looksLikeSpam(text)) {
    return { classification: "spam", urgency: "P3" };
  }

  if (
    hasSchedulingSignal(text) &&
    hasSameDayAppointmentSignal(text, item.received_at)
  ) {
    return { classification: "scheduling", urgency: "P1" };
  }

  // Routine scheduling should not page/escalate unless it is same-day.
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

  if (hasCompleteReferralIntake(extracted)) {
    return { classification: "new_referral", urgency: "P2" };
  }

  // Missing-paperwork checks come after complete-intake detection so hidden
  // variants without explicit "referral" wording can still route correctly.
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

  // Specific high-risk patterns are evaluated before generic negation so mixed
  // statements like "no prior abuse, but dad hit him" still escalate.
  if (
    hasSelfHarmSignal(normalized) ||
    hasThreatToOthersSignal(normalized) ||
    hasImminentDangerSignal(normalized) ||
    hasMedicalEmergencySignal(normalized) ||
    hasSexualBoundarySignal(normalized) ||
    hasUnsafeHomeSignal(normalized) ||
    hasCaregiverHarmSignal(normalized) ||
    hasAbuseSignal(normalized) ||
    hasNeglectSignal(normalized)
  ) {
    return true;
  }

  if (
    !/\b(abuse|abused|abusive|neglect|neglected|violence|unsafe caregiving|maltrato|abuso)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  return !isNegatedSafetyOnly(normalized);
}

function hasSelfHarmSignal(normalizedText: string): boolean {
  return (
    /\b(suicidal|suicide|self[- ]?harm|self[- ]?injur(?:y|ies|ing)|wants? to die|wants? to hurt (?:himself|herself|themself|themselves|self)|(?:hurt|harm|kill)(?:ing)? (?:himself|herself|themself|themselves|self))\b/.test(
      normalizedText,
    ) ||
    /\b(cutting|cut|cuts|burning|burns?) (?:himself|herself|themself|themselves|self)\b/.test(
      normalizedText,
    ) ||
    /\b(?:himself|herself|themself|themselves|self)\b.*\b(cutting|cut|cuts|burning|burns?)\b/.test(
      normalizedText,
    )
  );
}

function hasThreatToOthersSignal(normalizedText: string): boolean {
  return /\b(?:going to|wants? to|threat(?:ened|ens)? to|said (?:he|she|they) (?:is|are|was|were)?\s*(?:going to|will))\s+(?:hurt|harm|kill|attack)\s+(?:his|her|their|a|the)?\s*(?:sister|brother|sibling|classmate|teacher|parent|mom|mother|dad|father|caregiver|friend|other child|someone)\b/.test(
    normalizedText,
  );
}

function hasImminentDangerSignal(normalizedText: string): boolean {
  return (
    /\b(run|running|ran|bolt|bolting|elope|eloping|elopement)\b.*\b(traffic|street|road|parking lot|highway)\b/.test(
      normalizedText,
    ) ||
    /\b(traffic|street|road|parking lot|highway)\b.*\b(run|running|ran|bolt|bolting|elope|eloping)\b/.test(
      normalizedText,
    )
  );
}

function hasMedicalEmergencySignal(normalizedText: string): boolean {
  const severeEmergency =
    /\b(cannot breathe|can'?t breathe|not breathing|trouble breathing|difficulty breathing|choking|unconscious|blue lips|call 911|called 911|emergency|overdose|swallowed (?:a )?(?:bottle of )?(?:pills|medication|medicine)|took (?:a )?(?:bottle of )?(?:pills|medication|medicine))\b/.test(
      normalizedText,
    );
  const acuteSeizure =
    /\bseizure\b/.test(normalizedText) &&
    /\b(having|currently|right now|just had|today|now)\b/.test(normalizedText);

  return severeEmergency || acuteSeizure;
}

function hasSexualBoundarySignal(normalizedText: string): boolean {
  return /\b(private parts?|inappropriate touching|touched (?:his|her|their) private|touch(?:ed|ing)? (?:him|her|them|my child|my son|my daughter).*(?:private parts?|genitals?)|molest(?:ed|ation)?|sexual assault)\b/.test(
    normalizedText,
  );
}

function hasUnsafeHomeSignal(normalizedText: string): boolean {
  return /\b(not safe at home|unsafe at home|scared to go home|afraid to go home|doesn'?t feel safe|does not feel safe|home is unsafe|unsafe caregiving|unsafe caregiver|caregiver is unsafe|unsafe care)\b/.test(
    normalizedText,
  );
}

function hasCaregiverHarmSignal(normalizedText: string): boolean {
  return (
    /\b(rough with|left (?:him|her|them|the child)?\s*alone|scared to go home|le pega|golpea)\b/.test(
      normalizedText,
    ) ||
    /\b(dad|father|mom|mother|parent|caregiver|guardian|stepdad|stepmom)\b.*\b(hit|hits|hitting|hurt|hurting|scares?|shakes?|shaking)\b/.test(
      normalizedText,
    ) ||
    /\b(hit|hits|hitting|hurt|hurting|scares?|shakes?|shaking)\b.*\b(dad|father|mom|mother|parent|caregiver|guardian|stepdad|stepmom)\b/.test(
      normalizedText,
    ) ||
    /\b(dad|father|mom|mother|parent|caregiver|guardian|stepdad|stepmom)\b.*\bbruises?\b/.test(
      normalizedText,
    ) ||
    /\bbruises?\b.*\b(dad|father|mom|mother|parent|caregiver|guardian|stepdad|stepmom)\b/.test(
      normalizedText,
    )
  );
}

function hasAbuseSignal(normalizedText: string): boolean {
  return (
    /\b(verbal(?:ly)?|emotional(?:ly)?|physical(?:ly)?|sexual(?:ly)?)\s+abus(?:e|ed|ive)\b/.test(
      normalizedText,
    ) ||
    /\b(domestic violence|violence at home|maltrato|abuso)\b/.test(
      normalizedText,
    ) ||
    /\b(?:suspected|possible|ongoing|reported|disclosed|signs? of|risk of|concerns? (?:for|about))\s+(?:\w+\s+){0,3}(?:abuse|neglect|violence|unsafe caregiving)\b/.test(
      normalizedText,
    )
  );
}

function hasNeglectSignal(normalizedText: string): boolean {
  return (
    /\b(ongoing neglect|being neglected|not being fed|not fed|no food|left (?:him|her|them|the child)?\s*alone|unsupervised|caregiver unavailable|no supervision)\b/.test(
      normalizedText,
    ) ||
    /\b(leaves? (?:him|her|them|the child|the toddler)\s+without meals?|without meals?|not getting meals?|missed meals?)\b/.test(
      normalizedText,
    ) ||
    /\b(parent|caregiver|guardian|dad|father|mom|mother)\b.*\b(not feeding|doesn'?t feed|does not feed|leaves? (?:him|her|them|the child)?\s*alone|neglect(?:s|ed|ing)?)\b/.test(
      normalizedText,
    ) ||
    /\b(mom|mother|dad|father|parent|caregiver|guardian)\b.*\b(using drugs|uses drugs|drug use|drunk|intoxicated|substance use|high)\b.*\b(leaves? (?:him|her|them|the child|the toddler)?\s*alone|alone overnight|unsupervised|no supervision)\b/.test(
      normalizedText,
    ) ||
    /\b(leaves? (?:him|her|them|the child|the toddler)?\s*alone|alone overnight|unsupervised|no supervision)\b.*\b(mom|mother|dad|father|parent|caregiver|guardian)\b.*\b(using drugs|uses drugs|drug use|drunk|intoxicated|substance use|high)\b/.test(
      normalizedText,
    )
  );
}

function isNegatedSafetyOnly(normalizedText: string): boolean {
  if (
    /\b(but|however|though|although|yet|except)\b[^.]*\b(abuse|abused|abusive|neglect|neglected|violence|unsafe|hurt|hit|harm|self[- ]?harm|suicide)\b/.test(
      normalizedText,
    )
  ) {
    return false;
  }

  return /\b(no|not|denies|denied|without)\b[^.]{0,60}\b(abuse|neglect|violence|unsafe caregiving|safety concerns?)\b/.test(
    normalizedText,
  );
}

function hasSchedulingSignal(text: string): boolean {
  return /\b(cancel|cancellation|reschedule|can't make|cannot make|can'?t come|move (?:the )?(?:appointment|visit)|running late|late arrival|makeup|make-up|no[- ]?show|sick|ill|threw up|vomit|cancelar|cancela|cancelaci[oó]n|reprogramar|reagendar|cambiar (?:la )?cita|no podemos venir|no puedo venir|no podemos asistir|no puedo asistir|llegaremos tarde|llego tarde|vomit[oó]|enferm[oa])\b/i.test(
    text,
  );
}

function hasSameDaySignal(text: string): boolean {
  return /\b(today'?s?|same[- ]day|this afternoon|this morning|in \d+ minutes?|in an hour|within the hour|hoy|esta tarde|esta ma[nñ]ana|en \d+ minutos?|en una hora)\b/i.test(
    text,
  );
}

function hasSameDayAppointmentSignal(
  text: string,
  receivedAt: string,
): boolean {
  if (hasSameDaySignal(text)) {
    return true;
  }

  if (hasFutureDateSignal(text)) {
    return false;
  }

  const receivedDate = receivedAt.slice(0, 10);
  const explicitDate = explicitAppointmentDate(text, receivedDate);
  if (explicitDate) {
    return explicitDate === receivedDate;
  }

  return hasClockTimeSignal(text);
}

function hasClockTimeSignal(text: string): boolean {
  return /\b(?:\d{1,2})(?::\d{2})?\s*(?:am|pm)\b/i.test(text);
}

function hasFutureDateSignal(text: string): boolean {
  return /\b(tomorrow|next week|next month|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday|ma[nñ]ana|la pr[oó]xima semana|el pr[oó]ximo mes|pr[oó]ximo lunes|pr[oó]ximo martes|pr[oó]ximo mi[eé]rcoles|pr[oó]ximo jueves|pr[oó]ximo viernes|pr[oó]ximo s[aá]bado|pr[oó]ximo domingo)\b/i.test(
    text,
  );
}

function explicitAppointmentDate(
  text: string,
  receivedDate: string,
): string | null {
  const appointmentText = stripDobDates(text);
  const year = Number(receivedDate.slice(0, 4));
  const isoMatch = appointmentText.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return formatDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = appointmentText.match(
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
  );
  if (slashMatch) {
    return formatDate(
      normalizeYear(slashMatch[3], year),
      Number(slashMatch[1]),
      Number(slashMatch[2]),
    );
  }

  const monthMatch = appointmentText.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i,
  );
  if (monthMatch) {
    return formatDate(
      monthMatch[3] ? Number(monthMatch[3]) : year,
      monthNumber(monthMatch[1]),
      Number(monthMatch[2]),
    );
  }

  const weekday = weekdayNumber(appointmentText);
  if (weekday !== null) {
    return weekday === weekdayForDate(receivedDate)
      ? receivedDate
      : "0000-00-00";
  }

  return null;
}

function stripDobDates(text: string): string {
  return text.replace(
    /\b(?:dob|date of birth|born)\s*(?:is|:)?\s*(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)/gi,
    "",
  );
}

function normalizeYear(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return parsed < 100 ? 2000 + parsed : parsed;
}

function monthNumber(month: string): number {
  const normalized = month.toLowerCase().slice(0, 3);
  return (
    [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(normalized) + 1
  );
}

function weekdayNumber(text: string): number | null {
  const checks: Array<[RegExp, number]> = [
    [/\bsunday\b/i, 0],
    [/\bmonday\b/i, 1],
    [/\btuesday\b/i, 2],
    [/\bwednesday\b/i, 3],
    [/\bthursday\b/i, 4],
    [/\bfriday\b/i, 5],
    [/\bsaturday\b/i, 6],
  ];

  for (const [pattern, day] of checks) {
    if (pattern.test(text)) {
      return day;
    }
  }

  return null;
}

function weekdayForDate(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function formatDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function isReferralLike(item: InboxItem): boolean {
  const text = searchableText(item);
  return (
    item.channel === "fax_referral" ||
    /\b(referral|evaluation|eval|therapy openings|evaluate|evaluacion|new patient packet|intake packet|new patient intake|needs? (?:speech|occupational|physical|SLP|OT|PT) therapy)\b/i.test(text)
  );
}

function hasCompleteReferralIntake(extracted: ExtractedIntake): boolean {
  return Boolean(
    extracted.child_name &&
      extracted.dob_or_age &&
      extracted.parent_contact &&
      extracted.discipline?.length &&
      extracted.diagnosis_or_concern &&
      extracted.payer,
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

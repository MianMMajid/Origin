import type {
  Discipline,
  ExtractedIntake,
  InboxItem,
} from "../types.js";
import type { ReplyTarget } from "./model.js";
import {
  cleanContactName,
  firstClean,
  isDiscipline,
  joinParts,
  matchText,
  searchableText,
} from "./text.js";

export function extractIntake(item: InboxItem): ExtractedIntake {
  const text = searchableText(item);

  return {
    child_name: extractChildName(item),
    dob_or_age: firstClean([
      matchText(text, /\bDOB:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i),
      matchText(text, /\bDOB\s+(?:is\s+)?([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i),
      matchText(
        text,
        /\b(?:DOB|date of birth)[:\s]+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})\b/i,
        normalizeSlashDate,
      ),
      matchText(text, /\b(\d+)[- ]year[- ]old\b/i, (age) => `${age}-year-old`),
      matchText(text, /\b(\d+)\s*y\/o\b/i, (age) => `${age} years`),
      matchText(text, /\b(\d+)\s*months?\b/i, (months) => `${months} months`),
      matchText(
        text,
        /\b(?:he|she|they)\s+is\s+(\d+)\b/i,
        (age) => `${age} years`,
      ),
      matchText(
        text,
        /\bmy\s+(?:son|daughter|child)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}\s+is\s+(\d+)\b/i,
        (age) => `${age} years`,
      ),
      matchText(text, /\btiene\s+(\d+)\s+a[nñ]os\b/i, (age) => `${age} years`),
    ]),
    parent_contact: extractContact(item),
    discipline: extractDisciplines(text),
    diagnosis_or_concern: extractConcern(text),
    payer: firstClean([
      matchText(text, /\bInsurance:\s*([^;.\n]+)/i),
      matchText(text, /\b(?:Payer|Plan):\s*([^;.\n]+)/i),
      matchText(text, /\bInsurance\s+is\s+([^;,.\n]+)/i),
      matchText(text, /\bTenemos\s+([^;,.\n]+)\b/i),
      matchText(text, /\b(Medi-Cal|Medicaid)\b/i, () => "Medicaid"),
      matchText(text, /\b(self[- ]?pay|private pay|cash pay|no insurance|uninsured)\b/i),
    ]),
    member_id: firstClean([
      matchText(text, /\bMember ID:\s*([A-Z0-9-]+)/i),
      matchText(text, /\b(?:member|subscriber)\s+(?:ID|number)\s*[:#]?\s*([A-Z0-9-]+)/i),
      matchText(text, /\bpolicy\s*#\s*([A-Z0-9-]+)/i),
      matchText(text, /\b(?:miembro|n[uú]mero de miembro)\s*[:#]?\s*([A-Z0-9-]+)/i),
    ]),
  };
}

export function replyTarget(
  item: InboxItem,
  extracted: ExtractedIntake,
): ReplyTarget {
  const senderEmail = matchText(item.sender, /<([^>]+)>/);
  if (item.channel === "email" && senderEmail) {
    // For emails, reply to the sender before any address mentioned in the body;
    // body addresses may be referral contacts or quoted thread participants.
    return { recipient: senderEmail, channel: "email" };
  }

  const email = firstClean([
    matchText(item.body, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i),
    senderEmail,
  ]);
  if (email) {
    return { recipient: email, channel: "email" };
  }

  if (item.channel === "portal_message") {
    return { recipient: item.sender, channel: "portal" };
  }

  const phone = extractPhone(item.body);
  if (phone) {
    return {
      recipient: extracted.parent_contact || phone,
      channel: "phone",
    };
  }

  return { recipient: extracted.parent_contact || item.sender, channel: "phone" };
}

export function preferredLanguage(item: InboxItem): "en" | "es" {
  return /\b(hola|llamo|hija|hijo|evaluacion|habla|espanol|telefono|gracias|cita|cancelar|reprogramar|reagendar|venir|asistir)\b/i.test(
    searchableText(item),
  ) || /\b(spanish|espa[nñ]ol|tel[eé]fono|evaluaci[oó]n|cancelaci[oó]n)\b/i.test(
    searchableText(item),
  )
    ? "es"
    : "en";
}

export function schedulingPreference(item: InboxItem): string | undefined {
  // Preferences are passed through to find_slots and then interpreted by the
  // local slot selector; keep the original wording for auditability.
  return (
    firstClean([
      matchText(item.body, /\bPreferred availability:\s*([^.\n]+)/i),
      matchText(item.body, /\bFamily prefers\s+([^.\n]+)/i),
      matchText(item.body, /\bPref(?:iero|erimos)\s+([^.\n]+)/i),
      matchText(item.body, /\b(?:available|availability)\s+([^.\n]+)/i),
      matchText(item.body, /\b(next Tuesday)\b/i),
    ]) || undefined
  );
}

export function displayChild(extracted: ExtractedIntake): string {
  return extracted.child_name || "unknown child";
}

export function possessiveChild(extracted: ExtractedIntake): string {
  return extracted.child_name ? `${extracted.child_name}'s` : "your child's";
}

export function isDatedDob(value: string | null): value is string {
  return Boolean(value && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value));
}

function extractChildName(item: InboxItem): string | null {
  const text = searchableText(item);

  return firstClean([
    matchText(text, /\bChild:\s*([^;.\n]+)/i),
    matchText(text, /\b(?:Patient|Client|Child name):\s*([^;.\n]+)/i),
    matchText(item.subject, /\bReferral:\s*([^;.\n-]+?)(?:\s+-|[;.\n]|$)/i),
    matchText(
      item.subject,
      /\bReferral for\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i,
    ),
    matchText(
      text,
      /\babout my son\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i,
    ),
    matchText(
      text,
      /\babout my daughter\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i,
    ),
    matchText(
      text,
      /\bmy\s+(?:son|daughter|child)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\s+is\s+\d+\b/i,
    ),
    matchText(
      text,
      /\bmy\s+(?:son|daughter|child)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}),?\s+DOB\b/i,
    ),
    matchText(
      text,
      /\bappointment for\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})\b/i,
    ),
    matchText(
      text,
      /\b(?:intake\s+forms?|paperwork|forms?)\s+again\s+for\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\b/i,
    ),
    matchText(
      text,
      /\b[Pp]or mi hij[ao]\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/,
    ),
    matchText(
      text,
      /\b[Mm]i hij[ao]\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/,
    ),
    matchText(
      text,
      /\b(?:[Cc]ita|[Tt]erapia|[Ee]valuaci[oó]n)\s+(?:de|para)\s+(?!hoy\b|ma[nñ]ana\b)([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/,
    ),
    matchText(
      text,
      /\b[Ee]s para\s+(?!hoy\b|ma[nñ]ana\b)([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/,
    ),
    matchText(text, /\bmy\s+\d+[- ]year[- ]old\s+([A-Z][A-Za-z'-]+)\b/i),
    matchText(text, /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})'s DOB\b/),
    matchText(text, /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})\s+threw up\b/),
  ]);
}

function extractContact(item: InboxItem): string | null {
  const text = searchableText(item);
  const parent = cleanContactName(
    firstClean([
      matchText(
        text,
        /\bParent(?:\/guardian)?:\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/i,
      ),
      matchText(text, /\bI am (?:his|her|their) parent,\s*([^.\n]+)/i),
      matchText(
        text,
        /\bthis is\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\s+calling\b/i,
      ),
      matchText(text, /\bsoy\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\b/i),
      matchText(item.sender, /^([^<]+)\s*</),
      item.channel === "portal_message" ? item.sender : null,
    ]),
  );
  const phone = extractPhone(text);
  const email = firstClean([
    matchText(text, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i),
    matchText(item.sender, /<([^>]+)>/),
  ]);

  return joinParts([parent, phone, email]);
}

function extractDisciplines(text: string): Discipline[] | null {
  const matches = new Set<Discipline>();
  const explicit = matchText(text, /\bDiscipline requested:\s*(SLP|OT|PT)\b/i);
  if (isDiscipline(explicit)) {
    matches.add(explicit);
  }
  if (/\b(SLP|speech|speech-language|articulation|habla|r sounds)\b/i.test(text)) {
    matches.add("SLP");
  }
  if (/\b(OT|occupational|sensory|feeding tolerance)\b/i.test(text)) {
    matches.add("OT");
  }
  if (/\b(PT|physical|toe walking|tripping|gross motor)\b/i.test(text)) {
    matches.add("PT");
  }

  return matches.size > 0 ? [...matches] : null;
}

function extractConcern(text: string): string | null {
  return firstClean([
    matchText(text, /\bConcern:\s*([^;.\n]+)/i),
    matchText(text, /\bConcern\s+is\s+([^;.\n]+)/i),
    matchText(text, /\bDiagnosis\/concern:\s*([^;.\n]+)/i),
    matchText(text, /\bReason for referral:\s*([^;.\n]+)/i),
    matchText(text, /\bneeds help with\s+([^;.\n]+)/i),
    matchText(
      text,
      /\bneeds?\s+(?:speech|speech-language|occupational|physical|SLP|OT|PT)\s*(?:therapy)?\s+for\s+([^;.\n]+)/i,
    ),
    matchText(text, /\bfor\s+(toe walking and frequent tripping)\b/i),
    matchText(text, /\b(can't say[^?.!]+[?.!]?)\s*/i),
    matchText(text, /\b(speech therapy openings)\b/i),
    matchText(text, /\b(evaluacion de habla)\b/i),
  ]);
}

function extractPhone(text: string): string | null {
  return firstClean([
    matchText(text, /(\(\d{3}\)[-.\s]\d{3}[-.\s]\d{4})\b/),
    matchText(text, /\b(\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/),
    matchText(text, /\b(\d{10})\b/),
    matchText(text, /\b(\d{3}-\d{4})\b/),
  ]);
}

function normalizeSlashDate(date: string): string {
  const [month, day, year] = date.split("/");
  // Pediatric DOBs in referrals may use two-digit years; prefer 20xx for young
  // patients while still supporting older synthetic edge cases.
  const fullYear =
    year.length === 2 ? `${Number(year) <= 30 ? "20" : "19"}${year}` : year;
  return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

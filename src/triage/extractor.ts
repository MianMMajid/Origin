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
      matchText(text, /\b(\d+)[- ]year[- ]old\b/i, (age) => `${age}-year-old`),
      matchText(
        text,
        /\b(?:he|she|they)\s+is\s+(\d+)\b/i,
        (age) => `${age} years`,
      ),
      matchText(text, /\btiene\s+(\d+)\s+anos\b/i, (age) => `${age} years`),
    ]),
    parent_contact: extractContact(item),
    discipline: extractDisciplines(text),
    diagnosis_or_concern: extractConcern(text),
    payer: firstClean([
      matchText(text, /\bInsurance:\s*([^.\n]+)/i),
      matchText(text, /\bInsurance\s+is\s+([^,.\n]+)/i),
      matchText(text, /\bTenemos\s+([^,.\n]+)\b/i),
    ]),
    member_id: firstClean([
      matchText(text, /\bMember ID:\s*([A-Z0-9-]+)/i),
      matchText(text, /\bmember\s+ID\s+([A-Z0-9-]+)/i),
      matchText(text, /\bmiembro\s+([A-Z0-9-]+)/i),
    ]),
  };
}

export function replyTarget(
  item: InboxItem,
  extracted: ExtractedIntake,
): ReplyTarget {
  const email = firstClean([
    matchText(item.body, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i),
    matchText(item.sender, /<([^>]+)>/),
  ]);
  if (email) {
    return { recipient: email, channel: "email" };
  }

  if (item.channel === "portal_message") {
    return { recipient: item.sender, channel: "portal" };
  }

  const phone = matchText(item.body, /\b(\d{3}-\d{4})\b/);
  if (phone) {
    return {
      recipient: extracted.parent_contact || phone,
      channel: "phone",
    };
  }

  return { recipient: extracted.parent_contact || item.sender, channel: "phone" };
}

export function preferredLanguage(item: InboxItem): "en" | "es" {
  return /\b(hola|llamo|hija|hijo|evaluacion|habla|espanol|telefono|gracias)\b/i.test(
    searchableText(item),
  )
    ? "es"
    : "en";
}

export function schedulingPreference(item: InboxItem): string | undefined {
  return (
    firstClean([
      matchText(item.body, /\bPreferred availability:\s*([^.\n]+)/i),
      matchText(item.body, /\bFamily prefers\s+([^.\n]+)/i),
      matchText(item.body, /\bPrefiero\s+([^.\n]+)/i),
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
    matchText(text, /\bChild:\s*([^.\n]+)/i),
    matchText(item.subject, /\bReferral:\s*([^-]+?)(?:\s+-|$)/i),
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
      /\bpor mi hij[ao]\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i,
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
  const phone = matchText(text, /\b(\d{3}-\d{4})\b/);
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
    matchText(text, /\bConcern:\s*([^.\n]+)/i),
    matchText(text, /\bDiagnosis\/concern:\s*([^.\n]+)/i),
    matchText(text, /\bfor\s+(toe walking and frequent tripping)\b/i),
    matchText(text, /\b(can't say[^?.!]+[?.!]?)\s*/i),
    matchText(text, /\b(speech therapy openings)\b/i),
    matchText(text, /\b(evaluacion de habla)\b/i),
  ]);
}

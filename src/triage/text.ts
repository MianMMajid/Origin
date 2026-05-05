import type { Discipline, InboxItem } from "../types.js";

export function searchableText(item: InboxItem): string {
  return `${item.subject}\n${item.body}`;
}

export function matchText(
  text: string,
  pattern: RegExp,
  format?: (value: string) => string,
): string | null {
  const match = text.match(pattern);
  const value = match?.[1];
  return value ? format?.(value) || value : null;
}

export function firstClean(
  values: Array<string | null | undefined>,
): string | null {
  for (const value of values) {
    const cleaned = cleanValue(value);
    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

export function cleanValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\[blank\]/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/[. ]+$/g, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

export function cleanContactName(value: string | null): string | null {
  const cleaned = cleanValue(value)
    ?.replace(/\b\d{3}-\d{4}\b/g, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/,+/g, ",")
    .replace(/,\s*$/g, "")
    .trim();

  return cleanValue(cleaned);
}

export function joinParts(
  parts: Array<string | null | undefined>,
): string | null {
  const unique = [
    ...new Set(
      parts.flatMap((part) => {
        const cleaned = cleanValue(part);
        return cleaned ? [cleaned] : [];
      }),
    ),
  ];

  return unique.length > 0 ? unique.join(", ") : null;
}

export function isDiscipline(value: string | null): value is Discipline {
  return value === "SLP" || value === "OT" || value === "PT";
}

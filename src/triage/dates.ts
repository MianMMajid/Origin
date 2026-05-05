import type { InboxItem } from "../types.js";

export function inferOperationalDate(inbox: InboxItem[]): string {
  const dates = inbox
    .map((item) => item.received_at.slice(0, 10))
    .filter((date) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))
    .sort();

  return dates.at(-1) || new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

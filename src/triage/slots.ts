import type { Slot } from "../types.js";

export function selectSlotForPreference(
  slots: Slot[],
  preference: string | undefined,
): Slot | undefined {
  if (!preference) {
    return slots[0];
  }

  const normalized = preference.toLowerCase();
  let candidates = [...slots];

  if (/\b(after school|afternoon|pm)\b/.test(normalized)) {
    candidates = candidates.filter((slot) => hourFor(slot.start) >= 15);
  } else if (/\b(morning|am|manana)\b/.test(normalized)) {
    candidates = candidates.filter((slot) => hourFor(slot.start) < 12);
  }

  const requestedWeekdays = requestedDays(normalized);
  if (requestedWeekdays.length > 0) {
    candidates = candidates.filter((slot) =>
      requestedWeekdays.includes(weekdayFor(slot.start)),
    );
  }

  return candidates[0];
}

function hourFor(isoDateTime: string): number {
  const match = isoDateTime.match(/T(\d{2}):/);
  return match ? Number(match[1]) : 0;
}

function weekdayFor(isoDateTime: string): number {
  return new Date(isoDateTime).getUTCDay();
}

function requestedDays(preference: string): number[] {
  const days: number[] = [];
  const checks: Array<[RegExp, number]> = [
    [/\b(sundays?|sun)\b/, 0],
    [/\b(mondays?|mon)\b/, 1],
    [/\b(tuesdays?|tues|tue)\b/, 2],
    [/\b(wednesdays?|wed)\b/, 3],
    [/\b(thursdays?|thurs|thu)\b/, 4],
    [/\b(fridays?|fri)\b/, 5],
    [/\b(saturdays?|sat)\b/, 6],
  ];

  for (const [pattern, day] of checks) {
    if (pattern.test(preference)) {
      days.push(day);
    }
  }

  return days;
}

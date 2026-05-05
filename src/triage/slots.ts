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
  } else if (/\b(morning|am|ma[nñ]ana)\b/.test(normalized)) {
    candidates = candidates.filter((slot) => hourFor(slot.start) < 12);
  }

  // A named weekday is a hard family preference. If no slot matches it, return
  // no slot so intake can review alternatives instead of holding a misleading
  // appointment.
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
  const localDate = isoDateTime.slice(0, 10);
  return new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
}

function requestedDays(preference: string): number[] {
  const days: number[] = [];
  const checks: Array<[RegExp, number]> = [
    [/\b(sundays?|sun|domingos?|domingo)\b/, 0],
    [/\b(mondays?|mon|lunes)\b/, 1],
    [/\b(tuesdays?|tues|tue|martes)\b/, 2],
    [/\b(wednesdays?|wed|mi[eé]rcoles)\b/, 3],
    [/\b(thursdays?|thurs|thu|jueves)\b/, 4],
    [/\b(fridays?|fri|viernes)\b/, 5],
    [/\b(saturdays?|sat|s[aá]bados?|s[aá]bado)\b/, 6],
  ];

  for (const [pattern, day] of checks) {
    if (pattern.test(preference)) {
      days.push(day);
    }
  }

  return days;
}

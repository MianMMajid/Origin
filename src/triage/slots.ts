import { readFileSync } from "node:fs";
import type { Provider, Slot } from "../types.js";

const providersPath = new URL("../../data/providers.json", import.meta.url);
let providerAgeRanges: Map<string, string> | null = null;

export function selectSlotForPreference(
  slots: Slot[],
  preference: string | undefined,
  dobOrAge?: string | null,
  asOfDate?: string,
): Slot | undefined {
  const ageCompatibleSlots = filterSlotsByChildAge(slots, dobOrAge, asOfDate);

  if (!preference) {
    return ageCompatibleSlots[0];
  }

  const normalized = preference.toLowerCase();

  let candidates = [...ageCompatibleSlots];
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

export function filterSlotsByChildAge(
  slots: Slot[],
  dobOrAge: string | null | undefined,
  asOfDate?: string,
): Slot[] {
  const childAge = childAgeInYears(dobOrAge, asOfDate);
  if (childAge === null) {
    return slots;
  }

  return slots.filter((slot) => providerAcceptsAge(slot.provider_id, childAge));
}

function providerAcceptsAge(providerId: string, childAge: number): boolean {
  const ageRange = readProviderAgeRanges().get(providerId);
  if (!ageRange) {
    return true;
  }

  const parsed = ageRange.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (!parsed) {
    return true;
  }

  const minAge = Number(parsed[1]);
  const maxAge = Number(parsed[2]);
  return childAge >= minAge && childAge <= maxAge;
}

function readProviderAgeRanges(): Map<string, string> {
  if (!providerAgeRanges) {
    const providers = JSON.parse(readFileSync(providersPath, "utf8")) as Provider[];
    providerAgeRanges = new Map(
      providers.map((provider) => [provider.provider_id, provider.age_range]),
    );
  }

  return providerAgeRanges;
}

function childAgeInYears(
  dobOrAge: string | null | undefined,
  asOfDate: string | undefined,
): number | null {
  if (!dobOrAge) {
    return null;
  }

  const normalized = dobOrAge.trim().toLowerCase();
  const months = normalized.match(/^(\d+(?:\.\d+)?)\s*months?\b/);
  if (months) {
    return Number(months[1]) / 12;
  }

  const years = normalized.match(/^(\d+(?:\.\d+)?)(?:\s*years?\b|-year-old\b)/);
  if (years) {
    return Number(years[1]);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return ageFromDob(normalized, asOfDate);
  }

  return null;
}

function ageFromDob(dob: string, asOfDate: string | undefined): number {
  const [birthYear, birthMonth, birthDay] = dob.split("-").map(Number);
  const comparisonDate = asOfDate || new Date().toISOString().slice(0, 10);
  const [currentYear, currentMonth, currentDay] = comparisonDate
    .split("-")
    .map(Number);
  let age = currentYear - birthYear;
  if (
    currentMonth < birthMonth ||
    (currentMonth === birthMonth && currentDay < birthDay)
  ) {
    age -= 1;
  }

  return age;
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

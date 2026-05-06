import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectSlotForPreference } from "../src/triage/slots.js";
import type { Slot } from "../src/types.js";

const baseSlot: Omit<Slot, "slot_id" | "start"> = {
  provider_id: "prov",
  provider_name: "Provider",
  discipline: "SLP",
  appointment_type: "evaluation",
  languages: ["en"],
};

describe("selectSlotForPreference", () => {
  it("returns undefined when no slot matches requested day and time", () => {
    const slots: Slot[] = [
      {
        ...baseSlot,
        slot_id: "morning_wed",
        start: "2026-04-29T09:00:00-07:00",
      },
      {
        ...baseSlot,
        slot_id: "afternoon_fri",
        start: "2026-05-01T15:30:00-07:00",
      },
    ];

    assert.equal(
      selectSlotForPreference(slots, "after school Tuesdays or Thursdays"),
      undefined,
    );
  });

  it("selects the first slot when no preference is provided", () => {
    const slot: Slot = {
      ...baseSlot,
      slot_id: "first",
      start: "2026-04-29T09:00:00-07:00",
    };

    assert.equal(selectSlotForPreference([slot], undefined), slot);
  });

  it("understands accented Spanish weekday preferences", () => {
    const spanishWednesday: Slot = {
      ...baseSlot,
      slot_id: "miercoles",
      start: "2026-04-29T10:00:00-07:00",
    };

    assert.equal(
      selectSlotForPreference([spanishWednesday], "miércoles por la mañana"),
      spanishWednesday,
    );
  });

  it("honors negated morning preferences before selecting a hold candidate", () => {
    const morning: Slot = {
      ...baseSlot,
      slot_id: "morning",
      start: "2026-04-29T09:00:00-07:00",
    };
    const afternoon: Slot = {
      ...baseSlot,
      slot_id: "afternoon",
      start: "2026-04-29T14:00:00-07:00",
    };

    assert.equal(
      selectSlotForPreference([morning, afternoon], "Family prefers no mornings"),
      afternoon,
    );
    assert.equal(
      selectSlotForPreference([morning], "Family prefers no mornings"),
      undefined,
    );
  });

  it("honors negated weekday and Spanish morning preferences", () => {
    const tuesdayMorning: Slot = {
      ...baseSlot,
      slot_id: "tuesday_morning",
      start: "2026-04-28T09:00:00-07:00",
    };
    const wednesdayAfternoon: Slot = {
      ...baseSlot,
      slot_id: "wednesday_afternoon",
      start: "2026-04-29T14:00:00-07:00",
    };

    assert.equal(
      selectSlotForPreference(
        [tuesdayMorning, wednesdayAfternoon],
        "Family prefers no Tuesdays",
      ),
      wednesdayAfternoon,
    );
    assert.equal(
      selectSlotForPreference(
        [tuesdayMorning, wednesdayAfternoon],
        "not Tuesday mornings",
      ),
      wednesdayAfternoon,
    );
    assert.equal(
      selectSlotForPreference(
        [tuesdayMorning, wednesdayAfternoon],
        "no por la mañana",
      ),
      wednesdayAfternoon,
    );
  });

  it("does not select slots when the child is outside the provider age range", () => {
    const otSlot: Slot = {
      ...baseSlot,
      provider_id: "prov_james_owens",
      provider_name: "James Owens, OTR/L",
      discipline: "OT",
      slot_id: "too_young_for_provider",
      start: "2026-05-05T10:00:00-07:00",
    };

    assert.equal(selectSlotForPreference([otSlot], undefined, "2 years"), undefined);
  });

  it("keeps slots when the child is within the provider age range", () => {
    const otSlot: Slot = {
      ...baseSlot,
      provider_id: "prov_james_owens",
      provider_name: "James Owens, OTR/L",
      discipline: "OT",
      slot_id: "age_compatible",
      start: "2026-05-05T10:00:00-07:00",
    };

    assert.equal(selectSlotForPreference([otSlot], undefined, "3 years"), otSlot);
  });
});

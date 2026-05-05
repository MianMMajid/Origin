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
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { configureTrace } from "../src/tools.js";
import { inboxItem, tempPath } from "./helpers.js";

describe("runAgent edge workflows", () => {
  it("returns a priority-sorted action plan with stable routine tie-breakers", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const outputs = await runAgent([
      inboxItem({
        id: "routine_late",
        received_at: "2026-04-28T09:00:00-07:00",
        subject: "Billing question",
        body:
          "I have a billing question for Mia Nguyen. Please call parent Dana at 555-1111.",
      }),
      inboxItem({
        id: "routine_same_a",
        received_at: "2026-04-28T06:00:00-07:00",
        subject: "Clinical question",
        body:
          "Should I wait until the evaluation for Ava Chen, age 5? Parent Lee can be reached at 555-2222.",
      }),
      inboxItem({
        id: "same_day_cancel",
        received_at: "2026-04-28T08:00:00-07:00",
        subject: "Cancel today",
        body:
          "We need to cancel today's 2pm OT appointment for Noah Hall. DOB is 2017-11-02. Please call 555-3333.",
      }),
      inboxItem({
        id: "fyi",
        received_at: "2026-04-28T05:00:00-07:00",
        subject: "FYI only",
        body:
          "FYI, the school team uploaded a community resource newsletter for your records. No reply needed.",
      }),
      inboxItem({
        id: "routine_same_b",
        received_at: "2026-04-28T06:00:00-07:00",
        subject: "Provider follow-up",
        body:
          "Following up on the signed referral for Olivia Park. Parent Sam is at 555-4444.",
      }),
      inboxItem({
        id: "safety",
        received_at: "2026-04-28T07:00:00-07:00",
        subject: "Concern about Leo",
        body:
          "I am worried about Leo, age 6. Dad hit him yesterday. Please call Maria at 555-0102.",
      }),
    ]);

    assert.deepEqual(
      outputs.map((output) => output.item_id),
      [
        "safety",
        "same_day_cancel",
        "routine_same_a",
        "routine_same_b",
        "routine_late",
        "fyi",
      ],
    );
  });

  it("surfaces no suitable slot instead of silently holding a mismatched slot", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "no_slot_match",
        subject: "Referral: Emma Stone - SLP",
        body:
          "Child: Emma Stone. DOB: 2018-09-04. Parent: Dana Stone, 555-3333, dana@example.com. Discipline requested: SLP. Concern: articulation. Insurance: Blue Cross Blue Shield PPO. Member ID: BCBS-333. Preferred availability: after school Tuesdays or Thursdays.",
      }),
    ]);

    assert.equal(output.classification, "new_referral");
    assert.equal(output.tools_called.some((call) => call.name === "find_slots"), true);
    assert.equal(output.tools_called.some((call) => call.name === "hold_slot"), false);
    assert.match(output.recommended_next_action, /availability and alternatives/i);
    assert.match(createTaskNotes(output), /No suitable slot matched/i);
  });

  it("does not reduce multi-discipline referrals to a single slot hold", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "multi_discipline",
        subject: "Referral: Kai Morgan - SLP and OT",
        body:
          "Child: Kai Morgan. DOB: 2018-08-08. Parent: Lee Morgan, 555-4444, lee@example.com. Discipline requested: SLP and OT. Concern: speech delay and sensory processing. Insurance: Aetna PPO. Member ID: AET-444.",
      }),
    ]);

    assert.deepEqual(output.extracted_intake.discipline, ["SLP", "OT"]);
    assert.equal(output.tools_called.some((call) => call.name === "find_slots"), false);
    assert.equal(output.tools_called.some((call) => call.name === "hold_slot"), false);
    assert.match(createTaskNotes(output), /Multiple disciplines requested/i);
  });

  it("routes self-pay referrals to billing before slot review", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "self_pay",
        subject: "Referral: Theo Hall - PT",
        body:
          "Child: Theo Hall. DOB: 2019-05-01. Parent: Iris Hall, 555-2222, iris@example.com. Discipline requested: PT. Concern: toe walking. We are self-pay.",
      }),
    ]);

    assert.deepEqual(output.missing_info, []);
    assert.equal(output.tools_called.some((call) => call.name === "verify_insurance"), false);
    assert.equal(output.tools_called.some((call) => call.name === "find_slots"), false);
    assert.match(output.recommended_next_action, /Billing/i);
    assert.match(createTaskNotes(output), /self-pay|uninsured/i);
  });

  it("does not escalate non-same-day scheduling requests", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "routine_reschedule",
        subject: "Need to reschedule tomorrow",
        body:
          "Can we reschedule tomorrow's 3pm OT appointment to next week? Noah's DOB is 2017-11-02.",
      }),
    ]);

    assert.equal(output.classification, "scheduling");
    assert.equal(output.urgency, "P2");
    assert.equal(output.escalation, null);
    assert.equal(output.tools_called.some((call) => call.name === "escalate"), false);
    assert.match(output.recommended_next_action, /routine scheduling request/i);
  });
});

function createTaskNotes(output: Awaited<ReturnType<typeof runAgent>>[number]): string {
  const createTaskCall = output.tools_called.find((call) => call.name === "create_task");
  assert.ok(createTaskCall, "expected create_task call");
  assert.equal(typeof createTaskCall.args.notes, "string");
  return createTaskCall.args.notes;
}

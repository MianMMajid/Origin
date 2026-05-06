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
    assert.match(createTaskNotes(output), /Slot tool returned.*no returned slot matched/i);
    assert.match(output.decision_rationale, /Slot tool returned.*no returned slot matched/i);
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

  it("escalates P0 safeguarding before any patient search", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "known_patient_safety",
        subject: "Concern about Noah Patel",
        body:
          "Child: Noah Patel. DOB: 2017-11-02. Parent: Anita Patel, 555-3333. Dad hit him today and I am worried about safety.",
      }),
    ]);

    assert.equal(output.classification, "safeguarding");
    assert.equal(output.urgency, "P0");
    const escalationIndex = toolIndex(output, "escalate");
    assert.notEqual(escalationIndex, -1);
    assert.equal(toolIndex(output, "search_patient"), -1);
    assert.deepEqual(
      output.tools_called
        .slice(0, escalationIndex)
        .filter(
          (call) =>
            call.name === "lookup_policy" &&
            call.args.topic !== "safeguarding",
        ),
      [],
    );
  });

  it("does not search patients for spam even when identity anchors are present", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "spam_with_identity",
        subject: "Unsubscribe",
        body:
          "Please unsubscribe from this marketing list. Child: Noah Patel. DOB: 2017-11-02.",
      }),
    ]);

    assert.equal(output.classification, "spam");
    assert.equal(output.urgency, "P3");
    assert.equal(toolIndex(output, "search_patient"), -1);
  });

  it("uses name-only active patient matches to refine non-P0 referrals", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "name_only_known_patient",
        subject: "Referral: Noah Patel - OT",
        body:
          "Child: Noah Patel. He is 8-year-old. Parent: Anita Patel, 555-3333, anita@example.com. Discipline requested: OT. Concern: sensory processing. Insurance: Aetna PPO. Member ID: AET-777.",
      }),
    ]);

    const searchCall = getToolCall(output, "search_patient");
    assert.equal(searchCall.args.name, "Noah Patel");
    assert.equal("dob" in searchCall.args, false);
    assert.equal(output.classification, "existing_patient_request");
    assert.match(output.decision_rationale, /Patient search found .*active status/i);
  });

  it("routes existing-patient admin requests without full intake requirements", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "existing_patient_admin",
        subject: "Home exercise plan copy",
        body:
          "Child: Noah Patel. Current patient needs a copy of his home exercise plan.",
      }),
    ]);

    assert.equal(output.classification, "existing_patient_request");
    assert.deepEqual(output.missing_info, []);
    assert.equal(output.tools_called.some((call) => call.name === "find_slots"), false);
    assert.equal(output.tools_called.some((call) => call.name === "verify_insurance"), false);
    assert.doesNotMatch(createTaskNotes(output), /payer|member ID|diagnosis|discipline/i);
    assert.match(output.recommended_next_action, /chart|existing-patient/i);
  });

  it("drafts Spanish scheduling replies in Spanish", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "spanish_same_day_schedule",
        subject: "Cancelar cita de hoy",
        body:
          "Hola, soy Anita Patel. No podemos venir hoy a la cita de OT por mi hijo Noah Patel. DOB: 2017-11-02. Mi telefono es 555-3333. Gracias.",
      }),
    ]);

    assert.equal(output.classification, "scheduling");
    assert.equal(output.urgency, "P1");
    assert.match(output.draft_reply || "", /^Hola, gracias/);
    assert.doesNotMatch(output.draft_reply || "", /^Hi, thank you/);
    const draftCall = getToolCall(output, "draft_message");
    assert.equal(draftCall.args.language, "es");
    assert.match(String(draftCall.args.body), /reprogramar/);
  });

  it("uses emergency handling language for current medical emergency P0 items", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "medical_emergency",
        subject: "Emergency message",
        body:
          "Child: Ava Chen. My child is having a seizure right now and cannot breathe.",
      }),
    ]);

    assert.equal(output.classification, "safeguarding");
    assert.equal(output.urgency, "P0");
    assert.match(output.draft_reply || "", /911|emergency services/i);
    assert.match(output.recommended_next_action, /emergency services/i);
    assert.match(createTaskNotes(output), /911|EMS|emergency protocol/i);
  });

  it("routes intake forms requests to a specific admin action", async () => {
    configureTrace({ path: tempPath("trace.jsonl") });
    const [output] = await runAgent([
      inboxItem({
        id: "forms_request",
        subject: "Forms",
        body: "Could you send intake forms again for Ava?",
      }),
    ]);

    assert.equal(output.classification, "other");
    assert.equal(output.urgency, "P2");
    assert.equal(output.extracted_intake.child_name, "Ava");
    assert.match(output.recommended_next_action, /resend the intake forms/i);
    assert.match(createTaskNotes(output), /intake forms or paperwork/i);
    assert.match(output.draft_reply || "", /resend the intake forms/i);
  });
});

function toolIndex(
  output: Awaited<ReturnType<typeof runAgent>>[number],
  name: string,
): number {
  return output.tools_called.findIndex((call) => call.name === name);
}

function getToolCall(
  output: Awaited<ReturnType<typeof runAgent>>[number],
  name: string,
) {
  const toolCall = output.tools_called.find((call) => call.name === name);
  assert.ok(toolCall, `expected ${name} call`);
  return toolCall;
}

function createTaskNotes(output: Awaited<ReturnType<typeof runAgent>>[number]): string {
  const createTaskCall = output.tools_called.find((call) => call.name === "create_task");
  assert.ok(createTaskCall, "expected create_task call");
  const notes = createTaskCall.args.notes;
  if (typeof notes !== "string") {
    assert.fail("expected create_task notes to be a string");
  }
  return notes;
}

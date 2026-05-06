import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyItem } from "../src/triage/classifier.js";
import { extractIntake } from "../src/triage/extractor.js";
import { inboxItem } from "./helpers.js";

describe("classifyItem", () => {
  it("prioritizes safeguarding over spam-like wording", () => {
    const item = inboxItem({
      subject: "Speech eval and unsubscribe",
      body:
        "Please unsubscribe me from marketing, but I also need help because dad left him alone all weekend.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "safeguarding",
      urgency: "P0",
    });
  });

  it("does not treat negated safety language as safeguarding", () => {
    const item = inboxItem({
      subject: "Referral for speech evaluation",
      body:
        "Referral for speech evaluation. No abuse or neglect concerns were reported.",
    });

    assert.notEqual(classifyItem(item, extractIntake(item)).classification, "safeguarding");
  });

  it("still escalates mixed negation when a new caregiver harm disclosure appears", () => {
    const item = inboxItem({
      subject: "Evaluation request",
      body:
        "There was no prior abuse reported, but dad hit him yesterday and I need an evaluation.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "safeguarding",
      urgency: "P0",
    });
  });

  it("escalates broader safety and safeguarding disclosures", () => {
    const bodies = [
      "Leo told his teacher he wants to hurt himself. Please call Maria at 555-0102.",
      "My son said he wants to kill himself and run into traffic.",
      "My daughter has been cutting herself and may do it again tonight.",
      "My son swallowed a bottle of pills.",
      "My child will run into traffic today.",
      "He said he is going to hurt his sister tonight.",
      "Mom is using drugs and leaves the toddler alone overnight.",
      "The caregiver is unsafe and leaves her without meals.",
      "My daughter said her uncle touched her private parts.",
      "My child is having a seizure right now and cannot breathe.",
      "Parent says the caregiver has been verbally abusive at home.",
      "Child says he is not safe at home after weekends with dad.",
      "No abuse reported, but ongoing neglect is documented by the school team.",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        subject: "Safety concern",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "safeguarding",
        urgency: "P0",
      });
    }
  });

  it("escalates reported P0 safety edge cases", () => {
    const bodies = [
      "I cannot keep him safe tonight. Please have the clinical lead call me.",
      "He threatened his brother with a knife and I need help now.",
      "She is trying to jump out of the window tonight.",
      "CPS is involved and opened a case after the visit.",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        subject: "Safety concern",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "safeguarding",
        urgency: "P0",
      });
    }
  });

  it("does not escalate negated or administrative emergency and safety wording", () => {
    const cases = [
      {
        body:
          "I have an invoice question; this is not an emergency. Can I pay online?",
        expected: { classification: "billing_question", urgency: "P2" },
      },
      {
        body:
          "We called 911 last month, but there is no emergency now. Should I wait until the evaluation?",
        expected: { classification: "clinical_question", urgency: "P2" },
      },
      {
        body: "No seizure right now. I just need advice about therapy.",
        expected: { classification: "clinical_question", urgency: "P2" },
      },
      {
        body: "Please update the emergency contact for Noah Patel.",
        expected: { classification: "other", urgency: "P2" },
      },
      {
        body: "For Ava's chart, no food allergies and no safety concerns.",
        expected: { classification: "other", urgency: "P2" },
      },
      {
        body:
          "Should I use different wording for private parts hygiene? No abuse concerns.",
        expected: { classification: "clinical_question", urgency: "P2" },
      },
      {
        body: "Should I call 911 if he has another seizure someday?",
        expected: { classification: "clinical_question", urgency: "P2" },
      },
    ];

    for (const { body, expected } of cases) {
      const item = inboxItem({
        subject: "Question",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), expected);
    }
  });

  it("does not escalate ordinary pain wording without unsafe caregiving context", () => {
    const item = inboxItem({
      subject: "Question after PT",
      body: "His leg hurts after PT. Can someone call me about next steps?",
    });

    assert.notEqual(classifyItem(item, extractIntake(item)).classification, "safeguarding");
  });

  it("does not escalate benign sports bruises without unsafe caregiving context", () => {
    const item = inboxItem({
      subject: "Question after PT",
      body: "My child has bruises from soccer and his leg hurts after PT.",
    });

    assert.notEqual(classifyItem(item, extractIntake(item)).classification, "safeguarding");
  });

  it("marks same-day implied appointment changes as P1 scheduling", () => {
    const item = inboxItem({
      subject: "Need to move 3pm",
      body: "We can't make 3pm. Please reschedule.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("keeps same-day reschedules ahead of spam-like unsubscribe wording", () => {
    const item = inboxItem({
      subject: "Reschedule and unsubscribe",
      body:
        "Please reschedule today's 3pm appointment for Noah. Also unsubscribe me from marketing.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("keeps same-day scheduling ahead of billing wording", () => {
    const item = inboxItem({
      subject: "Cancel today and fee question",
      body:
        "I need to cancel today's 3pm appointment and want to know if I will be charged.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("does not treat negated same-day cancellation as scheduling for unrelated asks", () => {
    const item = inboxItem({
      subject: "Billing question",
      body:
        "I don’t need to cancel today. I have a billing question about my invoice.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "billing_question",
      urgency: "P2",
    });
  });

  it("still escalates immediate scheduling signals after negated same-day cancellation", () => {
    const item = inboxItem({
      subject: "Running late",
      body: "I don't need to cancel today, but we are running late.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("keeps non-same-day reschedules at routine urgency", () => {
    const item = inboxItem({
      subject: "Need to reschedule tomorrow",
      body: "Can we reschedule tomorrow's appointment to next week?",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P2",
    });
  });

  it("keeps negated same-day language routine when the requested move is future-dated", () => {
    const bodies = [
      "We do not need to cancel today; can we move tomorrow's 3pm appointment?",
      "We do not need to cancel today's appointment; can we move tomorrow's 3pm appointment?",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        received_at: "2026-04-28T08:00:00-07:00",
        subject: "Move tomorrow",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "scheduling",
        urgency: "P2",
      });
    }
  });

  it("keeps invalid explicit appointment dates from falling through to clock-time urgency", () => {
    const item = inboxItem({
      received_at: "2026-04-28T08:00:00-07:00",
      subject: "Need to reschedule",
      body: "Can we reschedule the 13/40 3pm appointment?",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P2",
    });
  });

  it("keeps week-based future reschedules routine even with clock times", () => {
    const bodies = [
      "Can we reschedule next week's OT appointment to 3pm?",
      "Can we reschedule the OT appointment in two weeks at 3pm?",
      "I am writing today to cancel next week's 3pm appointment.",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        subject: "Future reschedule",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "scheduling",
        urgency: "P2",
      });
    }
  });

  it("treats clock-time scheduling with an unlabeled pediatric DOB as same-day", () => {
    const item = inboxItem({
      subject: "Cannot make appointment",
      body: "I can't make 3pm for Noah Patel 11/02/2017. Please reschedule.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("marks immediate operational scheduling messages as P1", () => {
    const bodies = [
      "We are running late for OT.",
      "I am in the parking lot for the appointment.",
      "Can we reschedule this evening's visit?",
      "We can't come right now.",
      "No seizure right now, but should we still come to OT today?",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        subject: "Today appointment",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "scheduling",
        urgency: "P1",
      });
    }
  });

  it("does not escalate future-dated appointment changes just because they include a time", () => {
    const bodies = [
      "Can we reschedule the Friday 3pm OT appointment?",
      "Can we reschedule the May 8 3pm OT appointment?",
      "Can we reschedule the 5/8 3pm OT appointment?",
      "Can we reschedule the May 20 3pm OT appointment?",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        received_at: "2026-04-28T08:00:00-07:00",
        subject: "Need to reschedule",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "scheduling",
        urgency: "P2",
      });
    }
  });

  it("keeps explicit same-date appointment changes as P1", () => {
    const item = inboxItem({
      received_at: "2026-04-28T08:00:00-07:00",
      subject: "Need to reschedule",
      body: "Can we reschedule the 4/28 3pm OT appointment?",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("keeps same-weekday appointment changes as P1 when the weekday is today", () => {
    const item = inboxItem({
      received_at: "2026-05-08T08:00:00-07:00",
      subject: "Need to reschedule",
      body: "Can we reschedule the Friday 3pm OT appointment?",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P1",
    });
  });

  it("marks Spanish same-day cancellation and reschedule requests as P1", () => {
    const bodies = [
      "No podemos venir hoy a las 3pm. Necesito cancelar.",
      "Necesito reprogramar la cita de hoy a las 3pm.",
    ];

    for (const body of bodies) {
      const item = inboxItem({
        received_at: "2026-04-28T08:00:00-07:00",
        subject: "Cambio de cita",
        body,
      });

      assert.deepEqual(classifyItem(item, extractIntake(item)), {
        classification: "scheduling",
        urgency: "P1",
      });
    }
  });

  it("keeps Spanish future scheduling requests routine", () => {
    const item = inboxItem({
      received_at: "2026-04-28T08:00:00-07:00",
      subject: "Cambio de cita",
      body: "No podemos venir manana a las 3pm. Necesito reprogramar.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "scheduling",
      urgency: "P2",
    });
  });

  it("routes billing ahead of clinical wording for invoice and payment questions", () => {
    const item = inboxItem({
      subject: "Invoice",
      body: "Should I pay this invoice before booking the next visit?",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "billing_question",
      urgency: "P2",
    });
  });

  it("routes dissatisfaction about callbacks as a complaint before scheduling", () => {
    const item = inboxItem({
      subject: "No one called",
      body: "I'm frustrated that no one called me back about rescheduling.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "complaint",
      urgency: "P2",
    });
  });

  it("classifies complete new patient packets as referrals", () => {
    const item = inboxItem({
      subject: "New patient packet",
      body:
        "New patient packet. Child: Lily Jones. DOB: 2019-01-02. Parent: Sam Jones, 555-1212. Discipline requested: OT. Concern: sensory processing. Insurance: Aetna PPO. Member ID: AET-123.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "new_referral",
      urgency: "P2",
    });
  });

  it("classifies direct therapy-need requests as referrals", () => {
    const item = inboxItem({
      subject: "Speech therapy",
      body:
        "My daughter Nora Mills, DOB is 2018-02-03, needs speech therapy for articulation. I am Alex Mills, 555-2323. Insurance is BCBS PPO, member ID BCBS-222.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "new_referral",
      urgency: "P2",
    });
  });

  it("classifies benign FYI messages as P3", () => {
    const item = inboxItem({
      subject: "FYI only",
      body:
        "FYI, the school team uploaded a community resource newsletter for your records. No reply needed.",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "other",
      urgency: "P3",
    });
  });

  it("keeps actionable FYI messages in the appropriate work queue", () => {
    const item = inboxItem({
      subject: "FYI billing question",
      body:
        "FYI, I have a question about a denied claim. Could you review the bill and call me?",
    });

    assert.deepEqual(classifyItem(item, extractIntake(item)), {
      classification: "billing_question",
      urgency: "P2",
    });
  });
});

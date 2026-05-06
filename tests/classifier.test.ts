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

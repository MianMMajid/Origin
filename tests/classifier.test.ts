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

  it("does not escalate ordinary pain wording without unsafe caregiving context", () => {
    const item = inboxItem({
      subject: "Question after PT",
      body: "His leg hurts after PT. Can someone call me about next steps?",
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
});

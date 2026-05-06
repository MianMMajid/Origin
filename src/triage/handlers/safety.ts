import { create_task, escalate, lookup_policy } from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import { displayChild } from "../extractor.js";
import { searchableText } from "../text.js";
import { draftReplyFor } from "./common.js";

export async function handleSafeguarding(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, dueToday } = input;
  const medicalEmergency = hasMedicalEmergencyReviewSignal(item);
  const escalationReason = medicalEmergency
    ? "Message suggests a current medical emergency or imminent harm and needs immediate clinical lead review."
    : "Message suggests safeguarding risk or imminent harm and needs same-hour clinical lead review.";

  await lookup_policy({ topic: "safeguarding" });
  await escalate({
    item_id: item.id,
    reason: escalationReason,
    severity: "P0",
  });
  const task = await create_task({
    assignee: "clinical_lead",
    due: dueToday,
    title: medicalEmergency
      ? `Immediate emergency review for ${displayChild(extracted)}`
      : `Same-hour safeguarding review for ${displayChild(extracted)}`,
    notes: medicalEmergency
      ? "Review immediately before any routine response. Confirm whether caregiver has contacted 911/local EMS for current breathing trouble, unresponsiveness, serious seizure, ingestion, or similar emergency language, and follow clinic emergency protocol."
      : "Review the inbound message before any scheduling response. Keep outreach neutral and follow clinic safeguarding protocol.",
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    medicalEmergency
      ? "Hi, thank you for contacting Cedar Kids Therapy. We received your message. If your child is having trouble breathing, is unresponsive, is having an ongoing serious seizure, or may have ingested medication or poison, please call 911 or local emergency services now. Our team will review this promptly."
      : "Hi, thank you for contacting Cedar Kids Therapy. We received your message and a member of our team will review it promptly and follow up.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: { reason: escalationReason, severity: "P0" },
    recommendedNextAction:
      medicalEmergency
        ? "Clinical lead should immediately review the message, confirm whether emergency services have been contacted when current emergency symptoms are described, and follow emergency protocol before any routine scheduling or intake response."
        : "Clinical lead should review the safety concern the same hour before intake discusses evaluation availability.",
    decisionRationale:
      medicalEmergency
        ? "The message includes current medical-emergency language, which policy treats as P0 and requires immediate human review."
        : "The message includes safeguarding or imminent-harm language, which policy treats as P0.",
  };
}

function hasMedicalEmergencyReviewSignal(item: ActionInput["item"]): boolean {
  const text = searchableText(item).toLowerCase();

  return /\b(cannot breathe|can'?t breathe|not breathing|trouble breathing|difficulty breathing|choking|unconscious|unresponsive|blue lips|blue face|overdose|swallowed (?:a )?(?:bottle of )?(?:pills|medication|medicine)|took (?:a )?(?:bottle of )?(?:pills|medication|medicine))\b/.test(
    text,
  ) || (
    /\bseizures?\b/.test(text) &&
    /\b(having|currently|right now|just had|today|now|active|ongoing|serious)\b/.test(
      text,
    )
  );
}

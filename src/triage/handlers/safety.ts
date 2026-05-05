import { create_task, escalate, lookup_policy } from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import { displayChild } from "../extractor.js";
import { draftReplyFor } from "./common.js";

export async function handleSafeguarding(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, dueToday } = input;
  const escalationReason =
    "Message suggests unsafe caregiving or possible harm and needs same-hour clinical lead review.";

  await lookup_policy({ topic: "safeguarding" });
  await escalate({
    item_id: item.id,
    reason: escalationReason,
    severity: "P0",
  });
  const task = await create_task({
    assignee: "clinical_lead",
    due: dueToday,
    title: `Same-hour safeguarding review for ${displayChild(extracted)}`,
    notes:
      "Review the inbound message before any scheduling response. Keep outreach neutral and follow clinic safeguarding protocol.",
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    "Hi, thank you for contacting Cedar Kids Therapy. We received your message and a member of our team will review it promptly and follow up.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: { reason: escalationReason, severity: "P0" },
    recommendedNextAction:
      "Clinical lead should review the safety concern the same hour before intake discusses evaluation availability.",
    decisionRationale:
      "The message includes a disclosure that a caregiver is getting rough with the child, which policy treats as safeguarding and P0.",
  };
}

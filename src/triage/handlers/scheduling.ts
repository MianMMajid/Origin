import { create_task, escalate, lookup_policy } from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import { displayChild } from "../extractor.js";
import { draftReplyFor } from "./common.js";

export async function handleScheduling(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, dueToday } = input;
  const escalationReason =
    "Same-day cancellation or reschedule request needs prompt front desk action.";

  await lookup_policy({ topic: "scheduling" });
  await lookup_policy({ topic: "cancellation" });
  await escalate({
    item_id: item.id,
    reason: escalationReason,
    severity: "P1",
  });
  const task = await create_task({
    assignee: "front_desk",
    due: dueToday,
    title: `Same-day reschedule request for ${displayChild(extracted)}`,
    notes:
      "Family reported illness and cannot attend today's appointment. Contact the family, cancel today's visit per policy, and review makeup availability.",
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    "Hi, thank you for letting us know. A team member will review today's appointment and follow up about rescheduling options.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: { reason: escalationReason, severity: "P1" },
    recommendedNextAction:
      "Front desk should contact the family today to handle the cancellation and review reschedule options.",
    decisionRationale:
      "The family reports illness and cannot make today's appointment, making this a P1 same-day operational issue.",
  };
}

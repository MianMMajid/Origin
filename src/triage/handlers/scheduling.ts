import { create_task, escalate, lookup_policy } from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import { displayChild, preferredLanguage } from "../extractor.js";
import { draftReplyFor } from "./common.js";

export async function handleScheduling(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, decision, dueToday, dueRoutine } = input;
  const sameDay = decision.urgency === "P1";
  const escalationReason =
    "Same-day cancellation or reschedule request needs prompt front desk action.";

  await lookup_policy({ topic: "scheduling" });
  if (sameDay) {
    await lookup_policy({ topic: "cancellation" });
    // Only same-day operational issues are escalated. Routine scheduling stays
    // in the front-desk task queue to avoid alert fatigue.
    await escalate({
      item_id: item.id,
      reason: escalationReason,
      severity: "P1",
    });
  }

  const task = await create_task({
    assignee: "front_desk",
    due: sameDay ? dueToday : dueRoutine,
    title: `${sameDay ? "Same-day" : "Routine"} scheduling request for ${displayChild(extracted)}`,
    notes: sameDay
      ? "Family reported illness or inability to attend today's appointment. Contact the family, handle today's visit per policy, and review makeup availability."
      : "Family requested a non-same-day scheduling change. Review availability and follow up through normal front desk workflow.",
  });
  const spanish = preferredLanguage(item) === "es";
  const draftBody = spanish
    ? sameDay
      ? "Hola, gracias por avisarnos. Un miembro del equipo revisara la cita de hoy y le dara seguimiento sobre opciones para reprogramar."
      : "Hola, gracias por comunicarse. Un miembro del equipo revisara el horario y le dara seguimiento con opciones disponibles."
    : sameDay
      ? "Hi, thank you for letting us know. A team member will review today's appointment and follow up about rescheduling options."
      : "Hi, thank you for reaching out. A team member will review the schedule and follow up about available options.";
  const draftReply = await draftReplyFor(item, extracted, draftBody);

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: sameDay ? { reason: escalationReason, severity: "P1" } : null,
    recommendedNextAction: sameDay
      ? "Front desk should contact the family today to handle the cancellation and review reschedule options."
      : "Front desk should review the routine scheduling request and follow up with options.",
    decisionRationale: sameDay
      ? "The family reports a same-day appointment issue, making this a P1 operational workflow."
      : "The family is asking for scheduling help, but there is no same-day operational issue, so this remains P2.",
  };
}

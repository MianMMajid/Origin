import { create_task, lookup_policy } from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import { displayChild } from "../extractor.js";
import { draftReplyFor } from "./common.js";

export async function handleClinicalQuestion(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, dueSoon } = input;

  await lookup_policy({ topic: "clinical_advice" });
  const task = await create_task({
    assignee: "clinical_lead",
    due: dueSoon,
    title: `Review clinical question for ${displayChild(extracted)}`,
    notes:
      "Parent asked for developmental guidance before booking. Do not provide clinical advice in the draft; route to clinician review, screening, or evaluation workflow.",
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    "Hi, thank you for reaching out. We can help route this to the right next step, but our inbox team cannot provide clinical advice by message. A team member will follow up about screening or evaluation options.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      "Clinical lead or intake should review the question and offer a screening or evaluation path without giving advice over inbox.",
    decisionRationale:
      "The parent asks whether to worry or wait, so policy requires routing rather than automated clinical advice.",
  };
}

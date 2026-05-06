import { create_task, lookup_policy, verify_insurance } from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import { displayChild } from "../extractor.js";
import { searchableText } from "../text.js";
import { draftReplyFor } from "./common.js";

export function handleSpam(): ActionResult {
  return {
    draftReply: null,
    taskIds: [],
    escalation: null,
    recommendedNextAction:
      "No patient action needed; archive after human confirmation.",
    decisionRationale:
      "The message appears unrelated to patient care or clinic operations.",
  };
}

export async function handleBillingQuestion(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, missingInfo, dueSoon, knownPatientNote } = input;

  await lookup_policy({ topic: "insurance" });
  const verification = extracted.payer
    ? await verify_insurance({
        payer: extracted.payer,
        member_id: extracted.member_id || undefined,
      })
    : null;

  const task = await create_task({
    assignee: "billing",
    due: dueSoon,
    title: `Review billing question for ${displayChild(extracted)}`,
    notes:
      `Billing-related inbox item needs account review before staff replies.${verification ? ` Insurance verification returned ${verification.data.status}.` : ""} Missing context: ${missingInfo.join(", ") || "none"}.${knownPatientNote}`,
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    "Hi, thank you for reaching out. Our billing team will review the account details and follow up with next steps.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      "Billing should review the account, payer details, and message context before responding.",
    decisionRationale:
      "The message appears to be about billing, benefits, claims, or payment rather than a new clinical intake.",
  };
}

export async function handleProviderFollowup(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, missingInfo, dueSoon, knownPatientNote } = input;

  await lookup_policy({ topic: "service_lines" });
  const task = await create_task({
    assignee: "intake",
    due: dueSoon,
    title: `Route provider follow-up for ${displayChild(extracted)}`,
    notes:
      `Provider or partner-office follow-up needs intake review and chart/referral matching. Missing context: ${missingInfo.join(", ") || "none"}.${knownPatientNote}`,
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    "Thank you for the update. Our intake team will review this and route it to the appropriate staff member.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      "Intake should match the follow-up to the correct referral or chart and route it to the responsible staff member.",
    decisionRationale:
      "The message reads like a provider or partner-office follow-up rather than a parent scheduling or new-intake request.",
  };
}

export async function handleComplaint(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, missingInfo, dueSoon, knownPatientNote } = input;

  const task = await create_task({
    assignee: "front_desk",
    due: dueSoon,
    title: `Review family complaint for ${displayChild(extracted)}`,
    notes:
      `Family complaint or service concern needs human review before response. Missing context: ${missingInfo.join(", ") || "none"}.${knownPatientNote}`,
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    "Hi, thank you for letting us know. A team member will review your concern and follow up directly.",
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      "Front desk should review the concern, identify the related visit or workflow, and route to a supervisor if needed.",
    decisionRationale:
      "The message expresses dissatisfaction or a service concern without a safeguarding disclosure.",
  };
}

export async function handleOther(input: ActionInput): Promise<ActionResult> {
  if (input.decision.urgency === "P3") {
    const task = await create_task({
      assignee: "front_desk",
      due: input.dueRoutine,
      title: `Confirm low-priority FYI item ${input.item.id}`,
      notes:
        "Message appears to be FYI/admin-only with no requested response or patient-care action. Confirm this is safe to archive or file.",
    });

    return {
      draftReply: null,
      taskIds: [task.data.task_id],
      escalation: null,
      recommendedNextAction:
        "Front desk should confirm no action is needed, then archive or file the update.",
      decisionRationale:
        "The message has FYI/no-action cues and no safety, scheduling, referral, billing, complaint, provider follow-up, or clinical signal.",
    };
  }

  if (isIntakeFormsRequest(input)) {
    const { item, extracted, dueRoutine } = input;
    const task = await create_task({
      assignee: "intake",
      due: dueRoutine,
      title: `Resend intake forms for ${displayChild(extracted)}`,
      notes:
        "Family is asking for intake forms or paperwork to be sent again. Confirm the correct recipient/contact and resend the packet or portal link.",
    });
    const draftReply = await draftReplyFor(
      item,
      extracted,
      "Hi, thank you for reaching out. Our intake team will resend the intake forms or portal link and follow up if anything else is needed.",
    );

    return {
      draftReply,
      taskIds: [task.data.task_id],
      escalation: null,
      recommendedNextAction:
        "Intake should confirm the contact on file and resend the intake forms or portal link.",
      decisionRationale:
        "The item is an administrative intake-forms request without safety, scheduling, billing, or clinical-advice signals.",
    };
  }

  const task = await create_task({
    assignee: "front_desk",
    due: input.dueRoutine,
    title: `Review unclassified inbox item ${input.item.id}`,
    notes:
      "Could not confidently classify this item with deterministic rules. Review manually and route to the right team.",
  });

  return {
    draftReply: null,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction: "Front desk should review and route this item manually.",
    decisionRationale:
      "The item did not match a higher-confidence triage pattern.",
  };
}

function isIntakeFormsRequest(input: ActionInput): boolean {
  return /\b(intake forms?|new patient forms?|paperwork|packet|portal link)\b.*\b(send|sent|resend|re-send|again|another|copy)\b|\b(send|resend|re-send)\b.*\b(intake forms?|new patient forms?|paperwork|packet|portal link)\b/i.test(
    searchableText(input.item),
  );
}

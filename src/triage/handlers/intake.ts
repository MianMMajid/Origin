import {
  create_task,
  find_slots,
  hold_slot,
  lookup_policy,
  verify_insurance,
} from "../../tools.js";
import type { ActionInput, ActionResult } from "../model.js";
import {
  displayChild,
  possessiveChild,
  preferredLanguage,
  schedulingPreference,
} from "../extractor.js";
import { selectSlotForPreference } from "../slots.js";
import { draftReplyFor } from "./common.js";

export async function handleMissingPaperwork(
  input: ActionInput,
): Promise<ActionResult> {
  const { extracted, missingInfo, dueSoon } = input;

  await lookup_policy({ topic: "service_lines" });
  const task = await create_task({
    assignee: "intake",
    due: dueSoon,
    title: `Request missing referral information for ${displayChild(extracted)}`,
    notes: `Referral is missing: ${missingInfo.join(", ")}. Contact the referring office or family before any scheduling step.`,
  });

  return {
    draftReply: null,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      "Intake should request the missing demographic, guardian, and insurance details before scheduling review.",
    decisionRationale:
      "The referral identifies a likely SLP need but has blank required intake and insurance fields.",
  };
}

export async function handleReferralOrExistingRequest(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, missingInfo } = input;

  await lookup_policy({ topic: "service_lines" });
  if (preferredLanguage(item) === "es") {
    await lookup_policy({ topic: "language_access" });
  }

  if (missingInfo.length > 0) {
    return handleIncompleteReferral(input);
  }

  if (isSelfPayPayer(extracted.payer)) {
    await lookup_policy({ topic: "insurance" });
    const task = await create_task({
      assignee: "billing",
      due: input.dueSoon,
      title: `Review self-pay options for ${displayChild(extracted)}`,
      notes: `Family appears to be self-pay or uninsured. Review private-pay options before any slot hold or scheduling workflow.${input.knownPatientNote}`,
    });
    const draftReply = await draftReplyFor(
      item,
      extracted,
      `Hi, thank you for sending ${possessiveChild(extracted)} information. Our billing team will review payment options before we move forward with scheduling. A team member will follow up with next steps.`,
    );

    return {
      draftReply,
      taskIds: [task.data.task_id],
      escalation: null,
      recommendedNextAction:
        "Billing should review self-pay options before intake considers appointment availability.",
      decisionRationale:
        "The referral has enough clinical intake detail, but the family appears to be self-pay or uninsured and needs billing review before slot holds.",
    };
  }

  const insurance = extracted.payer
    ? await verify_insurance({
        payer: extracted.payer,
        member_id: extracted.member_id || undefined,
      })
    : null;

  if (
    insurance?.data.status === "out_of_network" ||
    insurance?.data.status === "expired" ||
    insurance?.data.status === "unknown"
  ) {
    await lookup_policy({ topic: "insurance" });
    const task = await create_task({
      assignee: "billing",
      due: input.dueSoon,
      title: `Resolve insurance before scheduling ${displayChild(extracted)}`,
      notes: `${extracted.payer || "Unknown payer"} verification returned ${insurance.data.status}. Review benefits with the family before any slot hold or scheduling workflow.${input.knownPatientNote}`,
    });
    const draftReply = await draftReplyFor(
      item,
      extracted,
      `Hi, thank you for sending ${possessiveChild(extracted)} information. Our billing team needs to review the insurance details before we move forward with scheduling. A team member will follow up with next steps.`,
    );

    return {
      draftReply,
      taskIds: [task.data.task_id],
      escalation: null,
      recommendedNextAction:
        "Billing should complete a benefits conversation before intake considers appointment availability.",
      decisionRationale:
        "The referral has enough clinical intake detail, but insurance verification did not return active in-network coverage.",
    };
  }

  return handleReadyReferral(input, insurance?.data.status === "in_network");
}

async function handleIncompleteReferral(
  input: ActionInput,
): Promise<ActionResult> {
  const { item, extracted, decision, dueSoon, knownPatientNote, missingInfo } =
    input;
  const task = await create_task({
    assignee: "intake",
    due: dueSoon,
    title: `Complete intake details for ${displayChild(extracted)}`,
    notes: `Before offering appointment options, collect: ${missingInfo.join(", ")}.${knownPatientNote}`,
  });
  const draftReply = await draftReplyFor(
    item,
    extracted,
    `Hi, thank you for sending ${possessiveChild(extracted)} information. Our intake team needs a few more details before moving forward: ${missingInfo.join(", ")}. A team member will follow up.`,
  );

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      "Intake should collect the missing details before insurance verification or slot review.",
    decisionRationale:
      decision.classification === "existing_patient_request"
        ? "The item appears to be an intake request for a known active patient, but one or more required intake fields are missing."
        : "The item appears to be an intake request, but one or more required intake fields are missing.",
  };
}

async function handleReadyReferral(
  input: ActionInput,
  insuranceIsInNetwork: boolean,
): Promise<ActionResult> {
  const { item, extracted, decision, dueRoutine, knownPatientNote } = input;
  let heldSlotSummary = "";
  let slotReviewNote = "";

  if ((extracted.discipline?.length || 0) > 1) {
    slotReviewNote =
      " Multiple disciplines requested; review each discipline separately before any slot hold.";
  } else if (extracted.discipline?.[0]) {
    const firstDiscipline = extracted.discipline[0];
    const preferences = schedulingPreference(item);
    const slots = await find_slots({
      discipline: firstDiscipline,
      preferences,
      language: preferredLanguage(item),
    });
    const currentSlots = slots.data.filter((slot) =>
      startsOnOrAfter(slot.start, input.dueToday),
    );
    // A slot hold is reviewable but still operationally meaningful, so only
    // hold when it satisfies current-date and family-preference constraints.
    const firstSlot = selectSlotForPreference(currentSlots, preferences);
    if (firstSlot) {
      const hold = await hold_slot({
        slot_id: firstSlot.slot_id,
        patient_ref: extracted.child_name || extracted.parent_contact || item.id,
      });
      heldSlotSummary = ` Pending-review hold ${hold.data.hold_id} was created for ${firstSlot.provider_name} at ${firstSlot.start}.`;
    } else if (slots.data.length === 0) {
      slotReviewNote =
        " Slot tool returned no provider availability for the requested discipline and language; review waitlist or alternate options.";
    } else if (currentSlots.length === 0) {
      slotReviewNote =
        " Slot tool returned only slots before the operational date; review current provider availability before contacting the family.";
    } else {
      slotReviewNote =
        " Slot tool returned discipline/language availability, but no returned slot matched the stated family preference; review alternate options before contacting the family.";
    }
  }

  const task = await create_task({
    assignee: "intake",
    due: dueRoutine,
    title: `Review intake and slot options for ${displayChild(extracted)}`,
    notes:
      `${decision.classification === "existing_patient_request" ? "Known-patient request" : "Referral"} appears ready for human intake review.${heldSlotSummary || slotReviewNote || " Review provider availability before contacting the family."}${knownPatientNote}`,
  });
  const body =
    preferredLanguage(item) === "es"
      ? "Hola, gracias por comunicarse con Cedar Kids Therapy. Recibimos la informacion y un miembro del equipo la revisara para confirmar los proximos pasos para una evaluacion."
      : `Hi, thank you for sending ${possessiveChild(extracted)} information. Our intake team will review the referral and follow up about evaluation options.`;
  const draftReply = await draftReplyFor(item, extracted, body);

  return {
    draftReply,
    taskIds: [task.data.task_id],
    escalation: null,
    recommendedNextAction:
      heldSlotSummary.length > 0
        ? "Intake should review the pending slot hold and contact the family with evaluation options."
        : slotReviewNote.length > 0
          ? "Intake should review provider availability and alternatives because slot results did not satisfy the family preference or current scheduling constraints."
        : "Intake should review the referral and contact the family about evaluation options.",
    decisionRationale:
      decision.classification === "existing_patient_request"
        ? `Patient search found an active matching patient, and the request has enough detail for human intake review.${slotOutcomeRationale(heldSlotSummary, slotReviewNote)}`
        : insuranceIsInNetwork
          ? `The referral has enough intake detail and verified in-network coverage, so intake can review evaluation availability.${slotOutcomeRationale(heldSlotSummary, slotReviewNote)}`
          : `The referral/request has enough clinical intake detail for human intake review.${slotOutcomeRationale(heldSlotSummary, slotReviewNote)}`,
  };
}

function slotOutcomeRationale(
  heldSlotSummary: string,
  slotReviewNote: string,
): string {
  if (heldSlotSummary.length > 0) {
    return " A pending-review hold was created for a slot that passed the agent's preference filter.";
  }

  if (slotReviewNote.length > 0) {
    return ` ${slotReviewNote.trim()}`;
  }

  return "";
}

function isSelfPayPayer(payer: string | null): boolean {
  return Boolean(
    payer &&
      /\b(self[- ]?pay|private pay|cash pay|no insurance|uninsured)\b/i.test(
        payer,
      ),
  );
}

function startsOnOrAfter(isoDateTime: string, date: string): boolean {
  return isoDateTime.slice(0, 10) >= date;
}

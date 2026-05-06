import {
  getToolCallsForItem,
  search_patient,
  withItemContext,
} from "../tools.js";
import type { InboxItem, ItemOutput, Patient } from "../types.js";
import { handleAction } from "./actions.js";
import { classifyItem, missingFieldsFor } from "./classifier.js";
import { addDays } from "./dates.js";
import { extractIntake, isDatedDob } from "./extractor.js";
import {
  knownPatientNote,
  type TriageContext,
  type TriageDecision,
} from "./model.js";

export async function triageItem(
  item: InboxItem,
  context: TriageContext,
): Promise<ItemOutput> {
  return withItemContext(item.id, async () => {
    const extracted = extractIntake(item);
    // Classification happens before action handling so policy/tool decisions
    // are derived from one auditable triage result.
    const initialDecision = classifyItem(item, extracted);
    const patientMatches = shouldSearchPatient(initialDecision)
      ? await findPatientMatches(extracted)
      : [];
    const decision = refineDecisionForKnownPatient(initialDecision, patientMatches);
    const missingInfo = missingFieldsFor(decision.classification, extracted);
    const action = await handleAction({
      item,
      extracted,
      decision,
      missingInfo,
      knownPatientNote: knownPatientNote(patientMatches),
      dueToday: context.operationalDate,
      dueSoon: addDays(context.operationalDate, 1),
      dueRoutine: addDays(context.operationalDate, 2),
    });

    return {
      item_id: item.id,
      classification: decision.classification,
      urgency: decision.urgency,
      requires_human_review: true,
      extracted_intake: extracted,
      missing_info: missingInfo,
      tools_called: getToolCallsForItem(item.id),
      recommended_next_action: action.recommendedNextAction,
      draft_reply: action.draftReply,
      task_ids: action.taskIds,
      escalation: action.escalation,
      decision_rationale: action.decisionRationale,
    };
  });
}

function shouldSearchPatient(decision: TriageDecision): boolean {
  switch (decision.classification) {
    case "new_referral":
    case "existing_patient_request":
    case "scheduling":
    case "billing_question":
    case "provider_followup":
    case "complaint":
      return true;
    default:
      return false;
  }
}

async function findPatientMatches(
  extracted: ReturnType<typeof extractIntake>,
): Promise<Patient[]> {
  if (!extracted.child_name) {
    return [];
  }

  const datedDob = isDatedDob(extracted.dob_or_age)
    ? extracted.dob_or_age
    : undefined;
  const hasFullName = /\S+\s+\S+/.test(extracted.child_name.trim());
  if (!datedDob && !hasFullName) {
    return [];
  }

  const searchResult = await search_patient({
    name: extracted.child_name,
    dob: datedDob,
  });

  return searchResult.data;
}

function refineDecisionForKnownPatient(
  decision: TriageDecision,
  patientMatches: Patient[],
): TriageDecision {
  if (
    decision.classification === "new_referral" &&
    patientMatches.some((patient) => patient.status === "active")
  ) {
    return { classification: "existing_patient_request", urgency: "P2" };
  }

  return decision;
}

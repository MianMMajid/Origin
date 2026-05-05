import type {
  Classification,
  ExtractedIntake,
  InboxItem,
  ItemOutput,
  Patient,
  Urgency,
} from "../types.js";

export interface TriageContext {
  operationalDate: string;
}

export interface TriageDecision {
  classification: Classification;
  urgency: Urgency;
}

export interface ReplyTarget {
  recipient: string;
  channel: "portal" | "email" | "phone";
}

export interface ActionInput {
  item: InboxItem;
  extracted: ExtractedIntake;
  decision: TriageDecision;
  missingInfo: string[];
  knownPatientNote: string;
  dueToday: string;
  dueSoon: string;
  dueRoutine: string;
}

export interface ActionResult {
  draftReply: string | null;
  taskIds: string[];
  escalation: ItemOutput["escalation"];
  recommendedNextAction: string;
  decisionRationale: string;
}

export function knownPatientNote(patientMatches: Patient[]): string {
  const patient = patientMatches[0];
  return patient
    ? ` Patient search found ${patient.name} (${patient.dob}) with ${patient.status} status.`
    : "";
}

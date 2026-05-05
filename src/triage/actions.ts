import {
  handleBillingQuestion,
  handleComplaint,
  handleOther,
  handleProviderFollowup,
  handleSpam,
} from "./handlers/admin.js";
import { handleClinicalQuestion } from "./handlers/clinical.js";
import {
  handleMissingPaperwork,
  handleReferralOrExistingRequest,
} from "./handlers/intake.js";
import { handleSafeguarding } from "./handlers/safety.js";
import { handleScheduling } from "./handlers/scheduling.js";
import type { ActionInput, ActionResult } from "./model.js";

export async function handleAction(input: ActionInput): Promise<ActionResult> {
  switch (input.decision.classification) {
    case "safeguarding":
      return handleSafeguarding(input);
    case "scheduling":
      return handleScheduling(input);
    case "clinical_question":
      return handleClinicalQuestion(input);
    case "missing_paperwork":
      return handleMissingPaperwork(input);
    case "new_referral":
    case "existing_patient_request":
      return handleReferralOrExistingRequest(input);
    case "billing_question":
      return handleBillingQuestion(input);
    case "provider_followup":
      return handleProviderFollowup(input);
    case "complaint":
      return handleComplaint(input);
    case "spam":
      return handleSpam();
    default:
      return handleOther(input);
  }
}

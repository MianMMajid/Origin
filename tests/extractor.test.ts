import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractIntake,
  preferredLanguage,
} from "../src/triage/extractor.js";
import { inboxItem } from "./helpers.js";

describe("extractIntake", () => {
  it("handles alternate labels, slash DOBs, full phones, and subscriber IDs", () => {
    const item = inboxItem({
      subject: "Referral for Mia Cruz",
      body:
        "Patient: Mia Cruz. Date of birth: 09/04/2018. Parent: Luis Cruz, (555) 123-4567, luis@example.com. Discipline requested: SLP. Concern: articulation. Payer: Aetna PPO. subscriber ID SUB-123.",
    });

    assert.deepEqual(extractIntake(item), {
      child_name: "Mia Cruz",
      dob_or_age: "2018-09-04",
      parent_contact: "Luis Cruz, (555) 123-4567, luis@example.com",
      discipline: ["SLP"],
      diagnosis_or_concern: "articulation",
      payer: "Aetna PPO",
      member_id: "SUB-123",
    });
  });

  it("handles accented Spanish language and member-number cues", () => {
    const item = inboxItem({
      subject: "Evaluación para Sofia",
      body:
        "Hola, soy Ana. Llamo por mi hija Sofia, tiene 5 años. Necesita evaluación de habla. Tenemos Medicaid, número de miembro MCD-77. Prefiero español. Mi teléfono es 555-1212.",
    });
    const extracted = extractIntake(item);

    assert.equal(extracted.child_name, "Sofia");
    assert.equal(extracted.dob_or_age, "5 years");
    assert.equal(extracted.member_id, "MCD-77");
    assert.equal(preferredLanguage(item), "es");
  });

  it("treats self-pay as payer information without requiring a member ID", () => {
    const item = inboxItem({
      body:
        "Child: Theo Hall. DOB: 2019-05-01. Parent: Iris Hall, 555-2222. Discipline requested: PT. Concern: toe walking. We are self-pay.",
    });

    assert.equal(extractIntake(item).payer, "self-pay");
  });
});

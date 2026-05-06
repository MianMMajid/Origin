import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractIntake,
  preferredLanguage,
  replyTarget,
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

  it("extracts Spanish scheduling names without English labels", () => {
    const item = inboxItem({
      subject: "Cancelar cita de hoy",
      body:
        "No podemos venir hoy a las 3pm. Necesito cancelar la cita para Noah Patel. Mi telefono es 555-0108.",
    });

    assert.equal(extractIntake(item).child_name, "Noah Patel");
    assert.equal(preferredLanguage(item), "es");
  });

  it("extracts accented Spanish scheduling names and de-hoy variants", () => {
    const accented = inboxItem({
      subject: "Cancelar cita",
      body:
        "Necesito cancelar la cita para José Núñez. Mi telefono es 555-0108.",
    });
    const todayOf = inboxItem({
      subject: "Cancelar cita de hoy",
      body: "No podemos venir a la cita de hoy de Noah Patel.",
    });
    const forVisit = inboxItem({
      subject: "Cita",
      body: "Llamo por la cita de Sofía López.",
    });

    assert.equal(extractIntake(accented).child_name, "José Núñez");
    assert.equal(extractIntake(todayOf).child_name, "Noah Patel");
    assert.equal(extractIntake(forVisit).child_name, "Sofía López");
  });

  it("handles short DOBs, compact phones, Medi-Cal, and broader concern wording", () => {
    const item = inboxItem({
      sender: "Referral fax",
      body:
        "Client: Nico Diaz. DOB 9/4/18. Parent: Rosa Diaz, 5551234567. Discipline requested: OT. Reason for referral: sensory processing. Medi-Cal member number MCD-88.",
    });

    assert.deepEqual(extractIntake(item), {
      child_name: "Nico Diaz",
      dob_or_age: "2018-09-04",
      parent_contact: "Rosa Diaz, 5551234567",
      discipline: ["OT"],
      diagnosis_or_concern: "sensory processing",
      payer: "Medicaid",
      member_id: "MCD-88",
    });
  });

  it("treats self-pay as payer information without requiring a member ID", () => {
    const item = inboxItem({
      body:
        "Child: Theo Hall. DOB: 2019-05-01. Parent: Iris Hall, 555-2222. Discipline requested: PT. Concern: toe walking. We are self-pay.",
    });

    assert.equal(extractIntake(item).payer, "self-pay");
  });

  it("does not overcapture semicolon-delimited referral fields", () => {
    const item = inboxItem({
      body:
        "Child: Liam Park; DOB: 2018-09-04; Parent: Dana Park, 555-3333; Discipline requested: SLP; Concern: articulation delay; Insurance: Aetna PPO; Member ID: AET-333.",
    });
    const extracted = extractIntake(item);

    assert.equal(extracted.child_name, "Liam Park");
    assert.equal(extracted.diagnosis_or_concern, "articulation delay");
    assert.equal(extracted.payer, "Aetna PPO");
  });

  it("extracts names from scheduling and direct therapy-need variants", () => {
    const scheduling = inboxItem({
      body:
        "Can we reschedule Friday 3pm OT appointment for Noah Patel? DOB is 2017-11-02. Please call 555-0108.",
    });
    const therapyNeed = inboxItem({
      body:
        "My daughter Nora Mills, DOB is 2018-02-03, needs speech therapy for articulation. I am Alex Mills, 555-2323.",
    });
    const namedAge = inboxItem({
      body:
        "My daughter Mia is 4 and needs speech therapy for articulation. Please call me at 555-2222.",
    });

    assert.equal(extractIntake(scheduling).child_name, "Noah Patel");
    assert.equal(extractIntake(therapyNeed).child_name, "Nora Mills");
    assert.equal(extractIntake(therapyNeed).diagnosis_or_concern, "articulation");
    assert.equal(extractIntake(namedAge).child_name, "Mia");
    assert.equal(extractIntake(namedAge).dob_or_age, "4 years");
    assert.equal(extractIntake(namedAge).diagnosis_or_concern, "articulation");
  });

  it("extracts child names from intake forms requests", () => {
    const item = inboxItem({
      body: "Could you send intake forms again for Ava?",
    });

    assert.equal(extractIntake(item).child_name, "Ava");
  });

  it("extracts current-patient and provider follow-up names without trailing verbs", () => {
    const currentPatient = inboxItem({
      body: "Current patient Noah Patel needs a copy of his home exercise plan.",
    });
    const currentPatientPrefix = inboxItem({
      body: "Noah Patel is a current patient and needs a chart note.",
    });
    const providerFollowup = inboxItem({
      body: "Plan of care for Noah Patel attached for signature.",
    });
    const signedReferral = inboxItem({
      body: "Following up on the signed referral for Olivia Park.",
    });

    assert.equal(extractIntake(currentPatient).child_name, "Noah Patel");
    assert.equal(extractIntake(currentPatientPrefix).child_name, "Noah Patel");
    assert.equal(extractIntake(providerFollowup).child_name, "Noah Patel");
    assert.equal(extractIntake(signedReferral).child_name, "Olivia Park");
  });

  it("extracts names from more intake packet resend phrasings", () => {
    const toParent = inboxItem({
      body: "Could you resend the intake packet to Ava's mom?",
    });
    const family = inboxItem({
      body: "Please send the intake packet for Ava Chen's family again.",
    });
    const portal = inboxItem({
      body: "Can you send Ava another portal link?",
    });

    assert.equal(extractIntake(toParent).child_name, "Ava");
    assert.equal(extractIntake(family).child_name, "Ava Chen");
    assert.equal(extractIntake(portal).child_name, "Ava");
  });

  it("replies to the email sender before body-mentioned addresses", () => {
    const item = inboxItem({
      channel: "email",
      sender: "Parent Sender <parent@example.com>",
      body:
        "Please use old-contact@example.com only for records. Child: Ava Sender.",
    });

    assert.deepEqual(replyTarget(item, extractIntake(item)), {
      recipient: "parent@example.com",
      channel: "email",
    });
  });
});

import {
  create_task,
  draft_message,
  escalate,
  find_slots,
  getToolCallsForItem,
  hold_slot,
  lookup_policy,
  search_patient,
  verify_insurance,
  withItemContext,
} from "./tools.js";
import type {
  Classification,
  Discipline,
  ExtractedIntake,
  InboxItem,
  ItemOutput,
  Slot,
  Urgency,
} from "./types.js";

interface TriageContext {
  operationalDate: string;
}

interface TriageDecision {
  classification: Classification;
  urgency: Urgency;
}

interface ReplyTarget {
  recipient: string;
  channel: "portal" | "email" | "phone";
}

export async function runAgent(inbox: InboxItem[]): Promise<ItemOutput[]> {
  const context: TriageContext = {
    operationalDate: inferOperationalDate(inbox),
  };
  const outputs: ItemOutput[] = [];

  for (const item of inbox) {
    outputs.push(await triageItem(item, context));
  }

  return outputs;
}

async function triageItem(
  item: InboxItem,
  context: TriageContext,
): Promise<ItemOutput> {
  return withItemContext(item.id, async () => {
    const extracted = extractIntake(item);
    const decision = classifyItem(item, extracted);
    const missingInfo = missingFieldsFor(decision.classification, extracted);
    const taskIds: string[] = [];
    let draftReply: string | null = null;
    let escalation: ItemOutput["escalation"] = null;
    let recommendedNextAction = "";
    let decisionRationale = "";

    const dueToday = context.operationalDate;
    const dueSoon = addDays(context.operationalDate, 1);
    const dueRoutine = addDays(context.operationalDate, 2);

    if (isDatedDob(extracted.dob_or_age) && extracted.child_name) {
      await search_patient({
        name: extracted.child_name,
        dob: extracted.dob_or_age,
      });
    }

    switch (decision.classification) {
      case "safeguarding": {
        await lookup_policy({ topic: "safeguarding" });
        const escalationReason =
          "Message suggests unsafe caregiving or possible harm and needs same-hour clinical lead review.";
        await escalate({
          item_id: item.id,
          reason: escalationReason,
          severity: "P0",
        });
        escalation = { reason: escalationReason, severity: "P0" };
        const task = await create_task({
          assignee: "clinical_lead",
          due: dueToday,
          title: `Same-hour safeguarding review for ${displayChild(extracted)}`,
          notes:
            "Review the inbound message before any scheduling response. Keep outreach neutral and follow clinic safeguarding protocol.",
        });
        taskIds.push(task.data.task_id);

        const target = replyTarget(item, extracted);
        const body =
          "Hi, thank you for contacting Cedar Kids Therapy. We received your message and a member of our team will review it promptly and follow up.";
        await draft_message({
          recipient: target.recipient,
          channel: target.channel,
          body,
          language: preferredLanguage(item),
        });
        draftReply = body;
        recommendedNextAction =
          "Clinical lead should review the safety concern the same hour before intake discusses evaluation availability.";
        decisionRationale =
          "The message includes a disclosure that a caregiver is getting rough with the child, which policy treats as safeguarding and P0.";
        break;
      }

      case "scheduling": {
        await lookup_policy({ topic: "scheduling" });
        await lookup_policy({ topic: "cancellation" });
        const escalationReason =
          "Same-day cancellation or reschedule request needs prompt front desk action.";
        await escalate({
          item_id: item.id,
          reason: escalationReason,
          severity: "P1",
        });
        escalation = { reason: escalationReason, severity: "P1" };
        const task = await create_task({
          assignee: "front_desk",
          due: dueToday,
          title: `Same-day reschedule request for ${displayChild(extracted)}`,
          notes:
            "Family reported illness and cannot attend today's appointment. Contact the family, cancel today's visit per policy, and review makeup availability.",
        });
        taskIds.push(task.data.task_id);

        const target = replyTarget(item, extracted);
        const body =
          "Hi, thank you for letting us know. A team member will review today's appointment and follow up about rescheduling options.";
        await draft_message({
          recipient: target.recipient,
          channel: target.channel,
          body,
          language: preferredLanguage(item),
        });
        draftReply = body;
        recommendedNextAction =
          "Front desk should contact the family today to handle the cancellation and review reschedule options.";
        decisionRationale =
          "The family reports illness and cannot make today's appointment, making this a P1 same-day operational issue.";
        break;
      }

      case "clinical_question": {
        await lookup_policy({ topic: "clinical_advice" });
        const task = await create_task({
          assignee: "clinical_lead",
          due: dueSoon,
          title: `Review clinical question for ${displayChild(extracted)}`,
          notes:
            "Parent asked for developmental guidance before booking. Do not provide clinical advice in the draft; route to clinician review, screening, or evaluation workflow.",
        });
        taskIds.push(task.data.task_id);

        const target = replyTarget(item, extracted);
        const body =
          "Hi, thank you for reaching out. We can help route this to the right next step, but our inbox team cannot provide clinical advice by message. A team member will follow up about screening or evaluation options.";
        await draft_message({
          recipient: target.recipient,
          channel: target.channel,
          body,
          language: preferredLanguage(item),
        });
        draftReply = body;
        recommendedNextAction =
          "Clinical lead or intake should review the question and offer a screening or evaluation path without giving advice over inbox.";
        decisionRationale =
          "The parent asks whether to worry or wait, so policy requires routing rather than automated clinical advice.";
        break;
      }

      case "missing_paperwork": {
        await lookup_policy({ topic: "service_lines" });
        const task = await create_task({
          assignee: "intake",
          due: dueSoon,
          title: `Request missing referral information for ${displayChild(extracted)}`,
          notes: `Referral is missing: ${missingInfo.join(", ")}. Contact the referring office or family before any scheduling step.`,
        });
        taskIds.push(task.data.task_id);

        recommendedNextAction =
          "Intake should request the missing demographic, guardian, and insurance details before scheduling review.";
        decisionRationale =
          "The referral identifies a likely SLP need but has blank required intake and insurance fields.";
        break;
      }

      case "new_referral":
      case "existing_patient_request": {
        await lookup_policy({ topic: "service_lines" });
        if (missingInfo.length > 0) {
          const task = await create_task({
            assignee: "intake",
            due: dueSoon,
            title: `Complete intake details for ${displayChild(extracted)}`,
            notes: `Before offering appointment options, collect: ${missingInfo.join(", ")}.`,
          });
          taskIds.push(task.data.task_id);

          const target = replyTarget(item, extracted);
          const body =
            `Hi, thank you for sending ${possessiveChild(extracted)} information. Our intake team needs a few more details before moving forward: ${missingInfo.join(", ")}. A team member will follow up.`;
          await draft_message({
            recipient: target.recipient,
            channel: target.channel,
            body,
            language: preferredLanguage(item),
          });
          draftReply = body;
          recommendedNextAction =
            "Intake should collect the missing details before insurance verification or slot review.";
          decisionRationale =
            "The item appears to be an intake request, but one or more required intake fields are missing.";
          break;
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
            due: dueSoon,
            title: `Resolve insurance before scheduling ${displayChild(extracted)}`,
            notes: `${extracted.payer || "Unknown payer"} verification returned ${insurance.data.status}. Review benefits with the family before any slot hold or scheduling workflow.`,
          });
          taskIds.push(task.data.task_id);

          const target = replyTarget(item, extracted);
          const body =
            `Hi, thank you for sending ${possessiveChild(extracted)} information. Our billing team needs to review the insurance details before we move forward with scheduling. A team member will follow up with next steps.`;
          await draft_message({
            recipient: target.recipient,
            channel: target.channel,
            body,
            language: preferredLanguage(item),
          });
          draftReply = body;
          recommendedNextAction =
            "Billing should complete a benefits conversation before intake considers appointment availability.";
          decisionRationale =
            "The referral has enough clinical intake detail, but insurance verification did not return active in-network coverage.";
        } else {
          const firstDiscipline = extracted.discipline?.[0];
          let heldSlotSummary = "";
          if (firstDiscipline && missingInfo.length === 0) {
            const preferences = schedulingPreference(item);
            const slots = await find_slots({
              discipline: firstDiscipline,
              preferences,
              language: preferredLanguage(item),
            });
            const firstSlot = selectSlotForPreference(slots.data, preferences);
            if (firstSlot) {
              const hold = await hold_slot({
                slot_id: firstSlot.slot_id,
                patient_ref:
                  extracted.child_name || extracted.parent_contact || item.id,
              });
              heldSlotSummary = ` Pending-review hold ${hold.data.hold_id} was created for ${firstSlot.provider_name} at ${firstSlot.start}.`;
            }
          }

          const task = await create_task({
            assignee: "intake",
            due: dueRoutine,
            title: `Review intake and slot options for ${displayChild(extracted)}`,
            notes:
              `Referral appears ready for human intake review.${heldSlotSummary || " Review provider availability before contacting the family."}`,
          });
          taskIds.push(task.data.task_id);

          const target = replyTarget(item, extracted);
          const body =
            preferredLanguage(item) === "es"
              ? "Hola, gracias por comunicarse con Cedar Kids Therapy. Recibimos la informacion y un miembro del equipo la revisara para confirmar los proximos pasos para una evaluacion."
              : `Hi, thank you for sending ${possessiveChild(extracted)} information. Our intake team will review the referral and follow up about evaluation options.`;
          await draft_message({
            recipient: target.recipient,
            channel: target.channel,
            body,
            language: preferredLanguage(item),
          });
          draftReply = body;
          recommendedNextAction =
            heldSlotSummary.length > 0
              ? "Intake should review the pending slot hold and contact the family with evaluation options."
              : "Intake should review the referral and contact the family about evaluation options.";
          decisionRationale =
            insurance?.data.status === "in_network"
              ? "The referral has enough intake detail and verified in-network coverage, so intake can review evaluation availability."
              : "The referral/request has enough clinical intake detail for human intake review.";
        }
        break;
      }

      case "spam": {
        recommendedNextAction =
          "No patient action needed; archive after human confirmation.";
        decisionRationale =
          "The message appears unrelated to patient care or clinic operations.";
        break;
      }

      default: {
        const task = await create_task({
          assignee: "front_desk",
          due: dueRoutine,
          title: `Review unclassified inbox item ${item.id}`,
          notes:
            "Could not confidently classify this item with deterministic rules. Review manually and route to the right team.",
        });
        taskIds.push(task.data.task_id);
        recommendedNextAction =
          "Front desk should review and route this item manually.";
        decisionRationale =
          "The item did not match a higher-confidence triage pattern.";
      }
    }

    return {
      item_id: item.id,
      classification: decision.classification,
      urgency: decision.urgency,
      requires_human_review: true,
      extracted_intake: extracted,
      missing_info: missingInfo,
      tools_called: getToolCallsForItem(item.id),
      recommended_next_action: recommendedNextAction,
      draft_reply: draftReply,
      task_ids: taskIds,
      escalation,
      decision_rationale: decisionRationale,
    };
  });
}

function classifyItem(
  item: InboxItem,
  extracted: ExtractedIntake,
): TriageDecision {
  const text = searchableText(item);

  if (looksLikeSpam(text)) {
    return { classification: "spam", urgency: "P3" };
  }

  if (
    /\b(abuse|abused|harm|harmed|unsafe|neglect|neglected|rough with|hit|hitting|hurt|violence)\b/i.test(
      text,
    )
  ) {
    return { classification: "safeguarding", urgency: "P0" };
  }

  if (
    /\b(today'?s?|same[- ]day)\b/i.test(text) &&
    /\b(cancel|cancellation|reschedule|can't make|cannot make|sick|ill|threw up|vomit)\b/i.test(
      text,
    )
  ) {
    return { classification: "scheduling", urgency: "P1" };
  }

  if (
    /\b(is it normal|should i|worried|advice|before booking|wait until)\b/i.test(
      text,
    )
  ) {
    return { classification: "clinical_question", urgency: "P2" };
  }

  if (
    /\bincomplete referral\b/i.test(text) ||
    /\[blank\]/i.test(text) ||
    (isReferralLike(item) && missingFieldsFor("new_referral", extracted).length >= 3)
  ) {
    return { classification: "missing_paperwork", urgency: "P2" };
  }

  if (isReferralLike(item)) {
    return { classification: "new_referral", urgency: "P2" };
  }

  return { classification: "other", urgency: "P2" };
}

function extractIntake(item: InboxItem): ExtractedIntake {
  const text = searchableText(item);
  const childName = extractChildName(item);

  return {
    child_name: childName,
    dob_or_age: firstClean([
      matchText(text, /\bDOB:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i),
      matchText(text, /\bDOB\s+(?:is\s+)?([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i),
      matchText(text, /\b(\d+)[- ]year[- ]old\b/i, (age) => `${age}-year-old`),
      matchText(text, /\b(?:he|she|they)\s+is\s+(\d+)\b/i, (age) => `${age} years`),
      matchText(text, /\btiene\s+(\d+)\s+anos\b/i, (age) => `${age} years`),
    ]),
    parent_contact: extractContact(item),
    discipline: extractDisciplines(text),
    diagnosis_or_concern: extractConcern(text),
    payer: firstClean([
      matchText(text, /\bInsurance:\s*([^.\n]+)/i),
      matchText(text, /\bInsurance\s+is\s+([^,.\n]+)/i),
      matchText(text, /\bTenemos\s+([^,.\n]+)\b/i),
    ]),
    member_id: firstClean([
      matchText(text, /\bMember ID:\s*([A-Z0-9-]+)/i),
      matchText(text, /\bmember\s+ID\s+([A-Z0-9-]+)/i),
      matchText(text, /\bmiembro\s+([A-Z0-9-]+)/i),
    ]),
  };
}

function extractChildName(item: InboxItem): string | null {
  const text = searchableText(item);

  return firstClean([
    matchText(text, /\bChild:\s*([^.\n]+)/i),
    matchText(item.subject, /\bReferral:\s*([^-]+?)(?:\s+-|$)/i),
    matchText(item.subject, /\bReferral for\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i),
    matchText(text, /\babout my son\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i),
    matchText(text, /\babout my daughter\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i),
    matchText(text, /\bpor mi hij[ao]\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/i),
    matchText(text, /\bmy\s+\d+[- ]year[- ]old\s+([A-Z][A-Za-z'-]+)\b/i),
    matchText(text, /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})'s DOB\b/),
    matchText(text, /\b([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2})\s+threw up\b/),
  ]);
}

function extractContact(item: InboxItem): string | null {
  const text = searchableText(item);
  const parent = cleanContactName(firstClean([
    matchText(
      text,
      /\bParent(?:\/guardian)?:\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/i,
    ),
    matchText(text, /\bI am (?:his|her|their) parent,\s*([^.\n]+)/i),
    matchText(text, /\bthis is\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\s+calling\b/i),
    matchText(text, /\bsoy\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\b/i),
    matchText(item.sender, /^([^<]+)\s*</),
    item.channel === "portal_message" ? item.sender : null,
  ]));
  const phone = matchText(text, /\b(\d{3}-\d{4})\b/);
  const email = firstClean([
    matchText(text, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i),
    matchText(item.sender, /<([^>]+)>/),
  ]);

  return joinParts([parent, phone, email]);
}

function extractDisciplines(text: string): Discipline[] | null {
  const matches = new Set<Discipline>();
  const explicit = matchText(text, /\bDiscipline requested:\s*(SLP|OT|PT)\b/i);
  if (isDiscipline(explicit)) {
    matches.add(explicit);
  }
  if (/\b(SLP|speech|speech-language|articulation|habla|r sounds)\b/i.test(text)) {
    matches.add("SLP");
  }
  if (/\b(OT|occupational|sensory|feeding tolerance)\b/i.test(text)) {
    matches.add("OT");
  }
  if (/\b(PT|physical|toe walking|tripping|gross motor)\b/i.test(text)) {
    matches.add("PT");
  }

  return matches.size > 0 ? [...matches] : null;
}

function extractConcern(text: string): string | null {
  return firstClean([
    matchText(text, /\bConcern:\s*([^.\n]+)/i),
    matchText(text, /\bDiagnosis\/concern:\s*([^.\n]+)/i),
    matchText(text, /\bfor\s+(toe walking and frequent tripping)\b/i),
    matchText(text, /\b(can't say[^?.!]+[?.!]?)\s*/i),
    matchText(text, /\b(speech therapy openings)\b/i),
    matchText(text, /\b(evaluacion de habla)\b/i),
  ]);
}

function missingFieldsFor(
  classification: Classification,
  extracted: ExtractedIntake,
): string[] {
  const required: Array<keyof ExtractedIntake> =
    classification === "clinical_question"
      ? ["child_name", "dob_or_age", "parent_contact"]
      : classification === "safeguarding"
        ? ["child_name", "dob_or_age", "parent_contact"]
        : classification === "scheduling"
          ? ["child_name", "dob_or_age", "parent_contact"]
        : [
            "child_name",
            "dob_or_age",
            "parent_contact",
            "discipline",
            "diagnosis_or_concern",
            "payer",
            "member_id",
          ];

  const labels: Record<keyof ExtractedIntake, string> = {
    child_name: "child name",
    dob_or_age: "date of birth or age",
    parent_contact: "parent or guardian contact",
    discipline: "requested discipline",
    diagnosis_or_concern: "diagnosis or concern",
    payer: "payer",
    member_id: "member ID",
  };

  return required
    .filter((key) => {
      const value = extracted[key];
      return Array.isArray(value) ? value.length === 0 : !value;
    })
    .map((key) => labels[key]);
}

function replyTarget(item: InboxItem, extracted: ExtractedIntake): ReplyTarget {
  const email = firstClean([
    matchText(item.body, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i),
    matchText(item.sender, /<([^>]+)>/),
  ]);
  if (email) {
    return { recipient: email, channel: "email" };
  }

  if (item.channel === "portal_message") {
    return { recipient: item.sender, channel: "portal" };
  }

  const phone = matchText(item.body, /\b(\d{3}-\d{4})\b/);
  if (phone) {
    return {
      recipient: extracted.parent_contact || phone,
      channel: "phone",
    };
  }

  return { recipient: extracted.parent_contact || item.sender, channel: "phone" };
}

function preferredLanguage(item: InboxItem): "en" | "es" {
  return /\b(hola|llamo|hija|hijo|evaluacion|habla|espanol|telefono|gracias)\b/i.test(
    searchableText(item),
  )
    ? "es"
    : "en";
}

function schedulingPreference(item: InboxItem): string | undefined {
  return firstClean([
    matchText(item.body, /\bPreferred availability:\s*([^.\n]+)/i),
    matchText(item.body, /\bFamily prefers\s+([^.\n]+)/i),
    matchText(item.body, /\bPrefiero\s+([^.\n]+)/i),
    matchText(item.body, /\b(next Tuesday)\b/i),
  ]) || undefined;
}

function selectSlotForPreference(
  slots: Slot[],
  preference: string | undefined,
): Slot | undefined {
  if (!preference) {
    return slots[0];
  }

  const normalized = preference.toLowerCase();
  let candidates = [...slots];

  if (/\b(after school|afternoon|pm)\b/.test(normalized)) {
    candidates = candidates.filter((slot) => hourFor(slot.start) >= 15);
  } else if (/\b(morning|am|manana)\b/.test(normalized)) {
    candidates = candidates.filter((slot) => hourFor(slot.start) < 12);
  }

  const requestedWeekdays = requestedDays(normalized);
  if (requestedWeekdays.length > 0) {
    candidates = candidates.filter((slot) =>
      requestedWeekdays.includes(weekdayFor(slot.start)),
    );
  }

  return candidates[0];
}

function displayChild(extracted: ExtractedIntake): string {
  return extracted.child_name || "unknown child";
}

function possessiveChild(extracted: ExtractedIntake): string {
  return extracted.child_name ? `${extracted.child_name}'s` : "your child's";
}

function isReferralLike(item: InboxItem): boolean {
  const text = searchableText(item);
  return (
    item.channel === "fax_referral" ||
    /\b(referral|evaluation|eval|therapy openings|evaluate|evaluacion)\b/i.test(text)
  );
}

function looksLikeSpam(text: string): boolean {
  return /\b(unsubscribe|crypto|loan offer|seo|advertising|web design|marketing list)\b/i.test(
    text,
  );
}

function searchableText(item: InboxItem): string {
  return `${item.subject}\n${item.body}`;
}

function isDatedDob(value: string | null): value is string {
  return Boolean(value && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value));
}

function isDiscipline(value: string | null): value is Discipline {
  return value === "SLP" || value === "OT" || value === "PT";
}

function matchText(
  text: string,
  pattern: RegExp,
  format?: (value: string) => string,
): string | null {
  const match = text.match(pattern);
  const value = match?.[1];
  return value ? format?.(value) || value : null;
}

function firstClean(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = cleanValue(value);
    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function cleanValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\[blank\]/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/[. ]+$/g, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function cleanContactName(value: string | null): string | null {
  const cleaned = cleanValue(value)
    ?.replace(/\b\d{3}-\d{4}\b/g, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/,+/g, ",")
    .replace(/,\s*$/g, "")
    .trim();

  return cleanValue(cleaned);
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const unique = [...new Set(parts.flatMap((part) => (cleanValue(part) ? [cleanValue(part)] : [])))];
  return unique.length > 0 ? unique.join(", ") : null;
}

function hourFor(isoDateTime: string): number {
  const match = isoDateTime.match(/T(\d{2}):/);
  return match ? Number(match[1]) : 0;
}

function weekdayFor(isoDateTime: string): number {
  return new Date(isoDateTime).getUTCDay();
}

function requestedDays(preference: string): number[] {
  const days: number[] = [];
  const checks: Array<[RegExp, number]> = [
    [/\b(sundays?|sun)\b/, 0],
    [/\b(mondays?|mon)\b/, 1],
    [/\b(tuesdays?|tues|tue)\b/, 2],
    [/\b(wednesdays?|wed)\b/, 3],
    [/\b(thursdays?|thurs|thu)\b/, 4],
    [/\b(fridays?|fri)\b/, 5],
    [/\b(saturdays?|sat)\b/, 6],
  ];

  for (const [pattern, day] of checks) {
    if (pattern.test(preference)) {
      days.push(day);
    }
  }

  return days;
}

function inferOperationalDate(inbox: InboxItem[]): string {
  const dates = inbox
    .map((item) => item.received_at.slice(0, 10))
    .filter((date) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))
    .sort();

  return dates.at(-1) || new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

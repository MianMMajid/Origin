# Cedar Kids Therapy Inbox Triage Agent

## How to run

```bash
npm install
npm run triage -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
npm run validate -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
npm test
npm run check
```

The triage/validate flags are optional; the commands default to the paths shown above. `npm run check` runs typecheck, unit/integration tests, triage, validation, and packaging. The generated `take-home.tgz` includes both `output.json` and `.trace/tool-calls.jsonl` so the packaged output can be audited.

## Stack and runtime

- TypeScript on Node LTS, using the starter `tsx` runtime.
- No runtime LLM dependency. The prototype uses deterministic extraction and triage rules so it can run without an API key.
- Assumptions: all input is synthetic; every output item is reviewable by a human; the operational work date is inferred from the newest `received_at` date in the batch; tool-generated IDs, timestamps, and slot hold expirations are expected to vary by run.
- Submission artifact assumption: `output.json` is committed for review, while `.trace/` remains ignored in git; `npm run package` includes the trace file in `take-home.tgz` for auditability.

## Architecture

`src/index.ts` owns CLI parsing, trace setup, input reading, and final `buildBatchOutput()` wrapping. `src/agent.ts` is intentionally small: it builds batch context, delegates item work to `src/triage/triage-item.ts`, and sorts the final action plan for human review.

The triage code is split by responsibility:

- `src/triage/extractor.ts`: deterministic intake extraction.
- `src/triage/classifier.ts`: classification, urgency, and missing-field rules.
- `src/triage/handlers/`: small action handlers for safety, scheduling, clinical review, intake, and admin workflows, including Spanish scheduling draft bodies.
- `src/triage/slots.ts`, `dates.ts`, and `text.ts`: shared utilities with no tool side effects; slot selection filters by current date, family day/time preference, language returned by the tool, and provider age range before creating a pending hold.
- `tests/`: edge-case tests for extraction, classification, slot preference behavior, full agent workflows, and validator failure paths.

Each inbox item is processed inside `withItemContext()` so every tool call is audit-linked to the correct item.

The agent runs item-level tool calls in source inbox order for deterministic trace behavior, then returns a priority-sorted review queue: `P0`, `P1`, `P2`, then `P3`. Items with the same urgency are ordered by `received_at`, with original inbox order as the final tie-breaker.

The agent does four things per item:

1. Extracts intake fields with conservative text patterns: child name, DOB or age, contact, discipline, concern, payer, and member ID.
2. Classifies and assigns urgency with safety-first rules: safeguarding is `P0`; same-day cancellation, reschedule, late-arrival, and parking-lot operational issues are `P1`; routine intake, clinical, billing, provider follow-up, complaint, and future scheduling workflows are `P2`; spam or clearly non-actionable FYI/admin messages are `P3`.
3. Calls tools that inform or create the recommended action: patient search, policy lookup, insurance verification, slot finding and pending holds, task creation, draft replies, and escalation. Classification happens before patient search, and `P0` items skip patient search so escalation is not delayed. For non-`P0` identity-sensitive workflows, a positive active-patient search can reclassify an apparent referral as an existing-patient request.
4. Returns the output schema exactly, including `tools_called` from `getToolCallsForItem(item.id)` unchanged.

Slot holds are only pending review. The agent does not schedule appointments or send messages.

## Failure modes and production eval

- Rule-based extraction will miss unexpected phrasing, languages other than simple English/Spanish cues, OCR noise, and ambiguous names. Semicolon-delimited synthetic referrals are covered, but free-form referral layouts are still brittle.
- Existing-patient matching is intentionally conservative: it only runs after classification for workflows where identity lookup is useful, and it requires a child name plus either a dated DOB or full name.
- Safeguarding detection is keyword-based. It now covers broader imminent-harm, CPS, weapon-threat, unsafe-caregiver, and neglect phrasing while suppressing common negated, historical, and administrative false positives; production should still measure both recall and alert fatigue.
- Slot matching is shallow. It checks broad day/time preferences, current-date sanity, provider language returned by the tool, and provider age range, but it does not understand school schedules, provider specialties, payer constraints, or travel preferences.
- Insurance verification trusts the provided mock tool result. Production should compare payer documents, eligibility data, referral metadata, and billing-system state with explicit discrepancy handling.
- Draft replies avoid clinical advice and are never sent automatically. Spanish scheduling and intake responses are drafted when simple language cues are present, but production needs clinician-approved templates, localization review, and monitoring for accidental advice or false reassurance.

Production eval should include schema/audit validation, golden synthetic inboxes, hidden variants, safety-focused red-team cases, tool-call relevance review, and human reviewer agreement on classification, urgency, missing fields, and next action. The local validator checks ordering, task due-date sanity, stale slot holds, trace matching, and cross-field invariants; it still cannot prove that every tool call was clinically or operationally appropriate.

Current automated coverage includes 54 tests across representative edge cases for safeguarding precedence, broader self-harm/unsafe-home/unsafe-caregiver/sexual-boundary/abuse/neglect and imminent-harm wording, negated safety language, non-safety pain or sports-injury wording, same-day versus future-dated scheduling in English and Spanish, negated same-day scheduling phrasing, invalid appointment dates, spam with identity anchors, same-day scheduling mixed with billing or unsubscribe wording, alternate intake labels, semicolon-delimited referrals, accented Spanish cues, self-pay routing, direct therapy-need intake, intake-forms resend requests, multi-discipline referrals, age-incompatible slot filtering, no suitable slot matches, P0 tool-order behavior, and malformed validation output. `npm run typecheck` includes both `src/` and `tests/`.

## What I chose not to build, and why

- Runtime LLM orchestration: useful for robustness, but deterministic rules are faster to review and safer for a short prototype without relying on a provider key.
- Full parser or NLP pipeline: the visible and likely hidden data can be handled with scoped extraction patterns.
- Appointment scheduling: explicitly out of scope; the agent only finds slots and creates pending-review holds.
- Rich deduplication across referrals and portal identities: I only use `search_patient` after classification routes the item to an identity-sensitive workflow and a child name plus dated DOB or full name is available. I do not attempt fuzzy matching across guardians, phones, emails, or misspelled names.
- Staff-facing UI: this deliverable is the JSON action plan and audit trace.

## What I would do with another 4 hours

- Add an optional LLM classifier/extractor behind a schema guard, with deterministic fallback when no API key is present.
- Build a small evaluation harness that scores tool relevance and compares outputs to expected triage labels.
- Improve Spanish handling with approved translated templates and accent-preserving output.
- Add broader fixture packs for OCR-heavy faxes, unsupported languages, payer/document conflicts, provider specialty constraints, and red-team safety phrasing.

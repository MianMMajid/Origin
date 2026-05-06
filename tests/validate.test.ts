import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { tempPath } from "./helpers.js";
import type { BatchOutput, InboxItem, TraceEntry } from "../src/types.js";

describe("validate CLI", () => {
  it("reports malformed output cleanly instead of throwing a stack trace", () => {
    const inputPath = tempPath("input.json");
    const outputPath = tempPath("output.json");
    const tracePath = tempPath("trace.jsonl");

    writeJson(inputPath, []);
    writeJson(outputPath, {
      generated_at: "2026-04-28T15:00:00.000Z",
      summary: {
        total_items: 0,
        p0_count: 0,
        p1_count: 0,
        requires_human_review_count: 0,
      },
    });
    writeFileSync(tracePath, "");

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/validate.ts",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--trace",
        tracePath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /schema:/);
    assert.doesNotMatch(result.stderr, /TypeError|Cannot read/);
  });

  it("reports priority ordering violations", () => {
    const input = [
      inbox("routine", "2026-04-28T08:00:00-07:00"),
      inbox("safety", "2026-04-28T09:00:00-07:00"),
    ];
    const output = batch([
      item("routine", "other", "P2", [
        call("task_1", "create_task", "routine", {
          assignee: "front_desk",
          title: "Review routine",
          due: "2026-04-28",
          notes: "Review.",
        }),
        call("policy_1", "lookup_policy", "routine", { topic: "scheduling" }),
      ]),
      item(
        "safety",
        "safeguarding",
        "P0",
        [
          call("esc_1", "escalate", "safety", {
            item_id: "safety",
            reason: "risk",
            severity: "P0",
          }),
        ],
        { reason: "risk", severity: "P0" },
      ),
    ]);

    const result = runValidate(input, output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ordering:/);
  });

  it("reports stale slot holds and impossible task due dates", () => {
    const input = [inbox("item_1", "2026-04-28T08:00:00-07:00")];
    const output = batch([
      item("item_1", "new_referral", "P2", [
        call("task_1", "create_task", "item_1", {
          assignee: "intake",
          title: "Review referral",
          due: "2026-04-27",
          notes: "Review.",
        }),
        call("hold_1", "hold_slot", "item_1", {
          slot_id: "slot_1",
          patient_ref: "Test Child",
        }),
        call("policy_1", "lookup_policy", "item_1", { topic: "service_lines" }),
      ]),
    ]);

    const result = runValidate(input, output);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /due date:/);
    assert.match(result.stderr, /slot hold:/);
  });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runValidate(
  input: InboxItem[],
  output: BatchOutput,
): SpawnSyncReturns<string> {
  const inputPath = tempPath("input.json");
  const outputPath = tempPath("output.json");
  const tracePath = tempPath("trace.jsonl");

  writeJson(inputPath, input);
  writeJson(outputPath, output);
  writeFileSync(
    tracePath,
    `${output.items
      .flatMap((item) =>
        item.tools_called.map((toolCall) =>
          JSON.stringify({
            ...toolCall,
            item_id: item.item_id,
            timestamp: "2026-04-28T12:00:00.000Z",
          } satisfies TraceEntry),
        ),
      )
      .join("\n")}\n`,
  );

  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/validate.ts",
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--trace",
      tracePath,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

function inbox(id: string, receivedAt: string): InboxItem {
  return {
    id,
    channel: "email",
    received_at: receivedAt,
    sender: "Test <test@example.com>",
    subject: "Test",
    body: "Test",
    attachments: [],
  };
}

function batch(items: BatchOutput["items"]): BatchOutput {
  return {
    generated_at: "2026-04-28T12:00:00.000Z",
    summary: {
      total_items: items.length,
      p0_count: items.filter((entry) => entry.urgency === "P0").length,
      p1_count: items.filter((entry) => entry.urgency === "P1").length,
      requires_human_review_count: items.length,
    },
    items,
  };
}

function item(
  itemId: string,
  classification: BatchOutput["items"][number]["classification"],
  urgency: BatchOutput["items"][number]["urgency"],
  toolsCalled: BatchOutput["items"][number]["tools_called"],
  escalation: BatchOutput["items"][number]["escalation"] = null,
): BatchOutput["items"][number] {
  return {
    item_id: itemId,
    classification,
    urgency,
    requires_human_review: true,
    extracted_intake: {
      child_name: null,
      dob_or_age: null,
      parent_contact: null,
      discipline: null,
      diagnosis_or_concern: null,
      payer: null,
      member_id: null,
    },
    missing_info: [],
    tools_called: toolsCalled,
    recommended_next_action: "Review.",
    draft_reply: null,
    task_ids: [],
    escalation,
    decision_rationale: "Test fixture.",
  };
}

function call(
  callId: string,
  name: string,
  itemId: string,
  args: Record<string, unknown>,
): BatchOutput["items"][number]["tools_called"][number] {
  const resultSummary =
    name === "hold_slot"
      ? "created pending_review hold hold_test until 2026-04-28T11:00:00.000Z"
      : name === "create_task"
        ? `created task task_${callId} for ${args.assignee || "front_desk"}`
        : name === "escalate"
          ? "created escalation esc_test severity P0"
          : `fixture ${name} for ${itemId}`;

  return {
    call_id: callId,
    name,
    args,
    result_summary: resultSummary,
  };
}

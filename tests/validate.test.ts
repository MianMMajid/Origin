import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { tempPath } from "./helpers.js";

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
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

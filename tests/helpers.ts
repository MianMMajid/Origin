import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboxItem } from "../src/types.js";

export function inboxItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "test_item",
    channel: "email",
    received_at: "2026-04-28T08:00:00-07:00",
    sender: "Test Sender <test@example.com>",
    subject: "Test message",
    body: "",
    attachments: [],
    ...overrides,
  };
}

export function tempPath(filename: string): string {
  return join(mkdtempSync(join(tmpdir(), "cedar-triage-")), filename);
}

import { draft_message } from "../../tools.js";
import type { ActionInput } from "../model.js";
import { preferredLanguage, replyTarget } from "../extractor.js";

export async function draftReplyFor(
  item: ActionInput["item"],
  extracted: ActionInput["extracted"],
  body: string,
): Promise<string> {
  const target = replyTarget(item, extracted);
  await draft_message({
    recipient: target.recipient,
    channel: target.channel,
    body,
    language: preferredLanguage(item),
  });

  return body;
}

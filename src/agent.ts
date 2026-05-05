import type { InboxItem, ItemOutput } from "./types.js";
import { inferOperationalDate } from "./triage/dates.js";
import type { TriageContext } from "./triage/model.js";
import { triageItem } from "./triage/triage-item.js";

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

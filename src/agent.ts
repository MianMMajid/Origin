import type { InboxItem, ItemOutput, Urgency } from "./types.js";
import { inferOperationalDate } from "./triage/dates.js";
import type { TriageContext } from "./triage/model.js";
import { triageItem } from "./triage/triage-item.js";

const URGENCY_RANK: Record<Urgency, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export async function runAgent(inbox: InboxItem[]): Promise<ItemOutput[]> {
  const context: TriageContext = {
    operationalDate: inferOperationalDate(inbox),
  };
  const outputs: ItemOutput[] = [];

  // Keep item processing sequential so trace entries are deterministic and
  // easier for reviewers to audit against the final sorted action plan.
  for (const item of inbox) {
    outputs.push(await triageItem(item, context));
  }

  return sortForHumanReview(outputs, inbox);
}

function sortForHumanReview(
  outputs: ItemOutput[],
  inbox: InboxItem[],
): ItemOutput[] {
  // Preserve received order within the same urgency so routine items remain
  // predictable while P0/P1 work is lifted to the top.
  const inputOrder = new Map(
    inbox.map((item, index) => [
      item.id,
      { index, receivedAt: Date.parse(item.received_at) },
    ]),
  );

  // Tool calls run in inbox order for stable audit traces. Only the returned
  // action plan is sorted so reviewers see the most time-sensitive work first.
  return [...outputs].sort((left, right) => {
    const urgencyDelta = URGENCY_RANK[left.urgency] - URGENCY_RANK[right.urgency];
    if (urgencyDelta !== 0) {
      return urgencyDelta;
    }

    const leftMeta = inputOrder.get(left.item_id);
    const rightMeta = inputOrder.get(right.item_id);
    const leftReceived = leftMeta?.receivedAt ?? Number.POSITIVE_INFINITY;
    const rightReceived = rightMeta?.receivedAt ?? Number.POSITIVE_INFINITY;
    const receivedDelta = leftReceived - rightReceived;
    if (receivedDelta !== 0 && Number.isFinite(receivedDelta)) {
      return receivedDelta;
    }

    return (leftMeta?.index ?? 0) - (rightMeta?.index ?? 0);
  });
}

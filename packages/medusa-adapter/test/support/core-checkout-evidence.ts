import { expect } from "vitest";
import type { CoreNativeWorkflowFixture, CoreNativeWorkflowSnapshot } from "./core-native-workflow-fixture";

type Inventory = Awaited<ReturnType<CoreNativeWorkflowFixture["inventory"]>>;

/** A terminal request record fences the attempt without publishing business or event data. */
export async function expectCheckoutRollback(fixture: CoreNativeWorkflowFixture, before: Inventory, key: string) {
  const after = await fixture.inventory();
  expect(after.outcomes.filter(record => record.value.key === key)).toMatchObject([
    { value: { key, kind: "nativeRoot", state: "failed" } },
  ]);
  expect({ ...after, outcomes: after.outcomes.filter(record => record.value.key !== key) }).toEqual(before);
}

/** Compare durable Core records directly. Request claims have their own timestamps. */
export function expectCheckoutSettlement(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string) {
  const outcomes = after.outcomes.slice(before.outcomes.length), [outcome] = outcomes;
  expect(outcomes).toMatchObject([{ value: { key, kind: "nativeRoot", state: "committed" } }]);
  if (outcome === undefined) throw new Error("Missing settled checkout outcome");
  const previous = before.revisions.reduce((latest, row) => row.timestamp > latest ? row.timestamp : latest, 0n);
  const revisions = after.revisions.filter(row => row.timestamp > previous);
  expect(revisions.length).toBeGreaterThan(0);
  expect(after.revisions.length - before.revisions.length).toBe(revisions.length);
  const published = [...revisions, ...after.events.slice(before.events.length),
    ...after.families.slice(before.families.length), ...after.deliveries.slice(before.deliveries.length)];
  expect(new Set(published.map(row => row.timestamp))).toEqual(new Set([outcome.timestamp]));
  return outcome.timestamp;
}

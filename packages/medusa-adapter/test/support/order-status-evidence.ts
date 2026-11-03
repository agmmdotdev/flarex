import { Schema } from "effect";
import { expect } from "vitest";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CoreNativeWorkflowSnapshot } from "./core-native-workflow-fixture";

const decodeEventIds = Schema.decodeUnknownSync(Schema.Array(Schema.String));

export function expectOrderStatusCommit(
  before: CoreNativeWorkflowSnapshot,
  after: CoreNativeWorkflowSnapshot,
  key: string,
  ids: readonly string[],
  messages: readonly (readonly string[])[],
  subscriberId: string,
) {
  const outcome = after.outcomes.find(record => record.value.key === key);
  if (outcome === undefined) throw new Error("Missing durable native Order status outcome");
  expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
  expect(after.outcomes.length - before.outcomes.length).toBe(1);
  expect(after.rows).toHaveLength(before.rows.length);
  expect(after.revisions.length - before.revisions.length).toBe(ids.length);
  const revisions = after.revisions.filter(row => row.timestamp === outcome.timestamp);
  expect(revisions.map(row => row.value?.id).sort()).toEqual(ids.toSorted());
  for (const revision of revisions) {
    expect(revision.deleted).toBe(false);
    const prior = before.rows.find(row => row.table === revision.table && row.value._id === revision.value?._id);
    if (prior === undefined) throw new Error("Missing original Order revision");
    expect(revision.previous).toBe(prior.timestamp);
    expect(after.rows.find(row => row.table === revision.table && row.value._id === revision.value?._id))
      .toEqual({ table: revision.table, timestamp: outcome.timestamp, value: revision.value });
    const priorIndexes = before.indexes.filter(row => row.table === revision.table && row.id === revision.id);
    expect(priorIndexes).toContainEqual(expect.objectContaining({ name: "by_id" }));
    const indexes = after.indexes.filter(row => row.table === revision.table && row.id === revision.id);
    expect(indexes).toEqual(priorIndexes.map(row => ({ ...row, timestamp: outcome.timestamp })));
  }

  const events = after.events.filter(event => !before.events.some(prior =>
    prior.familyId === event.familyId && prior.ordinal === event.ordinal));
  const vector = events.flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data))
      throw new Error("Missing complete native Order event");
    const eventIds = decodeEventIds(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
    return eventIds.map(id => [event.envelope.contract, id]);
  });
  expect(vector).toEqual(messages);
  const familyId = events[0]?.familyId;
  if (familyId === undefined) throw new Error("Missing committed Order event family");
  expect(events.every(event => event.timestamp === outcome.timestamp && event.familyId === familyId)).toBe(true);
  expect(after.families.length - before.families.length).toBe(1);
  expect(after.families.filter(row => row.timestamp === outcome.timestamp))
    .toMatchObject([{ value: { id: familyId, event_count: events.length } }]);
  expect(after.deliveries.length - before.deliveries.length).toBe(events.length);
  expect(after.deliveries.filter(row => row.timestamp === outcome.timestamp)).toMatchObject(events.map(event => ({
    value: { family_id: familyId, ordinal: event.ordinal, subscriber_id: subscriberId, state: "pending" },
  })));
  return outcome;
}

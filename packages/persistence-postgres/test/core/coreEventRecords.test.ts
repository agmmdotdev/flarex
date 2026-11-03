import { Effect, Option } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJson, isJsonObject, type JsonObject } from "flarex-protocol/json";
import { CoreNativeBudgetError, CoreNativeUniqueConflict, CoreQueryInputError, issueCoreNativeBinding, issueFinalizedTransaction,
  type CoreNativeOperations } from "../../src/core/api";
import type { CoreNativeDefinition } from "../../src/core/nativePolicy";
import { compileCoreNativeEventDefinition } from "../../src/commit/events/coreDefinition";
import { makeCoreCommitEventPump, makeCoreCommitEventStore, stageCoreCommitEventFamily, type CoreCommitEventStoreInput } from "../../src/commit/events/coreStore";
import { commitEventsDigest } from "../../src/commit/events/digest";
import { CommitEventSubscriberFailure, commitEventLimits, type CommittedEvent } from "../../src/commit/events/model";

const subscriber = { id: "indexer", revision: "d".repeat(64) };
const policy = { producerRevision: "a".repeat(64), contracts: [{ name: "product.created", revision: "b".repeat(64), internal: true }], subscribers: [subscriber] };
const event = (id: string): CommittedEvent => ({ contract: "product.created", contractRevision: "b".repeat(64), producerRevision: "a".repeat(64),
  internal: true, group: "native/group", message: { id }, subscribers: [subscriber] });
let definition: CoreNativeDefinition;
beforeAll(async () => { definition = await Effect.runPromise(compileCoreNativeEventDefinition({
  scopeUuid: "040557e2-a0c6-4db0-af27-0018f721badf", epochUuid: "d23cd996-47c9-4760-9284-e89ba2e39923", policy,
})); });

/** Pure event-record fixture only: this does not implement Core isolation or
 * persistence. Database integration tests own atomicity/conflict/recovery proof. */
function fixture() {
  const rows = new Map<string, DocumentObject[]>();
  const writes: unknown[] = [], pages: unknown[] = [];
  let now = Date.parse("2026-11-01T00:00:00.000Z");
  const unexpected = () => Effect.die(new Error("Unexpected Core operation in pure event-record test"));
  const put = (table: string, value: JsonObject): DocumentObject => {
    const current = rows.get(table) ?? [];
    const previous = current.find(row => row.id === value.id);
    const next: DocumentObject = { ...previous, ...value, _id: `core/${value.id}`, _creationTime: now };
    if (previous !== undefined) current.splice(current.indexOf(previous), 1, next); else current.push(next);
    rows.set(table, current);
    return next;
  };
  const operations: CoreNativeOperations = {
    nativeActivityCursor: () => { throw new Error("Fixed event records do not request native activity"); },
    nativeActivitySince: unexpected, matchRelational: unexpected, replayRows: unexpected, reconstituteRows: unexpected,
    checkpointReferences: unexpected, planSetNullReferences: unexpected,
    get: unexpected, getMany: unexpected, patch: unexpected, replace: unexpected,
    delete: unexpected, normalizeId: unexpected, incomingReferences: unexpected, pendingDelete: unexpected, assertPendingDelete: unexpected,
    deleteRows: unexpected, lifecycle: unexpected, prepareDeleteClosure: unexpected, replaceReferenceSet: unexpected,
    referenceReplacementChanges: unexpected, protectedReferencePage: unexpected, assertProtectedReferenceGeneration: unexpected, isEmpty: unexpected,
    insert: (table, input) => Effect.sync(() => {
      if (!isJson(input) || !isJsonObject(input)) throw new Error("Invalid fixture insertion");
      writes.push({ table, mode: "insert", input: [input] });
      const document = put(table, input);
      if (typeof document._id !== "string") throw new Error("Fixture insertion lost identity");
      return document._id;
    }),
    find: (table, where) => Effect.sync(() => (rows.get(table) ?? []).filter(row => Object.entries(where).every(([field, value]) => row[field] === value))),
    findPage: (table, where, options) => Effect.sync(() => {
      pages.push({ table, where, options });
      const id = where.id;
      const after = isJsonObject(id) && typeof id.gt === "string" ? id.gt : "";
      const ordered = [...rows.get(table) ?? []].filter(row => typeof row.id === "string" && row.id > after)
        .sort((left, right) => String(left.id) < String(right.id) ? -1 : 1);
      return { documents: ordered.slice(0, options.limit), hasMore: ordered.length > options.limit };
    }),
    writeRows: (table, mode, input) => Effect.sync(() => {
      if (!Array.isArray(input) || !input.every(isJsonObject)) throw new Error("Invalid fixture write");
      writes.push({ table, mode, input });
      return input.map(value => put(table, value));
    }),
  };
  const binding = issueCoreNativeBinding();
  const database: CoreCommitEventStoreInput["database"] = {
    resolveCommittedNativeRootRequest: unexpected,
    readNativeBinding: () => Effect.succeed({ definition, namespace: null, schemaId: "schema", authorityEpoch: 0n, tables: [], commands: definition.commands }),
    beginNative: (_binding, options) => {
      const command = definition.commands.find(command => command.name === options.commandName);
      if (command === undefined) return unexpected();
      return Effect.succeed({ command, operations, unixTime: now, finishRead: () => Effect.succeed({ timestamp: 0n, reads: [] }),
        finalize: () => Effect.succeed(issueFinalizedTransaction()), abort: () => Effect.void });
    }, commit: () => Effect.succeed(0n),
  };
  const stage = (id: string, values: readonly CommittedEvent[]) => Effect.gen(function* () {
    const sha256 = values.length === 0 ? null : yield* commitEventsDigest(values);
    yield* stageCoreCommitEventFamily(operations, definition, id, { values, sha256 }, now);
  });
  return { rows, writes, pages, operations, input: { database, binding }, stage, advance: (milliseconds: number) => { now += milliseconds; } };
}

describe("private Core native event records", () => {
  it("captures the selected scope before asynchronous source hashing", async () => {
    const target = { scopeUuid: "040557e2-a0c6-4db0-af27-0018f721badf", epochUuid: "d23cd996-47c9-4760-9284-e89ba2e39923", policy };
    const expected = { scopeUuid: target.scopeUuid, epochUuid: target.epochUuid };
    const running = Effect.runPromise(compileCoreNativeEventDefinition(target));
    target.scopeUuid = "0617fdc6-e30e-4d59-83aa-b8881384f264";
    target.epochUuid = "10ceab98-9b60-4da7-9558-747539f6c67c";
    expect((await running).identity).toMatchObject(expected);
  });

  it("compiles exactly private roles and stages an ordered policy-pinned family", async () => {
    expect(definition.source.owner).toBe("system");
    expect(definition.source.bindings.every(binding => binding.table.namespace === "system")).toBe(true);
    if (definition.source.definition.kind !== "relational") throw new Error("Missing event record schema");
    expect(definition.source.definition.schema.capabilities).toEqual([]);
    expect(definition.source.definition.schema.tables.every(table => table.columns.every(column => column.default.kind === "none"))).toBe(true);
    expect(definition.tables.map(table => table.privateEvent?.role).sort()).toEqual(["delivery", "envelope", "family"]);
    expect(definition.foreignKeys).toBeUndefined();
    const f = fixture();
    await Effect.runPromise(f.stage("family", [event("first"), event("second")]));
    const store = await Effect.runPromise(makeCoreCommitEventStore(f.input));
    expect((await Effect.runPromise(store.readFamily("family"))).events.map(value => value.message)).toEqual([{ id: "first" }, { id: "second" }]);
    const first = await Effect.runPromise(store.nextFamily());
    expect(Option.getOrNull(first)).toBe("family");
    expect(f.pages).toHaveLength(1);
    expect(f.pages[0]).toMatchObject({ options: { offset: 0, limit: 1 } });
    const before = f.writes.length;
    await Effect.runPromise(f.stage("empty", []));
    expect(f.writes).toHaveLength(before);
  });

  it("refuses mismatched digests, unadmitted producer policy and eligibility before writing", async () => {
    const f = fixture();
    await expect(Effect.runPromise(stageCoreCommitEventFamily(f.operations, definition, "bad", { values: [event("bad")], sha256: "c".repeat(64) }, 0)))
      .rejects.toMatchObject({ reason: "invalidInput" });
    await expect(Effect.runPromise(f.stage("wrong", [{ ...event("wrong"), producerRevision: "e".repeat(64) }])))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
    await expect(Effect.runPromise(f.stage("held", [{ ...event("held"), eligibility: [{ groupId: "hold", ownerIdentity: "a".repeat(64),
      policyRevision: "b".repeat(64), maximumCommits: 1 }] }])))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(f.writes).toEqual([]);
  });

  it.each([
    { cause: new CoreNativeBudgetError({ reason: "limitExceeded" }), reason: "limitExceeded" },
    { cause: new CoreNativeBudgetError({ reason: "rollbackOnly" }), reason: "invalidAuthority" },
    { cause: new CoreNativeBudgetError({ reason: "closed" }), reason: "invalidAuthority" },
    { cause: new CoreNativeBudgetError({ reason: "unexpectedFailure" }), reason: "resourceFailure" },
    { cause: new CoreNativeUniqueConflict({ tableName: "event-family", descriptor: "primary", fields: ["id"] }), reason: "invalidInput" },
    { cause: new CoreQueryInputError({ reason: "invalidQuery" }), reason: "invalidInput" },
  ])("preserves Core boundary classification $reason and its original cause", async ({ cause, reason }) => {
    const f = fixture(), values = [event("boundary")];
    const sha256 = await Effect.runPromise(commitEventsDigest(values));
    const operations: CoreNativeOperations = { ...f.operations, insert: () => Effect.fail(cause) };
    await expect(Effect.runPromise(stageCoreCommitEventFamily(operations, definition, "boundary", { values, sha256 }, 0)))
      .rejects.toMatchObject({ reason, cause });
    expect(f.writes).toEqual([]);
  });

  it("verifies delivery completeness and ordered digest on every family read", async () => {
    const f = fixture();
    await Effect.runPromise(f.stage("family", [event("one"), event("two")]));
    const store = await Effect.runPromise(makeCoreCommitEventStore(f.input));
    const deliveries = definition.tables.find(table => table.privateEvent?.role === "delivery");
    if (deliveries === undefined) throw new Error("Missing delivery role");
    f.rows.get(deliveries.name)?.pop();
    await expect(Effect.runPromise(store.readFamily("family"))).rejects.toMatchObject({ reason: "storedCorruption" });
  });

  it("retains claim fencing, lease expiry and durable retry state", async () => {
    const f = fixture();
    await Effect.runPromise(f.stage("family", [event("one")]));
    const store = await Effect.runPromise(makeCoreCommitEventStore(f.input));
    const [first] = await Effect.runPromise(store.claimBatch("family", [subscriber], 1));
    if (first === undefined) throw new Error("Missing first claim");
    await expect(Effect.runPromise(store.settle(first, new CommitEventSubscriberFailure({ retryable: true, code: "class-input" }))))
      .rejects.toMatchObject({ reason: "invalidInput" });
    expect((await Effect.runPromise(store.readFamily("family"))).deliveries[0]).toMatchObject({ state: "claimed", attempts: 1, fence: "1" });
    expect(await Effect.runPromise(store.claimBatch("family", [subscriber], 1))).toEqual([]);
    f.advance(commitEventLimits.leaseMs + 1);
    const [second] = await Effect.runPromise(store.claimBatch("family", [subscriber], 1));
    if (second === undefined) throw new Error("Missing replacement claim");
    expect(second.message.eventId).toBe(first.message.eventId);
    await expect(Effect.runPromise(store.settle(first))).rejects.toMatchObject({ reason: "staleClaim" });
    await Effect.runPromise(store.settle(second, { retryable: true, code: "temporary" }));
    expect((await Effect.runPromise(store.readFamily("family"))).deliveries[0]).toMatchObject({ state: "pending", attempts: 2, fence: "2", failure_code: "temporary" });
    f.advance(2001);
    const [third] = await Effect.runPromise(store.claimBatch("family", [subscriber], 1));
    if (third === undefined) throw new Error("Missing retry claim");
    await Effect.runPromise(store.settle(third));
    expect((await Effect.runPromise(store.readFamily("family"))).deliveries[0]).toMatchObject({ state: "delivered", attempts: 3, fence: "3" });
    expect(await Effect.runPromise(store.claimBatch("family", [{ ...subscriber, revision: "f".repeat(64) }], 1))).toEqual([]);
  });

  it("repair reset finds a family published behind its opaque directory cursor", async () => {
    const f = fixture();
    await Effect.runPromise(f.stage("z-family", [event("z")]));
    const delivered: string[] = [];
    const pump = await Effect.runPromise(makeCoreCommitEventPump(f.input, [{ ...subscriber,
      handle: message => Effect.sync(() => { delivered.push(message.eventId); }) }]));
    const first = await Effect.runPromise(pump.runNext());
    expect(first).toMatchObject({ done: false, cursor: "z-family", delivered: 1 });
    await Effect.runPromise(f.stage("a-family", [event("a")]));
    const end = await Effect.runPromise(pump.runNext(first.cursor));
    expect(end).toMatchObject({ done: true, cursor: undefined });
    const repaired = await Effect.runPromise(pump.runNext(end.cursor));
    expect(repaired).toMatchObject({ cursor: "a-family", delivered: 1 });
    expect(delivered).toHaveLength(2);
  });
});

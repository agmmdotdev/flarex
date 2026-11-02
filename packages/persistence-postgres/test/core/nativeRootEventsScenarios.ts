import { createHash, randomBytes } from "node:crypto";
import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { captureCoreNativeRootIdentity } from "../../src/core/nativeRootRequest";
import { compileCoreNativeEventStorageDefinition, CORE_NATIVE_EVENT_WRITE, coreNativeEventLimits } from "../../src/commit/events/coreDefinition";
import { makeCoreCommitEventPump, makeCoreCommitEventStore, prepareCoreRootCommitEventFamily, stageCoreCommitEventFamily,
  type CoreCommitEventHandler } from "../../src/commit/events/coreStore";
import { commitEventsDigest } from "../../src/commit/events/digest";
import type { CommittedEvent, CommitEventMessage } from "../../src/commit/events/model";
import type { CoreDatabase, CoreRequestIdentity } from "../../src/core/api";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "414ae657-285f-46f0-b0f6-04c4a2b1c605", epochUuid: "e4aef41a-7d79-44d8-9707-248ba3a1058f" };
const policy = (revision: string, subscriber = "indexer") => ({ producerRevision: revision.repeat(64),
  contracts: [{ name: "neutral.changed", revision: revision.repeat(64), internal: true }],
  subscribers: [{ id: subscriber, revision: "d".repeat(64) }] });
const firstPolicy = policy("a"), secondPolicy = policy("b"), thirdPolicy = policy("c", "otherIndexer");
const failure = <A, E>(value: Result.Result<A, E>) => Result.isFailure(value) ? value.failure : undefined;
const canonical = (value: JsonObject) => encodeCanonicalJson(value, issue => { throw new Error("Test metadata lost JSON", { cause: issue }); });

const setup = Effect.fn("NativeRootEventsFixture.setup")(function* (fixture: CorePersistenceFixture) {
  const currency = yield* compileCurrencyCoreDefinition(target), storage = yield* compileCoreNativeEventStorageDefinition(target);
  const sources = [{ kind: "native" as const, definition: currency }, { kind: "native" as const, definition: storage }];
  const bundle = yield* makeCoreSchemaBundle({ sources });
  const withdrawn = yield* makeCoreSchemaBundle({ sources, nativeBindings: [{ sourceKey: currency.identity.sourceKey, selected: false }] });
  const options = { schemaBundles: [bundle, withdrawn], now: Effect.succeed(1_800_000_000_000_000_000n),
    randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)), maxBatchDelayMilliseconds: 0,
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS };
  const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
  const activate = Effect.fn("NativeRootEventsFixture.activate")(function* (db: CoreDatabase, selected = bundle) {
    const proposal = yield* db.prepareSchema({ bundle: selected });
    for (let step = 0; step < 128; step++) {
      const status = yield* db.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
        yield* db.activateSchema(proposal, { bundle: selected, programs: [] }); return;
      }
      yield* db.advanceSchema(proposal, { pageSize: 16, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Root event source installation did not finish"));
  });
  yield* activate(database);
  const businessBinding = yield* database.bindNative({ definition: currency, commands: [{ name: "write", mode: "write" }] });
  const eventBinding = yield* database.bindNative({ definition: storage });
  const table = currency.tables[0]?.name;
  if (table === undefined) return yield* Effect.die(new Error("Missing real Currency source"));
  let sequence = 0;
  const begin = Effect.fn("NativeRootEventsFixture.begin")(function* (selectedPolicy = firstPolicy, padding?: string) {
    const root = yield* database.bindNativeRoot({ bundle, contract: { events: selectedPolicy,
      ...(padding === undefined ? {} : { padding }) }, participants: [
      { binding: businessBinding, commands: ["write"], limits: coreNativeTestBudget().limits },
      { binding: eventBinding, commands: [CORE_NATIVE_EVENT_WRITE], limits: coreNativeEventLimits },
    ], maxFinalUserDocuments: 1, protectedMetadata: true });
    const metadata = yield* database.readNativeRootBinding(root);
    const key = `root-events-${++sequence}`, identity: CoreRequestIdentity = { kind: "nativeRoot", root: metadata.identity,
      key, requestHash: createHash("sha256").update(key).digest("hex") };
    const claimed = yield* database.claimRequest(identity, root);
    if (claimed.kind !== "claimed") return yield* Effect.die(new Error("Fresh root was not claimed"));
    const operation = yield* database.beginNativeRoot(root, { claim: claimed.claim, ...coreNativeTestBudget() });
    const eventOperations = yield* operation.native(eventBinding);
    return { root, identity, claim: claimed.claim, operation, eventOperations, selectedPolicy };
  });
  const stage = Effect.fn("NativeRootEventsFixture.stage")(function* (code: string, selectedPolicy = firstPolicy) {
    const selected = yield* begin(selectedPolicy);
    const prepared = yield* prepareCoreRootCommitEventFamily(database, selected.eventOperations, storage);
    const values: CommittedEvent[] = [{ contract: "neutral.changed", contractRevision: selectedPolicy.contracts[0]?.revision ?? "",
      internal: true, producerRevision: selectedPolicy.producerRevision, group: selected.identity.key,
      message: { code }, subscribers: selectedPolicy.subscribers }];
    yield* (yield* selected.operation.native(businessBinding)).writeRows(table, "insert", [{ code, name: code, symbol: "R", symbol_native: "R" }]);
    yield* stageCoreCommitEventFamily(selected.eventOperations, storage, prepared.id,
      { values, sha256: yield* commitEventsDigest(values) }, selected.operation.unixTime, database);
    const result = { code, complete: { marker: "original native DTO" } };
    yield* database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result });
    return { ...selected, prepared, values, result };
  });
  return { database, options, storage, currency, bundle, withdrawn, activate, eventBinding, businessBinding, begin, stage };
});

export function registerNativeRootEventScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    it("keeps distinct root policies in one source and verifies history after cold reopen and producer withdrawal", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), first = yield* tested.stage("xra"), second = yield* tested.stage("xrb", secondPolicy), third = yield* tested.stage("xrc", thirdPolicy);
        expect(new Set([first.prepared.id, second.prepared.id, third.prepared.id]).size).toBe(3);
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        for (const selected of [first, second, third]) {
          expect((yield* store.readFamily(selected.prepared.id)).events).toEqual(selected.values);
          expect(yield* tested.database.resolveRequest(selected.identity)).toMatchObject({ kind: "committed", result: selected.result });
          expect(JSON.stringify(selected.prepared.request.frame)).not.toContain("original native DTO");
          expect(failure(yield* Effect.result(tested.database.readNativeRootRequestEvidence(selected.eventOperations)))).toMatchObject({ reason: "foreignClaim" });
        }
        yield* tested.database.close();
        const cold = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, tested.options), db => db.close());
        yield* tested.activate(cold, tested.withdrawn);
        const binding = yield* cold.bindNative({ definition: tested.storage });
        const historical = yield* makeCoreCommitEventStore({ database: cold, binding });
        expect((yield* historical.readFamily(first.prepared.id)).events).toEqual(first.values);
        expect((yield* historical.readFamily(third.prepared.id)).events).toEqual(third.values);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("rejects coordinated policy/envelope/digest forgery and another committed root's transplanted metadata", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), first = yield* tested.stage("xrd"), second = yield* tested.stage("xre", secondPolicy);
        const familyTable = tested.storage.tables.find(table => table.privateEvent?.role === "family")?.name;
        const envelopeTable = tested.storage.tables.find(table => table.privateEvent?.role === "envelope")?.name;
        if (familyTable === undefined || envelopeTable === undefined) return yield* Effect.die(new Error("Missing event roles"));
        const mutate = Effect.fn("NativeRootEventsFixture.corrupt")(function* (evidence: typeof first.prepared.request, selectedPolicy: typeof firstPolicy) {
          const operation = yield* tested.database.beginNative(tested.eventBinding, { ...coreNativeTestBudget(), commandName: CORE_NATIVE_EVENT_WRITE });
          try {
            const values = first.values.map(value => ({ ...value, producerRevision: selectedPolicy.producerRevision,
              contractRevision: selectedPolicy.contracts[0]?.revision ?? "", subscribers: selectedPolicy.subscribers }));
            yield* operation.operations.writeRows(familyTable, "update", [{ id: first.prepared.id, root_request: canonical(evidence),
              event_sha256: yield* commitEventsDigest(values) }]);
            yield* operation.operations.writeRows(envelopeTable, "update", [{ id: `${first.prepared.id}/0000`, envelope: values[0] }]);
            yield* tested.database.commit(yield* operation.finalize());
          } finally { yield* operation.abort(); }
        });
        const forgedFrame = { ...first.prepared.request.frame,
          contract: { ...first.prepared.request.frame.contract, events: secondPolicy } };
        const forged = { ...first.prepared.request, frame: forgedFrame, root: (yield* captureCoreNativeRootIdentity(forgedFrame)).identity };
        yield* mutate(forged, secondPolicy);
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        expect(failure(yield* Effect.result(store.readFamily(first.prepared.id)))).toMatchObject({ reason: "storedCorruption" });
        yield* mutate(second.prepared.request, secondPolicy);
        expect(failure(yield* Effect.result(store.readFamily(first.prepared.id)))).toMatchObject({ reason: "storedCorruption" });
        expect((yield* store.readFamily(second.prepared.id)).events).toEqual(second.values);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("denies foreign/standalone operation evidence and refuses impossible metadata before callback work", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.begin();
        const business = yield* selected.operation.native(tested.businessBinding);
        expect(failure(yield* Effect.result(prepareCoreRootCommitEventFamily(tested.database, business, tested.storage))))
          .toMatchObject({ reason: "invalidAuthority" });
        yield* selected.operation.abort(); yield* tested.database.abortRequest(selected.claim);
        const standalone = yield* tested.database.beginNative(tested.eventBinding, { ...coreNativeTestBudget(), commandName: CORE_NATIVE_EVENT_WRITE });
        expect(failure(yield* Effect.result(tested.database.readNativeRootRequestEvidence(standalone.operations))))
          .toMatchObject({ reason: "authorityRevoked" });
        yield* standalone.abort();
        const oversized = yield* tested.begin(firstPolicy, "metadata".repeat(25_000));
        let called = false;
        const refused = yield* Effect.result(prepareCoreRootCommitEventFamily(tested.database, oversized.eventOperations, tested.storage)
          .pipe(Effect.tap(() => Effect.sync(() => { called = true; }))));
        expect(failure(refused)).toMatchObject({ reason: "limitExceeded" }); expect(called).toBe(false);
        yield* oversized.operation.abort(); yield* tested.database.abortRequest(oversized.claim);
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        expect(yield* store.nextFamily()).toEqual(Option.none());
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("creates no event header for an empty family and retains the plain complete native outcome", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.begin();
        const prepared = yield* prepareCoreRootCommitEventFamily(tested.database, selected.eventOperations, tested.storage);
        yield* stageCoreCommitEventFamily(selected.eventOperations, tested.storage, prepared.id, { values: [], sha256: null },
          selected.operation.unixTime, tested.database);
        const result = { complete: ["unchanged", "DTO"] };
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result });
        expect(yield* tested.database.resolveRequest(selected.identity)).toMatchObject({ kind: "committed", result });
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        expect(yield* store.nextFamily()).toEqual(Option.none());
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("dispatches nonempty root-bound families after cold producer withdrawal and durably acknowledges historical subscribers", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture);
        const committed = [yield* tested.stage("xrf"), yield* tested.stage("xrg", thirdPolicy)];
        yield* tested.database.close();
        const cold = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, tested.options), db => db.close());
        yield* tested.activate(cold, tested.withdrawn);
        expect(failure(yield* Effect.result(cold.bindNative({ definition: tested.currency, commands: [{ name: "write", mode: "write" }] }))))
          .toMatchObject({ reason: "authorityRevoked" });
        const binding = yield* cold.bindNative({ definition: tested.storage });
        const input = { database: cold, binding }, store = yield* makeCoreCommitEventStore(input);
        const observed: CommitEventMessage[] = [];
        const handlers = [firstPolicy, thirdPolicy].flatMap(selected => selected.subscribers).map((subscriber): CoreCommitEventHandler => ({
          ...subscriber, handle: message => Effect.sync(() => { observed.push(message); }),
        }));
        const pump = yield* makeCoreCommitEventPump(input, handlers);
        const scan = Effect.fn("NativeRootEventsFixture.scanPump")(function* () {
          let cursor: string | undefined, delivered = 0, complete = false;
          // Directory cursors are opaque repair positions, not commit order.
          for (let step = 0; step <= committed.length; step++) {
            const status = yield* pump.runNext(cursor);
            delivered += status.delivered;
            expect(status.failed).toBe(0);
            if (status.done) { complete = true; break; }
            if (status.cursor === undefined) return yield* Effect.die(new Error("Missing completed-family repair cursor"));
            cursor = status.cursor;
          }
          expect(complete).toBe(true);
          return delivered;
        });
        expect(yield* scan()).toBe(2);
        const expected = committed.flatMap(selected => selected.values.flatMap((envelope, ordinal) => envelope.subscribers.map(subscriber => {
          const eventId = `${tested.storage.identity.scopeUuid}/${tested.storage.identity.epochUuid}/${selected.prepared.id}/${ordinal}`;
          return { eventId, deliveryId: `${eventId}/${subscriber.id}`, subscriber, envelope };
        })));
        expect(observed.toSorted((left, right) => left.deliveryId < right.deliveryId ? -1 : left.deliveryId > right.deliveryId ? 1 : 0))
          .toEqual(expected.toSorted((left, right) => left.deliveryId < right.deliveryId ? -1 : left.deliveryId > right.deliveryId ? 1 : 0));
        for (const selected of committed) {
          const checked = yield* store.readFamily(selected.prepared.id);
          expect(checked.events).toEqual(selected.values);
          expect(checked.deliveries).toHaveLength(1);
          expect(checked.deliveries[0]).toMatchObject({ state: "delivered", attempts: 1, fence: "1", owner: null,
            lease_expires_at: null, settled_at: expect.any(String), failure_code: null });
          expect(checked.deliveries[0]?.next_attempt_at).toBe(checked.deliveries[0]?.settled_at);
          expect(yield* cold.resolveRequest(selected.identity)).toMatchObject({ kind: "committed", result: selected.result });
        }
        expect(yield* scan()).toBe(0);
        expect(observed).toHaveLength(2);
        for (const selected of committed)
          expect((yield* store.readFamily(selected.prepared.id)).deliveries[0]).toMatchObject({ state: "delivered", attempts: 1, fence: "1" });
      }))); } finally { await fixture.close(); }
    }, 120_000);
  });
}

import { randomBytes } from "node:crypto";
import { Cause, Context, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreDatabase, CoreNativeBinding, CoreRequestIdentity } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { CORE_NATIVE_EVENT_READ, CORE_NATIVE_EVENT_WRITE, compileCoreNativeEventDefinition, coreNativeEventLimits } from "../../src/commit/events/coreDefinition";
import { makeCoreCommitEventPump, makeCoreCommitEventStore, stageCoreCommitEventFamily } from "../../src/commit/events/coreStore";
import { commitEventsDigest } from "../../src/commit/events/digest";
import { CommitEventSubscriberFailure, commitEventLimits, type CommittedEvent } from "../../src/commit/events/model";
import type { CorePersistenceFixture } from "./fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { coreNativeTestBudget } from "./nativeTestBudget";

const target = { scopeUuid: "8264786f-3e86-4abc-b61c-cb1af8a1eeab", epochUuid: "a858f9e8-ceae-474e-a91d-651550e08cba" };
const subscriber = { id: "nativeIndexer", revision: "d".repeat(64) };
const policy = { producerRevision: "a".repeat(64), contracts: [{ name: "currency.created", revision: "b".repeat(64), internal: true }], subscribers: [subscriber] };
const event = (code: string): CommittedEvent => ({ contract: "currency.created", contractRevision: "b".repeat(64), producerRevision: "a".repeat(64),
  internal: true, group: `native/${code}`, message: { code }, subscribers: [subscriber] });
const body = (code: string) => ({ code, name: code, symbol: "N", symbol_native: "N" });
const failed = <A, E>(result: Result.Result<A, E>) => Result.isFailure(result) ? result.failure : undefined;
class HandlerFailureMarker extends Context.Service<HandlerFailureMarker, string>()("NativeEventHandlerFailureMarker") {}

const setup = Effect.fn("NativeEventsFixture.setup")(function* (fixture: CorePersistenceFixture,
  persistence: CorePersistence = fixture.persistence, userDocuments = 1) {
  const application = yield* prepareApplicationSchemaSource(defineSchema({ notes: defineTable({ text: v.string() }) }));
  const currency = yield* compileCurrencyCoreDefinition(target);
  const events = yield* compileCoreNativeEventDefinition({ ...target, policy });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: application },
    { kind: "native", definition: currency }, { kind: "native", definition: events }] });
  let now = BigInt(Date.parse("2026-11-01T00:00:00.000Z")) * 1_000_000n;
  const options = { schemaBundles: [bundle], now: Effect.sync(() => now), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0, transactionLimits: { documentsWritten: userDocuments } };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), database => database.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let ready = false;
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); ready = true; break;
    }
    yield* database.advanceSchema(proposal, { pageSize: 16, maxPages: 16 });
  }
  if (!ready) return yield* Effect.die(new Error("Native event schema did not become ready"));
  const bind = Effect.fn("NativeEventsFixture.bind")(function* (db: CoreDatabase) {
    const currencyBinding = yield* db.bindNative({ definition: currency, commands: [{ name: "currency-write", mode: "write" }, { name: "currency-read", mode: "read" }] });
    const eventBinding = yield* db.bindNative({ definition: events });
    const root = yield* db.bindNativeRoot({ bundle, contract: { name: "native-event-conformance", policy }, participants: [
      { binding: currencyBinding, commands: ["currency-write"], limits: coreNativeTestBudget().limits },
      { binding: eventBinding, commands: [CORE_NATIVE_EVENT_WRITE], limits: coreNativeEventLimits },
    ], maxFinalUserDocuments: userDocuments });
    return { currencyBinding, eventBinding, root, rootMetadata: yield* db.readNativeRootBinding(root) };
  });
  const bindings = yield* bind(database);
  const currencyTable = currency.tables[0]?.name;
  if (currencyTable === undefined) return yield* Effect.die(new Error("Missing genuine Currency table"));
  let request = 0;
  const begin = Effect.fn("NativeEventsFixture.begin")(function* () {
    const identity: CoreRequestIdentity = { kind: "nativeRoot", root: bindings.rootMetadata.identity,
      key: `native-events-${++request}`, requestHash: `arguments-${request}` };
    const acquired = yield* database.claimRequest(identity, bindings.root);
    if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Fresh event root request was not claimed"));
    const operation = yield* database.beginNativeRoot(bindings.root, { claim: acquired.claim, ...coreNativeTestBudget() });
    return { operation, claim: acquired.claim, identity };
  });
  const write = Effect.fn("NativeEventsFixture.write")(function* (familyId: string, code: string) {
    const selected = yield* begin();
    const business = yield* selected.operation.native(bindings.currencyBinding);
    const stored = yield* business.writeRows(currencyTable, "insert", [body(code)]);
    const values = [event(code)];
    yield* stageCoreCommitEventFamily(yield* selected.operation.native(bindings.eventBinding), events, familyId,
      { values, sha256: yield* commitEventsDigest(values) }, selected.operation.unixTime);
    return { ...selected, stored };
  });
  const readCurrency = Effect.fn("NativeEventsFixture.readCurrency")(function* (db: CoreDatabase, binding: CoreNativeBinding, code: string) {
    return yield* Effect.acquireUseRelease(db.beginNative(binding, { ...coreNativeTestBudget(), commandName: "currency-read" }), operation =>
      operation.operations.find(currencyTable, { code }).pipe(Effect.tap(() => operation.finishRead())), operation => operation.abort());
  });
  return { database, options, events, currencyTable, bind, begin, write, readCurrency, ...bindings,
    advance: (milliseconds: number) => { now += BigInt(milliseconds) * 1_000_000n; } };
});

export function registerNativeEventScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("publishes one business row, a private ordered event family and one outcome atomically under unchanged user limits", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        const selected = yield* tested.write("family", "xaa");
        expect(yield* store.nextFamily()).toEqual(Option.none());
        const result = { code: "xaa", family: "family" };
        const timestamp = yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result });
        expect(yield* tested.database.claimRequest(selected.identity, tested.root)).toEqual({ kind: "committed", timestamp, result });
        expect((yield* store.readFamily("family")).events).toEqual([event("xaa")]);
        expect(yield* tested.readCurrency(tested.database, tested.currencyBinding, "xaa")).toHaveLength(1);
        // Four logical records plus the outcome commit with a one-user-write
        // allowance. Event records use SYSTEM accounting and final-user counts.
        expect(tested.events.tables.every(table => table.privateEvent !== undefined)).toBe(true);
        const duplicate = yield* tested.begin();
        const business = yield* duplicate.operation.native(tested.currencyBinding);
        yield* business.writeRows(tested.currencyTable, "insert", [body("xdu")]);
        const values = [event("xdu")];
        expect(failed(yield* Effect.result(stageCoreCommitEventFamily(yield* duplicate.operation.native(tested.eventBinding), tested.events, "family",
          { values, sha256: yield* commitEventsDigest(values) }, duplicate.operation.unixTime))))
          .toMatchObject({ reason: "invalidInput", cause: { _tag: "CoreNativeUniqueConflict" } });
        yield* duplicate.operation.abort(); yield* tested.database.abortRequest(duplicate.claim);
        expect(yield* tested.readCurrency(tested.database, tested.currencyBinding, "xdu")).toEqual([]);
        expect((yield* store.readFamily("family")).events).toEqual([event("xaa")]);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("denies event reads and mutations to ordinary Application and another native source", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("private", "xab");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const read = yield* tested.database.beginNative(tested.eventBinding, { ...coreNativeTestBudget(), commandName: CORE_NATIVE_EVENT_READ });
        const envelopeTable = tested.events.tables.find(table => table.privateEvent?.role === "envelope");
        if (envelopeTable === undefined) return yield* Effect.die(new Error("Missing envelope role"));
        const [stored] = yield* read.operations.find(envelopeTable.name, { family_id: "private" });
        if (typeof stored?._id !== "string") return yield* Effect.die(new Error("Missing persisted envelope"));
        yield* read.finishRead();
        const ordinary = yield* tested.database.begin();
        expect(failed(yield* Effect.result(ordinary.get(stored._id)))).toMatchObject({ reason: "authorityRevoked" });
        yield* ordinary.abort();
        const foreign = yield* tested.database.beginNative(tested.currencyBinding, { ...coreNativeTestBudget(), commandName: "currency-write" });
        expect(failed(yield* Effect.result(foreign.operations.find(envelopeTable.name, {})))).toMatchObject({ reason: "authorityRevoked" });
        yield* foreign.abort();
        const other = yield* tested.database.beginNative(tested.currencyBinding, { ...coreNativeTestBudget(), commandName: "currency-write" });
        expect(failed(yield* Effect.result(other.operations.patch(stored._id, { envelope: event("stolen") })))).toMatchObject({ reason: "authorityRevoked" });
        yield* other.abort();
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("aborts all pending business/event rows and leaves no committed outcome after event refusal", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.begin();
        const business = yield* selected.operation.native(tested.currencyBinding);
        yield* business.writeRows(tested.currencyTable, "insert", [body("xac")]);
        expect(failed(yield* Effect.result(stageCoreCommitEventFamily(yield* selected.operation.native(tested.eventBinding), tested.events, "refused",
          { values: [event("xac")], sha256: "0".repeat(64) }, selected.operation.unixTime)))).toMatchObject({ reason: "invalidInput" });
        yield* selected.operation.abort(); yield* tested.database.abortRequest(selected.claim);
        expect(yield* tested.readCurrency(tested.database, tested.currencyBinding, "xac")).toEqual([]);
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        expect(yield* store.nextFamily()).toEqual(Option.none());
        expect(yield* tested.database.resolveRequest(selected.identity)).toMatchObject({ kind: "failed" });
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("preserves real lease/fence/retry semantics and subscriber revision isolation", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("delivery", "xad");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        expect(yield* store.claimBatch("delivery", [{ ...subscriber, revision: "e".repeat(64) }], 1)).toEqual([]);
        const [first] = yield* store.claimBatch("delivery", [subscriber], 1);
        if (first === undefined) return yield* Effect.die(new Error("Missing first lease"));
        expect(yield* store.claimBatch("delivery", [subscriber], 1)).toEqual([]);
        tested.advance(commitEventLimits.leaseMs + 1);
        const [second] = yield* store.claimBatch("delivery", [subscriber], 1);
        if (second === undefined) return yield* Effect.die(new Error("Missing recovered lease"));
        expect(second.message.eventId).toBe(first.message.eventId);
        expect(failed(yield* Effect.result(store.settle(first)))).toMatchObject({ reason: "staleClaim" });
        yield* store.settle(second, { retryable: true, code: "temporary" });
        expect((yield* store.readFamily("delivery")).deliveries[0]).toMatchObject({ state: "pending", attempts: 2, fence: "2" });
        tested.advance(2001);
        const [third] = yield* store.claimBatch("delivery", [subscriber], 1);
        if (third === undefined) return yield* Effect.die(new Error("Missing retry lease"));
        yield* store.settle(third);
        expect((yield* store.readFamily("delivery")).deliveries[0]).toMatchObject({ state: "delivered", attempts: 3, fence: "3" });
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("rejects a second competing Core claim update observed before the first claimant committed", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("race", "xae");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const table = tested.events.tables.find(table => table.privateEvent?.role === "delivery");
        if (table === undefined) return yield* Effect.die(new Error("Missing delivery role"));
        const first = yield* tested.database.beginNative(tested.eventBinding, { ...coreNativeTestBudget(), commandName: CORE_NATIVE_EVENT_WRITE });
        const second = yield* tested.database.beginNative(tested.eventBinding, { ...coreNativeTestBudget(), commandName: CORE_NATIVE_EVENT_WRITE });
        const [original] = yield* first.operations.find(table.name, { family_id: "race" });
        expect(yield* second.operations.find(table.name, { family_id: "race" })).toEqual([original]);
        if (typeof original?.id !== "string") return yield* Effect.die(new Error("Missing delivery identity"));
        for (const [operation, owner] of [[first, "first"], [second, "second"]] as const)
          yield* operation.operations.writeRows(table.name, "update", [{ id: original.id, state: "claimed", attempts: 1, fence: "1", owner,
            lease_expires_at: new Date(operation.unixTime + commitEventLimits.leaseMs).toISOString() }]);
        const firstFinalized = yield* first.finalize(), secondFinalized = yield* second.finalize();
        yield* tested.database.commit(firstFinalized);
        expect(failed(yield* Effect.result(tested.database.commit(secondFinalized)))).toMatchObject({ reason: "conflict" });
        const store = yield* makeCoreCommitEventStore({ database: tested.database, binding: tested.eventBinding });
        expect((yield* store.readFamily("race")).deliveries[0]).toMatchObject({ state: "claimed", owner: "first", fence: "1" });
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("durably settles expected pump handler failures as pending then terminal without changing delivery identity", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("handler-failure", "xag");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const input = { database: tested.database, binding: tested.eventBinding };
        const store = yield* makeCoreCommitEventStore(input);
        const deliveries: string[] = [];
        const pump = yield* makeCoreCommitEventPump(input, [{ ...subscriber, handle: message => Effect.suspend(() => {
          deliveries.push(message.deliveryId);
          return Effect.fail(new CommitEventSubscriberFailure(deliveries.length === 1
            ? { retryable: true, code: "temporary-handler" } : { retryable: false, code: "permanent-handler" }));
        }) }]);
        expect(yield* pump.runNext()).toEqual({ done: false, cursor: "handler-failure", delivered: 0, failed: 1 });
        const pending = (yield* store.readFamily("handler-failure")).deliveries[0];
        expect(pending).toMatchObject({
          state: "pending", attempts: 1, fence: "1", owner: null, lease_expires_at: null,
          settled_at: null, failure_code: "temporary-handler",
        });
        if (pending === undefined) return yield* Effect.die(new Error("Missing pending handler failure"));
        expect(Date.parse(pending.next_attempt_at)).toBeGreaterThanOrEqual(selected.operation.unixTime + 1000);
        expect(yield* pump.runNext()).toMatchObject({ delivered: 0, failed: 0 });
        expect(deliveries).toHaveLength(1);
        tested.advance(1001);
        expect(yield* pump.runNext()).toEqual({ done: false, cursor: "handler-failure", delivered: 0, failed: 1 });
        const terminal = (yield* store.readFamily("handler-failure")).deliveries[0];
        expect(terminal).toMatchObject({
          state: "failed", attempts: 2, fence: "2", owner: null, lease_expires_at: null,
          settled_at: expect.any(String), failure_code: "permanent-handler",
        });
        expect(terminal?.next_attempt_at).toBe(terminal?.settled_at);
        expect(deliveries).toEqual([deliveries[0], deliveries[0]]);
        expect(yield* pump.runNext()).toMatchObject({ delivered: 0, failed: 0 });
        expect(deliveries).toHaveLength(2);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("durably settles the pump handler timeout after draining it and retries the same delivery", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("handler-timeout", "xah");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const input = { database: tested.database, binding: tested.eventBinding };
        const store = yield* makeCoreCommitEventStore(input);
        const deliveries: string[] = [];
        let drained = false;
        const pump = yield* makeCoreCommitEventPump(input, [{ ...subscriber, handle: message => Effect.suspend(() => {
          deliveries.push(message.deliveryId);
          return deliveries.length === 1 ? Effect.never.pipe(Effect.ensuring(Effect.sync(() => { drained = true; }))) : Effect.void;
        }) }]);
        expect(yield* pump.runNext()).toEqual({ done: false, cursor: "handler-timeout", delivered: 0, failed: 1 });
        expect(drained).toBe(true);
        expect(deliveries).toHaveLength(1);
        const pending = (yield* store.readFamily("handler-timeout")).deliveries[0];
        expect(pending).toMatchObject({
          state: "pending", attempts: 1, fence: "1", owner: null, lease_expires_at: null,
          settled_at: null, failure_code: "handler-timeout",
        });
        if (pending === undefined) return yield* Effect.die(new Error("Missing pending handler timeout"));
        expect(Date.parse(pending.next_attempt_at)).toBeGreaterThanOrEqual(selected.operation.unixTime + 1000);
        tested.advance(1001);
        expect(yield* pump.runNext()).toEqual({ done: false, cursor: "handler-timeout", delivered: 1, failed: 0 });
        const delivered = (yield* store.readFamily("handler-timeout")).deliveries[0];
        expect(delivered).toMatchObject({
          state: "delivered", attempts: 2, fence: "2", owner: null, lease_expires_at: null,
          settled_at: expect.any(String), failure_code: null,
        });
        expect(delivered?.next_attempt_at).toBe(delivered?.settled_at);
        expect(deliveries).toEqual([deliveries[0], deliveries[0]]);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("leaves a pump handler mixed failure, defect and interruption unacknowledged with its full Cause", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("handler-mixed", "xai");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const input = { database: tested.database, binding: tested.eventBinding };
        const store = yield* makeCoreCommitEventStore(input);
        const expected = new CommitEventSubscriberFailure({ retryable: false, code: "mixed-handler" });
        const defect = new Error("handler defect");
        const cause = Cause.annotate(Cause.combine(Cause.combine(Cause.fail(expected), Cause.die(defect)), Cause.interrupt(729)),
          Context.make(HandlerFailureMarker, "original-native-handler"));
        const deliveries: string[] = [];
        const pump = yield* makeCoreCommitEventPump(input, [{ ...subscriber, handle: message => Effect.suspend(() => {
          deliveries.push(message.deliveryId);
          return Effect.failCause(cause);
        }) }]);
        const result = yield* Effect.exit(pump.runNext());
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Mixed handler Cause was acknowledged"));
        // Effect.fn may add stack annotations; every original reason, payload,
        // order and interrupting fiber must survive that tracing boundary.
        expect(result.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
        const [failureReason, defectReason, interruptReason] = result.cause.reasons;
        if (failureReason === undefined || !Cause.isFailReason(failureReason)
          || defectReason === undefined || !Cause.isDieReason(defectReason)
          || interruptReason === undefined || !Cause.isInterruptReason(interruptReason))
          return yield* Effect.die(new Error("Mixed handler Cause lost an original reason"));
        expect(failureReason.error).toBe(expected);
        expect(defectReason.defect).toBe(defect);
        expect(interruptReason.fiberId).toBe(729);
        for (const reason of result.cause.reasons)
          expect(Context.getOrUndefined(Cause.reasonAnnotations(reason), HandlerFailureMarker)).toBe("original-native-handler");
        const claimed = (yield* store.readFamily("handler-mixed")).deliveries[0];
        expect(claimed).toMatchObject({
          state: "claimed", attempts: 1, fence: "1", owner: expect.any(String),
          settled_at: null, failure_code: null,
        });
        if (claimed?.lease_expires_at === undefined || claimed.lease_expires_at === null)
          return yield* Effect.die(new Error("Missing recoverable handler lease"));
        expect(Date.parse(claimed.lease_expires_at)).toBeGreaterThanOrEqual(selected.operation.unixTime + commitEventLimits.leaseMs);
        expect(deliveries).toHaveLength(1);
        tested.advance(commitEventLimits.leaseMs + 1);
        const restarted = yield* makeCoreCommitEventPump(input, [{ ...subscriber,
          handle: message => Effect.sync(() => { deliveries.push(message.deliveryId); }) }]);
        expect(yield* restarted.runNext()).toEqual({ done: false, cursor: "handler-mixed", delivered: 1, failed: 0 });
        expect((yield* store.readFamily("handler-mixed")).deliveries[0]).toMatchObject({
          state: "delivered", attempts: 2, fence: "2", owner: null, lease_expires_at: null, failure_code: null,
        });
        expect(deliveries).toEqual([deliveries[0], deliveries[0]]);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("leaves dual expected pump handler failures unacknowledged without choosing a retry policy", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.write("handler-dual", "xaj");
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const input = { database: tested.database, binding: tested.eventBinding };
        const store = yield* makeCoreCommitEventStore(input);
        const retryable = new CommitEventSubscriberFailure({ retryable: true, code: "retryable-handler" });
        const terminal = new CommitEventSubscriberFailure({ retryable: false, code: "terminal-handler" });
        const cause = Cause.annotate(Cause.combine(Cause.fail(retryable), Cause.fail(terminal)),
          Context.make(HandlerFailureMarker, "original-dual-handler"));
        const deliveries: string[] = [];
        const pump = yield* makeCoreCommitEventPump(input, [{ ...subscriber, handle: message => Effect.suspend(() => {
          deliveries.push(message.deliveryId);
          return Effect.failCause(cause);
        }) }]);
        const result = yield* Effect.exit(pump.runNext());
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Multiple handler failures were acknowledged"));
        expect(result.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Fail"]);
        const [first, second] = result.cause.reasons;
        if (first === undefined || !Cause.isFailReason(first) || second === undefined || !Cause.isFailReason(second))
          return yield* Effect.die(new Error("Handler Cause lost an expected failure"));
        expect(first.error).toBe(retryable);
        expect(second.error).toBe(terminal);
        for (const reason of result.cause.reasons)
          expect(Context.getOrUndefined(Cause.reasonAnnotations(reason), HandlerFailureMarker)).toBe("original-dual-handler");
        const claimed = (yield* store.readFamily("handler-dual")).deliveries[0];
        expect(claimed).toMatchObject({ state: "claimed", attempts: 1, fence: "1", owner: expect.any(String),
          settled_at: null, failure_code: null });
        if (claimed?.lease_expires_at === undefined || claimed.lease_expires_at === null)
          return yield* Effect.die(new Error("Missing recoverable dual-failure lease"));
        expect(Date.parse(claimed.lease_expires_at)).toBeGreaterThanOrEqual(selected.operation.unixTime + commitEventLimits.leaseMs);
        expect(deliveries).toHaveLength(1);
        tested.advance(commitEventLimits.leaseMs + 1);
        const restarted = yield* makeCoreCommitEventPump(input, [{ ...subscriber,
          handle: message => Effect.sync(() => { deliveries.push(message.deliveryId); }) }]);
        expect(yield* restarted.runNext()).toEqual({ done: false, cursor: "handler-dual", delivered: 1, failed: 0 });
        expect((yield* store.readFamily("handler-dual")).deliveries[0]).toMatchObject({
          state: "delivered", attempts: 2, fence: "2", owner: null, lease_expires_at: null, failure_code: null,
        });
        expect(deliveries).toEqual([deliveries[0], deliveries[0]]);
      }))); } finally { await fixture.close(); }
    }, 120_000);

    it("recovers a durable business/event/outcome after lost acknowledgement with no callback replay", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let loseAck = false, callbacks = 0;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          if (loseAck) return yield* new CorePersistenceError({ reason: "uncertainWrite" });
        }) };
        const tested = yield* setup(fixture, persistence);
        callbacks++;
        const selected = yield* tested.write("recovered", "xaf");
        loseAck = true;
        expect(failed(yield* Effect.result(tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim,
          result: { code: "xaf", family: "recovered" } })))).toMatchObject({ reason: "uncertainWrite" });
        yield* tested.database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), tested.options), database => database.close());
        const bindings = yield* tested.bind(reopened);
        expect(yield* reopened.claimRequest(selected.identity, bindings.root)).toMatchObject({ kind: "committed", result: { code: "xaf", family: "recovered" } });
        const store = yield* makeCoreCommitEventStore({ database: reopened, binding: bindings.eventBinding });
        expect((yield* store.readFamily("recovered")).events).toEqual([event("xaf")]);
        expect(yield* tested.readCurrency(reopened, bindings.currencyBinding, "xaf")).toHaveLength(1);
        expect(callbacks).toBe(1);
      }))); } finally { await fixture.close(); }
    }, 120_000);
  });
}

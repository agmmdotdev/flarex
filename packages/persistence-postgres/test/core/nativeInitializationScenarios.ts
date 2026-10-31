import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import type { CoreDatabase, CoreError, CoreNativeBinding, CoreRequestIdentity } from "../../src/core/api";
import { REQUESTS, readDocumentObject } from "../../src/core/registry";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";

const options = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, now: Effect.succeed(1_000_000_000n),
  randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)), maxBatchDelayMilliseconds: 0 };
const body = (title: string) => ({ title, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const acquire = Effect.fn("NativeInitializationFixture.acquire")(function* (database: CoreDatabase, binding: CoreNativeBinding,
  identity: CoreRequestIdentity) {
  const acquired = yield* database.claimRequest(identity, yield* database.bindNativeInitialization({ binding, commandName: "initialize" }));
  if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Expected an initialization claim"));
  const operation = yield* database.beginNative(binding, { commandName: "initialize", claim: acquired.claim,
    limits: { maxIdentities: 128, maxDocumentBytes: 65536 }, chargeRetained: coreNativeTestBudget().chargeRetained });
  return { claim: acquired.claim, operation };
});
const bind = Effect.fn("NativeInitializationFixture.bind")((database: CoreDatabase,
  definition: Effect.Success<ReturnType<typeof makeCoreNativeDefinition>>) => database.bindNative({ definition,
  commands: [{ name: "initialize", mode: "write" }, { name: "ordinary", mode: "write" }, { name: "read", mode: "read" }] }));
const setup = Effect.fn("NativeInitializationFixture.setup")(function* (persistence: CorePersistence) {
  const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }]);
  const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
    scopeUuid: "7f8cd233-917b-4b42-8c6c-a431761fa893", epochUuid: "a9fb0a20-55de-4d88-bbd2-135576a80467" });
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), database => database.close());
  const proposal = yield* database.prepareSchema({ native: definition });
  let ready = false;
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], native: definition }); ready = true; break;
    }
    yield* database.advanceSchema(proposal, { pageSize: 8, maxPages: 8 });
  }
  if (!ready) return yield* Effect.die(new Error("Initialization source not ready"));
  const binding = yield* bind(database, definition);
  const metadata = yield* database.readNativeBinding(binding);
  const command = metadata.commands.find(command => command.name === "initialize");
  if (command === undefined) return yield* Effect.die(new Error("Initialization command absent"));
  const identity: CoreRequestIdentity = { kind: "native", native: command.identity, key: "native-initialization/one-step", requestHash: "checked-dataset-one" };
  return { database, definition, binding, identity };
});
const requestEntry = Effect.fn("NativeInitializationFixture.requestEntry")(function* (
  fixture: CorePersistenceFixture, database: CoreDatabase, key: string,
) {
  const timestamp = yield* database.publishedTimestamp;
  const registry = yield* readCoreFixtureRegistry(fixture, timestamp);
  const table = registry.table(REQUESTS)?.definition, index = table?.indexes.find(index => index.name === "by_key");
  if (table === undefined || index === undefined) return yield* Effect.die(new Error("Missing request registry"));
  const prefix = yield* Effect.fromResult(encodeIndexValue(key));
  const snapshot = yield* fixture.persistence.readSnapshot(timestamp);
  const page = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref,
    interval: { start: prefix, end: incrementIndexKeyPrefix(prefix) }, order: "asc", maxResults: 2 });
  expect(page.entries).toHaveLength(1);
  const entry = page.entries[0]?.document;
  if (entry === undefined) return yield* Effect.die(new Error("Missing request revision"));
  return { entry, document: yield* Effect.fromResult(readDocumentObject(entry, table)) };
});

export function registerNativeInitializationScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("owns request correlation before an asynchronous persistence capture", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let hold = false;
        const observed: CorePersistence = { ...fixture.persistence, readSnapshot: (...args) => Effect.gen(function* () {
          if (hold) { hold = false; yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); }
          return yield* fixture.persistence.readSnapshot(...args);
        }) };
        const tested = yield* setup(observed);
        const original = { ...tested.identity, key: "native-initialization/original", requestHash: "original-dataset" };
        const mutable = { ...original };
        const role = yield* tested.database.bindNativeInitialization({ binding: tested.binding, commandName: "initialize" });
        hold = true;
        yield* Effect.gen(function* () {
          const acquiring = yield* tested.database.claimRequest(mutable, role).pipe(Effect.forkScoped);
          yield* Deferred.await(entered);
          mutable.key = "native-initialization/retargeted"; mutable.requestHash = "retargeted-dataset";
          yield* Deferred.succeed(release, undefined);
          const acquired = yield* Fiber.join(acquiring);
          expect(acquired.kind).toBe("claimed");
          expect(yield* tested.database.resolveRequest(original)).toEqual({ kind: "busy" });
          expect(yield* tested.database.resolveRequest(mutable)).toEqual({ kind: "missing" });
          if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Missing captured claim"));
          yield* tested.database.abortRequest(acquired.claim);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("reclaims only matching failed initialization, retains history and rejects old handles", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture.persistence);
        const first = yield* acquire(tested.database, tested.binding, tested.identity);
        yield* first.operation.operations.insert("news", body("aborted"));
        const oldFinalized = yield* first.operation.finalize();
        yield* tested.database.abortRequest(first.claim);
        const failed = yield* requestEntry(fixture, tested.database, tested.identity.key);
        expect(failed.document.state).toBe("failed");
        expect(yield* tested.database.claimRequest(tested.identity, tested.binding)).toEqual({ kind: "failed" });
        const role = yield* tested.database.bindNativeInitialization({ binding: tested.binding, commandName: "initialize" });
        expect(failure(yield* Effect.result(tested.database.claimRequest({ ...tested.identity, requestHash: "different-dataset" }, role))))
          .toMatchObject({ reason: "requestMismatch" });
        if (tested.identity.kind !== "native") return yield* Effect.die(new Error("Expected native identity"));
        expect(failure(yield* Effect.result(tested.database.claimRequest({ ...tested.identity,
          native: { ...tested.identity.native, name: "ordinary" } }, role)))).toMatchObject({ reason: "authorityRevoked" });
        const second = yield* acquire(tested.database, tested.binding, tested.identity);
        const reclaimed = yield* requestEntry(fixture, tested.database, tested.identity.key);
        expect(reclaimed.entry.id).toEqual(failed.entry.id);
        expect(reclaimed.entry.prevTs).toBe(failed.entry.ts);
        expect(reclaimed.document.state).toBe("claimed");
        expect(failure(yield* Effect.result(tested.database.abortRequest(first.claim)))).toMatchObject({ reason: "foreignClaim" });
        expect(failure(yield* Effect.result(tested.database.commit(oldFinalized, { claim: first.claim, result: null }))))
          .toMatchObject({ reason: "foreignClaim" });
        const id = yield* second.operation.operations.insert("news", body("accepted"));
        yield* tested.database.commit(yield* second.operation.finalize(), { claim: second.claim, result: { id } });
        expect(yield* tested.database.claimRequest(tested.identity, role)).toMatchObject({ kind: "committed", result: { id } });
        const read = yield* tested.database.beginNative(tested.binding, { commandName: "read", limits: { maxIdentities: 128, maxDocumentBytes: 65536 },
          chargeRetained: coreNativeTestBudget().chargeRetained });
        expect(yield* read.operations.find("news", {})).toMatchObject([{ title: "accepted" }]);
        yield* read.finishRead();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("issues one claim when two callers reclaim the same failed initialization", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture.persistence), first = yield* acquire(tested.database, tested.binding, tested.identity);
        yield* first.operation.abort(); yield* tested.database.abortRequest(first.claim);
        const role = yield* tested.database.bindNativeInitialization({ binding: tested.binding, commandName: "initialize" });
        const results = yield* Effect.all([tested.database.claimRequest(tested.identity, role), tested.database.claimRequest(tested.identity, role)], { concurrency: 2 });
        expect(results.map(result => result.kind).toSorted()).toEqual(["busy", "claimed"]);
        const winner = results.find(result => result.kind === "claimed");
        if (winner?.kind !== "claimed") return yield* Effect.die(new Error("Missing winning initializer"));
        yield* tested.database.abortRequest(winner.claim);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("retires an interrupted abort before allowing the failed step to be reclaimed", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const saved = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), interrupted = yield* Deferred.make<void>();
        let hold = false;
        const observed: CorePersistence = { ...fixture.persistence, write: (lease, batch) => fixture.persistence.write(lease, batch).pipe(
          Effect.andThen(() => hold ? Effect.andThen(Deferred.succeed(saved, undefined), Deferred.await(release)) : Effect.void)) };
        const tested = yield* setup(observed), first = yield* acquire(tested.database, tested.binding, tested.identity);
        yield* first.operation.abort(); hold = true;
        yield* Effect.gen(function* () {
          const aborting = yield* tested.database.abortRequest(first.claim).pipe(Effect.forkScoped);
          yield* Deferred.await(saved);
          const interrupting = yield* Fiber.interrupt(aborting).pipe(Effect.tap(() => Deferred.succeed(interrupted, undefined)), Effect.forkScoped);
          yield* Effect.yieldNow;
          expect(yield* Deferred.isDone(interrupted)).toBe(false);
          hold = false; yield* Deferred.succeed(release, undefined); yield* Fiber.join(interrupting);
          expect(yield* tested.database.resolveRequest(tested.identity)).toEqual({ kind: "failed" });
          const next = yield* acquire(tested.database, tested.binding, tested.identity);
          expect(failure(yield* Effect.result(tested.database.abortRequest(first.claim)))).toMatchObject({ reason: "foreignClaim" });
          expect(yield* tested.database.resolveRequest(tested.identity)).toEqual({ kind: "busy" });
          yield* next.operation.abort(); yield* tested.database.abortRequest(next.claim);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("fences unknown claim saves before retry and replays an unknown initialization outcome after reopen", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let loseAcknowledgement = false;
        const observe = (persistence: CorePersistence): CorePersistence => ({ ...persistence,
          write: (lease, batch) => persistence.write(lease, batch).pipe(Effect.andThen(() => {
            if (!loseAcknowledgement) return Effect.void;
            loseAcknowledgement = false;
            return Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
          })) });
        const tested = yield* setup(observe(fixture.persistence));
        const oldRole = yield* tested.database.bindNativeInitialization({ binding: tested.binding, commandName: "initialize" });
        loseAcknowledgement = true;
        expect(failure(yield* Effect.result(tested.database.claimRequest(tested.identity, oldRole)))).toMatchObject({ reason: "uncertainWrite" });
        expect(Result.isFailure(yield* Effect.result(tested.database.claimRequest(tested.identity, oldRole)))).toBe(true);
        yield* tested.database.close();
        const second = yield* Effect.acquireRelease(openCoreDatabase(observe(yield* Effect.promise(() => fixture.reopen())), options), database => database.close());
        const secondBinding = yield* bind(second, tested.definition);
        expect(failure(yield* Effect.result(second.claimRequest(tested.identity, oldRole)))).toMatchObject({ reason: "authorityRevoked" });
        const role = yield* second.bindNativeInitialization({ binding: secondBinding, commandName: "initialize" });
        expect(yield* second.claimRequest(tested.identity, role)).toEqual({ kind: "busy" });
        expect(yield* second.recoverRequest(tested.identity)).toEqual({ kind: "failed" });
        expect(yield* second.claimRequest(tested.identity, secondBinding)).toEqual({ kind: "failed" });
        const active = yield* acquire(second, secondBinding, tested.identity);
        const id = yield* active.operation.operations.insert("news", body("one accepted initializer"));
        const finalized = yield* active.operation.finalize();
        loseAcknowledgement = true;
        expect(failure(yield* Effect.result(second.commit(finalized, { claim: active.claim, result: { id } }))))
          .toMatchObject({ reason: "uncertainWrite" });
        yield* second.close();
        const third = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), database => database.close());
        const thirdBinding = yield* bind(third, tested.definition);
        const thirdRole = yield* third.bindNativeInitialization({ binding: thirdBinding, commandName: "initialize" });
        expect(yield* third.claimRequest(tested.identity, thirdRole)).toMatchObject({ kind: "committed", result: { id } });
        const read = yield* third.beginNative(thirdBinding, { commandName: "read", limits: { maxIdentities: 128, maxDocumentBytes: 65536 },
          chargeRetained: coreNativeTestBudget().chargeRetained });
        expect((yield* read.operations.find("news", {})).map(row => row._id)).toEqual([id]); yield* read.finishRead();
      }))); } finally { await fixture.close(); }
    }, 90_000);
  });
}

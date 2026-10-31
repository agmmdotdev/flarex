import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Result } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { describe, expect, it } from "vitest";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import type { CoreDatabaseOptions, CoreRequestIdentity, CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { bootstrapCore } from "../../src/core/bootstrap";
import { makeCoreCommitter } from "../../src/core/committer";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreNativeUniqueSlot } from "../../src/core/nativeObservations";
import { coreNativeTestBudget, CORE_NATIVE_TEST_LIMITS } from "./nativeTestBudget";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { readDocumentObject } from "../../src/core/registry";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import { CoreFinalizationVault, createCoreTransaction, type CoreFinalizedState } from "../../src/core/transaction";
import type { CorePersistenceFixture } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)),
  maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
const schema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{
  tableName: "news", documentType: { type: "object", value: {
    title: { fieldType: { type: "string" }, optional: false },
  } }, indexes: [{ indexDescriptor: "by_title", fields: ["title", "_creationTime"] }],
}] }));

const install = Effect.fn("NativeCommitterFixture.install")(function* (fixture: CorePersistenceFixture) {
  return yield* Effect.scoped(Effect.gen(function* () {
    const database = yield* openCoreDatabase(fixture.persistence, options);
    const installed = yield* activateCoreSchema(database, schema);
    const table = installed.tables.find(candidate => candidate.name === "news");
    if (table === undefined) return yield* Effect.die(new Error("Missing installed news table"));
    return table;
  }));
});

const open = Effect.fn("NativeCommitterFixture.open")(function* (persistence: CorePersistence,
  overrides: Partial<CoreDatabaseOptions> = {}) {
  const runtimeOptions = { ...options, ...overrides };
  const lease = yield* persistence.acquireLease();
  const initial = yield* bootstrapCore(persistence, lease, runtimeOptions);
  const committer = yield* makeCoreCommitter(persistence, lease, initial.timestamp,
    initial.registry, initial.resident, runtimeOptions, initial.retention);
  const vault = new CoreFinalizationVault();
  const begin = Effect.fn("NativeCommitterFixture.begin")(function* () {
    const selected = yield* Effect.fromResult(committer.selectSnapshot());
    return createCoreTransaction({ snapshot: yield* persistence.readSnapshot(selected.timestamp, initial.retention),
      registry: selected.registry, now: 1_000_000_000n, newInternalId: options.newInternalId, vault }).transaction;
  });
  const finish = Effect.fn("NativeCommitterFixture.finish")(function* (transaction: Effect.Success<ReturnType<typeof begin>>) {
    const state = vault.take(yield* transaction.finalize());
    if (state === undefined) return yield* Effect.die(new Error("Missing fixture finalization"));
    return state;
  });
  return { committer, begin, finish };
});

function slot(table: CoreTableDefinition, title: string, owners: readonly string[] = []): CoreNativeUniqueSlot {
  const index = table.indexes.find(candidate => candidate.name === "by_title");
  if (index === undefined) throw new Error("Missing installed title index");
  const prefix = Result.getOrThrow(encodeIndexValue(title));
  return { kind: "unique", table, index, interval: { start: prefix, end: incrementIndexKeyPrefix(prefix) }, owners };
}

const observing = (state: CoreFinalizedState, ...uniqueSlots: readonly CoreNativeUniqueSlot[]): CoreFinalizedState => ({
  ...state, nativeObservations: { dependencies: [], indexes: uniqueSlots, limits: CORE_NATIVE_TEST_LIMITS },
});

export function registerNativeCommitterScenarios(name: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(name, () => {
    it.each(["write", "resultOnly"] as const)("drains transitive native %s dependencies after predecessor failure", async mode => {
      const fixture = await createFixture();
      try {
        const observed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const table = yield* install(fixture);
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const independentSaved = yield* Deferred.make<void>();
          const middleAdmitting = yield* Deferred.make<void>();
          const lastAdmitting = yield* Deferred.make<void>();
          let admissionMarker: Deferred.Deferred<void> | undefined;
          let armed = false;
          const savedDependentTitles: string[] = [];
          const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
            const bodies = yield* Effect.forEach(batch.documents.filter(entry => !entry.deleted), entry =>
              Effect.fromResult(readDocumentObject(entry)));
            if (armed && bodies.some(document => document.title === "L")) {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return yield* new CorePersistenceError({ reason: "unavailable" });
            }
            yield* fixture.persistence.write(lease, batch);
            if (armed) for (const document of bodies)
              if (document.title === "K" || document.title === "M") savedDependentTitles.push(document.title);
            if (bodies.some(document => document.title === "I")) yield* Deferred.succeed(independentSaved, undefined);
          }) };
          const { committer, begin, finish } = yield* open(persistence, { maxInflight: 4, now: Effect.gen(function* () {
            const marker = admissionMarker;
            admissionMarker = undefined;
            if (marker !== undefined) yield* Deferred.succeed(marker, undefined);
            return 1_000_000_000n;
          }) });
          const last = yield* begin();
          if (mode === "write") yield* last.insert("news", { title: "M" });
          const lastFinalized = observing(yield* finish(last), slot(table, "M"));
          const originalM = yield* begin();
          const middleId = yield* originalM.insert("news", { title: "M" });
          yield* committer.submit(observing(yield* finish(originalM), slot(table, "M")));
          const middle = yield* begin();
          yield* middle.patch(middleId, { title: "K" });
          const middleFinalized = observing(yield* finish(middle), slot(table, "M", [middleId]), slot(table, "K"));
          const originalK = yield* begin();
          const firstId = yield* originalK.insert("news", { title: "K" });
          yield* committer.submit(observing(yield* finish(originalK), slot(table, "K")));
          const rename = yield* begin();
          yield* rename.patch(firstId, { title: "L" });
          const renameFinalized = observing(yield* finish(rename), slot(table, "K", [firstId]), slot(table, "L"));
          return yield* Effect.ensuring(Effect.gen(function* () {
            armed = true;
            const renaming = yield* Effect.forkChild(Effect.result(committer.submit(renameFinalized)));
            yield* Deferred.await(started);
            admissionMarker = middleAdmitting;
            const movingMiddle = yield* Effect.forkChild(Effect.result(committer.submit(middleFinalized)));
            yield* Deferred.await(middleAdmitting);
            admissionMarker = lastAdmitting;
            const settlingLast = yield* Effect.forkChild(Effect.result(committer.submit(lastFinalized)));
            yield* Deferred.await(lastAdmitting);
            const independent = yield* begin();
            yield* independent.insert("news", { title: "I" });
            const savingIndependent = yield* Effect.forkChild(Effect.result(committer.submit(yield* finish(independent))));
            yield* Deferred.await(independentSaved);
            const capacity = yield* Effect.result(committer.submit(observing(lastFinalized, slot(table, "M"))));
            expect(Result.isFailure(capacity) && capacity.failure).toMatchObject({ reason: "capacity" });
            yield* Deferred.succeed(release, undefined);
            const firstResult = yield* Fiber.join(renaming);
            const middleResult = yield* Fiber.join(movingMiddle);
            const lastResult = yield* Fiber.join(settlingLast);
            yield* Fiber.join(savingIndependent);
            return { firstResult, middleResult, lastResult, savedDependentTitles };
          }).pipe(Effect.timeout("15 seconds")), Deferred.succeed(release, undefined));
        })));
        const titles = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options);
          const transaction = yield* database.begin();
          const rows = yield* transaction.scan("news", "by_creation_time");
          yield* transaction.abort();
          return rows.map(document => document.title).toSorted();
        })));
        expect(titles).toEqual(["I", "K", "M"]);
        expect(observed.savedDependentTitles).toEqual([]);
        expect(observed.firstResult).toMatchObject({ _tag: "Failure", failure: { reason: "unavailable" } });
        expect(observed.middleResult).toEqual(observed.firstResult);
        expect(observed.lastResult).toEqual(observed.firstResult);
      } finally { await fixture.close(); }
    }, 30_000);

    for (const profile of ["unique", "range"] as const) {
      const rangeProfile = profile === "range";
      const faults = rangeProfile ? ["beforeWrite", "lostAcknowledgement", "success"] as const
        : ["beforeWrite", "lostAcknowledgement", "dependentLostAcknowledgement", "success", "callerCancellation",
          "atomicBeforeWrite", "atomicLostAcknowledgement", "atomicSuccess"] as const;
      it.each(faults)(rangeProfile
        ? "keeps dependent native ordinary-range rows and outcomes ordered through %s settlement"
        : "keeps dependent native rows and outcomes ordered through %s settlement", async fault => {
        const fixture = await createFixture();
        try {
          const atomic = fault.startsWith("atomic");
          const failsBeforeWrite = fault === "beforeWrite" || fault === "atomicBeforeWrite";
          const losesPredecessorAcknowledgement = fault === "lostAcknowledgement" || fault === "atomicLostAcknowledgement";
          const dependentCommits = atomic ? !failsBeforeWrite : !failsBeforeWrite && !losesPredecessorAcknowledgement;
          const observed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const renameStarted = yield* Deferred.make<void>();
            const releaseRename = yield* Deferred.make<void>();
            const independentSaved = yield* Deferred.make<void>();
            const candidateAdmitting = yield* Deferred.make<void>();
            const renameAdmitting = yield* Deferred.make<void>();
            let armed = false;
            let dependentSaved = false;
            let admissionMarker: "rename" | "candidate" | undefined;
            let atomicBatch = false;
            let bodyExecutions = 0;
            const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
              const bodies = yield* Effect.forEach(batch.documents.filter(entry => !entry.deleted), entry =>
                Effect.fromResult(readDocumentObject(entry)));
              const rename = armed && bodies.some(document => rangeProfile
                ? document.title === "C" && document.amount === 25 : document.title === "L");
              if (rename) {
                atomicBatch = bodies.some(document => document.title === "K");
                yield* Deferred.succeed(renameStarted, undefined);
                yield* Deferred.await(releaseRename);
                if (failsBeforeWrite) return yield* new CorePersistenceError({ reason: "unavailable" });
              }
              yield* fixture.persistence.write(lease, batch);
              if (armed && bodies.some(document => document.title === "K")) dependentSaved = true;
              if (bodies.some(document => document.marker === "independent-saved"))
                yield* Deferred.succeed(independentSaved, undefined);
              if ((rename && losesPredecessorAcknowledgement)
                || (fault === "dependentLostAcknowledgement" && armed && bodies.some(document => document.title === "K")))
                return yield* new CorePersistenceError({ reason: "uncertainWrite" });
            }) };
            const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
              { name: "title", type: "text", required: true, unique: true },
              ...(rangeProfile ? [{ name: "amount", type: "number", required: true, index: true }] : []),
            ] }]);
            const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
              scopeUuid: "8f5545a4-cd38-4ae0-a421-12fe85dcb727", epochUuid: "1e8aa599-efb5-45da-9b24-8e48f115f250" });
            const database = yield* openCoreDatabase(persistence, { ...options,
              ...(atomic ? { batchWriteThreshold: 1, maxBatchDocuments: 3, maxBatchDelayMilliseconds: 1_000 } : {}),
              now: Effect.gen(function* () {
              const marker = admissionMarker;
              admissionMarker = undefined;
              if (marker !== undefined) yield* Deferred.succeed(marker === "rename" ? renameAdmitting : candidateAdmitting, undefined);
              return 1_000_000_000n;
            }) });
            const proposal = yield* database.prepareSchema({ native: definition });
            for (let step = 0; step < 128; step++) {
              const status = yield* database.schemaStatus(proposal);
              if ((status.state === "validated" || status.state === "active") && status.indexesReady) break;
              yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
            }
            yield* database.activateSchema(proposal, { programs: [], native: definition });
            const binding = yield* database.bindNative({ definition });
            const metadata = yield* database.readNativeBinding(binding);
            const command = metadata.commands.find(candidate => candidate.name === "payload-create");
            const tableName = definition.tables[0]?.name;
            if (command === undefined || tableName === undefined) return yield* Effect.die(new Error("Missing native fixture metadata"));
            const seed = yield* database.begin();
            const markerId = yield* seed.insert("independent", { marker: "seed" });
            yield* database.commit(yield* seed.finalize());
            const request: CoreRequestIdentity = { kind: "native", key: `dependent-${fault}`,
              requestHash: "dependent-native-arguments", native: command.identity };
            const claim = yield* database.claimRequest(request, binding);
            if (claim.kind !== "claimed") return yield* Effect.die(new Error("Missing native fixture claim"));
            const body = (title: string, amount = 5) => ({ title, ...(rangeProfile ? { amount } : {}),
              createdAt: "2026-10-31T00:00:00.000Z", updatedAt: "2026-10-31T00:00:00.000Z" });
            const held = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: command.name, claim: claim.claim });
            bodyExecutions += 1;
            if (rangeProfile) expect(yield* held.operations.find(tableName, { amount: { gte: 10, lt: 20 } })).toEqual([]);
            const dependentId = yield* held.operations.insert(tableName, body("K"));
            const heldFinalized = yield* held.finalize();
            const competing = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: command.name });
            const competingId = yield* competing.operations.insert(tableName, body(rangeProfile ? "C" : "K", 15));
            yield* database.commit(yield* competing.finalize());
            const rename = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-update" });
            yield* rename.operations.patch(competingId, rangeProfile ? { amount: 25 } : { title: "L" });
            const renameFinalized = yield* rename.finalize();
            return yield* Effect.ensuring(Effect.gen(function* () {
              armed = true;
              if (atomic) admissionMarker = "rename";
              const renaming = yield* Effect.forkChild(Effect.result(database.commit(renameFinalized)));
              yield* Deferred.await(atomic ? renameAdmitting : renameStarted);
              admissionMarker = "candidate";
              const settling = yield* Effect.forkChild(Effect.result(database.commit(heldFinalized, {
                claim: claim.claim, result: { id: dependentId, title: "K" },
              })));
              yield* Deferred.await(candidateAdmitting);
              const savingIndependent = atomic ? undefined : yield* Effect.gen(function* () {
                const independent = yield* database.begin();
                yield* independent.patch(markerId, { marker: "independent-saved" });
                const saving = yield* Effect.forkChild(Effect.result(database.commit(yield* independent.finalize())));
                // A later source write persists while the dependent native write
                // waits. Its publication acknowledgement remains ordered.
                yield* Deferred.await(independentSaved);
                return saving;
              });
              if (atomic) yield* Deferred.await(renameStarted);
              const dependentSavedBeforeFailure = dependentSaved;
              if (fault === "callerCancellation") yield* Fiber.interrupt(settling);
              yield* Deferred.succeed(releaseRename, undefined);
              const renameResult = yield* Fiber.join(renaming);
              const dependentResult = fault === "callerCancellation" ? undefined : yield* Fiber.join(settling);
              if (savingIndependent !== undefined) yield* Fiber.join(savingIndependent);
              return { request, definition, dependentId, markerId, tableName, dependentSavedBeforeFailure,
                renameResult, dependentResult, atomicBatch, bodyExecutions };
            }).pipe(Effect.timeout("15 seconds")), Deferred.succeed(releaseRename, undefined));
          })));
          const cold = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const database = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options);
            const binding = yield* database.bindNative({ definition: observed.definition });
            const read = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
            const rows = yield* read.operations.find(observed.tableName, {});
            yield* read.finishRead();
            const source = yield* database.begin();
            const marker = yield* source.get(observed.markerId);
            yield* source.abort();
            return { rows, marker, outcome: yield* database.recoverRequest(observed.request) };
          })));
          expect({ dependentSavedBeforeFailure: observed.dependentSavedBeforeFailure,
            dependentPresent: cold.rows.some(document => document._id === observed.dependentId),
            titleKCount: cold.rows.filter(document => document.title === "K").length,
            outcome: cold.outcome.kind, marker: cold.marker }).toMatchObject({
            dependentSavedBeforeFailure: false, dependentPresent: dependentCommits,
            titleKCount: rangeProfile ? dependentCommits ? 1 : 0 : dependentCommits || failsBeforeWrite ? 1 : 0,
            outcome: dependentCommits ? "committed" : "failed",
            marker: { _tag: "Some", value: { marker: atomic ? "seed" : "independent-saved" } },
          });
          expect(observed.bodyExecutions).toBe(1);
          if (rangeProfile) expect(cold.rows.filter(document => typeof document.amount === "number"
            && document.amount >= 10 && document.amount < 20)).toHaveLength(failsBeforeWrite ? 1 : 0);
          expect(observed.atomicBatch).toBe(atomic);
          if (failsBeforeWrite || losesPredecessorAcknowledgement)
            expect(observed.dependentResult).toEqual(observed.renameResult);
        } finally { await fixture.close(); }
      }, 60_000);
    }

    it("validates each source dependency after its own observation timestamp", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const table = yield* install(fixture);
          const { committer, begin, finish } = yield* open(fixture.persistence);
          const held = yield* finish(yield* begin());
          const create = yield* begin();
          const id = yield* create.insert("news", { title: "K" });
          yield* committer.submit(observing(yield* finish(create), slot(table, "K")));
          const demand = yield* begin();
          yield* demand.get(id);
          const captured = yield* finish(demand);
          const native = { ...held, nativeObservations: { indexes: [], limits: CORE_NATIVE_TEST_LIMITS,
            dependencies: [{ timestamp: captured.timestamp, reads: captured.reads }] } };
          expect(yield* committer.submit(native)).toBe(held.timestamp);
          const source = yield* Effect.result(committer.submit({ ...held, reads: captured.reads,
            nativeObservations: { indexes: [], dependencies: [], limits: CORE_NATIVE_TEST_LIMITS } }));
          expect(Result.isFailure(source) && source.failure).toMatchObject({ reason: "conflict" });
          const update = yield* begin();
          yield* update.patch(id, { title: "L" });
          yield* committer.submit(observing(yield* finish(update), slot(table, "K", [id]), slot(table, "L")));
          const changed = yield* Effect.result(committer.submit(native));
          expect(Result.isFailure(changed) && changed.failure).toMatchObject({ reason: "conflict" });
        })));
      } finally { await fixture.close(); }
    }, 30_000);

    it("validates result-only observations and accepts a published title create/rename ABA", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const table = yield* install(fixture);
          const { committer, begin, finish } = yield* open(fixture.persistence);
          const held = observing(yield* finish(yield* begin()), slot(table, "K"));
          const create = yield* begin();
          const id = yield* create.insert("news", { title: "K" });
          yield* committer.submit(observing(yield* finish(create), slot(table, "K")));
          const mismatch = yield* Effect.result(committer.submit(held));
          expect(Result.isFailure(mismatch) && mismatch.failure).toMatchObject({ reason: "conflict" });
          const rename = yield* begin();
          yield* rename.patch(id, { title: "L" });
          yield* committer.submit(observing(yield* finish(rename), slot(table, "K", [id]), slot(table, "L")));
          expect(yield* committer.submit(held)).toBe(held.timestamp);
          const expired = yield* Effect.result(committer.submit({ ...held, admissionDeadlineUnixMilliseconds: 0 }));
          expect(Result.isFailure(expired) && expired.failure).toMatchObject({ reason: "admissionExpired" });
        })));
      } finally { await fixture.close(); }
    }, 30_000);

    it("folds an accepted unpublished removal before comparing a published mismatch", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const table = yield* install(fixture);
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const observerAdmitting = yield* Deferred.make<void>();
          let markObserver = false;
          let delay = false;
          const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
            if (delay) { yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
            yield* fixture.persistence.write(lease, batch);
          }) };
          const { committer, begin, finish } = yield* open(persistence, { now: Effect.gen(function* () {
            if (markObserver) {
              markObserver = false;
              yield* Deferred.succeed(observerAdmitting, undefined);
            }
            return 1_000_000_000n;
          }) });
          const held = observing(yield* finish(yield* begin()), slot(table, "K"));
          const create = yield* begin();
          const id = yield* create.insert("news", { title: "K" });
          yield* committer.submit(observing(yield* finish(create), slot(table, "K")));
          const rename = yield* begin();
          yield* rename.patch(id, { title: "L" });
          yield* Effect.ensuring(Effect.gen(function* () {
            delay = true;
            const renaming = yield* Effect.forkChild(committer.submit(observing(yield* finish(rename),
              slot(table, "K", [id]), slot(table, "L"))));
            yield* Deferred.await(started);
            // Request-discovery pendingDocuments omits this key's tombstone.
            markObserver = true;
            const observingRemoval = yield* Effect.forkChild(committer.submit(held));
            yield* Deferred.await(observerAdmitting);
            // The clock runs inside acceptance. This real mutex-protected read
            // completes after that decision, while the rename is still unsaved.
            // Merely forking first does not order PostgreSQL prevalidation I/O.
            const observedSlot = slot(table, "K");
            expect(yield* committer.pendingDocuments(observedSlot.index.ref.id, observedSlot.interval)).toEqual([]);
            const replacement = yield* begin();
            yield* replacement.insert("news", { title: "K" });
            const replacing = yield* Effect.forkChild(committer.submit(observing(yield* finish(replacement), slot(table, "K"))));
            yield* Deferred.succeed(release, undefined);
            expect(yield* Fiber.join(observingRemoval)).toBe(held.timestamp);
            yield* Fiber.join(renaming);
            yield* Fiber.join(replacing);
          }).pipe(Effect.timeout("15 seconds")), Deferred.succeed(release, undefined));
        })));
      } finally { await fixture.close(); }
    }, 30_000);

    it("refreshes only validation when a relevant title publishes during preparation", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const table = yield* install(fixture);
          const scanned = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let gate = false;
          let delayed = false;
          let captures = 0;
          const titleIndex = slot(table, "K").index.ref.id;
          const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (at, retention) => Effect.gen(function* () {
            const snapshot = yield* fixture.persistence.readSnapshot(at, retention);
            return { ...snapshot, scan: request => Effect.gen(function* () {
              const page = yield* snapshot.scan(request);
              if (gate && bytesEqual(request.index.id, titleIndex)) {
                captures += 1;
                if (!delayed) { delayed = true; yield* Deferred.succeed(scanned, undefined); yield* Deferred.await(release); }
              }
              return page;
            }) };
          }) };
          const { committer, begin, finish } = yield* open(persistence);
          const held = observing(yield* finish(yield* begin()), slot(table, "K"));
          yield* Effect.ensuring(Effect.gen(function* () {
            gate = true;
            const settling = yield* Effect.forkChild(committer.submit(held));
            yield* Deferred.await(scanned);
            const create = yield* begin();
            const id = yield* create.insert("news", { title: "K" });
            yield* committer.submit(observing(yield* finish(create), slot(table, "K")));
            const rename = yield* begin();
            yield* rename.patch(id, { title: "L" });
            yield* committer.submit(observing(yield* finish(rename), slot(table, "K", [id]), slot(table, "L")));
            const beforeRelease = captures;
            yield* Deferred.succeed(release, undefined);
            expect(yield* Fiber.join(settling)).toBe(held.timestamp);
            expect(captures).toBeGreaterThan(beforeRelease);
          }).pipe(Effect.timeout("15 seconds")), Deferred.succeed(release, undefined));
        })));
      } finally { await fixture.close(); }
    }, 30_000);
  });
}

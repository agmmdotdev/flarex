import { randomBytes } from "node:crypto";
import { Deferred, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";
import { bytesEqual } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import type { CoreDatabase, CoreDatabaseOptions, CoreError, CoreRequestIdentity } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreNativeDefinition, type CoreNativeDefinition } from "../../src/core/nativePolicy";
import { readDocumentObject } from "../../src/core/registry";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
  maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
const timestamps = { createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
const install = Effect.fn("NativeReferenceCommitterFixture.install")(function* (database: CoreDatabase, definition: CoreNativeDefinition) {
  const proposal = yield* database.prepareSchema({ native: definition });
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], native: definition });
      return yield* database.bindNative({ definition });
    }
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Native reference schema ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Native reference schema did not become ready"));
});

export function registerNativeReferenceCommitterScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    for (const mode of ["targetInsertion", "sourceRemoval"] as const) it.each(["beforeWrite", "lostAcknowledgement", "success"] as const)(
      `keeps ${mode} integrity and correlated outcome behind its contributing save through %s`, async fault => {
        const fixture = await createFixture();
        try {
          const observed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const started = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
            const independentSaved = yield* Deferred.make<void>(), candidateAdmitting = yield* Deferred.make<void>();
            const independentAcknowledged = yield* Deferred.make<void>();
            let admissionMarker: Deferred.Deferred<void> | undefined;
            let armed = false, dependentSaved = false, bodyExecutions = 0;
            let gated: Readonly<{ tableId: Uint8Array; id: Uint8Array }> | undefined;
            let dependent: Readonly<{ tableId: Uint8Array; id: Uint8Array }> | undefined;
            const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
              const currentGate = gated, currentDependent = dependent;
              const blocked = armed && currentGate !== undefined && batch.documents.some(document =>
                bytesEqual(document.tableId, currentGate.tableId) && bytesEqual(document.id, currentGate.id));
              if (blocked) {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                if (fault === "beforeWrite") return yield* new CorePersistenceError({ reason: "unavailable" });
              }
              yield* fixture.persistence.write(lease, batch);
              if (armed && currentDependent !== undefined && batch.documents.some(document =>
                bytesEqual(document.tableId, currentDependent.tableId) && bytesEqual(document.id, currentDependent.id))) dependentSaved = true;
              for (const document of batch.documents) if (!document.deleted) {
                const body = yield* Effect.fromResult(readDocumentObject(document));
                if (body.marker === "independent-saved") yield* Deferred.succeed(independentSaved, undefined);
              }
              if (blocked && fault === "lostAcknowledgement") return yield* new CorePersistenceError({ reason: "uncertainWrite" });
            }) };
            const compiled = yield* compilePayloadCollections([
              { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
              { slug: "articles", fields: [{ name: "title", type: "text", required: true },
                { name: "author", type: "relationship", relationTo: "authors" }] },
            ]);
            const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
              scopeUuid: "8f5545a4-cd38-4ae0-a421-12fe85dcb727", epochUuid: "1e8aa599-efb5-45da-9b24-8e48f115f250" });
            const database = yield* openCoreDatabase(persistence, { ...options, now: Effect.gen(function* () {
              const marker = admissionMarker; admissionMarker = undefined;
              if (marker !== undefined) yield* Deferred.succeed(marker, undefined);
              return 1_000_000_000n;
            }) });
            const binding = yield* install(database, definition), metadata = yield* database.readNativeBinding(binding);
            const targetTable = metadata.tables.find(table => table.name === "authors"), sourceTable = metadata.tables.find(table => table.name === "articles");
            const commandName = mode === "targetInsertion" ? "payload-create" : "payload-delete";
            const command = metadata.commands.find(candidate => candidate.name === commandName);
            if (targetTable === undefined || sourceTable === undefined || command === undefined)
              return yield* Effect.die(new Error("Missing authenticated reference fixture endpoints"));
            const seed = yield* database.begin(), markerId = yield* seed.insert("independent", { marker: "seed" });
            yield* database.commit(yield* seed.finalize());
            let targetId: string, sourceId: string | undefined;
            if (mode === "sourceRemoval") {
              const seedNative = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
              targetId = yield* seedNative.operations.insert("authors", { name: "target", ...timestamps });
              sourceId = yield* seedNative.operations.insert("articles", { title: "initial-source", author: targetId, ...timestamps });
              yield* database.commit(yield* seedNative.finalize());
            } else {
              targetId = "";
            }
            const request: CoreRequestIdentity = { kind: "native", key: `native-reference-${mode}-${fault}`,
              requestHash: `native-reference-arguments-${mode}-${fault}`, native: command.identity };
            const acquisition = yield* database.claimRequest(request, binding);
            if (acquisition.kind !== "claimed") return yield* Effect.die(new Error("Missing reference fixture claim"));
            const predecessor = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName });
            if (mode === "targetInsertion") targetId = yield* predecessor.operations.insert("authors", { name: "target", ...timestamps });
            else {
              if (sourceId === undefined) return yield* Effect.die(new Error("Missing source to remove"));
              yield* predecessor.operations.delete(sourceId);
            }
            const predecessorFinalized = yield* predecessor.finalize();
            gated = { tableId: mode === "targetInsertion" ? targetTable.tabletId : sourceTable.tabletId,
              id: (yield* Effect.fromResult(decodeDocumentId(mode === "targetInsertion" ? targetId : sourceId))).internalId };
            const workers: Fiber.Fiber<Exit.Exit<bigint, CoreError>, never>[] = [];
            return yield* Effect.ensuring(Effect.gen(function* () {
              armed = true;
              const savingPredecessor = yield* Effect.forkChild(Effect.exit(database.commit(predecessorFinalized)));
              workers.push(savingPredecessor);
              yield* Deferred.await(started);
              const candidate = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName, claim: acquisition.claim });
              bodyExecutions += 1;
              const dependentId = mode === "targetInsertion"
                ? yield* candidate.operations.insert("articles", { title: "dependent", author: targetId, ...timestamps })
                : targetId;
              if (mode === "sourceRemoval") yield* candidate.operations.delete(targetId);
              const candidateFinalized = yield* candidate.finalize();
              dependent = { tableId: mode === "targetInsertion" ? sourceTable.tabletId : targetTable.tabletId,
                id: (yield* Effect.fromResult(decodeDocumentId(dependentId))).internalId };
              admissionMarker = candidateAdmitting;
              const savingCandidate = yield* Effect.forkChild(Effect.exit(database.commit(candidateFinalized,
                { claim: acquisition.claim, result: { id: dependentId, mode } })));
              workers.push(savingCandidate);
              yield* Deferred.await(candidateAdmitting);
              const independent = yield* database.begin();
              yield* independent.patch(markerId, { marker: "independent-saved" });
              const savingIndependent = yield* Effect.forkChild(Effect.exit(database.commit(yield* independent.finalize())).pipe(
                Effect.tap(() => Deferred.succeed(independentAcknowledged, undefined))));
              workers.push(savingIndependent);
              yield* Deferred.await(independentSaved);
              // A later independent save really completed; the contributing
              // predecessor still blocks native durability and ordered publication.
              expect(yield* Deferred.isDone(independentAcknowledged)).toBe(false);
              const dependentSavedBeforeRelease = dependentSaved;
              yield* Deferred.succeed(release, undefined);
              const predecessorResult = yield* Fiber.join(savingPredecessor), candidateResult = yield* Fiber.join(savingCandidate);
              const independentResult = yield* Fiber.join(savingIndependent);
              return { definition, request, targetId, sourceId, dependentId, markerId,
                predecessorResult, candidateResult, independentResult, dependentSavedBeforeRelease, bodyExecutions };
            }).pipe(Effect.timeout("20 seconds")), Effect.gen(function* () {
              yield* Deferred.succeed(release, undefined);
              for (const worker of workers) yield* Fiber.await(worker);
            }));
          })));
          const coldPersistence = await fixture.reopen();
          const cold = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const database = yield* openCoreDatabase(coldPersistence, options);
            const binding = yield* database.bindNative({ definition: observed.definition });
            const read = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
            const target = yield* read.operations.get(observed.targetId);
            const sources = yield* read.operations.find("articles", {});
            const reverse = yield* read.operations.incomingReferences("author", observed.targetId, { limit: 16 });
            yield* read.finishRead();
            const independent = yield* database.begin(), marker = yield* independent.get(observed.markerId);
            yield* independent.abort();
            return { target, sources, reverse, marker, outcome: yield* database.recoverRequest(observed.request) };
          })));
          const foreignPersistence = await fixture.reopen("other-native-reference-instance");
          const foreignOutcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const foreign = yield* openCoreDatabase(foreignPersistence, options);
            return yield* foreign.recoverRequest(observed.request);
          })));
          expect(observed.dependentSavedBeforeRelease).toBe(false);
          expect(observed.bodyExecutions).toBe(1);
          expect(cold.marker).toMatchObject({ _tag: "Some", value: { marker: "independent-saved" } });
          expect(cold.outcome.kind).toBe(fault === "success" ? "committed" : "failed");
          expect(foreignOutcome).toEqual({ kind: "missing" });
          if (fault === "success") {
            expect(Exit.isSuccess(observed.predecessorResult)).toBe(true);
            expect(Exit.isSuccess(observed.candidateResult)).toBe(true);
            expect(Exit.isSuccess(observed.independentResult)).toBe(true);
          } else {
            expect(observed.candidateResult).toEqual(observed.predecessorResult);
            expect(Exit.isFailure(observed.candidateResult)).toBe(true);
          }
          if (mode === "targetInsertion") {
            expect(Option.isSome(cold.target)).toBe(fault !== "beforeWrite");
            expect(cold.sources.map(document => document._id)).toEqual(fault === "success" ? [observed.dependentId] : []);
            expect(cold.reverse.ids).toEqual(fault === "success" ? [observed.dependentId] : []);
          } else {
            expect(Option.isSome(cold.target)).toBe(fault !== "success");
            expect(cold.sources.map(document => document._id)).toEqual(fault === "beforeWrite" ? [observed.sourceId] : []);
            expect(cold.reverse.ids).toEqual(fault === "beforeWrite" ? [observed.sourceId] : []);
          }
        } finally { await fixture.close(); }
      }, 60_000);
  });
}

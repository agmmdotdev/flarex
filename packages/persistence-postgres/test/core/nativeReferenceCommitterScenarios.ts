import { randomBytes } from "node:crypto";
import { Deferred, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import type { CoreDatabase, CoreDatabaseOptions, CoreError, CoreNativeOperations, CoreRequestIdentity } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence, type CorePersistenceSnapshot } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreNativeDefinition, type CoreNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import { preparePayloadConformanceSource } from "../integration/payload/payloadNativeManyFixture";
import { readDocumentObject } from "../../src/core/registry";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
  maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
const timestamps = { createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
const install = Effect.fn("NativeReferenceCommitterFixture.install")(function* (database: CoreDatabase, definition: CoreNativeDefinition, bundle?: CoreSchemaBundle) {
  const proposal = yield* database.prepareSchema(bundle === undefined ? { native: definition } : { bundle });
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, bundle === undefined ? { programs: [], native: definition } : { programs: [], bundle });
      return yield* database.bindNative({ definition });
    }
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Native reference schema ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Native reference schema did not become ready"));
});

export function registerNativeReferenceCommitterScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>, referenceMode: "one" | "many" = "one"): void {
  describe(label, () => {
    for (const mode of ["targetInsertion", "sourceRemoval"] as const) it.each(["beforeWrite", "lostAcknowledgement", "success"] as const)(
      `keeps ${mode} integrity and correlated outcome behind its contributing save through %s`, async fault => {
        const fixture = await createFixture();
        try {
          const manySource = referenceMode === "many" ? await preparePayloadConformanceSource("payload.content-many") : undefined;
          const sourceName = manySource === undefined ? "articles" : "posts", targetName = manySource === undefined ? "authors" : "posts";
          const forwardName = manySource === undefined ? "author" : "relatedPosts";
          const targetBody = manySource === undefined ? { name: "target", ...timestamps }
            : { title: "target", score: 0, enabled: false, publishedAt: timestamps.createdAt, relatedPosts: [], ...timestamps };
          const sourceBody = (title: string, targetId: string) => manySource === undefined ? { title, author: targetId, ...timestamps }
            : { title, score: 0, enabled: false, publishedAt: timestamps.createdAt, relatedPosts: [targetId], ...timestamps };
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
            const compiled = manySource ?? (yield* compilePayloadCollections([
              { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
              { slug: "articles", fields: [{ name: "title", type: "text", required: true },
                { name: "author", type: "relationship", relationTo: "authors" }] },
            ]));
            const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
              scopeUuid: "8f5545a4-cd38-4ae0-a421-12fe85dcb727", epochUuid: "1e8aa599-efb5-45da-9b24-8e48f115f250" });
            const bundle = manySource === undefined ? undefined : yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
            const database = yield* openCoreDatabase(persistence, { ...options, ...(bundle === undefined ? {} : { schemaBundles: [bundle] }), now: Effect.gen(function* () {
              const marker = admissionMarker; admissionMarker = undefined;
              if (marker !== undefined) yield* Deferred.succeed(marker, undefined);
              return 1_000_000_000n;
            }) });
            const binding = yield* install(database, definition, bundle), metadata = yield* database.readNativeBinding(binding);
            const targetTable = metadata.tables.find(table => table.name === targetName), sourceTable = metadata.tables.find(table => table.name === sourceName);
            const commandName = mode === "targetInsertion" ? "payload-create" : "payload-delete";
            const command = metadata.commands.find(candidate => candidate.name === commandName);
            if (targetTable === undefined || sourceTable === undefined || command === undefined)
              return yield* Effect.die(new Error("Missing authenticated reference fixture endpoints"));
            const seed = yield* database.begin(), markerId = yield* seed.insert("independent", { marker: "seed" });
            yield* database.commit(yield* seed.finalize());
            let targetId: string, sourceId: string | undefined;
            if (mode === "sourceRemoval") {
              const seedNative = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
              targetId = yield* seedNative.operations.insert(targetName, targetBody);
              sourceId = yield* seedNative.operations.insert(sourceName, sourceBody("initial-source", targetId));
              yield* database.commit(yield* seedNative.finalize());
            } else {
              targetId = "";
            }
            const request: CoreRequestIdentity = { kind: "native", key: `native-reference-${mode}-${fault}`,
              requestHash: `native-reference-arguments-${mode}-${fault}`, native: command.identity };
            const acquisition = yield* database.claimRequest(request, binding);
            if (acquisition.kind !== "claimed") return yield* Effect.die(new Error("Missing reference fixture claim"));
            const predecessor = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName });
            if (mode === "targetInsertion") targetId = yield* predecessor.operations.insert(targetName, targetBody);
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
                ? yield* candidate.operations.insert(sourceName, sourceBody("dependent", targetId))
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
              return { definition, bundle, request, targetId, sourceId, dependentId, markerId,
                predecessorResult, candidateResult, independentResult, dependentSavedBeforeRelease, bodyExecutions };
            }).pipe(Effect.timeout("20 seconds")), Effect.gen(function* () {
              yield* Deferred.succeed(release, undefined);
              for (const worker of workers) yield* Fiber.await(worker);
            }));
          })));
          const coldPersistence = await fixture.reopen();
          const cold = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const database = yield* openCoreDatabase(coldPersistence, { ...options,
              ...(observed.bundle === undefined ? {} : { schemaBundles: [observed.bundle] }) });
            const binding = yield* database.bindNative({ definition: observed.definition });
            const read = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
            const target = yield* read.operations.get(observed.targetId);
            const sources = (yield* read.operations.find(sourceName, {})).filter(document => document.title === "initial-source" || document.title === "dependent");
            const reverse = yield* read.operations.incomingReferences(forwardName, observed.targetId, { limit: 16 });
            yield* read.finishRead();
            const independent = yield* database.begin(), marker = yield* independent.get(observed.markerId);
            yield* independent.abort();
            return { target, sources, reverse, marker, outcome: yield* database.recoverRequest(observed.request) };
          })));
          const foreignPersistence = await fixture.reopen("other-native-reference-instance");
          const foreignOutcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const foreign = yield* openCoreDatabase(foreignPersistence, { ...options,
              ...(observed.bundle === undefined ? {} : { schemaBundles: [observed.bundle] }) });
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

    if (referenceMode === "many") it("authenticates normalization without reads and keeps private members outside the business cap on the trusted ID stream", async () => {
      const fixture = await createFixture();
      try {
        const compiled = await preparePayloadConformanceSource("payload.content-many");
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          let latestSeed: Uint8Array | undefined;
          let snapshotReads = 0;
          const batches: import("../../src/core/contracts").CoreWriteBatch[] = [];
          const persistence: CorePersistence = { ...fixture.persistence,
            readSnapshot: (at, retention) => Effect.map(fixture.persistence.readSnapshot(at, retention), (snapshot): CorePersistenceSnapshot => ({ ...snapshot,
              get: (tableId, id) => Effect.suspend(() => { snapshotReads += 1; return snapshot.get(tableId, id); }),
              scan: request => Effect.suspend(() => { snapshotReads += 1; return snapshot.scan(request); }),
            })),
            write: (lease, batch) => fixture.persistence.write(lease, batch)
            .pipe(Effect.tap(() => Effect.sync(() => { batches.push(batch); }))) };
          const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
            scopeUuid: "8f5545a4-cd38-4ae0-a421-12fe85dcb727", epochUuid: "1e8aa599-efb5-45da-9b24-8e48f115f250" });
          const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
          const database = yield* openCoreDatabase(persistence, { ...options, schemaBundles: [bundle],
            randomBytes: length => Effect.sync(() => {
              const seed = randomBytes(length); if (length === 32) latestSeed = seed.slice(); return seed;
            }) });
          const binding = yield* install(database, definition, bundle);
          const privateName = definition.privateTables?.[0]?.name;
          if (privateName === undefined) return yield* Effect.die(new Error("Missing authenticated private accounting declaration"));
          const ordinary = yield* database.begin();
          expect(yield* ordinary.normalizeId("unknown", undefined)).toEqual(Option.none());
          const unownedId = yield* ordinary.insert("unowned", { marker: "outside-native-authority" });
          yield* database.commit(yield* ordinary.finalize());
          const body = (title: string, relatedPosts: readonly string[]) => ({ title, relatedPosts,
            score: 0, enabled: false, publishedAt: timestamps.createdAt, ...timestamps });
          const seed = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
          const targets: string[] = [];
          for (let index = 0; index < 32; index++) targets.push(yield* seed.operations.insert("posts", body(`seed-${index}`, [])));
          yield* database.commit(yield* seed.finalize());
          const firstTarget = targets[0];
          if (firstTarget === undefined) return yield* Effect.die(new Error("Missing normalization target"));
          const assertNormalization = Effect.fn("NativeReferenceCommitterFixture.assertNormalization")(function* (operations: Pick<CoreNativeOperations, "normalizeId">) {
            const before = snapshotReads;
            for (const targetId of targets) expect(yield* operations.normalizeId("posts", targetId)).toEqual(Option.some(targetId));
            for (const value of [undefined, "malformed", unownedId])
              expect(yield* operations.normalizeId("posts", value)).toEqual(Option.none());
            for (const [name, reason] of [["unknown", "missingTable"], ["unowned", "authorityRevoked"], [privateName, "authorityRevoked"]] as const) {
              for (const value of [undefined, "malformed", firstTarget])
                expect(yield* Effect.flip(operations.normalizeId(name, value))).toMatchObject({ _tag: "CoreTransactionError", reason });
            }
            expect(snapshotReads).toBe(before);
          });
          const standalone = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
          yield* assertNormalization(standalone.operations);
          const token = yield* standalone.finishRead();
          const normalizationRegistry = yield* readCoreFixtureRegistry({ persistence }, token.timestamp);
          const sourceById = normalizationRegistry.table("posts")?.definition.indexes.find(index => index.name === "by_id");
          if (sourceById === undefined) return yield* Effect.die(new Error("Missing normalization source index"));
          expect(token.reads.some(read => bytesEqual(read.indexId, sourceById.ref.id))).toBe(false);
          const root = yield* database.bindNativeRoot({ bundle, contract: { name: "native-many-private-accounting", version: 1 },
            participants: [{ binding, commands: ["payload-create"], limits: { maxIdentities: 33, maxDocumentBytes: 65_536 } }],
            maxFinalUserDocuments: 1 });
          const metadata = yield* database.readNativeRootBinding(root);
          const identity: CoreRequestIdentity = { kind: "nativeRoot", root: metadata.identity,
            key: "native-many-one-business-document", requestHash: "native-many-thirty-two-members" };
          const acquisition = yield* database.claimRequest(identity, root);
          if (acquisition.kind !== "claimed") return yield* Effect.die(new Error("Fresh accounting request was not claimed"));
          const operation = yield* database.beginNativeRoot(root, { claim: acquisition.claim, ...coreNativeTestBudget() });
          const selectedSeed = latestSeed;
          if (selectedSeed === undefined) return yield* Effect.die(new Error("Native root did not draw its transaction seed"));
          const preview = yield* Effect.fromResult(createTransactionIdGenerator(selectedSeed, 1_000_000_000n));
          const expected = Array.from({ length: 33 }, () => encodeBytesToLowercaseHex(preview.nextInternalId()));
          const nativeOperations = yield* operation.native(binding);
          yield* assertNormalization(nativeOperations);
          const created = yield* nativeOperations.insert("posts", body("single-business-source", targets));
          const firstBatch = batches.length;
          const timestamp = yield* database.commit(yield* operation.finalize(), { claim: acquisition.claim, result: { id: created } });
          const registry = yield* readCoreFixtureRegistry({ persistence }, timestamp);
          const table = registry.table("posts")?.definition;
          const privateTable = registry.table(privateName)?.definition;
          if (table === undefined || privateTable === undefined) return yield* Effect.die(new Error("Missing authenticated accounting tables"));
          const written = batches.slice(firstBatch).flatMap(batch => batch.documents);
          const publicDocuments = written.filter(document => bytesEqual(document.tableId, table.tabletId));
          const privateDocuments = written.filter(document => bytesEqual(document.tableId, privateTable.tabletId));
          expect(publicDocuments).toHaveLength(1);
          expect(privateDocuments).toHaveLength(32);
          expect(privateDocuments.every(document => document.prevTs === null && !document.deleted)).toBe(true);
          expect(encodeBytesToLowercaseHex((yield* Effect.fromResult(decodeDocumentId(created))).internalId)).toBe(expected[0]);
          expect(new Set(privateDocuments.map(document => encodeBytesToLowercaseHex(document.id)))).toEqual(new Set(expected.slice(1)));
          expect(new Set([...publicDocuments, ...privateDocuments].map(document => document.ts))).toEqual(new Set([timestamp]));
          expect(yield* database.recoverRequest(identity)).toEqual({ kind: "committed", timestamp, result: { id: created } });
          const excessiveIdentity: CoreRequestIdentity = { ...identity, key: "native-many-two-business-documents", requestHash: "two-business-documents" };
          const excessiveClaim = yield* database.claimRequest(excessiveIdentity, root);
          if (excessiveClaim.kind !== "claimed") return yield* Effect.die(new Error("Fresh excessive request was not claimed"));
          const excessive = yield* database.beginNativeRoot(root, { claim: excessiveClaim.claim, ...coreNativeTestBudget() });
          const excessiveOperations = yield* excessive.native(binding);
          yield* excessiveOperations.insert("posts", body("excessive-a", []));
          yield* excessiveOperations.insert("posts", body("excessive-b", []));
          expect(yield* Effect.flip(excessive.finalize())).toMatchObject({ reason: "capacity", cause: "Native final user document limit" });
          yield* excessive.abort(); yield* database.abortRequest(excessiveClaim.claim);
          const read = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
          expect((yield* read.operations.find("posts", {}))).toHaveLength(33);
          yield* read.finishRead();
        })));
      } finally { await fixture.close(); }
    }, 60_000);
  });
}

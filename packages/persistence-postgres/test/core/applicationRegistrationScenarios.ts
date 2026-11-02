import { prepareApplication, activateApplication } from "./applicationDeploymentFixture";
import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option, Result } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { describe, expect, it, vi } from "vitest";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreApplicationRegistration, CoreApplicationRegistrationMetadata, CoreDatabase, CoreError, CoreSchemaProposal } from "../../src/core/api";
import { readActiveCoreApplicationRegistration } from "../../src/core/applicationRegistration";
import * as coreDocuments from "../../src/core/document";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { readDocumentObject, PROGRAMS, TABLES, type CoreRegistry } from "../../src/core/registry";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import { serializeCoreSchema } from "../../src/core/schemaJson";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreDocumentLogEntry, CoreIndexScan, CoreInterval, CorePersistence } from "../../src/core/contracts";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";

const schema = { tables: [{ tableName: "items", documentType: { type: "any" }, indexes: [], stagedDbIndexes: [] }], schemaValidation: true };
const emptySchema = { tables: [], schemaValidation: true };
const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const registration = (extra: Partial<CoreApplicationRegistration> = {}): CoreApplicationRegistration => ({
  deploymentId: "registration-scenario", scopeUuid: "74bd6a8e-8dd1-414b-9515-0f342e8c5762", epochUuid: "e56ca002-c0b7-4881-8105-a8d7c23cf70d",
  sourceArtifactRootSha256: "a".repeat(64), sourcePackageHash: "b".repeat(64), analyzerIdentity: "c".repeat(64),
  analyzerPolicyIdentity: "flarex.application-analysis-policy/compat=2026-10-01;fetch=deny", compatibilityDate: "2026-10-01", generation: 1,
  programs: [{ identity: { functionPath: "items:write", programHash: "e".repeat(64), schemaHash: "f".repeat(64) }, metadata: { int: 42n, binary: new Uint8Array([1, 2]).buffer } },
    { identity: { functionPath: "items:read", programHash: "1".repeat(64), schemaHash: "f".repeat(64) }, metadata: { purpose: "query" } }], ...extra,
});
const ready = Effect.fn("ApplicationRegistrationFixture.ready")(function* (database: CoreDatabase, proposal: CoreSchemaProposal) {
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) return;
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Unexpected registration state ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Registration schema did not become ready"));
});
const rejected = <A>(result: Result.Result<A, CoreError>) => { expect(Result.isFailure(result) && result.failure)
  .toMatchObject({ reason: "unsupportedCapability" }); };

export function registerCoreApplicationRegistrationScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    for (const phase of ["pending", "validated"] as const) it(`resumes an exact ${phase} reservation after a cold reopen and preserves populated active idempotence`, async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const frame = registration();
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const proposal = yield* prepareApplication(database, { schema, registration: frame });
        if (phase === "validated") yield* ready(database, proposal);
        expect((yield* database.schemaStatus(proposal)).state).toBe(phase);
        yield* database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), db => db.close());
        expect(yield* reopened.readApplicationRegistration()).toEqual(Option.none());
        expect(yield* prepareApplication(reopened, { schema, registration: registration() })).toEqual(proposal);
        yield* ready(reopened, proposal);
        yield* reopened.activateApplicationCandidate(proposal.candidateId, { programs: frame.programs });
        const seed = yield* reopened.begin(); yield* seed.insert("items", { value: "legitimate" }); yield* reopened.commit(yield* seed.finalize());
        const before = yield* reopened.publishedTimestamp;
        yield* reopened.close();
        const active = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), db => db.close());
        expect(yield* prepareApplication(active, { schema, registration: registration() })).toEqual(proposal);
        yield* active.activateApplicationCandidate(proposal.candidateId, { programs: frame.programs });
        rejected(yield* Effect.result(active.publishPrograms({ programs: frame.programs })));
        expect(yield* active.publishedTimestamp).toBe(before);
        const actual = yield* active.readApplicationRegistration();
        expect(Option.isSome(actual) && actual.value).toEqual({ ...frame, candidateId: proposal.candidateId, programs: [...frame.programs]
          .sort((a, b) => a.identity.functionPath.localeCompare(b.identity.functionPath)).map(program => ({ identity: program.identity })) });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("rejects changed provenance, schema, incomplete programs, metadata, or omitted lifecycle proof", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const frame = registration();
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const proposal = yield* prepareApplication(database, { schema, registration: frame });
        const before = yield* database.publishedTimestamp;
        rejected(yield* Effect.result(database.prepareSchema({ schema })));
        const namespace = { kind: "byComponent" as const, id: yield* Effect.fromResult(encodeDocumentId(10001, new Uint8Array(16))) };
        rejected(yield* Effect.result(database.prepareSchema({ schema: emptySchema, namespace })));
        rejected(yield* Effect.result(database.publishPrograms({ programs: frame.programs })));
        rejected(yield* Effect.result(database.publishPrograms({ programs: frame.programs })));
        for (const changed of [registration({ deploymentId: "other" }), registration({ scopeUuid: "a4bd6a8e-8dd1-414b-9515-0f342e8c5762" }),
          registration({ epochUuid: "a56ca002-c0b7-4881-8105-a8d7c23cf70d" })])
          rejected(yield* Effect.result(prepareApplication(database, { schema, registration: changed })));
        expect(yield* database.publishedTimestamp).toBe(before);
        yield* ready(database, proposal);
        rejected(yield* Effect.result(database.activateSchema(proposal, { programs: frame.programs })));
        rejected(yield* Effect.result(database.activateApplicationCandidate(proposal.candidateId, { programs: frame.programs.slice(0, 1) })));
        const changedPrograms = frame.programs.map(program => ({ ...program, metadata: { changed: true } }));
        rejected(yield* Effect.result(database.activateApplicationCandidate(proposal.candidateId, { programs: changedPrograms })));
        yield* database.activateApplicationCandidate(proposal.candidateId, { programs: frame.programs });
        rejected(yield* Effect.result(database.publishPrograms({ programs: [] })));
        rejected(yield* Effect.result(prepareApplication(database, { schema, registration: registration({ epochUuid: "a56ca002-c0b7-4881-8105-a8d7c23cf70d" }) })));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    for (const retained of ["empty-lookalike", "nonempty", "extra", "programs", "foreign-schema", "foreign-component-schema"] as const)
      it(`rejects first registration over an untagged ${retained}`, async () => {
        const fixture = await createFixture();
        try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
          if (retained === "programs") yield* database.publishPrograms({ programs: registration().programs });
          else if (retained === "foreign-schema") yield* database.prepareSchema({ schema: emptySchema });
          else if (retained === "foreign-component-schema") yield* database.prepareSchema({ schema: emptySchema,
            namespace: { kind: "byComponent", id: yield* Effect.fromResult(encodeDocumentId(10001, new Uint8Array(16))) } });
          else {
            const seed = yield* database.begin();
            const id = yield* seed.insert(retained === "extra" ? "other" : "items", { value: "existing" });
            if (retained !== "nonempty") yield* seed.delete(id);
            yield* database.commit(yield* seed.finalize());
          }
          const before = yield* database.publishedTimestamp;
          expect(yield* database.readApplicationRegistration()).toEqual(Option.none());
          rejected(yield* Effect.result(prepareApplication(database, { schema, registration: registration() })));
          expect(yield* database.publishedTimestamp).toBe(before);
        }))); } finally { await fixture.close(); }
      }, 90_000);

    it("rejects a native-owned table and does not transfer its ownership", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const compiled = yield* compilePayloadCollections([{ slug: "posts", fields: [{ name: "title", type: "text" }] }]);
        const native = yield* makeCoreNativeDefinition({ scopeUuid: registration().scopeUuid, epochUuid: registration().epochUuid, source: compiled.sourceContract });
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        yield* database.prepareSchema({ native });
        rejected(yield* Effect.result(prepareApplication(database, { schema, registration: registration() })));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("supports zero-table zero-program registration without synthesizing an anchor", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const frame = registration({ programs: [] });
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        yield* activateApplication(database, emptySchema, { programs: [], applicationRegistration: frame });
        expect(Option.isSome(yield* database.readApplicationRegistration())).toBe(true);
        rejected(yield* Effect.result(database.prepareSchema({ schema: emptySchema })));
        rejected(yield* Effect.result(database.publishPrograms({ programs: [] })));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("reuses full registration authentication per immutable metadata version without sharing program buffers or caching admission", async () => {
      const fixture = await createFixture();
      const capture = vi.spyOn(coreDocuments, "captureCoreObject");
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const frame = registration(), database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        yield* activateApplication(database, schema, { programs: frame.programs, applicationRegistration: frame });
        const before = capture.mock.calls.length;
        const first = yield* database.readApplicationRegistration();
        const authenticated = capture.mock.calls.length;
        expect(authenticated).toBeGreaterThan(before);
        expect(yield* database.readApplicationRegistration()).toEqual(first);
        expect(capture.mock.calls).toHaveLength(authenticated);
        if (Option.isNone(first)) return yield* Effect.die(new Error("Missing registration"));
        expect(Object.isFrozen(first.value)).toBe(true);
        expect(Object.isFrozen(first.value.programs)).toBe(true);
        for (const program of first.value.programs) {
          expect(Object.keys(program)).toEqual(["identity"]);
          expect(Object.isFrozen(program)).toBe(true); expect(Object.isFrozen(program.identity)).toBe(true);
        }
        const seed = yield* database.begin(); yield* seed.insert("items", { value: "ordinary data" }); yield* database.commit(yield* seed.finalize());
        const afterData = capture.mock.calls.length;
        yield* database.readApplicationRegistration(); expect(capture.mock.calls).toHaveLength(afterData);
        yield* database.advanceAuthorityEpoch(1n);
        const beforeNewRegistry = capture.mock.calls.length;
        yield* database.readApplicationRegistration(); expect(capture.mock.calls.length).toBeGreaterThan(beforeNewRegistry);
        yield* database.close();
        const refused = yield* Effect.result(database.readApplicationRegistration());
        expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "closed" });
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), db => db.close());
        const reconstructed = capture.mock.calls.length;
        yield* reopened.readApplicationRegistration(); expect(capture.mock.calls.length).toBeGreaterThan(reconstructed);
        const verifiedAgain = capture.mock.calls.length;
        yield* reopened.readApplicationRegistration(); expect(capture.mock.calls).toHaveLength(verifiedAgain);
      }))); } finally { capture.mockRestore(); await fixture.close(); }
    }, 90_000);

    it("records dependencies on memo hits and invalidates changed schema, program, head and index registry roots", async () => {
      const fixture = await createFixture();
      const capture = vi.spyOn(coreDocuments, "captureCoreObject");
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const frame = registration(), database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        yield* activateApplication(database, schema, { programs: frame.programs, applicationRegistration: frame });
        const registry = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const memo = new WeakMap<CoreRegistry, CoreApplicationRegistrationMetadata>();
        const reads: Readonly<{ id: Uint8Array; interval: CoreInterval }>[] = [];
        const context = (selected: CoreRegistry) => ({ registry: selected, schemaRegistry: selected.schemas, namespace: null,
          addIndexRead: (id: Uint8Array, interval: CoreInterval) => { reads.push({ id: id.slice(), interval }); } });
        yield* readActiveCoreApplicationRegistration(context(registry), memo);
        const firstReads = [...reads], count = capture.mock.calls.length;
        reads.length = 0;
        yield* readActiveCoreApplicationRegistration(context(registry), memo);
        expect(reads).toEqual(firstReads); expect(reads).toHaveLength(5);
        expect(capture.mock.calls).toHaveLength(count);
        const changedIndexRoot = registry.withIndexes(registry.indexes);
        yield* readActiveCoreApplicationRegistration(context(changedIndexRoot), memo);
        expect(capture.mock.calls.length).toBeGreaterThan(count);
        const record = [...registry.programs.values()][0], head = [...registry.heads.values()][0];
        if (record === undefined || head === undefined) return yield* Effect.die(new Error("Missing registry program"));
        const changedProgram = registry.withProgram({ ...record, definition: { ...record.definition, metadata: { changed: true } } });
        rejected(yield* Effect.result(readActiveCoreApplicationRegistration(context(changedProgram), memo)));
        const failed = capture.mock.calls.length;
        rejected(yield* Effect.result(readActiveCoreApplicationRegistration(context(changedProgram), memo)));
        expect(capture.mock.calls.length).toBeGreaterThan(failed);
        const changedHead = registry.withHead({ ...head, identity: { ...head.identity, programHash: "3".repeat(64) } });
        rejected(yield* Effect.result(readActiveCoreApplicationRegistration(context(changedHead), memo)));
        const stateIndex = registry.table("_schemas")?.definition.indexes.find(candidate => candidate.name === "by_state");
        if (stateIndex === undefined) return yield* Effect.die(new Error("Missing schema state index"));
        const active = yield* Effect.fromResult(registry.schemas.getByState(null, "active", stateIndex.ref, () => {}));
        if (Option.isNone(active)) return yield* Effect.die(new Error("Missing active schema"));
        const oldDocument = { id: active.value.id, creationTime: active.value.creationTime, value: active.value.metadata };
        const changedSchema = yield* Effect.fromResult(serializeCoreSchema(yield* Effect.fromResult(captureCoreSchema(emptySchema))));
        const schemas = yield* Effect.fromResult(registry.schemas.withDocument(null, oldDocument,
          { ...oldDocument, value: { ...oldDocument.value, schema: changedSchema } }));
        expect(yield* Effect.result(readActiveCoreApplicationRegistration(context(registry.withSchemas(schemas)), memo)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
      }))); } finally { capture.mockRestore(); await fixture.close(); }
    }, 90_000);

    it("activates over compatible populated data and retains omitted table identities", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const frame = registration(), database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const proposal = yield* prepareApplication(database, { schema, registration: frame }); yield* ready(database, proposal);
        const seed = yield* database.begin(); const id = yield* seed.insert("items", { injected: true }); yield* database.commit(yield* seed.finalize());
        yield* database.activateApplicationCandidate(proposal.candidateId, { programs: frame.programs });
        const omitted = yield* prepareApplication(database, { schema: emptySchema, registration: registration({ programs: [] }) });
        yield* ready(database, omitted); yield* database.activateApplicationCandidate(omitted.candidateId, { programs: [] });
        const read = yield* database.begin(); expect(Option.isSome(yield* read.get(id))).toBe(true); yield* read.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("allows only one concurrent distinct fresh registration", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const results = yield* Effect.all([registration(), registration({ sourceArtifactRootSha256: "2".repeat(64) })]
          .map(frame => Effect.result(prepareApplication(database, { schema, registration: frame }))), { concurrency: 2 });
        expect(results.filter(Result.isSuccess)).toHaveLength(1);
        expect(results.filter(Result.isFailure)).toHaveLength(1);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("fences an unregistered publication on the deployment-kind absence observed before registration", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp, retention);
          if (pause) { pause = false; yield* Deferred.succeed(observed, undefined); yield* Deferred.await(release); }
          return snapshot;
        }) };
        const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
        const registry = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const index = registry.table(PROGRAMS)?.definition.indexes.find(candidate => candidate.name === "by_identity");
        if (index === undefined) return yield* Effect.die("Missing actual program-identity index");
        yield* Effect.gen(function* () {
          pause = true;
          const publishing = yield* Effect.forkChild(Effect.result(database.publishPrograms({ programs: registration().programs })));
          yield* Deferred.await(observed);
          yield* prepareApplication(database, { schema: emptySchema, registration: registration({ programs: [] }) });
          yield* Deferred.succeed(release, undefined);
          const result = yield* Fiber.join(publishing);
          expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "conflict", cause: { indexId: index.ref.id } });
          expect(yield* Effect.result(database.selectProgram("items:read")))
            .toMatchObject({ _tag: "Failure", failure: { reason: "programUnavailable" } });
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    for (const foreign of ["table", "program"] as const) it(`tracks ${foreign} catalog absence for zero-table registration during concurrent admission`, async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp, retention);
          if (pause) { pause = false; yield* Deferred.succeed(observed, undefined); yield* Deferred.await(release); }
          return snapshot;
        }) };
        const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
        pause = true;
        const preparing = yield* Effect.forkChild(Effect.result(prepareApplication(database, { schema: emptySchema, registration: registration({ programs: [] }) })));
        yield* Deferred.await(observed);
        if (foreign === "program") yield* database.publishPrograms({ programs: registration().programs });
        else { const seed = yield* database.begin(); yield* seed.insert("other", {}); yield* database.commit(yield* seed.finalize()); }
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(preparing);
        expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "conflict" });
        expect(yield* database.readApplicationRegistration()).toEqual(Option.none());
      }))); } finally { await fixture.close(); }
    }, 90_000);

    for (const state of ["hidden", "deleting"] as const) it(`rejects an otherwise empty ${state} retained table`, async () => {
      const fixture = await createFixture();
      const tables: CoreDocumentLogEntry[] = [];
      try {
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          for (const entry of batch.documents) if (!entry.deleted && (yield* Effect.fromResult(readDocumentObject(entry))).name === "items") tables.push(entry);
        }) };
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
          const tx = yield* database.begin(); const id = yield* tx.insert("items", {}); yield* tx.delete(id); yield* database.commit(yield* tx.finalize());
        })));
        const record = tables.at(-1);
        if (record === undefined) throw new Error(`Missing ${TABLES} witness`);
        const document = Result.getOrThrow(readDocumentObject(record));
        await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1 WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [Result.getOrThrow(encodeDocumentValue({ ...document, state })), fixture.instanceName, record.tableId, record.id, record.ts.toString()]);
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), db => db.close());
          rejected(yield* Effect.result(prepareApplication(database, { schema, registration: registration() })));
        })));
      } finally { await fixture.close(); }
    }, 90_000);
  });
}

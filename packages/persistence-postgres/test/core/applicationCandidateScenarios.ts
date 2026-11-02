import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option, Result } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { describe, expect, it, vi } from "vitest";
import { CoreTransactionError, type CoreApplicationRegistration, type CoreDatabase, type CoreError, type CoreSchemaProposal } from "../../src/core/api";
import type { CoreIndexScan, CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { readCoreApplicationCandidateEvidence } from "../../src/core/applicationRegistration";
import { CoreFinalizationVault, createCoreTransaction, prepareCoreTransactionIds, type CoreFinalizedState } from "../../src/core/transaction";
import { coreIndexMetadataValue } from "../../src/core/indexState";
import { INDEXES, PROGRAMS, TABLES, publicDocumentId } from "../../src/core/registry";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";

const schema = { tables: [{ tableName: "items", documentType: { type: "any" }, indexes: [], stagedDbIndexes: [] }], schemaValidation: true };
const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const frame = (source = "a"): CoreApplicationRegistration => ({ deploymentId: "public-candidate",
  scopeUuid: "74bd6a8e-8dd1-414b-9515-0f342e8c5762", epochUuid: "e56ca002-c0b7-4881-8105-a8d7c23cf70d",
  sourceArtifactRootSha256: source.repeat(64), sourcePackageHash: "b".repeat(64), analyzerIdentity: "c".repeat(64),
  analyzerPolicyIdentity: "actual-policy", compatibilityDate: "2026-10-01", generation: 1,
  programs: [{ identity: { functionPath: "items:read", programHash: source.repeat(64), schemaHash: "d".repeat(64) }, metadata: { purpose: "query" } }],
  candidateMetadata: { canonicalManifest: "actual trusted manifest", sourcePackage: { root: source, maps: ["map"] } },
});
const ready = Effect.fn("ApplicationCandidateFixture.ready")(function* (database: CoreDatabase, proposal: CoreSchemaProposal) {
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) return;
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Unexpected candidate ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Candidate did not become ready"));
});
const unsupported = <A>(result: Result.Result<A, CoreError>) => expect(Result.isFailure(result) && result.failure)
  .toMatchObject({ reason: "unsupportedCapability" });

export function registerCoreApplicationCandidateScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    it("retains bound producer evidence across cold prepare/activation retry and populated active replay", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const registration = frame();
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
        expect(yield* database.readApplicationCandidate()).toEqual(Option.none());
        const proposal = yield* database.prepareSchema({ schema, applicationRegistration: registration });
        const candidate = yield* database.readApplicationCandidate(proposal);
        expect(Option.isSome(candidate) && candidate.value).toMatchObject({ proposal, state: "pending", abandoned: false,
          metadata: registration.candidateMetadata, registration: { candidateProposal: proposal } });
        expect(yield* database.prepareSchema({ schema, applicationRegistration: frame() })).toEqual(proposal);
        yield* database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), owner => owner.close());
        expect(yield* reopened.readApplicationCandidate()).toEqual(candidate);
        yield* ready(reopened, proposal);
        yield* reopened.activateSchema(proposal, { programs: registration.programs, applicationRegistration: registration });
        const seed = yield* reopened.begin(); yield* seed.insert("items", { value: "committed" }); yield* reopened.commit(yield* seed.finalize());
        const timestamp = yield* reopened.publishedTimestamp;
        unsupported(yield* Effect.result(reopened.abandonApplicationCandidate(proposal)));
        yield* reopened.activateSchema(proposal, { programs: registration.programs, applicationRegistration: registration });
        expect(yield* reopened.publishedTimestamp).toBe(timestamp);
        const active = yield* reopened.readApplicationCandidate(proposal);
        expect(Option.isSome(active) && active.value).toMatchObject({ state: "active", metadata: registration.candidateMetadata });
        const compact = yield* reopened.readApplicationRegistration();
        expect(Option.isSome(compact) && compact.value).toMatchObject({ candidateProposal: proposal });
        expect(Option.isSome(compact) && Object.hasOwn(compact.value, "candidateMetadata")).toBe(false);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("captures producer evidence before asynchronous preparation", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp, retention);
          if (pause) { pause = false; yield* Deferred.succeed(observed, undefined); yield* Deferred.await(release); }
          return snapshot;
        }) };
        const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), owner => owner.close());
        const metadata = { nested: { value: "original" } };
        pause = true;
        const preparing = yield* Effect.forkChild(database.prepareSchema({ schema, applicationRegistration: { ...frame(), candidateMetadata: metadata } }));
        yield* Deferred.await(observed);
        metadata.nested.value = "changed after invocation";
        yield* Deferred.succeed(release, undefined);
        const proposal = yield* Fiber.join(preparing);
        const candidate = yield* database.readApplicationCandidate(proposal);
        expect(Option.isSome(candidate) && candidate.value.metadata).toEqual({ nested: { value: "original" } });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("retains prior document revisions when an empty canceled table is retired", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
        const proposal = yield* database.prepareSchema({ schema, applicationRegistration: frame() });
        const inserted = yield* database.begin(); const id = yield* inserted.insert("items", { value: "historical" });
        const timestamp = yield* database.commit(yield* inserted.finalize());
        const deleted = yield* database.begin(); yield* deleted.delete(id); yield* database.commit(yield* deleted.finalize());
        yield* database.abandonApplicationCandidate(proposal);
        const historical = yield* database.begin({ at: timestamp });
        const document = yield* historical.get(id);
        expect(Option.isSome(document) && document.value).toMatchObject({ value: "historical" });
        yield* historical.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("refuses changed evidence and competing roots and authenticates stored candidate payload bytes", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const registration = frame(), database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
        const proposal = yield* database.prepareSchema({ schema, applicationRegistration: registration });
        unsupported(yield* Effect.result(database.prepareSchema({ schema, applicationRegistration: frame("e") })));
        const changed = { ...registration, candidateMetadata: { changed: true } };
        unsupported(yield* Effect.result(database.prepareSchema({ schema, applicationRegistration: changed })));
        yield* ready(database, proposal);
        unsupported(yield* Effect.result(database.activateSchema(proposal, { programs: registration.programs, applicationRegistration: changed })));
        const registry = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const byState = registry.table("_schemas")?.definition.indexes.find(index => index.name === "by_state");
        if (byState === undefined) return yield* Effect.die("Missing schema state index");
        const selected = yield* Effect.fromResult(registry.schemas.getByState(null, "validated", byState.ref, () => {}));
        if (Option.isNone(selected)) return yield* Effect.die("Missing candidate");
        expect(yield* Effect.result(readCoreApplicationCandidateEvidence({ ...selected.value,
          metadata: { ...selected.value.metadata, applicationCandidate: '{"changed":true}' } })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
        expect((yield* database.schemaStatus(proposal)).state).toBe("validated");
      }))); } finally { await fixture.close(); }
    }, 90_000);

    for (const phase of ["pending", "validated"] as const) it(`abandons ${phase} ownership atomically and admits another fresh source while retaining history`, async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
        const registration = frame(), proposal = yield* database.prepareSchema({ schema, applicationRegistration: registration });
        if (phase === "validated") yield* ready(database, proposal);
        const before = yield* database.publishedTimestamp;
        expect((yield* readCoreFixtureRegistry(fixture, before)).table("items")).toBeDefined();
        const abandoned = yield* database.abandonApplicationCandidate(proposal);
        expect(abandoned).toMatchObject({ state: "overwritten", abandoned: true, metadata: registration.candidateMetadata });
        expect((yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp)).table("items")).toBeUndefined();
        expect((yield* readCoreFixtureRegistry(fixture, before)).table("items")).toBeDefined();
        const after = yield* database.publishedTimestamp;
        expect(yield* database.abandonApplicationCandidate(proposal)).toEqual(abandoned);
        expect(yield* database.publishedTimestamp).toBe(after);
        expect(yield* Effect.result(database.activateSchema(proposal, { programs: registration.programs, applicationRegistration: registration })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "schemaOverwritten" } });
        const next = frame("e"), nextProposal = yield* database.prepareSchema({ schema, applicationRegistration: next });
        expect(nextProposal.id).not.toBe(proposal.id);
        yield* ready(database, nextProposal); yield* database.activateSchema(nextProposal, { programs: next.programs, applicationRegistration: next });
        expect(yield* database.readApplicationCandidate(proposal)).toEqual(Option.some(abandoned));
        yield* database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), owner => owner.close());
        expect(yield* reopened.readApplicationCandidate(proposal)).toEqual(Option.some(abandoned));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    for (const foreign of ["row", "table"] as const) it(`refuses abandonment after a foreign ${foreign} and preserves its durable state`, async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
        const proposal = yield* database.prepareSchema({ schema, applicationRegistration: frame() });
        const seed = yield* database.begin(); yield* seed.insert(foreign === "row" ? "items" : "foreign", { value: true });
        yield* database.commit(yield* seed.finalize());
        const timestamp = yield* database.publishedTimestamp;
        unsupported(yield* Effect.result(database.abandonApplicationCandidate(proposal)));
        expect(yield* database.publishedTimestamp).toBe(timestamp);
        expect((yield* database.schemaStatus(proposal)).state).toBe("pending");
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("settles finish versus abandon through one proposal authority", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
        const registration = frame(), proposal = yield* database.prepareSchema({ schema, applicationRegistration: registration });
        yield* ready(database, proposal);
        const outcomes = yield* Effect.all([
          Effect.result(database.activateSchema(proposal, { programs: registration.programs, applicationRegistration: registration })),
          Effect.result(database.abandonApplicationCandidate(proposal)),
        ], { concurrency: 2 });
        expect(outcomes.filter(outcome => outcome._tag === "Success")).toHaveLength(1);
        const candidate = yield* database.readApplicationCandidate(proposal);
        if (Option.isNone(candidate)) return yield* Effect.die("Missing raced candidate");
        expect(["active", "overwritten"]).toContain(candidate.value.state);
        expect(Option.isSome(yield* database.readApplicationRegistration())).toBe(candidate.value.state === "active");
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("conflicts if a foreign row commits after the cancellation empty scan", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let target: Uint8Array | undefined, paused = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp, retention);
          return { ...snapshot, scan: (request: CoreIndexScan) => Effect.gen(function* () {
            const page = yield* snapshot.scan(request);
            if (!paused && target !== undefined && bytesEqual(target, request.tableId) && request.maxResults === 1) {
              paused = true; expect(page.entries).toHaveLength(0);
              yield* Deferred.succeed(observed, undefined); yield* Deferred.await(release);
            }
            return page;
          }) };
        }) };
        const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { ...options, indexCache: { maxBytes: 0 } }), owner => owner.close());
        const proposal = yield* database.prepareSchema({ schema, applicationRegistration: frame() });
        target = (yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp)).table("items")?.definition.tabletId;
        expect(target).toBeDefined();
        const abandoning = yield* Effect.forkChild(Effect.result(database.abandonApplicationCandidate(proposal)));
        yield* Deferred.await(observed);
        const seed = yield* database.begin(); yield* seed.insert("items", { foreign: true }); yield* database.commit(yield* seed.finalize());
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(abandoning)).toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
        expect((yield* database.schemaStatus(proposal)).state).toBe("pending");
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("conflicts abandonment against an authority epoch committed after its program-catalog snapshot", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const captured = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp, retention);
          if (pause) { pause = false; yield* Deferred.succeed(captured, undefined); yield* Deferred.await(release); }
          return snapshot;
        }) };
        const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), owner => owner.close());
        const registration = frame(), proposal = yield* database.prepareSchema({ schema, applicationRegistration: registration });
        const before = yield* database.publishedTimestamp, registry = yield* readCoreFixtureRegistry(fixture, before);
        const catalog = registry.table(PROGRAMS)?.definition, byId = catalog?.indexes.find(index => index.name === "by_id");
        const authority = registry.authority, items = registry.table("items")?.definition;
        if (catalog === undefined || byId === undefined || authority === undefined || items === undefined)
          return yield* Effect.die(new Error("Missing actual candidate program-catalog owner"));
        const authorityKey = yield* Effect.fromResult(encodeIndexKey([], yield* Effect.fromResult(publicDocumentId(catalog, authority.id))));
        yield* Effect.gen(function* () {
          pause = true;
          const abandoning = yield* Effect.forkChild(Effect.result(database.abandonApplicationCandidate(proposal)));
          yield* Deferred.await(captured);
          // Pending registration forbids an unregistered program publisher.
          // This real global writer changes only the existing authority row,
          // isolating the full PROGRAMS-catalog dependency of abandonment.
          yield* database.advanceAuthorityEpoch(1n);
          const epochTimestamp = yield* database.publishedTimestamp;
          expect(epochTimestamp).toBeGreaterThan(before);
          yield* Deferred.succeed(release, undefined);
          const outcome = yield* Fiber.join(abandoning);
          const conflict = Result.isFailure(outcome) ? outcome.failure : undefined;
          if (!(conflict instanceof CoreTransactionError)) return yield* Effect.die(new Error("Expected the official Core abandonment conflict", { cause: outcome }));
          expect(conflict.reason).toBe("conflict");
          expect(conflict.cause).toEqual({ indexId: byId.ref.id, key: authorityKey, timestamp: epochTimestamp });
          expect(yield* database.readAuthorityEpoch).toBe(1n);
          const candidate = yield* database.readApplicationCandidate(proposal);
          expect(Option.isSome(candidate) && candidate.value).toMatchObject({ proposal, state: "pending", abandoned: false,
            metadata: registration.candidateMetadata });
          expect((yield* readCoreFixtureRegistry(fixture, epochTimestamp)).table("items")?.definition.tabletId).toEqual(items.tabletId);
          expect(yield* database.publishedTimestamp).toBe(epochTimestamp);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("tracks the complete index catalog when cancellation races a new index on its owned table", async () => {
      const fixture = await createFixture();
      // Observe the actual owner's vault without changing issue or settlement.
      // The fixture's trusted metadata writer uses the real kernel and same committer.
      const observedVault: { value?: CoreFinalizationVault } = {};
      const finalized: CoreFinalizedState[] = [];
      const originalIssue = CoreFinalizationVault.prototype.issue;
      const issue = vi.spyOn(CoreFinalizationVault.prototype, "issue").mockImplementation(function (this: CoreFinalizationVault, state) {
        observedVault.value = this; finalized.push(state);
        return originalIssue.call(this, state);
      });
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let target: Uint8Array | undefined, paused = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp, retention);
          return { ...snapshot, scan: (request: CoreIndexScan) => Effect.gen(function* () {
            const page = yield* snapshot.scan(request);
            if (!paused && target !== undefined && bytesEqual(target, request.tableId) && request.maxResults === 1) {
              paused = true; expect(page.entries).toHaveLength(0);
              yield* Deferred.succeed(observed, undefined); yield* Deferred.await(release);
            }
            return page;
          }) };
        }) };
        const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { ...options, indexCache: { maxBytes: 0 } }), owner => owner.close());
        const proposal = yield* database.prepareSchema({ schema, applicationRegistration: frame() });
        const timestamp = yield* database.publishedTimestamp;
        const registry = yield* readCoreFixtureRegistry(fixture, timestamp);
        const table = registry.table("items")?.definition;
        const indexCatalog = registry.table(INDEXES)?.definition;
        const byId = indexCatalog?.indexes.find(index => index.name === "by_id");
        const vault = observedVault.value;
        if (table === undefined || byId === undefined || vault === undefined) return yield* Effect.die("Missing genuine candidate metadata owner");
        target = table.tabletId;
        const abandoning = yield* Effect.forkChild(Effect.result(database.abandonApplicationCandidate(proposal)));
        yield* Deferred.await(observed);
        const writer = createCoreTransaction({ snapshot: yield* fixture.persistence.readSnapshot(timestamp), registry,
          ...(yield* prepareCoreTransactionIds(options)), vault });
        const indexId = writer.idGenerator.nextInternalId();
        yield* writer.runSystem(writer.insertPrivate(INDEXES, indexId, coreIndexMetadataValue({ ref: { id: indexId },
          tableId: table.tabletId, name: "by_phantom", fields: ["value", "_creationTime"], state: { type: "Enabled" }, ts: null })));
        yield* database.commit(yield* writer.transaction.finalize());
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(abandoning)).toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
        const cancellation = finalized.find(state => state.changes.some(change => change.table.name === TABLES && change.finalDocument === null));
        expect(cancellation?.reads.find(read => bytesEqual(read.indexId, byId.ref.id))?.intervals)
          .toContainEqual({ start: null, end: null });
        const current = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect(current.table("items")).toBeDefined();
        expect(current.indexes.byId(indexId)?.name).toBe("by_phantom");
        expect((yield* database.schemaStatus(proposal)).state).toBe("pending");
        expect((yield* database.abandonApplicationCandidate(proposal)).abandoned).toBe(true);
        const retired = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect(retired.table("items")).toBeUndefined();
        expect(retired.indexes.byId(indexId)).toBeUndefined();
      }))); } finally { issue.mockRestore(); await fixture.close(); }
    }, 90_000);
  });
}

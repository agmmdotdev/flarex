import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { CoreApplicationRegistration, CoreApplicationSourcePin, CoreDatabase } from "../../src/core/api";
import type { CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { prepareApplication, activateApplication } from "./applicationDeploymentFixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { PROGRAMS } from "../../src/core/registry";

const schema = { tables: [{ tableName: "items", documentType: { type: "any" }, indexes: [] }], schemaValidation: true };
const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const frame = (source: string, programs = true): CoreApplicationRegistration => ({ deploymentId: "upgrade",
  scopeUuid: "74bd6a8e-8dd1-414b-9515-0f342e8c5762", epochUuid: "e56ca002-c0b7-4881-8105-a8d7c23cf70d",
  sourceArtifactRootSha256: source.repeat(64), sourcePackageHash: source.repeat(64), analyzerIdentity: "c".repeat(64),
  analyzerPolicyIdentity: "policy", compatibilityDate: "2026-10-01", generation: 1,
  programs: programs ? [{ identity: { functionPath: "items:read", programHash: source.repeat(64), schemaHash: "d".repeat(64) }, metadata: { source } }] : [],
  candidateMetadata: { source },
});
const sourcePin = (registration: CoreApplicationRegistration): CoreApplicationSourcePin => ({
  sourceArtifactRootSha256: registration.sourceArtifactRootSha256, sourcePackageHash: registration.sourcePackageHash,
});
const ready = Effect.fn("UpgradeFixture.ready")(function* (database: CoreDatabase, candidateId: string) {
  const found = yield* database.readApplicationCandidate(candidateId);
  if (Option.isNone(found)) return yield* Effect.die("Missing candidate");
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(found.value.schemaProposal);
    if ((status.state === "active" || status.state === "validated") && status.indexesReady) return;
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(status);
    yield* database.advanceSchema(found.value.schemaProposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die("Upgrade did not become ready");
});
export function registerCoreApplicationUpgradeScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("refuses a stale query package after an auth-only upgrade with identical source and program identities", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"), b = { ...a, sourcePackageHash: "b".repeat(64), candidateMetadata: { authConfig: "changed" } };
        expect(yield* Effect.result(database.beginQuery("items:read", sourcePin(a))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
        yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        yield* activateApplication(database, schema, { programs: b.programs, applicationRegistration: b });
        const selected = yield* database.selectProgram("items:read"); expect(selected).toEqual(a.programs[0]);
        expect(yield* Effect.result(database.beginQuery("items:read", {
          sourceArtifactRootSha256: a.sourceArtifactRootSha256, sourcePackageHash: a.sourcePackageHash,
        }))).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
        const current = yield* database.beginQuery("items:read", sourcePin(b)), token = yield* current.finish();
        const registry = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const index = registry.table(PROGRAMS)?.definition.indexes.find(candidate => candidate.name === "by_id");
        if (index === undefined) return yield* Effect.die("Missing actual program catalog index");
        expect(token.reads).toContainEqual({ indexId: index.ref.id, intervals: [{ start: null, end: null }] });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("admits complete package pins only for fresh claims while keeping committed replay and prior claimed bodies", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"), b = { ...a, sourcePackageHash: "b".repeat(64), candidateMetadata: { authConfig: "changed" } };
        yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const program = a.programs[0]; if (program === undefined) return yield* Effect.die("Missing original program");
        const identity = { key: "committed-under-a", requestHash: "same-arguments", program: program.identity };
        const done = yield* database.claimApplicationRequest(identity, sourcePin(a));
        if (done.kind !== "claimed") return yield* Effect.die("Missing initial claim");
        const transaction = yield* database.begin({ claim: done.claim });
        yield* database.commit(yield* transaction.finalize(), { claim: done.claim, result: "original result" });
        const heldIdentity = { ...identity, key: "prior-claimed-a" }, held = yield* database.claimApplicationRequest(heldIdentity, sourcePin(a));
        if (held.kind !== "claimed") return yield* Effect.die("Missing prior claim");
        yield* activateApplication(database, schema, { programs: b.programs, applicationRegistration: b });
        expect(yield* database.claimApplicationRequest(identity, sourcePin(a))).toMatchObject({ kind: "committed", result: "original result" });
        expect(yield* database.claimApplicationRequest(identity, sourcePin(b))).toMatchObject({ kind: "committed", result: "original result" });
        expect(yield* Effect.result(database.claimApplicationRequest({ ...identity, key: "fresh-stale-a" }, sourcePin(a))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
        const fresh = yield* database.claimApplicationRequest({ ...identity, key: "fresh-current-b" }, sourcePin(b));
        if (fresh.kind !== "claimed") return yield* Effect.die("Missing current claim");
        yield* database.abortRequest(fresh.claim);
        const body = yield* database.begin({ claim: held.claim }); yield* body.insert("items", { value: "original claimed body" });
        yield* database.commit(yield* body.finalize(), { claim: held.claim, result: "held A" });
        expect(yield* database.claimApplicationRequest(heldIdentity, sourcePin(a))).toMatchObject({ kind: "committed", result: "held A" });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("keeps trusted retained-program begin and claim distinct from fresh Application admission", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"), b = frame("b"), removed = frame("c", false);
        yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const original = a.programs[0]; if (original === undefined) return yield* Effect.die("Missing retained program");
        yield* activateApplication(database, schema, { programs: b.programs, applicationRegistration: b });
        const identity = { key: "trusted-retained-a", requestHash: "trusted-request", program: original.identity };
        const retained = yield* database.claimRequest(identity);
        if (retained.kind !== "claimed") return yield* Effect.die("Missing trusted retained-program claim");
        const trusted = yield* database.begin({ program: original.identity }); yield* trusted.abort();
        const body = yield* database.begin({ claim: retained.claim }); yield* body.insert("items", { value: "retained A" });
        yield* database.commit(yield* body.finalize(), { claim: retained.claim, result: "original authority" });
        expect(yield* Effect.result(database.claimApplicationRequest({ ...identity, key: "fresh-stale-pin-a" }, sourcePin(a))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
        expect(yield* Effect.result(database.claimApplicationRequest({ ...identity, key: "fresh-current-pin-old-program" }, sourcePin(b))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "programUnavailable" } });
        expect(yield* database.claimApplicationRequest(identity, sourcePin(b)))
          .toMatchObject({ kind: "committed", result: "original authority" });
        yield* activateApplication(database, schema, { programs: [], applicationRegistration: removed });
        expect(yield* Effect.result(database.begin({ program: original.identity })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "programUnavailable" } });
        const afterRemoval = yield* database.claimRequest({ ...identity, key: "trusted-retained-after-removal" });
        if (afterRemoval.kind !== "claimed") return yield* Effect.die("Missing retained claim after head removal");
        const originalBody = yield* database.begin({ claim: afterRemoval.claim });
        yield* database.commit(yield* originalBody.finalize(), { claim: afterRemoval.claim, result: "retained after removal" });
        expect(yield* Effect.result(database.claimApplicationRequest({ ...identity, key: "fresh-current-pin-removed-program" }, sourcePin(removed))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "programUnavailable" } });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("conflicts a fresh claim when an auth-only package publication wins after its selected snapshot", async () => {
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
        const a = frame("a"), b = { ...a, sourcePackageHash: "b".repeat(64), candidateMetadata: { authConfig: "changed" } };
        yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const program = yield* database.selectProgram("items:read"), identity = { key: "auth-package-race", requestHash: "same", program: program.identity };
        const expected = { ...sourcePin(a) };
        yield* Effect.gen(function* () {
          pause = true;
          const claiming = yield* Effect.forkChild(Effect.result(database.claimApplicationRequest(identity, expected)));
          yield* Deferred.await(observed);
          expected.sourcePackageHash = b.sourcePackageHash;
          expected.sourceArtifactRootSha256 = "f".repeat(64);
          yield* activateApplication(database, schema, { programs: b.programs, applicationRegistration: b });
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(claiming)).toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
          expect(yield* database.resolveApplicationRequest({ key: identity.key, requestHash: identity.requestHash, functionPath: "items:read" }))
            .toEqual({ kind: "missing" });
          expect(yield* Effect.result(database.claimApplicationRequest(identity, sourcePin(a))))
            .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("publishes eligible same-schema attempts in finish order, retains revisions and replays old finishes without restoring their heads", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"); yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const seed = yield* database.begin(); const documentId = yield* seed.insert("items", { value: "kept" }); yield* database.commit(yield* seed.finalize());
        const b = frame("b"), c = frame("c", false);
        const first = yield* prepareApplication(database, { schema, registration: b });
        const second = yield* prepareApplication(database, { schema, registration: c });
        expect(first.candidateId).not.toBe(second.candidateId); expect(first.id).toBe(second.id);
        const cResult = yield* database.activateApplicationCandidate(second.candidateId, { programs: c.programs });
        expect(yield* Effect.result(database.selectProgram("items:read"))).toMatchObject({ _tag: "Failure", failure: { reason: "programUnavailable" } });
        yield* database.activateApplicationCandidate(first.candidateId, { programs: b.programs });
        expect((yield* database.selectProgram("items:read")).identity).toEqual(b.programs[0]?.identity);
        expect(yield* database.activateApplicationCandidate(second.candidateId, { programs: c.programs })).toEqual(cResult);
        expect(yield* database.activateApplicationCandidate(second.candidateId, { programs: c.programs })).toEqual(cResult);
        expect((yield* database.selectProgram("items:read")).identity).toEqual(b.programs[0]?.identity);
        expect(yield* Effect.result(database.activateApplicationCandidate(first.candidateId, { programs: [] })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedCapability" } });
        const original = a.programs[0]; if (original === undefined) return yield* Effect.die("Missing original");
        expect(yield* database.lookupProgram(original.identity)).toEqual(original);
        const redeploy = yield* prepareApplication(database, { schema, registration: c }); expect(redeploy.candidateId).not.toBe(second.candidateId);
        yield* database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), db => db.close());
        expect(Option.getOrThrow(yield* reopened.readActiveApplicationCandidate()).id).toBe(first.candidateId);
        const read = yield* reopened.begin(); expect(Option.isSome(yield* read.get(documentId))).toBe(true); yield* read.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);
    it("reprepares missing candidate indexes on identical start after another eligible finish removes them", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"), b = frame("b"), c = frame("c");
        yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const unchangedSchema = yield* prepareApplication(database, { schema, registration: c });
        const indexed = { tables: [{ tableName: "items", documentType: { type: "any" },
          indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }], schemaValidation: true };
        const indexedAttempt = yield* prepareApplication(database, { schema: indexed, registration: b });
        const preparing = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const table = preparing.table("items")?.definition;
        if (table === undefined) return yield* Effect.die("Missing actual candidate table");
        const initial = preparing.indexesForTablet(table.tabletId).find(index => index.name === "by_value");
        if (initial === undefined) return yield* Effect.die("Missing initial prepared index");
        const preparingTimestamp = yield* database.publishedTimestamp;
        expect(yield* prepareApplication(database, { schema: indexed, registration: b })).toEqual(indexedAttempt);
        const stillPreparing = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect(stillPreparing.indexesForTablet(table.tabletId).find(index => index.name === "by_value")?.ref.id).toEqual(initial.ref.id);
        expect(yield* database.publishedTimestamp).toBe(preparingTimestamp);
        yield* ready(database, indexedAttempt.candidateId);
        yield* database.activateApplicationCandidate(unchangedSchema.candidateId, { programs: c.programs });
        const removed = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect(removed.indexesForTablet(table.tabletId).some(index => index.name === "by_value")).toBe(false);
        expect(yield* Effect.result(database.activateApplicationCandidate(indexedAttempt.candidateId, { programs: b.programs })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
        const terminalTimestamp = yield* database.publishedTimestamp;
        expect(yield* prepareApplication(database, { schema, registration: c })).toEqual(unchangedSchema);
        expect(yield* database.publishedTimestamp).toBe(terminalTimestamp);
        expect(yield* prepareApplication(database, { schema: indexed, registration: b })).toEqual(indexedAttempt);
        const reprepared = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const replacement = reprepared.indexesForTablet(table.tabletId).find(index => index.name === "by_value");
        expect(replacement).toBeDefined();
        expect(replacement?.ref.id).not.toEqual(initial.ref.id);
        yield* ready(database, indexedAttempt.candidateId);
        yield* database.activateApplicationCandidate(indexedAttempt.candidateId, { programs: b.programs });
        expect(Option.getOrThrow(yield* database.readActiveApplicationCandidate()).id).toBe(indexedAttempt.candidateId);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("abandons one shared attempt without canceling shared schema or populated active data", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"), b = frame("b");
        const first = yield* prepareApplication(database, { schema, registration: a });
        const second = yield* prepareApplication(database, { schema, registration: b });
        yield* database.abandonApplicationCandidate(first.candidateId);
        expect((yield* database.schemaStatus(second)).state).toBe("pending");
        expect((yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp)).table("items")).toBeDefined();
        yield* ready(database, second.candidateId); yield* database.activateApplicationCandidate(second.candidateId, { programs: b.programs });
        const seed = yield* database.begin(); const id = yield* seed.insert("items", { value: 1 }); yield* database.commit(yield* seed.finalize());
        const pending = yield* prepareApplication(database, { schema, registration: frame("c") });
        yield* database.abandonApplicationCandidate(pending.candidateId);
        expect(Option.getOrThrow(yield* database.readActiveApplicationCandidate()).id).toBe(second.candidateId);
        const read = yield* database.begin(); expect(Option.isSome(yield* read.get(id))).toBe(true); yield* read.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);
    it("abandons a superseded fresh attempt while its different-schema successor retains installation ownership", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const first = yield* prepareApplication(database, { schema, registration: frame("a") });
        const indexed = { tables: [{ tableName: "items", documentType: { type: "any" },
          indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }], schemaValidation: true };
        const b = frame("b"), second = yield* prepareApplication(database, { schema: indexed, registration: b });
        expect(second.id).not.toBe(first.id);
        const before = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const abandoned = yield* database.abandonApplicationCandidate(first.candidateId);
        expect(abandoned).toMatchObject({ id: first.candidateId, abandoned: true, state: "abandoned" });
        expect((yield* database.schemaStatus(second)).state).toBe("pending");
        const after = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect(after.table("items")?.definition.tabletId).toEqual(before.table("items")?.definition.tabletId);
        expect(after.indexes.records.size).toBe(before.indexes.records.size);
        yield* ready(database, second.candidateId);
        yield* database.activateApplicationCandidate(second.candidateId, { programs: b.programs });
        expect(Option.getOrThrow(yield* database.readActiveApplicationCandidate()).id).toBe(second.candidateId);
        const seed = yield* database.begin(); yield* seed.insert("items", { value: "successor" }); yield* database.commit(yield* seed.finalize());
        const read = yield* database.begin();
        expect(yield* read.scan("items", "by_value", { limit: 8 })).toHaveLength(1); yield* read.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("abandons different-schema attempts in reverse order without retiring the successor's retained state", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const first = yield* prepareApplication(database, { schema, registration: frame("a") });
        const indexed = { tables: [{ tableName: "items", documentType: { type: "any" },
          indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }], schemaValidation: true };
        const second = yield* prepareApplication(database, { schema: indexed, registration: frame("b") });
        const before = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        yield* database.abandonApplicationCandidate(second.candidateId);
        const abandoned = yield* database.abandonApplicationCandidate(first.candidateId);
        expect(abandoned).toMatchObject({ id: first.candidateId, state: "abandoned", abandoned: true });
        expect(Option.getOrThrow(yield* database.readApplicationCandidate(second.candidateId)).abandoned).toBe(true);
        const after = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect(after.table("items")?.definition.tabletId).toEqual(before.table("items")?.definition.tabletId);
        expect(after.indexes.records.size).toBe(before.indexes.records.size);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("uses the shared populated validation/index owner and preserves omitted table identity on reintroduction", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"); yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const seed = yield* database.begin(); const id = yield* seed.insert("items", { value: "kept" }); yield* database.commit(yield* seed.finalize());
        const before = (yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp)).table("items")?.definition;
        const indexed = { ...schema, tables: [{ ...schema.tables[0], tableName: "items", documentType: { type: "any" }, indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }] };
        const b = frame("b"); yield* activateApplication(database, indexed, { programs: b.programs, applicationRegistration: b });
        const c = frame("c", false); yield* activateApplication(database, { tables: [], schemaValidation: true }, { programs: [], applicationRegistration: c });
        const omitted = (yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp)).table("items")?.definition;
        expect(omitted?.tabletId).toEqual(before?.tabletId); expect(omitted?.number).toBe(before?.number);
        const d = frame("d"); yield* activateApplication(database, indexed, { programs: d.programs, applicationRegistration: d });
        const read = yield* database.begin(); expect(Option.isSome(yield* read.get(id))).toBe(true);
        expect((yield* read.scan("items", "by_value", { order: "asc", limit: 8 }))).toHaveLength(1);
        yield* read.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);
    it("fails a pending restrictive schema on an active-compatible committed write while the active publication survives", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a"); const active = yield* activateApplication(database, schema, { programs: a.programs, applicationRegistration: a });
        const restrictive = { tables: [{ tableName: "items", documentType: { type: "object", value: { n: { fieldType: { type: "number" }, optional: false } } }, indexes: [] }], schemaValidation: true };
        const proposal = yield* prepareApplication(database, { schema: restrictive, registration: frame("b") });
        const seed = yield* database.begin(); yield* seed.insert("items", { value: "allowed by active" }); yield* database.commit(yield* seed.finalize());
        expect((yield* database.schemaStatus(proposal)).state).toBe("failed");
        expect(Option.getOrThrow(yield* database.readActiveApplicationCandidate()).id).toBe(active.id);
        expect(yield* Effect.result(database.activateApplicationCandidate(proposal.candidateId, { programs: frame("b").programs })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "schemaFailed" } });
      }))); } finally { await fixture.close(); }
    }, 90_000);
  });
}

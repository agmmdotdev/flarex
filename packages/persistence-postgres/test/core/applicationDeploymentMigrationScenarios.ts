import { randomBytes } from "node:crypto";
import { Effect, Option, Result } from "effect";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { describe, expect, it } from "vitest";
import type { CoreApplicationRegistration, CoreDatabase, CoreSchemaProposal } from "../../src/core/api";
import { coreApplicationRegistrationProof, encodeCoreApplicationCandidateMetadata } from "../../src/core/applicationRegistration";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { readDocumentObject, SCHEMAS } from "../../src/core/registry";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import { prepareApplication } from "./applicationDeploymentFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const schema = { tables: [{ tableName: "items", documentType: { type: "any" }, indexes: [] }], schemaValidation: true };
const frame = (source: string, evidence: boolean): CoreApplicationRegistration => ({ deploymentId: "migration",
  scopeUuid: "74bd6a8e-8dd1-414b-9515-0f342e8c5762", epochUuid: "e56ca002-c0b7-4881-8105-a8d7c23cf70d",
  sourceArtifactRootSha256: source.repeat(64), sourcePackageHash: source.repeat(64), analyzerIdentity: "c".repeat(64),
  analyzerPolicyIdentity: "policy", compatibilityDate: "2026-10-01", generation: 1,
  programs: [{ identity: { functionPath: "items:read", programHash: source.repeat(64), schemaHash: "d".repeat(64) }, metadata: { source } }],
  ...(evidence ? { candidateMetadata: { source, originalEvidence: true } } : {}),
});
const settleSchema = Effect.fn("MigrationFixture.settleSchema")(function* (database: CoreDatabase, proposal: CoreSchemaProposal) {
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if (status.state === "failed" || status.state === "validated" || status.state === "active") return status;
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die("Schema did not settle");
});
export function registerCoreApplicationDeploymentMigrationScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    for (const evidence of [true, false]) it(`migrates every old disposition with evidence=${evidence} and recovers an uncertain acknowledgment`, async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
        const a = frame("a", evidence);
        const emptySchema = { tables: [], schemaValidation: true }, abandonedRegistration = { ...frame("9", evidence), programs: [] };
        const abandoned = yield* database.prepareSchema({ schema: emptySchema });
        yield* activateCoreSchema(database, schema, { programs: a.programs });
        const active = yield* database.prepareSchema({ schema });
        const seed = yield* database.begin(); const id = yield* seed.insert("items", { value: "retained" }); yield* database.commit(yield* seed.finalize());
        const restrictive = { tables: [{ tableName: "items", documentType: { type: "object", value: { n: { fieldType: { type: "number" }, optional: false } } }, indexes: [] }], schemaValidation: true };
        const failed = yield* database.prepareSchema({ schema: restrictive });
        expect((yield* settleSchema(database, failed)).state).toBe("failed");
        const indexed = { tables: [{ tableName: "items", documentType: { type: "any" }, indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }], schemaValidation: true };
        const overwritten = yield* database.prepareSchema({ schema: indexed });
        const unvalidated = { ...schema, schemaValidation: false };
        const pending = yield* database.prepareSchema({ schema: unvalidated });
        const at = yield* database.publishedTimestamp, registry = yield* readCoreFixtureRegistry(fixture, at);
        const catalog = registry.table(SCHEMAS)?.definition;
        if (catalog === undefined) return yield* Effect.die("Missing schema catalog");
        const snapshot = yield* fixture.persistence.readSnapshot(at);
        const legacy = [{ proposal: abandoned, schema: emptySchema, registration: abandonedRegistration, abandoned: true },
          { proposal: active, schema, registration: a, abandoned: false },
          { proposal: failed, schema: restrictive, registration: frame("b", evidence), abandoned: false },
          { proposal: overwritten, schema: indexed, registration: frame("c", evidence), abandoned: false },
          { proposal: pending, schema: unvalidated, registration: frame("d", evidence), abandoned: false }];
        const dates = new Map<string, number>();
        for (const row of legacy) {
          const decoded = yield* Effect.fromResult(decodeDocumentId(row.proposal.id));
          const entry = yield* snapshot.get(catalog.tabletId, decoded.internalId);
          if (Option.isNone(entry)) return yield* Effect.die("Missing old schema row");
          const document = yield* Effect.fromResult(readDocumentObject(entry.value, catalog));
          dates.set(row.proposal.id, Number(document._creationTime));
          const proof = yield* coreApplicationRegistrationProof(row.registration, yield* Effect.fromResult(captureCoreSchema(row.schema)));
          const metadata = yield* Effect.fromResult(encodeCoreApplicationCandidateMetadata(row.registration));
          const updated = { ...document, applicationRegistration: proof, ...(metadata === undefined ? {} : { applicationCandidate: metadata }),
            applicationCandidateUpdatedAt: Number(document._creationTime) + 7, applicationCandidateAbandoned: row.abandoned };
          const bytes = yield* Effect.fromResult(encodeDocumentValue(updated));
          yield* Effect.promise(() => fixture.query('UPDATE "' + fixture.namespace + '".documents SET json_value=$1 WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5',
            [bytes, fixture.instanceName, entry.value.tableId, entry.value.id, entry.value.ts.toString()]));
        }
        yield* database.close();
        let loseAck = true;
        const raw = yield* Effect.promise(() => fixture.reopen());
        const uncertain: CorePersistence = { ...raw, write: (lease, batch) => Effect.gen(function* () {
          yield* raw.write(lease, batch);
          if (loseAck && batch.documents.some(entry => !entry.deleted && Result.getOrThrow(readDocumentObject(entry)).kind === "applicationDeployment")) {
            loseAck = false; return yield* new CorePersistenceError({ reason: "uncertainWrite" });
          }
        }) };
        expect(yield* Effect.result(openCoreDatabase(uncertain, options))).toMatchObject({ _tag: "Failure", failure: { reason: "uncertainWrite" } });
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), db => db.close());
        expect(Option.getOrThrow(yield* reopened.readActiveApplicationCandidate()).id).toBe(active.id);
        for (const row of legacy) {
          const candidate = Option.getOrThrow(yield* reopened.readApplicationCandidate(row.proposal.id));
          expect(candidate.id).toBe(row.proposal.id); expect(candidate.schemaProposal).toEqual(row.proposal);
          expect(candidate.creationTime).toBe(dates.get(row.proposal.id)); expect(candidate.updatedAt).toBe((dates.get(row.proposal.id) ?? 0) + 7);
          expect(candidate.metadata).toEqual(row.registration.candidateMetadata ?? {});
        }
        expect(Option.getOrThrow(yield* reopened.readApplicationCandidate(failed.id)).state).toBe("failed");
        expect(Option.getOrThrow(yield* reopened.readApplicationCandidate(overwritten.id)).state).toBe("overwritten");
        const abandonedCandidate = Option.getOrThrow(yield* reopened.readApplicationCandidate(abandoned.id));
        expect(abandonedCandidate).toMatchObject({ id: abandoned.id, state: "abandoned", abandoned: true });
        const beforeAbandonedRetry = yield* reopened.publishedTimestamp;
        expect(yield* reopened.abandonApplicationCandidate(abandoned.id)).toEqual(abandonedCandidate);
        expect(yield* Effect.result(reopened.activateApplicationCandidate(abandoned.id, { programs: abandonedRegistration.programs })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "schemaOverwritten" } });
        expect(yield* reopened.abandonApplicationCandidate(abandoned.id)).toEqual(abandonedCandidate);
        expect(yield* reopened.publishedTimestamp).toBe(beforeAbandonedRetry);
        expect(Option.getOrThrow(yield* reopened.readActiveApplicationCandidate()).id).toBe(active.id);
        const read = yield* reopened.begin(); expect(Option.isSome(yield* read.get(id))).toBe(true); yield* read.abort();
        const after = yield* fixture.persistence.readSnapshot(yield* reopened.publishedTimestamp);
        for (const row of legacy) {
          const entry = Option.getOrThrow(yield* after.get(catalog.tabletId, (yield* Effect.fromResult(decodeDocumentId(row.proposal.id))).internalId));
          const document = yield* Effect.fromResult(readDocumentObject(entry, catalog));
          expect(Object.hasOwn(document, "applicationRegistration")).toBe(false); expect(Object.hasOwn(document, "applicationCandidate")).toBe(false);
          expect(Object.hasOwn(document, "applicationCandidateUpdatedAt")).toBe(false); expect(Object.hasOwn(document, "applicationCandidateAbandoned")).toBe(false);
        }
        yield* reopened.close();
        const laterOptions = { ...options, now: Effect.succeed(100_000_000_000_000n) };
        const later = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), laterOptions), db => db.close());
        const next = yield* prepareApplication(later, { schema: indexed, registration: frame("e", evidence) });
        const superseding = yield* prepareApplication(later, { schema: restrictive, registration: frame("f", evidence) });
        expect(next.id).not.toBe(superseding.id);
        expect(Option.getOrThrow(yield* later.readApplicationCandidate(failed.id)).state).toBe("failed");
        expect(Option.getOrThrow(yield* later.readApplicationCandidate(overwritten.id)).state).toBe("overwritten");
        expect(yield* later.readApplicationCandidate(abandoned.id)).toEqual(Option.some(abandonedCandidate));
        expect(yield* later.abandonApplicationCandidate(abandoned.id)).toEqual(abandonedCandidate);
        expect(Option.getOrThrow(yield* later.readActiveApplicationCandidate()).id).toBe(active.id);
        const retained = yield* later.begin(); expect(Option.isSome(yield* retained.get(id))).toBe(true); yield* retained.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);
  });
}

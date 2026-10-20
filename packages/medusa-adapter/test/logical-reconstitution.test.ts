import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from
  "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { makeSchemaComposer } from "../src/composition/schema";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/application/applicationAnalysisRegistration";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../persistence-postgres/test/support/postgresHelpers";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationFixture } from "../../persistence-postgres/test/application/applicationNativeMutationTestFixture";
import type { PGliteFlarexPersistence } from "../../persistence-postgres/src/database/pglite";
import type { PostgresFlarexPersistence } from "../../persistence-postgres/src/database/postgres";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { logicalSchemaBindingScenario } from "../../persistence-postgres/test/storage/catalog/logicalSchemaBindingScenario";
import type { CatalogControlSessionStarter } from "../../persistence-postgres/src/database/catalogControlSession";
import { makeCatalogControlSessionStarter } from "../../persistence-postgres/src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../persistence-postgres/src/database/postgresCatalogControlSession";
import { compileCurrencyDefinition } from "../src/modules/currency/schema";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from
  "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { issueRelationalSession, makePostgresRelationalSession, type RelationalSession } from
  "../../persistence-postgres/src/database/relationalTransaction/session";
import { runEffectTransaction } from "../../persistence-postgres/src/database/effectTransaction";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";

import { logicalRecordedReplayScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalRecordedReplayScenario";
import { logicalReconstitutionScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalReconstitutionScenario";
import { logicalRelationalReadEvidenceScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalRelationalReadEvidenceScenario";
import { logicalPreservingDeletionUpsertScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalPreservingDeletionUpsertScenario";
import { logicalPreservingManagedUpsertScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalPreservingManagedUpsertScenario";
import { logicalActiveRestoreUpdateScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalActiveRestoreUpdateScenario";
import { logicalInsertionClockScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalInsertionClockScenario";
import { logicalInsertionOrderScenario } from "../../persistence-postgres/test/frameworks/commerceTransaction/logicalInsertionOrderScenario";

const options = { runtimeHostIdentity: "flarex.test/neutral-reconstitution", compatibilityDate: "2026-09-23" };
const origin = (sourceId: string) => ({ kind: "synthetic", sourceId });
const implicit = (sourceId: string) => ({ kind: "implicit", sourceId });
const schema = Result.getOrThrow(normalizeRelationalSchema({
  owner: "medusa", lineageId: "commerce.folio-fixture", capabilities: [
    { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
      updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit("entry.timestamps") },
    { capabilityId: "entry.soft-delete", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: implicit("entry.soft-delete") },
  ], tables: [{ tableId: "folio", origin: origin("folio.table"), columns: [
    { columnId: "folio_key", type: "text", nullable: false, default: { kind: "none" }, origin: origin("folio.key") },
  ], keys: [{ keyId: "folio.primary", kind: "primary", columns: ["folio_key"], origin: origin("folio.primary") }],
    indexes: [], constraints: [], relationships: [] },
  { tableId: "entry", origin: origin("entry.table"), columns: [
    ...["entry_key", "folio_key", "text"].map(columnId => ({ columnId, type: "text" as const, nullable: false,
      default: { kind: "none" as const }, origin: origin('entry.' + columnId) })),
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: implicit('entry.' + columnId) })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit("entry.deleted_at") },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["entry_key"], origin: origin("entry.primary") }],
    indexes: [{ indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit("entry.active") },
      { indexId: "entry.owner", kind: "textEquality", columns: ["folio_key"], predicate: null, origin: origin("entry.owner") }],
    constraints: [{ constraintId: "entry.folio", kind: "foreignKey", sourceColumns: ["folio_key"],
      targetColumns: [{ tableId: "folio", columnId: "folio_key" }], onDelete: "noAction", onUpdate: "noAction", origin: origin("entry.folio") }],
    relationships: [{ relationshipId: "entry.folio", kind: "manyToOne", foreignKeyConstraintId: "entry.folio", origin: origin("entry.folio") }] }],
}));
const sourceInput = { sourceKey: "medusa.folio-fixture", writeProfile: "medusa.folio-fixture", schema,
  evidence: { kind: "synthetic", sourceId: "folio-fixture" } };
const proofs = { recordedReplay: logicalRecordedReplayScenario, reconstitution: logicalReconstitutionScenario, readEvidence: logicalRelationalReadEvidenceScenario,
  preservingUpsert: logicalPreservingDeletionUpsertScenario, preservingManagedUpsert: logicalPreservingManagedUpsertScenario, activeRestore: logicalActiveRestoreUpdateScenario };
type Proof = keyof typeof proofs | "preserveTimestamps" | "insertionClock" | "insertionSources" | "insertionLifecycle" | "insertionMetadata" | "insertionRace";
describe("neutral committed-row reconstitution, relational selection and lifecycle-preserving upsert", () => {
  it.each<Proof>(["recordedReplay", "reconstitution", "preserveTimestamps", "readEvidence", "preservingUpsert", "preservingManagedUpsert", "activeRestore", "insertionClock", "insertionSources", "insertionLifecycle", "insertionMetadata"])("runs the neutral proof (%s) on PGlite", async proof => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence(options, { control, target });
    await Effect.runPromise(witness(fixture, makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter, undefined, proof));
  });
  it.skipIf(postgresUrl === null).each<Proof>(["recordedReplay", "reconstitution", "preserveTimestamps", "readEvidence", "preservingUpsert", "preservingManagedUpsert", "activeRestore", "insertionClock", "insertionSources", "insertionLifecycle", "insertionMetadata", "insertionRace"])("runs the neutral proof (%s) with an ordinary PostgreSQL role", async proof => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const roles = await target.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
        "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
      expect(roles.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
      const schemaName = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
      if (schemaName === undefined) throw new Error("Missing PostgreSQL fixture schema");
      const fixture = await createApplicationNativeMutationPostgresFixture({ ...options,
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName },
      }, { control, target });
      const session = makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.pool) });
      await openPreparedHostTestRuntime(target.drizzle);
      try { await Effect.runPromise(witness(fixture, session, makePostgresRelationalSession(target), proof)); }
      finally { await closePreparedHostTestRuntime(target.drizzle); }
    });
  });
});

const witness = Effect.fn("Reconstitution.witness")(function* <Persistence extends PGliteFlarexPersistence | PostgresFlarexPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, session: CatalogControlSessionStarter, suppliedDataSession?: RelationalSession,
  proof: Proof = "reconstitution",
) {
  const compose = makeSchemaComposer({ deploymentId: fixture.deploymentId, authority: fixture.authority,
    applicationAnalyses: makeApplicationAnalysisRepository(fixture.target.drizzle), medusaModules: ["currency"] });
  const base = yield* compose({ applicationCandidateId: fixture.active.basis.candidateId,
    payloadCollections: [{ slug: "news", fields: [{ name: "title", type: "text", required: true }] }],
    payloadViews: [], extensions: [] });
  const candidate = yield* readPreparedLogicalSchemaCandidate(base);
  const source = yield* captureLogicalSchemaSource({ key: sourceInput.sourceKey, owner: "medusa",
    writeProfile: sourceInput.writeProfile, evidence: sourceInput.evidence, definition: { kind: "relational", schema },
    bindings: ["folio", "entry"].map(localName => ({ kind: "definition" as const, localName, table: { namespace: "medusa" as const, logicalName: `commerce.folio-fixture/${localName}` } })),
  });
  const secondInput = { ...sourceInput, sourceKey: "medusa.folio-clock-fixture", writeProfile: "medusa.folio-clock-fixture" };
  const second = proof === "insertionClock" || proof === "insertionSources" ? [yield* captureLogicalSchemaSource({ key: secondInput.sourceKey, owner: "medusa",
    writeProfile: secondInput.writeProfile, evidence: secondInput.evidence, definition: { kind: "relational", schema },
    bindings: ["folio", "entry"].map(localName => ({ kind: "definition" as const, localName, table: { namespace: "medusa" as const,
      logicalName: `commerce.folio-clock-fixture/${localName}` } })),
  })] : [];
  const prepared = yield* prepareLogicalSchemaCandidate({ ...candidate, sources: [...candidate.sources, source, ...second] });
  const currency = yield* compileCurrencyDefinition();
  yield* logicalSchemaBindingScenario(fixture, session, prepared, {
    source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: currency.schema, evidence: currency.provenance },
    rows: [], reads: [], execute: () => Effect.void, verify: () => Effect.void,
    concurrentExecute: () => Effect.void,
    hostProof: (bindingTarget, schemaVersionId) => Effect.gen(function* () {
      const dataSession = suppliedDataSession ?? issueRelationalSession(fixture.target.drizzle, (_profile, work) => runEffectTransaction(
        callback => fixture.target.drizzle.transaction(callback), "Neutral reconstitution transaction", work,
        cause => new RelationalSessionError({ reason: "resourceFailure", cause })));
      if (proof === "insertionClock" || proof === "insertionSources") yield* logicalInsertionClockScenario(fixture, bindingTarget, schemaVersionId, [sourceInput, secondInput], dataSession, proof === "insertionSources");
      else if (proof === "insertionLifecycle" || proof === "insertionMetadata" || proof === "insertionRace")
        yield* logicalInsertionOrderScenario(fixture, bindingTarget, schemaVersionId, sourceInput, dataSession,
          proof === "insertionLifecycle" ? "lifecycle" : proof === "insertionMetadata" ? "metadata" : "race");
      else if (proof === "preserveTimestamps") yield* logicalReconstitutionScenario(fixture, bindingTarget, schemaVersionId, sourceInput, dataSession, "preserveTimestamps");
      else yield* proofs[proof](fixture, bindingTarget, schemaVersionId, sourceInput, dataSession);
    }),
  });
});

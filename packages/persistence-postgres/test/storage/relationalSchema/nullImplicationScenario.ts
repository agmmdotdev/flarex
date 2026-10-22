import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { canonicalizeAppDocumentV1, AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import type { Json, JsonObject } from "flarex-protocol/json";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId, decodeSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result } from "flarex-protocol/schema-manifest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture } from "../../application/applicationNativeMutationTestFixture";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { makeApplicationAnalysisRepository } from "../../../src/application/applicationAnalysisRegistration";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../src/database/postgresCatalogControlSession";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { makeLogicalSchemaAdmission } from "../../../src/storage/catalog/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../../../src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { makeFrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { logicalPageReadAccessQuery } from "../../../src/storage/documents/logicalReadAccessQueries";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { makeCommerceHost, defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { readAppRowAtSnapshotInTransactionEffect, type AppRowReadResultV1, type ReadAppRowError } from "../../../src/storage/documents/appRows";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../../../src/database/schema";
import { fxSystemLogicalSourceInitializations } from "../../../src/storage/catalog/logicalStorageInitialization";

const stamp = "2026-10-22T00:00:00.000Z";
const kinds = ["main", "valid-initial", "invalid-initial"] as const;
type SourceKind = typeof kinds[number];
const sourceKey = (kind: SourceKind) => "medusa.neutral-null-implication." + kind;
const evidence = { kind: "synthetic", sourceId: "neutral-null-implication" };
function schemaFor(kind: SourceKind) {
  const origin = { kind: "synthetic", sourceId: "neutral-null-implication." + kind };
  const implicit = { kind: "implicit", sourceId: "neutral-null-implication." + kind };
  return Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-null-implication." + kind,
    tables: [{ tableId: "entry", origin, columns: [
      ...["id", "code"].map(columnId => ({ columnId, type: "text" as const, nullable: false, default: { kind: "none" as const }, origin })),
      ...["parent_id", "null_guard", "null_value", "required_guard", "required_value", "optional_text"].map(columnId =>
        ({ columnId, type: "text" as const, nullable: true, default: { kind: "none" as const }, origin })),
      { columnId: "selected", type: "boolean", nullable: false, default: { kind: "booleanLiteral", value: false }, origin },
      { columnId: "state", type: "text", nullable: false, default: { kind: "textLiteral", value: "draft" }, origin },
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
        default: { kind: "currentTimestamp" as const }, origin: implicit })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
    ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [
      { indexId: "entry.root-code", kind: "uniqueBtree", columns: ["code"], predicate: { kind: "allNull", columnIds: ["parent_id", "deleted_at"] }, origin },
      { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
      { indexId: "entry.selected", kind: "btree", columns: ["state"], predicate: { kind: "isNullAndBooleanEquals", nullColumnId: "deleted_at", booleanColumnId: "selected", value: true }, origin },
      { indexId: "entry.text", kind: "btree", columns: ["optional_text"], predicate: { kind: "isNullAndTextEquals", nullColumnId: "deleted_at", textColumnId: "state", value: "live" }, origin },
    ], constraints: [
      { constraintId: "entry.null", kind: "nullImplication", nonNullColumnId: "null_guard", requiredColumnId: "null_value", required: "null", origin },
      { constraintId: "entry.required", kind: "nullImplication", nonNullColumnId: "required_guard", requiredColumnId: "required_value", required: "notNull", origin },
    ], relationships: [] }], capabilities: [
      { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
        updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit },
      { capabilityId: "entry.deletion", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: implicit },
    ] }));
}
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeRowsEffect = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const decodeRow = Schema.decodeUnknownEffect(Schema.JsonObject);
const decodeText = Schema.decodeUnknownEffect(Schema.String);
const keys = (value: unknown) => decodeRows(value).map(row => row.id);
const guardedQuery = (code: string, missing?: "parent_id" | "deleted_at") => ({ predicate: { kind: "and", children: [
  { kind: "in", column: "code", values: [code] },
  ...["parent_id", "deleted_at"].filter(column => column !== missing).map(column => ({ kind: "isNull", column })),
] }, order: { column: "code", direction: "asc" }, take: 8 });
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}

/** Only setup composition: genuine Application metadata anchors the neutral
 * relational candidate, and existing production owners install every index,
 * uniqueness declaration and binding. No Medusa adapter or native module runs. */
async function prepareNeutralFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const pair = driver === "postgres" ? await (async () => {
    const control = await createFileScopedPostgresFixture(); close(control.dispose);
    const target = await createFileScopedPostgresFixture({}, { immutableCatalog: control.persistence.drizzle }); close(target.dispose);
    const schemaName = (await target.persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
    if (schemaName === undefined) throw new Error("Missing neutral target schema");
    return { control: control.persistence, target: target.persistence, session: makePostgresRelationalSession(target.persistence),
      controlSession: makeCatalogControlSessionStarter({ controlDb: control.persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.persistence.pool) }),
      application: await createApplicationNativeMutationPostgresFixture({ runtimeHostIdentity: "flarex.test/neutral-null-implication", compatibilityDate: "2026-10-22",
        physicalLocator: { kind: "database_per_scope", databaseKey: "neutral_null_target", schemaName } }, { control: control.persistence, target: target.persistence }) };
  })() : await (async () => {
    const control = await createMigratedPGlitePersistence(close), target = await createRelationalPGliteFixture({ registerCleanup: close, immutableCatalog: control.drizzle });
    return { control, target: target.persistence, session: target.session,
      controlSession: makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter,
      application: await createApplicationNativeMutationPGliteFixtureWithPersistence({ runtimeHostIdentity: "flarex.test/neutral-null-implication", compatibilityDate: "2026-10-22" },
        { control, target: target.persistence }) };
  })();
  const { control, target, application, session, controlSession } = pair;
  return Effect.runPromise(Effect.gen(function* () {
    const analysis = yield* makeApplicationAnalysisRepository(target.drizzle).inspect(application.authority, application.active.basis.candidateId);
    if (analysis.status !== "analyzed" || analysis.manifest.version === 3) throw new Error("Missing plain authenticated Application fixture metadata");
    const manifest = analysis.manifest;
    const tables = yield* Effect.fromResult(decodeSchemaManifestAppTableDeclarationsV1Result(manifest.schema.tables.map(table => ({ logicalName: table.name,
      definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator } }))));
    const indexes = yield* Effect.fromResult(decodeSchemaManifestAppIndexDeclarationsV1Result(manifest.schema.indexes.map(index => ({
      tableLogicalName: manifest.schema.tables.find(table => table.tableId === index.tableId)?.name, descriptor: index.name, fields: index.fields,
      ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }) }))));
    const applicationSource = yield* captureLogicalSchemaSource({ key: "application", owner: "application", writeProfile: "application.occ",
      evidence: { sourceArtifact: manifest.sourceArtifact, manifestSha256: analysis.manifestSha256 },
      definition: { kind: "documents", tables, indexes, uniqueConstraints: [], relations: manifest.version === 2 ? manifest.schema.relations.map(relation => relation.declaration) : [] },
      bindings: tables.map(table => ({ kind: "definition", localName: table.logicalName, table: { namespace: "app", logicalName: table.logicalName } })) });
    const sources = [];
    for (const kind of kinds) {
      const schema = schemaFor(kind);
      sources.push(yield* captureLogicalSchemaSource({ key: sourceKey(kind), owner: "medusa", writeProfile: sourceKey(kind), evidence,
        definition: { kind: "relational", schema }, bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: schema.coordinate.lineageId + "/" + table.identity.tableId } })) }));
    }
    const prepared = yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
      deploymentId: application.deploymentId, scopeId: application.authority.scopeId,
      applicationAnalysis: { candidateId: analysis.candidateId, analysisId: analysis.analysisId, manifestSha256: analysis.manifestSha256,
        sourceArtifactRootSha256: analysis.sourceArtifactRootSha256 }, sources: [applicationSource, ...sources], extensions: [] });
    const schemaVersionId = decodeCatalogSchemaVersionId("neutral-null-implication");
    yield* makeLogicalSchemaAdmission({ controlDb: control.drizzle, session: controlSession, deploymentId: application.deploymentId,
      scopeId: application.authority.scopeId }).admit(prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
      initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
    const arrangeCatalog = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      const definitions = yield* ensureLogicalStorageDefinitions(tx, application.deploymentId, schemaVersionId);
      const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle, { deploymentId: application.deploymentId, schemaVersionId }, tx);
      yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure); return definitions;
    });
    const catalog = yield* runEffectTransaction<Effect.Success<ReturnType<typeof arrangeCatalog>>,
      Effect.Error<ReturnType<typeof arrangeCatalog>>, Error, FlarexMetadataTransaction>(callback => control.drizzle.transaction(callback),
      "Arrange neutral null catalog", arrangeCatalog, cause => new Error("Neutral null catalog transaction", { cause }));
    const mainTable = catalog.requirements.evidence.tableBindings.find(binding => binding.table.namespace === "medusa"
      && binding.table.logicalName === "neutral-null-implication.main/entry");
    const membershipIndex = catalog.ordered.find(member => member.definition.access.tableId === mainTable?.tableId
      && member.definition.physicalSpec.predicate?.kind === "fieldsAreNull")?.definition;
    if (mainTable === undefined || membershipIndex === undefined) throw new Error("Missing authentic two-null membership index");
    expect(membershipIndex.physicalSpec.predicate).toEqual({ kind: "fieldsAreNull", fields: ["deleted_at", "parent_id"] });
    const ports = { controlDb: control.drizzle, authority: application.authorityPorts }, buildInput = { deploymentId: application.deploymentId,
      scopeId: application.authority.scopeId, schemaVersionId };
    const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, buildInput);
    if (reconciled.status !== "reconciled") throw new Error("Incomplete neutral index requirements");
    for (const indexDefinitionId of reconciled.definitionIds) {
      const definition = yield* locateAppIndexDefinitionByIdEffect(control.drizzle, application.authority.scopeId, indexDefinitionId);
      if (definition === null) throw new Error("Missing neutral index definition");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const input = { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, indexDefinitionId, pageSize: 10 };
        const state = definition.access.kind === "by_creation_time" ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports, input)
          : yield* buildAppDeveloperOrderedIndexV1Effect(ports, input);
        if (state.lifecycle === "enabled") { enabled = true; break; }
      }
      if (!enabled) throw new Error("Neutral index did not become enabled");
    }
    const unique = yield* reconcileAppUniqueConstraintSetBuildV1Effect(ports, buildInput);
    if (unique.status !== "reconciled") throw new Error("Incomplete neutral uniqueness requirements");
    let uniqueEnabled = false;
    for (let step = 0; step < (unique.definitionCount + 1) * 4; step++) {
      const state = yield* advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...buildInput, pageSize: 10 });
      if (state.lifecycle === "enabled" && state.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
    }
    if (!uniqueEnabled) throw new Error("Neutral uniqueness did not become enabled");
    const bindingTarget = yield* makeFrameworkSchemaTarget({ database: target.drizzle, deploymentId: application.deploymentId,
      canonicalPhysicalDatabaseIdentity: "neutral-null-target", physicalLocator: application.active.basis.authority.physicalLocator });
    const bindings = yield* makeDataBindingHost({ database: target.drizzle, target: bindingTarget,
      selection: { deploymentId: application.deploymentId, scopeId: application.authority.scopeId }, authority: application.authorityPorts,
      application: application.activation, logicalStorage: { controlDb: control.drizzle, schemaVersionId, unique: application.uniqueConstraintEligibility } });
    const reference = yield* bindings.readApplicationReference();
    const candidate = yield* bindings.prepare({ format: "flarex.data-binding-set", application: reference,
      logicalSchema: { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) },
      payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [] });
    yield* bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "neutral-null-activate", candidate.sha256, null));
    return { application, control, schemaVersionId, persistence: target, membershipIndexId: membershipIndex.indexDefinitionId, hostInput: { hostRuntime: preparedHostTestRuntime(target.drizzle), database: target.drizzle,
      session, target: bindingTarget, deploymentId: application.deploymentId, scopeId: application.authority.scopeId,
      authority: application.authorityPorts, application: application.activation,
      logicalStorage: { ports, unique: application.uniqueConstraintEligibility, schemaVersionId } } };
  }));
}

/** Synthetic authored declarations; all install/build/read/write/lifecycle and
 * publication behavior is supplied by the existing production owners. */
export async function nullImplicationScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const fixture = await prepareNeutralFixture(driver, close => cleanup.push(close));
    if (driver === "postgres") {
      const role = await fixture.persistence.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
        "select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname=current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    }
    const insert = defineCommerceCommand("neutralNullInsert", "write", (ctx, input) => Effect.gen(function* () {
      const rows = yield* decodeRowsEffect(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", rows)];
    }));
    const update = defineCommerceCommand("neutralNullUpdate", "write", (ctx, input) => Effect.gen(function* () {
      const row = yield* decodeRow(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "update", [row])];
    }));
    const list = defineCommerceCommand("neutralNullList", "read", (ctx, id) => Effect.gen(function* () {
      const table = yield* ctx.table("entry");
      return [...yield* table.find(ctx.manager, { ...(typeof id === "string" ? { predicate: { kind: "in", column: "id", values: [id] } } : {}),
        order: { column: "id", direction: "asc" } })];
    }));
    const select = defineCommerceCommand("neutralNullSelected", "read", (ctx, input) => Effect.gen(function* () {
      const table = yield* ctx.table("entry");
      const query = input === "missing-parent" ? guardedQuery("warm", "parent_id") : input === "missing-deleted" ? guardedQuery("warm", "deleted_at")
        : guardedQuery(typeof input === "string" ? input : "warm");
      return [...yield* table.prepareRead(query).find(ctx.manager)];
    }));
    const lifecycle = defineCommerceCommand("neutralNullLifecycle", "write", (ctx, input) => Effect.gen(function* () {
      const id = yield* decodeText(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const table = yield* ctx.table("entry");
      yield* table.lifecycle(ctx.manager, "softDelete", [{ id }]);
      return [...yield* table.lifecycle(ctx.manager, "restore", [{ id }])];
    }));
    const warm = defineCommerceCommand("neutralNullWarm", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("entry"), query = table.prepareRead(guardedQuery("warm"));
      yield* table.write(ctx.manager, "insert", [{ id: "warm", code: "warm", parent_id: "excluded" }]);
      expect(yield* query.find(ctx.manager)).toEqual([]);
      yield* table.write(ctx.manager, "update", [{ id: "warm", parent_id: null }]); expect(keys(yield* query.find(ctx.manager))).toEqual(["warm"]);
      yield* table.write(ctx.manager, "update", [{ id: "warm", parent_id: "excluded" }]); expect(yield* query.find(ctx.manager)).toEqual([]);
      yield* table.write(ctx.manager, "update", [{ id: "warm", parent_id: null, deleted_at: stamp }]); expect(yield* query.find(ctx.manager)).toEqual([]);
      yield* table.write(ctx.manager, "update", [{ id: "warm", deleted_at: null }]); expect(keys(yield* query.find(ctx.manager))).toEqual(["warm"]);
      yield* table.lifecycle(ctx.manager, "softDelete", [{ id: "warm" }]); expect(yield* query.find(ctx.manager)).toEqual([]);
      yield* table.lifecycle(ctx.manager, "restore", [{ id: "warm" }]); return [...yield* query.find(ctx.manager)];
    }));
    const inverse = defineCommerceCommand("neutralNullInverse", "write", (ctx, input) => Effect.gen(function* () {
      const table = yield* ctx.table("entry"), removed = yield* table.delete(ctx.manager, [{ id: "warm" }]);
      if (table.reconstitute === undefined || removed[0] === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const row = input === "bad-null" ? { ...removed[0], null_guard: "guard", null_value: "forged" }
        : input === "bad-required" ? { ...removed[0], required_guard: "guard", required_value: null } : removed[0];
      return [...yield* table.reconstitute(ctx.manager, [row])];
    }));
    const rollback = defineCommerceCommand("neutralNullLateFailure", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [{ id: "late-failure", code: "late-failure" }]);
      return yield* ctx.refuse(commerceError("invalidInput"));
    }));
    const commands = [insert, update, list, select, lifecycle, warm, inverse, rollback];
    const host = async (kind: SourceKind, rows: readonly JsonObject[] = []) => {
      const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
        { invalidInput: () => new Error("Invalid neutral null seed"), hashFailure: cause => new Error("Neutral null seed hash", { cause }) }));
      const input = { ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: "neutral-null-implication" },
        logicalStorage: { ...fixture.hostInput.logicalStorage,
          source: { sourceKey: sourceKey(kind), writeProfile: sourceKey(kind), schema: schemaFor(kind), evidence },
          initialization: { stepId: "neutral-null-seed", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } } };
      const prepared = await Effect.runPromise(makeCommerceHost(input)); cleanup.push(() => Effect.runPromise(prepared.close)); return { prepared, input };
    };
    const inventory = async () => ({
      rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
      revisions: await fixture.persistence.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
      indexes: await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
      indexRevisions: await fixture.persistence.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
      unique: await fixture.persistence.drizzle.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.canonicalKeySha256),
      commits: await fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
      facts: await fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal),
      outcomes: await fixture.persistence.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey),
      wakes: await fixture.persistence.drizzle.select().from(fxSystemCommitWakes).orderBy(fxSystemCommitWakes.commitSeq),
      clocks: await fixture.persistence.drizzle.select().from(fxSystemScopeClocks),
      initializations: await fixture.persistence.drizzle.select().from(fxSystemLogicalSourceInitializations).orderBy(fxSystemLogicalSourceInitializations.sourceKey),
    });
    const currentRevision = async (id: string, snapshot: Awaited<ReturnType<typeof inventory>>) => {
      for (const current of snapshot.rows) {
        const revision = snapshot.revisions.find(row => row.tableId === current.tableId && row.scopeUuid === current.scopeUuid && row.commitSeq === current.commitSeq
          && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
        if (revision === undefined || revision.isTombstone) continue;
        const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
        if (Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson).id === id) return revision;
      }
      throw new Error("Missing neutral current row " + id);
    };
    const members = (snapshot: Awaited<ReturnType<typeof inventory>>) => snapshot.indexes.filter(row => row.indexDefinitionId === fixture.membershipIndexId);
    const main = await host("main"); await Effect.runPromise(main.prepared.initialize([]));
    const run = (command: typeof insert, input: Json) => Effect.runPromise(main.prepared.run(main.prepared.newRequestKey(), command, input));
    const refusal = async (operation: () => Promise<unknown>, expected = "invalidInput") => {
      const before = await inventory(); let failure: unknown;
      try { await operation(); } catch (cause) { failure = cause; }
      expect(failure).toBeDefined(); expect(reasons(failure)).toContain(expected); expect(await inventory()).toEqual(before);
    };
    // Both implication directions, nullable unrelated fields and ordinary
    // Boolean/text predicates share the same installed neutral row mechanics.
    await run(insert, [{ id: "valid", code: "valid", null_guard: "guard", null_value: null,
      required_guard: "guard", required_value: "present", optional_text: null, selected: true, state: "live" },
    { id: "guards-absent", code: "guards-absent", null_value: "free", required_value: null }]);
    for (const deleted_at of [null, stamp]) {
      await refusal(() => run(insert, [{ id: "bad-null", code: "bad-null", null_guard: "guard", null_value: "forbidden", deleted_at }]));
      await refusal(() => run(insert, [{ id: "bad-required", code: "bad-required", required_guard: "guard", required_value: null, deleted_at }]));
    }
    await refusal(() => run(update, { id: "valid", null_value: "forbidden" }));
    await refusal(() => run(update, { id: "valid", required_value: null }));
    await run(update, { id: "guards-absent", null_guard: "guard", null_value: null, required_guard: "guard", required_value: "now-present" });
    await run(lifecycle, "valid");
    const initialRows = [{ id: "seed", code: "seed", null_guard: "guard", null_value: null, required_guard: "guard", required_value: "present" }];
    const initialized = await host("valid-initial", initialRows); expect(await Effect.runPromise(initialized.prepared.initialize(initialRows))).toEqual({ rowCount: 1 });
    const initializedBefore = await inventory(); expect(await Effect.runPromise(initialized.prepared.initialize(initialRows))).toEqual({ rowCount: 1 }); expect(await inventory()).toEqual(initializedBefore);
    const invalidRows = [{ id: "prefix", code: "prefix" }, { id: "bad-seed", code: "bad-seed", null_guard: "guard", null_value: "forbidden", deleted_at: stamp }];
    const invalid = await host("invalid-initial", invalidRows); await refusal(() => Effect.runPromise(invalid.prepared.initialize(invalidRows)));
    // One cached query crosses each membership guard independently inside its
    // actual working set; a warmed absence cannot conceal the new member.
    expect(keys(await run(warm, null))).toEqual(["warm"]);
    const warmInventory = await inventory(), warmBirth = await currentRevision("warm", warmInventory);
    expect(members(warmInventory)).toHaveLength(3); // valid, guards-absent and warm
    expect(members(warmInventory).some(row => Buffer.from(row.rowId).equals(Buffer.from(warmBirth.rowId)))).toBe(true);
    const key = main.prepared.newRequestKey(), replay = await Effect.runPromise(main.prepared.run(key, update, { id: "warm", optional_text: "retained" }));
    const replayed = await inventory(); expect(await Effect.runPromise(main.prepared.run(key, update, { id: "warm", optional_text: "retained" }))).toEqual(replay); expect(await inventory()).toEqual(replayed);
    await run(insert, [{ id: "outside-parent", code: "warm", parent_id: "owner" }, { id: "outside-deleted", code: "warm", deleted_at: stamp }]);
    expect(members(await inventory())).toEqual(members(replayed));
    await refusal(() => run(update, { id: "outside-parent", parent_id: null }));
    await refusal(() => run(update, { id: "outside-deleted", deleted_at: null }));
    await refusal(() => run(insert, [{ id: "conflict-prefix", code: "unique-prefix" }, { id: "duplicate", code: "warm" }]));
    const eligibility = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      const input = { deploymentId: fixture.application.deploymentId, schemaVersionId: fixture.schemaVersionId, sourceKey: sourceKey("main"), localName: "entry" };
      for (const requiredNulls of [["deleted_at", "parent_id"], ["deleted_at"], ["parent_id"]]) {
        const rows = yield* runDrizzleStatementEffect(logicalPageReadAccessQuery(tx, input, ["code"], { column: "code", value: "warm" }, requiredNulls),
          cause => new Error("Inspect genuine two-null page eligibility", { cause }));
        expect(rows).toHaveLength(requiredNulls.length === 2 ? 1 : 0);
        if (requiredNulls.length === 2) expect(rows[0]?.projectionJson).toMatchObject({ indexDefinitionId: fixture.membershipIndexId,
          predicate: { kind: "fieldsAreNull", fields: ["deleted_at", "parent_id"] } });
      }
    });
    await Effect.runPromise(runEffectTransaction<void, Effect.Error<ReturnType<typeof eligibility>>, Error, FlarexMetadataTransaction>(
      callback => fixture.control.drizzle.transaction(callback), "Neutral partial page eligibility", eligibility,
      cause => new Error("Neutral partial page eligibility transaction", { cause })));
    const beforeBroader = await inventory();
    // The independent active-row index can serve the broader query. It must
    // include the row excluded by the missing parent guard, never borrow the
    // narrower two-null membership. No indexed parent-only anchor is declared.
    expect(keys(await Effect.runPromise(main.prepared.read(select, "missing-parent"))).toSorted()).toEqual(["outside-parent", "warm"]);
    expect(await inventory()).toEqual(beforeBroader);
    await refusal(() => Effect.runPromise(main.prepared.read(select, "missing-deleted")), "invalidInput");
    // A cold host must re-authenticate the same two-guard index and constraints.
    const cold = await host("main"); expect(keys(await Effect.runPromise(cold.prepared.read(select, "warm")))).toEqual(["warm"]);
    await run(update, { id: "warm", parent_id: "leave-parent" });
    await run(update, { id: "outside-parent", parent_id: null }); expect(keys(await Effect.runPromise(cold.prepared.read(select, "warm")))).toEqual(["outside-parent"]);
    const parentEntered = await inventory(), parentRevision = await currentRevision("outside-parent", parentEntered);
    expect(members(parentEntered).some(row => Buffer.from(row.rowId).equals(Buffer.from(parentRevision.rowId)))).toBe(true);
    expect(members(parentEntered).some(row => Buffer.from(row.rowId).equals(Buffer.from(warmBirth.rowId)))).toBe(false);
    await run(update, { id: "outside-parent", deleted_at: stamp }); await run(update, { id: "outside-deleted", deleted_at: null });
    expect(keys(await Effect.runPromise(cold.prepared.read(select, "warm")))).toEqual(["outside-deleted"]);
    const deletedEntered = await inventory(), deletedRevision = await currentRevision("outside-deleted", deletedEntered);
    expect(members(deletedEntered).some(row => Buffer.from(row.rowId).equals(Buffer.from(deletedRevision.rowId)))).toBe(true);
    expect(members(deletedEntered).some(row => Buffer.from(row.rowId).equals(Buffer.from(parentRevision.rowId)))).toBe(false);
    await run(update, { id: "outside-deleted", parent_id: "leave-again" }); await run(update, { id: "warm", parent_id: null });
    await refusal(() => run(rollback, null));
    // The exact retained inverse is admitted only through the existing trusted
    // scope-exclusive participant. Changed preimages fail with full rollback.
    const participant = defineAtomicCommerceParticipant("neutralNullInverse"), root = defineAtomicCommerceCommand("neutralNullInverseRoot", (ctx, input) => ctx.call(participant, inverse, input));
    const atomic = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-null-inverse" },
      executionIsolation: "scopeExclusive", commands: [root], participants: [{ participant, logicalStorage: main.input.logicalStorage,
        commands: [inverse], reconstitution: "advanceUpdatedAt", validateLogicalCall: () => Effect.void }] }));
    cleanup.push(() => Effect.runPromise(atomic.close));
    expect(keys(await Effect.runPromise(atomic.run(atomic.newRequestKey(), root, null)))).toEqual(["warm"]);
    for (const mode of ["bad-null", "bad-required"]) await refusal(() => Effect.runPromise(atomic.run(atomic.newRequestKey(), root, mode)));
    const historical = await Effect.runPromise(runEffectTransaction<AppRowReadResultV1, ReadAppRowError, Error, FlarexMetadataTransaction>(
      callback => fixture.persistence.drizzle.transaction(callback), "Neutral null snapshot",
      tx => readAppRowAtSnapshotInTransactionEffect(tx, { scopeId: fixture.application.authority.scopeId, tableId: warmBirth.tableId,
        rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(warmBirth.rowId)), snapshotCommitSeq: warmBirth.commitSeq }),
      cause => new Error("Neutral null snapshot failed", { cause })));
    expect(historical.kind).toBe("live");
    if (historical.kind === "live") expect(historical.document.valueJson).toMatchObject({ id: "warm", parent_id: null, deleted_at: null, optional_text: null });
    // Deliberate stored corruption retains valid canonical bytes and hash, so
    // the row-local constraint is the refusal boundary rather than its codec.
    const beforeCorruption = await inventory(), original = await currentRevision("valid", beforeCorruption);
    const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: original.valueBytes, sha256: original.valueSha256, profile: "appDocument" });
    const { _id, _creationTime, ...fields } = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
    const corrupted = await canonicalizeAppDocumentV1({ tableId: original.tableId, rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(original.rowId)),
      creationTime: AppCreationTimeV1Schema.make(original.creationTime), fields: { ...fields, null_value: "stored-invalid" } });
    const match = and(eq(fxAppRowRevisions.scopeUuid, original.scopeUuid), eq(fxAppRowRevisions.tableId, original.tableId), eq(fxAppRowRevisions.rowId, original.rowId), eq(fxAppRowRevisions.commitSeq, original.commitSeq));
    await fixture.persistence.drizzle.update(fxAppRowRevisions).set({ valueBytes: corrupted.canonicalBytes, valueSha256: corrupted.sha256 }).where(match);
    try {
      const damaged = await inventory(), outcome = await Effect.runPromiseExit(cold.prepared.read(list, "valid"));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("storedCorruption");
      const invalidRestore = await Effect.runPromiseExit(main.prepared.run(main.prepared.newRequestKey(), lifecycle, "valid"));
      expect(Exit.isFailure(invalidRestore)).toBe(true); if (Exit.isFailure(invalidRestore)) expect(reasons(invalidRestore.cause)).toContain("storedCorruption");
      expect(await inventory()).toEqual(damaged);
    } finally {
      await fixture.persistence.drizzle.update(fxAppRowRevisions).set({ valueBytes: original.valueBytes, valueSha256: original.valueSha256 }).where(match);
    }
    expect(await inventory()).toEqual(beforeCorruption);
  } finally {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) try { await close(); } catch (cause) { failures.push(cause); }
    if (failures.length) throw new AggregateError(failures, "Neutral null implication cleanup failed");
  }
}

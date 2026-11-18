import { and, eq, sql } from "drizzle-orm";
import { Effect, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import {
  prepareApplicationBindingSelection,
} from "../../src/application/activation/repositoryIdentity";
import {
  readApplicationBindingPreparationInputs,
} from "../../src/application/activation/bindingPreparation";
import {
  createApplicationRelationSchemaAuthorityPort,
  readResolvedApplicationRelationManifestBinding,
} from "../../src/application/relations/applicationRelationSchemaAuthority";
import { prepareApplicationRelationReadinessFromSchema } from "../../src/application/relations/readiness";
import {
  readApplicationBindingProjectionInTransaction,
} from "../../src/application/applicationBindingProjection";
import { lockScopeClockForUpdateInTransactionEffect } from "../../src/scope/scopeClock";
import {
  fxControlApplicationManifestSchemaBindings,
  fxControlSchemaVersionUniqueConstraintSets,
  fxControlSchemaVersions,
  fxControlSchemaVersionRelationBindings,
  fxControlRelations,
  fxControlEdgeDefinitions,
} from "../../src/database/schema";
import { publishApplicationRelationBindingEffect } from "../../src/application/relations/binding";
import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import { cmsHostFixture } from "../frameworks/cmsTransaction/cmsHostFixture";
import { relationReadinessFixture } from "./relations/applicationRelationReadinessFixture";
import { policyManifestFixture } from "./ownership/applicationWritePolicyFixture";
import { useFileScopedApplicationNativeMutationPersistence } from "./applicationNativeMutationPGlitePersistence";
import { postgresUrl, useFileScopedPostgresPersistence } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";

/** Preflight 67 refusal witness: removing a repeated preparation read requires
 * existing acceptance to detect changes to the input it would stop rereading. */
async function exercise(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  controlPersistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  unique: boolean,
) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const { fixture, reference } = await cmsHostFixture(persistence, { controlPersistence,
    cmsFields: [{ name: "title", kind: "text", ...(unique ? { unique: true } : {}) }],
    physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
  const control = fixture.control.drizzle;
  const prepare = () => runEffect(prepareApplicationBindingSelection(fixture.relationActivation));
  const prepared = await prepare();
  const planning = await runEffect(readApplicationBindingPreparationInputs(prepared, control));
  const input = { deploymentId: fixture.deploymentId,
    applicationManifestSha256: fixture.relation.manifestBinding.applicationManifestSha256 };
  const spans: string[] = [];
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  const schemaPort = createApplicationRelationSchemaAuthorityPort(control);
  const resolve = () => runEffect(schemaPort.resolve({ ...input, manifest: planning.manifest })
    .pipe(Effect.provideService(Tracer.Tracer, tracer)));
  expect(await resolve()).toEqual(planning.schema);
  // One full artifact read still validates bytes, digest and stored JSON. The
  // schema resolver must consume it instead of reacquiring the same artifact.
  expect(spans.filter(name => name === "SchemaVersionArtifacts.getById")).toHaveLength(1);
  expect(spans.filter(name => name === "SchemaVersionArtifacts.corroborateManifestJson")).toHaveLength(1);
  const reused = () => runEffect(prepareApplicationRelationReadinessFromSchema(fixture.relations, input, planning.schema));
  expect(await reused()).toEqual(await runEffect(fixture.relations.prepare(input)));
  await expect(runEffect(prepareApplicationRelationReadinessFromSchema(fixture.relations, input,
    { ...planning.schema }))).rejects.toMatchObject({ _tag: "ApplicationRelationSchemaAuthorityError", reason: "invalidInput" });
  await expect(runEffect(readResolvedApplicationRelationManifestBinding(planning.schema, control,
    { ...input, deploymentId: "foreign-deployment" }))).rejects.toMatchObject({ reason: "invalidInput" });
  await expect(runEffect(readResolvedApplicationRelationManifestBinding(planning.schema, control,
    { ...input, applicationManifestSha256: "0".repeat(64) }))).rejects.toMatchObject({ reason: "invalidInput" });
  // SAFETY: a lookalike database object must not pass owner identity validation.
  await expect(runEffect(readResolvedApplicationRelationManifestBinding(planning.schema, { ...control } as typeof control,
    input))).rejects.toMatchObject({ reason: "invalidInput" });
  const firstBinding = await runEffect(readResolvedApplicationRelationManifestBinding(planning.schema, control, input));
  const originalByte = firstBinding.manifestBinding.canonicalBytes[0];
  if (originalByte === undefined) throw new Error("Missing canonical binding byte");
  firstBinding.manifestBinding.canonicalBytes[0] = originalByte ^ 1;
  expect((await runEffect(readResolvedApplicationRelationManifestBinding(planning.schema, control, input)))
    .manifestBinding.canonicalBytes[0]).toBe(originalByte);
  const artifactByte = firstBinding.relationBinding.schemaArtifact.manifestBytes[0];
  if (artifactByte === undefined) throw new Error("Missing artifact byte");
  firstBinding.relationBinding.schemaArtifact.manifestBytes[0] = artifactByte ^ 1;
  expect((await runEffect(readResolvedApplicationRelationManifestBinding(planning.schema, control, input)))
    .relationBinding.schemaArtifact.manifestBytes[0]).toBe(artifactByte);
  const accept = () => persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
    return yield* readApplicationBindingProjectionInTransaction(prepared, tx, clock);
  })));
  expect(await accept()).toEqual(reference);

  const artifactWhere = and(eq(fxControlSchemaVersions.deploymentId, fixture.deploymentId),
    eq(fxControlSchemaVersions.schemaVersionId, planning.schema.schemaVersionId));
  const [artifact] = await control.select().from(fxControlSchemaVersions).where(artifactWhere);
  if (artifact === undefined) throw new Error("Missing schema artifact");
  // Deliberate stored corruption bypasses the canonical artifact writer. The
  // digest and active head stay unchanged, and each mutation is restored.
  await control.update(fxControlSchemaVersions)
    .set({ manifestBytes: sql`set_byte(${fxControlSchemaVersions.manifestBytes}, 0, 32)` }).where(artifactWhere);
  try {
    await expect(resolve()).rejects.toMatchObject({ reason: "storedState" });
    await expect(prepare()).rejects.toMatchObject({ reason: "storedState" });
    await expect(accept()).rejects.toMatchObject({ reason: "storedState" });
  } finally {
    await control.update(fxControlSchemaVersions).set({ manifestBytes: artifact.manifestBytes }).where(artifactWhere);
  }
  expect(await accept()).toEqual(reference);
  await control.update(fxControlSchemaVersions)
    .set({ manifestJson: sql`${fxControlSchemaVersions.manifestJson} || '{"unexpected": true}'::jsonb` }).where(artifactWhere);
  try {
    await expect(resolve()).rejects.toMatchObject({ reason: "storedState" });
    await expect(accept()).rejects.toMatchObject({ reason: "storedState" });
  } finally {
    await control.update(fxControlSchemaVersions).set({ manifestJson: artifact.manifestJson }).where(artifactWhere);
  }
  expect(await accept()).toEqual(reference);

  const manifestWhere = and(eq(fxControlApplicationManifestSchemaBindings.deploymentId, fixture.deploymentId),
    eq(fxControlApplicationManifestSchemaBindings.schemaVersionId, fixture.relation.binding.schemaVersionId));
  const [manifest] = await control.select().from(fxControlApplicationManifestSchemaBindings).where(manifestWhere);
  if (manifest === undefined) throw new Error("Missing manifest binding");
  const corruptBytes = Uint8Array.from(manifest.bindingBytes);
  corruptBytes[0] = 32;
  await control.update(fxControlApplicationManifestSchemaBindings).set({ bindingBytes: corruptBytes }).where(manifestWhere);
  try {
    // A fresh read detects changed bytes even though the stored digest is unchanged.
    await expect(prepare()).rejects.toMatchObject({ reason: "storedState" });
    // Reuse remains planning-only; the fresh acceptance check must still refuse it.
    await reused();
    await expect(accept()).rejects.toMatchObject({ reason: "storedState" });
  } finally {
    await control.update(fxControlApplicationManifestSchemaBindings).set({ bindingBytes: manifest.bindingBytes }).where(manifestWhere);
  }
  expect(await accept()).toEqual(reference);

  const closureWhere = and(eq(fxControlSchemaVersionUniqueConstraintSets.deploymentId, fixture.deploymentId),
    eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, fixture.relation.binding.schemaVersionId));
  const [closure] = await control.select().from(fxControlSchemaVersionUniqueConstraintSets).where(closureWhere);
  if (closure === undefined) throw new Error("Missing unique closure");
  expect(closure.definitionCount).toBe(unique ? 1 : 0);
  await control.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionCount: closure.definitionCount + 1 }).where(closureWhere);
  try {
    await expect(accept()).rejects.toMatchObject({ _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" });
  } finally {
    await control.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionCount: closure.definitionCount }).where(closureWhere);
  }
  await control.delete(fxControlSchemaVersionUniqueConstraintSets).where(closureWhere);
  try {
    await expect(prepare()).rejects.toBeDefined();
    await expect(accept()).rejects.toMatchObject({ _tag: "PhysicalDefinitionLifecycleConflictError", reason: "storedStateInvalid" });
  } finally {
    await control.insert(fxControlSchemaVersionUniqueConstraintSets).values(closure);
  }
  expect(await accept()).toEqual(reference);
}

async function exerciseRelationCatalog(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const fixture = await relationReadinessFixture({ persistence,
    physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
  const db = fixture.control.drizzle;
  const port = createApplicationRelationSchemaAuthorityPort(db);
  const resolve = () => runEffect(port.resolve({ deploymentId: fixture.deploymentId, manifest: fixture.manifest,
    applicationManifestSha256: fixture.relation.manifestBinding.applicationManifestSha256 }));
  const expected = await resolve();
  const [relation] = await db.select().from(fxControlSchemaVersionRelationBindings)
    .where(and(eq(fxControlSchemaVersionRelationBindings.deploymentId, fixture.deploymentId),
      eq(fxControlSchemaVersionRelationBindings.schemaVersionId, expected.schemaVersionId)));
  if (relation === undefined) throw new Error("Missing nonempty relation set");
  const relationWhere = and(eq(fxControlSchemaVersionRelationBindings.deploymentId, fixture.deploymentId),
    eq(fxControlSchemaVersionRelationBindings.schemaVersionId, expected.schemaVersionId),
    eq(fxControlSchemaVersionRelationBindings.relationOrdinal, relation.relationOrdinal));
  await db.delete(fxControlSchemaVersionRelationBindings).where(relationWhere);
  try { await expect(resolve()).rejects.toMatchObject({ reason: "storedState" }); }
  finally { await db.insert(fxControlSchemaVersionRelationBindings).values(relation); }

  const edgeWhere = and(eq(fxControlEdgeDefinitions.deploymentId, fixture.deploymentId),
    eq(fxControlEdgeDefinitions.edgeDefinitionId, relation.edgeDefinitionId));
  const [edge] = await db.select().from(fxControlEdgeDefinitions).where(edgeWhere);
  if (edge === undefined) throw new Error("Missing physical edge definition");
  await db.update(fxControlEdgeDefinitions).set({ physicalDefinitionBytes: new Uint8Array([32]) }).where(edgeWhere);
  try { await expect(resolve()).rejects.toMatchObject({ reason: "storedState" }); }
  finally { await db.update(fxControlEdgeDefinitions).set({ physicalDefinitionBytes: edge.physicalDefinitionBytes }).where(edgeWhere); }
  expect(await resolve()).toEqual(expected);

  const emptyManifest = await policyManifestFixture();
  const empty = await runEffect(publishApplicationRelationBindingEffect({ db,
    runTransaction: run => db.transaction(run) }, { deploymentId: fixture.deploymentId,
    ...emptyManifest, decisions: [] }));
  const resolveEmpty = () => runEffect(port.resolve({ deploymentId: fixture.deploymentId, manifest: emptyManifest.manifest,
    applicationManifestSha256: empty.manifestBinding.applicationManifestSha256 }));
  expect((await resolveEmpty()).relations).toHaveLength(0);
  // Empty ID lookups may be omitted, but the normalized set must still be
  // inspected: this extra row satisfies its SQL constraints and violates the root.
  await db.insert(fxControlSchemaVersionRelationBindings).values({ ...relation, schemaVersionId: empty.binding.schemaVersionId });
  try { await expect(resolveEmpty()).rejects.toMatchObject({ reason: "storedState" }); }
  finally { await db.delete(fxControlSchemaVersionRelationBindings).where(and(
    eq(fxControlSchemaVersionRelationBindings.deploymentId, fixture.deploymentId),
    eq(fxControlSchemaVersionRelationBindings.schemaVersionId, empty.binding.schemaVersionId))); }
  expect((await resolveEmpty()).relations).toHaveLength(0);

  const stableWhere = and(eq(fxControlRelations.deploymentId, fixture.deploymentId), eq(fxControlRelations.relationId, relation.relationId));
  const [stable] = await db.select().from(fxControlRelations).where(stableWhere);
  if (stable === undefined) throw new Error("Missing stable relation");
  await db.update(fxControlRelations).set({ createdBySchemaVersionId: empty.binding.schemaVersionId }).where(stableWhere);
  try { await expect(resolve()).rejects.toMatchObject({ reason: "storedState" }); }
  finally { await db.update(fxControlRelations).set({ createdBySchemaVersionId: stable.createdBySchemaVersionId }).where(stableWhere); }
  expect(await resolve()).toEqual(expected);
}

describe("PGlite", { concurrent: false }, () => {
  const withPersistence = useFileScopedApplicationNativeMutationPersistence();

  it("restores empty and nonempty catalog sets with corruption refusal in PGlite", async () => {
    await withPersistence(persistence => exerciseRelationCatalog(persistence.target));
  }, 120_000);

  it.each([false, true])("rejects changed preparation catalog inputs at acceptance in PGlite (unique=%s)", async unique => {
    await withPersistence(persistence => exercise(persistence.target, persistence.control, unique));
  }, 240_000);
});

describe("PostgreSQL", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence();

  it.skipIf(postgresUrl === null)("restores empty and nonempty catalog sets with corruption refusal in PostgreSQL", async () => {
    await withPersistence(exerciseRelationCatalog);
  }, 120_000);

  it.skipIf(postgresUrl === null).each([false, true])("rejects changed preparation catalog inputs at acceptance in PostgreSQL (unique=%s)", async unique => {
    await withPersistence(persistence => exercise(persistence, persistence, unique));
  }, 240_000);
});

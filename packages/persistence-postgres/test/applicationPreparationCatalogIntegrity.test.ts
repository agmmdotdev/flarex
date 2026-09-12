import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { prepareApplicationBindingSelection, readApplicationBindingPreparationInputs } from "../src/applicationActivation";
import { readResolvedApplicationRelationManifestBinding } from "../src/applicationRelationSchemaAuthority";
import { prepareApplicationRelationReadinessFromSchema } from "../src/applicationRelationReadiness";
import { readApplicationBindingProjectionInTransaction } from "../src/applicationBindingProjection";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { fxControlApplicationManifestSchemaBindings, fxControlSchemaVersionUniqueConstraintSets } from "../src/schema";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { cmsHostFixture } from "./cmsHostFixture";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

/** Preflight 67 refusal witness: removing a repeated preparation read requires
 * existing acceptance to detect changes to the input it would stop rereading. */
async function exercise(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, unique: boolean) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const controlPersistence = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const { fixture, reference } = await cmsHostFixture(persistence, { controlPersistence,
    cmsFields: [{ name: "title", kind: "text", ...(unique ? { unique: true } : {}) }],
    physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
  const control = fixture.control.drizzle;
  const prepare = () => runEffect(prepareApplicationBindingSelection(fixture.relationActivation));
  const prepared = await prepare();
  const planning = await runEffect(readApplicationBindingPreparationInputs(prepared, control));
  const input = { deploymentId: fixture.deploymentId,
    applicationManifestSha256: fixture.relation.manifestBinding.applicationManifestSha256 };
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
  const accept = () => persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
    return yield* readApplicationBindingProjectionInTransaction(prepared, tx, clock);
  })));
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

it.each([false, true])("rejects changed preparation catalog inputs at acceptance in PGlite (unique=%s)", async unique => {
  await exercise(await createMigratedPGlitePersistence(), unique);
}, 240_000);

it.skipIf(postgresUrl === null).each([false, true])("rejects changed preparation catalog inputs at acceptance in PostgreSQL (unique=%s)", async unique => {
  const resource = await createFileScopedPostgresFixture();
  try { await exercise(resource.persistence, unique); } finally { await resource.dispose(); }
}, 240_000);

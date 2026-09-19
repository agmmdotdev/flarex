import { and, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import { CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema, SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1, decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction } from "../src/appUniqueConstraintDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../src/appUniqueConstraintSetClosureV1";
import { fxControlSchemaVersionUniqueConstraintBindings, fxControlUniqueConstraintDefinitions } from "../src/schema";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { readOwnershipUniqueClosure } from "../src/applicationWriteOwnership/UniqueEvidence";
import { ApplicationWriteOwnershipHistoryBudget } from "../src/applicationWriteOwnership/Policy";

/** Closed catalog authority and deliberate corruption, identical on both drivers. */
export async function appUniqueConstraintSelectionScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  observeWarm: (run: () => Promise<unknown>) => Promise<unknown> = run => run(),
) {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make("deployment_unique_selection");
  const scopeId = decodeReplacementScopeIdV1("scope_d2320000-0000-0000-0000-000000000001");
  const schemaVersionId = CatalogSchemaVersionIdSchema.make("schema_unique_selection_a");
  const nextSchema = CatalogSchemaVersionIdSchema.make("schema_unique_selection_b");
  const physicalLocator = { kind: "shared_database", databaseKey: "unique_selection", schemaName: "public" } as const;
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "project_unique_selection" });
  await persistence.insertScopeMetadata({ deploymentId, scopeId, physicalLocator });
  const tables = ["users", "posts", "audit"].map(logicalName => ({
    logicalName,
    definition: { kind: "appDocument" as const, definitionVersion: 1 as const,
      documentType: { type: "object" as const, value: {
        name: { fieldType: { type: "string" as const }, optional: false },
        email: { fieldType: { type: "string" as const }, optional: false },
      } } },
  }));
  const published = await persistence.publishAppSchemaV1({ deploymentId, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1), tables, indexes: [] });
  const table = (name: string) => {
    const row = published.manifest.tableDefinitions.tables.find(row => row.logicalName === name);
    if (!row) throw new Error(`Missing table ${name}`);
    return row.tableId;
  };
  const bind = async (schema: typeof schemaVersionId, tableName: string, descriptor: string, field: string) => {
    const prepared = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(persistence.drizzle, {
      deploymentId, schemaVersionId: schema, tableId: table(tableName),
      descriptor: SchemaManifestAppIndexDescriptorSchema.make(descriptor),
      physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
        orderedFields: [field], sparse: false, localePolicy: { kind: "none" },
        keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }),
    }));
    return persistence.drizzle.transaction(tx => runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared)));
  };
  const close = async (schema: typeof schemaVersionId) => {
    const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(persistence.drizzle,
      { deploymentId, schemaVersionId: schema }));
    return persistence.drizzle.transaction(tx => runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared)));
  };
  await bind(schemaVersionId, "users", "by_name", "name");
  await bind(schemaVersionId, "users", "by_email", "email");
  await bind(schemaVersionId, "posts", "by_name", "name");
  const input = { deploymentId, scopeId, schemaVersionId, tableIds: [table("users")], maximumDefinitions: 32 };
  const port = createAppUniqueConstraintDefinitionPortV1(persistence.drizzle);
  expect(await runEffect(port.locate(input))).toBeNull();
  await close(schemaVersionId);
  const selected = await runEffect(port.locate(input));
  expect(selected).toHaveLength(2);
  expect(await observeWarm(() => runEffect(port.locate(input)))).toEqual(selected);
  expect(await runEffect(port.locate({ ...input, tableIds: [table("posts")] }))).toHaveLength(1);
  expect(await runEffect(port.locate({ ...input, tableIds: [table("audit")] }))).toEqual([]);
  expect(await runEffect(port.locate({ ...input, tableIds: [] }))).toEqual([]);
  expect(await runEffect(port.locate({ ...input, maximumDefinitions: 1 }))).toBeNull();
  expect(await runEffect(port.locate({ ...input,
    scopeId: decodeReplacementScopeIdV1("scope_d2320000-0000-0000-0000-000000000099") }))).toBeNull();
  const bindingTable = fxControlSchemaVersionUniqueConstraintBindings;
  const bindings = await persistence.drizzle.select().from(bindingTable).where(and(
    eq(bindingTable.deploymentId, deploymentId), eq(bindingTable.schemaVersionId, schemaVersionId)));
  const removed = bindings.find(binding => binding.uniqueConstraintDefinitionId === selected?.[0]?.uniqueConstraintDefinitionId);
  if (!removed) throw new Error("Missing selected binding");
  const identity = and(eq(bindingTable.deploymentId, deploymentId), eq(bindingTable.schemaVersionId, schemaVersionId),
    eq(bindingTable.logicalUniqueConstraintId, removed.logicalUniqueConstraintId));
  const cold = () => createAppUniqueConstraintDefinitionPortV1(persistence.drizzle);
  const rejectBoth = async () => {
    expect(await runEffectFailure(port.locate(input))).toMatchObject({ _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" });
    expect(await runEffectFailure(cold().locate(input))).toMatchObject({ _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" });
  };
  await persistence.drizzle.delete(bindingTable).where(identity);
  await rejectBoth();
  await persistence.drizzle.insert(bindingTable).values(removed);
  expect(await runEffect(port.locate(input))).toEqual(selected);

  // Swap logical owners while retaining physical IDs and canonical specifications.
  const owners = bindings.filter(binding => selected?.some(definition => definition.uniqueConstraintDefinitionId === binding.uniqueConstraintDefinitionId));
  const [left, right] = owners;
  if (!left || !right || owners.length !== 2) throw new Error("Expected two selected owners");
  const changeOwners = async (next: typeof owners) => {
    for (const owner of owners) await persistence.drizzle.delete(bindingTable).where(and(
      eq(bindingTable.deploymentId, deploymentId), eq(bindingTable.schemaVersionId, schemaVersionId),
      eq(bindingTable.logicalUniqueConstraintId, owner.logicalUniqueConstraintId)));
    for (const owner of next) await persistence.drizzle.update(fxControlUniqueConstraintDefinitions)
      .set({ logicalUniqueConstraintId: owner.logicalUniqueConstraintId }).where(and(
        eq(fxControlUniqueConstraintDefinitions.deploymentId, deploymentId),
        eq(fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId, owner.uniqueConstraintDefinitionId)));
    await persistence.drizzle.insert(bindingTable).values(next);
  };
  await changeOwners([{ ...left, uniqueConstraintDefinitionId: right.uniqueConstraintDefinitionId },
    { ...right, uniqueConstraintDefinitionId: left.uniqueConstraintDefinitionId }]);
  await rejectBoth();
  await changeOwners(owners);

  // A new closed schema changes the same logical declaration and adds a member.
  expect(await runEffect(port.locate({ ...input, schemaVersionId: nextSchema }))).toBeNull();
  await persistence.publishAppSchemaV1({ deploymentId, schemaVersionId: nextSchema,
    version: CatalogSchemaVersionSchema.make(2), tables, indexes: [] });
  await bind(nextSchema, "users", "by_name", "email");
  await bind(nextSchema, "users", "by_extra", "name");
  await close(nextSchema);
  const nextBindings = await persistence.drizzle.select().from(bindingTable).where(and(
    eq(bindingTable.deploymentId, deploymentId), eq(bindingTable.schemaVersionId, nextSchema)));
  const replacement = nextBindings.find(binding => bindings.some(prior => prior.logicalUniqueConstraintId === binding.logicalUniqueConstraintId));
  const extra = nextBindings.find(binding => !bindings.some(prior => prior.logicalUniqueConstraintId === binding.logicalUniqueConstraintId));
  const original = bindings.find(binding => binding.logicalUniqueConstraintId === replacement?.logicalUniqueConstraintId);
  if (!replacement || !original || !extra) throw new Error("Missing replacement or extra binding");
  const originalIdentity = and(eq(bindingTable.deploymentId, deploymentId), eq(bindingTable.schemaVersionId, schemaVersionId),
    eq(bindingTable.logicalUniqueConstraintId, original.logicalUniqueConstraintId));
  await persistence.drizzle.update(bindingTable).set({ uniqueConstraintDefinitionId: replacement.uniqueConstraintDefinitionId }).where(originalIdentity);
  await rejectBoth();
  await persistence.drizzle.update(bindingTable).set({ uniqueConstraintDefinitionId: original.uniqueConstraintDefinitionId }).where(originalIdentity);
  await persistence.drizzle.insert(bindingTable).values({ ...extra, schemaVersionId });
  await rejectBoth();
  await persistence.drizzle.delete(bindingTable).where(and(eq(bindingTable.deploymentId, deploymentId),
    eq(bindingTable.schemaVersionId, schemaVersionId), eq(bindingTable.logicalUniqueConstraintId, extra.logicalUniqueConstraintId)));
  const next = await runEffect(port.locate({ ...input, schemaVersionId: nextSchema }));
  expect(next).toHaveLength(2);
  expect(next?.map(definition => definition.uniqueConstraintDefinitionId)).not.toEqual(selected?.map(definition => definition.uniqueConstraintDefinitionId));
  const untouched = bindings.find(binding => !selected?.some(definition => definition.uniqueConstraintDefinitionId === binding.uniqueConstraintDefinitionId));
  if (!untouched) throw new Error("Missing untouched table binding");
  await persistence.drizzle.delete(bindingTable).where(and(eq(bindingTable.deploymentId, deploymentId),
    eq(bindingTable.schemaVersionId, schemaVersionId), eq(bindingTable.logicalUniqueConstraintId, untouched.logicalUniqueConstraintId)));
  expect(await runEffectFailure(port.locate(input))).toMatchObject({ _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" });
  await persistence.drizzle.insert(bindingTable).values(untouched);
  expect(await runEffect(port.locate(input))).toEqual(selected);
  const emptySchema = CatalogSchemaVersionIdSchema.make("schema_unique_selection_empty");
  await persistence.publishAppSchemaV1({ deploymentId, schemaVersionId: emptySchema,
    version: CatalogSchemaVersionSchema.make(3), tables, indexes: [] });
  expect(await runEffect(port.locate({ ...input, schemaVersionId: emptySchema }))).toBeNull();
  await close(emptySchema);
  expect(await runEffect(port.locate({ ...input, schemaVersionId: emptySchema }))).toEqual([]);

  // Fail only set hashing, allowing unrelated artifact/specification digests to
  // reach the real provider. Both read and preparation preserve the cause.
  const cause = new Error("unique set digest provider unavailable");
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
    if (new TextDecoder().decode(data).startsWith('{"format":"flarexdb-app-unique-constraint-set",')) {
      return Promise.reject(cause);
    }
    return originalDigest(algorithm, data);
  });
  const retryPort = cold();
  const emptyInput = { ...input, schemaVersionId: emptySchema };
  try {
    expect(await runEffectFailure(retryPort.locate(emptyInput)))
      .toMatchObject({ _tag: "AppUniqueConstraintSetClosureResourceError", reason: "digestUnavailable", cause });
    expect(await runEffectFailure(prepareAppUniqueConstraintSetClosureV1Effect(persistence.drizzle,
      { deploymentId, schemaVersionId: emptySchema })))
      .toMatchObject({ _tag: "AppUniqueConstraintSetClosureResourceError", reason: "digestUnavailable", cause });
    expect(await runEffectFailure(readOwnershipUniqueClosure(persistence.drizzle, deploymentId,
      emptySchema, new ApplicationWriteOwnershipHistoryBudget())))
      .toMatchObject({ reason: "resourceFailure", cause: {
        _tag: "AppUniqueConstraintSetClosureResourceError", reason: "digestUnavailable", cause,
      } });
  } finally {
    digest.mockRestore();
  }
  expect(await runEffect(retryPort.locate(emptyInput))).toEqual([]);
  expect(await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(persistence.drizzle,
    { deploymentId, schemaVersionId: emptySchema }))).toMatchObject({ deploymentId, schemaVersionId: emptySchema });
}

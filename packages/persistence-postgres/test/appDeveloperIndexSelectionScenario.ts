import { and, eq, inArray } from "drizzle-orm";
import { expect } from "vitest";
import { CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema } from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { fxControlIndexDefinitions, fxControlSchemaVersionIndexBindings, fxControlTables } from "../src/schema";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

/** Real catalog publication and corruption witnesses shared by both drivers. */
export async function appDeveloperIndexSelectionScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  observeWarm: (run: () => Promise<unknown>) => Promise<unknown> = run => run(),
) {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make("deployment_exact_selection");
  const scopeId = decodeReplacementScopeIdV1("scope_d2310000-0000-0000-0000-000000000001");
  const schemaVersionId = CatalogSchemaVersionIdSchema.make("schema_selection_a");
  const nextSchema = CatalogSchemaVersionIdSchema.make("schema_selection_b");
  const physicalLocator = { kind: "shared_database", databaseKey: "selection", schemaName: "public" } as const;
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "project_selection" });
  await persistence.insertScopeMetadata({ deploymentId, scopeId, physicalLocator });
  const tables = ["users", "posts", "audit"].map(logicalName => ({
    logicalName,
    definition: {
      kind: "appDocument" as const, definitionVersion: 1 as const,
      documentType: { type: "object" as const, value: {
        name: { fieldType: { type: "string" as const }, optional: false },
        email: { fieldType: { type: "string" as const }, optional: false },
      } },
    },
  }));
  await persistence.publishAppSchemaV1({ deploymentId, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1), tables, indexes: [
      { tableLogicalName: "users", descriptor: "by_name", fields: ["name"] },
      { tableLogicalName: "users", descriptor: "by_email", fields: ["email"] },
      { tableLogicalName: "posts", descriptor: "by_name", fields: ["name"] },
    ] });
  const catalogTables = await persistence.drizzle.select().from(fxControlTables)
    .where(eq(fxControlTables.deploymentId, deploymentId));
  const table = (name: string) => {
    const row = catalogTables.find(row => row.logicalName === name);
    if (!row) throw new Error(`Missing table ${name}`);
    return row.tableId;
  };
  const input = { deploymentId, scopeId, schemaVersionId, tableIds: [table("users")], maximumDefinitions: 256 };
  const port = createAppDeveloperIndexDefinitionPortV1(persistence.drizzle);
  const selected = await runEffect(port.locate(input));
  expect(selected).toHaveLength(2);
  expect(selected?.every(definition => definition.access.kind === "developer" &&
    definition.access.tableId === table("users"))).toBe(true);
  expect(await observeWarm(() => runEffect(port.locate(input)))).toEqual(selected);
  expect(await runEffect(port.locate({ ...input, tableIds: [table("posts")] }))).toHaveLength(1);
  expect(await runEffect(port.locate({ ...input, tableIds: [table("audit")] }))).toEqual([]);
  expect(await runEffect(port.locate({ ...input,
    scopeId: decodeReplacementScopeIdV1("scope_d2310000-0000-0000-0000-000000000099") }))).toBeNull();
  expect(await runEffectFailure(port.locate({ ...input, maximumDefinitions: 1 })))
    .toMatchObject({ reason: "definitionLimitExceeded" });

  const bindings = await persistence.drizzle.select().from(fxControlSchemaVersionIndexBindings)
    .where(and(eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
      eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId)));
  const removed = bindings.find(binding => binding.indexDefinitionId === selected?.[0]?.indexDefinitionId);
  if (!removed) throw new Error("Missing selected binding");
  const bindingIdentity = and(eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId),
    eq(fxControlSchemaVersionIndexBindings.logicalIndexId, removed.logicalIndexId));
  await persistence.drizzle.delete(fxControlSchemaVersionIndexBindings).where(bindingIdentity);
  expect(await runEffectFailure(port.locate(input))).toMatchObject({ reason: "publishedProjectionContradictory" });
  const cold = createAppDeveloperIndexDefinitionPortV1(persistence.drizzle);
  expect(await runEffectFailure(cold.locate(input))).toMatchObject({ reason: "publishedProjectionIncomplete" });
  await persistence.drizzle.insert(fxControlSchemaVersionIndexBindings).values(removed);
  expect(await runEffect(cold.locate(input))).toEqual(selected);

  // Keep physical IDs/specifications unchanged while swapping their logical
  // owners. Ordinary catalog constraints still hold; descriptor routing must
  // nevertheless refuse the altered association on both warm and cold ports.
  const owners = bindings.filter(binding => selected?.some(definition => definition.indexDefinitionId === binding.indexDefinitionId));
  const [left, right] = owners;
  if (!left || !right || owners.length !== 2) throw new Error("Expected two logical owners");
  const ownerBindings = and(eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId),
    inArray(fxControlSchemaVersionIndexBindings.logicalIndexId, owners.map(owner => owner.logicalIndexId)));
  const swaps = [{ ...left, indexDefinitionId: right.indexDefinitionId },
    { ...right, indexDefinitionId: left.indexDefinitionId }];
  const changeOwners = async (nextOwners: typeof owners) => {
    await persistence.drizzle.delete(fxControlSchemaVersionIndexBindings).where(ownerBindings);
    for (const owner of nextOwners) {
      await persistence.drizzle.update(fxControlIndexDefinitions).set({
        logicalIndexId: owner.logicalIndexId, accessIdentityId: owner.logicalIndexId,
      }).where(and(eq(fxControlIndexDefinitions.deploymentId, deploymentId),
        eq(fxControlIndexDefinitions.indexDefinitionId, owner.indexDefinitionId)));
    }
    await persistence.drizzle.insert(fxControlSchemaVersionIndexBindings).values(nextOwners);
  };
  await changeOwners(swaps);
  try {
    expect(await runEffectFailure(createAppDeveloperIndexDefinitionPortV1(persistence.drizzle).locate(input)))
      .toMatchObject({ reason: "publishedProjectionContradictory" });
    expect(await runEffectFailure(port.locate(input))).toMatchObject({ reason: "publishedProjectionContradictory" });
  } finally {
    await changeOwners(owners);
  }
  expect(await runEffect(port.locate(input))).toEqual(selected);

  // Absence is not cached, and switching schemas must select their own physical
  // specifications even when they reuse a logical index identity.
  expect(await runEffect(port.locate({ ...input, schemaVersionId: nextSchema }))).toBeNull();
  await persistence.publishAppSchemaV1({ deploymentId, schemaVersionId: nextSchema,
    version: CatalogSchemaVersionSchema.make(2), tables, indexes: [
      { tableLogicalName: "users", descriptor: "by_name", fields: ["email"] },
      { tableLogicalName: "users", descriptor: "by_extra", fields: ["name", "email"] },
    ] });
  const nextBindings = await persistence.drizzle.select().from(fxControlSchemaVersionIndexBindings)
    .where(and(eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
      eq(fxControlSchemaVersionIndexBindings.schemaVersionId, nextSchema)));
  const extra = nextBindings.find(binding => !bindings.some(prior => prior.logicalIndexId === binding.logicalIndexId));
  // Select the logical by_name binding explicitly; physical IDs are ordered by
  // the catalog owner, not assumed to reflect descriptor order.
  const original = bindings.find(binding => nextBindings.some(next => next.logicalIndexId === binding.logicalIndexId));
  const replacement = nextBindings.find(binding => binding.logicalIndexId === original?.logicalIndexId);
  if (!extra || !original || !replacement) throw new Error("Missing schema replacement bindings");
  const originalIdentity = and(eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId),
    eq(fxControlSchemaVersionIndexBindings.logicalIndexId, original.logicalIndexId));
  await persistence.drizzle.update(fxControlSchemaVersionIndexBindings)
    .set({ indexDefinitionId: replacement.indexDefinitionId }).where(originalIdentity);
  expect(await runEffectFailure(port.locate(input))).toMatchObject({ reason: "publishedProjectionContradictory" });
  expect(await runEffectFailure(createAppDeveloperIndexDefinitionPortV1(persistence.drizzle).locate(input)))
    .toMatchObject({ reason: "publishedProjectionContradictory" });
  await persistence.drizzle.update(fxControlSchemaVersionIndexBindings)
    .set({ indexDefinitionId: original.indexDefinitionId }).where(originalIdentity);
  await persistence.drizzle.insert(fxControlSchemaVersionIndexBindings).values({ ...extra, schemaVersionId });
  expect(await runEffectFailure(port.locate(input))).toMatchObject({ reason: "publishedProjectionContradictory" });
  expect(await runEffectFailure(createAppDeveloperIndexDefinitionPortV1(persistence.drizzle).locate(input)))
    .toMatchObject({ reason: "publishedProjectionIncomplete" });
  await persistence.drizzle.delete(fxControlSchemaVersionIndexBindings).where(and(
    eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId),
    eq(fxControlSchemaVersionIndexBindings.logicalIndexId, extra.logicalIndexId)));
  const next = await runEffect(port.locate({ ...input, schemaVersionId: nextSchema }));
  expect(next).toHaveLength(2);
  expect(next?.map(definition => definition.indexDefinitionId)).not.toEqual(selected?.map(definition => definition.indexDefinitionId));
  const untouched = bindings.find(binding => !selected?.some(definition => definition.indexDefinitionId === binding.indexDefinitionId));
  if (!untouched) throw new Error("Missing untouched table binding");
  await persistence.drizzle.delete(fxControlSchemaVersionIndexBindings).where(and(
    eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId),
    eq(fxControlSchemaVersionIndexBindings.logicalIndexId, untouched.logicalIndexId)));
  // B displaced A's retained snapshot: returning to A authenticates its full
  // immutable projection again, including the untouched table's binding.
  expect(await runEffectFailure(port.locate(input))).toMatchObject({ reason: "publishedProjectionIncomplete" });
  await persistence.drizzle.insert(fxControlSchemaVersionIndexBindings).values(untouched);
  expect(await runEffect(port.locate(input))).toEqual(selected);

  const otherDeployment = TransactionGrantDeploymentIdV1Schema.make("deployment_selection_other");
  const otherScope = decodeReplacementScopeIdV1("scope_d2310000-0000-0000-0000-000000000002");
  await persistence.insertDeploymentMetadata({ deploymentId: otherDeployment, projectId: "project_selection_other" });
  await persistence.insertScopeMetadata({ deploymentId: otherDeployment, scopeId: otherScope, physicalLocator });
  await persistence.publishAppSchemaV1({ deploymentId: otherDeployment, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1), tables, indexes: [] });
  const [otherTable] = await persistence.drizzle.select().from(fxControlTables).where(and(
    eq(fxControlTables.deploymentId, otherDeployment), eq(fxControlTables.logicalName, "users")));
  if (!otherTable) throw new Error("Missing other deployment table");
  expect(await runEffect(port.locate({ ...input, deploymentId: otherDeployment, scopeId: otherScope,
    tableIds: [otherTable.tableId] }))).toEqual([]);
  expect(await runEffect(port.locate({ ...input, scopeId: otherScope }))).toBeNull();
  expect(await runEffect(port.locate(input))).toEqual(selected);
}

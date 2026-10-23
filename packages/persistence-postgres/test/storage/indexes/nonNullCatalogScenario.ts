import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { Schema } from "effect";
import { expect } from "vitest";
import { AppOrderedIndexPhysicalSpecV1Schema } from "flarex-protocol/ordered-index";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { decodeCatalogSchemaVersionId, decodeCatalogSchemaVersion, SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import type { FlarexPersistence } from "../../../src";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { prepareSchemaManifestAppSchemaBindingsV1Effect, applySchemaManifestAppSchemaBindingsV1InTransactionEffect } from "../../../src/storage/catalog/schemaManifestAppSchemaBindings";
import { prepareSchemaVersionArtifactEffect, ensureSchemaVersionArtifactInTransactionEffect } from "../../../src/storage/catalog/schemaVersionArtifacts";
import { prepareOrderedIndexDefinitionBinding, ensureAppDeveloperIndexDefinitionBindingV1InTransaction } from "../../../src/storage/indexes/appIndexDefinitions";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction } from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import { runEffect } from "../../support/effectTestRuntime";

/** Real definitions and additive DDL, including the unmodified unique CHECK.
 * Every direct SQL malformed-state control rolls back its own savepoint. */
export async function nonNullCatalogScenario(persistence: Pick<FlarexPersistence, "insertDeploymentMetadata" | "query"> &
  { readonly drizzle: FlarexMetadataDatabase }) {
  const deploymentId = "non_null_partial_catalog", schemaVersionId = decodeCatalogSchemaVersionId("non_null_partial_catalog_v1");
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "non_null_partial_catalog_project" });
  const bindings = await runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(persistence.drizzle, {
    deploymentId, tables: [{ logicalName: "entries", definition: { kind: "appDocument", definitionVersion: 1,
      documentType: { type: "object", value: {
        parent: { fieldType: { type: "string" }, optional: false },
        retired: { fieldType: { type: "union", value: [{ type: "null" }, { type: "string" }] }, optional: false },
      } } } }], indexes: [{ tableLogicalName: "entries", descriptor: "by_parent", fields: ["parent"] }],
  }));
  const manifest = await persistence.drizzle.transaction(tx => runEffect(applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, bindings)));
  const artifact = await runEffect(prepareSchemaVersionArtifactEffect({ deploymentId, schemaVersionId,
    version: decodeCatalogSchemaVersion(1), manifest }));
  await persistence.drizzle.transaction(tx => runEffect(ensureSchemaVersionArtifactInTransactionEffect(tx, artifact)));
  const table = manifest.tableDefinitions.tables[0], index = manifest.indexBindings.indexes[0];
  if (table === undefined || index === undefined) throw new Error("Missing genuine non-null catalog parents");
  const predicates = [{ kind: "fieldIsNotNull", field: "parent" },
    { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: "parent" }];
  const orderedSpec = Schema.decodeUnknownSync(AppOrderedIndexPhysicalSpecV1Schema)({
    kind: "appOrdered", specVersion: 1, accessPath: "developer", keyCodecVersion: 1,
    collation: "binaryUtf8", maxEncodedKeyBytes: 2048,
    orderedFields: [{ kind: "documentPath", path: "parent" }, { kind: "systemCreationTime" }],
    tieBreaker: { kind: "separateRowIdentity", byteLength: 16 }, predicate: predicates[0],
  });
  const uniqueSpec = decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
    orderedFields: ["parent"], sparse: false, localePolicy: { kind: "none" },
    keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 });
  const ordered = await runEffect(prepareOrderedIndexDefinitionBinding({ deploymentId, schemaVersionId,
    tableId: table.tableId, logicalIndexId: index.logicalIndexId, physicalSpec: orderedSpec }));
  const unique = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(persistence.drizzle, {
    deploymentId, schemaVersionId, tableId: table.tableId,
    descriptor: SchemaManifestAppIndexDescriptorSchema.make("unique_parent"), physicalSpec: uniqueSpec,
  }));
  await persistence.drizzle.transaction(async tx => {
    await runEffect(ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, ordered));
    await runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, unique));
  });
  const before = await persistence.query("select physical_spec_json from fx_control_index_definition where deployment_id=$1", [deploymentId]);
  const predecessor = await readFile(new URL("../../../drizzle/0151_all_null_partial_index_membership.sql", import.meta.url), "utf8");
  const additive = await readFile(new URL("../../../drizzle/0152_non_null_partial_index_membership.sql", import.meta.url), "utf8");
  const rollback = new Error("Rollback non-null CHECK controls");
  await expect(persistence.drizzle.transaction(async tx => {
    const update = (unique: boolean, member: unknown) => tx.execute(sql`update ${sql.identifier(unique ? "fx_control_unique_constraint_definition" : "fx_control_index_definition")}
      set physical_spec_json=${JSON.stringify({ ...(unique ? uniqueSpec : orderedSpec), predicate: member })}::jsonb where deployment_id=${deploymentId}`);
    const refused = async (unique: boolean, member: unknown) => {
      await tx.execute(sql.raw("savepoint non_null_check"));
      try { await expect(update(unique, member)).rejects.toMatchObject({ cause: { code: "23514",
        constraint: unique ? "fx_control_unique_constraint_definition_spec_json_check" : "fx_control_index_definition_spec_json_check" } }); }
      finally { await tx.execute(sql.raw("rollback to savepoint non_null_check")); await tx.execute(sql.raw("release savepoint non_null_check")); }
    };
    const verify = async () => {
      for (const predicate of predicates) { await update(false, predicate); await refused(true, predicate); }
      for (const predicate of [
        { kind: "fieldIsNotNull" }, { kind: "fieldIsNotNull", field: "" }, { kind: "fieldIsNotNull", field: null },
        { kind: "fieldIsNotNull", field: false }, { kind: "fieldIsNotNull", field: ["parent"] },
        { kind: "fieldIsNotNull", field: "parent", extra: true },
        { kind: "fieldIsNullAndNotNull", nullField: "retired" },
        { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: "retired" },
        { kind: "fieldIsNullAndNotNull", nullField: "", notNullField: "parent" },
        { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: null },
        { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: "parent", extra: true },
      ]) await refused(false, predicate);
    };
    await verify();
    const { predicate: _predicate, ...plainSpec } = orderedSpec;
    await tx.execute(sql`update fx_control_index_definition set physical_spec_json=${JSON.stringify(plainSpec)}::jsonb where deployment_id=${deploymentId}`);
    for (const statement of predecessor.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
    for (const predicate of predicates) await refused(false, predicate);
    for (const statement of additive.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
    await verify();
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await persistence.query("select physical_spec_json from fx_control_index_definition where deployment_id=$1", [deploymentId])).toEqual(before);
}

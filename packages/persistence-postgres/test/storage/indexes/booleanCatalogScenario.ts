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

/** Real catalog parents/definitions; temporary mutations are always rolled back.
 * The upgrade probe executes the exact predecessor and additive CHECK DDL on
 * the actual catalog tables, without claiming a whole-installer drain proof. */
export async function booleanCatalogScenario(persistence: Pick<FlarexPersistence, "insertDeploymentMetadata" | "query"> &
  { readonly drizzle: FlarexMetadataDatabase }) {
  const deploymentId = "boolean_partial_catalog";
  const schemaVersionId = decodeCatalogSchemaVersionId("boolean_partial_catalog_v1");
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "boolean_partial_catalog_project" });
  const bindings = await runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(persistence.drizzle, {
    deploymentId, tables: [{ logicalName: "entries", definition: { kind: "appDocument", definitionVersion: 1,
      documentType: { type: "object", value: {
        parent: { fieldType: { type: "string" }, optional: false },
        selected: { fieldType: { type: "boolean" }, optional: false },
        deleted_at: { fieldType: { type: "union", value: [{ type: "null" }, { type: "string" }] }, optional: false },
      } } } }],
    indexes: [{ tableLogicalName: "entries", descriptor: "by_parent", fields: ["parent"] }],
  }));
  const manifest = await persistence.drizzle.transaction(tx => runEffect(applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, bindings)));
  const artifact = await runEffect(prepareSchemaVersionArtifactEffect({ deploymentId, schemaVersionId,
    version: decodeCatalogSchemaVersion(1), manifest }));
  await persistence.drizzle.transaction(tx => runEffect(ensureSchemaVersionArtifactInTransactionEffect(tx, artifact)));
  const table = manifest.tableDefinitions.tables[0], index = manifest.indexBindings.indexes[0];
  if (table === undefined || index === undefined) throw new Error("Missing real Boolean catalog parents");
  const predicate = { kind: "fieldIsNullAndBooleanEquals", nullField: "deleted_at", booleanField: "selected", value: true };
  const orderedSpec = Schema.decodeUnknownSync(AppOrderedIndexPhysicalSpecV1Schema)({
    kind: "appOrdered", specVersion: 1, accessPath: "developer", keyCodecVersion: 1,
    collation: "binaryUtf8", maxEncodedKeyBytes: 2048,
    orderedFields: [{ kind: "documentPath", path: "parent" }, { kind: "systemCreationTime" }],
    tieBreaker: { kind: "separateRowIdentity", byteLength: 16 }, predicate,
  });
  const uniqueSpec = decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
    orderedFields: ["parent"], sparse: false, localePolicy: { kind: "none" }, predicate,
    keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 });
  const ordered = await runEffect(prepareOrderedIndexDefinitionBinding({ deploymentId, schemaVersionId,
    tableId: table.tableId, logicalIndexId: index.logicalIndexId, physicalSpec: orderedSpec }));
  const unique = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(persistence.drizzle, {
    deploymentId, schemaVersionId, tableId: table.tableId,
    descriptor: SchemaManifestAppIndexDescriptorSchema.make("selected_parent"), physicalSpec: uniqueSpec,
  }));
  await persistence.drizzle.transaction(async tx => {
    await runEffect(ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, ordered));
    await runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, unique));
  });
  const owners = [
    { table: "fx_control_index_definition", spec: orderedSpec, check: "fx_control_index_definition_spec_json_check" },
    { table: "fx_control_unique_constraint_definition", spec: uniqueSpec, check: "fx_control_unique_constraint_definition_spec_json_check" },
  ];
  const before = await Promise.all(owners.map(owner => persistence.query(
    `select physical_spec_json from ${owner.table} where deployment_id=$1`, [deploymentId])));
  const rollback = new Error("Rollback Boolean catalog CHECK probe");
  const previous = await Promise.all(["0108_ordered_index_text_predicate.sql", "0105_conditional_unique_constraints.sql"]
    .map(name => readFile(new URL(`../../../drizzle/${name}`, import.meta.url), "utf8")));
  const additive = await readFile(new URL("../../../drizzle/0150_boolean_partial_index_membership.sql", import.meta.url), "utf8");
  await expect(persistence.drizzle.transaction(async tx => {
    const update = (owner: typeof owners[number], member: unknown) => tx.execute(sql`update ${sql.identifier(owner.table)}
      set physical_spec_json=${JSON.stringify({ ...owner.spec, predicate: member })}::jsonb where deployment_id=${deploymentId}`);
    const refused = async (owner: typeof owners[number], member: unknown) => {
      await tx.execute(sql.raw("savepoint boolean_check"));
      try { await expect(update(owner, member)).rejects.toMatchObject({ cause: { code: "23514", constraint: owner.check } }); }
      finally { await tx.execute(sql.raw("rollback to savepoint boolean_check")); await tx.execute(sql.raw("release savepoint boolean_check")); }
    };
    const verify = async () => {
      for (const owner of owners) {
        for (const value of [true, false]) await update(owner, { ...predicate, value });
        for (const member of [
          { ...predicate, value: "true" }, { ...predicate, value: 1 }, { ...predicate, value: null },
          { kind: predicate.kind, nullField: "deleted_at", booleanField: "selected" },
          { kind: predicate.kind, nullField: "deleted_at", value: true },
          { kind: predicate.kind, booleanField: "selected", value: true },
          { ...predicate, nullField: "" }, { ...predicate, booleanField: "" },
          { ...predicate, booleanField: "deleted_at" }, { ...predicate, extra: true },
        ]) await refused(owner, member);
      }
    };
    await verify();
    // The old CHECKs can only be installed once the genuinely registered new
    // definitions have been temporarily reduced to their valid old shape.
    for (const owner of owners) {
      const { predicate: _predicate, ...oldSpec } = owner.spec;
      await tx.execute(sql`update ${sql.identifier(owner.table)} set physical_spec_json=${JSON.stringify(oldSpec)}::jsonb where deployment_id=${deploymentId}`);
    }
    for (const text of previous) for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await tx.execute(sql.raw(statement));
    for (const owner of owners) await refused(owner, predicate);
    for (const statement of additive.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement));
    await verify();
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await Promise.all(owners.map(owner => persistence.query(
    `select physical_spec_json from ${owner.table} where deployment_id=$1`, [deploymentId])))).toEqual(before);
}

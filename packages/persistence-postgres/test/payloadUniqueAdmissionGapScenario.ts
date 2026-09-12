import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { payloadPostsCollection, payloadScalarFields } from "../../payload-adapter/src/conformanceProfile";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { readAppUniqueConstraintSetClosureV1Effect } from "../src/appUniqueConstraintSetClosureV1";
import { prepareReadinessEvidence, relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { fxControlSchemaVersionUniqueConstraintBindings } from "../src/schema";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction } from "../src/appUniqueConstraintDefinitions";
import { SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import { decodeAppUniqueConstraintPhysicalSpecV1, APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1 } from "flarex-protocol/app-unique-constraint-definition";

export const payloadUniqueAdmissionCases = ["missing", "extra", "wrongField", "stale", "none", "matching", "maximumFieldName", "applicationUnique"] as const;

/** Retains the missing-readiness witness and covers exact set agreement. */
export async function payloadUniqueAdmissionGapScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  mode: typeof payloadUniqueAdmissionCases[number] = "missing",
) {
  expect(payloadPostsCollection().fields).toContainEqual({
    name: "title", type: "text", required: true, unique: true,
  });
  const fixture = await relationReadinessFixture({
    persistence, writePolicy: true, bindingAdmission: true,
    cmsIndexes: mode !== "maximumFieldName", cmsFields: mode === "maximumFieldName"
      ? [{ name: "x".repeat(64), kind: "text", unique: true }]
      : mode === "none" ? payloadScalarFields.map(field => ({ name: field.name, kind: field.kind })) : payloadScalarFields,
  });
  if (mode === "applicationUnique") await installTestConstraint(fixture, "audit", "title");
  if (mode === "none" || mode === "matching" || mode === "maximumFieldName" || mode === "applicationUnique") {
    await prepareReadinessEvidence(fixture);
    const unique = await runEffect(readAppUniqueConstraintSetClosureV1Effect(
      fixture.control.drizzle, fixture.deploymentId, fixture.relation.binding.schemaVersionId,
    ));
    expect(unique?.closure.definitionCount).toBe(mode === "none" ? 0 : mode === "applicationUnique" ? 2 : 1);
    expect(await runEffect(fixture.fold.settle(fixture.input))).toMatchObject({ status: "ready" });
    await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    return;
  }
  if (mode === "stale") {
    await prepareReadinessEvidence(fixture);
    expect(await runEffect(fixture.fold.settle(fixture.input))).toMatchObject({ status: "ready" });
  }
  // Publication now installs the declared constraint. Simulate missing catalog
  // evidence before set closure; readiness must refuse rather than repair it.
  if (mode !== "extra") {
    const removed = await fixture.control.drizzle.delete(fxControlSchemaVersionUniqueConstraintBindings).where(and(
      eq(fxControlSchemaVersionUniqueConstraintBindings.deploymentId, fixture.deploymentId),
      eq(fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId, fixture.relation.binding.schemaVersionId),
    )).returning();
    expect(removed).toHaveLength(1);
  }
  if (mode === "extra" || mode === "wrongField") {
    await installTestConstraint(fixture, "posts", mode === "extra" ? "title" : "publishedAt");
  }
  if (mode !== "stale") await prepareReadinessEvidence(fixture);
  if (mode === "missing") {
    const unique = await runEffect(readAppUniqueConstraintSetClosureV1Effect(
      fixture.control.drizzle, fixture.deploymentId, fixture.relation.binding.schemaVersionId,
    ));
    expect(unique?.closure.definitionCount).toBe(0);
  }
  const readiness = await runEffect(fixture.fold.settle(fixture.input));
  expect(readiness.status,
    "Payload declares title unique, but no matching unique constraint was prepared",
  ).not.toBe("ready");
  expect(readiness).toMatchObject({ status: "not_ready", reason: "uniqueDeclarationMismatch" });
  if (mode === "stale") expect(await runEffectFailure(fixture.relationActivation.activate({
    revisionId: fixture.input.revisionId, expectedActiveHead: null,
  }))).toMatchObject({ reason: "notReady" });
}

/** Deliberate foreign/mismatched metadata for refusal tests, not Payload setup. */
async function installTestConstraint(fixture: Awaited<ReturnType<typeof relationReadinessFixture>>, tableName: string, field: string) {
  const table = fixture.relation.binding.tables.find(candidate => candidate.logicalName === tableName);
  if (table === undefined) throw new Error("Missing test table");
  const prepared = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(fixture.control.drizzle, {
    deploymentId: fixture.deploymentId, schemaVersionId: fixture.relation.binding.schemaVersionId, tableId: table.tableId,
    descriptor: SchemaManifestAppIndexDescriptorSchema.make("unique_unexpected"),
    physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
      orderedFields: [field], sparse: false, localePolicy: { kind: "none" },
      keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }),
  }));
  await fixture.control.drizzle.transaction(tx => runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared)));
}

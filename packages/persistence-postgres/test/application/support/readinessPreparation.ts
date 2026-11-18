import { type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { expect } from "vitest";
import {
  advanceAppSchemaCandidateValidationEffect,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../../../src/storage/indexes/indexBuildReconciliation";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { runEffect } from "../../support/effectTestRuntime";
import { type TestPersistence, readinessFixture } from "./readinessFixture";

export async function prepareReadinessAuthorities(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
): Promise<CatalogSchemaVersionId> {
  const beforeValidation = await runEffect(
    fixture.repository.settle(fixture.input),
  );
  expect(beforeValidation).toMatchObject({
    status: "not_ready",
    reason: "candidateValidationMissing",
  });
  const schemaVersionId = await applicationSchemaVersionId(fixture.control);
  await closeEmptyUniqueConstraintSet(fixture, schemaVersionId);
  await settleCandidateValidation(fixture, schemaVersionId);
  return schemaVersionId;
}

export async function enablePhysicalBuilds(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts,
  });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId: fixture.input.deploymentId,
    scopeId: fixture.input.scopeId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      fixture.control.drizzle,
      Object.freeze({
        deploymentId: fixture.input.deploymentId,
        schemaVersionId,
      }),
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected Application physical requirements.");
  }
  for (const definition of requirements.definitions) {
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      fixture.control.drizzle,
      fixture.authority.scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) throw new Error("Application index definition missing.");
    for (let step = 0; step < 16; step += 1) {
      const input = Object.freeze({
        deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      });
      const built = located.access.kind === "developer"
        ? await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, input))
        : await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, input));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("Application physical build did not enable.");
      }
    }
  }
}

export async function closeEmptyUniqueConstraintSet(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const prepared = await runEffect(
    prepareAppUniqueConstraintSetClosureV1Effect(fixture.control.drizzle, {
      deploymentId: fixture.input.deploymentId,
      schemaVersionId,
    }),
  );
  await fixture.control.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

export async function settleCandidateValidation(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = {
    deploymentId: fixture.input.deploymentId,
    scopeId: fixture.input.scopeId,
    schemaVersionId,
  } as const;
  await runEffect(installAppSchemaCandidateValidationEffect(
    fixture.candidateValidation,
    input,
  ));
  for (let step = 0; step < 64; step += 1) {
    const advanced = await runEffect(advanceAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      input,
    ));
    if (advanced.disposition !== "readyToSettle") continue;
    await runEffect(settleAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      input,
    ));
    return;
  }
  throw new Error("Application candidate validation did not settle.");
}

export async function applicationSchemaVersionId(
  control: TestPersistence,
): Promise<CatalogSchemaVersionId> {
  const result = await control.query<{ schema_version_id: CatalogSchemaVersionId }>(
    "select schema_version_id from fx_control_application_schema_authority_v1",
  );
  const schemaVersionId = result.rows[0]?.schema_version_id;
  if (schemaVersionId === undefined) {
    throw new Error("Expected Application schema authority.");
  }
  return schemaVersionId;
}

import { Result } from "effect";
import { admitFrameworkSchemaArtifactEffect } from "../../../src/installation/frameworkSchema/artifact/admission";
import { prepareFrameworkSchemaArtifactAdmission } from "../../../src/installation/frameworkSchema/artifact/repository";
import { runFreshFrameworkMigrationCoordinatorEffect,
  type FrameworkMigrationReadyResult } from "../../../src/installation/migrationCoordination/freshCoordinator";
import type { FrameworkMigrationBaseInstallation } from "../../../src/installation/migrationCoordination/model";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { runEffect } from "../../support/effectTestRuntime";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture, resetFrameworkSchemaArtifactAdmissionRows } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { FRAMEWORK_VALUE_LOCATOR, additiveSystemArtifacts } from "./frameworkMigrationValueFixtures";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import { useFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";
import {
  resetFrameworkCoordinatorGraphRows,
  resetFrameworkCoordinatorPhysicalStructure,
} from "./frameworkCoordinatorRepositoryTestSupport";

/** Rebuild every additive base on a cleared graph, physical schema and artifacts. */
export function useFileScopedFrameworkCoordinatorAdditivePersistence() {
  return useFileScopedPersistence(async () => {
    const { createFileScopedPGliteFixture } = await import("../../support/pgliteTestFixture");
    return createFileScopedPGliteFixture(async () => async persistence => {
      await resetFrameworkCoordinatorGraphRows(persistence.drizzle);
      await resetFrameworkCoordinatorPhysicalStructure(persistence.drizzle);
      await resetFrameworkSchemaArtifactAdmissionRows(persistence.drizzle);
    });
  });
}

export async function createAdditiveFixture(persistence: PGliteFlarexPersistence, extraBaseTables = 0) {
  await persistence.query("insert into deployments (deployment_id, project_id) values ('deployment-a', 'project-a')");
  await persistence.query('create schema "flarex_shared"');
  await persistence.query('create table "flarex_shared"."fx_system_scope_clock" (scope_uuid uuid not null, constraint "fx_system_scope_clock_scope_uuid_unique" unique (scope_uuid))');
  const artifacts = makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence);
  const { baseArtifact, candidate } = await additiveSystemArtifacts(extraBaseTables);
  for (const artifact of [baseArtifact, candidate]) {
    await runEffect(admitFrameworkSchemaArtifactEffect(artifacts.repository,
      Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact.artifact))));
  }
  const target = await runEffect(makePGliteFrameworkMigrationTargetEffect({ persistence,
    deploymentId: "deployment-a", canonicalPhysicalDatabaseIdentity: "pglite://additive",
    physicalLocator: FRAMEWORK_VALUE_LOCATOR }));
  const common = { artifactRepository: artifacts.repository, target,
    leaseDurationMilliseconds: 120_000, lockTimeoutMilliseconds: 5_000, statementTimeoutMilliseconds: 30_000 };
  const base = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...common,
    artifactIdentity: baseArtifact.artifact.identity, attemptId: "base-attempt", leaseOwnerId: "base-worker" }));
  if (base.kind !== "ready") throw new Error("Base was not ready");
  return { persistence, base, candidate, input: { ...common, artifactIdentity: candidate.artifact.identity,
    attemptId: "candidate-attempt", leaseOwnerId: "candidate-worker", baseInstallation: baseReference(base) } };
}

function baseReference(base: FrameworkMigrationReadyResult): FrameworkMigrationBaseInstallation {
  return { identity: base.readiness.installation.installation.frame.identity,
    installationReceiptSha256: base.readiness.installation.installation.sha256,
    readinessSha256: base.readiness.readiness.sha256,
    physicalLayoutSha256: base.readiness.installation.plan.plan.physicalLayout.layoutSha256 };
}

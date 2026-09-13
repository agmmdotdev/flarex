import { Result } from "effect";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { prepareFrameworkSchemaArtifactAdmission } from "../src/frameworkSchema/artifact/repository";
import { runFreshFrameworkMigrationCoordinatorEffect,
  type FrameworkMigrationReadyResult } from "../src/migrationCoordination/freshCoordinator";
import type { FrameworkMigrationBaseInstallation } from "../src/migrationCoordination/model";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { runEffect } from "./effectTestRuntime";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { FRAMEWORK_VALUE_LOCATOR, syntheticSchemaInput } from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

export async function createAdditiveFixture(extraBaseTables = 0) {
  const persistence = await createMigratedPGlitePersistence();
  await persistence.query("insert into deployments (deployment_id, project_id) values ('deployment-a', 'project-a')");
  await persistence.query('create schema "flarex_shared"');
  await persistence.query('create table "flarex_shared"."fx_system_scope_clock" (scope_uuid uuid not null, constraint "fx_system_scope_clock_scope_uuid_unique" unique (scope_uuid))');
  const artifacts = makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence);
  const schema = syntheticSchemaInput();
  const parent = schema.tables.find(t => t.tableId === "parent");
  if (parent === undefined) throw new Error("Missing base table");
  const extra = Array.from({ length: extraBaseTables }, (_, index) => ({ ...parent, tableId: `extra_${index}` }));
  const baseArtifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
    provenance: { kind: "synthetic", fixtureId: "additive-base" },
    schema: { ...schema, tables: [parent, ...extra] } }));
  const candidate = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
    provenance: { kind: "synthetic", fixtureId: "additive-candidate" }, schema: { ...schema, tables: [...schema.tables, ...extra] } }));
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

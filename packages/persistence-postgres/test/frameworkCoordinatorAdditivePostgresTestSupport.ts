import { Result } from "effect";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { prepareFrameworkSchemaArtifactAdmission } from "../src/frameworkSchema/artifact/repository";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { runEffect } from "./effectTestRuntime";
import type { NativeCoordinatorFixture } from "./frameworkCoordinatorPostgresFixture";
import { syntheticSchemaInput } from "./frameworkMigrationValueFixtures";

export async function prepareUpgrade(fixture: NativeCoordinatorFixture) {
  const base = await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input));
  if (base.kind !== "ready") throw new Error("Expected fresh base");
  const candidate = await admitCandidate(fixture, "addon");
  return { ...fixture.input, artifactIdentity: candidate.artifact.identity, baseReadiness: base.readiness,
    attemptId: "candidate-attempt", leaseOwnerId: "candidate-worker", baseInstallation: {
      identity: base.readiness.installation.installation.frame.identity,
      installationReceiptSha256: base.readiness.installation.installation.sha256,
      readinessSha256: base.readiness.readiness.sha256,
      physicalLayoutSha256: base.readiness.installation.plan.plan.physicalLayout.layoutSha256,
    } };
}

export async function admitCandidate(fixture: NativeCoordinatorFixture, tableId: string) {
  const schema = syntheticSchemaInput();
  const child = schema.tables[0];
  if (child === undefined) throw new Error("Missing child definition");
  const candidate = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
    provenance: { kind: "synthetic", fixtureId: `native-additive-${tableId}` },
    schema: { ...schema, tables: [...schema.tables, { ...child, tableId }] } }));
  await runEffect(admitFrameworkSchemaArtifactEffect(fixture.input.artifactRepository,
    Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(candidate.artifact))));
  return candidate;
}

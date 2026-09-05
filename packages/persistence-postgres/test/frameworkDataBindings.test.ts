import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "./fixtures/applicationNativeMutationTestFixture";
import { makePGliteFrameworkMigrationTargetEffect } from "../src/migrationCoordination/pgliteTarget";
import { runEffect } from "./effectTestRuntime";
import { exerciseBindingLifecycle } from "./frameworkDataBindingTestSupport";
import {
  exercisePhysicalBindings,
  exerciseBindingAvailabilityLimit,
} from "./frameworkDataBindingPhysicalTestSupport";
import { Result } from "effect";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";

describe("private data bindings", { timeout: 180_000 }, () => {
  it("prepares, selects, admits, recovers and rejects stale or corrupt evidence", async () => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const fixture =
      await createApplicationNativeMutationPGliteFixtureWithPersistence(
        {
          runtimeHostIdentity: "flarex.test/binding-host",
          compatibilityDate: "2026-09-05",
        },
        { control, target },
      );
    const migrationTarget = await runEffect(
      makePGliteFrameworkMigrationTargetEffect({
        persistence: target,
        deploymentId: fixture.deploymentId,
        canonicalPhysicalDatabaseIdentity: "pglite-binding-fixture",
        physicalLocator: fixture.active.basis.authority.physicalLocator,
      }),
    );
    const lifecycle = await exerciseBindingLifecycle(fixture, migrationTarget);
    const artifacts = makePGliteFrameworkSchemaArtifactAdmissionFixture(target);
    const physical = await exercisePhysicalBindings(
      fixture,
      migrationTarget,
      artifacts.repository,
      lifecycle.frame,
      lifecycle.head,
    );
    await exerciseBindingAvailabilityLimit(
      fixture,
      physical.host,
      physical.frame,
      physical.availability,
      Result.getOrThrow(physical.activation.current).head,
    );
  });
});

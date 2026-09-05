import { describe, expect, it } from "vitest";
import { Effect, Exit, Cause } from "effect";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "./fixtures/applicationNativeMutationTestFixture";
import { makePGliteFrameworkMigrationTargetEffect } from "../src/migrationCoordination/pgliteTarget";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import {
  prepareRelationalFixture,
  exerciseRelationalStore,
} from "./relationalTransactionTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("private scalar relational transaction", { timeout: 180_000 }, () => {
  it("proves functional store and lifetime behavior on one bounded worker instance", async () => {
    const control = await createMigratedPGlitePersistence();
    const worker = await createRelationalPGliteFixture();
    const fixture =
      await createApplicationNativeMutationPGliteFixtureWithPersistence(
        {
          runtimeHostIdentity: "flarex.test/scalar-store",
          compatibilityDate: "2026-09-06",
        },
        { control, target: worker.persistence },
      );
    const target = await runEffect(
      makePGliteFrameworkMigrationTargetEffect({
        persistence: worker.persistence,
        deploymentId: fixture.deploymentId,
        canonicalPhysicalDatabaseIdentity: "scalar-pglite",
        physicalLocator: fixture.active.basis.authority.physicalLocator,
      }),
    );
    const artifacts = makePGliteFrameworkSchemaArtifactAdmissionFixture(
      worker.persistence,
    );
    const prepared = await prepareRelationalFixture(
      fixture,
      target,
      artifacts.repository,
    );
    const tested = await exerciseRelationalStore(prepared, worker.session);
    expect(
      await runEffectFailure(
        tested.host.run(tested.reference, tested.timeout, null),
      ),
    ).toMatchObject({ reason: "deadlineExceeded" });
    await runEffect(tested.host.run(tested.reference, tested.read, null));
    worker.blockNextStoreRead();
    const quarantined = await runEffect(
      Effect.exit(tested.host.run(tested.reference, tested.read, null)),
    );
    expect(Exit.isFailure(quarantined)).toBe(true);
    if (Exit.isFailure(quarantined)) {
      const failures = quarantined.cause.reasons
        .filter(Cause.isFailReason)
        .map((reason) => reason.error);
      expect(failures).toContainEqual(
        expect.objectContaining({ reason: "statementFailure" }),
      );
      expect(failures).toContainEqual(
        expect.objectContaining({ reason: "cleanupFailure" }),
      );
    }
    expect(worker.isQuarantined()).toBe(true);
    expect(
      await runEffectFailure(
        tested.host.run(tested.reference, tested.read, null),
      ),
    ).toBeDefined();
  });
});

import { Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  fxSystemFrameworkSchemaTargetNamespaces,
} from "../src/migrationCoordination/schema";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
  readFrameworkMigrationCollisionDomainInTransactionEffect,
  readFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from
  "../src/migrationCoordination/targetNamespace";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

describe("framework coordinator target/collision repository", () => {
  it("keeps transaction kernels source-private", async () => {
    expect(
      "ensureFrameworkSchemaTargetNamespaceInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "ensureFrameworkMigrationCollisionDomainInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect("FrameworkMigrationRepositoryError" in persistenceRoot).toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/targetCollisionRepository.ts",
    );
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/repositoryErrors.ts",
    );
  });

  it("ensures, reads, and exactly replays one target and collision", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshRepositoryValues();

    const result = await persistence.drizzle.transaction(async transaction => {
      const missingTarget = await runEffect(
        readFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      );
      expect(Option.isNone(missingTarget)).toBe(true);

      const target = await runEffect(
        ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      );
      const replayedTarget = await runEffect(
        ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      );
      const readTarget = Option.getOrThrow(await runEffect(
        readFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      ));
      expect(replayedTarget.storageId).toBe(target.storageId);
      expect(readTarget).toEqual(target);

      const missingCollision = await runEffect(
        readFrameworkMigrationCollisionDomainInTransactionEffect(
          transaction,
          target,
          values.plan.frame.collision,
        ),
      );
      expect(Option.isNone(missingCollision)).toBe(true);

      const collision = await runEffect(
        ensureFrameworkMigrationCollisionDomainInTransactionEffect(
          transaction,
          target,
          values.plan,
        ),
      );
      const replayedCollision = await runEffect(
        ensureFrameworkMigrationCollisionDomainInTransactionEffect(
          transaction,
          target,
          values.plan,
        ),
      );
      const readCollision = Option.getOrThrow(await runEffect(
        readFrameworkMigrationCollisionDomainInTransactionEffect(
          transaction,
          target,
          values.plan.frame.collision,
        ),
      ));
      expect(replayedCollision.storageId).toBe(collision.storageId);
      expect(readCollision).toEqual(collision);
      return { target, collision };
    });

    expect(result.target.targetNamespace).toEqual(values.target);
    expect(result.collision.coordinate).toEqual(values.plan.frame.collision);
    await expect(repositoryCounts(persistence)).resolves.toEqual({
      targets: "1",
      collisions: "1",
    });
  });

  it("converges duplicate target ensures and rolls back both roots together", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshRepositoryValues();

    const ensured = await Promise.all([
      persistence.drizzle.transaction(transaction => runEffect(
        ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      )),
      persistence.drizzle.transaction(transaction => runEffect(
        ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      )),
    ]);
    expect(ensured[0]?.storageId).toBe(ensured[1]?.storageId);
    await expect(repositoryCounts(persistence)).resolves.toEqual({
      targets: "1",
      collisions: "0",
    });

    const rollbackPersistence = await createMigratedPGlitePersistence();
    const deliberateRollback = new Error("deliberate rollback");
    await expect(rollbackPersistence.drizzle.transaction(
      async transaction => {
        const target = await runEffect(
          ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
            transaction,
            values.target,
          ),
        );
        await runEffect(
          ensureFrameworkMigrationCollisionDomainInTransactionEffect(
            transaction,
            target,
            values.plan,
          ),
        );
        throw deliberateRollback;
      },
    )).rejects.toBe(deliberateRollback);
    await expect(repositoryCounts(rollbackPersistence)).resolves.toEqual({
      targets: "0",
      collisions: "0",
    });
  });

  it("refuses forged and cross-target collision dependencies", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshRepositoryValues();

    const storedTargetFromAnotherDatabase =
      await persistence.drizzle.transaction(async transaction => {
        const target = await runEffect(
          ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
            transaction,
            values.target,
          ),
        );
        const forgedFailure = await runEffectFailure(
          ensureFrameworkMigrationCollisionDomainInTransactionEffect(
            transaction,
            { ...target },
            values.plan,
          ),
        );
        expect(forgedFailure).toMatchObject({
          _tag: "FrameworkMigrationRepositoryError",
          operation: "ensureCollisionDomain",
          reason: "referenceRefusal",
        });

        const otherTargetValue = await runEffect(
          captureFrameworkSchemaTargetNamespace({
            deploymentId: values.target.frame.deploymentId,
            physicalDatabaseIdentity: "postgres-cluster-a/database-other",
            schemaName: "flarex_other",
          }),
        );
        const otherTarget = await runEffect(
          ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
            transaction,
            otherTargetValue,
          ),
        );
        const crossTargetFailure = await runEffectFailure(
          ensureFrameworkMigrationCollisionDomainInTransactionEffect(
            transaction,
            otherTarget,
            values.plan,
          ),
        );
        expect(crossTargetFailure).toMatchObject({
          _tag: "FrameworkMigrationRepositoryError",
          operation: "ensureCollisionDomain",
          reason: "referenceRefusal",
        });
        return target;
      });

    const otherPersistence = await createMigratedPGlitePersistence();
    const missingParentFailure = await otherPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationCollisionDomainInTransactionEffect(
          transaction,
          storedTargetFromAnotherDatabase,
          values.plan,
        ),
      ),
    );
    expect(missingParentFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensureCollisionDomain",
      reason: "referenceRefusal",
    });
  });

  it("rejects corrupt or over-limit stored target bytes before restoration", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshRepositoryValues();
    await persistence.drizzle.transaction(transaction => runEffect(
      ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
        transaction,
        values.target,
      ),
    ));

    const changedBytes = new TextEncoder().encode(values.target.canonicalJson);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await persistence.drizzle.update(
      fxSystemFrameworkSchemaTargetNamespaces,
    ).set({ canonicalBytes: changedBytes });
    const corruptFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      ),
    );
    expect(corruptFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readTargetNamespace",
      reason: "storedCorruption",
    });

    await persistence.query(`
      alter table fx_system_framework_schema_target_namespace
        drop constraint fx_framework_target_namespace_frame_check
    `);
    const oversizedBytes = new Uint8Array(4_097).fill(0x20);
    await persistence.drizzle.update(
      fxSystemFrameworkSchemaTargetNamespaces,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    });
    const overLimitFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaTargetNamespaceInTransactionEffect(
          transaction,
          values.target,
        ),
      ),
    );
    expect(overLimitFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readTargetNamespace",
      reason: "storedCorruption",
    });
  });

  it("projects a rejected driver statement without retaining the transaction", async () => {
    const values = await freshRepositoryValues();
    const driverCause = new Error("driver unavailable");
    const transaction = rejectingInsertTransaction(driverCause);
    const failure = await runEffectFailure(
      ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
        transaction,
        values.target,
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensureTargetNamespace",
      reason: "resourceFailure",
      cause: driverCause,
    });
  });
});

async function freshRepositoryValues() {
  const artifact = await syntheticSystemArtifact();
  const target = await frameworkTargetNamespace();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: target,
  }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
  return { target, plan };
}

async function repositoryCounts(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<Readonly<{ readonly targets: string; readonly collisions: string }>> {
  const result = await persistence.query<{
    targets: string;
    collisions: string;
  }>(`
    select
      (select count(*)::text
        from fx_system_framework_schema_target_namespace) as targets,
      (select count(*)::text
        from fx_system_framework_migration_collision_domain) as collisions
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing repository count row");
  return row;
}

function rejectingInsertTransaction(
  cause: unknown,
): FlarexMetadataTransaction {
  const transaction = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => Promise.reject(cause),
      }),
    }),
  };
  return transaction as unknown as FlarexMetadataTransaction;
}

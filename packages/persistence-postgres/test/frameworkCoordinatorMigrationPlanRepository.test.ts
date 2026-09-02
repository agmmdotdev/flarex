import { eq } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
  readFreshRelationalMigrationPlanInTransactionEffect,
  resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect,
} from "../src/migrationCoordination/migrationPlanRepository";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
} from "../src/migrationCoordination/physicalNameAssignmentRepository";
import {
  fxSystemFrameworkMigrationPlans,
  fxSystemFrameworkMigrationPlanStepDependencies,
} from "../src/migrationCoordination/schema";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  currencyArtifact,
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 30_000;

describe("framework coordinator migration-plan repository", () => {
  it("keeps transaction kernels source-private", async () => {
    expect(
      "ensureFreshRelationalMigrationPlanInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFreshRelationalMigrationPlanInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect" in
        persistenceRoot,
    ).toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/migrationPlanRepository.ts",
    );
  });

  it("ensures, reads, and exactly replays an ordered plan aggregate", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const restored = await persistence.drizzle.transaction(
      async transaction => {
        const { collision } = await ensurePlanPrerequisites(transaction, values);
        const missing = await runEffect(
          readFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collision,
            values.plan,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);

        const first = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collision,
            values.plan,
          ),
        );
        const replayed = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collision,
            values.plan,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collision,
            values.plan,
          ),
        ));
        expect(replayed.storageId).toBe(first.storageId);
        expect(read).toEqual(first);
        return first;
      },
    );

    expect(restored.plan).toEqual(values.plan);
    expect(restored.plan).not.toBe(values.plan);
    await expect(planAggregateCounts(persistence)).resolves.toEqual({
      plans: "1",
      steps: String(values.plan.frame.steps.length),
      dependencies: String(expectedDependencies(values.plan).length),
    });
    await expect(storedPlanOrdering(persistence)).resolves.toEqual({
      stepIds: values.plan.frame.steps.map(step => step.stepId),
      dependencies: expectedDependencies(values.plan),
    });

    const differentPlan = (await currencyPlanRepositoryValues()).plan;
    const digestConflict = await runEffectFailure(
      resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect(
        Option.some(restored),
        restored.collision,
        differentPlan,
        "readPlan",
      ),
    );
    expect(digestConflict).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPlan",
      reason: "immutableConflict",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("converges duplicate ensures and rolls the aggregate back with its caller", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const { collision } = await persistence.drizzle.transaction(
      transaction => ensurePlanPrerequisites(transaction, values),
    );
    const ensured = await Promise.all([
      persistence.drizzle.transaction(transaction => runEffect(
        ensureFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          collision,
          values.plan,
        ),
      )),
      persistence.drizzle.transaction(transaction => runEffect(
        ensureFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          collision,
          values.plan,
        ),
      )),
    ]);
    expect(ensured[0]?.storageId).toBe(ensured[1]?.storageId);
    await expect(planAggregateCounts(persistence)).resolves.toEqual({
      plans: "1",
      steps: String(values.plan.frame.steps.length),
      dependencies: String(expectedDependencies(values.plan).length),
    });

    const rollbackPersistence = await createMigratedPGlitePersistence();
    const rollbackParents = await rollbackPersistence.drizzle.transaction(
      transaction => ensurePlanPrerequisites(transaction, values),
    );
    const deliberateRollback = new Error("deliberate rollback");
    await expect(rollbackPersistence.drizzle.transaction(async transaction => {
      await runEffect(
        ensureFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          rollbackParents.collision,
          values.plan,
        ),
      );
      throw deliberateRollback;
    })).rejects.toBe(deliberateRollback);
    await expect(planAggregateCounts(rollbackPersistence)).resolves.toEqual({
      plans: "0",
      steps: "0",
      dependencies: "0",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("refuses missing assignments and a collision from another coordinate", async () => {
    const values = await freshPlanRepositoryValues();
    const missingPersistence = await createMigratedPGlitePersistence();
    const { collision: collisionWithoutAssignments } =
      await missingPersistence.drizzle.transaction(
        transaction => ensurePlanParents(transaction, values),
      );
    const missingAssignmentFailure =
      await missingPersistence.drizzle.transaction(
        transaction => runEffectFailure(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collisionWithoutAssignments,
            values.plan,
          ),
        ),
      );
    expect(missingAssignmentFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePlan",
      reason: "referenceRefusal",
    });
    await expect(planAggregateCounts(missingPersistence)).resolves.toEqual({
      plans: "0",
      steps: "0",
      dependencies: "0",
    });

    const wrongCollisionPersistence = await createMigratedPGlitePersistence();
    const otherValues = await currencyPlanRepositoryValues();
    const { collision: wrongCollision } =
      await wrongCollisionPersistence.drizzle.transaction(
        transaction => ensurePlanPrerequisites(transaction, otherValues),
      );
    const wrongCollisionFailure =
      await wrongCollisionPersistence.drizzle.transaction(
        transaction => runEffectFailure(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            wrongCollision,
            values.plan,
          ),
        ),
      );
    expect(wrongCollisionFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePlan",
      reason: "referenceRefusal",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("reports committed sidecar loss without healing the aggregate", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const { collision } = await persistence.drizzle.transaction(
      async transaction => {
        const prerequisites = await ensurePlanPrerequisites(transaction, values);
        await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            prerequisites.collision,
            values.plan,
          ),
        );
        return prerequisites;
      },
    );
    const initialCounts = await planAggregateCounts(persistence);
    if (Number(initialCounts.dependencies) < 1) {
      throw new Error("Migration-plan fixture must contain a dependency");
    }
    await persistence.query(`
      delete from fx_system_framework_migration_plan_step_dependency
       where ctid in (
         select ctid
           from fx_system_framework_migration_plan_step_dependency
          limit 1
       )
    `);
    const corruptedCounts = await planAggregateCounts(persistence);
    expect(corruptedCounts).toEqual({
      ...initialCounts,
      dependencies: String(Number(initialCounts.dependencies) - 1),
    });

    const readFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          collision,
          values.plan,
        ),
      ),
    );
    expect(readFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPlan",
      reason: "storedCorruption",
    });

    const replayFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          collision,
          values.plan,
        ),
      ),
    );
    expect(replayFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePlan",
      reason: "storedCorruption",
    });
    await expect(planAggregateCounts(persistence)).resolves.toEqual(
      corruptedCounts,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("classifies a missing stored assignment as aggregate corruption on replay", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const { collision } = await persistence.drizzle.transaction(
      async transaction => {
        const prerequisites = await ensurePlanPrerequisites(transaction, values);
        await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            prerequisites.collision,
            values.plan,
          ),
        );
        return prerequisites;
      },
    );
    const initialAssignmentCount = await storedAssignmentCount(persistence);
    if (Number(initialAssignmentCount) < 1) {
      throw new Error("Migration-plan fixture must contain an assignment");
    }
    await persistence.query(`
      delete from fx_system_relational_physical_name_assignment
       where ctid in (
         select ctid
           from fx_system_relational_physical_name_assignment
          limit 1
       )
    `);
    const missingAssignmentCount = String(Number(initialAssignmentCount) - 1);
    await expect(storedAssignmentCount(persistence)).resolves.toBe(
      missingAssignmentCount,
    );

    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          collision,
          values.plan,
        ),
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePlan",
      reason: "storedCorruption",
    });
    await expect(storedAssignmentCount(persistence)).resolves.toBe(
      missingAssignmentCount,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("does not hide an orphan dependency sidecar", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const restored = await persistence.drizzle.transaction(
      async transaction => {
        const { collision } = await ensurePlanPrerequisites(transaction, values);
        const plan = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collision,
            values.plan,
          ),
        );
        return { collision, plan };
      },
    );
    const targetStep = values.plan.frame.steps[0];
    if (targetStep === undefined) {
      throw new Error("Migration-plan fixture must contain a step");
    }
    await persistence.query(`
      alter table fx_system_framework_migration_plan_step_dependency
        drop constraint fx_framework_migration_step_dependency_source_fk
    `);
    await persistence.drizzle.insert(
      fxSystemFrameworkMigrationPlanStepDependencies,
    ).values({
      planStorageId: restored.plan.storageId,
      sourceStepId: "step_ffffffffffffffffffffffffffffffff",
      dependencyOrdinal: 0,
      dependencyStepId: targetStep.stepId,
      dependencyStepSha256: await runEffect(
        Effect.fromResult(Encoding.decodeHex(targetStep.stepSha256)),
      ),
    });

    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          restored.collision,
          values.plan,
        ),
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPlan",
      reason: "storedCorruption",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("rejects corrupt or over-limit stored plan bytes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const restored = await persistence.drizzle.transaction(
      async transaction => {
        const { collision } = await ensurePlanPrerequisites(transaction, values);
        const plan = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            collision,
            values.plan,
          ),
        );
        return { collision, plan };
      },
    );

    const changedBytes = new TextEncoder().encode(values.plan.canonicalJson);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await persistence.drizzle.update(fxSystemFrameworkMigrationPlans).set({
      canonicalBytes: changedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationPlans.planStorageId,
      restored.plan.storageId,
    ));
    const corruptFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          restored.collision,
          values.plan,
        ),
      ),
    );
    expect(corruptFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPlan",
      reason: "storedCorruption",
    });

    await persistence.query(`
      alter table fx_system_framework_migration_plan
        drop constraint fx_framework_migration_plan_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await persistence.drizzle.update(fxSystemFrameworkMigrationPlans).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationPlans.planStorageId,
      restored.plan.storageId,
    ));
    const overLimitFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          restored.collision,
          values.plan,
        ),
      ),
    );
    expect(overLimitFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPlan",
      reason: "storedCorruption",
    });
  }, 60_000);

  it("projects a rejected driver read without retaining the transaction", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const { collision } = await persistence.drizzle.transaction(
      transaction => ensurePlanPrerequisites(transaction, values),
    );
    const driverCause = new Error("driver unavailable");
    const failure = await runEffectFailure(
      readFreshRelationalMigrationPlanInTransactionEffect(
        rejectingSelectTransaction(driverCause),
        collision,
        values.plan,
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPlan",
      reason: "resourceFailure",
      cause: driverCause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function freshPlanRepositoryValues() {
  const artifact = await syntheticSystemArtifact();
  return planRepositoryValues(artifact);
}

async function currencyPlanRepositoryValues() {
  const artifact = await currencyArtifact();
  return planRepositoryValues(artifact);
}

async function planRepositoryValues(
  artifact: Awaited<ReturnType<typeof syntheticSystemArtifact>>,
) {
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
  return { target, physicalLayout, plan };
}

async function ensurePlanParents(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
) {
  const target = await runEffect(
    ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
      transaction,
      values.target,
    ),
  );
  const collision = await runEffect(
    ensureFrameworkMigrationCollisionDomainInTransactionEffect(
      transaction,
      target,
      values.plan,
    ),
  );
  return { target, collision };
}

async function ensurePlanPrerequisites(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
) {
  const parents = await ensurePlanParents(transaction, values);
  for (const assignment of values.physicalLayout.nameAssignments) {
    await runEffect(
      ensureRelationalPhysicalNameAssignmentInTransactionEffect(
        transaction,
        parents.collision,
        assignment,
      ),
    );
  }
  return parents;
}

function expectedDependencies(
  plan: Awaited<ReturnType<typeof freshPlanRepositoryValues>>["plan"],
) {
  return plan.frame.steps.flatMap(step =>
    step.dependencies.map((dependency, dependencyOrdinal) => ({
      sourceStepId: step.stepId,
      dependencyOrdinal,
      dependencyStepId: dependency.stepId,
    }))
  );
}

async function planAggregateCounts(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const result = await persistence.query<{
    plans: string;
    steps: string;
    dependencies: string;
  }>(`
    select
      (select count(*)::text
         from fx_system_framework_migration_plan) as plans,
      (select count(*)::text
         from fx_system_framework_migration_plan_step) as steps,
      (select count(*)::text
         from fx_system_framework_migration_plan_step_dependency)
        as dependencies
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing plan aggregate count row");
  return row;
}

async function storedAssignmentCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ assignment_count: string }>(`
    select count(*)::text as assignment_count
      from fx_system_relational_physical_name_assignment
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing assignment count row");
  return row.assignment_count;
}

async function storedPlanOrdering(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const steps = await persistence.query<{ step_id: string }>(`
    select step_id
      from fx_system_framework_migration_plan_step
     order by step_ordinal
  `);
  const dependencies = await persistence.query<{
    source_step_id: string;
    dependency_ordinal: number;
    dependency_step_id: string;
  }>(`
    select dependency.source_step_id,
           dependency.dependency_ordinal,
           dependency.dependency_step_id
      from fx_system_framework_migration_plan_step_dependency dependency
      join fx_system_framework_migration_plan_step step
        on step.plan_storage_id = dependency.plan_storage_id
       and step.step_id = dependency.source_step_id
     order by step.step_ordinal, dependency.dependency_ordinal
  `);
  return {
    stepIds: steps.rows.map(row => row.step_id),
    dependencies: dependencies.rows.map(row => ({
      sourceStepId: row.source_step_id,
      dependencyOrdinal: row.dependency_ordinal,
      dependencyStepId: row.dependency_step_id,
    })),
  };
}

function rejectingSelectTransaction(
  cause: unknown,
): FlarexMetadataTransaction {
  const transaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.reject(cause),
        }),
      }),
    }),
  };
  return transaction as unknown as FlarexMetadataTransaction;
}

import { eq, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
  readRelationalPhysicalNameAssignmentInTransactionEffect,
  resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect,
  restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect,
} from "../src/migrationCoordination/physicalNameAssignmentRepository";
import {
  fxSystemRelationalPhysicalNameAssignments,
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

describe("framework coordinator physical-name assignment repository", () => {
  it("keeps transaction kernels source-private", async () => {
    expect(
      "ensureRelationalPhysicalNameAssignmentInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readRelationalPhysicalNameAssignmentInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/physicalNameAssignmentRepository.ts",
    );
  });

  it("ensures, reads, and exactly replays ordinary assignments", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const result = await persistence.drizzle.transaction(async transaction => {
      const { collision } = await ensureParents(transaction, values);
      const missing = await runEffect(
        readRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.firstAssignment,
        ),
      );
      expect(Option.isNone(missing)).toBe(true);

      const first = await runEffect(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.firstAssignment,
        ),
      );
      const replayedFirst = await runEffect(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.firstAssignment,
        ),
      );
      const readFirst = Option.getOrThrow(await runEffect(
        readRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.firstAssignment,
        ),
      ));
      expect(replayedFirst.storageId).toBe(first.storageId);
      expect(readFirst).toEqual(first);

      const second = await runEffect(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.secondAssignment,
        ),
      );
      const readSecond = Option.getOrThrow(await runEffect(
        readRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.secondAssignment,
        ),
      ));
      expect(readSecond).toEqual(second);
      return { first, second };
    });

    expect(result.first.assignment).toEqual(values.firstAssignment);
    expect(result.second.assignment).toEqual(values.secondAssignment);
    expect(result.first.storageId).not.toBe(result.second.storageId);
    await expect(assignmentCount(persistence)).resolves.toBe("2");
  });

  it("converges duplicate exact ensures and rolls back with its caller", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const { collision } = await persistence.drizzle.transaction(
      transaction => ensureParents(transaction, values),
    );
    const ensured = await Promise.all([
      persistence.drizzle.transaction(transaction => runEffect(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.firstAssignment,
        ),
      )),
      persistence.drizzle.transaction(transaction => runEffect(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          collision,
          values.firstAssignment,
        ),
      )),
    ]);
    expect(ensured[0]?.storageId).toBe(ensured[1]?.storageId);
    await expect(assignmentCount(persistence)).resolves.toBe("1");

    const rollbackPersistence = await createMigratedPGlitePersistence();
    const rollbackParents = await rollbackPersistence.drizzle.transaction(
      transaction => ensureParents(transaction, values),
    );
    const deliberateRollback = new Error("deliberate rollback");
    await expect(rollbackPersistence.drizzle.transaction(
      async transaction => {
        await runEffect(
          ensureRelationalPhysicalNameAssignmentInTransactionEffect(
            transaction,
            rollbackParents.collision,
            values.firstAssignment,
          ),
        );
        throw deliberateRollback;
      },
    )).rejects.toBe(deliberateRollback);
    await expect(assignmentCount(rollbackPersistence)).resolves.toBe("0");
  });

  it("resolves authenticated occupants in digest-first order", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const restored = await persistence.drizzle.transaction(
      async transaction => {
        const { collision } = await ensureParents(transaction, values);
        const first = await runEffect(
          ensureRelationalPhysicalNameAssignmentInTransactionEffect(
            transaction,
            collision,
            values.firstAssignment,
          ),
        );
        const second = await runEffect(
          ensureRelationalPhysicalNameAssignmentInTransactionEffect(
            transaction,
            collision,
            values.secondAssignment,
          ),
        );
        return { collision, first, second };
      },
    );

    let spellingReads = 0;
    const digestFailure = await runEffectFailure(
      resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect(
        restored.collision,
        values.firstAssignment,
        "readPhysicalNameAssignment",
        {
          readByDigest: () => Effect.succeed(Option.some(restored.second)),
          readBySpelling: () => {
            spellingReads += 1;
            return Effect.succeed(Option.some(restored.first));
          },
        },
      ),
    );
    expect(digestFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPhysicalNameAssignment",
      reason: "immutableConflict",
    });
    expect(spellingReads).toBe(0);

    const spellingFailure = await runEffectFailure(
      resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect(
        restored.collision,
        values.firstAssignment,
        "readPhysicalNameAssignment",
        {
          readByDigest: () => Effect.succeed(Option.none()),
          // This trusted lookup seam represents the result of the global
          // spelling index without requiring a realizable SHA-256 collision.
          readBySpelling: () => Effect.succeed(Option.some(restored.second)),
        },
      ),
    );
    expect(spellingFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPhysicalNameAssignment",
      reason: "physicalNameCollision",
      spelling: values.firstAssignment.frame.spelling,
    });
  });

  it("rehydrates a historical occupant through its actual collision lane", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const historicalValues = await currencyAssignmentRepositoryValues();
    const restored = await persistence.drizzle.transaction(
      async transaction => {
        const incoming = await ensureParents(transaction, values);
        const historical = await ensureParents(transaction, historicalValues);
        const assignment = await runEffect(
          ensureRelationalPhysicalNameAssignmentInTransactionEffect(
            transaction,
            historical.collision,
            historicalValues.firstAssignment,
          ),
        );
        return { incoming, historical, assignment };
      },
    );
    const rows = await persistence.drizzle.select({
      assignmentStorageId:
        fxSystemRelationalPhysicalNameAssignments.assignmentStorageId,
      collisionStorageId:
        fxSystemRelationalPhysicalNameAssignments.collisionStorageId,
      physicalDatabaseIdentity:
        fxSystemRelationalPhysicalNameAssignments.physicalDatabaseIdentity,
      schemaName: fxSystemRelationalPhysicalNameAssignments.schemaName,
      spelling: fxSystemRelationalPhysicalNameAssignments.spelling,
      nameSha256: fxSystemRelationalPhysicalNameAssignments.nameSha256,
      assignmentSha256:
        fxSystemRelationalPhysicalNameAssignments.assignmentSha256,
      frameFormat: fxSystemRelationalPhysicalNameAssignments.frameFormat,
      frameVersion: fxSystemRelationalPhysicalNameAssignments.frameVersion,
      canonicalByteLength:
        fxSystemRelationalPhysicalNameAssignments.canonicalByteLength,
      observedCanonicalByteLength: sql<number>`
        octet_length(
          ${fxSystemRelationalPhysicalNameAssignments.canonicalBytes}
        )
      `,
      canonicalBytes: fxSystemRelationalPhysicalNameAssignments.canonicalBytes,
    }).from(fxSystemRelationalPhysicalNameAssignments).where(eq(
      fxSystemRelationalPhysicalNameAssignments.assignmentStorageId,
      restored.assignment.storageId,
    )).limit(1);
    const row = rows[0];
    if (row === undefined) throw new Error("Missing historical assignment row");

    const rehydrated = await persistence.drizzle.transaction(
      transaction => runEffect(
        restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect(
          transaction,
          row,
          restored.incoming.collision,
          "readPhysicalNameAssignment",
        ),
      ),
    );
    expect(rehydrated).toEqual(restored.assignment);
    expect(rehydrated.collision.storageId).toBe(
      restored.historical.collision.storageId,
    );
    expect(rehydrated.collision.storageId).not.toBe(
      restored.incoming.collision.storageId,
    );
  });

  it("refuses forged, cross-coordinate, and cross-database references", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const parents = await persistence.drizzle.transaction(
      transaction => ensureParents(transaction, values),
    );

    const forgedFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          { ...parents.collision },
          values.firstAssignment,
        ),
      ),
    );
    expect(forgedFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePhysicalNameAssignment",
      reason: "referenceRefusal",
    });

    const crossCoordinateAssignment = await currencyAssignment(values.target);
    const crossCoordinateFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          parents.collision,
          crossCoordinateAssignment,
        ),
      ),
    );
    expect(crossCoordinateFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPhysicalNameAssignment",
      reason: "referenceRefusal",
    });

    const inconsistentAssignmentFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          parents.collision,
          {
            ...values.firstAssignment,
            canonicalJson: `${values.firstAssignment.canonicalJson} `,
          },
        ),
      ),
    );
    expect(inconsistentAssignmentFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePhysicalNameAssignment",
      reason: "referenceRefusal",
    });

    const otherPersistence = await createMigratedPGlitePersistence();
    const missingParentFailure = await otherPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          parents.collision,
          values.firstAssignment,
        ),
      ),
    );
    expect(missingParentFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensurePhysicalNameAssignment",
      reason: "referenceRefusal",
    });
  });

  it("rejects corrupt or over-limit stored assignment bytes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const parents = await persistence.drizzle.transaction(
      transaction => ensureParents(transaction, values),
    );
    await persistence.drizzle.transaction(transaction => runEffect(
      ensureRelationalPhysicalNameAssignmentInTransactionEffect(
        transaction,
        parents.collision,
        values.firstAssignment,
      ),
    ));

    const changedBytes = new TextEncoder().encode(
      values.firstAssignment.canonicalJson,
    );
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await persistence.drizzle.update(
      fxSystemRelationalPhysicalNameAssignments,
    ).set({ canonicalBytes: changedBytes });
    const corruptFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          parents.collision,
          values.firstAssignment,
        ),
      ),
    );
    expect(corruptFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPhysicalNameAssignment",
      reason: "storedCorruption",
    });

    await persistence.query(`
      alter table fx_system_relational_physical_name_assignment
        drop constraint fx_relational_name_assignment_frame_check
    `);
    const oversizedBytes = new Uint8Array(20_481).fill(0x20);
    await persistence.drizzle.update(
      fxSystemRelationalPhysicalNameAssignments,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    });
    const overLimitFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readRelationalPhysicalNameAssignmentInTransactionEffect(
          transaction,
          parents.collision,
          values.firstAssignment,
        ),
      ),
    );
    expect(overLimitFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPhysicalNameAssignment",
      reason: "storedCorruption",
    });
  });

  it("projects a rejected driver statement without retaining the transaction", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshAssignmentRepositoryValues();
    const { collision } = await persistence.drizzle.transaction(
      transaction => ensureParents(transaction, values),
    );
    const driverCause = new Error("driver unavailable");
    const failure = await runEffectFailure(
      readRelationalPhysicalNameAssignmentInTransactionEffect(
        rejectingSelectTransaction(driverCause),
        collision,
        values.firstAssignment,
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readPhysicalNameAssignment",
      reason: "resourceFailure",
      cause: driverCause,
    });
  });
});

async function freshAssignmentRepositoryValues() {
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
  const firstAssignment = requiredAssignment(physicalLayout.nameAssignments, 0);
  const secondAssignment = requiredAssignment(
    physicalLayout.nameAssignments,
    1,
  );
  return { target, plan, firstAssignment, secondAssignment };
}

async function currencyAssignment(
  target: Awaited<ReturnType<typeof frameworkTargetNamespace>>,
) {
  const artifact = await currencyArtifact();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: target,
  }));
  return requiredAssignment(physicalLayout.nameAssignments, 0);
}

async function currencyAssignmentRepositoryValues() {
  const artifact = await currencyArtifact();
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
  const firstAssignment = requiredAssignment(
    physicalLayout.nameAssignments,
    0,
  );
  return { target, plan, firstAssignment };
}

async function ensureParents(
  transaction: FlarexMetadataTransaction,
  values: Pick<
    Awaited<ReturnType<typeof freshAssignmentRepositoryValues>>,
    "target" | "plan"
  >,
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

function requiredAssignment<Assignment>(
  assignments: readonly Assignment[],
  index: number,
): Assignment {
  const assignment = assignments[index];
  if (assignment === undefined) {
    throw new Error(`Missing physical-name assignment at index ${index}`);
  }
  return assignment;
}

async function assignmentCount(
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

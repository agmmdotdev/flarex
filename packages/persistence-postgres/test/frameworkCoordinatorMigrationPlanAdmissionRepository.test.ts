import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { eq } from "drizzle-orm";
import { Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationPlanAdmission,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
  readFrameworkMigrationPlanAdmissionInTransactionEffect,
  resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect,
} from "../src/migrationCoordination/migrationPlanAdmissionRepository";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
} from "../src/migrationCoordination/physicalNameAssignmentRepository";
import {
  fxSystemFrameworkMigrationAdmissionAssignments,
  fxSystemFrameworkMigrationPlanAdmissions,
} from "../src/migrationCoordination/schema";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import type { RestoredFrameworkMigrationCollisionDomain } from
  "../src/migrationCoordination/storedRestoration";
import { captureRelationalSchemaArtifact } from
  "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
  syntheticSchemaInput,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 30_000;
const FIRST_ADMITTED_AT = "2026-08-27T08:30:00.000Z";
const SECOND_ADMITTED_AT = "2026-08-27T08:31:00.000Z";

describe("framework coordinator migration-plan admission repository", () => {
  it("keeps transaction kernels source-private", async () => {
    expect(
      "ensureFrameworkMigrationPlanAdmissionInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkMigrationPlanAdmissionInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect" in
        persistenceRoot,
    ).toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/migrationPlanAdmissionRepository.ts",
    );
  });

  it("ensures, reads, and exactly replays an ordered admission aggregate", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const restored = await persistence.drizzle.transaction(
      async transaction => {
        const plan = await ensureStoredPlan(transaction, values);
        const admission = await captureAdmission(
          plan,
          null,
          FIRST_ADMITTED_AT,
        );
        const missing = await runEffect(
          readFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);

        const first = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        );
        const replayed = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        ));
        expect(replayed.storageId).toBe(first.storageId);
        expect(read).toEqual(first);
        return { admission, first };
      },
    );

    expect(restored.first.admission).toEqual(restored.admission);
    expect(restored.first.admission).not.toBe(restored.admission);
    await expect(admissionAggregateCounts(persistence)).resolves.toEqual({
      admissions: "1",
      assignments: String(restored.admission.frame.nameAssignments.length),
    });
    await expect(storedAdmissionAssignmentOrdering(persistence)).resolves
      .toEqual(restored.admission.frame.nameAssignments.map(
        (assignment, assignmentOrdinal) => ({
          assignmentOrdinal,
          spelling: assignment.spelling,
          assignmentSha256: assignment.assignmentSha256,
        }),
      ));
  }, PGLITE_TEST_TIMEOUT);

  it("restores an optional previous plan from the same collision domain", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const previousValues = await freshPlanRepositoryValues();
    const currentValues = await nextFreshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const previousPlan = await ensureStoredPlan(
          transaction,
          previousValues,
        );
        await ensureAssignments(
          transaction,
          previousPlan.collision,
          currentValues,
        );
        const currentPlan = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            previousPlan.collision,
            currentValues.plan,
          ),
        );
        const admission = await captureAdmission(
          currentPlan,
          previousPlan,
          FIRST_ADMITTED_AT,
        );
        const ensured = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            currentPlan,
            previousPlan,
            admission,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            currentPlan,
            previousPlan,
            admission,
          ),
        ));
        expect(read).toEqual(ensured);
        return { admission, currentPlan, previousPlan };
      },
    );

    const rows = await persistence.drizzle.select({
      previousPlanStorageId:
        fxSystemFrameworkMigrationPlanAdmissions.previousPlanStorageId,
      previousPlanSha256:
        fxSystemFrameworkMigrationPlanAdmissions.previousPlanSha256,
    }).from(fxSystemFrameworkMigrationPlanAdmissions);
    const row = rows[0];
    if (row === undefined || row.previousPlanSha256 === null) {
      throw new Error("Missing stored previous-plan projections");
    }
    expect(rows).toHaveLength(1);
    expect(row.previousPlanStorageId).toBe(stored.previousPlan.storageId);
    expect(Encoding.encodeHex(row.previousPlanSha256)).toBe(
      stored.previousPlan.plan.migrationPlanSha256,
    );
    expect(stored.admission.frame.planSha256).toBe(
      stored.currentPlan.plan.migrationPlanSha256,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("replays duplicate ensures from separate caller transactions", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const plan = await persistence.drizzle.transaction(
      transaction => ensureStoredPlan(transaction, values),
    );
    const admission = await captureAdmission(
      plan,
      null,
      FIRST_ADMITTED_AT,
    );

    const ensured = await Promise.all([
      persistence.drizzle.transaction(transaction => runEffect(
        ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          plan,
          null,
          admission,
        ),
      )),
      persistence.drizzle.transaction(transaction => runEffect(
        ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          plan,
          null,
          admission,
        ),
      )),
    ]);

    expect(ensured[0]?.storageId).toBe(ensured[1]?.storageId);
    await expect(admissionAggregateCounts(persistence)).resolves.toEqual({
      admissions: "1",
      assignments: String(admission.frame.nameAssignments.length),
    });
  }, PGLITE_TEST_TIMEOUT);

  it("fully reloads the stored occupant after losing an immutable insert", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const plan = await ensureStoredPlan(transaction, values);
        const admission = await captureAdmission(
          plan,
          null,
          FIRST_ADMITTED_AT,
        );
        const occupant = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        );
        return { admission, occupant, plan };
      },
    );

    const replayed = await persistence.drizzle.transaction(
      async transaction => {
        const simulatedRace = hideFirstAdmissionRootRead(transaction);
        const result = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            simulatedRace.transaction,
            stored.plan,
            null,
            stored.admission,
          ),
        );
        expect(simulatedRace.hiddenReadCount()).toBe(1);
        return result;
      },
    );

    expect(replayed).toEqual(stored.occupant);
    await expect(admissionAggregateCounts(persistence)).resolves.toEqual({
      admissions: "1",
      assignments: String(stored.admission.frame.nameAssignments.length),
    });
  }, PGLITE_TEST_TIMEOUT);

  it("refuses forged, missing, and wrong previous-plan references", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const previousValues = await freshPlanRepositoryValues();
    const currentValues = await nextFreshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const previousPlan = await ensureStoredPlan(
          transaction,
          previousValues,
        );
        await ensureAssignments(
          transaction,
          previousPlan.collision,
          currentValues,
        );
        const currentPlan = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            previousPlan.collision,
            currentValues.plan,
          ),
        );
        const admission = await captureAdmission(
          currentPlan,
          previousPlan,
          FIRST_ADMITTED_AT,
        );
        return { admission, currentPlan, previousPlan };
      },
    );
    const forgedAdmission = Object.freeze({ ...stored.admission });

    const forgedFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.currentPlan,
          stored.previousPlan,
          forgedAdmission,
        ),
      ),
    );
    expect(forgedFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensureAdmission",
      reason: "referenceRefusal",
    });

    const wrongPreviousFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.currentPlan,
          null,
          stored.admission,
        ),
      ),
    );
    expect(wrongPreviousFailure).toMatchObject({
      operation: "ensureAdmission",
      reason: "referenceRefusal",
    });
    const mismatchedPreviousFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.currentPlan,
          stored.currentPlan,
          stored.admission,
        ),
      ),
    );
    expect(mismatchedPreviousFailure).toMatchObject({
      operation: "ensureAdmission",
      reason: "referenceRefusal",
    });

    const missingPersistence = await createMigratedPGlitePersistence();
    const missingPlanFailure = await missingPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.currentPlan,
          stored.previousPlan,
          stored.admission,
        ),
      ),
    );
    expect(missingPlanFailure).toMatchObject({
      operation: "readAdmission",
      reason: "referenceRefusal",
    });
    await expect(admissionAggregateCounts(persistence)).resolves.toEqual({
      admissions: "0",
      assignments: "0",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("classifies a mismatched authentic admission occupant as immutable conflict", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const plan = await ensureStoredPlan(transaction, values);
        const firstAdmission = await captureAdmission(
          plan,
          null,
          FIRST_ADMITTED_AT,
        );
        const occupant = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            firstAdmission,
          ),
        );
        const secondAdmission = await captureAdmission(
          plan,
          null,
          SECOND_ADMITTED_AT,
        );
        return { occupant, plan, secondAdmission };
      },
    );

    const failure = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect(
        Option.some(stored.occupant),
        stored.plan,
        stored.secondAdmission,
        "readAdmission",
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readAdmission",
      reason: "immutableConflict",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("reports committed sidecar loss without healing and rolls back with its caller", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const plan = await ensureStoredPlan(transaction, values);
        const admission = await captureAdmission(
          plan,
          null,
          FIRST_ADMITTED_AT,
        );
        await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        );
        return { admission, plan };
      },
    );
    const initialCounts = await admissionAggregateCounts(persistence);
    if (Number(initialCounts.assignments) < 1) {
      throw new Error("Admission fixture must contain an assignment");
    }
    await persistence.query(`
      delete from fx_system_framework_migration_admission_assignment
       where ctid in (
         select ctid
           from fx_system_framework_migration_admission_assignment
          limit 1
       )
    `);
    const corruptedCounts = await admissionAggregateCounts(persistence);

    const readFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.plan,
          null,
          stored.admission,
        ),
      ),
    );
    expect(readFailure).toMatchObject({
      operation: "readAdmission",
      reason: "storedCorruption",
    });
    const replayFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.plan,
          null,
          stored.admission,
        ),
      ),
    );
    expect(replayFailure).toMatchObject({
      operation: "ensureAdmission",
      reason: "storedCorruption",
    });
    await expect(admissionAggregateCounts(persistence)).resolves.toEqual(
      corruptedCounts,
    );

    const rollbackPersistence = await createMigratedPGlitePersistence();
    const rollbackValues = await freshPlanRepositoryValues();
    const rollbackPlan = await rollbackPersistence.drizzle.transaction(
      transaction => ensureStoredPlan(transaction, rollbackValues),
    );
    const rollbackAdmission = await captureAdmission(
      rollbackPlan,
      null,
      FIRST_ADMITTED_AT,
    );
    const deliberateRollback = new Error("deliberate admission rollback");
    await expect(rollbackPersistence.drizzle.transaction(
      async transaction => {
        await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            rollbackPlan,
            null,
            rollbackAdmission,
          ),
        );
        throw deliberateRollback;
      },
    )).rejects.toBe(deliberateRollback);
    await expect(admissionAggregateCounts(rollbackPersistence)).resolves
      .toEqual({ admissions: "0", assignments: "0" });
  }, PGLITE_TEST_TIMEOUT);

  it("rejects corrupt or over-limit stored admission bytes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const plan = await ensureStoredPlan(transaction, values);
        const admission = await captureAdmission(
          plan,
          null,
          FIRST_ADMITTED_AT,
        );
        const restored = await runEffect(
          ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            plan,
            null,
            admission,
          ),
        );
        return { admission, plan, restored };
      },
    );
    const changedBytes = new TextEncoder().encode(
      stored.admission.canonicalJson,
    );
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationPlanAdmissions,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
      stored.restored.storageId,
    ));
    const corruptFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.plan,
          null,
          stored.admission,
        ),
      ),
    );
    expect(corruptFailure).toMatchObject({
      operation: "readAdmission",
      reason: "storedCorruption",
    });

    await persistence.query(`
      alter table fx_system_framework_migration_plan_admission
        drop constraint fx_framework_migration_admission_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationPlanAdmissions,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
      stored.restored.storageId,
    ));
    const overLimitFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationPlanAdmissionInTransactionEffect(
          transaction,
          stored.plan,
          null,
          stored.admission,
        ),
      ),
    );
    expect(overLimitFailure).toMatchObject({
      operation: "readAdmission",
      reason: "storedCorruption",
    });
  }, 60_000);

  it("projects a rejected driver read without retaining the transaction", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const plan = await persistence.drizzle.transaction(
      transaction => ensureStoredPlan(transaction, values),
    );
    const admission = await captureAdmission(
      plan,
      null,
      FIRST_ADMITTED_AT,
    );
    const driverCause = new Error("admission driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationPlanAdmissionInTransactionEffect(
          rejectingSelectTransaction(transaction, driverCause),
          plan,
          null,
          admission,
        ),
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readAdmission",
      reason: "resourceFailure",
      cause: driverCause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function freshPlanRepositoryValues() {
  return planRepositoryValues(await syntheticSystemArtifact());
}

async function nextFreshPlanRepositoryValues() {
  const artifact = await runEffect(captureRelationalSchemaArtifact({
    deploymentId: "deployment-a",
    provenance: {
      kind: "synthetic",
      fixtureId: "relational-system-next",
    },
    schema: syntheticSchemaInput(),
  }));
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

async function ensureStoredPlan(
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
  await ensureAssignments(transaction, collision, values);
  return runEffect(ensureFreshRelationalMigrationPlanInTransactionEffect(
    transaction,
    collision,
    values.plan,
  ));
}

async function ensureAssignments(
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
) {
  for (const assignment of values.physicalLayout.nameAssignments) {
    await runEffect(
      ensureRelationalPhysicalNameAssignmentInTransactionEffect(
        transaction,
        collision,
        assignment,
      ),
    );
  }
}

async function captureAdmission(
  plan: Awaited<ReturnType<typeof ensureStoredPlan>>,
  previousPlan: Awaited<ReturnType<typeof ensureStoredPlan>> | null,
  admittedAt: string,
) {
  return runEffect(captureFrameworkMigrationPlanAdmission({
    plan: plan.plan,
    nameAssignments: plan.plan.physicalLayout.nameAssignments,
    previousPlanSha256:
      previousPlan === null ? null : previousPlan.plan.migrationPlanSha256,
    admittedAt,
  }));
}

async function admissionAggregateCounts(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const result = await persistence.query<{
    admissions: string;
    assignments: string;
  }>(`
    select
      (select count(*)::text
         from fx_system_framework_migration_plan_admission) as admissions,
      (select count(*)::text
         from fx_system_framework_migration_admission_assignment)
        as assignments
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing admission count row");
  return row;
}

async function storedAdmissionAssignmentOrdering(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select({
    assignmentOrdinal:
      fxSystemFrameworkMigrationAdmissionAssignments.assignmentOrdinal,
    spelling: fxSystemFrameworkMigrationAdmissionAssignments.spelling,
    assignmentSha256:
      fxSystemFrameworkMigrationAdmissionAssignments.assignmentSha256,
  }).from(fxSystemFrameworkMigrationAdmissionAssignments).orderBy(
    fxSystemFrameworkMigrationAdmissionAssignments.assignmentOrdinal,
  );
  return rows.map(row => ({
    assignmentOrdinal: row.assignmentOrdinal,
    spelling: row.spelling,
    assignmentSha256: Encoding.encodeHex(row.assignmentSha256),
  }));
}

function rejectingSelectTransaction(
  transaction: FlarexMetadataTransaction,
  cause: unknown,
): FlarexMetadataTransaction {
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === "select") {
        return () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.reject(cause),
            }),
          }),
        });
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function hideFirstAdmissionRootRead(
  transaction: FlarexMetadataTransaction,
): Readonly<{
  readonly transaction: FlarexMetadataTransaction;
  readonly hiddenReadCount: () => number;
}> {
  let hiddenReadCount = 0;

  function hideAtLimit(input: UnknownRecord): UnknownRecord {
    return new Proxy(input, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        if (property === "limit") {
          return () => {
            hiddenReadCount += 1;
            return Promise.resolve([]);
          };
        }
        return (...args: unknown[]) => {
          const next = Reflect.apply(member, target, args);
          if (!isNonArrayRecord(next)) {
            throw new TypeError("Admission read builder must remain an object");
          }
          return hideAtLimit(next);
        };
      },
    });
  }

  return Object.freeze({
    transaction: new Proxy(transaction, {
      get(target, property, receiver) {
        if (property !== "select") {
          return Reflect.get(target, property, receiver);
        }
        const select = Reflect.get(target, property, receiver);
        if (typeof select !== "function") return select;
        return (...args: unknown[]) => {
          const query = Reflect.apply(select, target, args);
          if (hiddenReadCount === 0 && isAdmissionRootSelection(args[0])) {
            if (!isNonArrayRecord(query)) {
              throw new TypeError("Admission select must return a query object");
            }
            return hideAtLimit(query);
          }
          return query;
        };
      },
    }),
    hiddenReadCount: () => hiddenReadCount,
  });
}

function isAdmissionRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "admissionStorageId") &&
    Object.hasOwn(input, "admissionProfile") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}

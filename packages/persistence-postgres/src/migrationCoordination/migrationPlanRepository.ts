import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  capturePrivateCanonicalValue,
} from "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  classifyRelationalPhysicalNameAssignmentReplay,
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
} from "../relationalSchema/physical/canonical";
import type {
  RelationalPhysicalNameAssignmentFrame,
} from "../relationalSchema/physical/model";
import {
  classifyFrameworkMigrationPlanReplay,
  isCapturedFreshRelationalMigrationPlan,
  MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationPlanSha256 } from "./identity";
import type {
  FrameworkMigrationCollisionCoordinate,
  FrameworkMigrationStep,
  FreshRelationalMigrationPlan,
  FreshRelationalMigrationPlanFrame,
  RelationalStructuralOperation,
} from "./model";
import {
  FRAMEWORK_MIGRATION_PLAN_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_VERSION,
} from "./model";
import {
  readRelationalPhysicalNameAssignmentOccupantsBySpellingInTransactionEffect,
} from "./physicalNameAssignmentRepository";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import {
  fxSystemFrameworkMigrationPlans,
  fxSystemFrameworkMigrationPlanStepDependencies,
  fxSystemFrameworkMigrationPlanSteps,
} from "./schema";
import {
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFreshRelationalMigrationPlan,
  restoreStoredFreshRelationalMigrationPlan,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFreshRelationalMigrationPlan,
  type RestoredRelationalPhysicalNameAssignment,
  type StoredFrameworkMigrationPlanRow,
  type StoredFrameworkMigrationPlanStepDependencyRow,
  type StoredFrameworkMigrationPlanStepRow,
} from "./storedRestoration";
import {
  isStoredFreshRelationalMigrationPlanFrame,
} from "./storedValidation";
import {
  readFrameworkMigrationCollisionDomainForOperationInTransactionEffect,
  readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect,
} from "./targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";

type MigrationPlanRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensurePlan" | "readPlan"
>;

type MigrationPlanAggregateRepositoryOperation =
  FrameworkMigrationRepositoryOperation;

const PLAN_SIDECAR_INSERT_BATCH_SIZE = 256;

interface PreparedMigrationPlanStep {
  readonly stepOrdinal: number;
  readonly stepId: string;
  readonly stepSha256: Uint8Array;
  readonly preconditionSha256: Uint8Array;
  readonly postconditionSha256: Uint8Array;
  readonly phase: FrameworkMigrationStep["phase"];
  readonly operationFormat: RelationalStructuralOperation["codec"]["format"];
  readonly operationVersion: RelationalStructuralOperation["codec"]["version"];
  readonly dependencyCount: number;
}

interface PreparedMigrationPlanDependency {
  readonly sourceStepId: string;
  readonly dependencyOrdinal: number;
  readonly dependencyStepId: string;
  readonly dependencyStepSha256: Uint8Array;
}

interface PreparedMigrationPlan {
  readonly plan: FreshRelationalMigrationPlan;
  readonly migrationPlanSha256Bytes: Uint8Array;
  readonly artifactSha256Bytes: Uint8Array;
  readonly requiredStepSetSha256Bytes: Uint8Array;
  readonly physicalLayoutSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
  readonly steps: readonly PreparedMigrationPlanStep[];
  readonly dependencies: readonly PreparedMigrationPlanDependency[];
}

interface MigrationPlanDriverRow extends StoredFrameworkMigrationPlanRow {
  readonly planStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly artifactSha256: Uint8Array;
  readonly locatorKind: FreshRelationalMigrationPlanFrame["physicalLocator"]["kind"];
  readonly locatorDatabaseKey: string;
  readonly locatorSchemaName: string;
  readonly migrationPlanSha256: Uint8Array;
  readonly requiredStepSetSha256: Uint8Array;
  readonly physicalLayoutSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_PLAN_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_PLAN_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface MigrationPlanStepDriverRow
  extends StoredFrameworkMigrationPlanStepRow {
  readonly planStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly stepOrdinal: number;
  readonly stepId: string;
  readonly stepSha256: Uint8Array;
  readonly preconditionSha256: Uint8Array;
  readonly postconditionSha256: Uint8Array;
  readonly phase: FrameworkMigrationStep["phase"];
  readonly operationFormat: RelationalStructuralOperation["codec"]["format"];
  readonly operationVersion: RelationalStructuralOperation["codec"]["version"];
  readonly dependencyCount: number;
}

interface MigrationPlanDependencyDriverRow
  extends StoredFrameworkMigrationPlanStepDependencyRow {
  readonly planStorageId: bigint;
  readonly sourceStepId: string;
  readonly dependencyOrdinal: number;
  readonly dependencyStepId: string;
  readonly dependencyStepSha256: Uint8Array;
}

interface DecodedMigrationPlanRoot {
  readonly storageId: bigint;
  readonly frame: FreshRelationalMigrationPlanFrame;
  readonly canonicalJson: string;
}

interface PreferredMigrationPlanDependencies {
  readonly canonicalJson: string;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly assignments: readonly RestoredRelationalPhysicalNameAssignment[];
}

export const ensureFreshRelationalMigrationPlanInTransactionEffect = Effect.fn(
  "FrameworkMigrationPlanRepository.ensure",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  input: FreshRelationalMigrationPlan,
): Effect.fn.Return<
  RestoredFreshRelationalMigrationPlan,
  FrameworkMigrationRepositoryError
> {
  const operation = "ensurePlan" as const;
  const prepared = yield* prepareExpectedPlan(input, operation);
  const storedCollision = yield* requireStoredPlanCollision(
    transaction,
    collision,
    prepared.plan,
    operation,
  );
  const existingRow = yield* loadPlanRootByDigest(
    transaction,
    prepared.migrationPlanSha256Bytes,
    operation,
  );
  if (Option.isSome(existingRow)) {
    const existing = yield* restorePlanOccupant(
      transaction,
      existingRow.value,
      storedCollision,
      operation,
    );
    const resolved = yield*
      resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect(
        Option.some(existing),
        storedCollision,
        prepared.plan,
        operation,
      );
    if (Option.isNone(resolved)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return resolved.value;
  }
  const assignments = yield*
    readFreshRelationalMigrationPlanAssignmentsForOperationInTransactionEffect(
      transaction,
      storedCollision,
      prepared.plan.frame.physicalLayout.nameAssignments,
      "prerequisite",
      operation,
    );

  const insertedRows = yield* runRepositoryStatement(
    operation,
    transaction.insert(fxSystemFrameworkMigrationPlans).values({
      collisionStorageId: storedCollision.storageId,
      artifactSha256: prepared.artifactSha256Bytes,
      locatorKind: prepared.plan.frame.physicalLocator.kind,
      locatorDatabaseKey: prepared.plan.frame.physicalLocator.databaseKey,
      locatorSchemaName: prepared.plan.frame.physicalLocator.schemaName,
      migrationPlanSha256: prepared.migrationPlanSha256Bytes,
      requiredStepSetSha256: prepared.requiredStepSetSha256Bytes,
      physicalLayoutSha256: prepared.physicalLayoutSha256Bytes,
      frameFormat: prepared.plan.frame.format,
      frameVersion: prepared.plan.frame.version,
      canonicalByteLength: prepared.canonicalBytes.byteLength,
      canonicalBytes: prepared.canonicalBytes,
    }).onConflictDoNothing().returning({
      planStorageId: fxSystemFrameworkMigrationPlans.planStorageId,
    }),
  ).pipe(Effect.map(detachDriverRows));
  if (insertedRows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const inserted = insertedRows[0];
  if (inserted !== undefined) {
    const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
      inserted.planStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ));
    yield* insertPlanSidecars(
      transaction,
      storageId,
      storedCollision.storageId,
      prepared,
      operation,
    );
  }

  const row = yield* loadPlanRootByDigest(
    transaction,
    prepared.migrationPlanSha256Bytes,
    operation,
  );
  if (Option.isNone(row)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const occupant = yield* restorePlanOccupant(
    transaction,
    row.value,
    storedCollision,
    operation,
    {
      canonicalJson: prepared.plan.canonicalJson,
      collision: storedCollision,
      assignments,
    },
  );
  const resolved = yield*
    resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect(
      Option.some(occupant),
      storedCollision,
      prepared.plan,
      operation,
    );
  if (Option.isNone(resolved)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return resolved.value;
});

export const readFreshRelationalMigrationPlanInTransactionEffect = Effect.fn(
  "FrameworkMigrationPlanRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  input: FreshRelationalMigrationPlan,
): Effect.fn.Return<
  Option.Option<RestoredFreshRelationalMigrationPlan>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readPlan" as const;
  const prepared = yield* prepareExpectedPlan(input, operation);
  const storedCollision = yield* requireStoredPlanCollision(
    transaction,
    collision,
    prepared.plan,
    operation,
  );
  const row = yield* loadPlanRootByDigest(
    transaction,
    prepared.migrationPlanSha256Bytes,
    operation,
  );
  if (Option.isNone(row)) return Option.none();
  const occupant = yield* restorePlanOccupant(
    transaction,
    row.value,
    storedCollision,
    operation,
  );
  return yield* resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect(
    Option.some(occupant),
    storedCollision,
    prepared.plan,
    operation,
  );
});

/** Source-private collision-policy seam for an authenticated digest occupant. */
const resolveAuthenticatedFreshRelationalMigrationPlanOccupantForOperationEffect =
  Effect.fn(
    "FrameworkMigrationPlanRepository.resolveOccupantForOperation",
  )(function* (
    occupant: Option.Option<RestoredFreshRelationalMigrationPlan>,
    collision: RestoredFrameworkMigrationCollisionDomain,
    expected: FreshRelationalMigrationPlan,
    operation: MigrationPlanAggregateRepositoryOperation,
  ): Effect.fn.Return<
    Option.Option<RestoredFreshRelationalMigrationPlan>,
    FrameworkMigrationRepositoryError
  > {
    if (Option.isNone(occupant)) return Option.none();
    if (!isRestoredFreshRelationalMigrationPlan(occupant.value)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    if (
      occupant.value.collision.storageId === collision.storageId &&
      classifyFrameworkMigrationPlanReplay(
        occupant.value.plan,
        expected,
      ) === "exact"
    ) {
      return occupant;
    }
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  });

export const resolveAuthenticatedFreshRelationalMigrationPlanOccupantEffect =
  Effect.fn(
    "FrameworkMigrationPlanRepository.resolveOccupant",
  )(function* (
    occupant: Option.Option<RestoredFreshRelationalMigrationPlan>,
    collision: RestoredFrameworkMigrationCollisionDomain,
    expected: FreshRelationalMigrationPlan,
    operation: MigrationPlanRepositoryOperation,
  ): Effect.fn.Return<
    Option.Option<RestoredFreshRelationalMigrationPlan>,
    FrameworkMigrationRepositoryError
  > {
    return yield*
      resolveAuthenticatedFreshRelationalMigrationPlanOccupantForOperationEffect(
        occupant,
        collision,
        expected,
        operation,
      );
  });

/**
 * Source-private transaction corroboration for a restored plan supplied as an
 * aggregate prerequisite. The stored occupant is fully restored before replay
 * classification so a digest collision cannot bypass sidecar validation.
 */
export const corroborateRestoredFreshRelationalMigrationPlanInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationPlanRepository.corroborateRestored",
  )(function* (
    transaction: FlarexMetadataTransaction,
    expectedRestoredPlan: RestoredFreshRelationalMigrationPlan,
    operation: MigrationPlanAggregateRepositoryOperation,
  ): Effect.fn.Return<
    RestoredFreshRelationalMigrationPlan,
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFreshRelationalMigrationPlan(expectedRestoredPlan)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const storedCollision = yield* requireStoredPlanCollision(
      transaction,
      expectedRestoredPlan.collision,
      expectedRestoredPlan.plan,
      operation,
    );
    const migrationPlanSha256Bytes = yield* decodeAuthenticatedSha256(
      expectedRestoredPlan.plan.migrationPlanSha256,
    );
    const row = yield* loadPlanRootByDigest(
      transaction,
      migrationPlanSha256Bytes,
      operation,
    );
    if (
      Option.isNone(row) ||
      row.value.planStorageId !== expectedRestoredPlan.storageId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const occupant = yield* restorePlanOccupant(
      transaction,
      row.value,
      storedCollision,
      operation,
    );
    const resolved = yield*
      resolveAuthenticatedFreshRelationalMigrationPlanOccupantForOperationEffect(
        Option.some(occupant),
        storedCollision,
        expectedRestoredPlan.plan,
        operation,
      );
    if (Option.isNone(resolved)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return resolved.value;
  });

/**
 * Source-private restoration for a plan referenced by stored aggregate state.
 * Missing or mismatched parent rows are corruption, never ordinary absence.
 */
export const restoreStoredFreshRelationalMigrationPlanReferenceInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationPlanRepository.restoreStoredReference",
  )(function* (
    transaction: FlarexMetadataTransaction,
    preferredCollision: RestoredFrameworkMigrationCollisionDomain,
    planStorageId: bigint,
    planSha256: FrameworkMigrationPlanSha256,
    operation: MigrationPlanAggregateRepositoryOperation,
  ): Effect.fn.Return<
    RestoredFreshRelationalMigrationPlan,
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFrameworkMigrationCollisionDomain(preferredCollision)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const migrationPlanSha256Bytes = yield* Effect.fromResult(
      Encoding.decodeHex(planSha256),
    ).pipe(Effect.mapError(() =>
      FrameworkMigrationRepositoryError.storedCorruption(operation)
    ));
    const row = yield* loadPlanRootByDigest(
      transaction,
      migrationPlanSha256Bytes,
      operation,
    );
    if (Option.isNone(row) || row.value.planStorageId !== planStorageId) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return yield* restorePlanOccupant(
      transaction,
      row.value,
      preferredCollision,
      operation,
    );
  });

const prepareExpectedPlan = Effect.fn(
  "FrameworkMigrationPlanRepository.prepareExpected",
)(function* (
  input: FreshRelationalMigrationPlan,
  operation: MigrationPlanRepositoryOperation,
): Effect.fn.Return<PreparedMigrationPlan, FrameworkMigrationRepositoryError> {
  if (!isCapturedFreshRelationalMigrationPlan(input)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* capturePrivateCanonicalValue(
    input.frame,
    MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== input.migrationPlanSha256 ||
    captured.canonicalJson !== input.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }

  const steps: PreparedMigrationPlanStep[] = [];
  const dependencies: PreparedMigrationPlanDependency[] = [];
  for (let stepOrdinal = 0; stepOrdinal < input.frame.steps.length; stepOrdinal += 1) {
    const step = input.frame.steps[stepOrdinal];
    if (step === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const stepSha256 = yield* decodeAuthenticatedSha256(step.stepSha256);
    steps.push(Object.freeze({
      stepOrdinal,
      stepId: step.stepId,
      stepSha256,
      preconditionSha256: yield* decodeAuthenticatedSha256(
        step.preconditionSha256,
      ),
      postconditionSha256: yield* decodeAuthenticatedSha256(
        step.postconditionSha256,
      ),
      phase: step.phase,
      operationFormat: step.operation.codec.format,
      operationVersion: step.operation.codec.version,
      dependencyCount: step.dependencies.length,
    }));
    for (
      let dependencyOrdinal = 0;
      dependencyOrdinal < step.dependencies.length;
      dependencyOrdinal += 1
    ) {
      const dependency = step.dependencies[dependencyOrdinal];
      if (dependency === undefined) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      dependencies.push(Object.freeze({
        sourceStepId: step.stepId,
        dependencyOrdinal,
        dependencyStepId: dependency.stepId,
        dependencyStepSha256: yield* decodeAuthenticatedSha256(
          dependency.stepSha256,
        ),
      }));
    }
  }

  return Object.freeze({
    plan: input,
    migrationPlanSha256Bytes: captured.copySha256Bytes(),
    artifactSha256Bytes: yield* decodeAuthenticatedSha256(
      input.frame.artifact.artifactSha256,
    ),
    requiredStepSetSha256Bytes: yield* decodeAuthenticatedSha256(
      input.requiredStepSetSha256,
    ),
    physicalLayoutSha256Bytes: yield* decodeAuthenticatedSha256(
      input.frame.physicalLayoutSha256,
    ),
    canonicalBytes: captured.copyCanonicalBytes(),
    steps: Object.freeze(steps),
    dependencies: Object.freeze(dependencies),
  });
});

const requireStoredPlanCollision = Effect.fn(
  "FrameworkMigrationPlanRepository.requireCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  plan: FreshRelationalMigrationPlan,
  operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (
    !isRestoredFrameworkMigrationCollisionDomain(collision) ||
    !sameCollisionCoordinate(plan.frame.collision, collision.coordinate)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const stored = yield*
    readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
      transaction,
      collision.targetNamespace,
      collision.coordinate,
      operation,
    );
  if (Option.isNone(stored) || stored.value.storageId !== collision.storageId) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return stored.value;
});

export const readFreshRelationalMigrationPlanAssignmentsForOperationInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationPlanRepository.readAssignments",
  )(function* (
    transaction: FlarexMetadataTransaction,
    collision: RestoredFrameworkMigrationCollisionDomain,
    frames: readonly RelationalPhysicalNameAssignmentFrame[],
    mode: "prerequisite" | "stored",
    operation: MigrationPlanAggregateRepositoryOperation,
  ): Effect.fn.Return<
    readonly RestoredRelationalPhysicalNameAssignment[],
    FrameworkMigrationRepositoryError
  > {
    const expectations: Array<Readonly<{
      readonly frame: RelationalPhysicalNameAssignmentFrame;
      readonly assignmentSha256: string;
      readonly canonicalJson: string;
    }>> = [];
    for (const frame of frames) {
      const captured = yield* capturePrivateCanonicalValue(
        frame,
        MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
        {
          invalidInput: () => mode === "prerequisite"
            ? FrameworkMigrationRepositoryError.referenceRefusal(operation)
            : FrameworkMigrationRepositoryError.storedCorruption(operation),
          hashFailure: cause =>
            FrameworkMigrationRepositoryError.resourceFailure(
              operation,
              cause,
            ),
        },
      );
      expectations.push(Object.freeze({
        frame,
        assignmentSha256: captured.sha256Hex,
        canonicalJson: captured.canonicalJson,
      }));
    }
    const occupants = yield*
      readRelationalPhysicalNameAssignmentOccupantsBySpellingInTransactionEffect(
        transaction,
        collision,
        expectations.map(value => value.frame.spelling),
        mode,
        operation,
      );
    const occupantsBySpelling = new Map<
      string,
      RestoredRelationalPhysicalNameAssignment
    >();
    for (const occupant of occupants) {
      const spelling = occupant.assignment.frame.spelling;
      if (occupantsBySpelling.has(spelling)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      occupantsBySpelling.set(spelling, occupant);
    }

    const restored: RestoredRelationalPhysicalNameAssignment[] = [];
    for (const expected of expectations) {
      const occupant = occupantsBySpelling.get(expected.frame.spelling);
      if (occupant === undefined) {
        return yield* Effect.fail(mode === "prerequisite"
          ? FrameworkMigrationRepositoryError.referenceRefusal(operation)
          : FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      const exact = occupant.assignment.assignmentSha256 ===
          expected.assignmentSha256 &&
        occupant.assignment.canonicalJson === expected.canonicalJson &&
        classifyRelationalPhysicalNameAssignmentReplay(
          occupant.assignment.frame,
          expected.frame,
        ) === "exact";
      if (!exact) {
        return yield* Effect.fail(mode === "prerequisite"
          ? FrameworkMigrationRepositoryError.physicalNameCollision(
            operation,
            expected.frame.spelling,
          )
          : FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      if (occupant.collision.storageId !== collision.storageId) {
        return yield* Effect.fail(mode === "prerequisite"
          ? FrameworkMigrationRepositoryError.referenceRefusal(operation)
          : FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      restored.push(occupant);
    }
    return Object.freeze(restored);
  });

const insertPlanSidecars = Effect.fn(
  "FrameworkMigrationPlanRepository.insertSidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  planStorageId: bigint,
  collisionStorageId: bigint,
  prepared: PreparedMigrationPlan,
  operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
  for (
    let offset = 0;
    offset < prepared.steps.length;
    offset += PLAN_SIDECAR_INSERT_BATCH_SIZE
  ) {
    const batch = prepared.steps.slice(
      offset,
      offset + PLAN_SIDECAR_INSERT_BATCH_SIZE,
    );
    if (batch.length === 0) continue;
    yield* runRepositoryStatement(
      operation,
      transaction.insert(fxSystemFrameworkMigrationPlanSteps).values(
        batch.map(step => ({
          planStorageId,
          collisionStorageId,
          ...step,
        })),
      ),
    );
  }
  for (
    let offset = 0;
    offset < prepared.dependencies.length;
    offset += PLAN_SIDECAR_INSERT_BATCH_SIZE
  ) {
    const batch = prepared.dependencies.slice(
      offset,
      offset + PLAN_SIDECAR_INSERT_BATCH_SIZE,
    );
    if (batch.length === 0) continue;
    yield* runRepositoryStatement(
      operation,
      transaction.insert(
        fxSystemFrameworkMigrationPlanStepDependencies,
      ).values(batch.map(dependency => ({
        planStorageId,
        ...dependency,
      }))),
    );
  }
});

const loadPlanRootByDigest = Effect.fn(
  "FrameworkMigrationPlanRepository.loadRootByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  migrationPlanSha256: Uint8Array,
  operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<
  Option.Option<MigrationPlanDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(migrationPlanReadSelection).from(
    fxSystemFrameworkMigrationPlans,
  ).where(eq(
    fxSystemFrameworkMigrationPlans.migrationPlanSha256,
    migrationPlanSha256,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

const restorePlanOccupant = Effect.fn(
  "FrameworkMigrationPlanRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: MigrationPlanDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: MigrationPlanAggregateRepositoryOperation,
  preferred?: PreferredMigrationPlanDependencies,
): Effect.fn.Return<
  RestoredFreshRelationalMigrationPlan,
  FrameworkMigrationRepositoryError
> {
  const decoded = yield* decodePlanRoot(row, operation);
  const collision = yield* resolvePlanOccupantCollision(
    transaction,
    row,
    decoded.frame,
    preferredCollision,
    operation,
  );
  const assignments = preferred !== undefined &&
      preferred.canonicalJson === decoded.canonicalJson &&
      preferred.collision.storageId === collision.storageId
    ? preferred.assignments
    : yield*
      readFreshRelationalMigrationPlanAssignmentsForOperationInTransactionEffect(
        transaction,
        collision,
        decoded.frame.physicalLayout.nameAssignments,
        "stored",
        operation,
      );
  const sidecars = yield* loadPlanSidecars(
    transaction,
    decoded.storageId,
    decoded.frame,
    operation,
  );
  return yield* restoreStoredFreshRelationalMigrationPlan({
    row,
    stepRows: sidecars.steps,
    dependencyRows: sidecars.dependencies,
    targetNamespace: collision.targetNamespace,
    collision,
    nameAssignments: assignments,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
});

const decodePlanRoot = Effect.fn(
  "FrameworkMigrationPlanRepository.decodeRoot",
)(function* (
  row: MigrationPlanDriverRow,
  operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<
  DecodedMigrationPlanRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.planStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.migrationPlanSha256,
    {
      format: FRAMEWORK_MIGRATION_PLAN_FORMAT,
      version: FRAMEWORK_MIGRATION_PLAN_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "plan",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isStoredFreshRelationalMigrationPlanFrame(frame)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return Object.freeze({
    storageId,
    frame,
    canonicalJson: stored.canonicalJson,
  });
});

const resolvePlanOccupantCollision = Effect.fn(
  "FrameworkMigrationPlanRepository.resolveOccupantCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: MigrationPlanDriverRow,
  frame: FreshRelationalMigrationPlanFrame,
  preferred: RestoredFrameworkMigrationCollisionDomain,
  operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (
    row.collisionStorageId === preferred.storageId &&
    sameCollisionCoordinate(frame.collision, preferred.coordinate)
  ) {
    return preferred;
  }
  const targetValue = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: frame.targetNamespace.deploymentId,
    physicalDatabaseIdentity: frame.targetNamespace.physicalDatabaseIdentity,
    schemaName: frame.targetNamespace.schemaName,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  const target = yield*
    readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect(
      transaction,
      targetValue,
      operation,
    ).pipe(Effect.mapError(error =>
      mapStoredRepositoryError(operation, error)
    ));
  if (Option.isNone(target)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const collision = yield*
    readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
      transaction,
      target.value,
      frame.collision,
      operation,
    ).pipe(Effect.mapError(error =>
      mapStoredRepositoryError(operation, error)
    ));
  if (
    Option.isNone(collision) ||
    collision.value.storageId !== row.collisionStorageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return collision.value;
});

const loadPlanSidecars = Effect.fn(
  "FrameworkMigrationPlanRepository.loadSidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  planStorageId: bigint,
  frame: FreshRelationalMigrationPlanFrame,
  operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<
  Readonly<{
    readonly steps: readonly MigrationPlanStepDriverRow[];
    readonly dependencies: readonly MigrationPlanDependencyDriverRow[];
  }>,
  FrameworkMigrationRepositoryError
> {
  const stepQuery = transaction.select(migrationPlanStepReadSelection).from(
    fxSystemFrameworkMigrationPlanSteps,
  ).where(eq(
    fxSystemFrameworkMigrationPlanSteps.planStorageId,
    planStorageId,
  )).orderBy(asc(
    fxSystemFrameworkMigrationPlanSteps.stepOrdinal,
  )).limit(frame.steps.length + 1);
  const steps = yield* runRepositoryStatement(operation, stepQuery).pipe(
    Effect.map(detachDriverRows),
  );

  let dependencyCount = 0;
  for (const step of frame.steps) dependencyCount += step.dependencies.length;
  if (!Number.isSafeInteger(dependencyCount)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const dependencyQuery = transaction.select(
    migrationPlanDependencyReadSelection,
  ).from(fxSystemFrameworkMigrationPlanStepDependencies).leftJoin(
    fxSystemFrameworkMigrationPlanSteps,
    and(
      eq(
        fxSystemFrameworkMigrationPlanStepDependencies.planStorageId,
        fxSystemFrameworkMigrationPlanSteps.planStorageId,
      ),
      eq(
        fxSystemFrameworkMigrationPlanStepDependencies.sourceStepId,
        fxSystemFrameworkMigrationPlanSteps.stepId,
      ),
    ),
  ).where(eq(
    fxSystemFrameworkMigrationPlanStepDependencies.planStorageId,
    planStorageId,
  )).orderBy(
    asc(fxSystemFrameworkMigrationPlanSteps.stepOrdinal),
    asc(fxSystemFrameworkMigrationPlanStepDependencies.dependencyOrdinal),
  ).limit(dependencyCount + 1);
  const dependencies = yield* runRepositoryStatement(
    operation,
    dependencyQuery,
  ).pipe(Effect.map(detachDriverRows));
  return Object.freeze({ steps, dependencies });
});

function runRepositoryStatement<Value>(
  operation: MigrationPlanAggregateRepositoryOperation,
  statement: PromiseLike<Value>,
): Effect.Effect<Value, FrameworkMigrationRepositoryError> {
  return runDrizzleStatementEffect(
    statement,
    cause => FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      cause,
    ),
  );
}

function decodeAuthenticatedSha256(value: string): Effect.Effect<Uint8Array> {
  return Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.orDie);
}

function mapStoredValueError(
  operation: MigrationPlanAggregateRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function mapStoredRepositoryError(
  operation: MigrationPlanAggregateRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function sameCollisionCoordinate(
  left: FrameworkMigrationCollisionCoordinate,
  right: FrameworkMigrationCollisionCoordinate,
): boolean {
  return sameTargetNamespaceFrame(
    left.targetNamespace,
    right.targetNamespace,
  ) && left.owner === right.owner && left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function sameTargetNamespaceFrame(
  left: FrameworkMigrationCollisionCoordinate["targetNamespace"],
  right: FrameworkMigrationCollisionCoordinate["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

const migrationPlanCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationPlans.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES}
`;

const migrationPlanReadSelection = {
  planStorageId: fxSystemFrameworkMigrationPlans.planStorageId,
  collisionStorageId: fxSystemFrameworkMigrationPlans.collisionStorageId,
  artifactSha256: fxSystemFrameworkMigrationPlans.artifactSha256,
  locatorKind: fxSystemFrameworkMigrationPlans.locatorKind,
  locatorDatabaseKey: fxSystemFrameworkMigrationPlans.locatorDatabaseKey,
  locatorSchemaName: fxSystemFrameworkMigrationPlans.locatorSchemaName,
  migrationPlanSha256: fxSystemFrameworkMigrationPlans.migrationPlanSha256,
  requiredStepSetSha256:
    fxSystemFrameworkMigrationPlans.requiredStepSetSha256,
  physicalLayoutSha256: fxSystemFrameworkMigrationPlans.physicalLayoutSha256,
  frameFormat: fxSystemFrameworkMigrationPlans.frameFormat,
  frameVersion: fxSystemFrameworkMigrationPlans.frameVersion,
  canonicalByteLength: fxSystemFrameworkMigrationPlans.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationPlans.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${migrationPlanCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationPlans.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<keyof StoredFrameworkMigrationPlanRow, unknown>;

const migrationPlanStepReadSelection = {
  planStorageId: fxSystemFrameworkMigrationPlanSteps.planStorageId,
  collisionStorageId: fxSystemFrameworkMigrationPlanSteps.collisionStorageId,
  stepOrdinal: fxSystemFrameworkMigrationPlanSteps.stepOrdinal,
  stepId: fxSystemFrameworkMigrationPlanSteps.stepId,
  stepSha256: fxSystemFrameworkMigrationPlanSteps.stepSha256,
  preconditionSha256: fxSystemFrameworkMigrationPlanSteps.preconditionSha256,
  postconditionSha256: fxSystemFrameworkMigrationPlanSteps.postconditionSha256,
  phase: fxSystemFrameworkMigrationPlanSteps.phase,
  operationFormat: fxSystemFrameworkMigrationPlanSteps.operationFormat,
  operationVersion: fxSystemFrameworkMigrationPlanSteps.operationVersion,
  dependencyCount: fxSystemFrameworkMigrationPlanSteps.dependencyCount,
} as const satisfies Record<
  keyof StoredFrameworkMigrationPlanStepRow,
  unknown
>;

const migrationPlanDependencyReadSelection = {
  planStorageId:
    fxSystemFrameworkMigrationPlanStepDependencies.planStorageId,
  sourceStepId:
    fxSystemFrameworkMigrationPlanStepDependencies.sourceStepId,
  dependencyOrdinal:
    fxSystemFrameworkMigrationPlanStepDependencies.dependencyOrdinal,
  dependencyStepId:
    fxSystemFrameworkMigrationPlanStepDependencies.dependencyStepId,
  dependencyStepSha256:
    fxSystemFrameworkMigrationPlanStepDependencies.dependencyStepSha256,
} as const satisfies Record<
  keyof StoredFrameworkMigrationPlanStepDependencyRow,
  unknown
>;

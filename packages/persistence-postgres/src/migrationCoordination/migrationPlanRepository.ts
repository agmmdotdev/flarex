import { captureMigrationCanonicalValue, currentPlanVerification } from "./planVerificationScope";
import { copyBytes } from "@flarex/utils/bytes";
import { withAdditiveMigrationGraphLimits } from "./graphLimits";
import { reaffirmCapturedPlanAdmissionAuthority } from "./authority";
import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "./graphReadPass";
import { insertFrameworkMigrationBaseEffect, restoreFrameworkMigrationBaseEffect } from "./baseRepository";
import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
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
  isVerifiedStoredMigrationPlanFrame,
  withFrameworkMigrationPlanVerification,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationPlanSha256 } from "./identity";
import type {
  FrameworkMigrationCollisionCoordinate,
  FrameworkMigrationStep,
  RelationalMigrationPlan,
  RelationalMigrationPlanFrame,
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
  readonly plan: RelationalMigrationPlan;
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
  readonly locatorKind: RelationalMigrationPlanFrame["physicalLocator"]["kind"];
  readonly locatorDatabaseKey: string;
  readonly locatorSchemaName: string;
  readonly migrationPlanSha256: Uint8Array;
  readonly requiredStepSetSha256: Uint8Array;
  readonly physicalLayoutSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_PLAN_FORMAT;
  readonly frameVersion: 1 | 2;
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
  readonly frame: RelationalMigrationPlanFrame;
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
  input: RelationalMigrationPlan,
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
    yield* insertFrameworkMigrationBaseEffect(transaction, storedCollision, storageId,
      prepared.plan.frame, operation);
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
  input: RelationalMigrationPlan,
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
    expected: RelationalMigrationPlan,
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
      reaffirmCapturedPlanAdmissionAuthority(occupant.value.plan, expected);
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
    expected: RelationalMigrationPlan,
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
const readPlanReference = makeFrameworkGraphReferenceRead<RestoredFreshRelationalMigrationPlan>();
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
  }, (read, transaction, collision, storageId, sha256) => readPlanReference(read, transaction, collision, storageId, sha256));

const prepareExpectedPlan = Effect.fn(
  "FrameworkMigrationPlanRepository.prepareExpected",
)(function* (
  input: RelationalMigrationPlan,
  operation: MigrationPlanRepositoryOperation,
): Effect.fn.Return<PreparedMigrationPlan, FrameworkMigrationRepositoryError> {
  if (!isCapturedFreshRelationalMigrationPlan(input)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* captureMigrationCanonicalValue(
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

  const { steps, dependencies } = yield* preparePlanSidecars(input.frame, operation);

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

type PreparedPlanSidecars = Pick<PreparedMigrationPlan, "steps" | "dependencies">;
const purePlanSidecars = new WeakMap<object, { readonly frame: RelationalMigrationPlanFrame; readonly value: PreparedPlanSidecars }>();

const preparePlanSidecars = Effect.fn("FrameworkMigrationPlanRepository.prepareSidecars")(function* (
  frame: RelationalMigrationPlanFrame, operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<PreparedPlanSidecars, FrameworkMigrationRepositoryError> {
  const state = yield* currentPlanVerification;
  const eligible = state?.active === true && state.entry?.frame === frame;
  const prior = eligible ? purePlanSidecars.get(state) : undefined;
  if (prior?.frame === frame) return prior.value;
  const steps: PreparedMigrationPlanStep[] = [];
  const dependencies: PreparedMigrationPlanDependency[] = [];
  for (let stepOrdinal = 0; stepOrdinal < frame.steps.length; stepOrdinal += 1) {
    const step = frame.steps[stepOrdinal];
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

  const value = Object.freeze({ steps: Object.freeze(steps), dependencies: Object.freeze(dependencies) });
  // One pure projection, derived only from the exact verified plan. The source
  // plan's byte bound also bounds these fixed-width digest projections.
  if (eligible && state.active) {
    if (!purePlanSidecars.has(state)) state.releases.add(() => { purePlanSidecars.delete(state); });
    purePlanSidecars.set(state, { frame, value });
  }
  return value;
});

const requireStoredPlanCollision = Effect.fn(
  "FrameworkMigrationPlanRepository.requireCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  plan: RelationalMigrationPlan,
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

const readPlanAssignments = makeFrameworkGraphReferenceRead<readonly RestoredRelationalPhysicalNameAssignment[]>();
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
      const captured = yield* captureMigrationCanonicalValue(
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
        expectations,
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
  }, (read, transaction, collision, frames, mode) => readPlanAssignments(read, transaction, collision, frames, mode));

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
  const verification = yield* currentPlanVerification;
  const expected = verification?.active ? verification.entry : undefined;
  // Compare exact bytes in this read's database snapshot. A digest or cached
  // occupant is insufficient evidence. Keep every projection and read sidecars
  // normally; a mismatch still transfers bounded bytes for full verification.
  const sameBytes = expected === undefined ? sql<boolean>`false` : sql<boolean>`
    ${fxSystemFrameworkMigrationPlans.canonicalBytes} =
      expected_plan.bytes
  `;
  // Both projections reference one bound value. Interpolating the same SQL
  // fragment twice otherwise sends the full canonical plan twice per read.
  const expectedPlan = sql`(select convert_to(${expected === undefined ? null : new TextDecoder().decode(expected.bytes)}::text, 'UTF8') as bytes) expected_plan`;
  const query = transaction.select({ ...migrationPlanReadSelection,
    matchesExpectedBytes: sameBytes,
    canonicalBytes: sql<Uint8Array | null>`case when ${sameBytes} then null
      else ${migrationPlanReadSelection.canonicalBytes} end`,
  }).from(
    fxSystemFrameworkMigrationPlans,
  ).crossJoin(expectedPlan).where(eq(
    fxSystemFrameworkMigrationPlans.migrationPlanSha256,
    migrationPlanSha256,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  if (typeof row.matchesExpectedBytes !== "boolean") {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  }
  if (row.matchesExpectedBytes) {
    if (expected === undefined || row.canonicalBytes !== null) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    return Option.some({ ...row, canonicalBytes: copyBytes(expected.bytes) });
  }
  return Option.some(row);
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
    collision.storageId,
    decoded.frame,
    operation,
  );
  const base = yield* restoreFrameworkMigrationBaseEffect(transaction, collision,
    decoded.storageId, decoded.frame, operation);
  return yield* restoreStoredFreshRelationalMigrationPlan({
    ...(Option.isSome(base) ? { baseReadiness: base.value } : {}),
    row,
    stepRows: sidecars.steps,
    dependencyRows: sidecars.dependencies,
    targetNamespace: collision.targetNamespace,
    collision,
    nameAssignments: assignments,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
}, withFrameworkGraphReadPass, withFrameworkMigrationPlanVerification, (effect, _transaction, row) =>
  row.frameVersion === 2 ? withAdditiveMigrationGraphLimits(effect) : effect);

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
      version: row.frameVersion === 2 ? 2 : 1,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "plan",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isVerifiedStoredMigrationPlanFrame(frame) || frame.version !== row.frameVersion) {
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
  frame: RelationalMigrationPlanFrame,
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

const loadPlanSidecars = Effect.fn("FrameworkMigrationPlanRepository.loadSidecars")(function* (
  transaction: FlarexMetadataTransaction, planStorageId: bigint, collisionStorageId: bigint,
  frame: RelationalMigrationPlanFrame, operation: MigrationPlanAggregateRepositoryOperation,
): Effect.fn.Return<Readonly<{ steps: readonly MigrationPlanStepDriverRow[]; dependencies: readonly MigrationPlanDependencyDriverRow[] }>, FrameworkMigrationRepositoryError> {
  const prepared = yield* preparePlanSidecars(frame, operation);
  const steps = prepared.steps.map(step => ({ ...step, planStorageId, collisionStorageId }));
  const dependencies = prepared.dependencies.map(dependency => ({ ...dependency, planStorageId }));
  const expectedSteps = steps.map(step => [String(step.planStorageId), String(step.collisionStorageId), step.stepOrdinal,
    step.stepId, Encoding.encodeHex(step.stepSha256), Encoding.encodeHex(step.preconditionSha256),
    Encoding.encodeHex(step.postconditionSha256), step.phase, step.operationFormat, step.operationVersion, step.dependencyCount]);
  const expectedDependencies = dependencies.map(dependency => [String(dependency.planStorageId), dependency.sourceStepId,
    dependency.dependencyOrdinal, dependency.dependencyStepId, Encoding.encodeHex(dependency.dependencyStepSha256)]);
  const step = fxSystemFrameworkMigrationPlanSteps;
  const dependency = fxSystemFrameworkMigrationPlanStepDependencies;
  // Compare every persisted sidecar member and the complete bounded inventory
  // in the current database snapshot. Expected values come only from the fully
  // verified plan, never from a previous database read. Return one Boolean
  // instead of repeatedly decoding hundreds of bytea driver cells.
  const stepQuery = transaction.select({
    ordinal: step.stepOrdinal,
    projection: sql`jsonb_build_array(${step.planStorageId}::text, ${step.collisionStorageId}::text,
      ${step.stepOrdinal}, ${step.stepId}, encode(${step.stepSha256}, 'hex'),
      encode(${step.preconditionSha256}, 'hex'), encode(${step.postconditionSha256}, 'hex'),
      ${step.phase}, ${step.operationFormat}, ${step.operationVersion}, ${step.dependencyCount})`.as("projection"),
  }).from(step).where(eq(step.planStorageId, planStorageId)).orderBy(asc(step.stepOrdinal)).limit(steps.length + 1);
  const dependencyQuery = transaction.select({
    stepOrdinal: step.stepOrdinal,
    ordinal: dependency.dependencyOrdinal,
    projection: sql`jsonb_build_array(${dependency.planStorageId}::text, ${dependency.sourceStepId},
      ${dependency.dependencyOrdinal}, ${dependency.dependencyStepId}, encode(${dependency.dependencyStepSha256}, 'hex'))`.as("projection"),
  }).from(dependency).leftJoin(step, and(eq(dependency.planStorageId, step.planStorageId),
    eq(dependency.sourceStepId, step.stepId))).where(eq(dependency.planStorageId, planStorageId))
    .orderBy(asc(step.stepOrdinal), asc(dependency.dependencyOrdinal)).limit(dependencies.length + 1);
  const rows = yield* runRepositoryStatement(operation, transaction.select({
    stepsMatch: sql<boolean>`(select coalesce(jsonb_agg(q.projection order by q.step_ordinal), '[]'::jsonb) from (${stepQuery}) q)
      = ${JSON.stringify(expectedSteps)}::jsonb`,
    dependenciesMatch: sql<boolean>`(select coalesce(jsonb_agg(q.projection order by q.step_ordinal, q.dependency_ordinal), '[]'::jsonb) from (${dependencyQuery}) q)
      = ${JSON.stringify(expectedDependencies)}::jsonb`,
  }).from(sql`(values (1)) as sidecar_comparison(only_row)`));
  if (rows.length !== 1 || rows[0]?.stepsMatch !== true || rows[0]?.dependenciesMatch !== true) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  }
  return Object.freeze({ steps: Object.freeze(steps), dependencies: Object.freeze(dependencies) });
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

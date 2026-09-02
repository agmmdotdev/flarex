import { asc, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { compareFrameworkSchemaArtifactIdentities } from
  "../frameworkSchema/artifact/policy";
import { capturePrivateCanonicalValue } from
  "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type {
  RelationalPhysicalNameAssignmentSha256,
  FrameworkMigrationPlanAdmissionSha256,
} from "./identity";
import { capturedPlanForAdmission } from "./authority";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import {
  corroborateRestoredFreshRelationalMigrationPlanInTransactionEffect,
  readFreshRelationalMigrationPlanAssignmentsForOperationInTransactionEffect,
  restoreStoredFreshRelationalMigrationPlanReferenceInTransactionEffect,
} from "./migrationPlanRepository";
import {
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationPlanAdmissionFrame,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import {
  fxSystemFrameworkMigrationAdmissionAssignments,
  fxSystemFrameworkMigrationPlanAdmissions,
} from "./schema";
import {
  isRestoredFrameworkMigrationPlanAdmission,
  isRestoredFreshRelationalMigrationPlan,
  restoreStoredFrameworkMigrationPlanAdmission,
  type RestoredFrameworkMigrationPlanAdmission,
  type RestoredFreshRelationalMigrationPlan,
  type RestoredRelationalPhysicalNameAssignment,
  type StoredFrameworkMigrationAdmissionAssignmentRow,
  type StoredFrameworkMigrationPlanAdmissionRow,
} from "./storedRestoration";
import { isStoredFrameworkMigrationPlanAdmissionFrame } from
  "./storedValidation";
import { scopePhysicalLocatorsEqual } from "../scopePhysicalLocator";

type FrameworkMigrationPlanAdmission = CapturedFrameworkMigrationValue<
  FrameworkMigrationPlanAdmissionFrame,
  FrameworkMigrationPlanAdmissionSha256
>;

type PlanAdmissionRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensureAdmission" | "readAdmission"
>;

const ADMISSION_SIDECAR_INSERT_BATCH_SIZE = 256;

interface PreparedAdmissionAssignment {
  readonly spelling: string;
  readonly assignmentSha256: RelationalPhysicalNameAssignmentSha256;
  readonly assignmentSha256Bytes: Uint8Array;
}

interface PreparedMigrationPlanAdmission {
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly previousPlan: RestoredFreshRelationalMigrationPlan | null;
  readonly admission: FrameworkMigrationPlanAdmission;
  readonly admissionSha256Bytes: Uint8Array;
  readonly migrationPlanSha256Bytes: Uint8Array;
  readonly previousPlanSha256Bytes: Uint8Array | null;
  readonly canonicalBytes: Uint8Array;
  readonly assignments: readonly PreparedAdmissionAssignment[];
}

interface AdmissionSidecarInsert {
  readonly admissionStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly assignmentOrdinal: number;
  readonly assignmentStorageId: bigint;
  readonly spelling: string;
  readonly assignmentSha256: Uint8Array;
}

interface MigrationPlanAdmissionDriverRow
  extends StoredFrameworkMigrationPlanAdmissionRow {
  readonly admissionStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly migrationPlanSha256: Uint8Array;
  readonly previousPlanStorageId: bigint | null;
  readonly previousPlanSha256: Uint8Array | null;
  readonly admissionSha256: Uint8Array;
  readonly admissionProfile:
    FrameworkMigrationPlanAdmissionFrame["admissionProfile"];
  readonly assignmentCount: number;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface MigrationPlanAdmissionAssignmentDriverRow
  extends StoredFrameworkMigrationAdmissionAssignmentRow {
  readonly admissionStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly assignmentOrdinal: number;
  readonly assignmentStorageId: bigint;
  readonly spelling: string;
  readonly assignmentSha256: Uint8Array;
}

interface DecodedMigrationPlanAdmissionRoot {
  readonly storageId: bigint;
  readonly planStorageId: bigint;
  readonly previousPlanStorageId: bigint | null;
  readonly frame: FrameworkMigrationPlanAdmissionFrame;
  readonly canonicalJson: string;
}

export const ensureFrameworkMigrationPlanAdmissionInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationPlanAdmissionRepository.ensure",
  )(function* (
    transaction: FlarexMetadataTransaction,
    plan: RestoredFreshRelationalMigrationPlan,
    previousPlan: RestoredFreshRelationalMigrationPlan | null,
    admission: FrameworkMigrationPlanAdmission,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationPlanAdmission,
    FrameworkMigrationRepositoryError
  > {
    const operation = "ensureAdmission" as const;
    const prepared = yield* prepareExpectedAdmission(
      plan,
      previousPlan,
      admission,
      operation,
    );
    const storedPlan = yield*
      corroborateRestoredFreshRelationalMigrationPlanInTransactionEffect(
        transaction,
        prepared.plan,
        operation,
      );
    const storedPreviousPlan = prepared.previousPlan === null
      ? null
      : yield*
        corroborateRestoredFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          prepared.previousPlan,
          operation,
        );
    if (
      storedPreviousPlan !== null &&
      storedPreviousPlan.collision.storageId !== storedPlan.collision.storageId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }

    const existingRow = yield* loadAdmissionRootByDigest(
      transaction,
      prepared.admissionSha256Bytes,
      operation,
    );
    if (Option.isSome(existingRow)) {
      const occupant = yield* restoreAdmissionOccupant(
        transaction,
        existingRow.value,
        storedPlan.collision,
        operation,
      );
      const resolved = yield*
        resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect(
          Option.some(occupant),
          prepared.plan,
          prepared.admission,
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
        storedPlan.collision,
        storedPlan.plan.frame.physicalLayout.nameAssignments,
        "prerequisite",
        operation,
      );
    const insertedRows = yield* runRepositoryStatement(
      operation,
      transaction.insert(fxSystemFrameworkMigrationPlanAdmissions).values({
        collisionStorageId: storedPlan.collision.storageId,
        planStorageId: storedPlan.storageId,
        migrationPlanSha256: prepared.migrationPlanSha256Bytes,
        previousPlanStorageId: storedPreviousPlan?.storageId ?? null,
        previousPlanSha256: prepared.previousPlanSha256Bytes,
        admissionSha256: prepared.admissionSha256Bytes,
        admissionProfile: prepared.admission.frame.admissionProfile,
        assignmentCount: prepared.assignments.length,
        frameFormat: prepared.admission.frame.format,
        frameVersion: prepared.admission.frame.version,
        canonicalByteLength: prepared.canonicalBytes.byteLength,
        canonicalBytes: prepared.canonicalBytes,
      }).onConflictDoNothing().returning({
        admissionStorageId:
          fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
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
        inserted.admissionStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ));
      yield* insertAdmissionSidecars(
        transaction,
        storageId,
        storedPlan.collision.storageId,
        prepared,
        assignments,
        operation,
      );
    }

    const row = yield* loadAdmissionRootByDigest(
      transaction,
      prepared.admissionSha256Bytes,
      operation,
    );
    if (Option.isNone(row)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const occupant = yield* restoreAdmissionOccupant(
      transaction,
      row.value,
      storedPlan.collision,
      operation,
    );
    const resolved = yield*
      resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect(
        Option.some(occupant),
        prepared.plan,
        prepared.admission,
        operation,
      );
    if (Option.isNone(resolved)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return resolved.value;
  });

export const readFrameworkMigrationPlanAdmissionInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationPlanAdmissionRepository.read",
  )(function* (
    transaction: FlarexMetadataTransaction,
    plan: RestoredFreshRelationalMigrationPlan,
    previousPlan: RestoredFreshRelationalMigrationPlan | null,
    admission: FrameworkMigrationPlanAdmission,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationPlanAdmission>,
    FrameworkMigrationRepositoryError
  > {
    const operation = "readAdmission" as const;
    const prepared = yield* prepareExpectedAdmission(
      plan,
      previousPlan,
      admission,
      operation,
    );
    const storedPlan = yield*
      corroborateRestoredFreshRelationalMigrationPlanInTransactionEffect(
        transaction,
        prepared.plan,
        operation,
      );
    const storedPreviousPlan = prepared.previousPlan === null
      ? null
      : yield*
        corroborateRestoredFreshRelationalMigrationPlanInTransactionEffect(
          transaction,
          prepared.previousPlan,
          operation,
        );
    if (
      storedPreviousPlan !== null &&
      storedPreviousPlan.collision.storageId !== storedPlan.collision.storageId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const row = yield* loadAdmissionRootByDigest(
      transaction,
      prepared.admissionSha256Bytes,
      operation,
    );
    if (Option.isNone(row)) return Option.none();
    const occupant = yield* restoreAdmissionOccupant(
      transaction,
      row.value,
      storedPlan.collision,
      operation,
    );
    return yield*
      resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect(
        Option.some(occupant),
        prepared.plan,
        prepared.admission,
        operation,
      );
  });

/** Source-private collision-policy seam for an authenticated admission. */
export const resolveAuthenticatedFrameworkMigrationPlanAdmissionOccupantEffect =
  Effect.fn(
    "FrameworkMigrationPlanAdmissionRepository.resolveOccupant",
  )(function* (
    occupant: Option.Option<RestoredFrameworkMigrationPlanAdmission>,
    expectedPlan: RestoredFreshRelationalMigrationPlan,
    expectedAdmission: FrameworkMigrationPlanAdmission,
    operation: PlanAdmissionRepositoryOperation,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationPlanAdmission>,
    FrameworkMigrationRepositoryError
  > {
    if (Option.isNone(occupant)) return Option.none();
    if (!isRestoredFrameworkMigrationPlanAdmission(occupant.value)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    if (
      !isRestoredFreshRelationalMigrationPlan(expectedPlan) ||
      capturedPlanForAdmission(expectedAdmission) !== expectedPlan.plan
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    if (
      occupant.value.collision.storageId === expectedPlan.collision.storageId &&
      occupant.value.plan.storageId === expectedPlan.storageId &&
      occupant.value.plan.plan.migrationPlanSha256 ===
        expectedPlan.plan.migrationPlanSha256 &&
      occupant.value.plan.plan.canonicalJson ===
        expectedPlan.plan.canonicalJson &&
      occupant.value.admission.sha256 === expectedAdmission.sha256 &&
      occupant.value.admission.canonicalJson === expectedAdmission.canonicalJson
    ) {
      return occupant;
    }
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  });

const prepareExpectedAdmission = Effect.fn(
  "FrameworkMigrationPlanAdmissionRepository.prepareExpected",
)(function* (
  plan: RestoredFreshRelationalMigrationPlan,
  previousPlan: RestoredFreshRelationalMigrationPlan | null,
  admission: FrameworkMigrationPlanAdmission,
  operation: PlanAdmissionRepositoryOperation,
): Effect.fn.Return<
  PreparedMigrationPlanAdmission,
  FrameworkMigrationRepositoryError
> {
  if (
    !isRestoredFreshRelationalMigrationPlan(plan) ||
    capturedPlanForAdmission(admission) !== plan.plan ||
    !admissionFrameMatchesPlan(admission.frame, plan)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  if (
    admission.frame.previousPlanSha256 === null
      ? previousPlan !== null
      : previousPlan === null ||
        !isRestoredFreshRelationalMigrationPlan(previousPlan) ||
        previousPlan.collision.storageId !== plan.collision.storageId ||
        !sameCollisionCoordinate(
          previousPlan.plan.frame.collision,
          plan.plan.frame.collision,
        ) ||
        previousPlan.plan.migrationPlanSha256 !==
          admission.frame.previousPlanSha256
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* capturePrivateCanonicalValue(
    admission.frame,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== admission.sha256 ||
    captured.canonicalJson !== admission.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }

  const assignments: PreparedAdmissionAssignment[] = [];
  for (const reference of admission.frame.nameAssignments) {
    assignments.push(Object.freeze({
      spelling: reference.spelling,
      assignmentSha256: reference.assignmentSha256,
      assignmentSha256Bytes: yield* decodeAuthenticatedSha256(
        reference.assignmentSha256,
      ),
    }));
  }
  return Object.freeze({
    plan,
    previousPlan,
    admission,
    admissionSha256Bytes: captured.copySha256Bytes(),
    migrationPlanSha256Bytes: yield* decodeAuthenticatedSha256(
      admission.frame.planSha256,
    ),
    previousPlanSha256Bytes: admission.frame.previousPlanSha256 === null
      ? null
      : yield* decodeAuthenticatedSha256(
        admission.frame.previousPlanSha256,
      ),
    canonicalBytes: captured.copyCanonicalBytes(),
    assignments: Object.freeze(assignments),
  });
});

const loadAdmissionRootByDigest = Effect.fn(
  "FrameworkMigrationPlanAdmissionRepository.loadRootByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  admissionSha256: Uint8Array,
  operation: PlanAdmissionRepositoryOperation,
): Effect.fn.Return<
  Option.Option<MigrationPlanAdmissionDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(admissionReadSelection).from(
    fxSystemFrameworkMigrationPlanAdmissions,
  ).where(eq(
    fxSystemFrameworkMigrationPlanAdmissions.admissionSha256,
    admissionSha256,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

const restoreAdmissionOccupant = Effect.fn(
  "FrameworkMigrationPlanAdmissionRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: MigrationPlanAdmissionDriverRow,
  preferredCollision: RestoredFreshRelationalMigrationPlan["collision"],
  operation: PlanAdmissionRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationPlanAdmission,
  FrameworkMigrationRepositoryError
> {
  const decoded = yield* decodeAdmissionRoot(row, operation);
  const plan = yield*
    restoreStoredFreshRelationalMigrationPlanReferenceInTransactionEffect(
      transaction,
      preferredCollision,
      decoded.planStorageId,
      decoded.frame.planSha256,
      operation,
    ).pipe(Effect.mapError(error =>
      mapStoredRepositoryError(operation, error)
    ));
  let previousPlan: RestoredFreshRelationalMigrationPlan | null = null;
  if (decoded.previousPlanStorageId !== null) {
    const previousPlanSha256 = decoded.frame.previousPlanSha256;
    if (previousPlanSha256 === null) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    previousPlan = yield*
      restoreStoredFreshRelationalMigrationPlanReferenceInTransactionEffect(
        transaction,
        plan.collision,
        decoded.previousPlanStorageId,
        previousPlanSha256,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      ));
  }
  const assignments = yield*
    readFreshRelationalMigrationPlanAssignmentsForOperationInTransactionEffect(
      transaction,
      plan.collision,
      plan.plan.frame.physicalLayout.nameAssignments,
      "stored",
      operation,
    ).pipe(Effect.mapError(error =>
      mapStoredRepositoryError(operation, error)
    ));
  const sidecars = yield* loadAdmissionSidecars(
    transaction,
    decoded.storageId,
    decoded.frame,
    operation,
  );
  return yield* restoreStoredFrameworkMigrationPlanAdmission({
    row,
    assignmentRows: sidecars,
    collision: plan.collision,
    plan,
    previousPlan,
    nameAssignments: assignments,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
});

const decodeAdmissionRoot = Effect.fn(
  "FrameworkMigrationPlanAdmissionRepository.decodeRoot",
)(function* (
  row: MigrationPlanAdmissionDriverRow,
  operation: PlanAdmissionRepositoryOperation,
): Effect.fn.Return<
  DecodedMigrationPlanAdmissionRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.admissionStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const planStorageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.planStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.admissionSha256,
    {
      format: FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
      version: FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "planAdmission",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isStoredFrameworkMigrationPlanAdmissionFrame(frame)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const projectedPlanSha256 = yield* Effect.fromResult(
    decodeStoredSha256HexResult(
      row.migrationPlanSha256,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  if (projectedPlanSha256 !== frame.planSha256) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  let previousPlanStorageId: bigint | null = null;
  if (frame.previousPlanSha256 === null) {
    if (
      row.previousPlanStorageId !== null ||
      row.previousPlanSha256 !== null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  } else {
    if (
      row.previousPlanStorageId === null ||
      row.previousPlanSha256 === null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    previousPlanStorageId = yield* Effect.fromResult(
      decodeStoredStorageIdResult(
        row.previousPlanStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    const projectedPreviousPlanSha256 = yield* Effect.fromResult(
      decodeStoredSha256HexResult(
        row.previousPlanSha256,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    if (projectedPreviousPlanSha256 !== frame.previousPlanSha256) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }
  return Object.freeze({
    storageId,
    planStorageId,
    previousPlanStorageId,
    frame,
    canonicalJson: stored.canonicalJson,
  });
});

const loadAdmissionSidecars = Effect.fn(
  "FrameworkMigrationPlanAdmissionRepository.loadSidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  admissionStorageId: bigint,
  frame: FrameworkMigrationPlanAdmissionFrame,
  operation: PlanAdmissionRepositoryOperation,
): Effect.fn.Return<
  readonly MigrationPlanAdmissionAssignmentDriverRow[],
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(admissionAssignmentReadSelection).from(
    fxSystemFrameworkMigrationAdmissionAssignments,
  ).where(eq(
    fxSystemFrameworkMigrationAdmissionAssignments.admissionStorageId,
    admissionStorageId,
  )).orderBy(asc(
    fxSystemFrameworkMigrationAdmissionAssignments.assignmentOrdinal,
  )).limit(frame.nameAssignments.length + 1);
  return yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
});

const insertAdmissionSidecars = Effect.fn(
  "FrameworkMigrationPlanAdmissionRepository.insertSidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  admissionStorageId: bigint,
  collisionStorageId: bigint,
  prepared: PreparedMigrationPlanAdmission,
  assignments: readonly RestoredRelationalPhysicalNameAssignment[],
  operation: PlanAdmissionRepositoryOperation,
): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
  if (assignments.length !== prepared.assignments.length) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const values: AdmissionSidecarInsert[] = [];
  for (
    let assignmentOrdinal = 0;
    assignmentOrdinal < prepared.assignments.length;
    assignmentOrdinal += 1
  ) {
    const reference = prepared.assignments[assignmentOrdinal];
    const assignment = assignments[assignmentOrdinal];
    if (
      reference === undefined ||
      assignment === undefined ||
      assignment.assignment.frame.spelling !== reference.spelling ||
      assignment.assignment.assignmentSha256 !== reference.assignmentSha256
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    values.push({
      admissionStorageId,
      collisionStorageId,
      assignmentOrdinal,
      assignmentStorageId: assignment.storageId,
      spelling: reference.spelling,
      assignmentSha256: reference.assignmentSha256Bytes,
    });
  }
  for (
    let offset = 0;
    offset < values.length;
    offset += ADMISSION_SIDECAR_INSERT_BATCH_SIZE
  ) {
    const batch = values.slice(
      offset,
      offset + ADMISSION_SIDECAR_INSERT_BATCH_SIZE,
    );
    if (batch.length === 0) continue;
    yield* runRepositoryStatement(
      operation,
      transaction.insert(
        fxSystemFrameworkMigrationAdmissionAssignments,
      ).values(batch),
    );
  }
});

function runRepositoryStatement<Value>(
  operation: PlanAdmissionRepositoryOperation,
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
  operation: PlanAdmissionRepositoryOperation,
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
  operation: PlanAdmissionRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function admissionFrameMatchesPlan(
  frame: FrameworkMigrationPlanAdmissionFrame,
  plan: RestoredFreshRelationalMigrationPlan,
): boolean {
  const planFrame = plan.plan.frame;
  const planAssignments = plan.plan.physicalLayout.nameAssignments;
  if (
    frame.planSha256 !== plan.plan.migrationPlanSha256 ||
    compareFrameworkSchemaArtifactIdentities(
      frame.artifact,
      planFrame.artifact,
    ) !== 0 ||
    !scopePhysicalLocatorsEqual(
      frame.physicalLocator,
      planFrame.physicalLocator,
    ) ||
    !sameCollisionCoordinate(frame.collision, planFrame.collision) ||
    !sameTargetNamespace(frame.targetNamespace, planFrame.targetNamespace) ||
    frame.nameAssignments.length !== planAssignments.length
  ) {
    return false;
  }
  for (let index = 0; index < frame.nameAssignments.length; index += 1) {
    const reference = frame.nameAssignments[index];
    const assignment = planAssignments[index];
    if (
      reference === undefined ||
      assignment === undefined ||
      reference.spelling !== assignment.frame.spelling ||
      reference.assignmentSha256 !== assignment.assignmentSha256
    ) {
      return false;
    }
  }
  return true;
}

function sameCollisionCoordinate(
  left: FrameworkMigrationPlanAdmissionFrame["collision"],
  right: FrameworkMigrationPlanAdmissionFrame["collision"],
): boolean {
  return sameTargetNamespace(left.targetNamespace, right.targetNamespace) &&
    left.owner === right.owner &&
    left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function sameTargetNamespace(
  left: FrameworkMigrationPlanAdmissionFrame["targetNamespace"],
  right: FrameworkMigrationPlanAdmissionFrame["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

const admissionCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationPlanAdmissions.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES}
`;

const admissionReadSelection = {
  admissionStorageId:
    fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
  collisionStorageId:
    fxSystemFrameworkMigrationPlanAdmissions.collisionStorageId,
  planStorageId: fxSystemFrameworkMigrationPlanAdmissions.planStorageId,
  migrationPlanSha256:
    fxSystemFrameworkMigrationPlanAdmissions.migrationPlanSha256,
  previousPlanStorageId:
    fxSystemFrameworkMigrationPlanAdmissions.previousPlanStorageId,
  previousPlanSha256:
    fxSystemFrameworkMigrationPlanAdmissions.previousPlanSha256,
  admissionSha256:
    fxSystemFrameworkMigrationPlanAdmissions.admissionSha256,
  admissionProfile:
    fxSystemFrameworkMigrationPlanAdmissions.admissionProfile,
  assignmentCount:
    fxSystemFrameworkMigrationPlanAdmissions.assignmentCount,
  frameFormat: fxSystemFrameworkMigrationPlanAdmissions.frameFormat,
  frameVersion: fxSystemFrameworkMigrationPlanAdmissions.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkMigrationPlanAdmissions.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationPlanAdmissions.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${admissionCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationPlanAdmissions.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkMigrationPlanAdmissionRow,
  unknown
>;

const admissionAssignmentReadSelection = {
  admissionStorageId:
    fxSystemFrameworkMigrationAdmissionAssignments.admissionStorageId,
  collisionStorageId:
    fxSystemFrameworkMigrationAdmissionAssignments.collisionStorageId,
  assignmentOrdinal:
    fxSystemFrameworkMigrationAdmissionAssignments.assignmentOrdinal,
  assignmentStorageId:
    fxSystemFrameworkMigrationAdmissionAssignments.assignmentStorageId,
  spelling: fxSystemFrameworkMigrationAdmissionAssignments.spelling,
  assignmentSha256:
    fxSystemFrameworkMigrationAdmissionAssignments.assignmentSha256,
} as const satisfies Record<
  keyof StoredFrameworkMigrationAdmissionAssignmentRow,
  unknown
>;

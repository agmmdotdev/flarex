import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  capturePrivateCanonicalValue,
} from "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredSha256HexResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  classifyRelationalPhysicalNameAssignmentReplay,
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
  verifyStoredRelationalPhysicalValue,
} from "../relationalSchema/physical/canonical";
import type { RelationalPhysicalValueError } from
  "../relationalSchema/physical/errors";
import {
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
  type RelationalPhysicalNameAssignment,
  type RelationalPhysicalNameAssignmentFrame,
} from "../relationalSchema/physical/model";
import {
  isStoredRelationalPhysicalNameAssignmentFrame,
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS,
} from "../relationalSchema/physical/storedValidation";
import type { FrameworkMigrationValueError } from "./errors";
import type {
  FrameworkMigrationCollisionCoordinate,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import {
  fxSystemRelationalPhysicalNameAssignments,
} from "./schema";
import {
  isRestoredFrameworkMigrationCollisionDomain,
  restoreStoredRelationalPhysicalNameAssignment,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredRelationalPhysicalNameAssignment,
  type StoredRelationalPhysicalNameAssignmentRow,
} from "./storedRestoration";
import {
  readFrameworkMigrationCollisionDomainForOperationInTransactionEffect,
  readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect,
} from "./targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";

type PhysicalNameAssignmentRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  | "ensurePhysicalNameAssignment"
  | "readPhysicalNameAssignment"
  | "ensurePlan"
  | "readPlan"
  | "ensureAdmission"
  | "readAdmission"
  | "ensureAttemptStart"
  | "readAttemptStart"
>;

const PHYSICAL_NAME_ASSIGNMENT_READ_BATCH_SIZE = 512;

interface PreparedPhysicalNameAssignment {
  readonly assignment: RelationalPhysicalNameAssignment;
  readonly assignmentSha256Bytes: Uint8Array;
  readonly nameSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface PhysicalNameAssignmentOccupantLookups {
  readonly readByDigest: () => Effect.Effect<
    Option.Option<RestoredRelationalPhysicalNameAssignment>,
    FrameworkMigrationRepositoryError
  >;
  readonly readBySpelling: () => Effect.Effect<
    Option.Option<RestoredRelationalPhysicalNameAssignment>,
    FrameworkMigrationRepositoryError
  >;
}

interface PhysicalNameAssignmentDriverRow
  extends StoredRelationalPhysicalNameAssignmentRow {
  readonly assignmentStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly physicalDatabaseIdentity: string;
  readonly schemaName: string;
  readonly spelling: string;
  readonly nameSha256: Uint8Array;
  readonly assignmentSha256: Uint8Array;
  readonly frameFormat: typeof RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT;
  readonly frameVersion: typeof RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

export const ensureRelationalPhysicalNameAssignmentInTransactionEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.ensure",
  )(function* (
    transaction: FlarexMetadataTransaction,
    collision: RestoredFrameworkMigrationCollisionDomain,
    expectedAssignment: RelationalPhysicalNameAssignment,
  ): Effect.fn.Return<
    RestoredRelationalPhysicalNameAssignment,
    FrameworkMigrationRepositoryError
  > {
    const operation = "ensurePhysicalNameAssignment" as const;
    const expected = yield* prepareExpectedAssignment(
      expectedAssignment,
      operation,
    );
    const storedCollision = yield* requireStoredCollision(
      transaction,
      collision,
      operation,
    );
    if (!assignmentBelongsToCollision(
      expected.assignment.frame,
      storedCollision.coordinate,
    )) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }

    const statement = transaction.insert(
      fxSystemRelationalPhysicalNameAssignments,
    ).values({
      collisionStorageId: storedCollision.storageId,
      physicalDatabaseIdentity:
        storedCollision.coordinate.targetNamespace.physicalDatabaseIdentity,
      schemaName: storedCollision.coordinate.targetNamespace.schemaName,
      spelling: expected.assignment.frame.spelling,
      nameSha256: expected.nameSha256Bytes,
      assignmentSha256: expected.assignmentSha256Bytes,
      frameFormat: expected.assignment.frame.format,
      frameVersion: expected.assignment.frame.version,
      canonicalByteLength: expected.canonicalBytes.byteLength,
      canonicalBytes: expected.canonicalBytes,
    }).onConflictDoNothing();
    yield* runRepositoryStatement(operation, statement);

    const resolved = yield* resolveExpectedAssignment(
      transaction,
      storedCollision,
      expected.assignment,
      expected.assignmentSha256Bytes,
      operation,
    );
    if (Option.isNone(resolved)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    }
    return resolved.value;
  });

export const readRelationalPhysicalNameAssignmentInTransactionEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.read",
  )(function* (
    transaction: FlarexMetadataTransaction,
    collision: RestoredFrameworkMigrationCollisionDomain,
    expectedAssignment: RelationalPhysicalNameAssignment,
  ): Effect.fn.Return<
    Option.Option<RestoredRelationalPhysicalNameAssignment>,
    FrameworkMigrationRepositoryError
  > {
    const operation = "readPhysicalNameAssignment" as const;
    const expected = yield* prepareExpectedAssignment(
      expectedAssignment,
      operation,
    );
    const storedCollision = yield* requireStoredCollision(
      transaction,
      collision,
      operation,
    );
    if (!assignmentBelongsToCollision(
      expected.assignment.frame,
      storedCollision.coordinate,
    )) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    return yield* resolveExpectedAssignment(
      transaction,
      storedCollision,
      expected.assignment,
      expected.assignmentSha256Bytes,
      operation,
    );
  });

const prepareExpectedAssignment = Effect.fn(
  "RelationalPhysicalNameAssignmentRepository.prepareExpected",
)(function* (
  input: RelationalPhysicalNameAssignment,
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<
  PreparedPhysicalNameAssignment,
  FrameworkMigrationRepositoryError
> {
  const captured = yield* capturePrivateCanonicalValue(
    input.frame,
    MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== input.assignmentSha256 ||
    captured.canonicalJson !== input.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const verifiedFrame = yield* verifyStoredRelationalPhysicalValue({
    kind: "nameAssignment",
    canonicalBytes: captured.copyCanonicalBytes(),
    sha256Hex: captured.sha256Hex,
  }).pipe(Effect.mapError(error => mapExpectedPhysicalError(
    operation,
    error,
  )));
  if (!isStoredRelationalPhysicalNameAssignmentFrame(verifiedFrame)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const assignment = Object.freeze({
    frame: verifiedFrame,
    assignmentSha256: input.assignmentSha256,
    canonicalJson: captured.canonicalJson,
  });
  const assignmentSha256Bytes = yield* Effect.fromResult(
    Encoding.decodeHex(assignment.assignmentSha256),
  ).pipe(Effect.orDie);
  const nameSha256Bytes = yield* Effect.fromResult(
    Encoding.decodeHex(assignment.frame.nameSha256),
  ).pipe(Effect.orDie);
  return Object.freeze({
    assignment,
    assignmentSha256Bytes,
    nameSha256Bytes,
    canonicalBytes: captured.copyCanonicalBytes(),
  });
});

const requireStoredCollision = Effect.fn(
  "RelationalPhysicalNameAssignmentRepository.requireCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkMigrationCollisionDomain(collision)) {
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

const resolveExpectedAssignment = Effect.fn(
  "RelationalPhysicalNameAssignmentRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  expected: RelationalPhysicalNameAssignment,
  assignmentSha256Bytes: Uint8Array,
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredRelationalPhysicalNameAssignment>,
  FrameworkMigrationRepositoryError
> {
  return yield*
    resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect(
      collision,
      expected,
      operation,
      {
        readByDigest: () => loadAssignmentByDigest(
          transaction,
          collision,
          assignmentSha256Bytes,
          operation,
        ),
        readBySpelling: () => loadAssignmentBySpelling(
          transaction,
          collision,
          expected.frame.spelling,
          operation,
        ),
      },
    );
});

/**
 * Source-private policy seam for authenticated occupants returned by the two
 * global uniqueness lookups. Keeping the spelling lookup lazy makes digest
 * conflicts authoritative without requiring a realizable SHA-256 collision
 * fixture.
 */
export const resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.resolveOccupants",
  )(function* (
    collision: RestoredFrameworkMigrationCollisionDomain,
    expected: RelationalPhysicalNameAssignment,
    operation: PhysicalNameAssignmentRepositoryOperation,
    lookups: PhysicalNameAssignmentOccupantLookups,
  ): Effect.fn.Return<
    Option.Option<RestoredRelationalPhysicalNameAssignment>,
    FrameworkMigrationRepositoryError
  > {
    const byDigest = yield* lookups.readByDigest();
    if (Option.isSome(byDigest)) {
      if (assignmentsExactlyEqual(byDigest.value, collision, expected)) {
        return byDigest;
      }
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    }

    const bySpelling = yield* lookups.readBySpelling();
    if (Option.isNone(bySpelling)) return Option.none();
    if (assignmentsExactlyEqual(bySpelling.value, collision, expected)) {
      return bySpelling;
    }
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.physicalNameCollision(
        operation,
        expected.frame.spelling,
      ),
    );
  });

const loadAssignmentByDigest = Effect.fn(
  "RelationalPhysicalNameAssignmentRepository.loadByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  assignmentSha256Bytes: Uint8Array,
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredRelationalPhysicalNameAssignment>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(assignmentReadSelection).from(
    fxSystemRelationalPhysicalNameAssignments,
  ).where(eq(
    fxSystemRelationalPhysicalNameAssignments.assignmentSha256,
    assignmentSha256Bytes,
  )).limit(1);
  return yield* loadAssignmentRow(transaction, collision, query, operation);
});

const loadAssignmentBySpelling = Effect.fn(
  "RelationalPhysicalNameAssignmentRepository.loadBySpelling",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  spelling: string,
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredRelationalPhysicalNameAssignment>,
  FrameworkMigrationRepositoryError
> {
  const target = collision.coordinate.targetNamespace;
  const query = transaction.select(assignmentReadSelection).from(
    fxSystemRelationalPhysicalNameAssignments,
  ).where(and(
    eq(
      fxSystemRelationalPhysicalNameAssignments.physicalDatabaseIdentity,
      target.physicalDatabaseIdentity,
    ),
    eq(fxSystemRelationalPhysicalNameAssignments.schemaName, target.schemaName),
    eq(fxSystemRelationalPhysicalNameAssignments.spelling, spelling),
  )).limit(1);
  return yield* loadAssignmentRow(transaction, collision, query, operation);
});

const loadAssignmentRow = Effect.fn(
  "RelationalPhysicalNameAssignmentRepository.loadRow",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  query: PromiseLike<readonly PhysicalNameAssignmentDriverRow[]>,
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredRelationalPhysicalNameAssignment>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  const restored = yield*
    restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect(
      transaction,
      row,
      collision,
      operation,
    );
  return Option.some(restored);
});

export const restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.restoreOccupant",
  )(function* (
    transaction: FlarexMetadataTransaction,
    row: StoredRelationalPhysicalNameAssignmentRow,
    incomingCollision: RestoredFrameworkMigrationCollisionDomain,
    operation: PhysicalNameAssignmentRepositoryOperation,
  ): Effect.fn.Return<
    RestoredRelationalPhysicalNameAssignment,
    FrameworkMigrationRepositoryError
  > {
    if (row.collisionStorageId === incomingCollision.storageId) {
      return yield* restoreStoredRelationalPhysicalNameAssignment(
        row,
        incomingCollision,
      ).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
    }

    const assignmentSha256 = yield* Effect.fromResult(
      decodeStoredSha256HexResult(
        row.assignmentSha256,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    const frame = yield* verifyStoredRelationalPhysicalValue({
      kind: "nameAssignment",
      canonicalBytes: row.canonicalBytes,
      sha256Hex: assignmentSha256,
    }).pipe(Effect.mapError(error => mapStoredPhysicalError(operation, error)));
    if (!isStoredRelationalPhysicalNameAssignmentFrame(frame)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const targetValue = yield* captureFrameworkSchemaTargetNamespace({
      deploymentId: frame.targetNamespace.deploymentId,
      physicalDatabaseIdentity:
        frame.targetNamespace.physicalDatabaseIdentity,
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
    const coordinate = Object.freeze({
      targetNamespace: frame.targetNamespace,
      owner: frame.name.owner,
      lineageId: frame.name.lineageId,
      physicalNamespaceProfile: frame.name.physicalNamespaceProfile,
    } satisfies FrameworkMigrationCollisionCoordinate);
    const actualCollision = yield*
      readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
        transaction,
        target.value,
        coordinate,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      ));
    if (Option.isNone(actualCollision)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return yield* restoreStoredRelationalPhysicalNameAssignment(
      row,
      actualCollision.value,
    ).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  });

export const readRelationalPhysicalNameAssignmentOccupantsBySpellingInTransactionEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.readOccupantsBySpelling",
  )(function* (
    transaction: FlarexMetadataTransaction,
    collision: RestoredFrameworkMigrationCollisionDomain,
    spellings: readonly string[],
    mode: "prerequisite" | "stored",
    operation: PhysicalNameAssignmentRepositoryOperation,
  ): Effect.fn.Return<
    readonly RestoredRelationalPhysicalNameAssignment[],
    FrameworkMigrationRepositoryError
  > {
    if (
      !isRestoredFrameworkMigrationCollisionDomain(collision) ||
      spellings.length > MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS ||
      new Set(spellings).size !== spellings.length
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }

    const target = collision.coordinate.targetNamespace;
    const restored: RestoredRelationalPhysicalNameAssignment[] = [];
    for (
      let offset = 0;
      offset < spellings.length;
      offset += PHYSICAL_NAME_ASSIGNMENT_READ_BATCH_SIZE
    ) {
      const batch = spellings.slice(
        offset,
        offset + PHYSICAL_NAME_ASSIGNMENT_READ_BATCH_SIZE,
      );
      if (batch.length === 0) continue;
      const query = transaction.select(assignmentReadSelection).from(
        fxSystemRelationalPhysicalNameAssignments,
      ).where(and(
        eq(
          fxSystemRelationalPhysicalNameAssignments.physicalDatabaseIdentity,
          target.physicalDatabaseIdentity,
        ),
        eq(
          fxSystemRelationalPhysicalNameAssignments.schemaName,
          target.schemaName,
        ),
        inArray(
          fxSystemRelationalPhysicalNameAssignments.spelling,
          batch,
        ),
      )).limit(batch.length + 1);
      const rows = yield* runRepositoryStatement(operation, query).pipe(
        Effect.map(detachDriverRows),
      );
      if (rows.length > batch.length) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      for (const row of rows) {
        const occupant = yield*
          restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect(
            transaction,
            row,
            collision,
            operation,
          );
        if (occupant.collision.storageId !== collision.storageId) {
          return yield* Effect.fail(mode === "prerequisite"
            ? FrameworkMigrationRepositoryError.physicalNameCollision(
              operation,
              occupant.assignment.frame.spelling,
            )
            : FrameworkMigrationRepositoryError.storedCorruption(operation));
        }
        restored.push(occupant);
      }
    }
    return Object.freeze(restored);
  });

function runRepositoryStatement<Value>(
  operation: PhysicalNameAssignmentRepositoryOperation,
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

function mapExpectedPhysicalError(
  operation: PhysicalNameAssignmentRepositoryOperation,
  error: RelationalPhysicalValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
    : FrameworkMigrationRepositoryError.referenceRefusal(operation);
}

function mapStoredPhysicalError(
  operation: PhysicalNameAssignmentRepositoryOperation,
  error: RelationalPhysicalValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function mapStoredValueError(
  operation: PhysicalNameAssignmentRepositoryOperation,
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
  operation: PhysicalNameAssignmentRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function assignmentBelongsToCollision(
  assignment: RelationalPhysicalNameAssignmentFrame,
  collision: FrameworkMigrationCollisionCoordinate,
): boolean {
  return sameTargetNamespaceFrame(
    assignment.targetNamespace,
    collision.targetNamespace,
  ) && assignment.name.owner === collision.owner &&
    assignment.name.lineageId === collision.lineageId &&
    assignment.name.physicalNamespaceProfile ===
      collision.physicalNamespaceProfile;
}

function assignmentsExactlyEqual(
  stored: RestoredRelationalPhysicalNameAssignment,
  collision: RestoredFrameworkMigrationCollisionDomain,
  expected: RelationalPhysicalNameAssignment,
): boolean {
  return stored.collision.storageId === collision.storageId &&
    stored.assignment.assignmentSha256 === expected.assignmentSha256 &&
    stored.assignment.canonicalJson === expected.canonicalJson &&
    classifyRelationalPhysicalNameAssignmentReplay(
        stored.assignment.frame,
        expected.frame,
      ) === "exact";
}

function sameTargetNamespaceFrame(
  left: RelationalPhysicalNameAssignmentFrame["targetNamespace"],
  right: RelationalPhysicalNameAssignmentFrame["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

const assignmentCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemRelationalPhysicalNameAssignments.canonicalBytes})
    <= ${MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES}
`;

const assignmentReadSelection = {
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
    octet_length(${fxSystemRelationalPhysicalNameAssignments.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${assignmentCanonicalBytesWithinReadBounds}
      then ${fxSystemRelationalPhysicalNameAssignments.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredRelationalPhysicalNameAssignmentRow,
  unknown
>;

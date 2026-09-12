import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Encoding, Option, Schema } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";

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
  MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
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

type PhysicalNameAssignmentOwnerRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensurePhysicalNameAssignment" | "readPhysicalNameAssignment"
>;

type PhysicalNameAssignmentRepositoryOperation =
  FrameworkMigrationRepositoryOperation;

const PHYSICAL_NAME_ASSIGNMENT_READ_BATCH_SIZE = 512;

export interface PhysicalNameAssignmentReadExpectation {
  readonly frame: RelationalPhysicalNameAssignmentFrame;
  readonly assignmentSha256: string;
  readonly canonicalJson: string;
}

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

// Bound prepared evidence by the owning layout limit, and each SQL statement by
// both row count and canonical bytes. These are transport batches, not a cache.
const ASSIGNMENT_WRITE_BATCH_ROWS = 64;
const ASSIGNMENT_WRITE_BATCH_BYTES = 262_144;
const isAssignmentInventory = Schema.is(
  Schema.Array(Schema.Unknown).check(Schema.isMaxLength(MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS)),
);

export const ensureRelationalPhysicalNameAssignmentsInTransactionEffect =
  Effect.fn("RelationalPhysicalNameAssignmentRepository.ensureAll")(function* (
    transaction: FlarexMetadataTransaction,
    collision: RestoredFrameworkMigrationCollisionDomain,
    expectedAssignments: readonly RelationalPhysicalNameAssignment[],
  ): Effect.fn.Return<readonly RestoredRelationalPhysicalNameAssignment[], FrameworkMigrationRepositoryError> {
    const operation = "ensurePhysicalNameAssignment" as const;
    if (!isAssignmentInventory(expectedAssignments) || !isRestoredFrameworkMigrationCollisionDomain(collision)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    const inputs = [...expectedAssignments];
    const prepared: PreparedPhysicalNameAssignment[] = [];
    let bytes = 0;
    // Validate supplied evidence in input order before issuing any writes.
    for (const input of inputs) {
      const value = yield* prepareExpectedAssignment(input, operation);
      bytes += value.canonicalBytes.byteLength;
      if (bytes > MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES ||
        !assignmentBelongsToCollision(value.assignment.frame, collision.coordinate)) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
      }
      prepared.push(value);
    }
    if (prepared.length === 0) return Object.freeze([]);
    const storedCollision = yield* requireStoredCollision(transaction, collision, operation);
    // Global digest order makes overlapping inventories acquire unique-index
    // conflicts in the same order, independent of caller order and chunk size.
    const insertOrder = prepared.toSorted((left, right) =>
      compareUtf16Strings(left.assignment.assignmentSha256, right.assignment.assignmentSha256));
    for (const batch of assignmentBatches(insertOrder)) {
      yield* runRepositoryStatement(operation, transaction.insert(fxSystemRelationalPhysicalNameAssignments)
        .values(batch.map(expected => ({
          collisionStorageId: storedCollision.storageId,
          physicalDatabaseIdentity: storedCollision.coordinate.targetNamespace.physicalDatabaseIdentity,
          schemaName: storedCollision.coordinate.targetNamespace.schemaName,
          spelling: expected.assignment.frame.spelling,
          nameSha256: expected.nameSha256Bytes,
          assignmentSha256: expected.assignmentSha256Bytes,
          frameFormat: expected.assignment.frame.format,
          frameVersion: expected.assignment.frame.version,
          canonicalByteLength: expected.canonicalBytes.byteLength,
          canonicalBytes: expected.canonicalBytes,
        }))).onConflictDoNothing());
    }
    // All writes precede these fresh reads. No fetched row or restored reference
    // is reused across a subsequent write. Conflict verdicts retain input order.
    const restored: RestoredRelationalPhysicalNameAssignment[] = [];
    for (const batch of assignmentBatches(prepared)) {
      restored.push(...yield* readEnsuredAssignmentBatch(transaction, storedCollision, batch));
    }
    return Object.freeze(restored);
  });

function* assignmentBatches(values: readonly PreparedPhysicalNameAssignment[]) {
  let batch: PreparedPhysicalNameAssignment[] = [];
  let bytes = 0;
  for (const value of values) {
    if (batch.length >= ASSIGNMENT_WRITE_BATCH_ROWS ||
      bytes + value.canonicalBytes.byteLength > ASSIGNMENT_WRITE_BATCH_BYTES) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(value);
    bytes += value.canonicalBytes.byteLength;
  }
  if (batch.length !== 0) yield batch;
}

const readEnsuredAssignmentBatch = Effect.fn("RelationalPhysicalNameAssignmentRepository.readEnsuredBatch")(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  expected: readonly PreparedPhysicalNameAssignment[],
): Effect.fn.Return<readonly RestoredRelationalPhysicalNameAssignment[], FrameworkMigrationRepositoryError> {
  const operation = "ensurePhysicalNameAssignment" as const;
  const table = fxSystemRelationalPhysicalNameAssignments;
  const requested = new Set<string>(expected.map(value => value.assignment.assignmentSha256));
  const rows = yield* runRepositoryStatement(operation, transaction.select(assignmentReadSelection).from(table)
    .where(inArray(table.assignmentSha256, expected.map(value => value.assignmentSha256Bytes)))
    .limit(requested.size + 1)).pipe(Effect.map(detachDriverRows));
  const byDigest = new Map<string, PhysicalNameAssignmentDriverRow>();
  for (const row of rows) {
    const digest = yield* Effect.fromResult(decodeStoredSha256HexResult(row.assignmentSha256,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation)));
    if (!requested.has(digest) || byDigest.has(digest)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    byDigest.set(digest, row);
  }
  const restore = (row: PhysicalNameAssignmentDriverRow | undefined) => row === undefined
    ? Effect.succeed(Option.none<RestoredRelationalPhysicalNameAssignment>())
    : restoreRelationalPhysicalNameAssignmentOccupantInTransactionEffect(transaction, row, collision, operation)
      .pipe(Effect.map(Option.some));
  let bySpelling: Map<string, PhysicalNameAssignmentDriverRow> | undefined;
  const readBySpelling = Effect.fn("RelationalPhysicalNameAssignmentRepository.readEnsuredSpelling")(function* (spelling: string) {
    if (bySpelling === undefined) {
      const spellings = new Set(expected.filter(value => !byDigest.has(value.assignment.assignmentSha256))
        .map(value => value.assignment.frame.spelling));
      const spellingRows = yield* runRepositoryStatement(operation, transaction.select(assignmentReadSelection).from(table)
        .where(and(eq(table.physicalDatabaseIdentity, collision.coordinate.targetNamespace.physicalDatabaseIdentity),
          eq(table.schemaName, collision.coordinate.targetNamespace.schemaName), inArray(table.spelling, [...spellings])))
        .limit(spellings.size + 1)).pipe(Effect.map(detachDriverRows));
      bySpelling = new Map();
      for (const row of spellingRows) {
        if (!spellings.has(row.spelling) || bySpelling.has(row.spelling)) {
          return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
        }
        bySpelling.set(row.spelling, row);
      }
    }
    return yield* restore(bySpelling.get(spelling));
  });
  const restored: RestoredRelationalPhysicalNameAssignment[] = [];
  for (const value of expected) {
    const resolved = yield* resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsForOperationEffect(
      collision, value.assignment, operation, {
        readByDigest: () => restore(byDigest.get(value.assignment.assignmentSha256)),
        readBySpelling: () => readBySpelling(value.assignment.frame.spelling),
      });
    if (Option.isNone(resolved)) return yield* Effect.fail(FrameworkMigrationRepositoryError.immutableConflict(operation));
    restored.push(resolved.value);
  }
  return restored;
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
    resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsForOperationEffect(
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
const resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsForOperationEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.resolveOccupantsForOperation",
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

export const resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsEffect =
  Effect.fn(
    "RelationalPhysicalNameAssignmentRepository.resolveOccupants",
  )(function* (
    collision: RestoredFrameworkMigrationCollisionDomain,
    expected: RelationalPhysicalNameAssignment,
    operation: PhysicalNameAssignmentOwnerRepositoryOperation,
    lookups: PhysicalNameAssignmentOccupantLookups,
  ): Effect.fn.Return<
    Option.Option<RestoredRelationalPhysicalNameAssignment>,
    FrameworkMigrationRepositoryError
  > {
    return yield*
      resolveAuthenticatedRelationalPhysicalNameAssignmentOccupantsForOperationEffect(
        collision,
        expected,
        operation,
        lookups,
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
    expectations?: readonly PhysicalNameAssignmentReadExpectation[],
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
      const exactRows = expectations === undefined ? Option.none<readonly StoredRelationalPhysicalNameAssignmentRow[]>() :
        yield* readExactAssignmentRows(transaction, collision, batch,
          expectations.slice(offset, offset + batch.length), operation);
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
      const rows = Option.isSome(exactRows) ? exactRows.value : yield* runRepositoryStatement(operation, query).pipe(
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

/** An exact database comparison reduces transport, without retaining occupants.
 * Nonmatching inventories use the ordinary authenticated read so collision and
 * corruption classification still derives from the actual stored values. */
const readExactAssignmentRows = Effect.fn("RelationalPhysicalNameAssignmentRepository.readExactRows")(function* (
  transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain,
  spellings: readonly string[], expectations: readonly PhysicalNameAssignmentReadExpectation[],
  operation: PhysicalNameAssignmentRepositoryOperation,
): Effect.fn.Return<Option.Option<readonly StoredRelationalPhysicalNameAssignmentRow[]>, FrameworkMigrationRepositoryError> {
  if (expectations.length !== spellings.length || expectations.some((value, index) => value.frame.spelling !== spellings[index])) return Option.none();
  const table = fxSystemRelationalPhysicalNameAssignments;
  const expected = expectations.map(value => ({ spelling: value.frame.spelling, canonical_json: value.canonicalJson,
    assignment_sha256: value.assignmentSha256, name_sha256: value.frame.nameSha256,
    frame_format: value.frame.format, frame_version: value.frame.version }));
  const exact = sql<boolean>`
    ${table.collisionStorageId} = ${collision.storageId}
    and ${table.physicalDatabaseIdentity} = ${collision.coordinate.targetNamespace.physicalDatabaseIdentity}
    and ${table.schemaName} = ${collision.coordinate.targetNamespace.schemaName}
    and ${table.assignmentSha256} = decode(expected.assignment_sha256, 'hex')
    and ${table.nameSha256} = decode(expected.name_sha256, 'hex')
    and ${table.frameFormat} = expected.frame_format and ${table.frameVersion} = expected.frame_version
    and ${table.canonicalBytes} = convert_to(expected.canonical_json, 'UTF8')
    and ${table.canonicalByteLength} = octet_length(convert_to(expected.canonical_json, 'UTF8'))
  `;
  const candidates = yield* runRepositoryStatement(operation, transaction.select({
    storageId: table.assignmentStorageId, spelling: table.spelling, matchesExpected: exact,
  }).from(table).leftJoin(sql`jsonb_to_recordset(${JSON.stringify(expected)}::jsonb) as expected(
    spelling text, canonical_json text, assignment_sha256 text, name_sha256 text, frame_format text, frame_version integer)`,
    sql`${table.spelling} = expected.spelling`).where(and(
      eq(table.physicalDatabaseIdentity, collision.coordinate.targetNamespace.physicalDatabaseIdentity),
      eq(table.schemaName, collision.coordinate.targetNamespace.schemaName), inArray(table.spelling, [...spellings]),
    )).limit(spellings.length + 1)).pipe(Effect.map(detachDriverRows));
  if (candidates.length !== spellings.length || candidates.some(value => value.matchesExpected !== true) ||
    new Set(candidates.map(value => value.spelling)).size !== spellings.length) return Option.none();
  const bySpelling = new Map(expectations.map(value => [value.frame.spelling, value]));
  const rows: StoredRelationalPhysicalNameAssignmentRow[] = [];
  for (const candidate of candidates) {
    const value = bySpelling.get(candidate.spelling);
    if (value === undefined) return Option.none();
    const bytes = new TextEncoder().encode(value.canonicalJson);
    const assignmentSha256 = yield* Effect.fromResult(Encoding.decodeHex(value.assignmentSha256)).pipe(
      Effect.mapError(() => FrameworkMigrationRepositoryError.referenceRefusal(operation)));
    const nameSha256 = yield* Effect.fromResult(Encoding.decodeHex(value.frame.nameSha256)).pipe(
      Effect.mapError(() => FrameworkMigrationRepositoryError.referenceRefusal(operation)));
    rows.push({ assignmentStorageId: candidate.storageId, collisionStorageId: collision.storageId,
      physicalDatabaseIdentity: collision.coordinate.targetNamespace.physicalDatabaseIdentity,
      schemaName: collision.coordinate.targetNamespace.schemaName, spelling: candidate.spelling,
      assignmentSha256, nameSha256, frameFormat: value.frame.format, frameVersion: value.frame.version,
      canonicalByteLength: bytes.byteLength, observedCanonicalByteLength: bytes.byteLength, canonicalBytes: bytes });
  }
  return Option.some(Object.freeze(rows));
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

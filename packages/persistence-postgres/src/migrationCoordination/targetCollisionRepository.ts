import { and, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  isCapturedFreshRelationalMigrationPlan,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type {
  FrameworkMigrationCollisionCoordinate,
  FreshRelationalMigrationPlan,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import {
  fxSystemFrameworkMigrationCollisionDomains,
  fxSystemFrameworkSchemaTargetNamespaces,
} from "./schema";
import {
  isRestoredFrameworkSchemaTargetNamespace,
  restoreStoredFrameworkMigrationCollisionDomain,
  restoreStoredFrameworkSchemaTargetNamespace,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkSchemaTargetNamespace,
  type StoredFrameworkMigrationCollisionDomainRow,
  type StoredFrameworkSchemaTargetNamespaceRow,
} from "./storedRestoration";
import { isStoredCollisionCoordinate } from "./storedValidation";
import {
  captureFrameworkSchemaTargetNamespace,
  frameworkSchemaTargetNamespacesEqual,
  MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
  type FrameworkSchemaTargetNamespace,
} from "./targetNamespace";

const UTF8 = new TextEncoder();

export const ensureFrameworkSchemaTargetNamespaceInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationTargetRepository.ensure",
  )(function* (
    transaction: FlarexMetadataTransaction,
    input: FrameworkSchemaTargetNamespace,
  ): Effect.fn.Return<
    RestoredFrameworkSchemaTargetNamespace,
    FrameworkMigrationRepositoryError
  > {
    const expected = yield* authenticateTargetNamespace(
      input,
      "ensureTargetNamespace",
    );
    const targetNamespaceSha256 = yield* Effect.fromResult(
      Encoding.decodeHex(expected.targetNamespaceSha256),
    ).pipe(Effect.orDie);
    const canonicalBytes = UTF8.encode(expected.canonicalJson);
    const statement = transaction.insert(
      fxSystemFrameworkSchemaTargetNamespaces,
    ).values({
      deploymentId: expected.frame.deploymentId,
      physicalDatabaseIdentity: expected.frame.physicalDatabaseIdentity,
      schemaName: expected.frame.schemaName,
      targetNamespaceSha256,
      frameFormat: expected.frame.format,
      frameVersion: expected.frame.version,
      canonicalByteLength: canonicalBytes.byteLength,
      canonicalBytes,
    }).onConflictDoNothing();
    yield* runRepositoryStatement(
      "ensureTargetNamespace",
      statement,
    );
    const restored = yield* loadExactTargetNamespace(
      transaction,
      expected,
      "ensureTargetNamespace",
    );
    if (Option.isNone(restored)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(
          "ensureTargetNamespace",
        ),
      );
    }
    return restored.value;
  });

export const readFrameworkSchemaTargetNamespaceInTransactionEffect = Effect.fn(
  "FrameworkMigrationTargetRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  input: FrameworkSchemaTargetNamespace,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaTargetNamespace>,
  FrameworkMigrationRepositoryError
> {
  const expected = yield* authenticateTargetNamespace(
    input,
    "readTargetNamespace",
  );
  return yield* loadExactTargetNamespace(
    transaction,
    expected,
    "readTargetNamespace",
  );
});

export const ensureFrameworkMigrationCollisionDomainInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationCollisionRepository.ensure",
  )(function* (
    transaction: FlarexMetadataTransaction,
    targetNamespace: RestoredFrameworkSchemaTargetNamespace,
    plan: FreshRelationalMigrationPlan,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationCollisionDomain,
    FrameworkMigrationRepositoryError
  > {
    if (
      !isRestoredFrameworkSchemaTargetNamespace(targetNamespace) ||
      !isCapturedFreshRelationalMigrationPlan(plan) ||
      !sameTargetNamespaceFrame(
        targetNamespace.targetNamespace.frame,
        plan.frame.collision.targetNamespace,
      )
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(
          "ensureCollisionDomain",
        ),
      );
    }
    const storedTargetNamespace = yield* requireStoredTargetNamespace(
      transaction,
      targetNamespace,
      "ensureCollisionDomain",
    );
    const coordinate = plan.frame.collision;
    const statement = transaction.insert(
      fxSystemFrameworkMigrationCollisionDomains,
    ).values({
      targetNamespaceStorageId: storedTargetNamespace.storageId,
      physicalDatabaseIdentity:
        storedTargetNamespace.targetNamespace.frame.physicalDatabaseIdentity,
      schemaName: storedTargetNamespace.targetNamespace.frame.schemaName,
      owner: coordinate.owner,
      lineageId: coordinate.lineageId,
      physicalNamespaceProfile: coordinate.physicalNamespaceProfile,
    }).onConflictDoNothing();
    yield* runRepositoryStatement("ensureCollisionDomain", statement);
    const restored = yield* loadExactCollisionDomain(
      transaction,
      storedTargetNamespace,
      coordinate,
      "ensureCollisionDomain",
    );
    if (Option.isNone(restored)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(
          "ensureCollisionDomain",
        ),
      );
    }
    return restored.value;
  });

export const readFrameworkMigrationCollisionDomainInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationCollisionRepository.read",
  )(function* (
    transaction: FlarexMetadataTransaction,
    targetNamespace: RestoredFrameworkSchemaTargetNamespace,
    coordinate: FrameworkMigrationCollisionCoordinate,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationCollisionDomain>,
    FrameworkMigrationRepositoryError
  > {
    if (
      !isRestoredFrameworkSchemaTargetNamespace(targetNamespace) ||
      !isStoredCollisionCoordinate(coordinate) ||
      !sameTargetNamespaceFrame(
        targetNamespace.targetNamespace.frame,
        coordinate.targetNamespace,
      )
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(
          "readCollisionDomain",
        ),
      );
    }
    const storedTargetNamespace = yield* requireStoredTargetNamespace(
      transaction,
      targetNamespace,
      "readCollisionDomain",
    );
    return yield* loadExactCollisionDomain(
      transaction,
      storedTargetNamespace,
      coordinate,
      "readCollisionDomain",
    );
  });

const authenticateTargetNamespace = Effect.fn(
  "FrameworkMigrationTargetRepository.authenticate",
)(function* (
  input: FrameworkSchemaTargetNamespace,
  operation: Extract<
    FrameworkMigrationRepositoryOperation,
    "ensureTargetNamespace" | "readTargetNamespace"
  >,
): Effect.fn.Return<
  FrameworkSchemaTargetNamespace,
  FrameworkMigrationRepositoryError
> {
  const recaptured = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: input.frame.deploymentId,
    physicalDatabaseIdentity: input.frame.physicalDatabaseIdentity,
    schemaName: input.frame.schemaName,
  }).pipe(Effect.mapError(error => mapInputValueError(operation, error)));
  if (!frameworkSchemaTargetNamespacesEqual(recaptured, input)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return recaptured;
});

const loadExactTargetNamespace = Effect.fn(
  "FrameworkMigrationTargetRepository.loadExact",
)(function* (
  transaction: FlarexMetadataTransaction,
  expected: FrameworkSchemaTargetNamespace,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaTargetNamespace>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(targetNamespaceReadSelection).from(
    fxSystemFrameworkSchemaTargetNamespaces,
  ).where(and(
    eq(
      fxSystemFrameworkSchemaTargetNamespaces.deploymentId,
      expected.frame.deploymentId,
    ),
    eq(
      fxSystemFrameworkSchemaTargetNamespaces.physicalDatabaseIdentity,
      expected.frame.physicalDatabaseIdentity,
    ),
    eq(
      fxSystemFrameworkSchemaTargetNamespaces.schemaName,
      expected.frame.schemaName,
    ),
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  const restored = yield* restoreStoredFrameworkSchemaTargetNamespace(
    row,
  ).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!frameworkSchemaTargetNamespacesEqual(
    restored.targetNamespace,
    expected,
  )) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  }
  return Option.some(restored);
});

const requireStoredTargetNamespace = Effect.fn(
  "FrameworkMigrationCollisionRepository.requireTarget",
)(function* (
  transaction: FlarexMetadataTransaction,
  targetNamespace: RestoredFrameworkSchemaTargetNamespace,
  operation: Extract<
    FrameworkMigrationRepositoryOperation,
    "ensureCollisionDomain" | "readCollisionDomain"
  >,
): Effect.fn.Return<
  RestoredFrameworkSchemaTargetNamespace,
  FrameworkMigrationRepositoryError
> {
  const stored = yield* loadExactTargetNamespace(
    transaction,
    targetNamespace.targetNamespace,
    operation,
  );
  if (
    Option.isNone(stored) ||
    stored.value.storageId !== targetNamespace.storageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return stored.value;
});

const loadExactCollisionDomain = Effect.fn(
  "FrameworkMigrationCollisionRepository.loadExact",
)(function* (
  transaction: FlarexMetadataTransaction,
  targetNamespace: RestoredFrameworkSchemaTargetNamespace,
  coordinate: FrameworkMigrationCollisionCoordinate,
  operation: Extract<
    FrameworkMigrationRepositoryOperation,
    "ensureCollisionDomain" | "readCollisionDomain"
  >,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationCollisionDomain>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(collisionDomainReadSelection).from(
    fxSystemFrameworkMigrationCollisionDomains,
  ).where(and(
    eq(
      fxSystemFrameworkMigrationCollisionDomains.targetNamespaceStorageId,
      targetNamespace.storageId,
    ),
    eq(fxSystemFrameworkMigrationCollisionDomains.owner, coordinate.owner),
    eq(
      fxSystemFrameworkMigrationCollisionDomains.lineageId,
      coordinate.lineageId,
    ),
    eq(
      fxSystemFrameworkMigrationCollisionDomains.physicalNamespaceProfile,
      coordinate.physicalNamespaceProfile,
    ),
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  const restored = yield* restoreStoredFrameworkMigrationCollisionDomain(
    row,
    targetNamespace,
  ).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!sameCollisionCoordinate(restored.coordinate, coordinate)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  }
  return Option.some(restored);
});

function runRepositoryStatement<Value>(
  operation: FrameworkMigrationRepositoryOperation,
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

function mapInputValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
    : FrameworkMigrationRepositoryError.referenceRefusal(operation);
}

function mapStoredValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
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

const targetCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkSchemaTargetNamespaces.canonicalBytes})
    <= ${MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES}
`;

const targetNamespaceReadSelection = {
  targetNamespaceStorageId:
    fxSystemFrameworkSchemaTargetNamespaces.targetNamespaceStorageId,
  deploymentId: fxSystemFrameworkSchemaTargetNamespaces.deploymentId,
  physicalDatabaseIdentity:
    fxSystemFrameworkSchemaTargetNamespaces.physicalDatabaseIdentity,
  schemaName: fxSystemFrameworkSchemaTargetNamespaces.schemaName,
  targetNamespaceSha256:
    fxSystemFrameworkSchemaTargetNamespaces.targetNamespaceSha256,
  frameFormat: fxSystemFrameworkSchemaTargetNamespaces.frameFormat,
  frameVersion: fxSystemFrameworkSchemaTargetNamespaces.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkSchemaTargetNamespaces.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkSchemaTargetNamespaces.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${targetCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkSchemaTargetNamespaces.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<keyof StoredFrameworkSchemaTargetNamespaceRow, unknown>;

const collisionDomainReadSelection = {
  collisionStorageId:
    fxSystemFrameworkMigrationCollisionDomains.collisionStorageId,
  targetNamespaceStorageId:
    fxSystemFrameworkMigrationCollisionDomains.targetNamespaceStorageId,
  physicalDatabaseIdentity:
    fxSystemFrameworkMigrationCollisionDomains.physicalDatabaseIdentity,
  schemaName: fxSystemFrameworkMigrationCollisionDomains.schemaName,
  owner: fxSystemFrameworkMigrationCollisionDomains.owner,
  lineageId: fxSystemFrameworkMigrationCollisionDomains.lineageId,
  physicalNamespaceProfile:
    fxSystemFrameworkMigrationCollisionDomains.physicalNamespaceProfile,
} as const satisfies Record<keyof StoredFrameworkMigrationCollisionDomainRow, unknown>;

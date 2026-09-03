import { eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type {
  FrameworkSchemaReadinessSha256,
} from "../../migrationCoordination/identity";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "../../migrationCoordination/repositoryErrors";
import type {
  RestoredFrameworkMigrationCollisionDomain,
} from "../../migrationCoordination/storedRestoration";
import { capturePrivateCanonicalValue } from "../privateCanonicalValue";
import {
  decodeStoredStorageIdResult,
} from "../privateStoredMetadataValue";
import {
  capturedAuthorityForFrameworkSchemaReadiness,
} from "./authority";
import {
  MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
} from "./canonical";
import type { FrameworkSchemaInstallationValueError } from "./errors";
import {
  corroborateRestoredFrameworkSchemaInstallationInTransactionEffect,
  restoreStoredFrameworkSchemaInstallationReferenceInTransactionEffect,
} from "./installationRepository";
import {
  FRAMEWORK_SCHEMA_READINESS_FORMAT,
  FRAMEWORK_SCHEMA_READINESS_VERSION,
  type CapturedFrameworkSchemaInstallationValue,
  type FrameworkSchemaReadinessFrame,
} from "./model";
import { fxSystemFrameworkSchemaReadiness } from "./schema";
import {
  isRestoredFrameworkSchemaReadiness,
  isRestoredFrameworkSchemaInstallation,
  restoreStoredFrameworkSchemaReadinessMetadata,
  type RestoredFrameworkSchemaInstallation,
  type RestoredFrameworkSchemaReadiness,
  type StoredFrameworkSchemaReadinessRow,
} from "./storedMetadataRestoration";

type FrameworkSchemaReadiness = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaReadinessFrame,
  FrameworkSchemaReadinessSha256
>;

type ReadinessOwnerRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensureReadiness" | "readReadiness"
>;

interface PreparedFrameworkSchemaReadiness {
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: FrameworkSchemaReadiness;
  readonly installationSha256Bytes: Uint8Array;
  readonly installationReceiptSha256Bytes: Uint8Array;
  readonly readinessSha256Bytes: Uint8Array;
  readonly validationSha256Bytes: Uint8Array;
  readonly validatedStructureSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkSchemaReadinessDriverRow
  extends StoredFrameworkSchemaReadinessRow {
  readonly readinessStorageId: bigint;
  readonly installationStorageId: bigint;
  readonly installationSha256: Uint8Array;
  readonly installationReceiptSha256: Uint8Array;
  readonly readinessSha256: Uint8Array;
  readonly validationSha256: Uint8Array;
  readonly validatedStructureSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_READINESS_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_READINESS_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface FrameworkSchemaReadinessOccupantLookups {
  readonly readByInstallation: () => Effect.Effect<
    Option.Option<RestoredFrameworkSchemaReadiness>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByDigest: () => Effect.Effect<
    Option.Option<RestoredFrameworkSchemaReadiness>,
    FrameworkMigrationRepositoryError
  >;
}

export const ensureFrameworkSchemaReadinessInTransactionEffect = Effect.fn(
  "FrameworkSchemaReadinessRepository.ensure",
)(function* (
  transaction: FlarexMetadataTransaction,
  installation: RestoredFrameworkSchemaInstallation,
  readiness: FrameworkSchemaReadiness,
): Effect.fn.Return<
  RestoredFrameworkSchemaReadiness,
  FrameworkMigrationRepositoryError
> {
  const operation = "ensureReadiness" as const;
  const prepared = yield* prepareExpectedReadiness(
    installation,
    readiness,
    operation,
  );
  const storedInstallation = yield*
    corroborateRestoredFrameworkSchemaInstallationInTransactionEffect(
      transaction,
      prepared.installation,
      operation,
    );

  const insertedRows = yield* runRepositoryStatement(
    operation,
    transaction.insert(fxSystemFrameworkSchemaReadiness).values({
      installationStorageId: storedInstallation.storageId,
      installationSha256: prepared.installationSha256Bytes,
      installationReceiptSha256:
        prepared.installationReceiptSha256Bytes,
      readinessSha256: prepared.readinessSha256Bytes,
      validationSha256: prepared.validationSha256Bytes,
      validatedStructureSha256: prepared.validatedStructureSha256Bytes,
      frameFormat: prepared.readiness.frame.format,
      frameVersion: prepared.readiness.frame.version,
      canonicalByteLength: prepared.canonicalBytes.byteLength,
      canonicalBytes: prepared.canonicalBytes,
    }).onConflictDoNothing().returning({
      readinessStorageId:
        fxSystemFrameworkSchemaReadiness.readinessStorageId,
    }),
  ).pipe(Effect.map(detachDriverRows));
  if (insertedRows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const inserted = insertedRows[0];
  if (inserted !== undefined) {
    yield* Effect.fromResult(decodeStoredStorageIdResult(
      inserted.readinessStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ));
  }

  const resolved = yield* resolveExpectedReadiness(
    transaction,
    storedInstallation,
    prepared.readiness,
    prepared.readinessSha256Bytes,
    operation,
  );
  if (Option.isNone(resolved)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return resolved.value;
});

export const readFrameworkSchemaReadinessInTransactionEffect = Effect.fn(
  "FrameworkSchemaReadinessRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  installation: RestoredFrameworkSchemaInstallation,
  readiness: FrameworkSchemaReadiness,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaReadiness>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readReadiness" as const;
  const prepared = yield* prepareExpectedReadiness(
    installation,
    readiness,
    operation,
  );
  const storedInstallation = yield*
    corroborateRestoredFrameworkSchemaInstallationInTransactionEffect(
      transaction,
      prepared.installation,
      operation,
    );
  return yield* resolveExpectedReadiness(
    transaction,
    storedInstallation,
    prepared.readiness,
    prepared.readinessSha256Bytes,
    operation,
  );
});

/** Source-private semantic-first collision policy for readiness receipts. */
export const resolveAuthenticatedFrameworkSchemaReadinessOccupantsEffect =
  Effect.fn("FrameworkSchemaReadinessRepository.resolveOccupants")(
    function* (
      installation: RestoredFrameworkSchemaInstallation,
      expected: FrameworkSchemaReadiness,
      operation: ReadinessOwnerRepositoryOperation,
      lookups: FrameworkSchemaReadinessOccupantLookups,
    ): Effect.fn.Return<
      Option.Option<RestoredFrameworkSchemaReadiness>,
      FrameworkMigrationRepositoryError
    > {
      const byInstallation = yield* lookups.readByInstallation();
      if (Option.isSome(byInstallation)) {
        if (readinessExactlyMatches(
          byInstallation.value,
          installation,
          expected,
        )) return Option.some(byInstallation.value);
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.immutableConflict(operation),
        );
      }

      const byDigest = yield* lookups.readByDigest();
      if (Option.isNone(byDigest)) return Option.none();
      if (readinessExactlyMatches(byDigest.value, installation, expected)) {
        return Option.some(byDigest.value);
      }
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    },
  );

/** Source-private same-transaction corroboration for downstream aggregates. */
export const corroborateRestoredFrameworkSchemaReadinessInTransactionEffect =
  Effect.fn("FrameworkSchemaReadinessRepository.corroborateRestored")(
    function* (
      transaction: FlarexMetadataTransaction,
      expected: RestoredFrameworkSchemaReadiness,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaReadiness,
      FrameworkMigrationRepositoryError
    > {
      const authority = isRestoredFrameworkSchemaReadiness(expected)
        ? capturedAuthorityForFrameworkSchemaReadiness(expected.readiness)
        : undefined;
      if (
        authority === undefined ||
        authority.installation !== expected.installation.installation
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const installation = yield*
        corroborateRestoredFrameworkSchemaInstallationInTransactionEffect(
          transaction,
          expected.installation,
          operation,
        );
      const row = yield* loadReadinessRootByStorageId(
        transaction,
        expected.storageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const restored = yield* restoreReadinessOccupant(
        transaction,
        row.value,
        installation.collision,
        operation,
      );
      if (!restoredReadinessExactlyMatches(restored, expected)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      return restored;
    },
  );

/** Source-private restoration of a committed readiness receipt by storage ID. */
export const restoreStoredFrameworkSchemaReadinessReferenceInTransactionEffect =
  Effect.fn("FrameworkSchemaReadinessRepository.restoreReference")(
    function* (
      transaction: FlarexMetadataTransaction,
      preferredInstallation: RestoredFrameworkSchemaInstallation,
      readinessStorageId: bigint,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaReadiness,
      FrameworkMigrationRepositoryError
    > {
      const row = yield* loadReadinessRootByStorageId(
        transaction,
        readinessStorageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return yield* restoreReadinessOccupant(
        transaction,
        row.value,
        preferredInstallation.collision,
        operation,
      );
    },
  );

/** Source-private restoration for readinessPublished event subjects. */
export const restoreStoredFrameworkSchemaReadinessReferenceBySha256InTransactionEffect =
  Effect.fn("FrameworkSchemaReadinessRepository.restoreReferenceBySha256")(
    function* (
      transaction: FlarexMetadataTransaction,
      preferredCollision: RestoredFrameworkMigrationCollisionDomain,
      readinessSha256: FrameworkSchemaReadinessSha256,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaReadiness,
      FrameworkMigrationRepositoryError
    > {
      const row = yield* loadReadinessRootByDigest(
        transaction,
        yield* decodeAuthenticatedSha256(readinessSha256),
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return yield* restoreReadinessOccupant(
        transaction,
        row.value,
        preferredCollision,
        operation,
      );
    },
  );

const prepareExpectedReadiness = Effect.fn(
  "FrameworkSchemaReadinessRepository.prepareExpected",
)(function* (
  installation: RestoredFrameworkSchemaInstallation,
  readiness: FrameworkSchemaReadiness,
  operation: ReadinessOwnerRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkSchemaReadiness,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForFrameworkSchemaReadiness(readiness);
  if (
    !isRestoredFrameworkSchemaInstallation(installation) ||
    authority === undefined ||
    authority.installation !== installation.installation
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* capturePrivateCanonicalValue(
    readiness.frame,
    MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== readiness.sha256 ||
    captured.canonicalJson !== readiness.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    installation,
    readiness,
    installationSha256Bytes: yield* decodeAuthenticatedSha256(
      installation.installation.frame.identity.installationSha256,
    ),
    installationReceiptSha256Bytes: yield* decodeAuthenticatedSha256(
      installation.installation.sha256,
    ),
    readinessSha256Bytes: captured.copySha256Bytes(),
    validationSha256Bytes: yield* decodeAuthenticatedSha256(
      readiness.frame.validationSha256,
    ),
    validatedStructureSha256Bytes: yield* decodeAuthenticatedSha256(
      readiness.frame.validatedStructureSha256,
    ),
    canonicalBytes: captured.copyCanonicalBytes(),
  });
});

const resolveExpectedReadiness = Effect.fn(
  "FrameworkSchemaReadinessRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  installation: RestoredFrameworkSchemaInstallation,
  expected: FrameworkSchemaReadiness,
  readinessSha256: Uint8Array,
  operation: ReadinessOwnerRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaReadiness>,
  FrameworkMigrationRepositoryError
> {
  return yield* resolveAuthenticatedFrameworkSchemaReadinessOccupantsEffect(
    installation,
    expected,
    operation,
    {
      readByInstallation: () => loadReadinessOccupant(
        transaction,
        installation.collision,
        transaction.select(readinessReadSelection).from(
          fxSystemFrameworkSchemaReadiness,
        ).where(eq(
          fxSystemFrameworkSchemaReadiness.installationStorageId,
          installation.storageId,
        )).limit(1),
        operation,
      ),
      readByDigest: () => loadReadinessOccupant(
        transaction,
        installation.collision,
        transaction.select(readinessReadSelection).from(
          fxSystemFrameworkSchemaReadiness,
        ).where(eq(
          fxSystemFrameworkSchemaReadiness.readinessSha256,
          readinessSha256,
        )).limit(1),
        operation,
      ),
    },
  );
});

const loadReadinessOccupant = Effect.fn(
  "FrameworkSchemaReadinessRepository.loadOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  query: PromiseLike<readonly FrameworkSchemaReadinessDriverRow[]>,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaReadiness>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  return Option.some(yield* restoreReadinessOccupant(
    transaction,
    row,
    preferredCollision,
    operation,
  ));
});

const restoreReadinessOccupant = Effect.fn(
  "FrameworkSchemaReadinessRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkSchemaReadinessDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkSchemaReadiness,
  FrameworkMigrationRepositoryError
> {
  const installation = yield*
    restoreStoredFrameworkSchemaInstallationReferenceInTransactionEffect(
      transaction,
      preferredCollision,
      row.installationStorageId,
      operation,
    );
  return yield* restoreStoredFrameworkSchemaReadinessMetadata({
    row,
    installation,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
});

const loadReadinessRootByStorageId = Effect.fn(
  "FrameworkSchemaReadinessRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  readinessStorageId: bigint,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkSchemaReadinessDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(readinessReadSelection).from(
    fxSystemFrameworkSchemaReadiness,
  ).where(eq(
    fxSystemFrameworkSchemaReadiness.readinessStorageId,
    readinessStorageId,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

const loadReadinessRootByDigest = Effect.fn(
  "FrameworkSchemaReadinessRepository.loadByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  readinessSha256: Uint8Array,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkSchemaReadinessDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(readinessReadSelection).from(
    fxSystemFrameworkSchemaReadiness,
  ).where(eq(
    fxSystemFrameworkSchemaReadiness.readinessSha256,
    readinessSha256,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
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

function mapStoredValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkSchemaInstallationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function readinessExactlyMatches(
  actual: RestoredFrameworkSchemaReadiness,
  installation: RestoredFrameworkSchemaInstallation,
  expected: FrameworkSchemaReadiness,
): boolean {
  return installationExactlyMatches(actual.installation, installation) &&
    actual.readiness.sha256 === expected.sha256 &&
    actual.readiness.canonicalJson === expected.canonicalJson;
}

function restoredReadinessExactlyMatches(
  left: RestoredFrameworkSchemaReadiness,
  right: RestoredFrameworkSchemaReadiness,
): boolean {
  return left.storageId === right.storageId &&
    installationExactlyMatches(left.installation, right.installation) &&
    left.readiness.sha256 === right.readiness.sha256 &&
    left.readiness.canonicalJson === right.readiness.canonicalJson;
}

function installationExactlyMatches(
  left: RestoredFrameworkSchemaInstallation,
  right: RestoredFrameworkSchemaInstallation,
): boolean {
  return left.storageId === right.storageId &&
    left.collision.storageId === right.collision.storageId &&
    left.plan.storageId === right.plan.storageId &&
    left.admission.storageId === right.admission.storageId &&
    left.terminal.storageId === right.terminal.storageId &&
    left.installation.sha256 === right.installation.sha256 &&
    left.installation.canonicalJson === right.installation.canonicalJson;
}

function decodeAuthenticatedSha256(
  value: string,
): Effect.Effect<Uint8Array> {
  return Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.orDie);
}

const readinessCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkSchemaReadiness.canonicalBytes})
    <= ${MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES}
`;

const readinessReadSelection = {
  readinessStorageId: fxSystemFrameworkSchemaReadiness.readinessStorageId,
  installationStorageId:
    fxSystemFrameworkSchemaReadiness.installationStorageId,
  installationSha256: fxSystemFrameworkSchemaReadiness.installationSha256,
  installationReceiptSha256:
    fxSystemFrameworkSchemaReadiness.installationReceiptSha256,
  readinessSha256: fxSystemFrameworkSchemaReadiness.readinessSha256,
  validationSha256: fxSystemFrameworkSchemaReadiness.validationSha256,
  validatedStructureSha256:
    fxSystemFrameworkSchemaReadiness.validatedStructureSha256,
  frameFormat: fxSystemFrameworkSchemaReadiness.frameFormat,
  frameVersion: fxSystemFrameworkSchemaReadiness.frameVersion,
  canonicalByteLength: fxSystemFrameworkSchemaReadiness.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkSchemaReadiness.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${readinessCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkSchemaReadiness.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkSchemaReadinessRow,
  unknown
>;

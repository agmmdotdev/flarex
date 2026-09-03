import { and, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "../../migrationCoordination/repositoryErrors";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredPositiveInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../privateStoredMetadataValue";
import {
  corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect,
  restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect,
} from "./availabilityHistoryRepository";
import {
  capturedAuthorityForFrameworkSchemaAvailabilityHead,
} from "./authority";
import {
  MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  captureFrameworkSchemaAvailabilityHead,
  verifyStoredFrameworkSchemaInstallationValue,
} from "./canonical";
import type { FrameworkSchemaInstallationValueError } from "./errors";
import {
  corroborateRestoredFrameworkSchemaInstallationInTransactionEffect,
} from "./installationRepository";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
  type FrameworkSchemaAvailabilityHead,
  type FrameworkSchemaAvailabilityHeadFrame,
  type FrameworkSchemaAvailabilityStatus,
} from "./model";
import { fxSystemFrameworkSchemaAvailabilityHeads } from "./schema";
import {
  isRestoredFrameworkSchemaAvailabilityHead,
  isRestoredFrameworkSchemaAvailabilityHistory,
  restoreStoredFrameworkSchemaAvailabilityHeadMetadata,
  type RestoredFrameworkSchemaAvailabilityHead,
  type RestoredFrameworkSchemaAvailabilityHistory,
  type RestoredFrameworkSchemaInstallation,
  type RestoredFrameworkSchemaReadiness,
  type StoredFrameworkSchemaAvailabilityHeadRow,
} from "./storedMetadataRestoration";
import { isStoredFrameworkSchemaAvailabilityHeadFrame } from
  "./storedValidation";

type AvailabilityHeadRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  | "initializeAvailabilityHead"
  | "readAvailabilityHead"
  | "compareAndSwapAvailabilityHead"
>;

interface PreparedFrameworkSchemaAvailabilityHead {
  readonly history: RestoredFrameworkSchemaAvailabilityHistory;
  readonly head: FrameworkSchemaAvailabilityHead;
  readonly availabilitySequence: bigint;
  readonly historySha256Bytes: Uint8Array;
  readonly availabilityHeadSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface CorroboratedFrameworkSchemaAvailabilityHeadDependencies {
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly history: RestoredFrameworkSchemaAvailabilityHistory;
}

interface FrameworkSchemaAvailabilityHeadDriverRow
  extends StoredFrameworkSchemaAvailabilityHeadRow {
  readonly installationStorageId: bigint;
  readonly readinessStorageId: bigint;
  readonly availabilityHistoryStorageId: bigint;
  readonly availabilitySequence: bigint;
  readonly status: FrameworkSchemaAvailabilityStatus;
  readonly historySha256: Uint8Array;
  readonly availabilityHeadSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface DecodedFrameworkSchemaAvailabilityHeadRoot {
  readonly installationStorageId: bigint;
  readonly readinessStorageId: bigint;
  readonly availabilityHistoryStorageId: bigint;
  readonly frame: FrameworkSchemaAvailabilityHeadFrame;
}

const UTF8 = new TextEncoder();

export const initializeFrameworkSchemaAvailabilityHeadInTransactionEffect =
  Effect.fn("FrameworkSchemaAvailabilityHeadRepository.initialize")(
    function* (
      transaction: FlarexMetadataTransaction,
      history: RestoredFrameworkSchemaAvailabilityHistory,
      head: FrameworkSchemaAvailabilityHead,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaAvailabilityHead,
      FrameworkMigrationRepositoryError
    > {
      const operation = "initializeAvailabilityHead" as const;
      const prepared = yield* prepareExpectedAvailabilityHead(
        history,
        head,
        operation,
      );
      const dependencies = yield* corroborateAvailabilityHeadDependencies(
        transaction,
        prepared,
        operation,
      );
      const insertedRows = yield* runRepositoryStatement(
        operation,
        transaction.insert(fxSystemFrameworkSchemaAvailabilityHeads).values({
          installationStorageId: dependencies.installation.storageId,
          ...availabilityHeadWriteValues(prepared, dependencies),
        }).onConflictDoNothing().returning({
          installationStorageId:
            fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
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
          inserted.installationStorageId,
          () => FrameworkMigrationRepositoryError.storedCorruption(operation),
        ));
      }
      const restored = yield* loadRestoredAvailabilityHead(
        transaction,
        dependencies.installation,
        operation,
      );
      if (Option.isNone(restored)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      if (!availabilityHeadExactlyMatches(
        restored.value,
        dependencies,
        prepared.head,
      )) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.staleHead(operation),
        );
      }
      return restored.value;
    },
  );

export const readFrameworkSchemaAvailabilityHeadInTransactionEffect = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  installation: RestoredFrameworkSchemaInstallation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaAvailabilityHead>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readAvailabilityHead" as const;
  const storedInstallation = yield*
    corroborateRestoredFrameworkSchemaInstallationInTransactionEffect(
      transaction,
      installation,
      operation,
    );
  return yield* loadRestoredAvailabilityHead(
    transaction,
    storedInstallation,
    operation,
  );
});

export const compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect =
  Effect.fn("FrameworkSchemaAvailabilityHeadRepository.compareAndSwap")(
    function* (
      transaction: FlarexMetadataTransaction,
      expected: RestoredFrameworkSchemaAvailabilityHead,
      nextHistory: RestoredFrameworkSchemaAvailabilityHistory,
      nextHead: FrameworkSchemaAvailabilityHead,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaAvailabilityHead,
      FrameworkMigrationRepositoryError
    > {
      const operation = "compareAndSwapAvailabilityHead" as const;
      if (!isRestoredFrameworkSchemaAvailabilityHead(expected)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const preparedExpected = yield* prepareExpectedAvailabilityHead(
        expected.history,
        expected.head,
        operation,
      );
      const expectedDependencies = yield*
        corroborateAvailabilityHeadDependencies(
          transaction,
          preparedExpected,
          operation,
        );
      const current = yield* loadRestoredAvailabilityHead(
        transaction,
        expectedDependencies.installation,
        operation,
      );
      if (
        Option.isNone(current) ||
        !availabilityHeadExactlyMatches(
          current.value,
          expectedDependencies,
          preparedExpected.head,
        )
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.staleHead(operation),
        );
      }

      const prepared = yield* prepareExpectedAvailabilityHead(
        nextHistory,
        nextHead,
        operation,
      );
      const dependencies = yield* corroborateAvailabilityHeadDependencies(
        transaction,
        prepared,
        operation,
      );
      if (
        dependencies.installation.storageId !==
          current.value.installation.storageId
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const updatedRows = yield* runRepositoryStatement(
        operation,
        transaction.update(fxSystemFrameworkSchemaAvailabilityHeads).set(
          availabilityHeadWriteValues(prepared, dependencies),
        ).where(and(
          eq(
            fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
            current.value.installation.storageId,
          ),
          eq(
            fxSystemFrameworkSchemaAvailabilityHeads.availabilitySequence,
            preparedExpected.availabilitySequence,
          ),
          eq(
            fxSystemFrameworkSchemaAvailabilityHeads.availabilityHeadSha256,
            preparedExpected.availabilityHeadSha256Bytes,
          ),
        )).returning({
          installationStorageId:
            fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
        }),
      ).pipe(Effect.map(detachDriverRows));
      if (updatedRows.length === 0) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.staleHead(operation),
        );
      }
      const updated = updatedRows[0];
      if (updated === undefined || updatedRows.length !== 1) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const updatedInstallationStorageId = yield* Effect.fromResult(
        decodeStoredStorageIdResult(
          updated.installationStorageId,
          () => FrameworkMigrationRepositoryError.storedCorruption(operation),
        ),
      );
      if (
        updatedInstallationStorageId !== current.value.installation.storageId
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const restored = yield* loadRestoredAvailabilityHead(
        transaction,
        dependencies.installation,
        operation,
      );
      if (
        Option.isNone(restored) ||
        !availabilityHeadExactlyMatches(
          restored.value,
          dependencies,
          prepared.head,
        )
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return restored.value;
    },
  );

const prepareExpectedAvailabilityHead = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.prepareExpected",
)(function* (
  history: RestoredFrameworkSchemaAvailabilityHistory,
  head: FrameworkSchemaAvailabilityHead,
  operation: AvailabilityHeadRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkSchemaAvailabilityHead,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForFrameworkSchemaAvailabilityHead(head);
  if (
    !isRestoredFrameworkSchemaAvailabilityHistory(history) ||
    authority === undefined ||
    authority.readiness !== history.readiness.readiness ||
    authority.history !== history.history
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const recaptured = yield* captureFrameworkSchemaAvailabilityHead(
    history.history,
  ).pipe(Effect.mapError(error => mapInputValueError(operation, error)));
  if (
    recaptured.sha256 !== head.sha256 ||
    recaptured.canonicalJson !== head.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    history,
    head: recaptured,
    availabilitySequence: BigInt(recaptured.frame.availabilitySequence),
    historySha256Bytes: yield* decodeAuthenticatedSha256(
      recaptured.frame.historySha256,
    ),
    availabilityHeadSha256Bytes: yield* decodeAuthenticatedSha256(
      recaptured.sha256,
    ),
    canonicalBytes: UTF8.encode(recaptured.canonicalJson),
  });
});

const corroborateAvailabilityHeadDependencies = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.corroborateDependencies",
)(function* (
  transaction: FlarexMetadataTransaction,
  prepared: PreparedFrameworkSchemaAvailabilityHead,
  operation: AvailabilityHeadRepositoryOperation,
): Effect.fn.Return<
  CorroboratedFrameworkSchemaAvailabilityHeadDependencies,
  FrameworkMigrationRepositoryError
> {
  const history = yield*
    corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect(
      transaction,
      prepared.history,
      operation,
    );
  return Object.freeze({
    installation: history.installation,
    readiness: history.readiness,
    history,
  });
});

function availabilityHeadWriteValues(
  prepared: PreparedFrameworkSchemaAvailabilityHead,
  dependencies: CorroboratedFrameworkSchemaAvailabilityHeadDependencies,
) {
  return {
    readinessStorageId: dependencies.readiness.storageId,
    availabilityHistoryStorageId: dependencies.history.storageId,
    availabilitySequence: prepared.availabilitySequence,
    status: prepared.head.frame.status,
    historySha256: prepared.historySha256Bytes,
    availabilityHeadSha256: prepared.availabilityHeadSha256Bytes,
    frameFormat: prepared.head.frame.format,
    frameVersion: prepared.head.frame.version,
    canonicalByteLength: prepared.canonicalBytes.byteLength,
    canonicalBytes: prepared.canonicalBytes,
  };
}

const loadRestoredAvailabilityHead = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.loadRestored",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredInstallation: RestoredFrameworkSchemaInstallation,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaAvailabilityHead>,
  FrameworkMigrationRepositoryError
> {
  const row = yield* loadAvailabilityHeadRoot(
    transaction,
    preferredInstallation.storageId,
    operation,
  );
  if (Option.isNone(row)) return Option.none();
  return Option.some(yield* restoreAvailabilityHeadOccupant(
    transaction,
    row.value,
    preferredInstallation,
    operation,
  ));
});

const restoreAvailabilityHeadOccupant = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkSchemaAvailabilityHeadDriverRow,
  preferredInstallation: RestoredFrameworkSchemaInstallation,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkSchemaAvailabilityHead,
  FrameworkMigrationRepositoryError
> {
  const decoded = yield* decodeAvailabilityHeadRoot(row, operation);
  if (decoded.installationStorageId !== preferredInstallation.storageId) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const history = yield*
    restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect(
      transaction,
      preferredInstallation,
      decoded.availabilityHistoryStorageId,
      decoded.frame.availabilitySequence,
      decoded.frame.status,
      decoded.frame.historySha256,
      operation,
    ).pipe(Effect.mapError(error => mapStoredRepositoryError(operation, error)));
  if (history.readiness.storageId !== decoded.readinessStorageId) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return yield* restoreStoredFrameworkSchemaAvailabilityHeadMetadata({
    row,
    installation: history.installation,
    readiness: history.readiness,
    history,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
});

const decodeAvailabilityHeadRoot = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.decodeRoot",
)(function* (
  row: FrameworkSchemaAvailabilityHeadDriverRow,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkSchemaAvailabilityHeadRoot,
  FrameworkMigrationRepositoryError
> {
  const installationStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.installationStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const readinessStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.readinessStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const availabilityHistoryStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.availabilityHistoryStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.availabilityHeadSha256,
    {
      format: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
      version: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
      maximumCanonicalBytes:
        MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkSchemaInstallationValue({
    kind: "availabilityHead",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  const availabilitySequence = yield* decodeStoredPositiveInt64(
    row.availabilitySequence,
    operation,
  );
  const historySha256 = yield* decodeStoredSha256(
    row.historySha256,
    operation,
  );
  if (
    !isStoredFrameworkSchemaAvailabilityHeadFrame(frame) ||
    availabilitySequence !== frame.availabilitySequence ||
    row.status !== frame.status ||
    historySha256 !== frame.historySha256
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return Object.freeze({
    installationStorageId,
    readinessStorageId,
    availabilityHistoryStorageId,
    frame,
  });
});

const loadAvailabilityHeadRoot = Effect.fn(
  "FrameworkSchemaAvailabilityHeadRepository.loadRoot",
)(function* (
  transaction: FlarexMetadataTransaction,
  installationStorageId: bigint,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkSchemaAvailabilityHeadDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(availabilityHeadReadSelection).from(
      fxSystemFrameworkSchemaAvailabilityHeads,
    ).where(eq(
      fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
      installationStorageId,
    )).limit(1),
  ).pipe(Effect.map(detachDriverRows));
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

function availabilityHeadExactlyMatches(
  actual: RestoredFrameworkSchemaAvailabilityHead,
  dependencies: CorroboratedFrameworkSchemaAvailabilityHeadDependencies,
  expected: FrameworkSchemaAvailabilityHead,
): boolean {
  return actual.installation.storageId === dependencies.installation.storageId &&
    actual.readiness.storageId === dependencies.readiness.storageId &&
    actual.history.storageId === dependencies.history.storageId &&
    actual.history.history.sha256 === dependencies.history.history.sha256 &&
    actual.history.history.canonicalJson ===
      dependencies.history.history.canonicalJson &&
    actual.head.sha256 === expected.sha256 &&
    actual.head.canonicalJson === expected.canonicalJson;
}

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

function decodeAuthenticatedSha256(value: string): Effect.Effect<Uint8Array> {
  return Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.orDie);
}

function decodeStoredSha256(
  value: unknown,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.Effect<string, FrameworkMigrationRepositoryError> {
  return Effect.fromResult(decodeStoredSha256HexResult(
    value,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
}

function decodeStoredPositiveInt64(
  value: unknown,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.Effect<string, FrameworkMigrationRepositoryError> {
  return Effect.fromResult(decodeStoredPositiveInt64TextResult(
    value,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
}

function mapInputValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkSchemaInstallationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause)
    : FrameworkMigrationRepositoryError.referenceRefusal(operation);
}

function mapStoredValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkSchemaInstallationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause)
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function mapStoredRepositoryError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

const availabilityHeadCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkSchemaAvailabilityHeads.canonicalBytes})
    <= ${MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES}
`;

const availabilityHeadReadSelection = {
  installationStorageId:
    fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
  readinessStorageId:
    fxSystemFrameworkSchemaAvailabilityHeads.readinessStorageId,
  availabilityHistoryStorageId:
    fxSystemFrameworkSchemaAvailabilityHeads.availabilityHistoryStorageId,
  availabilitySequence:
    fxSystemFrameworkSchemaAvailabilityHeads.availabilitySequence,
  status: fxSystemFrameworkSchemaAvailabilityHeads.status,
  historySha256: fxSystemFrameworkSchemaAvailabilityHeads.historySha256,
  availabilityHeadSha256:
    fxSystemFrameworkSchemaAvailabilityHeads.availabilityHeadSha256,
  frameFormat: fxSystemFrameworkSchemaAvailabilityHeads.frameFormat,
  frameVersion: fxSystemFrameworkSchemaAvailabilityHeads.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkSchemaAvailabilityHeads.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkSchemaAvailabilityHeads.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${availabilityHeadCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkSchemaAvailabilityHeads.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkSchemaAvailabilityHeadRow,
  unknown
>;

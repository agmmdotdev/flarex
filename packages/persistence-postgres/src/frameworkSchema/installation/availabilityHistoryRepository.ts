import { and, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type {
  FrameworkSchemaAvailabilityHistorySha256,
} from "../../migrationCoordination/identity";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "../../migrationCoordination/repositoryErrors";
import { capturePrivateCanonicalValue } from "../privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredPositiveInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../privateStoredMetadataValue";
import {
  capturedAuthorityForFrameworkSchemaAvailabilityHistory,
} from "./authority";
import {
  MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  verifyStoredFrameworkSchemaInstallationValue,
} from "./canonical";
import type { FrameworkSchemaInstallationValueError } from "./errors";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
  type CapturedFrameworkSchemaInstallationValue,
  type FrameworkSchemaAvailabilityHistoryFrame,
  type FrameworkSchemaAvailabilityStatus,
} from "./model";
import {
  corroborateRestoredFrameworkSchemaReadinessInTransactionEffect,
  restoreStoredFrameworkSchemaReadinessReferenceInTransactionEffect,
} from "./readinessRepository";
import { fxSystemFrameworkSchemaAvailabilityHistory } from "./schema";
import {
  isRestoredFrameworkSchemaAvailabilityHistory,
  isRestoredFrameworkSchemaReadiness,
  restoreStoredFrameworkSchemaAvailabilityHistoryMetadata,
  restoredFrameworkSchemaAvailabilityHistoryAuthority,
  type RestoredFrameworkSchemaAvailabilityHistory,
  type RestoredFrameworkSchemaInstallation,
  type RestoredFrameworkSchemaReadiness,
  type StoredFrameworkSchemaAvailabilityHistoryRow,
} from "./storedMetadataRestoration";
import {
  isStoredFrameworkSchemaAvailabilityHistoryFrame,
} from "./storedValidation";

type FrameworkSchemaAvailabilityHistory =
  CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  >;

type AvailabilityHistoryRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "appendAvailabilityHistory" | "readAvailabilityHistory"
>;

interface PreparedFrameworkSchemaAvailabilityHistory {
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly previous: RestoredFrameworkSchemaAvailabilityHistory | null;
  readonly history: FrameworkSchemaAvailabilityHistory;
  readonly readinessSha256Bytes: Uint8Array;
  readonly reasonSha256Bytes: Uint8Array | null;
  readonly historySha256Bytes: Uint8Array;
  readonly availabilitySequence: bigint;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkSchemaAvailabilityHistoryDriverRow
  extends StoredFrameworkSchemaAvailabilityHistoryRow {
  readonly availabilityHistoryStorageId: bigint;
  readonly installationStorageId: bigint;
  readonly readinessStorageId: bigint;
  readonly readinessSha256: Uint8Array;
  readonly availabilitySequence: bigint;
  readonly status: FrameworkSchemaAvailabilityStatus;
  readonly reasonSha256: Uint8Array | null;
  readonly historySha256: Uint8Array;
  readonly previousHistoryStorageId: bigint | null;
  readonly previousAvailabilitySequence: bigint | null;
  readonly previousHistorySha256: Uint8Array | null;
  readonly previousStatus: FrameworkSchemaAvailabilityStatus | null;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface DecodedFrameworkSchemaAvailabilityHistoryRoot {
  readonly storageId: bigint;
  readonly installationStorageId: bigint;
  readonly readinessStorageId: bigint;
  readonly previousHistoryStorageId: bigint | null;
  readonly historySha256: string;
  readonly frame: FrameworkSchemaAvailabilityHistoryFrame;
}

interface RestoredFrameworkSchemaAvailabilityHistoryOccupant {
  readonly value: RestoredFrameworkSchemaAvailabilityHistory;
  readonly previous: RestoredFrameworkSchemaAvailabilityHistory | null;
}

interface FrameworkSchemaAvailabilityHistoryOccupantLookups {
  readonly readBySequence: () => Effect.Effect<
    Option.Option<RestoredFrameworkSchemaAvailabilityHistoryOccupant>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByDigest: () => Effect.Effect<
    Option.Option<RestoredFrameworkSchemaAvailabilityHistoryOccupant>,
    FrameworkMigrationRepositoryError
  >;
}

export const appendFrameworkSchemaAvailabilityHistoryInTransactionEffect =
  Effect.fn("FrameworkSchemaAvailabilityHistoryRepository.append")(
    function* (
      transaction: FlarexMetadataTransaction,
      readiness: RestoredFrameworkSchemaReadiness,
      previous: RestoredFrameworkSchemaAvailabilityHistory | null,
      history: FrameworkSchemaAvailabilityHistory,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaAvailabilityHistory,
      FrameworkMigrationRepositoryError
    > {
      const operation = "appendAvailabilityHistory" as const;
      const prepared = yield* prepareExpectedAvailabilityHistory(
        readiness,
        previous,
        history,
        operation,
      );
      const dependencies = yield* corroborateAvailabilityHistoryDependencies(
        transaction,
        prepared,
        operation,
      );
      const insertedRows = yield* runRepositoryStatement(
        operation,
        transaction.insert(fxSystemFrameworkSchemaAvailabilityHistory).values({
          installationStorageId: dependencies.readiness.installation.storageId,
          readinessStorageId: dependencies.readiness.storageId,
          readinessSha256: prepared.readinessSha256Bytes,
          availabilitySequence: prepared.availabilitySequence,
          status: prepared.history.frame.status,
          reasonSha256: prepared.reasonSha256Bytes,
          historySha256: prepared.historySha256Bytes,
          previousHistoryStorageId: dependencies.previous?.storageId ?? null,
          previousAvailabilitySequence: dependencies.previous === null
            ? null
            : BigInt(
              dependencies.previous.history.frame.availabilitySequence,
            ),
          previousHistorySha256: dependencies.previous === null
            ? null
            : yield* decodeAuthenticatedSha256(
              dependencies.previous.history.sha256,
            ),
          previousStatus: dependencies.previous?.history.frame.status ?? null,
          frameFormat: prepared.history.frame.format,
          frameVersion: prepared.history.frame.version,
          canonicalByteLength: prepared.canonicalBytes.byteLength,
          canonicalBytes: prepared.canonicalBytes,
        }).onConflictDoNothing().returning({
          availabilityHistoryStorageId:
            fxSystemFrameworkSchemaAvailabilityHistory
              .availabilityHistoryStorageId,
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
          inserted.availabilityHistoryStorageId,
          () => FrameworkMigrationRepositoryError.storedCorruption(operation),
        ));
      }

      const resolved = yield* resolveExpectedAvailabilityHistory(
        transaction,
        dependencies.readiness,
        dependencies.previous,
        prepared.history,
        prepared.historySha256Bytes,
        prepared.availabilitySequence,
        operation,
      );
      if (Option.isNone(resolved)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return resolved.value;
    },
  );

export const readFrameworkSchemaAvailabilityHistoryInTransactionEffect =
  Effect.fn("FrameworkSchemaAvailabilityHistoryRepository.read")(
    function* (
      transaction: FlarexMetadataTransaction,
      readiness: RestoredFrameworkSchemaReadiness,
      previous: RestoredFrameworkSchemaAvailabilityHistory | null,
      history: FrameworkSchemaAvailabilityHistory,
    ): Effect.fn.Return<
      Option.Option<RestoredFrameworkSchemaAvailabilityHistory>,
      FrameworkMigrationRepositoryError
    > {
      const operation = "readAvailabilityHistory" as const;
      const prepared = yield* prepareExpectedAvailabilityHistory(
        readiness,
        previous,
        history,
        operation,
      );
      const dependencies = yield* corroborateAvailabilityHistoryDependencies(
        transaction,
        prepared,
        operation,
      );
      return yield* resolveExpectedAvailabilityHistory(
        transaction,
        dependencies.readiness,
        dependencies.previous,
        prepared.history,
        prepared.historySha256Bytes,
        prepared.availabilitySequence,
        operation,
      );
    },
  );

/** Source-private semantic-first resolution with a lazy scoped-digest lookup. */
export const resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect =
  Effect.fn("FrameworkSchemaAvailabilityHistoryRepository.resolveOccupants")(
    function* (
      readiness: RestoredFrameworkSchemaReadiness,
      previous: RestoredFrameworkSchemaAvailabilityHistory | null,
      expected: FrameworkSchemaAvailabilityHistory,
      operation: AvailabilityHistoryRepositoryOperation,
      lookups: FrameworkSchemaAvailabilityHistoryOccupantLookups,
    ): Effect.fn.Return<
      Option.Option<RestoredFrameworkSchemaAvailabilityHistory>,
      FrameworkMigrationRepositoryError
    > {
      const bySequence = yield* lookups.readBySequence();
      if (Option.isSome(bySequence)) {
        if (availabilityHistoryExactlyMatches(
          bySequence.value,
          readiness,
          previous,
          expected,
        )) return Option.some(bySequence.value.value);
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.immutableConflict(operation),
        );
      }

      const byDigest = yield* lookups.readByDigest();
      if (Option.isNone(byDigest)) return Option.none();
      if (availabilityHistoryExactlyMatches(
        byDigest.value,
        readiness,
        previous,
        expected,
      )) return Option.some(byDigest.value.value);
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    },
  );

/** Source-private same-transaction corroboration for downstream aggregates. */
export const corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect =
  Effect.fn("FrameworkSchemaAvailabilityHistoryRepository.corroborateRestored")(
    function* (
      transaction: FlarexMetadataTransaction,
      expected: RestoredFrameworkSchemaAvailabilityHistory,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaAvailabilityHistory,
      FrameworkMigrationRepositoryError
    > {
      const authority = isRestoredFrameworkSchemaAvailabilityHistory(expected)
        ? restoredFrameworkSchemaAvailabilityHistoryAuthority(expected)
        : undefined;
      if (authority === undefined) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const readiness = yield*
        corroborateRestoredFrameworkSchemaReadinessInTransactionEffect(
          transaction,
          expected.readiness,
          operation,
        );
      const row = yield* loadAvailabilityHistoryRootByStorageId(
        transaction,
        expected.storageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const occupant = yield* restoreAvailabilityHistoryChain(
        transaction,
        row.value,
        readiness,
        operation,
      );
      if (!restoredAvailabilityHistoryChainsExactlyMatch(
        occupant.value,
        expected,
      )) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      return occupant.value;
    },
  );

/** Source-private restoration of one exact committed availability reference. */
export const restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect =
  Effect.fn("FrameworkSchemaAvailabilityHistoryRepository.restoreReference")(
    function* (
      transaction: FlarexMetadataTransaction,
      preferredInstallation: RestoredFrameworkSchemaInstallation,
      historyStorageId: bigint,
      availabilitySequence: string,
      status: FrameworkSchemaAvailabilityStatus,
      historySha256: FrameworkSchemaAvailabilityHistorySha256,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaAvailabilityHistory,
      FrameworkMigrationRepositoryError
    > {
      const row = yield* loadAvailabilityHistoryRootByStorageId(
        transaction,
        historyStorageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const decoded = yield* decodeAvailabilityHistoryRoot(
        row.value,
        operation,
      );
      if (decoded.installationStorageId !== preferredInstallation.storageId) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const readiness = yield*
        restoreStoredFrameworkSchemaReadinessReferenceInTransactionEffect(
          transaction,
          preferredInstallation,
          decoded.readinessStorageId,
          operation,
        ).pipe(Effect.mapError(error =>
          mapStoredRepositoryError(operation, error)
        ));
      const occupant = yield* restoreAvailabilityHistoryChain(
        transaction,
        row.value,
        readiness,
        operation,
      );
      if (
        occupant.value.history.frame.availabilitySequence !==
          availabilitySequence ||
        occupant.value.history.frame.status !== status ||
        occupant.value.history.sha256 !== historySha256
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return occupant.value;
    },
  );

const prepareExpectedAvailabilityHistory = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.prepareExpected",
)(function* (
  readiness: RestoredFrameworkSchemaReadiness,
  previous: RestoredFrameworkSchemaAvailabilityHistory | null,
  history: FrameworkSchemaAvailabilityHistory,
  operation: AvailabilityHistoryRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkSchemaAvailabilityHistory,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForFrameworkSchemaAvailabilityHistory(
    history,
  );
  const previousAuthority = previous === null
    ? undefined
    : restoredFrameworkSchemaAvailabilityHistoryAuthority(previous);
  if (
    !isRestoredFrameworkSchemaReadiness(readiness) ||
    authority === undefined ||
    authority.readiness !== readiness.readiness ||
    authority.previous !== (previous?.history ?? null) ||
    (previous !== null &&
      (!isRestoredFrameworkSchemaAvailabilityHistory(previous) ||
        previousAuthority === undefined ||
        previous.installation !== readiness.installation ||
        previous.readiness !== readiness))
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* capturePrivateCanonicalValue(
    history.frame,
    MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== history.sha256 ||
    captured.canonicalJson !== history.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    readiness,
    previous,
    history,
    readinessSha256Bytes: yield* decodeAuthenticatedSha256(
      history.frame.readinessSha256,
    ),
    reasonSha256Bytes: history.frame.reasonSha256 === null
      ? null
      : yield* decodeAuthenticatedSha256(history.frame.reasonSha256),
    historySha256Bytes: captured.copySha256Bytes(),
    availabilitySequence: BigInt(history.frame.availabilitySequence),
    canonicalBytes: captured.copyCanonicalBytes(),
  });
});

const corroborateAvailabilityHistoryDependencies = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.corroborateDependencies",
)(function* (
  transaction: FlarexMetadataTransaction,
  prepared: PreparedFrameworkSchemaAvailabilityHistory,
  operation: AvailabilityHistoryRepositoryOperation,
): Effect.fn.Return<
  Readonly<{
    readonly readiness: RestoredFrameworkSchemaReadiness;
    readonly previous: RestoredFrameworkSchemaAvailabilityHistory | null;
  }>,
  FrameworkMigrationRepositoryError
> {
  const independentlyStoredReadiness = yield*
    corroborateRestoredFrameworkSchemaReadinessInTransactionEffect(
      transaction,
      prepared.readiness,
      operation,
    );
  const previous = prepared.previous === null
    ? null
    : yield*
      corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect(
        transaction,
        prepared.previous,
        operation,
      );
  if (
    previous !== null &&
    !restoredReadinessExactlyMatches(
      independentlyStoredReadiness,
      previous.readiness,
    )
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    readiness: previous?.readiness ?? independentlyStoredReadiness,
    previous,
  });
});

const resolveExpectedAvailabilityHistory = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  readiness: RestoredFrameworkSchemaReadiness,
  previous: RestoredFrameworkSchemaAvailabilityHistory | null,
  expected: FrameworkSchemaAvailabilityHistory,
  historySha256Bytes: Uint8Array,
  availabilitySequence: bigint,
  operation: AvailabilityHistoryRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaAvailabilityHistory>,
  FrameworkMigrationRepositoryError
> {
  return yield*
    resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect(
      readiness,
      previous,
      expected,
      operation,
      {
        readBySequence: () => loadAvailabilityHistoryOccupantBySequence(
          transaction,
          readiness,
          availabilitySequence,
          operation,
          previous,
        ),
        readByDigest: () => loadAvailabilityHistoryOccupantByDigest(
          transaction,
          readiness,
          historySha256Bytes,
          operation,
          previous,
        ),
      },
    );
});

const loadAvailabilityHistoryOccupantBySequence = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.loadBySequence",
)(function* (
  transaction: FlarexMetadataTransaction,
  readiness: RestoredFrameworkSchemaReadiness,
  availabilitySequence: bigint,
  operation: FrameworkMigrationRepositoryOperation,
  preferredPrevious?: RestoredFrameworkSchemaAvailabilityHistory | null,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaAvailabilityHistoryOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(availabilityHistoryReadSelection).from(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).where(and(
      eq(
        fxSystemFrameworkSchemaAvailabilityHistory.installationStorageId,
        readiness.installation.storageId,
      ),
      eq(
        fxSystemFrameworkSchemaAvailabilityHistory.availabilitySequence,
        availabilitySequence,
      ),
    )).limit(2),
  ).pipe(Effect.map(detachDriverRows));
  if (rows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return rows[0] === undefined
    ? Option.none()
    : Option.some(yield* restoreAvailabilityHistoryChain(
      transaction,
      rows[0],
      readiness,
      operation,
      preferredPrevious,
    ));
});

const loadAvailabilityHistoryOccupantByDigest = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.loadByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  readiness: RestoredFrameworkSchemaReadiness,
  historySha256: Uint8Array,
  operation: FrameworkMigrationRepositoryOperation,
  preferredPrevious?: RestoredFrameworkSchemaAvailabilityHistory | null,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaAvailabilityHistoryOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(availabilityHistoryReadSelection).from(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).where(and(
      eq(
        fxSystemFrameworkSchemaAvailabilityHistory.installationStorageId,
        readiness.installation.storageId,
      ),
      eq(
        fxSystemFrameworkSchemaAvailabilityHistory.historySha256,
        historySha256,
      ),
    )).limit(2),
  ).pipe(Effect.map(detachDriverRows));
  if (rows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return rows[0] === undefined
    ? Option.none()
    : Option.some(yield* restoreAvailabilityHistoryChain(
      transaction,
      rows[0],
      readiness,
      operation,
      preferredPrevious,
    ));
});

const restoreAvailabilityHistoryChain = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.restoreChain",
)(function* (
  transaction: FlarexMetadataTransaction,
  root: FrameworkSchemaAvailabilityHistoryDriverRow,
  readiness: RestoredFrameworkSchemaReadiness,
  operation: FrameworkMigrationRepositoryOperation,
  preferredPrevious?: RestoredFrameworkSchemaAvailabilityHistory | null,
): Effect.fn.Return<
  RestoredFrameworkSchemaAvailabilityHistoryOccupant,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkSchemaReadiness(readiness)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const rootDecoded = yield* decodeAvailabilityHistoryRoot(root, operation);
  const rows: FrameworkSchemaAvailabilityHistoryDriverRow[] = [];
  const decodedRows: DecodedFrameworkSchemaAvailabilityHistoryRoot[] = [];
  const seenStorageIds = new Set<bigint>();
  const seenSequences = new Set<string>();
  const seenDigests = new Set<string>();
  let anchoredPrevious:
    | RestoredFrameworkSchemaAvailabilityHistory
    | null
    | undefined;
  let row = root;
  while (true) {
    const decoded = rows.length === 0
      ? rootDecoded
      : yield* decodeAvailabilityHistoryRoot(row, operation);
    if (
      decoded.installationStorageId !== readiness.installation.storageId ||
      decoded.readinessStorageId !== readiness.storageId ||
      decoded.frame.readinessSha256 !== readiness.readiness.sha256 ||
      seenStorageIds.has(decoded.storageId) ||
      seenSequences.has(decoded.frame.availabilitySequence) ||
      seenDigests.has(decoded.historySha256)
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    seenStorageIds.add(decoded.storageId);
    seenSequences.add(decoded.frame.availabilitySequence);
    seenDigests.add(decoded.historySha256);
    rows.push(row);
    decodedRows.push(decoded);
    if (
      rows.length === 1 &&
      preferredPrevious !== undefined &&
      storedPreviousAvailabilityReferenceMatches(
        decoded,
        preferredPrevious,
        readiness,
      )
    ) {
      anchoredPrevious = preferredPrevious;
      break;
    }
    if (decoded.previousHistoryStorageId === null) break;
    const previous = yield* loadAvailabilityHistoryRootByStorageId(
      transaction,
      decoded.previousHistoryStorageId,
      operation,
    );
    if (Option.isNone(previous)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    row = previous.value;
  }

  let previous: RestoredFrameworkSchemaAvailabilityHistory | null =
    anchoredPrevious ?? null;
  let rootOccupant:
    | RestoredFrameworkSchemaAvailabilityHistoryOccupant
    | undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const historyRow = rows[index];
    const decoded = decodedRows[index];
    if (historyRow === undefined || decoded === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const value = yield*
      restoreStoredFrameworkSchemaAvailabilityHistoryMetadata({
        row: historyRow,
        installation: readiness.installation,
        readiness,
        previous,
      }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
    const occupant = Object.freeze({ value, previous });
    if (index === 0) rootOccupant = occupant;
    previous = value;
  }
  if (rootOccupant === undefined) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return rootOccupant;
});

const decodeAvailabilityHistoryRoot = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.decodeRoot",
)(function* (
  row: FrameworkSchemaAvailabilityHistoryDriverRow,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkSchemaAvailabilityHistoryRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.availabilityHistoryStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
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
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.historySha256,
    {
      format: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
      version: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
      maximumCanonicalBytes:
        MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkSchemaInstallationValue({
    kind: "availabilityHistory",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  const availabilitySequence = yield* decodeStoredPositiveInt64(
    row.availabilitySequence,
    operation,
  );
  const readinessSha256 = yield* decodeStoredSha256(
    row.readinessSha256,
    operation,
  );
  const reasonSha256 = row.reasonSha256 === null
    ? null
    : yield* decodeStoredSha256(row.reasonSha256, operation);
  if (
    !isStoredFrameworkSchemaAvailabilityHistoryFrame(frame) ||
    availabilitySequence !== frame.availabilitySequence ||
    readinessSha256 !== frame.readinessSha256 ||
    row.status !== frame.status ||
    reasonSha256 !== frame.reasonSha256
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }

  let previousHistoryStorageId: bigint | null = null;
  if (frame.previousAvailability === null) {
    if (
      row.previousHistoryStorageId !== null ||
      row.previousAvailabilitySequence !== null ||
      row.previousHistorySha256 !== null ||
      row.previousStatus !== null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  } else {
    if (
      row.previousHistoryStorageId === null ||
      row.previousAvailabilitySequence === null ||
      row.previousHistorySha256 === null ||
      row.previousStatus === null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    previousHistoryStorageId = yield* Effect.fromResult(
      decodeStoredStorageIdResult(
        row.previousHistoryStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    const previousAvailabilitySequence = yield* decodeStoredPositiveInt64(
      row.previousAvailabilitySequence,
      operation,
    );
    const previousHistorySha256 = yield* decodeStoredSha256(
      row.previousHistorySha256,
      operation,
    );
    if (
      previousHistoryStorageId === storageId ||
      previousAvailabilitySequence !==
        frame.previousAvailability.availabilitySequence ||
      previousHistorySha256 !== frame.previousAvailability.historySha256 ||
      row.previousStatus !== frame.previousAvailability.status
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }
  return Object.freeze({
    storageId,
    installationStorageId,
    readinessStorageId,
    previousHistoryStorageId,
    historySha256: stored.sha256Hex,
    frame,
  });
});

const loadAvailabilityHistoryRootByStorageId = Effect.fn(
  "FrameworkSchemaAvailabilityHistoryRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  historyStorageId: bigint,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkSchemaAvailabilityHistoryDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(availabilityHistoryReadSelection).from(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      historyStorageId,
    )).limit(1),
  ).pipe(Effect.map(detachDriverRows));
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

function storedPreviousAvailabilityReferenceMatches(
  decoded: DecodedFrameworkSchemaAvailabilityHistoryRoot,
  previous: RestoredFrameworkSchemaAvailabilityHistory | null,
  readiness: RestoredFrameworkSchemaReadiness,
): boolean {
  const token = decoded.frame.previousAvailability;
  if (token === null) {
    return decoded.previousHistoryStorageId === null && previous === null;
  }
  return previous !== null &&
    restoredReadinessExactlyMatches(previous.readiness, readiness) &&
    decoded.previousHistoryStorageId === previous.storageId &&
    token.availabilitySequence ===
      previous.history.frame.availabilitySequence &&
    token.status === previous.history.frame.status &&
    token.historySha256 === previous.history.sha256;
}

function availabilityHistoryExactlyMatches(
  occupant: RestoredFrameworkSchemaAvailabilityHistoryOccupant,
  readiness: RestoredFrameworkSchemaReadiness,
  previous: RestoredFrameworkSchemaAvailabilityHistory | null,
  expected: FrameworkSchemaAvailabilityHistory,
): boolean {
  return restoredReadinessExactlyMatches(occupant.value.readiness, readiness) &&
    restoredAvailabilityHistoryReferencesExactlyMatch(
      occupant.previous,
      previous,
    ) && occupant.value.history.sha256 === expected.sha256 &&
    occupant.value.history.canonicalJson === expected.canonicalJson;
}

function restoredAvailabilityHistoryChainsExactlyMatch(
  leftRoot: RestoredFrameworkSchemaAvailabilityHistory,
  rightRoot: RestoredFrameworkSchemaAvailabilityHistory,
): boolean {
  const seenLeft = new Set<RestoredFrameworkSchemaAvailabilityHistory>();
  const seenRight = new Set<RestoredFrameworkSchemaAvailabilityHistory>();
  let left: RestoredFrameworkSchemaAvailabilityHistory | null = leftRoot;
  let right: RestoredFrameworkSchemaAvailabilityHistory | null = rightRoot;
  while (left !== null && right !== null) {
    if (
      seenLeft.has(left) || seenRight.has(right) ||
      left.storageId !== right.storageId ||
      !restoredReadinessExactlyMatches(left.readiness, right.readiness) ||
      left.history.sha256 !== right.history.sha256 ||
      left.history.canonicalJson !== right.history.canonicalJson
    ) return false;
    seenLeft.add(left);
    seenRight.add(right);
    const leftAuthority =
      restoredFrameworkSchemaAvailabilityHistoryAuthority(left);
    const rightAuthority =
      restoredFrameworkSchemaAvailabilityHistoryAuthority(right);
    if (leftAuthority === undefined || rightAuthority === undefined) return false;
    left = leftAuthority.previous;
    right = rightAuthority.previous;
  }
  return left === null && right === null;
}

function restoredAvailabilityHistoryReferencesExactlyMatch(
  left: RestoredFrameworkSchemaAvailabilityHistory | null,
  right: RestoredFrameworkSchemaAvailabilityHistory | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.storageId === right.storageId &&
      restoredReadinessExactlyMatches(left.readiness, right.readiness) &&
      left.history.sha256 === right.history.sha256 &&
      left.history.canonicalJson === right.history.canonicalJson;
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

const availabilityHistoryCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkSchemaAvailabilityHistory.canonicalBytes})
    <= ${MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES}
`;

const availabilityHistoryReadSelection = {
  availabilityHistoryStorageId:
    fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
  installationStorageId:
    fxSystemFrameworkSchemaAvailabilityHistory.installationStorageId,
  readinessStorageId:
    fxSystemFrameworkSchemaAvailabilityHistory.readinessStorageId,
  readinessSha256:
    fxSystemFrameworkSchemaAvailabilityHistory.readinessSha256,
  availabilitySequence:
    fxSystemFrameworkSchemaAvailabilityHistory.availabilitySequence,
  status: fxSystemFrameworkSchemaAvailabilityHistory.status,
  reasonSha256: fxSystemFrameworkSchemaAvailabilityHistory.reasonSha256,
  historySha256: fxSystemFrameworkSchemaAvailabilityHistory.historySha256,
  previousHistoryStorageId:
    fxSystemFrameworkSchemaAvailabilityHistory.previousHistoryStorageId,
  previousAvailabilitySequence:
    fxSystemFrameworkSchemaAvailabilityHistory.previousAvailabilitySequence,
  previousHistorySha256:
    fxSystemFrameworkSchemaAvailabilityHistory.previousHistorySha256,
  previousStatus: fxSystemFrameworkSchemaAvailabilityHistory.previousStatus,
  frameFormat: fxSystemFrameworkSchemaAvailabilityHistory.frameFormat,
  frameVersion: fxSystemFrameworkSchemaAvailabilityHistory.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkSchemaAvailabilityHistory.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkSchemaAvailabilityHistory.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${availabilityHistoryCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkSchemaAvailabilityHistory.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkSchemaAvailabilityHistoryRow,
  unknown
>;

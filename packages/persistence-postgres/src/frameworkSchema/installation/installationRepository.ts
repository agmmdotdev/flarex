import { eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import {
  decodeStoredStorageIdResult,
} from "../privateStoredMetadataValue";
import {
  corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect,
  restoreStoredFrameworkMigrationAttemptTerminalReferenceInTransactionEffect,
} from "../../migrationCoordination/migrationAttemptTerminalRepository";
import type {
  FrameworkSchemaInstallationReceiptSha256,
} from "../../migrationCoordination/identity";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "../../migrationCoordination/repositoryErrors";
import type {
  RestoredFrameworkMigrationStepReceipt,
} from "../../migrationCoordination/storedRestoration";
import {
  isRestoredFrameworkMigrationAttemptTerminal,
  restoredFrameworkMigrationAttemptTerminalStepReceipts,
  type RestoredFrameworkMigrationAttemptTerminal,
  type RestoredFrameworkMigrationCollisionDomain,
} from "../../migrationCoordination/storedRestoration";
import { capturePrivateCanonicalValue } from "../privateCanonicalValue";
import {
  capturedAuthorityForFrameworkSchemaInstallation,
} from "./authority";
import {
  FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
  FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
  type CapturedFrameworkSchemaInstallationValue,
  type FrameworkSchemaInstallationFrame,
} from "./model";
import {
  fxSystemFrameworkSchemaInstallations,
} from "./schema";
import {
  isRestoredFrameworkSchemaInstallation,
  restoreStoredFrameworkSchemaInstallationMetadata,
  type RestoredFrameworkSchemaInstallation,
  type StoredFrameworkSchemaInstallationRow,
} from "./storedMetadataRestoration";
import {
  MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
} from "./canonical";
import type { FrameworkSchemaInstallationValueError } from "./errors";

type FrameworkSchemaInstallation = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaInstallationFrame,
  FrameworkSchemaInstallationReceiptSha256
>;

type InstallationOwnerRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensureInstallation" | "readInstallation"
>;

interface PreparedFrameworkSchemaInstallation {
  readonly terminal: RestoredFrameworkMigrationAttemptTerminal;
  readonly installation: FrameworkSchemaInstallation;
  readonly migrationPlanSha256Bytes: Uint8Array;
  readonly admissionSha256Bytes: Uint8Array;
  readonly terminalSha256Bytes: Uint8Array;
  readonly installationSha256Bytes: Uint8Array;
  readonly installationReceiptSha256Bytes: Uint8Array;
  readonly installedStructureSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkSchemaInstallationDriverRow
  extends StoredFrameworkSchemaInstallationRow {
  readonly installationStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly migrationPlanSha256: Uint8Array;
  readonly admissionStorageId: bigint;
  readonly admissionSha256: Uint8Array;
  readonly terminalStorageId: bigint;
  readonly terminalOutcomeKind: "succeeded";
  readonly terminalSha256: Uint8Array;
  readonly installationSha256: Uint8Array;
  readonly installationReceiptSha256: Uint8Array;
  readonly installedStructureSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_INSTALLATION_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_INSTALLATION_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface FrameworkSchemaInstallationOccupantLookups {
  readonly readByIdentity: () => Effect.Effect<
    Option.Option<RestoredFrameworkSchemaInstallation>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByReceipt: () => Effect.Effect<
    Option.Option<RestoredFrameworkSchemaInstallation>,
    FrameworkMigrationRepositoryError
  >;
}

export const ensureFrameworkSchemaInstallationInTransactionEffect = Effect.fn(
  "FrameworkSchemaInstallationRepository.ensure",
)(function* (
  transaction: FlarexMetadataTransaction,
  terminal: RestoredFrameworkMigrationAttemptTerminal,
  installation: FrameworkSchemaInstallation,
): Effect.fn.Return<
  RestoredFrameworkSchemaInstallation,
  FrameworkMigrationRepositoryError
> {
  const operation = "ensureInstallation" as const;
  const prepared = yield* prepareExpectedInstallation(
    terminal,
    installation,
    operation,
  );
  const storedTerminal = yield*
    corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect(
      transaction,
      prepared.terminal,
      operation,
    );

  const insertedRows = yield* runRepositoryStatement(
    operation,
    transaction.insert(fxSystemFrameworkSchemaInstallations).values({
      collisionStorageId: storedTerminal.attempt.collision.storageId,
      planStorageId: storedTerminal.attempt.plan.storageId,
      migrationPlanSha256: prepared.migrationPlanSha256Bytes,
      admissionStorageId: storedTerminal.attempt.admission.storageId,
      admissionSha256: prepared.admissionSha256Bytes,
      terminalStorageId: storedTerminal.storageId,
      terminalOutcomeKind: "succeeded",
      terminalSha256: prepared.terminalSha256Bytes,
      installationSha256: prepared.installationSha256Bytes,
      installationReceiptSha256:
        prepared.installationReceiptSha256Bytes,
      installedStructureSha256: prepared.installedStructureSha256Bytes,
      frameFormat: prepared.installation.frame.format,
      frameVersion: prepared.installation.frame.version,
      canonicalByteLength: prepared.canonicalBytes.byteLength,
      canonicalBytes: prepared.canonicalBytes,
    }).onConflictDoNothing().returning({
      installationStorageId:
        fxSystemFrameworkSchemaInstallations.installationStorageId,
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

  const resolved = yield* resolveExpectedInstallation(
    transaction,
    storedTerminal,
    prepared.installation,
    prepared.installationSha256Bytes,
    prepared.installationReceiptSha256Bytes,
    operation,
  );
  if (Option.isNone(resolved)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return resolved.value;
});

export const readFrameworkSchemaInstallationInTransactionEffect = Effect.fn(
  "FrameworkSchemaInstallationRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  terminal: RestoredFrameworkMigrationAttemptTerminal,
  installation: FrameworkSchemaInstallation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaInstallation>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readInstallation" as const;
  const prepared = yield* prepareExpectedInstallation(
    terminal,
    installation,
    operation,
  );
  const storedTerminal = yield*
    corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect(
      transaction,
      prepared.terminal,
      operation,
    );
  return yield* resolveExpectedInstallation(
    transaction,
    storedTerminal,
    prepared.installation,
    prepared.installationSha256Bytes,
    prepared.installationReceiptSha256Bytes,
    operation,
  );
});

/** Source-private semantic-first collision policy for installations. */
export const resolveAuthenticatedFrameworkSchemaInstallationOccupantsEffect =
  Effect.fn("FrameworkSchemaInstallationRepository.resolveOccupants")(
    function* (
      terminal: RestoredFrameworkMigrationAttemptTerminal,
      expected: FrameworkSchemaInstallation,
      operation: InstallationOwnerRepositoryOperation,
      lookups: FrameworkSchemaInstallationOccupantLookups,
    ): Effect.fn.Return<
      Option.Option<RestoredFrameworkSchemaInstallation>,
      FrameworkMigrationRepositoryError
    > {
      const byIdentity = yield* lookups.readByIdentity();
      if (Option.isSome(byIdentity)) {
        if (installationExactlyMatches(byIdentity.value, terminal, expected)) {
          return Option.some(byIdentity.value);
        }
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.immutableConflict(operation),
        );
      }

      const byReceipt = yield* lookups.readByReceipt();
      if (Option.isNone(byReceipt)) return Option.none();
      if (installationExactlyMatches(byReceipt.value, terminal, expected)) {
        return Option.some(byReceipt.value);
      }
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    },
  );

/** Source-private same-transaction corroboration for downstream aggregates. */
export const corroborateRestoredFrameworkSchemaInstallationInTransactionEffect =
  Effect.fn("FrameworkSchemaInstallationRepository.corroborateRestored")(
    function* (
      transaction: FlarexMetadataTransaction,
      expected: RestoredFrameworkSchemaInstallation,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaInstallation,
      FrameworkMigrationRepositoryError
    > {
      const authority = isRestoredFrameworkSchemaInstallation(expected)
        ? capturedAuthorityForFrameworkSchemaInstallation(
          expected.installation,
        )
        : undefined;
      if (
        authority === undefined ||
        authority.plan !== expected.plan.plan ||
        authority.admission !== expected.admission.admission ||
        authority.terminal !== expected.terminal.terminal
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const row = yield* loadInstallationRootByStorageId(
        transaction,
        expected.storageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const restored = yield* restoreInstallationOccupant(
        transaction,
        row.value,
        expected.collision,
        operation,
      );
      if (!restoredInstallationExactlyMatches(restored, expected)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      return restored;
    },
  );

/** Source-private restoration of a committed installation by storage ID. */
export const restoreStoredFrameworkSchemaInstallationReferenceInTransactionEffect =
  Effect.fn("FrameworkSchemaInstallationRepository.restoreReference")(
    function* (
      transaction: FlarexMetadataTransaction,
      preferredCollision: RestoredFrameworkMigrationCollisionDomain,
      installationStorageId: bigint,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaInstallation,
      FrameworkMigrationRepositoryError
    > {
      const row = yield* loadInstallationRootByStorageId(
        transaction,
        installationStorageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return yield* restoreInstallationOccupant(
        transaction,
        row.value,
        preferredCollision,
        operation,
      );
    },
  );

/** Source-private restoration for installationPublished event subjects. */
export const restoreStoredFrameworkSchemaInstallationReferenceByReceiptSha256InTransactionEffect =
  Effect.fn("FrameworkSchemaInstallationRepository.restoreReferenceByReceipt")(
    function* (
      transaction: FlarexMetadataTransaction,
      preferredCollision: RestoredFrameworkMigrationCollisionDomain,
      installationReceiptSha256: FrameworkSchemaInstallationReceiptSha256,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaInstallation,
      FrameworkMigrationRepositoryError
    > {
      const row = yield* loadInstallationRootByReceipt(
        transaction,
        yield* decodeAuthenticatedSha256(installationReceiptSha256),
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return yield* restoreInstallationOccupant(
        transaction,
        row.value,
        preferredCollision,
        operation,
      );
    },
  );

const prepareExpectedInstallation = Effect.fn(
  "FrameworkSchemaInstallationRepository.prepareExpected",
)(function* (
  terminal: RestoredFrameworkMigrationAttemptTerminal,
  installation: FrameworkSchemaInstallation,
  operation: InstallationOwnerRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkSchemaInstallation,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForFrameworkSchemaInstallation(
    installation,
  );
  if (
    !isRestoredFrameworkMigrationAttemptTerminal(terminal) ||
    authority === undefined ||
    authority.plan !== terminal.attempt.plan.plan ||
    authority.admission !== terminal.attempt.admission.admission ||
    authority.terminal !== terminal.terminal ||
    terminal.terminal.frame.outcome.kind !== "succeeded"
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* capturePrivateCanonicalValue(
    installation.frame,
    MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== installation.sha256 ||
    captured.canonicalJson !== installation.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    terminal,
    installation,
    migrationPlanSha256Bytes: yield* decodeAuthenticatedSha256(
      terminal.attempt.plan.plan.migrationPlanSha256,
    ),
    admissionSha256Bytes: yield* decodeAuthenticatedSha256(
      terminal.attempt.admission.admission.sha256,
    ),
    terminalSha256Bytes: yield* decodeAuthenticatedSha256(
      terminal.terminal.sha256,
    ),
    installationSha256Bytes: yield* decodeAuthenticatedSha256(
      installation.frame.identity.installationSha256,
    ),
    installationReceiptSha256Bytes: captured.copySha256Bytes(),
    installedStructureSha256Bytes: yield* decodeAuthenticatedSha256(
      installation.frame.installedStructureSha256,
    ),
    canonicalBytes: captured.copyCanonicalBytes(),
  });
});

const resolveExpectedInstallation = Effect.fn(
  "FrameworkSchemaInstallationRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  terminal: RestoredFrameworkMigrationAttemptTerminal,
  expected: FrameworkSchemaInstallation,
  installationSha256: Uint8Array,
  installationReceiptSha256: Uint8Array,
  operation: InstallationOwnerRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaInstallation>,
  FrameworkMigrationRepositoryError
> {
  return yield* resolveAuthenticatedFrameworkSchemaInstallationOccupantsEffect(
    terminal,
    expected,
    operation,
    {
      readByIdentity: () => loadInstallationOccupant(
        transaction,
        terminal,
        transaction.select(installationReadSelection).from(
          fxSystemFrameworkSchemaInstallations,
        ).where(eq(
          fxSystemFrameworkSchemaInstallations.installationSha256,
          installationSha256,
        )).limit(1),
        operation,
      ),
      readByReceipt: () => loadInstallationOccupant(
        transaction,
        terminal,
        transaction.select(installationReadSelection).from(
          fxSystemFrameworkSchemaInstallations,
        ).where(eq(
          fxSystemFrameworkSchemaInstallations.installationReceiptSha256,
          installationReceiptSha256,
        )).limit(1),
        operation,
      ),
    },
  );
});

const loadInstallationOccupant = Effect.fn(
  "FrameworkSchemaInstallationRepository.loadOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredTerminal: RestoredFrameworkMigrationAttemptTerminal,
  query: PromiseLike<readonly FrameworkSchemaInstallationDriverRow[]>,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkSchemaInstallation>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  return Option.some(yield* restoreInstallationOccupant(
    transaction,
    row,
    preferredTerminal.attempt.collision,
    operation,
  ));
});

const restoreInstallationOccupant = Effect.fn(
  "FrameworkSchemaInstallationRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkSchemaInstallationDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkSchemaInstallation,
  FrameworkMigrationRepositoryError
> {
  const terminal = yield*
    restoreStoredFrameworkMigrationAttemptTerminalReferenceInTransactionEffect(
      transaction,
      preferredCollision,
      row.terminalStorageId,
      operation,
    );
  return yield* restoreStoredFrameworkSchemaInstallationMetadata({
    row,
    collision: terminal.attempt.collision,
    plan: terminal.attempt.plan,
    admission: terminal.attempt.admission,
    terminal,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
});

const loadInstallationRootByStorageId = Effect.fn(
  "FrameworkSchemaInstallationRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  installationStorageId: bigint,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkSchemaInstallationDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(installationReadSelection).from(
    fxSystemFrameworkSchemaInstallations,
  ).where(eq(
    fxSystemFrameworkSchemaInstallations.installationStorageId,
    installationStorageId,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

const loadInstallationRootByReceipt = Effect.fn(
  "FrameworkSchemaInstallationRepository.loadByReceipt",
)(function* (
  transaction: FlarexMetadataTransaction,
  installationReceiptSha256: Uint8Array,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkSchemaInstallationDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(installationReadSelection).from(
    fxSystemFrameworkSchemaInstallations,
  ).where(eq(
    fxSystemFrameworkSchemaInstallations.installationReceiptSha256,
    installationReceiptSha256,
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

function installationExactlyMatches(
  actual: RestoredFrameworkSchemaInstallation,
  terminal: RestoredFrameworkMigrationAttemptTerminal,
  expected: FrameworkSchemaInstallation,
): boolean {
  return restoredTerminalExactlyMatches(actual.terminal, terminal) &&
    actual.installation.sha256 === expected.sha256 &&
    actual.installation.canonicalJson === expected.canonicalJson;
}

function restoredInstallationExactlyMatches(
  left: RestoredFrameworkSchemaInstallation,
  right: RestoredFrameworkSchemaInstallation,
): boolean {
  return left.storageId === right.storageId &&
    restoredTerminalExactlyMatches(left.terminal, right.terminal) &&
    left.installation.sha256 === right.installation.sha256 &&
    left.installation.canonicalJson === right.installation.canonicalJson;
}

function restoredTerminalExactlyMatches(
  left: RestoredFrameworkMigrationAttemptTerminal,
  right: RestoredFrameworkMigrationAttemptTerminal,
): boolean {
  const leftReceipts =
    restoredFrameworkMigrationAttemptTerminalStepReceipts(left);
  const rightReceipts =
    restoredFrameworkMigrationAttemptTerminalStepReceipts(right);
  return leftReceipts !== undefined && rightReceipts !== undefined &&
    left.storageId === right.storageId &&
    left.attempt.storageId === right.attempt.storageId &&
    left.attempt.plan.storageId === right.attempt.plan.storageId &&
    left.attempt.admission.storageId === right.attempt.admission.storageId &&
    left.attempt.collision.storageId === right.attempt.collision.storageId &&
    left.terminal.sha256 === right.terminal.sha256 &&
    left.terminal.canonicalJson === right.terminal.canonicalJson &&
    restoredReceiptPrefixesExactlyMatch(leftReceipts, rightReceipts);
}

function restoredReceiptPrefixesExactlyMatch(
  left: readonly RestoredFrameworkMigrationStepReceipt[],
  right: readonly RestoredFrameworkMigrationStepReceipt[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftReceipt = left[index];
    const rightReceipt = right[index];
    if (
      leftReceipt === undefined ||
      rightReceipt === undefined ||
      leftReceipt.storageId !== rightReceipt.storageId ||
      leftReceipt.attempt.storageId !== rightReceipt.attempt.storageId ||
      leftReceipt.receipt.sha256 !== rightReceipt.receipt.sha256 ||
      leftReceipt.receipt.canonicalJson !== rightReceipt.receipt.canonicalJson
    ) return false;
  }
  return true;
}

function decodeAuthenticatedSha256(
  value: string,
): Effect.Effect<Uint8Array> {
  return Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.orDie);
}

const installationCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkSchemaInstallations.canonicalBytes})
    <= ${MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES}
`;

const installationReadSelection = {
  installationStorageId:
    fxSystemFrameworkSchemaInstallations.installationStorageId,
  collisionStorageId: fxSystemFrameworkSchemaInstallations.collisionStorageId,
  planStorageId: fxSystemFrameworkSchemaInstallations.planStorageId,
  migrationPlanSha256:
    fxSystemFrameworkSchemaInstallations.migrationPlanSha256,
  admissionStorageId:
    fxSystemFrameworkSchemaInstallations.admissionStorageId,
  admissionSha256: fxSystemFrameworkSchemaInstallations.admissionSha256,
  terminalStorageId:
    fxSystemFrameworkSchemaInstallations.terminalStorageId,
  terminalOutcomeKind:
    fxSystemFrameworkSchemaInstallations.terminalOutcomeKind,
  terminalSha256: fxSystemFrameworkSchemaInstallations.terminalSha256,
  installationSha256:
    fxSystemFrameworkSchemaInstallations.installationSha256,
  installationReceiptSha256:
    fxSystemFrameworkSchemaInstallations.installationReceiptSha256,
  installedStructureSha256:
    fxSystemFrameworkSchemaInstallations.installedStructureSha256,
  frameFormat: fxSystemFrameworkSchemaInstallations.frameFormat,
  frameVersion: fxSystemFrameworkSchemaInstallations.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkSchemaInstallations.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkSchemaInstallations.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${installationCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkSchemaInstallations.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkSchemaInstallationRow,
  unknown
>;

import { eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { capturePrivateCanonicalValue } from
  "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturedAuthorityForAttemptTerminal } from "./authority";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationAttemptTerminalSha256 } from "./identity";
import {
  corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect,
  restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect,
} from "./migrationAttemptRepository";
import {
  corroborateRestoredFrameworkMigrationStepReceiptPrefixInTransactionEffect,
  restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect,
} from "./migrationStepReceiptRepository";
import {
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationAttemptOutcome,
  type FrameworkMigrationAttemptTerminalFrame,
  type FrameworkMigrationCollisionCoordinate,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import { fxSystemFrameworkMigrationAttemptTerminals } from "./schema";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationAttemptTerminal,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationStepReceipt,
  restoreStoredFrameworkMigrationAttemptTerminal,
  restoredFrameworkMigrationAttemptTerminalStepReceipts,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationAttemptTerminal,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationStepReceipt,
  type StoredFrameworkMigrationAttemptTerminalRow,
} from "./storedRestoration";
import { isStoredFrameworkMigrationAttemptTerminalFrame } from
  "./storedValidation";
import {
  readFrameworkMigrationCollisionDomainForOperationInTransactionEffect,
  readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect,
} from "./targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";

type FrameworkMigrationAttemptTerminal = CapturedFrameworkMigrationValue<
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationAttemptTerminalSha256
>;

type AttemptTerminalRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensureAttemptTerminal" | "readAttemptTerminal"
>;

type FailedAttemptOutcome = Extract<
  FrameworkMigrationAttemptOutcome,
  { readonly kind: "failed" }
>;

interface PreparedFrameworkMigrationAttemptTerminal {
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[];
  readonly terminal: FrameworkMigrationAttemptTerminal;
  readonly admissionSha256Bytes: Uint8Array;
  readonly attemptFence: bigint;
  readonly requiredStepSetSha256Bytes: Uint8Array | null;
  readonly failureReason: FailedAttemptOutcome["reason"] | null;
  readonly evidenceSha256Bytes: Uint8Array | null;
  readonly lastStepReceiptSha256Bytes: Uint8Array | null;
  readonly attemptTerminalSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkMigrationAttemptTerminalDriverRow
  extends StoredFrameworkMigrationAttemptTerminalRow {
  readonly terminalStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly attemptStorageId: bigint;
  readonly admissionStorageId: bigint;
  readonly admissionSha256: Uint8Array;
  readonly attemptId: string;
  readonly attemptFence: bigint;
  readonly outcomeKind: FrameworkMigrationAttemptOutcome["kind"];
  readonly requiredStepSetSha256: Uint8Array | null;
  readonly failureReason: FailedAttemptOutcome["reason"] | null;
  readonly evidenceSha256: Uint8Array | null;
  readonly lastReceiptStorageId: bigint | null;
  readonly lastStepReceiptSha256: Uint8Array | null;
  readonly attemptTerminalSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface DecodedFrameworkMigrationAttemptTerminalRoot {
  readonly storageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly attemptStorageId: bigint;
  readonly admissionStorageId: bigint;
  readonly frame: FrameworkMigrationAttemptTerminalFrame;
}

interface RestoredFrameworkMigrationAttemptTerminalOccupant {
  readonly value: RestoredFrameworkMigrationAttemptTerminal;
  readonly stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[];
}

interface FrameworkMigrationAttemptTerminalOccupantLookups {
  readonly readByAttempt: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationAttemptTerminalOccupant>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByDigest: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationAttemptTerminalOccupant>,
    FrameworkMigrationRepositoryError
  >;
}

export const ensureFrameworkMigrationAttemptTerminalInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationAttemptTerminalRepository.ensure",
  )(function* (
    transaction: FlarexMetadataTransaction,
    attempt: RestoredFrameworkMigrationAttemptStart,
    stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
    terminal: FrameworkMigrationAttemptTerminal,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationAttemptTerminal,
    FrameworkMigrationRepositoryError
  > {
    const operation = "ensureAttemptTerminal" as const;
    const prepared = yield* prepareExpectedAttemptTerminal(
      attempt,
      stepReceipts,
      terminal,
      operation,
    );
    const storedAttempt = yield*
      corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
        transaction,
        prepared.attempt,
        operation,
      );
    const storedStepReceipts = yield*
      corroborateRestoredFrameworkMigrationStepReceiptPrefixInTransactionEffect(
      transaction,
      storedAttempt,
      prepared.stepReceipts,
      operation,
    );

    const insertedRows = yield* runRepositoryStatement(
      operation,
      transaction.insert(fxSystemFrameworkMigrationAttemptTerminals).values({
        collisionStorageId: storedAttempt.collision.storageId,
        planStorageId: storedAttempt.plan.storageId,
        attemptStorageId: storedAttempt.storageId,
        admissionStorageId: storedAttempt.admission.storageId,
        admissionSha256: prepared.admissionSha256Bytes,
        attemptId: prepared.terminal.frame.attemptId,
        attemptFence: prepared.attemptFence,
        outcomeKind: prepared.terminal.frame.outcome.kind,
        requiredStepSetSha256: prepared.requiredStepSetSha256Bytes,
        failureReason: prepared.failureReason,
        evidenceSha256: prepared.evidenceSha256Bytes,
        lastReceiptStorageId: storedStepReceipts.at(-1)?.storageId ?? null,
        lastStepReceiptSha256: prepared.lastStepReceiptSha256Bytes,
        attemptTerminalSha256: prepared.attemptTerminalSha256Bytes,
        frameFormat: prepared.terminal.frame.format,
        frameVersion: prepared.terminal.frame.version,
        canonicalByteLength: prepared.canonicalBytes.byteLength,
        canonicalBytes: prepared.canonicalBytes,
      }).onConflictDoNothing().returning({
        terminalStorageId:
          fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
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
        inserted.terminalStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ));
    }

    const resolved = yield* resolveExpectedAttemptTerminal(
      transaction,
      storedAttempt,
      storedStepReceipts,
      prepared.terminal,
      prepared.attemptTerminalSha256Bytes,
      operation,
    );
    if (Option.isNone(resolved)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return resolved.value;
  });

export const readFrameworkMigrationAttemptTerminalInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationAttemptTerminalRepository.read",
  )(function* (
    transaction: FlarexMetadataTransaction,
    attempt: RestoredFrameworkMigrationAttemptStart,
    stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
    terminal: FrameworkMigrationAttemptTerminal,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationAttemptTerminal>,
    FrameworkMigrationRepositoryError
  > {
    const operation = "readAttemptTerminal" as const;
    const prepared = yield* prepareExpectedAttemptTerminal(
      attempt,
      stepReceipts,
      terminal,
      operation,
    );
    const storedAttempt = yield*
      corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
        transaction,
        prepared.attempt,
        operation,
      );
    const storedStepReceipts = yield*
      corroborateRestoredFrameworkMigrationStepReceiptPrefixInTransactionEffect(
      transaction,
      storedAttempt,
      prepared.stepReceipts,
      operation,
    );
    return yield* resolveExpectedAttemptTerminal(
      transaction,
      storedAttempt,
      storedStepReceipts,
      prepared.terminal,
      prepared.attemptTerminalSha256Bytes,
      operation,
    );
  });

/** Source-private semantic-first collision policy for attempt terminals. */
export const resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect =
  Effect.fn(
    "FrameworkMigrationAttemptTerminalRepository.resolveOccupants",
  )(function* (
    attempt: RestoredFrameworkMigrationAttemptStart,
    stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
    expected: FrameworkMigrationAttemptTerminal,
    operation: AttemptTerminalRepositoryOperation,
    lookups: FrameworkMigrationAttemptTerminalOccupantLookups,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationAttemptTerminal>,
    FrameworkMigrationRepositoryError
  > {
    const byAttempt = yield* lookups.readByAttempt();
    if (Option.isSome(byAttempt)) {
      if (attemptTerminalExactlyMatches(
        byAttempt.value,
        attempt,
        stepReceipts,
        expected,
      )) return Option.some(byAttempt.value.value);
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    }

    const byDigest = yield* lookups.readByDigest();
    if (Option.isNone(byDigest)) return Option.none();
    if (attemptTerminalExactlyMatches(
      byDigest.value,
      attempt,
      stepReceipts,
      expected,
    )) return Option.some(byDigest.value.value);
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  });

/** Source-private same-transaction corroboration for downstream aggregates. */
export const corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationAttemptTerminalRepository.corroborateRestored",
  )(function* (
    transaction: FlarexMetadataTransaction,
    expected: RestoredFrameworkMigrationAttemptTerminal,
    operation: AttemptTerminalRepositoryOperation,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationAttemptTerminal,
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFrameworkMigrationAttemptTerminal(expected)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const authority = capturedAuthorityForAttemptTerminal(expected.terminal);
    const expectedStepReceipts =
      restoredFrameworkMigrationAttemptTerminalStepReceipts(expected);
    if (
      authority === undefined ||
      expectedStepReceipts === undefined ||
      authority.attempt !== expected.attempt.attempt ||
      authority.admission !== expected.attempt.admission.admission
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const row = yield* loadAttemptTerminalRootByStorageId(
      transaction,
      expected.storageId,
      operation,
    );
    if (Option.isNone(row)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const occupant = yield* restoreAttemptTerminalOccupant(
      transaction,
      row.value,
      expected.attempt.collision,
      operation,
    );
    if (
      !restoredAttemptTerminalExactlyMatches(occupant.value, expected) ||
      !restoredStepReceiptPrefixesExactlyMatch(
        occupant.stepReceipts,
        expectedStepReceipts,
      )
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    return occupant.value;
  });

const prepareExpectedAttemptTerminal = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.prepareExpected",
)(function* (
  attempt: RestoredFrameworkMigrationAttemptStart,
  stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  terminal: FrameworkMigrationAttemptTerminal,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkMigrationAttemptTerminal,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForAttemptTerminal(terminal);
  if (
    !isRestoredFrameworkMigrationAttemptStart(attempt) ||
    !Array.isArray(stepReceipts) ||
    authority === undefined ||
    authority.admission !== attempt.admission.admission ||
    authority.attempt !== attempt.attempt ||
    authority.stepReceipts.length !== stepReceipts.length ||
    !attemptTerminalFrameMatchesAttemptAndReceipts(
      terminal.frame,
      attempt,
      stepReceipts,
    )
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  for (let ordinal = 0; ordinal < stepReceipts.length; ordinal += 1) {
    const receipt = stepReceipts[ordinal];
    if (
      receipt === undefined ||
      !isRestoredFrameworkMigrationStepReceipt(receipt) ||
      !restoredAttemptExactlyMatches(receipt.attempt, attempt) ||
      receipt.receipt.sha256 !== authority.stepReceipts[ordinal]?.sha256 ||
      receipt.receipt.canonicalJson !==
        authority.stepReceipts[ordinal]?.canonicalJson ||
      receipt.receipt.frame.stepId !==
        attempt.plan.plan.frame.steps[ordinal]?.stepId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
  }

  const captured = yield* capturePrivateCanonicalValue(
    terminal.frame,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== terminal.sha256 ||
    captured.canonicalJson !== terminal.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const outcome = terminal.frame.outcome;
  return Object.freeze({
    attempt,
    stepReceipts: Object.freeze([...stepReceipts]),
    terminal,
    admissionSha256Bytes: yield* decodeAuthenticatedSha256(
      attempt.admission.admission.sha256,
    ),
    attemptFence: BigInt(terminal.frame.attemptFence),
    requiredStepSetSha256Bytes: outcome.kind === "succeeded"
      ? yield* decodeAuthenticatedSha256(outcome.requiredStepSetSha256)
      : null,
    failureReason: outcome.kind === "failed" ? outcome.reason : null,
    evidenceSha256Bytes: outcome.kind === "succeeded"
      ? null
      : yield* decodeAuthenticatedSha256(outcome.evidenceSha256),
    lastStepReceiptSha256Bytes:
      terminal.frame.lastStepReceiptSha256 === null
        ? null
        : yield* decodeAuthenticatedSha256(
          terminal.frame.lastStepReceiptSha256,
        ),
    attemptTerminalSha256Bytes: captured.copySha256Bytes(),
    canonicalBytes: captured.copyCanonicalBytes(),
  });
});

const resolveExpectedAttemptTerminal = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  expected: FrameworkMigrationAttemptTerminal,
  attemptTerminalSha256Bytes: Uint8Array,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptTerminal>,
  FrameworkMigrationRepositoryError
> {
  return yield*
    resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect(
      attempt,
      stepReceipts,
      expected,
      operation,
      {
        readByAttempt: () => loadAttemptTerminalOccupantByAttempt(
          transaction,
          attempt,
          operation,
        ),
        readByDigest: () => loadAttemptTerminalOccupantByDigest(
          transaction,
          attempt,
          attemptTerminalSha256Bytes,
          operation,
        ),
      },
    );
});

const loadAttemptTerminalOccupantByAttempt = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.loadByAttempt",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptTerminalOccupant>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(attemptTerminalReadSelection).from(
    fxSystemFrameworkMigrationAttemptTerminals,
  ).where(eq(
    fxSystemFrameworkMigrationAttemptTerminals.attemptStorageId,
    preferredAttempt.storageId,
  )).limit(1);
  return yield* loadAttemptTerminalOccupant(
    transaction,
    preferredAttempt,
    query,
    operation,
  );
});

const loadAttemptTerminalOccupantByDigest = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.loadByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  attemptTerminalSha256: Uint8Array,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptTerminalOccupant>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(attemptTerminalReadSelection).from(
    fxSystemFrameworkMigrationAttemptTerminals,
  ).where(eq(
    fxSystemFrameworkMigrationAttemptTerminals.attemptTerminalSha256,
    attemptTerminalSha256,
  )).limit(1);
  return yield* loadAttemptTerminalOccupant(
    transaction,
    preferredAttempt,
    query,
    operation,
  );
});

const loadAttemptTerminalOccupant = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.loadOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  query: PromiseLike<readonly FrameworkMigrationAttemptTerminalDriverRow[]>,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptTerminalOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  return Option.some(yield* restoreAttemptTerminalOccupant(
    transaction,
    row,
    preferredAttempt.collision,
    operation,
  ));
});

const restoreAttemptTerminalOccupant = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationAttemptTerminalDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationAttemptTerminalOccupant,
  FrameworkMigrationRepositoryError
> {
  const decoded = yield* decodeAttemptTerminalRoot(row, operation);
  const actualCollision = yield* resolveAttemptTerminalOccupantCollision(
    transaction,
    row,
    decoded.frame,
    preferredCollision,
    operation,
  );
  const attempt = yield*
    restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(
      transaction,
      actualCollision,
      decoded.attemptStorageId,
      decoded.frame.attemptId,
      operation,
    ).pipe(Effect.mapError(error =>
      mapStoredRepositoryError(operation, error)
    ));
  if (
    attempt.collision.storageId !== decoded.collisionStorageId ||
    attempt.plan.storageId !== decoded.planStorageId ||
    attempt.admission.storageId !== decoded.admissionStorageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const stepReceipts = yield*
    restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect(
      transaction,
      attempt,
      row.lastReceiptStorageId,
      row.lastStepReceiptSha256,
      operation,
    );
  const value = yield* restoreStoredFrameworkMigrationAttemptTerminal({
    row,
    collision: attempt.collision,
    plan: attempt.plan,
    admission: attempt.admission,
    attempt,
    stepReceipts,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  return Object.freeze({ value, stepReceipts });
});

const decodeAttemptTerminalRoot = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.decodeRoot",
)(function* (
  row: FrameworkMigrationAttemptTerminalDriverRow,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkMigrationAttemptTerminalRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.terminalStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const collisionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.collisionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const planStorageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.planStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const attemptStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.attemptStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const admissionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.admissionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.attemptTerminalSha256,
    {
      format: FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
      version: FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "attemptTerminal",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isStoredFrameworkMigrationAttemptTerminalFrame(frame)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const attemptFence = yield* Effect.fromResult(
    decodeStoredNonNegativeInt64TextResult(
      row.attemptFence,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  if (
    row.attemptId !== frame.attemptId ||
    attemptFence !== frame.attemptFence ||
    row.outcomeKind !== frame.outcome.kind
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return Object.freeze({
    storageId,
    collisionStorageId,
    planStorageId,
    attemptStorageId,
    admissionStorageId,
    frame,
  });
});

const resolveAttemptTerminalOccupantCollision = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.resolveOccupantCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationAttemptTerminalDriverRow,
  frame: FrameworkMigrationAttemptTerminalFrame,
  preferred: RestoredFrameworkMigrationCollisionDomain,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (
    isRestoredFrameworkMigrationCollisionDomain(preferred) &&
    row.collisionStorageId === preferred.storageId &&
    sameCollisionCoordinate(frame.collision, preferred.coordinate)
  ) return preferred;

  const targetValue = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: frame.collision.targetNamespace.deploymentId,
    physicalDatabaseIdentity:
      frame.collision.targetNamespace.physicalDatabaseIdentity,
    schemaName: frame.collision.targetNamespace.schemaName,
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

const loadAttemptTerminalRootByStorageId = Effect.fn(
  "FrameworkMigrationAttemptTerminalRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  terminalStorageId: bigint,
  operation: AttemptTerminalRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationAttemptTerminalDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(attemptTerminalReadSelection).from(
    fxSystemFrameworkMigrationAttemptTerminals,
  ).where(eq(
    fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
    terminalStorageId,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

function runRepositoryStatement<Value>(
  operation: AttemptTerminalRepositoryOperation,
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
  operation: AttemptTerminalRepositoryOperation,
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
  operation: AttemptTerminalRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function attemptTerminalExactlyMatches(
  occupant: RestoredFrameworkMigrationAttemptTerminalOccupant,
  attempt: RestoredFrameworkMigrationAttemptStart,
  stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  expected: FrameworkMigrationAttemptTerminal,
): boolean {
  if (
    !restoredAttemptExactlyMatches(occupant.value.attempt, attempt) ||
    occupant.value.terminal.sha256 !== expected.sha256 ||
    occupant.value.terminal.canonicalJson !== expected.canonicalJson ||
    occupant.stepReceipts.length !== stepReceipts.length
  ) return false;
  for (let ordinal = 0; ordinal < stepReceipts.length; ordinal += 1) {
    const actualReceipt = occupant.stepReceipts[ordinal];
    const expectedReceipt = stepReceipts[ordinal];
    if (
      actualReceipt === undefined ||
      expectedReceipt === undefined ||
      !restoredStepReceiptExactlyMatches(actualReceipt, expectedReceipt)
    ) return false;
  }
  return true;
}

function restoredAttemptTerminalExactlyMatches(
  left: RestoredFrameworkMigrationAttemptTerminal,
  right: RestoredFrameworkMigrationAttemptTerminal,
): boolean {
  return left.storageId === right.storageId &&
    restoredAttemptExactlyMatches(left.attempt, right.attempt) &&
    left.terminal.sha256 === right.terminal.sha256 &&
    left.terminal.canonicalJson === right.terminal.canonicalJson;
}

function restoredStepReceiptExactlyMatches(
  left: RestoredFrameworkMigrationStepReceipt,
  right: RestoredFrameworkMigrationStepReceipt,
): boolean {
  return left.storageId === right.storageId &&
    restoredAttemptExactlyMatches(left.attempt, right.attempt) &&
    left.receipt.sha256 === right.receipt.sha256 &&
    left.receipt.canonicalJson === right.receipt.canonicalJson;
}

function restoredStepReceiptPrefixesExactlyMatch(
  left: readonly RestoredFrameworkMigrationStepReceipt[],
  right: readonly RestoredFrameworkMigrationStepReceipt[],
): boolean {
  if (left.length !== right.length) return false;
  for (let ordinal = 0; ordinal < left.length; ordinal += 1) {
    const leftReceipt = left[ordinal];
    const rightReceipt = right[ordinal];
    if (
      leftReceipt === undefined ||
      rightReceipt === undefined ||
      !restoredStepReceiptExactlyMatches(leftReceipt, rightReceipt)
    ) return false;
  }
  return true;
}

function restoredAttemptExactlyMatches(
  left: RestoredFrameworkMigrationAttemptStart,
  right: RestoredFrameworkMigrationAttemptStart,
): boolean {
  return left.storageId === right.storageId &&
    left.collision.storageId === right.collision.storageId &&
    left.plan.storageId === right.plan.storageId &&
    left.admission.storageId === right.admission.storageId &&
    left.attempt.sha256 === right.attempt.sha256 &&
    left.attempt.canonicalJson === right.attempt.canonicalJson;
}

function attemptTerminalFrameMatchesAttemptAndReceipts(
  frame: FrameworkMigrationAttemptTerminalFrame,
  attempt: RestoredFrameworkMigrationAttemptStart,
  stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
): boolean {
  return sameCollisionCoordinate(frame.collision, attempt.collision.coordinate) &&
    frame.planSha256 === attempt.plan.plan.migrationPlanSha256 &&
    frame.attemptId === attempt.attempt.frame.attemptId &&
    frame.attemptFence === attempt.attempt.frame.attemptFence &&
    frame.lastStepReceiptSha256 ===
      (stepReceipts.at(-1)?.receipt.sha256 ?? null);
}

function sameCollisionCoordinate(
  left: FrameworkMigrationCollisionCoordinate,
  right: FrameworkMigrationCollisionCoordinate,
): boolean {
  return sameTargetNamespace(left.targetNamespace, right.targetNamespace) &&
    left.owner === right.owner &&
    left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function sameTargetNamespace(
  left: FrameworkMigrationCollisionCoordinate["targetNamespace"],
  right: FrameworkMigrationCollisionCoordinate["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

const attemptTerminalCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationAttemptTerminals.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES}
`;

const attemptTerminalReadSelection = {
  terminalStorageId:
    fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
  collisionStorageId:
    fxSystemFrameworkMigrationAttemptTerminals.collisionStorageId,
  planStorageId: fxSystemFrameworkMigrationAttemptTerminals.planStorageId,
  attemptStorageId:
    fxSystemFrameworkMigrationAttemptTerminals.attemptStorageId,
  admissionStorageId:
    fxSystemFrameworkMigrationAttemptTerminals.admissionStorageId,
  admissionSha256:
    fxSystemFrameworkMigrationAttemptTerminals.admissionSha256,
  attemptId: fxSystemFrameworkMigrationAttemptTerminals.attemptId,
  attemptFence: fxSystemFrameworkMigrationAttemptTerminals.attemptFence,
  outcomeKind: fxSystemFrameworkMigrationAttemptTerminals.outcomeKind,
  requiredStepSetSha256:
    fxSystemFrameworkMigrationAttemptTerminals.requiredStepSetSha256,
  failureReason: fxSystemFrameworkMigrationAttemptTerminals.failureReason,
  evidenceSha256: fxSystemFrameworkMigrationAttemptTerminals.evidenceSha256,
  lastReceiptStorageId:
    fxSystemFrameworkMigrationAttemptTerminals.lastReceiptStorageId,
  lastStepReceiptSha256:
    fxSystemFrameworkMigrationAttemptTerminals.lastStepReceiptSha256,
  attemptTerminalSha256:
    fxSystemFrameworkMigrationAttemptTerminals.attemptTerminalSha256,
  frameFormat: fxSystemFrameworkMigrationAttemptTerminals.frameFormat,
  frameVersion: fxSystemFrameworkMigrationAttemptTerminals.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkMigrationAttemptTerminals.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationAttemptTerminals.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${attemptTerminalCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationAttemptTerminals.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkMigrationAttemptTerminalRow,
  unknown
>;

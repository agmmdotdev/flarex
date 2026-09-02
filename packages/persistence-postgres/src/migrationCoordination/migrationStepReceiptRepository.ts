import { compareUtf16Strings } from "@flarex/utils/strings";
import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { capturePrivateCanonicalValue } from
  "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturedAuthorityForStepReceipt } from "./authority";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationStepReceiptSha256 } from "./identity";
import {
  corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect,
  restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect,
} from "./migrationAttemptRepository";
import {
  FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationCollisionCoordinate,
  type FrameworkMigrationStepReceiptFrame,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import {
  fxSystemFrameworkMigrationStepReceiptDependencies,
  fxSystemFrameworkMigrationStepReceipts,
} from "./schema";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationStepReceipt,
  restoreStoredFrameworkMigrationStepReceipt,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationStepReceipt,
  type StoredFrameworkMigrationStepReceiptDependencyRow,
  type StoredFrameworkMigrationStepReceiptRow,
} from "./storedRestoration";
import { isStoredFrameworkMigrationStepReceiptFrame } from
  "./storedValidation";
import {
  readFrameworkMigrationCollisionDomainForOperationInTransactionEffect,
  readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect,
} from "./targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";

type FrameworkMigrationStepReceipt = CapturedFrameworkMigrationValue<
  FrameworkMigrationStepReceiptFrame,
  FrameworkMigrationStepReceiptSha256
>;

type StepReceiptRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensureStepReceipt" | "readStepReceipt"
>;

const RECEIPT_DEPENDENCY_INSERT_BATCH_SIZE = 256;

interface PreparedFrameworkMigrationStepReceiptDependency {
  readonly receipt: RestoredFrameworkMigrationStepReceipt;
  readonly stepId: string;
  readonly stepReceiptSha256Bytes: Uint8Array;
}

interface PreparedFrameworkMigrationStepReceipt {
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly receipt: FrameworkMigrationStepReceipt;
  readonly stepSha256Bytes: Uint8Array;
  readonly preconditionSha256Bytes: Uint8Array;
  readonly postconditionSha256Bytes: Uint8Array;
  readonly observedPostconditionSha256Bytes: Uint8Array;
  readonly stepReceiptSha256Bytes: Uint8Array;
  readonly attemptFence: bigint;
  readonly canonicalBytes: Uint8Array;
  readonly dependencies:
    readonly PreparedFrameworkMigrationStepReceiptDependency[];
}

interface FrameworkMigrationStepReceiptDriverRow
  extends StoredFrameworkMigrationStepReceiptRow {
  readonly receiptStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly attemptStorageId: bigint;
  readonly attemptId: string;
  readonly attemptFence: bigint;
  readonly stepId: string;
  readonly stepSha256: Uint8Array;
  readonly preconditionSha256: Uint8Array;
  readonly postconditionSha256: Uint8Array;
  readonly observedPostconditionSha256: Uint8Array;
  readonly dependencyCount: number;
  readonly stepReceiptSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface FrameworkMigrationStepReceiptDependencyDriverRow
  extends StoredFrameworkMigrationStepReceiptDependencyRow {
  readonly receiptStorageId: bigint;
  readonly attemptStorageId: bigint;
  readonly dependencyOrdinal: number;
  readonly dependencyReceiptStorageId: bigint;
  readonly dependencyStepId: string;
  readonly dependencyStepReceiptSha256: Uint8Array;
}

interface DecodedFrameworkMigrationStepReceiptRoot {
  readonly storageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly attemptStorageId: bigint;
  readonly stepReceiptSha256: string;
  readonly frame: FrameworkMigrationStepReceiptFrame;
}

interface RestoredFrameworkMigrationStepReceiptOccupant {
  readonly value: RestoredFrameworkMigrationStepReceipt;
  readonly dependencyReceipts:
    readonly RestoredFrameworkMigrationStepReceipt[];
}

interface FrameworkMigrationStepReceiptOccupantLookups {
  readonly readByAttemptStep: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationStepReceiptOccupant>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByDigest: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationStepReceiptOccupant>,
    FrameworkMigrationRepositoryError
  >;
}

interface ReceiptRestorationContext {
  readonly rootsByStorageId:
    Map<bigint, FrameworkMigrationStepReceiptDriverRow>;
  readonly restoredByStorageId:
    Map<bigint, RestoredFrameworkMigrationStepReceiptOccupant>;
  readonly storageIdByStepId: Map<string, bigint>;
  readonly storageIdByDigest: Map<string, bigint>;
}

interface PendingReceiptRestoration {
  readonly row: FrameworkMigrationStepReceiptDriverRow;
  readonly decoded: DecodedFrameworkMigrationStepReceiptRoot;
  readonly dependencyRows:
    readonly FrameworkMigrationStepReceiptDependencyDriverRow[];
  readonly dependencyStorageIds: bigint[];
  readonly seenDependencyStorageIds: Set<bigint>;
  nextDependencyIndex: number;
}

interface FrameworkMigrationStepReceiptDependencyInsert {
  readonly receiptStorageId: bigint;
  readonly attemptStorageId: bigint;
  readonly dependencyOrdinal: number;
  readonly dependencyReceiptStorageId: bigint;
  readonly dependencyStepId: string;
  readonly dependencyStepReceiptSha256: Uint8Array;
}

export const ensureFrameworkMigrationStepReceiptInTransactionEffect = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.ensure",
)(function* (
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  dependencyReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  receipt: FrameworkMigrationStepReceipt,
): Effect.fn.Return<
  RestoredFrameworkMigrationStepReceipt,
  FrameworkMigrationRepositoryError
> {
  const operation = "ensureStepReceipt" as const;
  const prepared = yield* prepareExpectedStepReceipt(
    attempt,
    dependencyReceipts,
    receipt,
    operation,
  );
  const storedAttempt = yield*
    corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
      transaction,
      prepared.attempt,
      operation,
    );
  const storedDependencies = yield* corroborateRestoredDependencyReceipts(
    transaction,
    storedAttempt,
    prepared.dependencies,
    operation,
  );

  const insertedRows = yield* runRepositoryStatement(
    operation,
    transaction.insert(fxSystemFrameworkMigrationStepReceipts).values({
      collisionStorageId: storedAttempt.collision.storageId,
      planStorageId: storedAttempt.plan.storageId,
      attemptStorageId: storedAttempt.storageId,
      attemptId: prepared.receipt.frame.attemptId,
      attemptFence: prepared.attemptFence,
      stepId: prepared.receipt.frame.stepId,
      stepSha256: prepared.stepSha256Bytes,
      preconditionSha256: prepared.preconditionSha256Bytes,
      postconditionSha256: prepared.postconditionSha256Bytes,
      observedPostconditionSha256:
        prepared.observedPostconditionSha256Bytes,
      dependencyCount: prepared.dependencies.length,
      stepReceiptSha256: prepared.stepReceiptSha256Bytes,
      frameFormat: prepared.receipt.frame.format,
      frameVersion: prepared.receipt.frame.version,
      canonicalByteLength: prepared.canonicalBytes.byteLength,
      canonicalBytes: prepared.canonicalBytes,
    }).onConflictDoNothing().returning({
      receiptStorageId:
        fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
    }),
  ).pipe(Effect.map(detachDriverRows));
  if (insertedRows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const inserted = insertedRows[0];
  if (inserted !== undefined) {
    const receiptStorageId = yield* Effect.fromResult(
      decodeStoredStorageIdResult(
        inserted.receiptStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    yield* insertReceiptDependencySidecars(
      transaction,
      receiptStorageId,
      storedAttempt.storageId,
      prepared.dependencies,
      storedDependencies,
      operation,
    );
  }

  const resolved = yield* resolveExpectedStepReceipt(
    transaction,
    storedAttempt,
    storedDependencies,
    prepared.receipt,
    prepared.stepReceiptSha256Bytes,
    operation,
  );
  if (Option.isNone(resolved)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return resolved.value;
});

export const readFrameworkMigrationStepReceiptInTransactionEffect = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  dependencyReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  receipt: FrameworkMigrationStepReceipt,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationStepReceipt>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readStepReceipt" as const;
  const prepared = yield* prepareExpectedStepReceipt(
    attempt,
    dependencyReceipts,
    receipt,
    operation,
  );
  const storedAttempt = yield*
    corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
      transaction,
      prepared.attempt,
      operation,
    );
  const storedDependencies = yield* corroborateRestoredDependencyReceipts(
    transaction,
    storedAttempt,
    prepared.dependencies,
    operation,
  );
  return yield* resolveExpectedStepReceipt(
    transaction,
    storedAttempt,
    storedDependencies,
    prepared.receipt,
    prepared.stepReceiptSha256Bytes,
    operation,
  );
});

/** Source-private semantic-first collision policy for authenticated receipts. */
export const resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect =
  Effect.fn(
    "FrameworkMigrationStepReceiptRepository.resolveOccupants",
  )(function* (
    attempt: RestoredFrameworkMigrationAttemptStart,
    dependencyReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
    expected: FrameworkMigrationStepReceipt,
    operation: StepReceiptRepositoryOperation,
    lookups: FrameworkMigrationStepReceiptOccupantLookups,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationStepReceipt>,
    FrameworkMigrationRepositoryError
  > {
    const byAttemptStep = yield* lookups.readByAttemptStep();
    if (Option.isSome(byAttemptStep)) {
      if (stepReceiptExactlyMatches(
        byAttemptStep.value,
        attempt,
        dependencyReceipts,
        expected,
      )) return Option.some(byAttemptStep.value.value);
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    }

    const byDigest = yield* lookups.readByDigest();
    if (Option.isNone(byDigest)) return Option.none();
    if (stepReceiptExactlyMatches(
      byDigest.value,
      attempt,
      dependencyReceipts,
      expected,
    )) return Option.some(byDigest.value.value);
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  });

/**
 * Source-private same-transaction corroboration for a restored receipt used by
 * a later aggregate. Its complete stored dependency closure is authenticated.
 */
export const corroborateRestoredFrameworkMigrationStepReceiptInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationStepReceiptRepository.corroborateRestored",
  )(function* (
    transaction: FlarexMetadataTransaction,
    expected: RestoredFrameworkMigrationStepReceipt,
    operation: StepReceiptRepositoryOperation,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationStepReceipt,
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFrameworkMigrationStepReceipt(expected)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const storedAttempt = yield*
      corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
        transaction,
        expected.attempt,
        operation,
      );
    const row = yield* loadReceiptRootByStorageId(
      transaction,
      expected.storageId,
      operation,
    );
    if (Option.isNone(row)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const occupant = yield* restoreReceiptDependencyClosure(
      transaction,
      row.value,
      storedAttempt.collision,
      operation,
      storedAttempt,
      makeReceiptRestorationContext(),
    );
    if (!restoredStepReceiptExactlyMatches(occupant.value, expected)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    return occupant.value;
  });

const prepareExpectedStepReceipt = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.prepareExpected",
)(function* (
  attempt: RestoredFrameworkMigrationAttemptStart,
  dependencyReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  receipt: FrameworkMigrationStepReceipt,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkMigrationStepReceipt,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForStepReceipt(receipt);
  const step = authority?.step;
  if (
    !isRestoredFrameworkMigrationAttemptStart(attempt) ||
    authority === undefined ||
    authority.attempt !== attempt.attempt ||
    step === undefined ||
    attempt.plan.plan.frame.steps[step.ordinal] !== step ||
    !Array.isArray(dependencyReceipts) ||
    !stepReceiptFrameMatchesAttemptAndStep(receipt.frame, attempt, step)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  if (dependencyReceipts.length !== receipt.frame.dependencyReceipts.length) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }

  const dependencies: PreparedFrameworkMigrationStepReceiptDependency[] = [];
  for (let index = 0; index < dependencyReceipts.length; index += 1) {
    const dependency = dependencyReceipts[index];
    const reference = receipt.frame.dependencyReceipts[index];
    if (
      dependency === undefined ||
      reference === undefined ||
      !isRestoredFrameworkMigrationStepReceipt(dependency) ||
      !restoredAttemptExactlyMatches(dependency.attempt, attempt) ||
      dependency.receipt.frame.stepId !== reference.stepId ||
      dependency.receipt.sha256 !== reference.stepReceiptSha256
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    dependencies.push(Object.freeze({
      receipt: dependency,
      stepId: reference.stepId,
      stepReceiptSha256Bytes: yield* decodeAuthenticatedSha256(
        reference.stepReceiptSha256,
      ),
    }));
  }

  const captured = yield* capturePrivateCanonicalValue(
    receipt.frame,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== receipt.sha256 ||
    captured.canonicalJson !== receipt.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    attempt,
    receipt,
    stepSha256Bytes: yield* decodeAuthenticatedSha256(receipt.frame.stepSha256),
    preconditionSha256Bytes: yield* decodeAuthenticatedSha256(
      receipt.frame.preconditionSha256,
    ),
    postconditionSha256Bytes: yield* decodeAuthenticatedSha256(
      receipt.frame.postconditionSha256,
    ),
    observedPostconditionSha256Bytes: yield* decodeAuthenticatedSha256(
      receipt.frame.observedPostconditionSha256,
    ),
    stepReceiptSha256Bytes: captured.copySha256Bytes(),
    attemptFence: BigInt(receipt.frame.attemptFence),
    canonicalBytes: captured.copyCanonicalBytes(),
    dependencies: Object.freeze(dependencies),
  });
});

const corroborateRestoredDependencyReceipts = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.corroborateDependencies",
)(function* (
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  dependencies: readonly PreparedFrameworkMigrationStepReceiptDependency[],
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  readonly RestoredFrameworkMigrationStepReceipt[],
  FrameworkMigrationRepositoryError
> {
  const context = makeReceiptRestorationContext();
  const restored: RestoredFrameworkMigrationStepReceipt[] = [];
  for (const dependency of dependencies) {
    const row = yield* loadReceiptRootByStorageId(
      transaction,
      dependency.receipt.storageId,
      operation,
    );
    if (Option.isNone(row)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const occupant = yield* restoreReceiptDependencyClosure(
      transaction,
      row.value,
      attempt.collision,
      operation,
      attempt,
      context,
    );
    if (!restoredStepReceiptExactlyMatches(
      occupant.value,
      dependency.receipt,
    )) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    restored.push(occupant.value);
  }
  return Object.freeze(restored);
});

const resolveExpectedStepReceipt = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  dependencyReceipts: readonly RestoredFrameworkMigrationStepReceipt[],
  expected: FrameworkMigrationStepReceipt,
  stepReceiptSha256Bytes: Uint8Array,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationStepReceipt>,
  FrameworkMigrationRepositoryError
> {
  return yield*
    resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect(
      attempt,
      dependencyReceipts,
      expected,
      operation,
      {
        readByAttemptStep: () => loadReceiptOccupantByAttemptStep(
          transaction,
          attempt,
          expected.frame.stepId,
          operation,
        ),
        readByDigest: () => loadReceiptOccupantByDigest(
          transaction,
          attempt,
          stepReceiptSha256Bytes,
          operation,
        ),
      },
    );
});

const loadReceiptOccupantByAttemptStep = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadByAttemptStep",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  stepId: string,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationStepReceiptOccupant>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(receiptReadSelection).from(
    fxSystemFrameworkMigrationStepReceipts,
  ).where(and(
    eq(
      fxSystemFrameworkMigrationStepReceipts.attemptStorageId,
      preferredAttempt.storageId,
    ),
    eq(fxSystemFrameworkMigrationStepReceipts.stepId, stepId),
  )).limit(1);
  return yield* loadReceiptOccupant(
    transaction,
    preferredAttempt,
    query,
    operation,
  );
});

const loadReceiptOccupantByDigest = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  stepReceiptSha256: Uint8Array,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationStepReceiptOccupant>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(receiptReadSelection).from(
    fxSystemFrameworkMigrationStepReceipts,
  ).where(eq(
    fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256,
    stepReceiptSha256,
  )).limit(1);
  return yield* loadReceiptOccupant(
    transaction,
    preferredAttempt,
    query,
    operation,
  );
});

const loadReceiptOccupant = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  query: PromiseLike<readonly FrameworkMigrationStepReceiptDriverRow[]>,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationStepReceiptOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  if (row === undefined) return Option.none();
  return Option.some(yield* restoreReceiptDependencyClosure(
    transaction,
    row,
    preferredAttempt.collision,
    operation,
    preferredAttempt,
    makeReceiptRestorationContext(),
  ));
});

const restoreReceiptDependencyClosure = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.restoreDependencyClosure",
)(function* (
  transaction: FlarexMetadataTransaction,
  root: FrameworkMigrationStepReceiptDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: StepReceiptRepositoryOperation,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart | undefined,
  context: ReceiptRestorationContext,
): Effect.fn.Return<
  RestoredFrameworkMigrationStepReceiptOccupant,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkMigrationCollisionDomain(preferredCollision)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const rootDecoded = yield* decodeReceiptRoot(root, operation);
  const actualCollision = yield* resolveReceiptOccupantCollision(
    transaction,
    root,
    rootDecoded.frame,
    preferredCollision,
    operation,
  );
  const attempt = preferredAttempt !== undefined &&
      isRestoredFrameworkMigrationAttemptStart(preferredAttempt) &&
      preferredAttempt.storageId === rootDecoded.attemptStorageId &&
      preferredAttempt.collision.storageId === rootDecoded.collisionStorageId &&
      preferredAttempt.plan.storageId === rootDecoded.planStorageId &&
      preferredAttempt.attempt.frame.attemptId === rootDecoded.frame.attemptId
    ? preferredAttempt
    : yield*
      restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(
        transaction,
        actualCollision,
        rootDecoded.attemptStorageId,
        rootDecoded.frame.attemptId,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      ));
  if (
    attempt.collision.storageId !== rootDecoded.collisionStorageId ||
    attempt.plan.storageId !== rootDecoded.planStorageId ||
    attempt.attempt.frame.attemptFence !== rootDecoded.frame.attemptFence
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  if (!registerDecodedReceiptRoot(context, rootDecoded)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }

  const cachedRoot = context.restoredByStorageId.get(rootDecoded.storageId);
  if (cachedRoot !== undefined) {
    if (!restoredAttemptExactlyMatches(cachedRoot.value.attempt, attempt)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return cachedRoot;
  }
  context.rootsByStorageId.set(rootDecoded.storageId, root);
  const firstPending = yield* preparePendingReceiptRestoration(
    transaction,
    root,
    rootDecoded,
    attempt,
    operation,
  );
  const stack: PendingReceiptRestoration[] = [firstPending];
  const visiting = new Set<bigint>([rootDecoded.storageId]);

  while (stack.length > 0) {
    const pending = stack.at(-1);
    if (pending === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    if (pending.nextDependencyIndex < pending.dependencyRows.length) {
      const dependencyOrdinal = pending.nextDependencyIndex;
      const dependencyRow = pending.dependencyRows[dependencyOrdinal];
      const reference =
        pending.decoded.frame.dependencyReceipts[dependencyOrdinal];
      pending.nextDependencyIndex += 1;
      if (dependencyRow === undefined || reference === undefined) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const projectedDependencySha256 = yield* decodeStoredSha256(
        dependencyRow.dependencyStepReceiptSha256,
        operation,
      );
      if (
        dependencyRow.receiptStorageId !== pending.decoded.storageId ||
        dependencyRow.attemptStorageId !== attempt.storageId ||
        dependencyRow.dependencyOrdinal !== dependencyOrdinal ||
        dependencyRow.dependencyStepId !== reference.stepId ||
        projectedDependencySha256 !== reference.stepReceiptSha256
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const dependencyStorageId = yield* Effect.fromResult(
        decodeStoredStorageIdResult(
          dependencyRow.dependencyReceiptStorageId,
          () => FrameworkMigrationRepositoryError.storedCorruption(operation),
        ),
      );
      if (
        pending.seenDependencyStorageIds.has(dependencyStorageId) ||
        dependencyStorageId === pending.decoded.storageId ||
        visiting.has(dependencyStorageId)
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      pending.seenDependencyStorageIds.add(dependencyStorageId);
      pending.dependencyStorageIds.push(dependencyStorageId);
      const restoredDependency =
        context.restoredByStorageId.get(dependencyStorageId);
      if (restoredDependency !== undefined) {
        if (!restoredAttemptExactlyMatches(
          restoredDependency.value.attempt,
          attempt,
        ) ||
          restoredDependency.value.receipt.frame.stepId !== reference.stepId ||
          restoredDependency.value.receipt.sha256 !==
            reference.stepReceiptSha256) {
          return yield* Effect.fail(
            FrameworkMigrationRepositoryError.storedCorruption(operation),
          );
        }
        continue;
      }
      const dependencyRoot = yield* loadReceiptRootByStorageIdWithContext(
        transaction,
        dependencyStorageId,
        operation,
        context,
      );
      if (Option.isNone(dependencyRoot)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const decodedDependency = yield* decodeReceiptRoot(
        dependencyRoot.value,
        operation,
      );
      if (
        decodedDependency.storageId !== dependencyStorageId ||
        decodedDependency.frame.stepId !== reference.stepId ||
        decodedDependency.stepReceiptSha256 !== reference.stepReceiptSha256
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const dependencyPending = yield* preparePendingReceiptRestoration(
        transaction,
        dependencyRoot.value,
        decodedDependency,
        attempt,
        operation,
      );
      if (!registerDecodedReceiptRoot(context, decodedDependency)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      visiting.add(dependencyStorageId);
      stack.push(dependencyPending);
      continue;
    }

    const dependencies: RestoredFrameworkMigrationStepReceipt[] = [];
    for (const dependencyStorageId of pending.dependencyStorageIds) {
      const dependency =
        context.restoredByStorageId.get(dependencyStorageId);
      if (dependency === undefined) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      dependencies.push(dependency.value);
    }
    const restored = yield* restoreStoredFrameworkMigrationStepReceipt({
      row: pending.row,
      dependencyRows: pending.dependencyRows,
      collision: attempt.collision,
      plan: attempt.plan,
      attempt,
      dependencyReceipts: dependencies,
    }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
    const occupant = Object.freeze({
      value: restored,
      dependencyReceipts: Object.freeze(dependencies),
    });
    context.restoredByStorageId.set(pending.decoded.storageId, occupant);
    visiting.delete(pending.decoded.storageId);
    stack.pop();
  }

  const restoredRoot = context.restoredByStorageId.get(rootDecoded.storageId);
  if (restoredRoot === undefined) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return restoredRoot;
});

const preparePendingReceiptRestoration = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.preparePendingRestoration",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationStepReceiptDriverRow,
  decoded: DecodedFrameworkMigrationStepReceiptRoot,
  attempt: RestoredFrameworkMigrationAttemptStart,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  PendingReceiptRestoration,
  FrameworkMigrationRepositoryError
> {
  if (
    decoded.collisionStorageId !== attempt.collision.storageId ||
    decoded.planStorageId !== attempt.plan.storageId ||
    decoded.attemptStorageId !== attempt.storageId ||
    decoded.frame.attemptId !== attempt.attempt.frame.attemptId ||
    decoded.frame.attemptFence !== attempt.attempt.frame.attemptFence
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const dependencyRows = yield* loadReceiptDependencySidecars(
    transaction,
    decoded.storageId,
    decoded.frame,
    operation,
  );
  return {
    row,
    decoded,
    dependencyRows,
    dependencyStorageIds: [],
    seenDependencyStorageIds: new Set<bigint>(),
    nextDependencyIndex: 0,
  };
});

const resolveReceiptOccupantCollision = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.resolveOccupantCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationStepReceiptDriverRow,
  frame: FrameworkMigrationStepReceiptFrame,
  preferred: RestoredFrameworkMigrationCollisionDomain,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (
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

const decodeReceiptRoot = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.decodeRoot",
)(function* (
  row: FrameworkMigrationStepReceiptDriverRow,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkMigrationStepReceiptRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.receiptStorageId,
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
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.stepReceiptSha256,
    {
      format: FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
      version: FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "stepReceipt",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isStoredFrameworkMigrationStepReceiptFrame(frame)) {
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
  const stepSha256 = yield* decodeStoredSha256(row.stepSha256, operation);
  const preconditionSha256 = yield* decodeStoredSha256(
    row.preconditionSha256,
    operation,
  );
  const postconditionSha256 = yield* decodeStoredSha256(
    row.postconditionSha256,
    operation,
  );
  const observedPostconditionSha256 = yield* decodeStoredSha256(
    row.observedPostconditionSha256,
    operation,
  );
  if (
    row.attemptId !== frame.attemptId ||
    attemptFence !== frame.attemptFence ||
    row.stepId !== frame.stepId ||
    stepSha256 !== frame.stepSha256 ||
    preconditionSha256 !== frame.preconditionSha256 ||
    postconditionSha256 !== frame.postconditionSha256 ||
    observedPostconditionSha256 !== frame.observedPostconditionSha256 ||
    row.dependencyCount !== frame.dependencyReceipts.length
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
    stepReceiptSha256: stored.sha256Hex,
    frame,
  });
});

const loadReceiptRootByStorageId = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  receiptStorageId: bigint,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationStepReceiptDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(receiptReadSelection).from(
    fxSystemFrameworkMigrationStepReceipts,
  ).where(eq(
    fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
    receiptStorageId,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

const loadReceiptRootByStorageIdWithContext = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadByStorageIdWithContext",
)(function* (
  transaction: FlarexMetadataTransaction,
  receiptStorageId: bigint,
  operation: StepReceiptRepositoryOperation,
  context: ReceiptRestorationContext,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationStepReceiptDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const cached = context.rootsByStorageId.get(receiptStorageId);
  if (cached !== undefined) return Option.some(cached);
  const loaded = yield* loadReceiptRootByStorageId(
    transaction,
    receiptStorageId,
    operation,
  );
  if (Option.isSome(loaded)) {
    context.rootsByStorageId.set(receiptStorageId, loaded.value);
  }
  return loaded;
});

const loadReceiptDependencySidecars = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadDependencySidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  receiptStorageId: bigint,
  frame: FrameworkMigrationStepReceiptFrame,
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<
  readonly FrameworkMigrationStepReceiptDependencyDriverRow[],
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(receiptDependencyReadSelection).from(
    fxSystemFrameworkMigrationStepReceiptDependencies,
  ).where(eq(
    fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
    receiptStorageId,
  )).orderBy(asc(
    fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal,
  )).limit(frame.dependencyReceipts.length + 1);
  return yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
});

const insertReceiptDependencySidecars = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.insertDependencySidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  receiptStorageId: bigint,
  attemptStorageId: bigint,
  prepared:
    readonly PreparedFrameworkMigrationStepReceiptDependency[],
  restored: readonly RestoredFrameworkMigrationStepReceipt[],
  operation: StepReceiptRepositoryOperation,
): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
  if (prepared.length !== restored.length) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const values: FrameworkMigrationStepReceiptDependencyInsert[] = [];
  for (let dependencyOrdinal = 0;
    dependencyOrdinal < prepared.length;
    dependencyOrdinal += 1) {
    const expected = prepared[dependencyOrdinal];
    const dependency = restored[dependencyOrdinal];
    if (
      expected === undefined ||
      dependency === undefined ||
      dependency.receipt.frame.stepId !== expected.stepId ||
      dependency.receipt.sha256 !== expected.receipt.receipt.sha256
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    values.push({
      receiptStorageId,
      attemptStorageId,
      dependencyOrdinal,
      dependencyReceiptStorageId: dependency.storageId,
      dependencyStepId: expected.stepId,
      dependencyStepReceiptSha256: expected.stepReceiptSha256Bytes,
    });
  }
  for (let offset = 0;
    offset < values.length;
    offset += RECEIPT_DEPENDENCY_INSERT_BATCH_SIZE) {
    const batch = values.slice(
      offset,
      offset + RECEIPT_DEPENDENCY_INSERT_BATCH_SIZE,
    );
    if (batch.length === 0) continue;
    yield* runRepositoryStatement(
      operation,
      transaction.insert(
        fxSystemFrameworkMigrationStepReceiptDependencies,
      ).values(batch),
    );
  }
});

function makeReceiptRestorationContext(): ReceiptRestorationContext {
  return {
    rootsByStorageId: new Map(),
    restoredByStorageId: new Map(),
    storageIdByStepId: new Map(),
    storageIdByDigest: new Map(),
  };
}

function registerDecodedReceiptRoot(
  context: ReceiptRestorationContext,
  decoded: DecodedFrameworkMigrationStepReceiptRoot,
): boolean {
  const stepStorageId = context.storageIdByStepId.get(decoded.frame.stepId);
  const digestStorageId = context.storageIdByDigest.get(
    decoded.stepReceiptSha256,
  );
  if (
    (stepStorageId !== undefined && stepStorageId !== decoded.storageId) ||
    (digestStorageId !== undefined && digestStorageId !== decoded.storageId)
  ) return false;
  context.storageIdByStepId.set(decoded.frame.stepId, decoded.storageId);
  context.storageIdByDigest.set(decoded.stepReceiptSha256, decoded.storageId);
  return true;
}

function runRepositoryStatement<Value>(
  operation: StepReceiptRepositoryOperation,
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
  operation: StepReceiptRepositoryOperation,
): Effect.Effect<string, FrameworkMigrationRepositoryError> {
  return Effect.fromResult(decodeStoredSha256HexResult(
    value,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
}

function mapStoredValueError(
  operation: StepReceiptRepositoryOperation,
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
  operation: StepReceiptRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function stepReceiptExactlyMatches(
  occupant: RestoredFrameworkMigrationStepReceiptOccupant,
  attempt: RestoredFrameworkMigrationAttemptStart,
  dependencies: readonly RestoredFrameworkMigrationStepReceipt[],
  expected: FrameworkMigrationStepReceipt,
): boolean {
  if (
    !restoredAttemptExactlyMatches(occupant.value.attempt, attempt) ||
    occupant.value.receipt.sha256 !== expected.sha256 ||
    occupant.value.receipt.canonicalJson !== expected.canonicalJson ||
    occupant.dependencyReceipts.length !== dependencies.length
  ) return false;
  for (let index = 0; index < dependencies.length; index += 1) {
    const actual = occupant.dependencyReceipts[index];
    const expectedDependency = dependencies[index];
    if (
      actual === undefined ||
      expectedDependency === undefined ||
      !restoredStepReceiptExactlyMatches(actual, expectedDependency)
    ) return false;
  }
  return true;
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

function stepReceiptFrameMatchesAttemptAndStep(
  frame: FrameworkMigrationStepReceiptFrame,
  attempt: RestoredFrameworkMigrationAttemptStart,
  step: RestoredFrameworkMigrationAttemptStart["plan"]["plan"]["frame"]["steps"][number],
): boolean {
  const dependencies = step.dependencies.toSorted((left, right) =>
    compareUtf16Strings(left.stepId, right.stepId)
  );
  return sameCollisionCoordinate(frame.collision, attempt.collision.coordinate) &&
    frame.planSha256 === attempt.plan.plan.migrationPlanSha256 &&
    frame.attemptId === attempt.attempt.frame.attemptId &&
    frame.attemptFence === attempt.attempt.frame.attemptFence &&
    frame.stepId === step.stepId &&
    frame.stepSha256 === step.stepSha256 &&
    frame.preconditionSha256 === step.preconditionSha256 &&
    frame.postconditionSha256 === step.postconditionSha256 &&
    frame.observedPostconditionSha256 === step.postconditionSha256 &&
    frame.dependencyReceipts.length === dependencies.length &&
    frame.dependencyReceipts.every((dependency, index) =>
      dependency.stepId === dependencies[index]?.stepId
    );
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

const receiptCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationStepReceipts.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES}
`;

const receiptReadSelection = {
  receiptStorageId:
    fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
  collisionStorageId:
    fxSystemFrameworkMigrationStepReceipts.collisionStorageId,
  planStorageId: fxSystemFrameworkMigrationStepReceipts.planStorageId,
  attemptStorageId:
    fxSystemFrameworkMigrationStepReceipts.attemptStorageId,
  attemptId: fxSystemFrameworkMigrationStepReceipts.attemptId,
  attemptFence: fxSystemFrameworkMigrationStepReceipts.attemptFence,
  stepId: fxSystemFrameworkMigrationStepReceipts.stepId,
  stepSha256: fxSystemFrameworkMigrationStepReceipts.stepSha256,
  preconditionSha256:
    fxSystemFrameworkMigrationStepReceipts.preconditionSha256,
  postconditionSha256:
    fxSystemFrameworkMigrationStepReceipts.postconditionSha256,
  observedPostconditionSha256:
    fxSystemFrameworkMigrationStepReceipts.observedPostconditionSha256,
  dependencyCount:
    fxSystemFrameworkMigrationStepReceipts.dependencyCount,
  stepReceiptSha256:
    fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256,
  frameFormat: fxSystemFrameworkMigrationStepReceipts.frameFormat,
  frameVersion: fxSystemFrameworkMigrationStepReceipts.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkMigrationStepReceipts.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationStepReceipts.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${receiptCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationStepReceipts.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkMigrationStepReceiptRow,
  unknown
>;

const receiptDependencyReadSelection = {
  receiptStorageId:
    fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
  attemptStorageId:
    fxSystemFrameworkMigrationStepReceiptDependencies.attemptStorageId,
  dependencyOrdinal:
    fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal,
  dependencyReceiptStorageId:
    fxSystemFrameworkMigrationStepReceiptDependencies
      .dependencyReceiptStorageId,
  dependencyStepId:
    fxSystemFrameworkMigrationStepReceiptDependencies.dependencyStepId,
  dependencyStepReceiptSha256:
    fxSystemFrameworkMigrationStepReceiptDependencies
      .dependencyStepReceiptSha256,
} as const satisfies Record<
  keyof StoredFrameworkMigrationStepReceiptDependencyRow,
  unknown
>;

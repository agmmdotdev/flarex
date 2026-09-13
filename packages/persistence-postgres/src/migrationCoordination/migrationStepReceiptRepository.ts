import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "./graphReadPass";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { Brand, Effect, Encoding, Option, Result, Schema } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { captureMigrationCanonicalValue } from
  "./planVerificationScope";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturedAuthorityForStepReceipt, capturedStepForPlan } from "./authority";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
  encodeFrameworkMigrationStepReceiptFrame,
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
  type FrameworkMigrationStep,
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
  isRestoredFrameworkMigrationAttemptAncestor,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationStepReceipt,
  isRestoredFreshRelationalMigrationPlan,
  restoreStoredFrameworkMigrationStepReceipt,
  frameworkMigrationReceiptDependencyRowMatches,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationStepReceipt,
  type RestoredFreshRelationalMigrationPlan,
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

type StepReceiptAggregateRepositoryOperation =
  FrameworkMigrationRepositoryOperation;

const RECEIPT_DEPENDENCY_INSERT_BATCH_SIZE = 256;

const decodeReceiptInventory = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({
  receiptStorageId: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)),
})));

/** Full-audit root inventory, including receipts outside the selected attempt's
 * fence. Prefix restoration alone deliberately does not adopt those rows. */
export const verifyFrameworkMigrationReceiptInventoryInTransactionEffect = Effect.fn("FrameworkMigrationStepReceiptRepository.verifyInventory")(
  function* (transaction: FlarexMetadataTransaction, plan: RestoredFreshRelationalMigrationPlan,
    receipts: readonly RestoredFrameworkMigrationStepReceipt[],
  ): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
    const operation = "readStepReceipt";
    if (!isRestoredFreshRelationalMigrationPlan(plan) || receipts.some(receipt =>
      !isRestoredFrameworkMigrationStepReceipt(receipt) || receipt.attempt.plan.storageId !== plan.storageId)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    const rows = yield* runRepositoryStatement(operation, transaction.select({
      receiptStorageId: fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
    }).from(fxSystemFrameworkMigrationStepReceipts).where(eq(
      fxSystemFrameworkMigrationStepReceipts.planStorageId, plan.storageId,
    )).limit(plan.plan.frame.steps.length + 1));
    const decoded = yield* decodeReceiptInventory(rows).pipe(Effect.mapError(() =>
      FrameworkMigrationRepositoryError.storedCorruption(operation)));
    const expected = new Set(receipts.map(receipt => receipt.storageId));
    if (expected.size !== receipts.length || decoded.length !== expected.size || decoded.some(row => !expected.delete(row.receiptStorageId)) || expected.size !== 0) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
  },
);

const completionStorageId = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9_223_372_036_854_775_807n }));
const completionProjectionSchema = Schema.Struct({
  receiptStorageId: completionStorageId,
  collisionStorageId: completionStorageId,
  planStorageId: completionStorageId,
  attemptStorageId: completionStorageId,
  attemptId: Schema.String,
  attemptFence: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 9_223_372_036_854_775_807n })),
  stepId: Schema.String,
  stepSha256: Schema.Uint8Array,
  preconditionSha256: Schema.Uint8Array,
  postconditionSha256: Schema.Uint8Array,
  observedPostconditionSha256: Schema.Uint8Array,
  stepReceiptSha256: Schema.Uint8Array,
});
const decodeCompletionProjection = Schema.decodeUnknownEffect(completionProjectionSchema);
const completionReceiptSha256 = Brand.nominal<FrameworkMigrationStepReceiptSha256>();

/** Selected normalized completion evidence for a protected command. This is not
 * a fully restored receipt graph and cannot issue readiness or full audit proof. */
export interface FrameworkMigrationCommittedCompletion {
  readonly storageId: bigint;
  readonly step: FrameworkMigrationStep;
  readonly sha256: FrameworkMigrationStepReceiptSha256;
  readonly producer: RestoredFrameworkMigrationAttemptStart;
}

/** Called only by the target-owned command after locking and authenticating its
 * head. Stable sealed completions need their exact direct references here;
 * historical canonical payloads and transitive sidecars belong to the full audit.
 * The supplied lineage contains actual predecessor edges authenticated at claim
 * opening, never an inference from increasing fence numbers. */
export const readFrameworkMigrationDirectCompletionsInTransactionEffect = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.readDirectCompletions",
)(function* (transaction: FlarexMetadataTransaction, attempt: RestoredFrameworkMigrationAttemptStart,
  step: FrameworkMigrationStep, completedStepCount: number,
  lineage: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>,
): Effect.fn.Return<readonly FrameworkMigrationCommittedCompletion[], FrameworkMigrationRepositoryError> {
  const operation = "readStepReceipt" as const;
  if (!isRestoredFrameworkMigrationAttemptStart(attempt) ||
    capturedStepForPlan(attempt.plan.plan, step.stepId) !== step || step.ordinal !== completedStepCount ||
    lineage.get(attempt.storageId) !== attempt) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
  }
  const dependencies = step.dependencies.toSorted((left, right) => compareUtf16Strings(left.stepId, right.stepId));
  const restored: FrameworkMigrationCommittedCompletion[] = [];
  for (let offset = 0; offset < dependencies.length; offset += 256) {
    const batch = dependencies.slice(offset, offset + 256);
    const rows = yield* runRepositoryStatement(operation, transaction.select(completionReadSelection)
      .from(fxSystemFrameworkMigrationStepReceipts).where(and(
        eq(fxSystemFrameworkMigrationStepReceipts.planStorageId, attempt.plan.storageId),
        inArray(fxSystemFrameworkMigrationStepReceipts.stepId, batch.map(reference => reference.stepId)),
      )).limit(batch.length + 1)).pipe(Effect.map(detachDriverRows));
    if (rows.length !== batch.length) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    const selected = new Map<string, FrameworkMigrationCommittedCompletion>();
    for (const row of rows) {
      const actual = yield* decodeCommittedCompletion(row, attempt, completedStepCount, lineage, operation);
      if (selected.has(actual.step.stepId)) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      selected.set(actual.step.stepId, actual);
    }
    for (const reference of batch) {
      const completion = selected.get(reference.stepId);
      if (completion === undefined || completion.step.stepSha256 !== reference.stepSha256) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      restored.push(completion);
    }
  }
  return Object.freeze(restored);
});

const completionReadSelection = {
  receiptStorageId: fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
  collisionStorageId: fxSystemFrameworkMigrationStepReceipts.collisionStorageId,
  planStorageId: fxSystemFrameworkMigrationStepReceipts.planStorageId,
  attemptStorageId: fxSystemFrameworkMigrationStepReceipts.attemptStorageId,
  attemptId: fxSystemFrameworkMigrationStepReceipts.attemptId,
  attemptFence: fxSystemFrameworkMigrationStepReceipts.attemptFence,
  stepId: fxSystemFrameworkMigrationStepReceipts.stepId,
  stepSha256: fxSystemFrameworkMigrationStepReceipts.stepSha256,
  preconditionSha256: fxSystemFrameworkMigrationStepReceipts.preconditionSha256,
  postconditionSha256: fxSystemFrameworkMigrationStepReceipts.postconditionSha256,
  observedPostconditionSha256: fxSystemFrameworkMigrationStepReceipts.observedPostconditionSha256,
  stepReceiptSha256: fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256,
};

const decodeCommittedCompletion = Effect.fn("FrameworkMigrationStepReceiptRepository.decodeCompletion")(
  function* (row: unknown, attempt: RestoredFrameworkMigrationAttemptStart, completedStepCount: number,
    lineage: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>, operation: StepReceiptAggregateRepositoryOperation): Effect.fn.Return<
      FrameworkMigrationCommittedCompletion, FrameworkMigrationRepositoryError
    > {
    const actual = yield* decodeCompletionProjection(row).pipe(Effect.mapError(() => FrameworkMigrationRepositoryError.storedCorruption(operation)));
    const dependency = capturedStepForPlan(attempt.plan.plan, actual.stepId);
    const producer = lineage.get(actual.attemptStorageId);
    if (dependency === undefined || dependency.ordinal >= completedStepCount || producer === undefined ||
      !isRestoredFrameworkMigrationAttemptStart(producer) || producer.plan.storageId !== attempt.plan.storageId ||
      producer.admission.storageId !== attempt.admission.storageId || producer.collision.storageId !== attempt.collision.storageId ||
      !isRestoredFrameworkMigrationAttemptAncestor(producer, attempt) || producer.attempt.frame.attemptId !== actual.attemptId ||
      producer.attempt.frame.attemptFence !== String(actual.attemptFence) || actual.collisionStorageId !== attempt.collision.storageId ||
      actual.planStorageId !== attempt.plan.storageId ||
      (yield* decodeStoredSha256(actual.stepSha256, operation)) !== dependency.stepSha256 ||
      (yield* decodeStoredSha256(actual.preconditionSha256, operation)) !== dependency.preconditionSha256 ||
      (yield* decodeStoredSha256(actual.postconditionSha256, operation)) !== dependency.postconditionSha256 ||
      (yield* decodeStoredSha256(actual.observedPostconditionSha256, operation)) !== dependency.postconditionSha256) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    return Object.freeze({ storageId: actual.receiptStorageId, step: dependency, producer,
      sha256: completionReceiptSha256(yield* decodeStoredSha256(actual.stepReceiptSha256, operation)) });
  },
);

export const readFrameworkMigrationCompletionTailInTransactionEffect = Effect.fn("FrameworkMigrationStepReceiptRepository.readCompletionTail")(
  function* (transaction: FlarexMetadataTransaction, attempt: RestoredFrameworkMigrationAttemptStart, completedStepCount: number,
    tail: Readonly<{ storageId: bigint; sha256: FrameworkMigrationStepReceiptSha256 }> | null,
    lineage: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>): Effect.fn.Return<FrameworkMigrationCommittedCompletion | null, FrameworkMigrationRepositoryError> {
    const operation = "readStepReceipt" as const;
    if (!isRestoredFrameworkMigrationAttemptStart(attempt) || lineage.get(attempt.storageId) !== attempt ||
      !Number.isSafeInteger(completedStepCount) || completedStepCount < 0 || completedStepCount > attempt.plan.plan.frame.steps.length ||
      (completedStepCount === 0) !== (tail === null)) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    if (tail === null) return null;
    const rows = yield* runRepositoryStatement(operation, transaction.select(completionReadSelection).from(fxSystemFrameworkMigrationStepReceipts)
      .where(eq(fxSystemFrameworkMigrationStepReceipts.receiptStorageId, tail.storageId)).limit(2)).pipe(Effect.map(detachDriverRows));
    const row = rows[0];
    if (rows.length !== 1 || row === undefined) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    const completion = yield* decodeCommittedCompletion(row, attempt, completedStepCount, lineage, operation);
    if (completion.storageId !== tail.storageId || completion.sha256 !== tail.sha256 || completion.step.ordinal !== completedStepCount - 1) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    return completion;
  },
);

interface PreparedFrameworkMigrationStepReceiptDependency {
  readonly receipt: RestoredFrameworkMigrationStepReceipt;
  readonly stepId: string;
  readonly stepReceiptSha256Bytes: Uint8Array;
}

interface PreparedFrameworkMigrationStepReceipt {
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly receipt: FrameworkMigrationStepReceipt;
  readonly stepReceiptSha256Bytes: Uint8Array;
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
  readonly planStorageId: bigint;
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
  readonly canonicalJson: string;
  readonly frame: FrameworkMigrationStepReceiptFrame;
}

const insertReceiptRoot = Effect.fn("FrameworkMigrationStepReceiptRepository.insertRoot")(
  function* (transaction: FlarexMetadataTransaction, attempt: RestoredFrameworkMigrationAttemptStart,
    receipt: FrameworkMigrationStepReceipt, operation: StepReceiptRepositoryOperation): Effect.fn.Return<Option.Option<bigint>, FrameworkMigrationRepositoryError> {
    const frame = receipt.frame;
    const canonicalBytes = new TextEncoder().encode(receipt.canonicalJson);
    const rows = yield* runRepositoryStatement(operation, transaction.insert(fxSystemFrameworkMigrationStepReceipts).values({
      collisionStorageId: attempt.collision.storageId, planStorageId: attempt.plan.storageId, attemptStorageId: attempt.storageId,
      attemptId: frame.attemptId, attemptFence: BigInt(frame.attemptFence), stepId: frame.stepId,
      stepSha256: yield* decodeAuthenticatedSha256(frame.stepSha256),
      preconditionSha256: yield* decodeAuthenticatedSha256(frame.preconditionSha256),
      postconditionSha256: yield* decodeAuthenticatedSha256(frame.postconditionSha256),
      observedPostconditionSha256: yield* decodeAuthenticatedSha256(frame.observedPostconditionSha256),
      dependencyCount: frame.dependencyReceipts.length, stepReceiptSha256: yield* decodeAuthenticatedSha256(receipt.sha256),
      frameFormat: frame.format, frameVersion: frame.version, canonicalByteLength: canonicalBytes.byteLength, canonicalBytes,
    }).onConflictDoNothing().returning({ receiptStorageId: fxSystemFrameworkMigrationStepReceipts.receiptStorageId })).pipe(Effect.map(detachDriverRows));
    if (rows.length > 1) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    const row = rows[0];
    return row === undefined ? Option.none() : Option.some(yield* Effect.fromResult(decodeStoredStorageIdResult(row.receiptStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation))));
  },
);

export const ensureFrameworkMigrationCommittedCompletionInTransactionEffect = Effect.fn("FrameworkMigrationStepReceiptRepository.ensureCompletion")(
  function* (transaction: FlarexMetadataTransaction, attempt: RestoredFrameworkMigrationAttemptStart,
    step: FrameworkMigrationStep, dependencies: readonly FrameworkMigrationCommittedCompletion[],
    expected: FrameworkMigrationStepReceipt): Effect.fn.Return<FrameworkMigrationCommittedCompletion, FrameworkMigrationRepositoryError> {
    const operation = "ensureStepReceipt" as const;
    const receipt = yield* encodeFrameworkMigrationStepReceiptFrame(expected.frame).pipe(Effect.mapError(error =>
      error.reason === "resourceFailure" ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause) :
        FrameworkMigrationRepositoryError.referenceRefusal(operation)));
    const frame = receipt.frame;
    const planned = step.dependencies.toSorted((left, right) => compareUtf16Strings(left.stepId, right.stepId));
    if (!isRestoredFrameworkMigrationAttemptStart(attempt) || capturedStepForPlan(attempt.plan.plan, step.stepId) !== step ||
      receipt.sha256 !== expected.sha256 || receipt.canonicalJson !== expected.canonicalJson ||
      !stepReceiptFrameMatchesAttemptAndStep(frame, attempt, step) || dependencies.length !== planned.length) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    for (const [index, dependency] of dependencies.entries()) {
      const reference = frame.dependencyReceipts[index];
      if (dependency.step.stepId !== planned[index]?.stepId || dependency.step.stepSha256 !== planned[index]?.stepSha256 ||
        reference?.stepId !== dependency.step.stepId || reference.stepReceiptSha256 !== dependency.sha256 ||
        !isRestoredFrameworkMigrationAttemptAncestor(dependency.producer, attempt)) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
      }
    }
    const inserted = yield* insertReceiptRoot(transaction, attempt, receipt, operation);
    if (Option.isSome(inserted)) {
      const values: FrameworkMigrationStepReceiptDependencyInsert[] = [];
      for (const [dependencyOrdinal, dependency] of dependencies.entries()) values.push({
        receiptStorageId: inserted.value, planStorageId: attempt.plan.storageId, dependencyOrdinal,
        dependencyReceiptStorageId: dependency.storageId, dependencyStepId: dependency.step.stepId,
        dependencyStepReceiptSha256: yield* decodeAuthenticatedSha256(dependency.sha256),
      });
      yield* insertReceiptDependencyRows(transaction, values, operation);
    }
    const rows = yield* runRepositoryStatement(operation, transaction.select(receiptReadSelection).from(fxSystemFrameworkMigrationStepReceipts)
      .where(or(and(eq(fxSystemFrameworkMigrationStepReceipts.planStorageId, attempt.plan.storageId),
        eq(fxSystemFrameworkMigrationStepReceipts.stepId, step.stepId)),
        eq(fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256, yield* decodeAuthenticatedSha256(receipt.sha256)))).limit(3))
      .pipe(Effect.map(detachDriverRows));
    const row = rows[0];
    if (rows.length !== 1 || row === undefined) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    const actual = yield* decodeReceiptRoot(row, operation);
    if (actual.collisionStorageId !== attempt.collision.storageId || actual.planStorageId !== attempt.plan.storageId ||
      actual.attemptStorageId !== attempt.storageId || actual.stepReceiptSha256 !== receipt.sha256 || actual.canonicalJson !== receipt.canonicalJson ||
      (Option.isSome(inserted) && inserted.value !== actual.storageId)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    const children = yield* readReceiptDependencyRows(transaction, actual.storageId, dependencies.length, operation);
    if (children.length !== dependencies.length) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    for (const [index, dependency] of dependencies.entries()) {
      const child = children[index];
      const reference = frame.dependencyReceipts[index];
      if (child === undefined || reference === undefined || !(yield* frameworkMigrationReceiptDependencyRowMatches(child,
        actual.storageId, attempt.plan.storageId, index, dependency.storageId, reference)
        .pipe(Effect.mapError(error => mapStoredValueError(operation, error))))) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
    }
    return Object.freeze({ storageId: actual.storageId, sha256: receipt.sha256, step, producer: attempt });
  },
);

interface RestoredFrameworkMigrationStepReceiptOccupant {
  readonly value: RestoredFrameworkMigrationStepReceipt;
  readonly dependencyReceipts:
    readonly RestoredFrameworkMigrationStepReceipt[];
}

interface FrameworkMigrationStepReceiptOccupantLookups {
  readonly readByPlanStep: () => Effect.Effect<
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
  readonly sidecarsByPlan: Map<bigint, PlanReceiptSidecars>;
  readonly attemptsByStorageId: Map<bigint, RestoredFrameworkMigrationAttemptStart>;
  readonly eventAttempts: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart> | undefined;
}

/** Working storage owned by one read-only event assembly, not restored authority.
 * Plan-local indexes cannot mix repeated step identifiers from different plans. */
export interface FrameworkMigrationReceiptReadGraph {
  readonly transaction: FlarexMetadataTransaction;
  readonly contextsByPlan: Map<bigint, ReceiptRestorationContext>;
}

export function makeFrameworkMigrationReceiptReadGraph(
  transaction: FlarexMetadataTransaction,
): FrameworkMigrationReceiptReadGraph {
  return Object.freeze({ transaction, contextsByPlan: new Map() });
}

function receiptReadContext(
  transaction: FlarexMetadataTransaction,
  graph: FrameworkMigrationReceiptReadGraph | undefined,
  planStorageId: bigint,
  attempts: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart> | undefined,
  operation: StepReceiptAggregateRepositoryOperation,
): Result.Result<ReceiptRestorationContext, FrameworkMigrationRepositoryError> {
  if (graph === undefined) return Result.succeed(makeReceiptRestorationContext(attempts));
  if (graph.transaction !== transaction) return Result.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
  let context = graph.contextsByPlan.get(planStorageId);
  if (context === undefined) {
    context = makeReceiptRestorationContext(attempts);
    graph.contextsByPlan.set(planStorageId, context);
  }
  return Result.succeed(context);
}

interface PendingReceiptRestoration {
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
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
  readonly planStorageId: bigint;
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

  const inserted = yield* insertReceiptRoot(transaction, storedAttempt, prepared.receipt, operation);
  if (Option.isSome(inserted)) {
    const receiptStorageId = inserted.value;
    yield* insertReceiptDependencySidecars(
      transaction,
      receiptStorageId,
      storedAttempt.plan.storageId,
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
    const byPlanStep = yield* lookups.readByPlanStep();
    if (Option.isSome(byPlanStep)) {
      if (stepReceiptExactlyMatches(
        byPlanStep.value,
        attempt,
        dependencyReceipts,
        expected,
      )) return Option.some(byPlanStep.value.value);
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
    operation: StepReceiptAggregateRepositoryOperation,
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
  }, withFrameworkGraphReadPass);

/** Source-private restoration of a committed receipt digest reference. */
const readReceiptDigestReference = makeFrameworkGraphReferenceRead<RestoredFrameworkMigrationStepReceipt>();
/** Read-only event aggregates may restore their known receipt subjects together.
 * Queries still cover the global digest namespace, so duplicate/missing roots
 * cannot be hidden by a collision filter. Only fully restored successes enter
 * the optional pass memo. Explicit working rows survive through the enclosing
 * read-only event assembly's terminal phase, never into a writer or later read. */
export const restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.restoreEventSubjects",
)(function* (transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  digests: readonly FrameworkMigrationStepReceiptSha256[],
  operation: StepReceiptAggregateRepositoryOperation,
  attempts?: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>,
  graph?: FrameworkMigrationReceiptReadGraph): Effect.fn.Return<
    ReadonlyMap<FrameworkMigrationStepReceiptSha256, RestoredFrameworkMigrationStepReceipt>, FrameworkMigrationRepositoryError
  > {
  if (!isRestoredFrameworkMigrationCollisionDomain(collision) || (graph !== undefined && graph.transaction !== transaction)) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  }
  const restored = new Map<FrameworkMigrationStepReceiptSha256, RestoredFrameworkMigrationStepReceipt>();
  const pending: FrameworkMigrationStepReceiptSha256[] = [];
  for (const digest of new Set(digests)) {
    const prior = attempts === undefined ? yield* readReceiptDigestReference.peek(transaction, collision, digest) : Option.none();
    if (Option.isSome(prior)) restored.set(digest, prior.value);
    else pending.push(digest);
  }
  // Independent subject reads keep one plan at a time. The connected event
  // assembly retains plan-local graphs through its later terminal phase.
  let working: Readonly<{ planStorageId: bigint; context: ReceiptRestorationContext }> | undefined;
  for (let offset = 0; offset < pending.length; offset += 32) {
    const batch = pending.slice(offset, offset + 32);
    const digestBytes: Uint8Array[] = [];
    for (const digest of batch) {
      digestBytes.push(yield* Effect.fromResult(Encoding.decodeHex(digest)).pipe(
        Effect.mapError(() => FrameworkMigrationRepositoryError.storedCorruption(operation))));
    }
    const rows = yield* runRepositoryStatement(operation,
      transaction.select(receiptReadSelection).from(fxSystemFrameworkMigrationStepReceipts)
        .where(inArray(fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256, digestBytes))
        .limit(batch.length + 1),
    ).pipe(Effect.map(detachDriverRows));
    if (rows.length !== batch.length) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    const byDigest = new Map<string, FrameworkMigrationStepReceiptDriverRow>();
    for (const row of rows) {
      const digest = yield* decodeStoredSha256(row.stepReceiptSha256, operation);
      if (byDigest.has(digest)) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      byDigest.set(digest, row);
    }
    for (const digest of batch) {
      const row = byDigest.get(digest);
      if (row === undefined) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      const decoded = yield* decodeReceiptRoot(row, operation);
      if (working?.planStorageId !== decoded.planStorageId) {
        working = { planStorageId: decoded.planStorageId,
          context: yield* Effect.fromResult(receiptReadContext(transaction, graph, decoded.planStorageId, attempts, operation)) };
      }
      const occupant = yield* restoreReceiptDependencyClosure(transaction, row, collision, operation, undefined, working.context);
      if (occupant.value.receipt.sha256 !== digest) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
      restored.set(digest, occupant.value);
      yield* readReceiptDigestReference(Effect.succeed(occupant.value), transaction, collision, digest);
    }
  }
  return restored;
}, withFrameworkGraphReadPass);

/**
 * Source-private restoration of the exact ordinal receipt prefix referenced by
 * an attempt-terminal row. The nullable tail pair is the prefix anchor; no
 * receipt outside that prefix is accepted or healed.
 */
export const restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationStepReceiptRepository.restoreAttemptTerminalPrefix",
  )(function* (
    transaction: FlarexMetadataTransaction,
    attempt: RestoredFrameworkMigrationAttemptStart,
    lastReceiptStorageId: unknown,
    lastStepReceiptSha256: unknown,
    operation: StepReceiptAggregateRepositoryOperation,
    eventAttempts?: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>,
    graph?: FrameworkMigrationReceiptReadGraph,
  ): Effect.fn.Return<
    readonly RestoredFrameworkMigrationStepReceipt[],
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFrameworkMigrationAttemptStart(attempt)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const hasLastReceiptStorageId = lastReceiptStorageId !== null;
    const hasLastStepReceiptSha256 = lastStepReceiptSha256 !== null;
    if (hasLastReceiptStorageId !== hasLastStepReceiptSha256) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const expectedLastStorageId = lastReceiptStorageId === null
      ? null
      : yield* Effect.fromResult(decodeStoredStorageIdResult(
        lastReceiptStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ));
    const expectedLastSha256 = lastStepReceiptSha256 === null
      ? null
      : yield* decodeStoredSha256(lastStepReceiptSha256, operation);
    return yield* restoreCompleteStoredAttemptReceiptPrefix(
      transaction,
      attempt,
      expectedLastStorageId === null || expectedLastSha256 === null
        ? null
        : Object.freeze({
          storageId: expectedLastStorageId,
          sha256: expectedLastSha256,
        }),
      operation,
      eventAttempts,
      graph,
    );
  });

/**
 * Source-private coordinator read of the complete committed ordinal prefix for
 * an authenticated attempt.
 */
export const readFrameworkMigrationStepReceiptPrefixInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationStepReceiptRepository.readAttemptPrefix",
  )(function* (
    transaction: FlarexMetadataTransaction,
    attempt: RestoredFrameworkMigrationAttemptStart,
  ): Effect.fn.Return<
    readonly RestoredFrameworkMigrationStepReceipt[],
    FrameworkMigrationRepositoryError
  > {
    const operation = "readStepReceipt" as const;
    yield*
      corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
        transaction,
        attempt,
        operation,
      );
    // Corroboration proves the complete stored value. Preserve the caller's
    // exact issued attempt identity when reissuing its dependency receipts.
    return yield* restoreCompleteStoredAttemptReceiptPrefix(
      transaction,
      attempt,
      undefined,
      operation,
    );
  });

/**
 * Source-private caller-prefix corroboration for attempt-terminal writes. The
 * attempt must already have been corroborated in the caller transaction.
 */
export const corroborateRestoredFrameworkMigrationStepReceiptPrefixInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationStepReceiptRepository.corroborateAttemptPrefix",
  )(function* (
    transaction: FlarexMetadataTransaction,
    attempt: RestoredFrameworkMigrationAttemptStart,
    expected: readonly RestoredFrameworkMigrationStepReceipt[],
    operation: StepReceiptAggregateRepositoryOperation,
  ): Effect.fn.Return<
    readonly RestoredFrameworkMigrationStepReceipt[],
    FrameworkMigrationRepositoryError
  > {
    if (
      !isRestoredFrameworkMigrationAttemptStart(attempt) ||
      !Array.isArray(expected) ||
      expected.length > attempt.plan.plan.frame.steps.length
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    for (let ordinal = 0; ordinal < expected.length; ordinal += 1) {
      const receipt = expected[ordinal];
      if (
        receipt === undefined ||
        !isRestoredFrameworkMigrationStepReceipt(receipt) ||
        !isRestoredFrameworkMigrationAttemptAncestor(receipt.attempt, attempt) ||
        receipt.receipt.frame.stepId !==
          attempt.plan.plan.frame.steps[ordinal]?.stepId
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
    }

    const stored = yield* restoreCompleteStoredAttemptReceiptPrefix(
      transaction,
      attempt,
      undefined,
      operation,
    );
    if (stored.length !== expected.length) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    for (let ordinal = 0; ordinal < stored.length; ordinal += 1) {
      const actual = stored[ordinal];
      const expectedReceipt = expected[ordinal];
      if (
        actual === undefined ||
        expectedReceipt === undefined ||
        !restoredStepReceiptExactlyMatches(actual, expectedReceipt)
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
    }
    return stored;
  });

interface AttemptReceiptPrefixTail {
  readonly storageId: bigint;
  readonly sha256: string;
}

const readCompleteReceiptPrefix = makeFrameworkGraphReferenceRead<
  readonly RestoredFrameworkMigrationStepReceipt[]
>();

const restoreCompleteStoredAttemptReceiptPrefix = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.restoreCompleteAttemptPrefix",
)(function* (
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  tail: AttemptReceiptPrefixTail | null | undefined,
  operation: StepReceiptAggregateRepositoryOperation,
  eventAttempts?: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>,
  graph?: FrameworkMigrationReceiptReadGraph,
): Effect.fn.Return<
  readonly RestoredFrameworkMigrationStepReceipt[],
  FrameworkMigrationRepositoryError
> {
  const planSteps = attempt.plan.plan.frame.steps;
  const planRows = yield* runRepositoryStatement(
    operation,
    transaction.select(receiptReadSelection).from(
      fxSystemFrameworkMigrationStepReceipts,
    ).where(eq(
      fxSystemFrameworkMigrationStepReceipts.planStorageId,
      attempt.plan.storageId,
    )).limit(planSteps.length + 1),
  ).pipe(Effect.map(detachDriverRows));
  if (planRows.length > planSteps.length) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }


  const ordinalByStepId = new Map<string, number>();
  for (let ordinal = 0; ordinal < planSteps.length; ordinal += 1) {
    const step = planSteps[ordinal];
    if (step === undefined || ordinalByStepId.has(step.stepId)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    ordinalByStepId.set(step.stepId, ordinal);
  }

  const context = yield* Effect.fromResult(receiptReadContext(transaction, graph, attempt.plan.storageId, eventAttempts, operation));
  const rowsByOrdinal = new Map<
    number,
    FrameworkMigrationStepReceiptDriverRow
  >();
  const rows: FrameworkMigrationStepReceiptDriverRow[] = [];
  for (const row of planRows) {
    const decoded = yield* decodeReceiptRoot(row, operation);
    if (
      decoded.collisionStorageId !== attempt.collision.storageId ||
      decoded.planStorageId !== attempt.plan.storageId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    if (BigInt(decoded.frame.attemptFence) > BigInt(attempt.attempt.frame.attemptFence)) continue;
    rows.push(row);
    const ordinal = ordinalByStepId.get(decoded.frame.stepId);
    if (
      ordinal === undefined ||
      rowsByOrdinal.has(ordinal) ||
      !registerDecodedReceiptRoot(context, decoded)
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    rowsByOrdinal.set(ordinal, row);
    context.rootsByStorageId.set(decoded.storageId, row);
  }
  if (tail === null && rows.length !== 0) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  }
  if (tail !== undefined && tail !== null) {
    const tailRow = rowsByOrdinal.get(rows.length - 1);
    if (tailRow === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const decodedTail = yield* decodeReceiptRoot(tailRow, operation);
    if (
      decodedTail.storageId !== tail.storageId ||
      decodedTail.stepReceiptSha256 !== tail.sha256
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }
  const restored: RestoredFrameworkMigrationStepReceipt[] = [];
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    const row = rowsByOrdinal.get(ordinal);
    if (row === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const occupant = yield* restoreReceiptDependencyClosure(
      transaction,
      row,
      attempt.collision,
      operation,
      attempt,
      context,
    );
    if (!isRestoredFrameworkMigrationAttemptAncestor(occupant.value.attempt, attempt) ||
      occupant.value.receipt.frame.stepId !== planSteps[ordinal]?.stepId) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    restored.push(occupant.value);
  }
  return Object.freeze(restored);
}, withFrameworkGraphReadPass, (read, transaction, attempt, tail, operation,
  eventAttempts?: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>, graph?: FrameworkMigrationReceiptReadGraph) =>
  eventAttempts === undefined && graph === undefined ? readCompleteReceiptPrefix(read, transaction, attempt, tail === null,
    tail?.storageId, tail?.sha256) : read);

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
      !isRestoredFrameworkMigrationAttemptAncestor(dependency.attempt, attempt) ||
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

  const captured = yield* captureMigrationCanonicalValue(
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
    stepReceiptSha256Bytes: captured.copySha256Bytes(),
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
        readByPlanStep: () => loadReceiptOccupantByPlanStep(
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

const loadReceiptOccupantByPlanStep = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadByPlanStep",
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
      fxSystemFrameworkMigrationStepReceipts.planStorageId,
      preferredAttempt.plan.storageId,
    ),
    eq(fxSystemFrameworkMigrationStepReceipts.stepId, stepId),
  )).limit(2);
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
  )).limit(2);
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
  if (rows.length > 1) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  }
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

// Each fully verified node can be reached through several event subjects and
// terminal prefixes in the same read-only pass. Retain successes under the
// exact issued attempt, storage ID and digest; local traversal/cycle state is
// never shared or retained after failure.
const readVerifiedReceiptNode = makeFrameworkGraphReferenceRead<
  RestoredFrameworkMigrationStepReceiptOccupant
>();

const restoreReceiptDependencyClosure = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.restoreDependencyClosure",
)(function* (
  transaction: FlarexMetadataTransaction,
  root: FrameworkMigrationStepReceiptDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: StepReceiptAggregateRepositoryOperation,
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
    : context.attemptsByStorageId.get(rootDecoded.attemptStorageId) ?? context.eventAttempts?.get(rootDecoded.attemptStorageId) ?? (yield*
      restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(
        transaction,
        actualCollision,
        rootDecoded.attemptStorageId,
        rootDecoded.frame.attemptId,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      )));
  if (
    attempt.storageId !== rootDecoded.attemptStorageId ||
    attempt.collision.storageId !== rootDecoded.collisionStorageId ||
    attempt.plan.storageId !== rootDecoded.planStorageId ||
    attempt.attempt.frame.attemptId !== rootDecoded.frame.attemptId ||
    attempt.attempt.frame.attemptFence !== rootDecoded.frame.attemptFence
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  // Producer evidence belongs to this read-only working graph. Retaining it
  // here avoids re-authenticating its definition for each receipt when the
  // optional pass memo is full; every receipt still checks its exact reference.
  context.attemptsByStorageId.set(attempt.storageId, attempt);
  if (!registerDecodedReceiptRoot(context, rootDecoded)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }

  const sharedRoot = yield* readVerifiedReceiptNode.peek(transaction, attempt,
    rootDecoded.storageId, rootDecoded.stepReceiptSha256);
  const cachedRoot = context.restoredByStorageId.get(rootDecoded.storageId) ?? Option.getOrUndefined(sharedRoot);
  if (cachedRoot !== undefined) {
    if (!restoredAttemptExactlyMatches(cachedRoot.value.attempt, attempt) ||
      cachedRoot.value.receipt.sha256 !== rootDecoded.stepReceiptSha256 ||
      cachedRoot.value.receipt.canonicalJson !== rootDecoded.canonicalJson) {
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
    context,
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
        dependencyRow.planStorageId !== pending.attempt.plan.storageId ||
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
      const sharedDependency = yield* readVerifiedReceiptNode.peek(transaction, attempt,
        dependencyStorageId, reference.stepReceiptSha256);
      const restoredDependency = context.restoredByStorageId.get(dependencyStorageId) ?? Option.getOrUndefined(sharedDependency);
      if (restoredDependency !== undefined) {
        if (!isRestoredFrameworkMigrationAttemptAncestor(
          restoredDependency.value.attempt,
          pending.attempt,
        ) ||
          restoredDependency.value.receipt.frame.stepId !== reference.stepId ||
          restoredDependency.value.receipt.sha256 !==
            reference.stepReceiptSha256) {
          return yield* Effect.fail(
            FrameworkMigrationRepositoryError.storedCorruption(operation),
          );
        }
        context.restoredByStorageId.set(dependencyStorageId, restoredDependency);
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
        context,
      );
      if (!isRestoredFrameworkMigrationAttemptAncestor(dependencyPending.attempt, pending.attempt) ||
        !registerDecodedReceiptRoot(context, decodedDependency)) {
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
      collision: pending.attempt.collision,
      plan: pending.attempt.plan,
      attempt: pending.attempt,
      dependencyReceipts: dependencies,
    }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
    const occupant = Object.freeze({
      value: restored,
      dependencyReceipts: Object.freeze(dependencies),
    });
    yield* readVerifiedReceiptNode(Effect.succeed(occupant), transaction, pending.attempt,
      pending.decoded.storageId, restored.receipt.sha256);
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
}, withFrameworkGraphReadPass);

const preparePendingReceiptRestoration = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.preparePendingRestoration",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationStepReceiptDriverRow,
  decoded: DecodedFrameworkMigrationStepReceiptRoot,
  preferredAttempt: RestoredFrameworkMigrationAttemptStart,
  operation: StepReceiptAggregateRepositoryOperation,
  context: ReceiptRestorationContext,
): Effect.fn.Return<
  PendingReceiptRestoration,
  FrameworkMigrationRepositoryError
> {
  const attempt = decoded.attemptStorageId === preferredAttempt.storageId
    ? preferredAttempt
    : context.attemptsByStorageId.get(decoded.attemptStorageId) ?? context.eventAttempts?.get(decoded.attemptStorageId) ?? (yield* restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(
      transaction, preferredAttempt.collision, decoded.attemptStorageId,
      decoded.frame.attemptId, operation,
    ));
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
  context.attemptsByStorageId.set(attempt.storageId, attempt);
  const dependencyRows = yield* loadReceiptDependencySidecars(
    transaction,
    decoded.storageId,
    decoded.frame,
    operation,
    attempt.plan.storageId,
    context,
  );
  return {
    attempt,
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
  operation: StepReceiptAggregateRepositoryOperation,
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
  operation: StepReceiptAggregateRepositoryOperation,
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
    canonicalJson: stored.canonicalJson,
    frame,
  });
});

const loadReceiptRootByStorageId = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  receiptStorageId: bigint,
  operation: StepReceiptAggregateRepositoryOperation,
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
  operation: StepReceiptAggregateRepositoryOperation,
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
  operation: StepReceiptAggregateRepositoryOperation,
  planStorageId: bigint,
  context: ReceiptRestorationContext,
): Effect.fn.Return<
  readonly FrameworkMigrationStepReceiptDependencyDriverRow[],
  FrameworkMigrationRepositoryError
> {
  const batch = context.sidecarsByPlan.get(planStorageId) ?? (yield* loadPlanReceiptSidecars(transaction, planStorageId, operation));
  context.sidecarsByPlan.set(planStorageId, batch);
  if (batch.kind === "indexed") {
    return (batch.rowsByReceipt.get(receiptStorageId) ?? [])
      .slice(0, frame.dependencyReceipts.length + 1);
  }
  return yield* readReceiptDependencyRows(transaction, receiptStorageId, frame.dependencyReceipts.length, operation);
});

const readReceiptDependencyRows = Effect.fn("FrameworkMigrationStepReceiptRepository.readDependencyRows")(
  function* (transaction: FlarexMetadataTransaction, receiptStorageId: bigint, dependencyCount: number,
    operation: StepReceiptAggregateRepositoryOperation): Effect.fn.Return<readonly FrameworkMigrationStepReceiptDependencyDriverRow[], FrameworkMigrationRepositoryError> {
  const query = transaction.select(receiptDependencyReadSelection).from(
    fxSystemFrameworkMigrationStepReceiptDependencies,
  ).where(eq(
    fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
    receiptStorageId,
  )).orderBy(asc(
    fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal,
  )).limit(dependencyCount + 1);
  return yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  },
);

// Raw transport reuse is confined to the enclosing read-only graph pass. Join
// through each receipt's owner so a corrupt sidecar owner is still returned and
// rejected by the existing projection decoder. Oversized histories retain the
// original bounded per-receipt query.
type PlanReceiptSidecars =
  | Readonly<{ kind: "indexed"; rowsByReceipt: ReadonlyMap<unknown, readonly FrameworkMigrationStepReceiptDependencyDriverRow[]> }>
  | Readonly<{ kind: "oversized" }>;

const readPlanSidecars = makeFrameworkGraphReferenceRead<PlanReceiptSidecars>();
const loadPlanReceiptSidecars = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.loadPlanSidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  planStorageId: bigint,
  operation: StepReceiptAggregateRepositoryOperation,
): Effect.fn.Return<PlanReceiptSidecars, FrameworkMigrationRepositoryError> {
  const rows = yield* runRepositoryStatement(operation,
    transaction.select(receiptDependencyReadSelection)
      .from(fxSystemFrameworkMigrationStepReceiptDependencies)
      .innerJoin(fxSystemFrameworkMigrationStepReceipts, eq(
        fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
        fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
      ))
      .where(eq(fxSystemFrameworkMigrationStepReceipts.planStorageId, planStorageId))
      .orderBy(asc(fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal))
      .limit(4097),
  ).pipe(Effect.map(detachDriverRows));
  if (rows.length > 4096) return Object.freeze({ kind: "oversized" });
  // Group detached transport rows once per read pass, without interpreting or
  // coercing the foreign owner key. Exact row/cardinality/projection validation
  // remains with each receipt's existing restorer, including malformed rows.
  const rowsByReceipt = new Map<unknown, FrameworkMigrationStepReceiptDependencyDriverRow[]>();
  for (const row of rows) {
    const owner = row.receiptStorageId;
    const group = rowsByReceipt.get(owner);
    if (group === undefined) rowsByReceipt.set(owner, [row]);
    else group.push(row);
  }
  for (const group of rowsByReceipt.values()) Object.freeze(group);
  return Object.freeze({ kind: "indexed", rowsByReceipt });
}, (read, transaction, planStorageId) => readPlanSidecars(read, transaction, planStorageId));

const insertReceiptDependencySidecars = Effect.fn(
  "FrameworkMigrationStepReceiptRepository.insertDependencySidecars",
)(function* (
  transaction: FlarexMetadataTransaction,
  receiptStorageId: bigint,
  planStorageId: bigint,
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
      planStorageId,
      dependencyOrdinal,
      dependencyReceiptStorageId: dependency.storageId,
      dependencyStepId: expected.stepId,
      dependencyStepReceiptSha256: expected.stepReceiptSha256Bytes,
    });
  }
  yield* insertReceiptDependencyRows(transaction, values, operation);
});

const insertReceiptDependencyRows = Effect.fn("FrameworkMigrationStepReceiptRepository.insertDependencyRows")(
  function* (transaction: FlarexMetadataTransaction, values: readonly FrameworkMigrationStepReceiptDependencyInsert[],
    operation: StepReceiptRepositoryOperation): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
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
  },
);

function makeReceiptRestorationContext(eventAttempts?: ReadonlyMap<bigint, RestoredFrameworkMigrationAttemptStart>): ReceiptRestorationContext {
  return {
    rootsByStorageId: new Map(),
    restoredByStorageId: new Map(),
    storageIdByStepId: new Map(),
    storageIdByDigest: new Map(),
    sidecarsByPlan: new Map(),
    attemptsByStorageId: new Map(),
    eventAttempts,
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
  operation: StepReceiptAggregateRepositoryOperation,
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
  operation: StepReceiptAggregateRepositoryOperation,
): Effect.Effect<string, FrameworkMigrationRepositoryError> {
  return Effect.fromResult(decodeStoredSha256HexResult(
    value,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
}

function mapStoredValueError(
  operation: StepReceiptAggregateRepositoryOperation,
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
  operation: StepReceiptAggregateRepositoryOperation,
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
  planStorageId:
    fxSystemFrameworkMigrationStepReceiptDependencies.planStorageId,
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

import { Cause, Data, Effect } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeUuidV1 } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { reconcileEffectTransactionFailure } from
  "./effectTransactionFailure";
import type {
  ResolvePinnedPointTableIdV1Error,
  ResolvePinnedPointTableIdV1Input,
} from "./pinnedPointTableResolution";
import type {
  LocatedScopeClockReader,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import type { fxSystemTransactionJournals } from "./schema";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptFacetObservationV1,
  PointMutationSessionAttemptExecutionPinV1,
  PointMutationSessionAttemptSelectorV1,
} from "./transactionSessionActivation";
import type {
  CommittedPointOutcomeResolverV1,
} from "./committedPointOutcome";
import type {
  TransactionExecutionClaimObservationV1,
  TransactionExecutionClaimPinV1,
} from "./transactionExecutionClaimModel";

type TransactionJournalRootRowV1 =
  typeof fxSystemTransactionJournals.$inferSelect;

export interface ExactRunningAttemptKernelInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export interface ExactRunningAttemptKernelContextV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionPin: PointMutationSessionAttemptExecutionPinV1;
  readonly databaseNow: Date;
  readonly journalRoot: Readonly<TransactionJournalRootRowV1>;
  readonly attemptFacet: PointMutationSessionAttemptFacetObservationV1;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
}

export type ExactRunningAttemptEffectWorkV1<Result, Failure> = (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
) => Effect.Effect<Result, Failure>;

/**
 * Package-internal capability. This module is deliberately absent from package
 * exports so no public caller can request a raw transaction callback.
 */
export const RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1: unique symbol =
  Symbol("FlarexDB/runExactRunningPointMutationAttemptEffectV1");

export const RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1: unique symbol = Symbol(
  "FlarexDB/resolvePinnedPointTableIdEffectV1",
);

export const RUN_LOCATED_REPEATABLE_READ_V1: unique symbol = Symbol(
  "FlarexDB/runLocatedRepeatableReadV1",
);

export const RUN_LOCATED_READ_COMMITTED_V1: unique symbol = Symbol(
  "FlarexDB/runLocatedReadCommittedV1",
);

/** Package-internal construction seam for the Postgres connected runner. */
export const LOCATED_READ_COMMITTED_RUNNER_V1: unique symbol = Symbol(
  "FlarexDB/locatedReadCommittedRunnerV1",
);

export const RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1: unique symbol =
  Symbol("FlarexDB/resolveLocatedCommittedPointOutcomeV1");

export type LocatedReadCommittedTransactionFailureIssueV1 =
  | Readonly<{
      readonly kind: "infrastructureFailure";
      readonly phase: "acquire" | "beginOrConfigure";
      readonly cause: unknown;
      readonly releaseCause?: unknown;
      readonly quarantineCause?: unknown;
    }>
  | Readonly<{
      readonly kind: "callbackRolledBack";
      readonly callbackCause: unknown;
    }>
  | Readonly<{
      readonly kind: "callbackCleanupFailed";
      readonly callbackCause: unknown;
      readonly transactionCause: unknown;
      readonly releaseCause?: unknown;
      readonly quarantineCause?: unknown;
    }>
  | Readonly<{
      readonly kind: "decisionUncertain";
      readonly settlementCause: unknown;
      readonly releaseCause?: unknown;
      readonly quarantineCause?: unknown;
    }>;

export class LocatedReadCommittedTransactionFailureV1 extends Error {
  readonly name = "LocatedReadCommittedTransactionFailureV1";

  constructor(
    readonly issue: LocatedReadCommittedTransactionFailureIssueV1,
  ) {
    super(
      "Located READ COMMITTED transaction settlement failed.",
      { cause: locatedReadCommittedFailureCause(issue) },
    );
  }
}

function locatedReadCommittedFailureCause(
  issue: LocatedReadCommittedTransactionFailureIssueV1,
): unknown {
  switch (issue.kind) {
    case "infrastructureFailure":
      return issue.cause;
    case "callbackRolledBack":
      return issue.callbackCause;
    case "callbackCleanupFailed":
      return issue.callbackCause;
    case "decisionUncertain":
      return issue.settlementCause;
  }
}

export type RunLocatedReadCommittedTransactionV1 = <Result>(
  work: (tx: AppRowTransaction) => Promise<Result>,
) => Promise<Result>;

export class ExactRunningAttemptTransactionV1Error extends Data.TaggedError(
  "ExactRunningAttemptTransactionV1Error",
)<{
  readonly cause: unknown;
  readonly callbackCause: Cause.Cause<unknown> | undefined;
}> {}

export function reconcileExactRunningAttemptTransactionFailureV1<Failure>(
  failure: ExactRunningAttemptTransactionV1Error,
  callbackCause: Cause.Cause<Failure> | undefined,
  rollbackSignal: unknown,
): Effect.Effect<never, Failure | ExactRunningAttemptTransactionV1Error> {
  return reconcileEffectTransactionFailure(
    failure,
    callbackCause,
    rollbackSignal,
  );
}

export interface LocatedExactRunningAttemptKernelV1
  extends LocatedScopeClockReader {
  readonly [RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1]: <
    Result,
    Failure,
  >(
    input: ExactRunningAttemptKernelInputV1,
    work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
  ) => Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error>;
  readonly [RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1]: (
    input: ResolvePinnedPointTableIdV1Input,
  ) => Effect.Effect<CatalogTableId, ResolvePinnedPointTableIdV1Error>;
  readonly [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
  readonly [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
}

/**
 * Package-internal read-only capability used by detached attempt evidence
 * loaders. It deliberately cannot run a caller callback under mutation locks.
 */
export interface LocatedRepeatableReadAttemptTargetV1
  extends LocatedScopeClockReader {
  readonly [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
}

/**
 * Package-internal writer-transaction capability. The caller remains inside
 * persistence-postgres and receives no authority to escape the transaction.
 */
export interface LocatedReadCommittedAttemptTargetV1
  extends LocatedScopeClockReader {
  readonly [RUN_LOCATED_READ_COMMITTED_V1]: RunLocatedReadCommittedTransactionV1;
}

/**
 * Package-internal O07 target capability. It resolves only the bounded S09-A
 * receipt for the exact located database and cannot expose a database handle.
 */
export interface LocatedPointCommitPublicationTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1]:
    CommittedPointOutcomeResolverV1["resolve"];
}

export function isLocatedReadCommittedAttemptTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedReadCommittedAttemptTargetV1 {
  return typeof Reflect.get(target, RUN_LOCATED_READ_COMMITTED_V1) ===
    "function";
}

export function isLocatedPointCommitPublicationTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedPointCommitPublicationTargetV1 {
  return isLocatedReadCommittedAttemptTargetV1(target) &&
    typeof Reflect.get(
      target,
      RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
    ) === "function";
}

export function isLocatedRepeatableReadAttemptTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedRepeatableReadAttemptTargetV1 {
  return typeof Reflect.get(target, RUN_LOCATED_REPEATABLE_READ_V1) ===
    "function";
}

export function isLocatedExactRunningAttemptKernelV1(
  target: LocatedScopeClockReader,
): target is LocatedExactRunningAttemptKernelV1 {
  return (
    typeof Reflect.get(
      target,
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
    ) === "function" &&
    typeof Reflect.get(
      target,
      RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
    ) === "function"
    && typeof Reflect.get(target, RUN_LOCATED_REPEATABLE_READ_V1) === "function"
    && typeof Reflect.get(target, RUN_LOCATED_READ_COMMITTED_V1) === "function"
  );
}

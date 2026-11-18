import type { CommittedPointOutcomeResolverV1 } from "../../commit/committedPointOutcome";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import type {
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../database/schema";
import type {
  LocatedScopeClockReader,
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type { FiniteExecutionAuthorityObservation, ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type {
  ResolvePinnedDeveloperIndexIdV1Error,
  ResolvePinnedDeveloperIndexIdV1Input,
  ResolvePinnedPointTableIdV1Error,
  ResolvePinnedPointTableIdV1Input,
} from "../../storage/documents/pinnedPointTableErrors";
import type {
  TransactionExecutionClaimObservationV1,
  TransactionExecutionClaimPinV1,
} from "../claims/transactionExecutionClaimModel";
import type {
  CapturedFiniteAttemptAnchor,
  FiniteAttemptAnchorContext,
} from "../finiteAttemptAnchor";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptExecutionPinV1,
  PointMutationSessionAttemptSelectorV1,
} from "./contracts";
import type { ExactRunningAttemptTransactionV1Error } from "./errors";
import type { Effect } from "effect";
import type { CatalogIndexId, CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeUuidV1 } from "flarex-protocol/storage-authority";

type TransactionJournalRootRowV1 =
  typeof fxSystemTransactionJournals.$inferSelect;

export interface ExactRunningAttemptKernelInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly finiteAnchor?: CapturedFiniteAttemptAnchor;
  readonly finiteReadDemand?: import("../../storage/documents/logicalDocuments/participantAdmission").FiniteParticipantStorageDemand;
  readonly finiteApplicationReadDemand?: import("../../storage/documents/logicalDocuments/sourceAdmission").FiniteApplicationStorageDemand;
}

export interface ExactRunningAttemptKernelContextV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly scopeClock: ScopeClockRecord;
  readonly snapshotLease: Readonly<typeof import("../../database/schema").fxSystemSnapshotLeases.$inferSelect>;
  readonly finiteAuthority?: FiniteExecutionAuthorityObservation;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionPin: PointMutationSessionAttemptExecutionPinV1;
  readonly executionAuthorityGeneration:
    (typeof fxSystemTransactionSessions.$inferSelect)["executionAuthorityGeneration"];
  /** Projected from the authenticated session already locked by this kernel. */
  readonly principalDigest: string;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly databaseNow: Date;
  readonly journalRoot: Readonly<TransactionJournalRootRowV1>;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
}

/** Confirmed entry has one real session anchor and authenticated installation metadata. */
export interface FiniteEntryAttemptKernelContext extends Omit<ExactRunningAttemptKernelContextV1,
  "snapshotLease" | "finiteAuthority" | "journalRoot"> {
  readonly session: Readonly<typeof fxSystemTransactionSessions.$inferSelect>;
  readonly finiteAttempt: FiniteAttemptAnchorContext;
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

export const RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1: unique symbol =
  Symbol("FlarexDB/resolvePinnedDeveloperIndexIdEffectV1");

export const RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1: unique symbol =
  Symbol("FlarexDB/resolveLocatedCommittedPointOutcomeV1");

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
  readonly [RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1]: (
    input: ResolvePinnedDeveloperIndexIdV1Input,
  ) => Effect.Effect<CatalogIndexId, ResolvePinnedDeveloperIndexIdV1Error>;
  readonly [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
  readonly [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
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

export function isLocatedPointCommitPublicationTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedPointCommitPublicationTargetV1 {
  return isLocatedReadCommittedAttemptTargetV1(target) &&
    typeof Reflect.get(
      target,
      RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
    ) === "function";
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
    ) === "function" &&
    typeof Reflect.get(
      target,
      RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1,
    ) === "function"
    && typeof Reflect.get(target, RUN_LOCATED_REPEATABLE_READ_V1) === "function"
    && typeof Reflect.get(target, RUN_LOCATED_READ_COMMITTED_V1) === "function"
  );
}

/**
 * Genuinely package-local O10-P0 capability. Unlike the existing exact-attempt
 * kernel module, this file has no package export, including no system-test
 * subpath. Only persistence-postgres owners can receive the raw transaction
 * callback used to capture a bounded indexed-read syscall atomically.
 */
export const RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1:
  unique symbol = Symbol(
    "FlarexDB/runExactRunningPointMutationReadSyscallEffectV1",
  );

export interface LocatedExactRunningAttemptReadSyscallKernelV1
  extends LocatedScopeClockReader {
  readonly [RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1]: <
    Result,
    Failure,
  >(
    input: ExactRunningAttemptKernelInputV1,
    work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
  ) => Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error>;
}

export function isLocatedExactRunningAttemptReadSyscallKernelV1(
  target: LocatedScopeClockReader,
): target is LocatedExactRunningAttemptReadSyscallKernelV1 {
  return typeof Reflect.get(
    target,
    RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  ) === "function";
}

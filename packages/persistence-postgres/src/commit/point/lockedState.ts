import type { ScopeClockRecord, ScopeClockRow } from "../../scope/scopeClock";
import type {
  ScopeUuidV1,
  ScopeEpochUuidV1,
  CommitSeq,
} from "flarex-protocol/storage-authority";
import type {
  TransactionAuthorizationRevocationEpoch,
  TransactionAttemptFence,
} from "flarex-protocol/transaction-session";
import type { fxSystemSnapshotLeases } from "../../database/schema";
import type { ApplicationRelationAdjacencyChange } from "../../application/relations/commit/Model";
import type {
  CommittedPointOutcomeTokenV1,
  CommittedPointOutcomeResolutionV1,
} from "../committedPointOutcome";

export interface LockedPointCommitClockV1 {
  readonly record: ScopeClockRecord;
  readonly oldestAvailableCommitSeq: bigint;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
}

export type PointCommitScopeClockRowV1 = ScopeClockRow;

export interface LockedPointCommitSessionV1 {
  readonly lifecycle: "running" | "finishing";
  readonly attemptFence: TransactionAttemptFence;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

export interface LockedCommittedPointOutcomeV1 {
  readonly state: "available" | "expired";
  readonly commitSeq: CommitSeq;
}

export interface LockedPointCommitLeaseV1 {
  readonly expiresAtMilliseconds: number;
  readonly row: typeof fxSystemSnapshotLeases.$inferSelect;
}

export type PointCommitKernelResultV1 =
  | Readonly<{ readonly kind: "existing" }>
  | Readonly<{
      readonly kind: "ready";
      readonly clock: LockedPointCommitClockV1;
      readonly commitSeq: CommitSeq | null;
      readonly publicationTimeMilliseconds: number | null;
      readonly relationAdjacencyChanges: ReadonlyArray<ApplicationRelationAdjacencyChange>;
    }>;

export type PointCommitReadyForPublicationV1 = Extract<
  PointCommitKernelResultV1,
  { readonly kind: "ready" }
> & {
  readonly commitSeq: CommitSeq;
  readonly publicationTimeMilliseconds: number;
};

export type PointCommitPublicationDecisionV1 =
  | Readonly<{ readonly kind: "existing" }>
  | Readonly<{
      readonly kind: "published";
      readonly token: CommittedPointOutcomeTokenV1;
    }>;

export type PointCommitPublicationRunDecisionV1 =
  | PointCommitPublicationDecisionV1
  | Readonly<{
      readonly kind: "recovered";
      readonly outcome: Exclude<
        CommittedPointOutcomeResolutionV1,
        Readonly<{ readonly kind: "missing" }>
      >;
    }>;

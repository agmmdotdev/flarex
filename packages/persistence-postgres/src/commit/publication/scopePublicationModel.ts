import { Data } from "effect";
import type { PointCommitPublicationObservation } from "../pointCommitPublicationObservation";
import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import type { CommitSeq, ReplacementScopeIdV1, ScopeUuidV1, ScopeEpochUuidV1 } from "flarex-protocol/storage-authority";
import type { TransactionRequestKeyV1, TransactionFunctionPathV1 } from "flarex-protocol/transaction-session";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { ApplicationRelationAdjacencyChange } from "../../application/relations/applicationRelationCommit";
import type { fxSystemCommitRelationalChanges } from "./relationalFactsSchema";
import type { CommittedEvent } from "../events/model";

export interface ScopePublicationClock { readonly record: ScopeClockRecord; readonly scopeUuid: ScopeUuidV1; readonly epochUuid: ScopeEpochUuidV1 }
/** Source-private facts; authenticated participants own admission and lowering. */
export interface ScopePublicationContribution {
  readonly events?: { readonly values: readonly CommittedEvent[]; readonly sha256: string | null };
  readonly relationalFacts?: readonly Omit<typeof fxSystemCommitRelationalChanges.$inferInsert, "scopeUuid" | "epochUuid" | "commitSeq" | "changeOrdinal">[];
  readonly payloadPreferenceDeletionCount?: number;
  readonly authorityPins: { readonly scopeId: ReplacementScopeIdV1; readonly requestKey: TransactionRequestKeyV1; readonly functionPath: TransactionFunctionPathV1 };
  readonly rowIntents: readonly { readonly tableId: CatalogTableId; readonly rowId: AppRowIdHexV1 }[];
  readonly identityAccessPolicySha256: Uint8Array;
  readonly requestSha256: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly successfulResult:
    | (Pick<CanonicalSuccessfulResultV1, "canonicalBytes" | "semanticSizeBytes"> & { readonly encoding: "application-value" })
    | Pick<import("../../values/jsonOutcome").CanonicalJsonOutcome, "encoding" | "canonicalBytes" | "semanticSizeBytes">;
}
export interface ScopePublicationKernel {
  readonly clock: ScopePublicationClock;
  readonly commitSeq: CommitSeq;
  readonly publicationTimeMilliseconds: number;
  readonly relationAdjacencyChanges: readonly ApplicationRelationAdjacencyChange[];
}
export type ScopePublicationStep = "commitHeaderWritten" | "commitChangeWritten" | "commitRelationAdjacencyChangeWritten" | "outcomeWritten" | "wakeWritten" | "clockAdvanced";
export type ScopePublicationSqlOperation = "readDatabaseTime" | "readBindingHead" | "readStrongReferenceFacts" | "readStrongReferenceFullFacts" | "readStrongReferenceProjection" | "writeCommitHeader" | "writeCommitChange" | "writeCommitRelationAdjacencyChange" | "writeOutcome" | "writeWake" | "advanceScopeClock";
export interface ScopePublicationOptions {
  readonly publicationObservation?: PointCommitPublicationObservation;
  /** Row and adjacency change steps fire once per verified INSERT batch. */
  readonly afterTransactionStep?: (event: { readonly scopeId: ReplacementScopeIdV1; readonly step: ScopePublicationStep }) => Promise<void>;
  readonly observeQuery?: (query: { readonly name: ScopePublicationSqlOperation; readonly sql: string; readonly params: readonly unknown[] }) => void;
}
export class ScopePublicationCorruptionError extends Data.TaggedError("ScopePublicationCorruptionError")<{ readonly reason: "scopeClockInvalid" | "publicationInvariantInvalid"; readonly cause?: unknown }> {}
export class ScopePublicationResourceError extends Data.TaggedError("ScopePublicationResourceError")<{ readonly dimension: "commitSequence"; readonly maximum: bigint }> {}
export class ScopePublicationSqlFailure extends Data.TaggedError("ScopePublicationSqlFailure")<{ readonly operation: ScopePublicationSqlOperation; readonly cause: unknown }> {}
export class ScopePublicationUnsupportedProfileError extends Data.TaggedError("ScopePublicationUnsupportedProfileError")<{
  readonly reason: "strongReferenceUnenforced";
}> {}
export class ScopePublicationReferenceConstraintError extends Data.TaggedError("ScopePublicationReferenceConstraintError")<{
  readonly reason: "targetNotLive" | "targetDeleteRestricted" | "sourceIndexValueInvalid";
  readonly reference: string;
  readonly value: string;
}> {}
export class ScopePublicationReferenceCapacityError extends Data.TaggedError("ScopePublicationReferenceCapacityError")<{
  readonly dimension: "changedRows" | "reverseRows" | "readBytes" | "scanMilliseconds";
  readonly maximum: number;
  readonly observedAtLeast: number;
}> {}

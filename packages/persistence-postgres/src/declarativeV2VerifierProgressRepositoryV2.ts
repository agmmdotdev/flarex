import {
  decodeDeclarativeV2FutureRegistrationIntentV1,
  type DeclarativeV2FutureRegistrationIntentV1,
} from "flarex-protocol/internal/declarative-v2-future-registration-intent-v1";
import {
  decodeDeclarativeV2TerminalAuthorityProofV1,
  type DeclarativeV2TerminalAuthorityProofV1,
} from "flarex-protocol/internal/declarative-v2-terminal-authority-proof-v1";
import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isLowercaseUuidText } from "@flarex/utils/strings";
import {
  and,
  asc,
  eq,
  gte,
  isNull,
  sql,
} from "drizzle-orm";
import {
  Data,
  Effect,
  Result,
  Schema,
  Semaphore,
} from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  validateDeclarativeV2VerifierEvidencePageTransitionV2,
  validateDeclarativeV2VerifierFinalEvidencePageV2,
  type DeclarativeV2VerifierAttemptIdentityFrameV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
  type DeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierProgressV2Error,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  ScopeIdSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  makeDeclarativeV2InertRepositoryV1,
  type DeclarativeV2InertRepositoryReadV1Error,
} from "./declarativeV2InertRepository";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import { detachDriverRows } from "./detachDriverRows";
import {
  decodeDeclarativeV2VerifierAttemptMetadataRowV2,
  decodeDeclarativeV2VerifierAttemptStoredStateV2,
  decodeDeclarativeV2VerifierCommittedCommandReadbackV2,
  decodeDeclarativeV2VerifierCommandMetadataRowV2,
  decodeDeclarativeV2VerifierCommandStoredStateV2,
  decodeDeclarativeV2VerifierEvidencePageManifestV2,
  decodeDeclarativeV2VerifierEvidencePageMetadataRowV2,
  decodeDeclarativeV2VerifierEvidencePagePayloadV2,
  decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2,
  decodeDeclarativeV2VerifierStoredFrameV2,
  type DeclarativeV2VerifierDecodedAttemptStoredStateV2,
  type DeclarativeV2VerifierDecodedCommandSettlementV2,
  type DeclarativeV2VerifierDecodedCommandStoredStateV2,
  type DeclarativeV2VerifierProgressV2StoredRowError,
  type DeclarativeV2VerifierStoredAttemptMetadataV2,
  type DeclarativeV2VerifierStoredCommandMetadataV2,
  type DeclarativeV2VerifierStoredEvidencePageMetadataV2,
} from "./declarativeV2VerifierProgressV2";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import {
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandAuthorityV1,
  fxSystemDeclarativeV2VerifierCommandsV2,
  fxSystemDeclarativeV2VerifierEvidencePagesV2,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const FRAME_CODEC_VERSION = 2;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

export type DeclarativeV2VerifierProgressRepositoryOperationV2 =
  | "createAttempt"
  | "observeAttempt"
  | "acquire"
  | "renew"
  | "reserveCommand"
  | "resumePending"
  | "appendEvidencePage"
  | "readEvidencePageBatch"
  | "readSettledEvidencePageBatch"
  | "settleCommand"
  | "observeCommandDecision"
  | "release"
  | "abandon";

type DeclarativeV2VerifierProgressRepositoryPageOperationV2 =
  | "appendEvidencePage"
  | "readEvidencePageBatch"
  | "readSettledEvidencePageBatch";

export interface DeclarativeV2VerifierProgressRepositoryOperationBudgetV2 {
  readonly maximumCalls: number;
  readonly maximumRows: number;
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumHashBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface DeclarativeV2VerifierProgressRepositoryOperationUsageV2 {
  readonly calls: number;
  readonly rows: number;
  readonly frameBytes: number;
  readonly canonicalBytes: number;
  readonly hashBytes: number;
  readonly elapsedMilliseconds: number;
}

export interface DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2
  extends DeclarativeV2VerifierProgressRepositoryOperationBudgetV2 {
  readonly maximumPages: number;
  readonly maximumPayloadBytes: number;
}

export interface DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2
  extends DeclarativeV2VerifierProgressRepositoryOperationUsageV2 {
  readonly pages: number;
  readonly payloadBytes: number;
}

export interface DeclarativeV2VerifierProgressRepositoryOptionsV2 {
  readonly claimDurationMilliseconds: number;
  readonly randomUuid?: () => string;
  readonly monotonicMilliseconds?: () => number;
  readonly observeQuery?: (
    observation: Readonly<{
      readonly name: DeclarativeV2VerifierProgressRepositoryQueryV2;
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

export type DeclarativeV2VerifierProgressRepositoryQueryV2 =
  | "insertAttempt"
  | "attemptMetadata"
  | "attemptFrames"
  | "lockAttempt"
  | "acquireAttempt"
  | "takeoverCommandAuthority"
  | "renewAttempt"
  | "insertCommand"
  | "insertCommandAuthority"
  | "commandAuthority"
  | "registrationPredecessorAuthority"
  | "settleCommandAuthority"
  | "commandMetadata"
  | "commandFrames"
  | "reserveAttempt"
  | "pageCommandMetadata"
  | "pageMetadata"
  | "pageBytes"
  | "insertEvidencePage"
  | "advanceCommandPageTail"
  | "settlementCommandMetadata"
  | "settlementCommandFrames"
  | "settlementFinalPageMetadata"
  | "settlementFinalPageManifest"
  | "settleCommand"
  | "settleAttempt"
  | "decisionAttemptMetadata"
  | "decisionCommandMetadata"
  | "decisionCommandAuthority"
  | "decisionFinalPageMetadata"
  | "decisionAttemptFrames"
  | "decisionCommandFrames"
  | "settledReadCommandMetadata"
  | "settledReadPredecessorMetadata"
  | "settledReadPageMetadata"
  | "settledReadFinalPageMetadata"
  | "settledReadSettlementFrames"
  | "settledReadPredecessorManifest"
  | "settledReadFinalPageManifest"
  | "settledReadPageBytes"
  | "releaseAttempt"
  | "abandonAttempt";

export class DeclarativeV2VerifierProgressRepositoryConfigurationV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryConfigurationV2Error",
  )<{
    readonly reason: "invalidClaimDuration" | "invalidMonotonicClock";
  }> {}

export class DeclarativeV2VerifierProgressRepositoryInputV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryInputV2Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressRepositoryOperationV2;
    readonly reason:
      | "invalidInput"
      | "invalidBudget"
      | "budgetExceeded"
      | "invalidRun"
      | "runClosed"
      | "invalidWork"
      | "workClosed"
      | "commandMismatch";
    readonly dimension?:
      keyof DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    readonly observed?: number;
    readonly maximum?: number;
    readonly codecCause?: DeclarativeV2VerifierProgressV2Error;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryNotFoundV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryNotFoundV2Error",
  )<{
    readonly operation: Exclude<
      DeclarativeV2VerifierProgressRepositoryOperationV2,
      "createAttempt" | "observeAttempt"
    >;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryBusyV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryBusyV2Error",
  )<{
    readonly operation: "acquire";
    readonly leaseExpiresAt: Date;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryStaleV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryStaleV2Error",
  )<{
    readonly operation: Exclude<
      DeclarativeV2VerifierProgressRepositoryOperationV2,
      "createAttempt" | "observeAttempt"
    >;
    readonly reason:
      | "ownerChanged"
      | "leaseExpired"
      | "stateChanged"
      | "pendingChanged";
  }> {}

export class DeclarativeV2VerifierProgressRepositoryConflictV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryConflictV2Error",
  )<{
    readonly operation:
      | "createAttempt"
      | "reserveCommand"
      | "resumePending"
      | "appendEvidencePage"
      | "readEvidencePageBatch"
      | "readSettledEvidencePageBatch"
      | "settleCommand"
      | "observeCommandDecision"
      | "release";
    readonly reason:
      | "attemptChanged"
      | "commandChanged"
      | "pendingExists"
      | "pageCollision"
      | "pageGap"
      | "predecessorMismatch"
      | "settlementChanged";
  }> {}

export class DeclarativeV2VerifierProgressRepositoryLifecycleV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryLifecycleV2Error",
  )<{
    readonly operation: Exclude<
      DeclarativeV2VerifierProgressRepositoryOperationV2,
      "createAttempt" | "observeAttempt"
    >;
    readonly lifecycle:
      DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"];
    readonly phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"];
  }> {}

export class DeclarativeV2VerifierProgressRepositoryCorruptionV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryCorruptionV2Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressRepositoryOperationV2;
    readonly reason:
      | "invalidMetadata"
      | "invalidStoredBytes"
      | "digestMismatch"
      | "normalizedMismatch"
      | "selectorMismatch"
      | "missingPageWithinTail"
      | "rowCountMismatch";
    readonly storedCause?: DeclarativeV2VerifierProgressV2StoredRowError;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryExhaustionV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryExhaustionV2Error",
  )<{
    readonly operation:
      | "acquire"
      | "reserveCommand"
      | "appendEvidencePage"
      | "settleCommand";
    readonly dimension: "writerFence" | "sequence" | "pageCount" |
      DeclarativeV2VerifierBudgetDimensionV2;
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressRepositoryOperationV2;
    readonly cause: unknown;
    readonly retryable: boolean;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressRepositoryOperationV2;
    readonly scopeId: string;
    readonly attemptSha256: Uint8Array;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryResourceV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryResourceV2Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressRepositoryOperationV2;
    readonly phase: "cleanup" | "infrastructure";
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export type DeclarativeV2VerifierProgressRepositoryV2Error =
  | DeclarativeV2VerifierProgressRepositoryConfigurationV2Error
  | DeclarativeV2VerifierProgressRepositoryInputV2Error
  | DeclarativeV2VerifierProgressRepositoryNotFoundV2Error
  | DeclarativeV2VerifierProgressRepositoryBusyV2Error
  | DeclarativeV2VerifierProgressRepositoryStaleV2Error
  | DeclarativeV2VerifierProgressRepositoryConflictV2Error
  | DeclarativeV2VerifierProgressRepositoryLifecycleV2Error
  | DeclarativeV2VerifierProgressRepositoryCorruptionV2Error
  | DeclarativeV2VerifierProgressRepositoryExhaustionV2Error
  | DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error
  | DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error
  | DeclarativeV2VerifierProgressRepositoryResourceV2Error
  | DeclarativeV2InertRepositoryReadV1Error
  | DeclarativeV2Sha256V1Error;

export interface DeclarativeV2VerifierProgressRunV2 {
  readonly _tag: "DeclarativeV2VerifierProgressRunV2";
}

export interface DeclarativeV2VerifierProgressWorkV2 {
  readonly _tag: "DeclarativeV2VerifierProgressWorkV2";
}

export interface DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"];
  readonly writerFence: bigint;
  readonly leaseExpiresAt: Date | null;
  readonly settledSequence: bigint;
  readonly lastReceiptSha256: Uint8Array | null;
  readonly pendingKind: DeclarativeV2VerifierDurableCommandKindV2 | null;
  readonly pendingSequence: bigint | null;
  readonly pendingReservationSha256: Uint8Array | null;
  readonly pendingReservedByFence: bigint | null;
  readonly identitySha256: Uint8Array;
  readonly ceilingsSha256: Uint8Array;
  readonly usageSha256: Uint8Array;
  readonly progressSha256: Uint8Array;
  readonly identity: DeclarativeV2VerifierAttemptIdentityFrameV2;
  readonly ceilings: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_ceilings";
  };
  readonly usage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly progress: DeclarativeV2VerifierProgressCursorFrameV2;
}

export interface DeclarativeV2VerifierProgressCreateAttemptInputV2 {
  readonly scopeId: string;
  readonly candidateSha256: Uint8Array;
  readonly ceilings: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_ceilings";
  };
}

export interface DeclarativeV2VerifierProgressReserveCommandInputV2 {
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  /**
   * Private authenticated bridge input. Link and registration commands require
   * the same canonical future-registration intent; legacy repository callers
   * omit the property entirely and retain the existing V2 contract.
   */
  readonly authority?: Readonly<{
    readonly futureRegistrationIntentBytes: Uint8Array | null;
  }>;
}

export interface DeclarativeV2VerifierProgressAppendEvidencePageInputV2 {
  readonly manifestBytes: Uint8Array;
  readonly payloadBytes: Uint8Array;
}

export interface DeclarativeV2VerifierProgressReadEvidencePageBatchInputV2 {
  readonly startPageOrdinal: bigint;
  readonly expectedPredecessorPageSha256: Uint8Array | null;
}

export interface DeclarativeV2VerifierProgressReadSettledEvidencePageBatchInputV2 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly commandKind: "parse_module" | "link_page";
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly outputManifestSha256: Uint8Array;
  readonly receiptSha256: Uint8Array;
  readonly startPageOrdinal: bigint;
  readonly expectedPredecessorPageSha256: Uint8Array | null;
}

export interface DeclarativeV2VerifierProgressSettleCommandInputV2 {
  readonly outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2;
  readonly commandUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly receipt: DeclarativeV2VerifierCommandReceiptFrameV2;
  readonly authority?: Readonly<{
    readonly terminalProofBytes: Uint8Array;
  }>;
}

export interface DeclarativeV2VerifierProgressObserveCommandDecisionInputV2 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly terminalProofBytes?: Uint8Array;
}

export interface DeclarativeV2VerifierProgressEvidencePageSnapshotV2 {
  readonly manifest: DeclarativeV2VerifierEvidencePageManifestFrameV2;
  readonly manifestBytes: Uint8Array;
  readonly pageSha256: Uint8Array;
  readonly payloadBytes: Uint8Array;
  readonly payloadSha256: Uint8Array;
  readonly createdAt: Date;
}

export interface DeclarativeV2VerifierProgressSettlementSnapshotV2 {
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly reservationBytes: Uint8Array;
  readonly outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2;
  readonly outputManifestBytes: Uint8Array;
  readonly commandUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly commandUsageBytes: Uint8Array;
  readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly resultingUsageBytes: Uint8Array;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly nextProgressBytes: Uint8Array;
  readonly receipt: DeclarativeV2VerifierCommandReceiptFrameV2;
  readonly receiptBytes: Uint8Array;
  readonly receiptSha256: Uint8Array;
  readonly settledAt: Date;
}

export type DeclarativeV2VerifierProgressCommandDecisionV2 =
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
    readonly kind: "pending";
    readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
    readonly sequence: bigint;
    readonly reservationSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "terminalUnsettled";
    readonly lifecycle: "abandoned" | "ready" | "rejected";
    readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
    readonly sequence: bigint;
    readonly reservationSha256: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "settled";
    readonly settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2;
  }>;

export type DeclarativeV2VerifierProgressObserveResultV2 =
  | Readonly<{
    readonly kind: "missing";
    readonly operationUsage:
      DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
  }>
  | Readonly<{
    readonly kind: "present";
    readonly attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2;
    readonly operationUsage:
      DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
  }>;

export interface DeclarativeV2VerifierProgressRepositoryV2 {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    DeclarativeV2VerifierProgressRepositoryConfigurationV2Error
  >;
  readonly createAttempt: (
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "inserted" | "replayed";
      readonly attemptSha256: Uint8Array;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly observeAttempt: (
    scopeId: unknown,
    attemptSha256: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2VerifierProgressObserveResultV2,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly acquire: (
    scopeId: unknown,
    attemptSha256: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "acquired" | "sameOwnerReplay";
      readonly run: DeclarativeV2VerifierProgressRunV2;
      readonly attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2;
      readonly leaseExpiresAt: Date;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly renew: (
    run: DeclarativeV2VerifierProgressRunV2,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly leaseExpiresAt: Date;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly reserveCommand: (
    run: DeclarativeV2VerifierProgressRunV2,
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "reserved" | "pendingReplay";
      readonly work: DeclarativeV2VerifierProgressWorkV2;
      readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
      readonly reservationSha256: Uint8Array;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly resumePending: (
    run: DeclarativeV2VerifierProgressRunV2,
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly work: DeclarativeV2VerifierProgressWorkV2;
      readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
      readonly reservationSha256: Uint8Array;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly appendEvidencePage: (
    work: DeclarativeV2VerifierProgressWorkV2,
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "appended" | "replayed";
      readonly pageOrdinal: bigint;
      readonly pageSha256: Uint8Array;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly readEvidencePageBatch: (
    work: DeclarativeV2VerifierProgressWorkV2,
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly pages:
        readonly DeclarativeV2VerifierProgressEvidencePageSnapshotV2[];
      readonly nextPageOrdinal: bigint | null;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly readSettledEvidencePageBatch: (
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2;
      readonly pages:
        readonly DeclarativeV2VerifierProgressEvidencePageSnapshotV2[];
      readonly next: Readonly<{
        readonly startPageOrdinal: bigint;
        readonly expectedPredecessorPageSha256: Uint8Array;
      }> | null;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly settleCommand: (
    work: DeclarativeV2VerifierProgressWorkV2,
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "settled";
      readonly settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly observeCommandDecision: (
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly decision: DeclarativeV2VerifierProgressCommandDecisionV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly release: (
    run: DeclarativeV2VerifierProgressRunV2,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "released";
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly abandon: (
    run: DeclarativeV2VerifierProgressRunV2,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "abandoned";
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
}

interface MutableOperationUsageV2 {
  calls: number;
  rows: number;
  frameBytes: number;
  canonicalBytes: number;
  hashBytes: number;
  elapsedMilliseconds: number;
}

interface MutablePageOperationUsageV2 extends MutableOperationUsageV2 {
  pages: number;
  payloadBytes: number;
}

interface CapturedFrameV2<
  Frame extends DeclarativeV2VerifierProgressFrameV2,
> {
  readonly frame: Frame;
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}

interface CapturedCommandAuthorityV1 {
  readonly futureRegistrationIntent:
    | Readonly<{
      readonly intent: DeclarativeV2FutureRegistrationIntentV1;
      readonly bytes: Uint8Array;
      readonly sha256: Uint8Array;
    }>
    | null;
}

interface CapturedTerminalAuthorityV1 {
  readonly proof: DeclarativeV2TerminalAuthorityProofV1;
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}

interface MutableRunStateV2 {
  readonly scopeId: ScopeId;
  readonly attemptSha256: Uint8Array;
  readonly ownerId: string;
  readonly writerFence: bigint;
  readonly identitySha256: Uint8Array;
  readonly ceilingsSha256: Uint8Array;
  usageSha256: Uint8Array;
  progressSha256: Uint8Array;
  attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2;
  leaseExpiresAtMilliseconds: number;
  closed: boolean;
  readonly gate: ReturnType<typeof Semaphore.makeUnsafe>;
}

interface MutableWorkStateV2 {
  readonly run: DeclarativeV2VerifierProgressRunV2;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly reservationBytes: Uint8Array;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly commandBudgetBytes: Uint8Array;
  readonly authenticatedAuthority: CapturedCommandAuthorityV1 | null;
  closed: boolean;
}

interface LoadedAttemptV2 {
  readonly decoded: DeclarativeV2VerifierDecodedAttemptStoredStateV2;
}

interface LoadedCommandV2 {
  readonly decoded: DeclarativeV2VerifierDecodedCommandStoredStateV2;
}

interface CapturedEvidencePageV2 {
  readonly manifest: DeclarativeV2VerifierEvidencePageManifestFrameV2;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Uint8Array;
  readonly payloadBytes: Uint8Array;
  readonly payloadSha256: Uint8Array;
}

interface LoadedEvidencePageBytesV2 {
  readonly metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2;
  readonly manifestBytes: Uint8Array;
  readonly payloadBytes: Uint8Array;
}

interface CapturedSettlementV2 {
  readonly outputManifest: CapturedFrameV2<
    DeclarativeV2VerifierCommandOutputManifestFrameV2
  >;
  readonly commandUsage: CapturedFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" }
  >;
  readonly resultingUsage: CapturedFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" }
  >;
  readonly nextProgress: CapturedFrameV2<
    DeclarativeV2VerifierProgressCursorFrameV2
  >;
  readonly receipt: CapturedFrameV2<
    DeclarativeV2VerifierCommandReceiptFrameV2
  >;
  readonly authority: CapturedTerminalAuthorityV1 | null;
  readonly nextLifecycle:
    DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"];
}

interface RawSettledCommandRowsV2 {
  readonly attemptMetadata: unknown;
  readonly attemptUsageBytes: Uint8Array;
  readonly attemptProgressBytes: Uint8Array;
  readonly commandMetadata: unknown;
  readonly finalPageMetadata:
    DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null;
  readonly reservationBytes: Uint8Array;
  readonly commandBudgetBytes: Uint8Array;
  readonly outputManifestBytes: Uint8Array;
  readonly commandUsageBytes: Uint8Array;
  readonly resultingUsageBytes: Uint8Array;
  readonly nextProgressBytes: Uint8Array;
  readonly receiptBytes: Uint8Array;
}

interface CapturedSettledEvidencePageBatchInputV2
  extends DeclarativeV2VerifierProgressReadSettledEvidencePageBatchInputV2 {
  readonly scopeId: ScopeId;
}

interface RawHistoricalSettledCommandRowsV2 {
  readonly commandMetadata: unknown;
  readonly finalPageMetadata:
    DeclarativeV2VerifierStoredEvidencePageMetadataV2;
  readonly predecessorMetadata:
    DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null;
  readonly reservationBytes: Uint8Array;
  readonly commandBudgetBytes: Uint8Array;
  readonly outputManifestBytes: Uint8Array;
  readonly commandUsageBytes: Uint8Array;
  readonly resultingUsageBytes: Uint8Array;
  readonly nextProgressBytes: Uint8Array;
  readonly receiptBytes: Uint8Array;
  readonly predecessorManifestBytes: Uint8Array | null;
  readonly finalPageManifestBytes: Uint8Array;
  readonly pages: readonly LoadedEvidencePageBytesV2[];
  readonly next: Readonly<{
    readonly startPageOrdinal: bigint;
    readonly expectedPredecessorPageSha256: Uint8Array;
  }> | null;
}

type LoadedCommandDecisionRowsV2 =
  | Readonly<{
    readonly kind: "unsettled";
    readonly attempt: DeclarativeV2VerifierStoredAttemptMetadataV2;
    readonly command: DeclarativeV2VerifierStoredCommandMetadataV2;
  }>
  | Readonly<{
    readonly kind: "settled";
    readonly rows: RawSettledCommandRowsV2;
  }>;

interface LoadedFinalPageProofV2 {
  readonly metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2;
  readonly manifest: DeclarativeV2VerifierEvidencePageManifestFrameV2;
  readonly manifestBytes: Uint8Array;
  readonly pageSha256: Uint8Array;
}

class RepositoryStatementFailureV2 {
  readonly _tag = "RepositoryStatementFailureV2";
  constructor(readonly cause: unknown) {}
}

class RepositoryBudgetFailureV2 {
  readonly _tag = "RepositoryBudgetFailureV2";
  constructor(
    readonly error: DeclarativeV2VerifierProgressRepositoryInputV2Error,
  ) {}
}

const OPERATION_MAXIMUM = Object.freeze({
  calls: "maximumCalls",
  rows: "maximumRows",
  frameBytes: "maximumFrameBytes",
  canonicalBytes: "maximumCanonicalBytes",
  hashBytes: "maximumHashBytes",
  elapsedMilliseconds: "maximumElapsedMilliseconds",
} as const);

export function makeDeclarativeV2VerifierProgressRepositoryV2(
  target: LocatedReadCommittedAttemptTargetV1,
  options: DeclarativeV2VerifierProgressRepositoryOptionsV2,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): DeclarativeV2VerifierProgressRepositoryV2 {
  const configuration = captureConfiguration(options);
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const monotonicMilliseconds = options.monotonicMilliseconds ??
    (() => performance.now());
  const inertRepository = makeDeclarativeV2InertRepositoryV1(target, sha256);
  const runs = new WeakMap<object, MutableRunStateV2>();
  const works = new WeakMap<object, MutableWorkStateV2>();
  const activeRuns = new Map<
    string,
    Readonly<{
      readonly run: DeclarativeV2VerifierProgressRunV2;
      readonly state: MutableRunStateV2;
    }>
  >();

  const createAttempt = Effect.fn(
    "DeclarativeV2.verifierProgressV2.createAttempt",
  )(function* (rawInput: unknown, rawBudget: unknown) {
    const start = monotonicMilliseconds();
    const budget = yield* Effect.fromResult(
      decodeOperationBudget("createAttempt", rawBudget),
    );
    const usage = mutableUsage();
    const input = yield* Effect.fromResult(captureCreateInput(rawInput));
    const ceilings = yield* captureFrame(
      "createAttempt",
      input.ceilings,
      "attempt_ceilings",
      budget,
      usage,
      sha256,
    );
    const candidate = yield* inertRepository.readCandidate(
      input.scopeId,
      input.candidateSha256,
      remainingInertBudget(budget, usage),
    );
    yield* Effect.fromResult(mergeInertUsage(
      "createAttempt",
      budget,
      usage,
      candidate.usage,
    ));
    if (candidate.kind === "missing") {
      return yield* new DeclarativeV2VerifierProgressRepositoryInputV2Error({
        operation: "createAttempt",
        reason: "invalidInput",
      });
    }
    const identity = yield* captureFrame(
      "createAttempt",
      Object.freeze({
        kind: "attempt_identity" as const,
        candidateSha256: input.candidateSha256,
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        ceilingsSha256: ceilings.sha256,
      }),
      "attempt_identity",
      budget,
      usage,
      sha256,
    );
    const zeroUsage = yield* captureFrame(
      "createAttempt",
      zeroBudgetFrame("attempt_usage"),
      "attempt_usage",
      budget,
      usage,
      sha256,
    );
    const progress = yield* captureFrame(
      "createAttempt",
      Object.freeze({
        kind: "progress_cursor" as const,
        phase: "source" as const,
        settledSequence: 0n,
        moduleOrdinal: 0n,
        edgeOrdinal: 0n,
        pageOrdinal: 0n,
        previousReceiptSha256: null,
      }),
      "progress_cursor",
      budget,
      usage,
      sha256,
    );
    const insertion = yield* runTransactionWithConfirmedRollbackRetry(
      target,
      "createAttempt",
      input.scopeId,
      identity.sha256,
      budget,
      usage,
      monotonicMilliseconds,
      start,
      async (tx) => {
        requireElapsedOrThrow(
          "createAttempt",
          budget,
          usage,
          start,
          monotonicMilliseconds,
        );
        chargeSqlOrThrow("createAttempt", budget, usage, 1);
        const query = tx
          .insert(fxSystemDeclarativeV2VerifierAttemptsV2)
          .values({
            scopeId: input.scopeId,
            attemptSha256: identity.sha256,
            candidateSha256: input.candidateSha256,
            lifecycle: "open",
            identityCodecVersion: FRAME_CODEC_VERSION,
            identityByteLength: BigInt(identity.bytes.byteLength),
            identitySha256: identity.sha256,
            identityBytes: identity.bytes,
            ceilingsCodecVersion: FRAME_CODEC_VERSION,
            ceilingsByteLength: BigInt(ceilings.bytes.byteLength),
            ceilingsSha256: ceilings.sha256,
            ceilingsBytes: ceilings.bytes,
            usageCodecVersion: FRAME_CODEC_VERSION,
            usageByteLength: BigInt(zeroUsage.bytes.byteLength),
            usageSha256: zeroUsage.sha256,
            usageBytes: zeroUsage.bytes,
            progressCodecVersion: FRAME_CODEC_VERSION,
            progressByteLength: BigInt(progress.bytes.byteLength),
            progressSha256: progress.sha256,
            progressBytes: progress.bytes,
          })
          .onConflictDoNothing({
            target: [
              fxSystemDeclarativeV2VerifierAttemptsV2.scopeId,
              fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
            ],
          })
          .returning({
            attemptSha256:
              fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
          });
        observeDrizzleQuery("insertAttempt", query, options.observeQuery);
        const rows = await runStatement(() => query);
        if (rows.length > 1) throw corruption("createAttempt", "rowCountMismatch");
        return rows.length === 1 ? "inserted" as const : "replayed" as const;
      },
    );
    if (insertion === "replayed") {
      const existing = yield* loadAttempt(
        target,
        "createAttempt",
        input.scopeId,
        identity.sha256,
        budget,
        usage,
        sha256,
        options.observeQuery,
      );
      if (
        existing === null ||
        !bytesEqualFullScan(
          existing.decoded.metadata.candidateSha256,
          input.candidateSha256,
        ) ||
        !bytesEqualFullScan(
          existing.decoded.identity.canonicalBytes,
          identity.bytes,
        ) ||
        !bytesEqualFullScan(
          existing.decoded.ceilings.canonicalBytes,
          ceilings.bytes,
        )
      ) {
        return yield* new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
          operation: "createAttempt",
          reason: "attemptChanged",
        });
      }
    }
    return Object.freeze({
      kind: insertion,
      attemptSha256: new Uint8Array(identity.sha256),
      operationUsage: freezeUsage(usage),
    });
  });

  const observeAttempt = Effect.fn(
    "DeclarativeV2.verifierProgressV2.observeAttempt",
  )(function* (
    rawScopeId: unknown,
    rawAttemptSha256: unknown,
    rawBudget: unknown,
  ) {
    const start = monotonicMilliseconds();
    const budget = yield* Effect.fromResult(
      decodeOperationBudget("observeAttempt", rawBudget),
    );
    const usage = mutableUsage();
    const selector = yield* Effect.fromResult(
      captureSelector("observeAttempt", rawScopeId, rawAttemptSha256),
    );
    const loaded = yield* loadAttempt(
      target,
      "observeAttempt",
      selector.scopeId,
      selector.attemptSha256,
      budget,
      usage,
      sha256,
      options.observeQuery,
    );
    yield* Effect.fromResult(setElapsed(
      "observeAttempt",
      budget,
      usage,
      start,
      monotonicMilliseconds,
    ));
    return loaded === null
      ? Object.freeze({
        kind: "missing" as const,
        operationUsage: freezeUsage(usage),
      })
      : Object.freeze({
        kind: "present" as const,
        attempt: snapshotAttempt(loaded.decoded),
        operationUsage: freezeUsage(usage),
      });
  });

  const acquire = Effect.fn("DeclarativeV2.verifierProgressV2.acquire")(
    function* (
      rawScopeId: unknown,
      rawAttemptSha256: unknown,
      rawBudget: unknown,
    ) {
      const start = monotonicMilliseconds();
      const budget = yield* Effect.fromResult(
        decodeOperationBudget("acquire", rawBudget),
      );
      const usage = mutableUsage();
      const selector = yield* Effect.fromResult(
        captureSelector("acquire", rawScopeId, rawAttemptSha256),
      );
      const loaded = yield* loadAttempt(
        target,
        "acquire",
        selector.scopeId,
        selector.attemptSha256,
        budget,
        usage,
        sha256,
        options.observeQuery,
      );
      if (loaded === null) {
        return yield* new DeclarativeV2VerifierProgressRepositoryNotFoundV2Error({
          operation: "acquire",
        });
      }
      if (isTerminal(loaded.decoded.metadata.lifecycle)) {
        return yield* lifecycleError(
          "acquire",
          loaded.decoded.metadata.lifecycle,
          loaded.decoded.progress.frame.phase,
        );
      }
      const key = selectorKey(selector.scopeId, selector.attemptSha256);
      const currentLocal = activeRuns.get(key);
      const proposedOwner = currentLocal !== undefined &&
          !currentLocal.state.closed
        ? currentLocal.state.ownerId
        : yield* Effect.fromResult(captureOwnerId(randomUuid));
      const claimed = yield* runTransactionWithConfirmedRollbackRetry(
        target,
        "acquire",
        selector.scopeId,
        selector.attemptSha256,
        budget,
        usage,
        monotonicMilliseconds,
        start,
        async (tx) => {
          const locked = await lockAttemptMetadata(
            tx,
            "acquire",
            selector.scopeId,
            selector.attemptSha256,
            budget,
            usage,
            options.observeQuery,
          );
          if (locked === null) {
            throw new DeclarativeV2VerifierProgressRepositoryNotFoundV2Error({
              operation: "acquire",
            });
          }
          if (isTerminal(locked.lifecycle)) {
            throw lifecycleError(
              "acquire",
              locked.lifecycle,
              loaded.decoded.progress.frame.phase,
            );
          }
          const now = databaseNowMilliseconds(locked);
          const expiry = optionalDateMilliseconds(locked.leaseExpiresAt);
          if (
            locked.writerOwnerId !== null &&
            expiry !== undefined &&
            expiry !== null &&
            expiry > now &&
            (
              currentLocal === undefined ||
              currentLocal.state.closed ||
              locked.writerOwnerId !== currentLocal.state.ownerId ||
              locked.writerFence !== currentLocal.state.writerFence
            )
          ) {
            throw new DeclarativeV2VerifierProgressRepositoryBusyV2Error({
              operation: "acquire",
              leaseExpiresAt: copyDate(locked.leaseExpiresAt!),
            });
          }
          if (
            currentLocal !== undefined &&
            !currentLocal.state.closed &&
            locked.writerOwnerId === currentLocal.state.ownerId &&
            locked.writerFence === currentLocal.state.writerFence &&
            expiry !== undefined &&
            expiry !== null &&
            expiry > now
          ) {
            requireFrameLineage("acquire", locked, loaded.decoded.metadata);
            return Object.freeze({
              kind: "sameOwnerReplay" as const,
              ownerId: currentLocal.state.ownerId,
              writerFence: locked.writerFence,
              leaseExpiresAt: copyDate(locked.leaseExpiresAt!),
              pendingReservedByFence: locked.pendingReservedByFence,
            });
          }
          requireAcquireTransitionLineage(locked, loaded.decoded.metadata);
          if (locked.writerFence >= MAX_SIGNED_INT64) {
            throw new DeclarativeV2VerifierProgressRepositoryExhaustionV2Error({
              operation: "acquire",
              dimension: "writerFence",
              observed: locked.writerFence + 1n,
              maximum: MAX_SIGNED_INT64,
            });
          }
          const writerFence = locked.writerFence + 1n;
          const leaseExpiresAt = checkedExpiry(
            now,
            configurationOrThrow(configuration).claimDurationMilliseconds,
          );
          requireElapsedOrThrow(
            "acquire",
            budget,
            usage,
            start,
            monotonicMilliseconds,
          );
          chargeSqlOrThrow("acquire", budget, usage, 1);
          const query = tx
            .update(fxSystemDeclarativeV2VerifierAttemptsV2)
            .set({
              writerOwnerId: proposedOwner,
              writerFence,
              leaseUpdatedAt: locked.databaseNow,
              leaseExpiresAt,
              pendingReservedByFence: locked.pendingKind === null
                ? null
                : writerFence,
              updatedAt: locked.databaseNow,
            })
            .where(and(
              eq(
                fxSystemDeclarativeV2VerifierAttemptsV2.scopeId,
                selector.scopeId,
              ),
              eq(
                fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
                selector.attemptSha256,
              ),
              eq(
                fxSystemDeclarativeV2VerifierAttemptsV2.writerFence,
                locked.writerFence,
              ),
            ))
            .returning({
              attemptSha256:
                fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
            });
          observeDrizzleQuery("acquireAttempt", query, options.observeQuery);
          const rows = await runStatement(() => query);
          requireOneRow("acquire", rows.length);
          if (
            locked.pendingKind !== null &&
            locked.pendingSequence !== null &&
            locked.pendingReservationSha256 !== null &&
            locked.pendingReservedByFence !== null
          ) {
            chargeSqlOrThrow("acquire", budget, usage, 1);
            const authorityTable =
              fxSystemDeclarativeV2VerifierCommandAuthorityV1;
            const authorityUpdate = tx
              .update(authorityTable)
              .set({ reservedByFence: writerFence })
              .where(and(
                eq(authorityTable.scopeId, selector.scopeId),
                eq(authorityTable.attemptSha256, selector.attemptSha256),
                eq(authorityTable.sequence, locked.pendingSequence),
                eq(
                  authorityTable.reservationSha256,
                  locked.pendingReservationSha256,
                ),
                eq(
                  authorityTable.reservedByFence,
                  locked.pendingReservedByFence,
                ),
                isNull(authorityTable.settledAt),
              ))
              .returning({ sequence: authorityTable.sequence });
            observeDrizzleQuery(
              "takeoverCommandAuthority",
              authorityUpdate,
              options.observeQuery,
            );
            const authorityRows =
              await runStatement(() => authorityUpdate);
            if (authorityRows.length > 1) {
              throw corruption("acquire", "rowCountMismatch");
            }
          }
          return Object.freeze({
            kind: "acquired" as const,
            ownerId: proposedOwner,
            writerFence,
            leaseExpiresAt,
            pendingReservedByFence: locked.pendingKind === null
              ? null
              : writerFence,
          });
        },
      );
      const claimedAttempt = projectClaimedAttempt(
        snapshotAttempt(loaded.decoded),
        claimed.writerFence,
        claimed.leaseExpiresAt,
        claimed.pendingReservedByFence,
      );
      if (
        claimed.kind === "sameOwnerReplay" &&
        currentLocal !== undefined &&
        !currentLocal.state.closed
      ) {
        currentLocal.state.attempt = claimedAttempt;
        currentLocal.state.leaseExpiresAtMilliseconds =
          claimed.leaseExpiresAt.getTime();
        yield* Effect.fromResult(setElapsed(
          "acquire",
          budget,
          usage,
          start,
          monotonicMilliseconds,
        ));
        return Object.freeze({
          kind: "sameOwnerReplay" as const,
          run: currentLocal.run,
          attempt: copyAttemptSnapshot(claimedAttempt),
          leaseExpiresAt: copyDate(claimed.leaseExpiresAt),
          operationUsage: freezeUsage(usage),
        });
      }
      if (currentLocal !== undefined) closeRun(currentLocal.state, activeRuns);
      const run = Object.freeze({
        _tag: "DeclarativeV2VerifierProgressRunV2" as const,
      });
      const state: MutableRunStateV2 = {
        scopeId: selector.scopeId,
        attemptSha256: new Uint8Array(selector.attemptSha256),
        ownerId: claimed.ownerId,
        writerFence: claimed.writerFence,
        identitySha256: new Uint8Array(loaded.decoded.identity.sha256),
        ceilingsSha256: new Uint8Array(loaded.decoded.ceilings.sha256),
        usageSha256: new Uint8Array(loaded.decoded.usage.sha256),
        progressSha256: new Uint8Array(loaded.decoded.progress.sha256),
        attempt: claimedAttempt,
        leaseExpiresAtMilliseconds: claimed.leaseExpiresAt.getTime(),
        closed: false,
        gate: Semaphore.makeUnsafe(1),
      };
      runs.set(run, state);
      activeRuns.set(key, Object.freeze({ run, state }));
      return Object.freeze({
        kind: "acquired" as const,
        run,
        attempt: copyAttemptSnapshot(claimedAttempt),
        leaseExpiresAt: copyDate(claimed.leaseExpiresAt),
        operationUsage: freezeUsage(usage),
      });
    },
  );

  const renew = Effect.fn("DeclarativeV2.verifierProgressV2.renew")(
    (run: DeclarativeV2VerifierProgressRunV2, rawBudget: unknown) =>
      withRun(runs, run, "renew", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("renew", rawBudget),
          );
          const usage = mutableUsage();
          const leaseExpiresAt = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "renew",
            state.scopeId,
            state.attemptSha256,
            budget,
            usage,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const locked = await lockAttemptMetadata(
                tx,
                "renew",
                state.scopeId,
                state.attemptSha256,
                budget,
                usage,
                options.observeQuery,
              );
              requireLiveOwner("renew", locked, state);
              const now = databaseNowMilliseconds(locked);
              const nextExpiry = checkedExpiry(
                now,
                configurationOrThrow(configuration).claimDurationMilliseconds,
              );
              requireElapsedOrThrow(
                "renew",
                budget,
                usage,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("renew", budget, usage, 1);
              const query = tx
                .update(fxSystemDeclarativeV2VerifierAttemptsV2)
                .set({
                  leaseUpdatedAt: locked.databaseNow,
                  leaseExpiresAt: nextExpiry,
                  updatedAt: locked.databaseNow,
                })
                .where(ownerWhere(state))
                .returning({
                  attemptSha256:
                    fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
                });
              observeDrizzleQuery("renewAttempt", query, options.observeQuery);
              const rows = await runStatement(() => query);
              requireOneRow("renew", rows.length);
              return nextExpiry;
            },
          ).pipe(closeRunOnFailure(state, activeRuns));
          state.leaseExpiresAtMilliseconds = leaseExpiresAt.getTime();
          return Object.freeze({
            leaseExpiresAt: copyDate(leaseExpiresAt),
            operationUsage: freezeUsage(usage),
          });
        }))
  );

  const reserveCommand = Effect.fn(
    "DeclarativeV2.verifierProgressV2.reserveCommand",
  )((run: DeclarativeV2VerifierProgressRunV2, rawInput: unknown, rawBudget: unknown) =>
    withRun(runs, run, "reserveCommand", (state) =>
      Effect.gen(function* () {
        const start = monotonicMilliseconds();
        const budget = yield* Effect.fromResult(
          decodeOperationBudget("reserveCommand", rawBudget),
        );
        const usage = mutableUsage();
        const input = yield* captureReserveInput(
          "reserveCommand",
          rawInput,
          state,
          budget,
          usage,
          sha256,
        );
        const resultingUsage = state.attempt.pendingKind === null
          ? yield* captureResultingUsage(
            state,
            input.commandBudget.frame,
            budget,
            usage,
            sha256,
          )
          : null;
        const decision = yield* runTransactionWithConfirmedRollbackRetry(
          target,
          "reserveCommand",
          state.scopeId,
          state.attemptSha256,
          budget,
          usage,
          monotonicMilliseconds,
          start,
          async (tx) => {
            const locked = await lockAttemptMetadata(
              tx,
              "reserveCommand",
              state.scopeId,
              state.attemptSha256,
              budget,
              usage,
              options.observeQuery,
            );
            requireLiveOwner("reserveCommand", locked, state);
            requireRunLineage("reserveCommand", locked, state);
            requireCommandAllowed(
              "reserveCommand",
              locked.lifecycle,
              state.attempt.progress.phase,
              input.reservation.frame.commandKind,
            );
            requireReservationLineage(state, input);
            if (locked.pendingKind !== null) {
              if (
                locked.pendingKind !== input.reservation.frame.commandKind ||
                locked.pendingSequence !== input.reservation.frame.sequence ||
                locked.pendingReservationSha256 === null ||
                !bytesEqualFullScan(
                  locked.pendingReservationSha256,
                  input.reservation.sha256,
                )
              ) {
                throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
                  operation: "reserveCommand",
                  reason: "pendingExists",
                });
              }
              const stored = await readCommandRows(
                tx,
                "reserveCommand",
                state.scopeId,
                state.attemptSha256,
                input.reservation.frame.sequence,
                budget,
                usage,
                options.observeQuery,
              );
              if (stored === null) {
                throw corruption("reserveCommand", "normalizedMismatch");
              }
              const storedAuthority = await readCommandAuthority(
                tx,
                "reserveCommand",
                state.scopeId,
                state.attemptSha256,
                input.reservation.frame.sequence,
                budget,
                usage,
                options.observeQuery,
              );
              requireCommandAuthorityPresenceAndEquality(
                "reserveCommand",
                input.authority,
                storedAuthority,
                input.reservation,
                state.writerFence,
              );
              return Object.freeze({
                kind: "pendingReplay" as const,
                stored,
              });
            }
            if (resultingUsage === null) {
              throw stale("reserveCommand", "stateChanged");
            }
            if (
              input.authority !== null &&
              input.authority.futureRegistrationIntent !== null &&
              input.reservation.frame.commandKind === "registration_page"
            ) {
              await requireRegistrationPredecessorAuthority(
                tx,
                state.scopeId,
                state.attemptSha256,
                input.authority.futureRegistrationIntent,
                input.reservation,
                budget,
                usage,
                options.observeQuery,
              );
            }
            requireElapsedOrThrow(
              "reserveCommand",
              budget,
              usage,
              start,
              monotonicMilliseconds,
            );
            chargeSqlOrThrow("reserveCommand", budget, usage, 1);
            const insert = tx
              .insert(fxSystemDeclarativeV2VerifierCommandsV2)
              .values({
                scopeId: state.scopeId,
                attemptSha256: state.attemptSha256,
                sequence: input.reservation.frame.sequence,
                commandKind: input.reservation.frame.commandKind,
                reservationSha256: input.reservation.sha256,
                reservationCodecVersion: FRAME_CODEC_VERSION,
                reservationByteLength:
                  BigInt(input.reservation.bytes.byteLength),
                reservationFrameSha256: input.reservation.sha256,
                reservationBytes: input.reservation.bytes,
                commandBudgetCodecVersion: FRAME_CODEC_VERSION,
                commandBudgetByteLength:
                  BigInt(input.commandBudget.bytes.byteLength),
                commandBudgetSha256: input.commandBudget.sha256,
                commandBudgetBytes: input.commandBudget.bytes,
                reservedByFence: state.writerFence,
                reservedAt: locked.databaseNow,
              })
              .onConflictDoNothing({
                target: [
                  fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
                  fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
                  fxSystemDeclarativeV2VerifierCommandsV2.sequence,
                ],
              })
              .returning({
                sequence: fxSystemDeclarativeV2VerifierCommandsV2.sequence,
              });
            observeDrizzleQuery("insertCommand", insert, options.observeQuery);
            const inserted = await runStatement(() => insert);
            if (inserted.length !== 1) {
              throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
                operation: "reserveCommand",
                reason: "commandChanged",
              });
            }
            if (input.authority !== null) {
              const intent = input.authority.futureRegistrationIntent;
              chargeSqlOrThrow("reserveCommand", budget, usage, 1);
              const authorityInsert = tx
                .insert(fxSystemDeclarativeV2VerifierCommandAuthorityV1)
                .values({
                  scopeId: state.scopeId,
                  attemptSha256: state.attemptSha256,
                  sequence: input.reservation.frame.sequence,
                  commandKind: input.reservation.frame.commandKind,
                  reservationSha256: input.reservation.sha256,
                  reservedByFence: state.writerFence,
                  reservedAt: locked.databaseNow,
                  futureRegistrationIntentCodecVersion:
                    intent === null ? null : 1,
                  futureRegistrationIntentByteLength:
                    intent === null ? null : BigInt(intent.bytes.byteLength),
                  futureRegistrationIntentSha256:
                    intent === null ? null : intent.sha256,
                  futureRegistrationIntentBytes:
                    intent === null ? null : intent.bytes,
                })
                .returning({
                  sequence:
                    fxSystemDeclarativeV2VerifierCommandAuthorityV1.sequence,
                });
              observeDrizzleQuery(
                "insertCommandAuthority",
                authorityInsert,
                options.observeQuery,
              );
              const insertedAuthority =
                await runStatement(() => authorityInsert);
              requireOneRow("reserveCommand", insertedAuthority.length);
            }
            chargeSqlOrThrow("reserveCommand", budget, usage, 1);
            const update = tx
              .update(fxSystemDeclarativeV2VerifierAttemptsV2)
              .set({
                pendingKind: input.reservation.frame.commandKind,
                pendingSequence: input.reservation.frame.sequence,
                pendingReservationSha256: input.reservation.sha256,
                pendingReservedByFence: state.writerFence,
                pendingStartedAt: locked.databaseNow,
                usageCodecVersion: FRAME_CODEC_VERSION,
                usageByteLength: BigInt(resultingUsage.bytes.byteLength),
                usageSha256: resultingUsage.sha256,
                usageBytes: resultingUsage.bytes,
                updatedAt: locked.databaseNow,
              })
              .where(and(
                ownerWhere(state),
                eq(
                  fxSystemDeclarativeV2VerifierAttemptsV2.settledSequence,
                  locked.settledSequence,
                ),
              ))
              .returning({
                attemptSha256:
                  fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
              });
            observeDrizzleQuery("reserveAttempt", update, options.observeQuery);
            const updated = await runStatement(() => update);
            requireOneRow("reserveCommand", updated.length);
            return Object.freeze({
              kind: "reserved" as const,
              stored: null,
            });
          },
        ).pipe(closeRunOnFailure(state, activeRuns));
        if (decision.stored !== null) {
          const decoded = yield* decodeCommandRows(
            "reserveCommand",
            decision.stored,
            state.attempt,
            budget,
            usage,
            sha256,
            input.reservation.frame,
          );
          requireCapturedCommandEquals("reserveCommand", input, decoded);
          yield* Effect.fromResult(setElapsed(
            "reserveCommand",
            budget,
            usage,
            start,
            monotonicMilliseconds,
          ));
        } else {
          if (resultingUsage === null) {
            return yield* stale("reserveCommand", "stateChanged");
          }
          state.attempt = projectReservedAttempt(
            state.attempt,
            input,
            resultingUsage.frame,
            resultingUsage.sha256,
            state.writerFence,
          );
          state.usageSha256 = new Uint8Array(resultingUsage.sha256);
        }
        const token = prepareWorkToken(
          run,
          input.reservation.frame,
          input.reservation.bytes,
          input.reservation.sha256,
          input.commandBudget.frame,
          input.commandBudget.bytes,
          input.authority,
        );
        works.set(token.work, token.state);
        return Object.freeze({
          kind: decision.kind,
          work: token.work,
          reservation: copyReservation(input.reservation.frame),
          reservationSha256: new Uint8Array(input.reservation.sha256),
          operationUsage: freezeUsage(usage),
        });
      }))
  );

  const resumePending = Effect.fn(
    "DeclarativeV2.verifierProgressV2.resumePending",
  )((run: DeclarativeV2VerifierProgressRunV2, rawInput: unknown, rawBudget: unknown) =>
    withRun(runs, run, "resumePending", (state) =>
      Effect.gen(function* () {
        const start = monotonicMilliseconds();
        const budget = yield* Effect.fromResult(
          decodeOperationBudget("resumePending", rawBudget),
        );
        const usage = mutableUsage();
        const input = yield* captureReserveInput(
          "resumePending",
          rawInput,
          state,
          budget,
          usage,
          sha256,
        );
        const stored = yield* runTransactionWithConfirmedRollbackRetry(
          target,
          "resumePending",
          state.scopeId,
          state.attemptSha256,
          budget,
          usage,
          monotonicMilliseconds,
          start,
          async (tx) => {
            const locked = await lockAttemptMetadata(
              tx,
              "resumePending",
              state.scopeId,
              state.attemptSha256,
              budget,
              usage,
              options.observeQuery,
            );
            requireLiveOwner("resumePending", locked, state);
            if (
              locked.pendingKind !== input.reservation.frame.commandKind ||
              locked.pendingSequence !== input.reservation.frame.sequence ||
              locked.pendingReservationSha256 === null ||
              !bytesEqualFullScan(
                locked.pendingReservationSha256,
                input.reservation.sha256,
              )
            ) {
              throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
                operation: "resumePending",
                reason: "commandChanged",
              });
            }
            const command = await readCommandRows(
              tx,
              "resumePending",
              state.scopeId,
              state.attemptSha256,
              input.reservation.frame.sequence,
              budget,
              usage,
              options.observeQuery,
            );
            if (command === null) {
              throw corruption("resumePending", "normalizedMismatch");
            }
            const storedAuthority = await readCommandAuthority(
              tx,
              "resumePending",
              state.scopeId,
              state.attemptSha256,
              input.reservation.frame.sequence,
              budget,
              usage,
              options.observeQuery,
            );
            requireCommandAuthorityPresenceAndEquality(
              "resumePending",
              input.authority,
              storedAuthority,
              input.reservation,
              locked.pendingReservedByFence ?? state.writerFence,
            );
            return command;
          },
        ).pipe(closeRunOnFailure(state, activeRuns));
        const decoded = yield* decodeCommandRows(
          "resumePending",
          stored,
          state.attempt,
          budget,
          usage,
          sha256,
          input.reservation.frame,
        );
        requireCapturedCommandEquals("resumePending", input, decoded);
        const token = prepareWorkToken(
          run,
          input.reservation.frame,
          input.reservation.bytes,
          input.reservation.sha256,
          input.commandBudget.frame,
          input.commandBudget.bytes,
          input.authority,
        );
        works.set(token.work, token.state);
        yield* Effect.fromResult(setElapsed(
          "resumePending",
          budget,
          usage,
          start,
          monotonicMilliseconds,
        ));
        return Object.freeze({
          work: token.work,
          reservation: copyReservation(input.reservation.frame),
          reservationSha256: new Uint8Array(input.reservation.sha256),
          operationUsage: freezeUsage(usage),
        });
      }))
  );

  const appendEvidencePage = Effect.fn(
    "DeclarativeV2.verifierProgressV2.appendEvidencePage",
  )((
    work: DeclarativeV2VerifierProgressWorkV2,
    rawInput: unknown,
    rawBudget: unknown,
  ) =>
    withWork(
      runs,
      works,
      work,
      "appendEvidencePage",
      (state, workState) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodePageOperationBudget("appendEvidencePage", rawBudget),
          );
          const usage = mutablePageUsage();
          const input = yield* captureEvidencePageInput(
            rawInput,
            workState,
            budget,
            usage,
            sha256,
          );
          const decision = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "appendEvidencePage",
            state.scopeId,
            state.attemptSha256,
            budget,
            usage,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const attempt = await lockAttemptMetadata(
                tx,
                "appendEvidencePage",
                state.scopeId,
                state.attemptSha256,
                budget,
                usage,
                options.observeQuery,
              );
              requireLiveOwner("appendEvidencePage", attempt, state);
              requireRunLineage("appendEvidencePage", attempt, state);
              requirePendingWork("appendEvidencePage", attempt, state, workState);
              const command = await lockPageCommandMetadata(
                tx,
                "appendEvidencePage",
                state,
                workState,
                budget,
                usage,
                options.observeQuery,
              );
              requirePageCommand(
                "appendEvidencePage",
                command,
                workState,
              );
              if (input.manifest.pageOrdinal > command.pageCount) {
                throw pageConflict("appendEvidencePage", "pageGap");
              }
              if (input.manifest.pageOrdinal < command.pageCount) {
                const existing = await readExactEvidencePageRows(
                  tx,
                  "appendEvidencePage",
                  state,
                  workState,
                  input.manifest.pageOrdinal,
                  budget,
                  usage,
                  options.observeQuery,
                );
                if (existing === null) {
                  throw corruption(
                    "appendEvidencePage",
                    "missingPageWithinTail",
                  );
                }
                requirePageMetadataMatchesCaptured(existing.metadata, input);
                if (
                  !bytesEqualFullScan(
                    existing.manifestBytes,
                    input.manifestBytes,
                  ) ||
                  !bytesEqualFullScan(existing.payloadBytes, input.payloadBytes)
                ) {
                  throw pageConflict("appendEvidencePage", "pageCollision");
                }
                const predecessor = input.manifest.pageOrdinal === 0n
                  ? null
                  : await readEvidencePageMetadataExact(
                    tx,
                    "appendEvidencePage",
                    state,
                    workState,
                    input.manifest.pageOrdinal - 1n,
                    budget,
                    usage,
                    options.observeQuery,
                    true,
                  );
                requireReadBatchContinuity(
                  "appendEvidencePage",
                  input.manifest.pageOrdinal,
                  predecessor,
                  [existing.metadata],
                );
                if (input.manifest.pageOrdinal + 1n === command.pageCount) {
                  requireCommandPageTail(
                    "appendEvidencePage",
                    command,
                    existing.metadata,
                  );
                }
                return "replayed" as const;
              }
              if (command.pageCount >= MAX_SIGNED_INT64) {
                throw new
                  DeclarativeV2VerifierProgressRepositoryExhaustionV2Error({
                    operation: "appendEvidencePage",
                    dimension: "pageCount",
                    observed: command.pageCount + 1n,
                    maximum: MAX_SIGNED_INT64,
                  });
              }
              const unexpectedCurrent =
                await readEvidencePageMetadataExact(
                  tx,
                  "appendEvidencePage",
                  state,
                  workState,
                  input.manifest.pageOrdinal,
                  budget,
                  usage,
                  options.observeQuery,
                  true,
                );
              if (unexpectedCurrent !== null) {
                throw corruption(
                  "appendEvidencePage",
                  "normalizedMismatch",
                );
              }
              const predecessor = command.pageCount === 0n
                ? null
                : await readEvidencePageMetadataExact(
                  tx,
                  "appendEvidencePage",
                  state,
                  workState,
                  command.pageCount - 1n,
                  budget,
                  usage,
                  options.observeQuery,
                  true,
                );
              requireAppendTransition(
                input.manifest,
                command,
                predecessor,
              );
              requireElapsedOrThrow(
                "appendEvidencePage",
                budget,
                usage,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("appendEvidencePage", budget, usage, 1);
              const insert = tx
                .insert(fxSystemDeclarativeV2VerifierEvidencePagesV2)
                .values({
                  scopeId: state.scopeId,
                  attemptSha256: state.attemptSha256,
                  sequence: workState.sequence,
                  commandKind: input.manifest.commandKind,
                  reservationSha256: workState.reservationSha256,
                  pageOrdinal: input.manifest.pageOrdinal,
                  pageSha256: input.manifestSha256,
                  firstEvidenceOrdinal: input.manifest.firstEvidenceOrdinal,
                  evidenceCount: input.manifest.evidenceCount,
                  firstDiagnosticOrdinal: input.manifest.firstDiagnosticOrdinal,
                  diagnosticCount: input.manifest.diagnosticCount,
                  predecessorPageSha256:
                    input.manifest.predecessorPageSha256,
                  cumulativeDiagnosticsRootSha256:
                    input.manifest.cumulativeDiagnosticsRootSha256,
                  manifestCodecVersion: FRAME_CODEC_VERSION,
                  manifestByteLength: BigInt(input.manifestBytes.byteLength),
                  manifestSha256: input.manifestSha256,
                  manifestBytes: input.manifestBytes,
                  payloadCodecVersion: 1,
                  payloadByteLength: BigInt(input.payloadBytes.byteLength),
                  payloadSha256: input.payloadSha256,
                  payloadBytes: input.payloadBytes,
                })
                .returning({
                  pageSha256:
                    fxSystemDeclarativeV2VerifierEvidencePagesV2.pageSha256,
                });
              observeDrizzleQuery(
                "insertEvidencePage",
                insert,
                options.observeQuery,
              );
              const inserted = await runStatement(() => insert);
              requireOneRow("appendEvidencePage", inserted.length);
              chargeSqlOrThrow("appendEvidencePage", budget, usage, 1);
              const update = tx
                .update(fxSystemDeclarativeV2VerifierCommandsV2)
                .set({
                  pageCount: command.pageCount + 1n,
                  lastPageSha256: input.manifestSha256,
                })
                .where(and(
                  eq(
                    fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
                    state.scopeId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
                    state.attemptSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierCommandsV2.sequence,
                    workState.sequence,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierCommandsV2.reservationSha256,
                    workState.reservationSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierCommandsV2.pageCount,
                    command.pageCount,
                  ),
                  command.lastPageSha256 === null
                    ? isNull(
                      fxSystemDeclarativeV2VerifierCommandsV2.lastPageSha256,
                    )
                    : eq(
                      fxSystemDeclarativeV2VerifierCommandsV2.lastPageSha256,
                      command.lastPageSha256,
                    ),
                  isNull(
                    fxSystemDeclarativeV2VerifierCommandsV2.settledAt,
                  ),
                ))
                .returning({
                  sequence: fxSystemDeclarativeV2VerifierCommandsV2.sequence,
                });
              observeDrizzleQuery(
                "advanceCommandPageTail",
                update,
                options.observeQuery,
              );
              const updated = await runStatement(() => update);
              requireOneRow("appendEvidencePage", updated.length);
              return "appended" as const;
            },
          ).pipe(closeRunOnFailure(state, activeRuns));
          yield* Effect.fromResult(setElapsed(
            "appendEvidencePage",
            budget,
            usage,
            start,
            monotonicMilliseconds,
          ));
          return Object.freeze({
            kind: decision,
            pageOrdinal: input.manifest.pageOrdinal,
            pageSha256: new Uint8Array(input.manifestSha256),
            operationUsage: freezePageUsage(usage),
          });
        }),
    ));

  const readEvidencePageBatch = Effect.fn(
    "DeclarativeV2.verifierProgressV2.readEvidencePageBatch",
  )((
    work: DeclarativeV2VerifierProgressWorkV2,
    rawInput: unknown,
    rawBudget: unknown,
  ) =>
    withWork(
      runs,
      works,
      work,
      "readEvidencePageBatch",
      (state, workState) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodePageOperationBudget("readEvidencePageBatch", rawBudget),
          );
          const usage = mutablePageUsage();
          const input = yield* Effect.fromResult(
            captureReadEvidencePageBatchInput(rawInput),
          );
          const loaded = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "readEvidencePageBatch",
            state.scopeId,
            state.attemptSha256,
            budget,
            usage,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const attempt = await lockAttemptMetadata(
                tx,
                "readEvidencePageBatch",
                state.scopeId,
                state.attemptSha256,
                budget,
                usage,
                options.observeQuery,
              );
              requireLiveOwner("readEvidencePageBatch", attempt, state);
              requireRunLineage("readEvidencePageBatch", attempt, state);
              requirePendingWork(
                "readEvidencePageBatch",
                attempt,
                state,
                workState,
              );
              const command = await lockPageCommandMetadata(
                tx,
                "readEvidencePageBatch",
                state,
                workState,
                budget,
                usage,
                options.observeQuery,
              );
              requirePageCommand(
                "readEvidencePageBatch",
                command,
                workState,
              );
              if (input.startPageOrdinal > command.pageCount) {
                throw pageConflict("readEvidencePageBatch", "pageGap");
              }
              const predecessor = input.startPageOrdinal === 0n
                ? null
                : await readEvidencePageMetadataExact(
                  tx,
                  "readEvidencePageBatch",
                  state,
                  workState,
                  input.startPageOrdinal - 1n,
                  budget,
                  usage,
                  options.observeQuery,
                  false,
                );
              requireReadPredecessor(input, predecessor);
              const metadata = await readEvidencePageMetadataBatch(
                tx,
                state,
                workState,
                input.startPageOrdinal,
                budget,
                usage,
                options.observeQuery,
              );
              if (
                metadata.some(page => page.pageOrdinal >= command.pageCount)
              ) {
                throw corruption(
                  "readEvidencePageBatch",
                  "normalizedMismatch",
                );
              }
              if (
                input.startPageOrdinal < command.pageCount &&
                metadata.length === 0
              ) {
                throw corruption(
                  "readEvidencePageBatch",
                  "missingPageWithinTail",
                );
              }
              requireReadBatchContinuity(
                "readEvidencePageBatch",
                input.startPageOrdinal,
                predecessor,
                metadata,
              );
              const nextOrdinal =
                input.startPageOrdinal + BigInt(metadata.length);
              if (nextOrdinal === command.pageCount) {
                requireCommandPageTail(
                  "readEvidencePageBatch",
                  command,
                  metadata[metadata.length - 1] ?? predecessor,
                );
              }
              if (
                metadata.length < budget.maximumPages &&
                nextOrdinal < command.pageCount
              ) {
                throw corruption(
                  "readEvidencePageBatch",
                  "missingPageWithinTail",
                );
              }
              const rows = await readEvidencePageBytesBatch(
                tx,
                state,
                workState,
                metadata,
                budget,
                usage,
                options.observeQuery,
              );
              return Object.freeze({
                rows,
                nextPageOrdinal:
                  nextOrdinal < command.pageCount ? nextOrdinal : null,
              });
            },
          ).pipe(closeRunOnFailure(state, activeRuns));
          const pages: DeclarativeV2VerifierProgressEvidencePageSnapshotV2[] =
            [];
          for (const row of loaded.rows) {
            pages.push(yield* decodeLoadedEvidencePage(
              "readEvidencePageBatch",
              row,
              budget,
              sha256,
            ));
          }
          yield* Effect.fromResult(setElapsed(
            "readEvidencePageBatch",
            budget,
            usage,
            start,
            monotonicMilliseconds,
          ));
          return Object.freeze({
            pages: Object.freeze(pages),
            nextPageOrdinal: loaded.nextPageOrdinal,
            operationUsage: freezePageUsage(usage),
          });
        }),
    ));

  const readSettledEvidencePageBatch = Effect.fn(
    "DeclarativeV2.verifierProgressV2.readSettledEvidencePageBatch",
  )((rawInput: unknown, rawBudget: unknown) =>
    Effect.gen(function* () {
      const start = monotonicMilliseconds();
      const budget = yield* Effect.fromResult(
        decodePageOperationBudget(
          "readSettledEvidencePageBatch",
          rawBudget,
        ),
      );
      const usage = mutablePageUsage();
      const input = yield* Effect.fromResult(
        captureReadSettledEvidencePageBatchInput(rawInput),
      );
      const loaded = yield* loadHistoricalSettledEvidencePageBatch(
        target,
        input,
        budget,
        usage,
        monotonicMilliseconds,
        start,
        options.observeQuery,
      );
      const decoded = yield* decodeHistoricalSettledEvidencePageBatch(
        loaded,
        input,
        budget,
        sha256,
      );
      yield* Effect.fromResult(setElapsed(
        "readSettledEvidencePageBatch",
        budget,
        usage,
        start,
        monotonicMilliseconds,
      ));
      return Object.freeze({
        settlement: decoded.settlement,
        pages: decoded.pages,
        next: loaded.next,
        operationUsage: freezePageUsage(usage),
      });
    }));

  const settleCommand = Effect.fn(
    "DeclarativeV2.verifierProgressV2.settleCommand",
  )((
    work: DeclarativeV2VerifierProgressWorkV2,
    rawInput: unknown,
    rawBudget: unknown,
  ) =>
    withWork(
      runs,
      works,
      work,
      "settleCommand",
      (state, workState) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("settleCommand", rawBudget),
          );
          const usage = mutableUsage();
          const input: CapturedSettlementV2 =
            yield* captureSettlementInput(
              rawInput,
              state,
              workState,
              budget,
              usage,
              sha256,
            );
          const finalPage = yield* loadFinalPageProofForSettlement(
            target,
            state,
            workState,
            input.outputManifest.frame,
            budget,
            usage,
            sha256,
            options.observeQuery,
          ).pipe(closeRunOnFailure(state, activeRuns));
          const settledAt = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "settleCommand",
            state.scopeId,
            state.attemptSha256,
            budget,
            usage,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const attempt = await lockAttemptMetadata(
                tx,
                "settleCommand",
                state.scopeId,
                state.attemptSha256,
                budget,
                usage,
                options.observeQuery,
              );
              requireLiveOwner("settleCommand", attempt, state);
              requireRunLineage("settleCommand", attempt, state);
              requirePendingWork(
                "settleCommand",
                attempt,
                state,
                workState,
              );
              const command = await lockSettlementCommandMetadata(
                tx,
                state,
                workState,
                budget,
                usage,
                options.observeQuery,
              );
              if (command.decoded.metadata.settledAt !== null) {
                throw new
                  DeclarativeV2VerifierProgressRepositoryConflictV2Error({
                    operation: "settleCommand",
                    reason: "settlementChanged",
                  });
              }
              const storedAuthority = await readCommandAuthority(
                tx,
                "settleCommand",
                state.scopeId,
                state.attemptSha256,
                workState.sequence,
                budget,
                usage,
                options.observeQuery,
              );
              requireCommandAuthorityPresenceAndEquality(
                "settleCommand",
                workState.authenticatedAuthority,
                storedAuthority,
                {
                  frame: workState.reservation,
                  bytes: workState.reservationBytes,
                  sha256: workState.reservationSha256,
                },
                null,
              );
              await requirePageSettlementProof(
                tx,
                state,
                workState,
                command.decoded.metadata,
                finalPage,
                budget,
                usage,
                options.observeQuery,
              );
              const proposedMetadata = settlementCommandMetadata(
                command.raw,
                input,
                attempt.databaseNow,
              );
              const proposed = resultOrThrow(
                decodeDeclarativeV2VerifierCommandStoredStateV2(
                  proposedMetadata,
                  state.attempt.candidateSha256,
                  state.progressSha256,
                  state.attempt.lastReceiptSha256,
                  state.attempt.lifecycle,
                  state.attempt.progress.phase,
                  input.nextLifecycle,
                  workState.reservationBytes,
                  workState.reservationSha256,
                  workState.commandBudgetBytes,
                  command.decoded.commandBudget.sha256,
                  settlementDecoderInput(input),
                  storedDecoderBudget(budget),
                ),
                "settleCommand",
              );
              if (proposed.settlement === null) {
                throw corruption("settleCommand", "normalizedMismatch");
              }
              requireElapsedOrThrow(
                "settleCommand",
                budget,
                usage,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("settleCommand", budget, usage, 1);
              const commandUpdate = tx
                .update(fxSystemDeclarativeV2VerifierCommandsV2)
                .set({
                  outputManifestCodecVersion: FRAME_CODEC_VERSION,
                  outputManifestByteLength:
                    BigInt(input.outputManifest.bytes.byteLength),
                  outputManifestSha256: input.outputManifest.sha256,
                  outputManifestBytes: input.outputManifest.bytes,
                  commandUsageCodecVersion: FRAME_CODEC_VERSION,
                  commandUsageByteLength:
                    BigInt(input.commandUsage.bytes.byteLength),
                  commandUsageSha256: input.commandUsage.sha256,
                  commandUsageBytes: input.commandUsage.bytes,
                  resultingUsageCodecVersion: FRAME_CODEC_VERSION,
                  resultingUsageByteLength:
                    BigInt(input.resultingUsage.bytes.byteLength),
                  resultingUsageSha256: input.resultingUsage.sha256,
                  resultingUsageBytes: input.resultingUsage.bytes,
                  nextProgressCodecVersion: FRAME_CODEC_VERSION,
                  nextProgressByteLength:
                    BigInt(input.nextProgress.bytes.byteLength),
                  nextProgressSha256: input.nextProgress.sha256,
                  nextProgressBytes: input.nextProgress.bytes,
                  receiptCodecVersion: FRAME_CODEC_VERSION,
                  receiptByteLength: BigInt(input.receipt.bytes.byteLength),
                  receiptSha256: input.receipt.sha256,
                  receiptBytes: input.receipt.bytes,
                  settledAt: attempt.databaseNow,
                })
                .where(and(
                  commandWhere(state, workState),
                  isNull(
                    fxSystemDeclarativeV2VerifierCommandsV2.settledAt,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierCommandsV2.pageCount,
                    command.decoded.metadata.pageCount,
                  ),
                  command.decoded.metadata.lastPageSha256 === null
                    ? isNull(
                      fxSystemDeclarativeV2VerifierCommandsV2.lastPageSha256,
                    )
                    : eq(
                      fxSystemDeclarativeV2VerifierCommandsV2.lastPageSha256,
                      command.decoded.metadata.lastPageSha256,
                    ),
                ))
                .returning({
                  sequence: fxSystemDeclarativeV2VerifierCommandsV2.sequence,
                });
              observeDrizzleQuery(
                "settleCommand",
                commandUpdate,
                options.observeQuery,
              );
              requireOneRow(
                "settleCommand",
                (await runStatement(() => commandUpdate)).length,
              );
              if (input.authority !== null) {
                chargeSqlOrThrow("settleCommand", budget, usage, 1);
                const authorityTable =
                  fxSystemDeclarativeV2VerifierCommandAuthorityV1;
                const authorityUpdate = tx
                  .update(authorityTable)
                  .set({
                    terminalProofCodecVersion: 1,
                    terminalProofByteLength:
                      BigInt(input.authority.bytes.byteLength),
                    terminalProofSha256: input.authority.sha256,
                    terminalProofBytes: input.authority.bytes,
                    settledAt: attempt.databaseNow,
                  })
                  .where(and(
                    eq(authorityTable.scopeId, state.scopeId),
                    eq(
                      authorityTable.attemptSha256,
                      state.attemptSha256,
                    ),
                    eq(authorityTable.sequence, workState.sequence),
                    eq(
                      authorityTable.reservationSha256,
                      workState.reservationSha256,
                    ),
                    isNull(authorityTable.settledAt),
                  ))
                  .returning({ sequence: authorityTable.sequence });
                observeDrizzleQuery(
                  "settleCommandAuthority",
                  authorityUpdate,
                  options.observeQuery,
                );
                requireOneRow(
                  "settleCommand",
                  (await runStatement(() => authorityUpdate)).length,
                );
              }
              chargeSqlOrThrow("settleCommand", budget, usage, 1);
              const attemptUpdate = tx
                .update(fxSystemDeclarativeV2VerifierAttemptsV2)
                .set({
                  lifecycle: input.nextLifecycle,
                  settledSequence: workState.sequence,
                  lastReceiptSha256: input.receipt.sha256,
                  progressCodecVersion: FRAME_CODEC_VERSION,
                  progressByteLength:
                    BigInt(input.nextProgress.bytes.byteLength),
                  progressSha256: input.nextProgress.sha256,
                  progressBytes: input.nextProgress.bytes,
                  pendingKind: null,
                  pendingSequence: null,
                  pendingReservationSha256: null,
                  pendingReservedByFence: null,
                  pendingStartedAt: null,
                  updatedAt: attempt.databaseNow,
                })
                .where(and(
                  ownerWhere(state),
                  eq(
                    fxSystemDeclarativeV2VerifierAttemptsV2.lifecycle,
                    state.attempt.lifecycle,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttemptsV2.settledSequence,
                    state.attempt.settledSequence,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttemptsV2.usageSha256,
                    state.usageSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttemptsV2.progressSha256,
                    state.progressSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttemptsV2.pendingSequence,
                    workState.sequence,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttemptsV2
                      .pendingReservationSha256,
                    workState.reservationSha256,
                  ),
                ))
                .returning({
                  attemptSha256:
                    fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
                });
              observeDrizzleQuery(
                "settleAttempt",
                attemptUpdate,
                options.observeQuery,
              );
              requireOneRow(
                "settleCommand",
                (await runStatement(() => attemptUpdate)).length,
              );
              return copyDate(attempt.databaseNow);
            },
          ).pipe(closeRunOnFailure(state, activeRuns));
          state.progressSha256 = new Uint8Array(input.nextProgress.sha256);
          state.attempt = projectSettledAttempt(
            state.attempt,
            input,
            workState.sequence,
          );
          yield* Effect.fromResult(setElapsed(
            "settleCommand",
            budget,
            usage,
            start,
            monotonicMilliseconds,
          ));
          return Object.freeze({
            kind: "settled" as const,
            settlement: settlementSnapshot(input, workState, settledAt),
            operationUsage: freezeUsage(usage),
          });
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => closeRun(state, activeRuns))
          ),
          Effect.onInterrupt(() =>
            Effect.sync(() => closeRun(state, activeRuns))
          ),
          Effect.ensuring(Effect.sync(() => {
            workState.closed = true;
          })),
        ),
    ));

  const observeCommandDecision = Effect.fn(
    "DeclarativeV2.verifierProgressV2.observeCommandDecision",
  )(function* (rawInput: unknown, rawBudget: unknown) {
    const start = monotonicMilliseconds();
    const budget = yield* Effect.fromResult(
      decodeOperationBudget("observeCommandDecision", rawBudget),
    );
    const usage = mutableUsage();
    const capturedInput = yield* Effect.fromResult(
      captureCommandDecisionSelector(rawInput),
    );
    let terminalProofSha256: Uint8Array | undefined;
    if (capturedInput.terminalProofBytes !== undefined) {
      const terminalProof = decodeDeclarativeV2TerminalAuthorityProofV1(
        capturedInput.terminalProofBytes,
      );
      if (
        Result.isFailure(terminalProof) ||
        terminalProof.success.proof.sequence !== capturedInput.sequence ||
        !bytesEqualFullScan(
          terminalProof.success.proof.reservationSha256,
          capturedInput.reservationSha256,
        )
      ) {
        return yield* inputError("observeCommandDecision", "invalidInput");
      }
      for (const dimension of ["frameBytes", "canonicalBytes", "hashBytes"] as const) {
        chargeOrThrow(
          "observeCommandDecision",
          budget,
          usage,
          dimension,
          capturedInput.terminalProofBytes.byteLength,
        );
      }
      terminalProofSha256 = yield* sha256(capturedInput.terminalProofBytes, {
        maximumInputBytes: capturedInput.terminalProofBytes.byteLength,
      });
    }
    const input: typeof capturedInput & {
      readonly terminalProofSha256?: Uint8Array;
    } = terminalProofSha256 === undefined
      ? capturedInput
      : Object.freeze({
        ...capturedInput,
        terminalProofSha256,
      });
    const rows = yield* loadCommandDecisionRows(
      target,
      input,
      budget,
      usage,
      options.observeQuery,
    );
    const decision = rows === null
      ? Object.freeze({ kind: "missing" as const })
      : yield* decodeCommandDecision(
        rows,
        input,
        budget,
        sha256,
      );
    yield* Effect.fromResult(setElapsed(
      "observeCommandDecision",
      budget,
      usage,
      start,
      monotonicMilliseconds,
    ));
    return Object.freeze({
      decision,
      operationUsage: freezeUsage(usage),
    });
  });

  const release = Effect.fn("DeclarativeV2.verifierProgressV2.release")(
    (run: DeclarativeV2VerifierProgressRunV2, rawBudget: unknown) =>
      withRun(runs, run, "release", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("release", rawBudget),
          );
          const usage = mutableUsage();
          yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "release",
            state.scopeId,
            state.attemptSha256,
            budget,
            usage,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const locked = await lockAttemptMetadata(
                tx,
                "release",
                state.scopeId,
                state.attemptSha256,
                budget,
                usage,
                options.observeQuery,
              );
              requireLiveOwner("release", locked, state);
              if (locked.pendingKind !== null) {
                throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
                  operation: "release",
                  reason: "pendingExists",
                });
              }
              requireElapsedOrThrow(
                "release",
                budget,
                usage,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("release", budget, usage, 1);
              const query = tx
                .update(fxSystemDeclarativeV2VerifierAttemptsV2)
                .set({
                  writerOwnerId: null,
                  leaseUpdatedAt: null,
                  leaseExpiresAt: null,
                  updatedAt: locked.databaseNow,
                })
                .where(ownerWhere(state))
                .returning({
                  attemptSha256:
                    fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
                });
              observeDrizzleQuery("releaseAttempt", query, options.observeQuery);
              const rows = await runStatement(() => query);
              requireOneRow("release", rows.length);
            },
          ).pipe(closeRunOnFailure(state, activeRuns));
          closeRun(state, activeRuns);
          return Object.freeze({
            kind: "released" as const,
            operationUsage: freezeUsage(usage),
          });
        }))
  );

  const abandon = Effect.fn("DeclarativeV2.verifierProgressV2.abandon")(
    (run: DeclarativeV2VerifierProgressRunV2, rawBudget: unknown) =>
      withRun(runs, run, "abandon", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("abandon", rawBudget),
          );
          const usage = mutableUsage();
          yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "abandon",
            state.scopeId,
            state.attemptSha256,
            budget,
            usage,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const locked = await lockAttemptMetadata(
                tx,
                "abandon",
                state.scopeId,
                state.attemptSha256,
                budget,
                usage,
                options.observeQuery,
              );
              requireLiveOwner("abandon", locked, state);
              requireElapsedOrThrow(
                "abandon",
                budget,
                usage,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("abandon", budget, usage, 1);
              const query = tx
                .update(fxSystemDeclarativeV2VerifierAttemptsV2)
                .set({
                  lifecycle: "abandoned",
                  writerOwnerId: null,
                  leaseUpdatedAt: null,
                  leaseExpiresAt: null,
                  pendingKind: null,
                  pendingSequence: null,
                  pendingReservationSha256: null,
                  pendingReservedByFence: null,
                  pendingStartedAt: null,
                  updatedAt: locked.databaseNow,
                })
                .where(ownerWhere(state))
                .returning({
                  attemptSha256:
                    fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
                });
              observeDrizzleQuery("abandonAttempt", query, options.observeQuery);
              const rows = await runStatement(() => query);
              requireOneRow("abandon", rows.length);
            },
          ).pipe(closeRunOnFailure(state, activeRuns));
          closeRun(state, activeRuns);
          return Object.freeze({
            kind: "abandoned" as const,
            operationUsage: freezeUsage(usage),
          });
        }))
  );

  return Object.freeze({
    configuration,
    createAttempt,
    observeAttempt,
    acquire,
    renew,
    reserveCommand,
    resumePending,
    appendEvidencePage,
    readEvidencePageBatch,
    readSettledEvidencePageBatch,
    settleCommand,
    observeCommandDecision,
    release,
    abandon,
  });
}

function captureConfiguration(
  input: DeclarativeV2VerifierProgressRepositoryOptionsV2,
): Result.Result<
  Readonly<{ readonly claimDurationMilliseconds: number }>,
  DeclarativeV2VerifierProgressRepositoryConfigurationV2Error
> {
  if (
    !isNonNegativeSafeInteger(input.claimDurationMilliseconds) ||
    input.claimDurationMilliseconds < 1
  ) {
    return Result.fail(
      new DeclarativeV2VerifierProgressRepositoryConfigurationV2Error({
        reason: "invalidClaimDuration",
      }),
    );
  }
  return Result.succeed(Object.freeze({
    claimDurationMilliseconds: input.claimDurationMilliseconds,
  }));
}

function configurationOrThrow(
  configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    DeclarativeV2VerifierProgressRepositoryConfigurationV2Error
  >,
): Readonly<{ readonly claimDurationMilliseconds: number }> {
  if (Result.isFailure(configuration)) throw configuration.failure;
  return configuration.success;
}

function captureOwnerId(
  randomUuid: () => string,
): Result.Result<string, DeclarativeV2VerifierProgressRepositoryInputV2Error> {
  const value: unknown = randomUuid();
  return typeof value === "string" && isLowercaseUuidText(value)
    ? Result.succeed(value)
    : Result.fail(inputError("acquire", "invalidInput"));
}

function captureCreateInput(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierProgressCreateAttemptInputV2 & {
    readonly scopeId: ScopeId;
  },
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    const record = yield* captureExactRecord(
      "createAttempt",
      input,
      ["scopeId", "candidateSha256", "ceilings"],
    );
    const scopeId = yield* decodeScopeId("createAttempt", record.scopeId);
    if (!isUint8ArrayWithByteLength(record.candidateSha256, 32)) {
      return yield* Result.fail(inputError("createAttempt", "invalidInput"));
    }
    return Object.freeze({
      scopeId,
      candidateSha256: new Uint8Array(record.candidateSha256),
      ceilings: record.ceilings as DeclarativeV2VerifierBudgetFrameV2 & {
        readonly kind: "attempt_ceilings";
      },
    });
  });
}

function captureSelector(
  operation: "observeAttempt" | "acquire",
  rawScopeId: unknown,
  rawAttemptSha256: unknown,
): Result.Result<
  Readonly<{ readonly scopeId: ScopeId; readonly attemptSha256: Uint8Array }>,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    const scopeId = yield* decodeScopeId(operation, rawScopeId);
    if (!isUint8ArrayWithByteLength(rawAttemptSha256, 32)) {
      return yield* Result.fail(inputError(operation, "invalidInput"));
    }
    return Object.freeze({
      scopeId,
      attemptSha256: new Uint8Array(rawAttemptSha256),
    });
  });
}

function captureCommandDecisionSelector(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierProgressObserveCommandDecisionInputV2 & {
    readonly scopeId: ScopeId;
  },
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    let hasTerminalProof = false;
    try {
      hasTerminalProof = isNonArrayRecord(input) &&
        Object.hasOwn(input, "terminalProofBytes");
    } catch {
      return yield* Result.fail(
        inputError("observeCommandDecision", "invalidInput"),
      );
    }
    const record = yield* captureExactRecord(
      "observeCommandDecision",
      input,
      hasTerminalProof
        ? [
          "scopeId",
          "attemptSha256",
          "sequence",
          "reservationSha256",
          "terminalProofBytes",
        ]
        : ["scopeId", "attemptSha256", "sequence", "reservationSha256"],
    );
    const scopeId = yield* decodeScopeId(
      "observeCommandDecision",
      record.scopeId,
    );
    if (
      !isUint8ArrayWithByteLength(record.attemptSha256, 32) ||
      typeof record.sequence !== "bigint" ||
      record.sequence < 1n ||
      record.sequence > MAX_SIGNED_INT64 ||
      !isUint8ArrayWithByteLength(record.reservationSha256, 32)
      || (
        hasTerminalProof &&
        !isUint8Array(record.terminalProofBytes)
      )
    ) {
      return yield* Result.fail(
        inputError("observeCommandDecision", "invalidInput"),
      );
    }
    return Object.freeze({
      scopeId,
      attemptSha256: new Uint8Array(record.attemptSha256),
      sequence: record.sequence,
      reservationSha256: new Uint8Array(record.reservationSha256),
      ...(hasTerminalProof
        ? { terminalProofBytes: new Uint8Array(
          record.terminalProofBytes as Uint8Array,
        ) }
        : {}),
    });
  });
}

function decodeScopeId(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  input: unknown,
): Result.Result<
  ScopeId,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Schema.decodeUnknownResult(ScopeIdSchema)(input).pipe(
    Result.mapError(() => inputError(operation, "invalidInput")),
  );
}

function captureExactRecord(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  input: unknown,
  keys: readonly string[],
): Result.Result<
  Readonly<Record<string, unknown>>,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Result.fail(inputError(operation, "invalidInput"));
  }
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(input);
  } catch {
    return Result.fail(inputError(operation, "invalidInput"));
  }
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key, index) => key !== keys[index])
  ) {
    return Result.fail(inputError(operation, "invalidInput"));
  }
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      return Result.fail(inputError(operation, "invalidInput"));
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return Result.fail(inputError(operation, "invalidInput"));
    }
    captured[key] = descriptor.value;
  }
  return Result.succeed(Object.freeze(captured));
}

function decodeOperationBudget(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    const record = yield* captureExactRecord(operation, input, [
      "maximumCalls",
      "maximumRows",
      "maximumFrameBytes",
      "maximumCanonicalBytes",
      "maximumHashBytes",
      "maximumElapsedMilliseconds",
    ]);
    const maximumCalls = record.maximumCalls;
    const maximumRows = record.maximumRows;
    const maximumFrameBytes = record.maximumFrameBytes;
    const maximumCanonicalBytes = record.maximumCanonicalBytes;
    const maximumHashBytes = record.maximumHashBytes;
    const maximumElapsedMilliseconds = record.maximumElapsedMilliseconds;
    const values = [
      maximumCalls,
      maximumRows,
      maximumFrameBytes,
      maximumCanonicalBytes,
      maximumHashBytes,
      maximumElapsedMilliseconds,
    ];
    if (
      values.some(value =>
        typeof value !== "number" || !isNonNegativeSafeInteger(value)
      )
    ) {
      return yield* Result.fail(inputError(operation, "invalidBudget"));
    }
    if (
      typeof maximumCalls !== "number" ||
      typeof maximumRows !== "number" ||
      typeof maximumFrameBytes !== "number" ||
      typeof maximumCanonicalBytes !== "number" ||
      typeof maximumHashBytes !== "number" ||
      typeof maximumElapsedMilliseconds !== "number"
    ) {
      return yield* Result.fail(inputError(operation, "invalidBudget"));
    }
    return Object.freeze({
      maximumCalls,
      maximumRows,
      maximumFrameBytes,
      maximumCanonicalBytes,
      maximumHashBytes,
      maximumElapsedMilliseconds,
    });
  });
}

function decodePageOperationBudget(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    const record = yield* captureExactRecord(operation, input, [
      "maximumCalls",
      "maximumRows",
      "maximumFrameBytes",
      "maximumCanonicalBytes",
      "maximumHashBytes",
      "maximumElapsedMilliseconds",
      "maximumPages",
      "maximumPayloadBytes",
    ]);
    const maximumCalls = record.maximumCalls;
    const maximumRows = record.maximumRows;
    const maximumFrameBytes = record.maximumFrameBytes;
    const maximumCanonicalBytes = record.maximumCanonicalBytes;
    const maximumHashBytes = record.maximumHashBytes;
    const maximumElapsedMilliseconds = record.maximumElapsedMilliseconds;
    const maximumPages = record.maximumPages;
    const maximumPayloadBytes = record.maximumPayloadBytes;
    if (
      !isNonNegativeSafeInteger(maximumCalls) ||
      !isNonNegativeSafeInteger(maximumRows) ||
      !isNonNegativeSafeInteger(maximumFrameBytes) ||
      !isNonNegativeSafeInteger(maximumCanonicalBytes) ||
      !isNonNegativeSafeInteger(maximumHashBytes) ||
      !isNonNegativeSafeInteger(maximumElapsedMilliseconds) ||
      !isNonNegativeSafeInteger(maximumPages) ||
      maximumPages < 1 ||
      maximumPages > 1_024 ||
      !isNonNegativeSafeInteger(maximumPayloadBytes)
    ) {
      return yield* Result.fail(inputError(operation, "invalidBudget"));
    }
    return Object.freeze({
      maximumCalls,
      maximumRows,
      maximumFrameBytes,
      maximumCanonicalBytes,
      maximumHashBytes,
      maximumElapsedMilliseconds,
      maximumPages,
      maximumPayloadBytes,
    });
  });
}

function mutableUsage(): MutableOperationUsageV2 {
  return {
    calls: 0,
    rows: 0,
    frameBytes: 0,
    canonicalBytes: 0,
    hashBytes: 0,
    elapsedMilliseconds: 0,
  };
}

function mutablePageUsage(): MutablePageOperationUsageV2 {
  return {
    ...mutableUsage(),
    pages: 0,
    payloadBytes: 0,
  };
}

function freezeUsage(
  usage: MutableOperationUsageV2,
): DeclarativeV2VerifierProgressRepositoryOperationUsageV2 {
  return Object.freeze({ ...usage });
}

function freezePageUsage(
  usage: MutablePageOperationUsageV2,
): DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2 {
  return Object.freeze({ ...usage });
}

function chargePageDimension(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  dimension: "pages" | "payloadBytes",
  amount: number,
): Result.Result<void, DeclarativeV2VerifierProgressRepositoryInputV2Error> {
  const maximum = dimension === "pages"
    ? budget.maximumPages
    : budget.maximumPayloadBytes;
  if (!isNonNegativeSafeInteger(amount)) {
    return Result.fail(inputError(
      operation,
      "budgetExceeded",
      dimension,
      Number.MAX_SAFE_INTEGER,
      maximum,
    ));
  }
  const observed = usage[dimension] > Number.MAX_SAFE_INTEGER - amount
    ? Number.MAX_SAFE_INTEGER
    : usage[dimension] + amount;
  if (observed > maximum) {
    return Result.fail(
      inputError(operation, "budgetExceeded", dimension, observed, maximum),
    );
  }
  usage[dimension] = observed;
  return Result.succeed(undefined);
}

function chargePageDimensionOrThrow(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  dimension: "pages" | "payloadBytes",
  amount: number,
): void {
  const result = chargePageDimension(
    operation,
    budget,
    usage,
    dimension,
    amount,
  );
  if (Result.isFailure(result)) {
    throw new RepositoryBudgetFailureV2(result.failure);
  }
}

function charge(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  dimension: keyof DeclarativeV2VerifierProgressRepositoryOperationUsageV2,
  amount: number,
): Result.Result<void, DeclarativeV2VerifierProgressRepositoryInputV2Error> {
  if (!isNonNegativeSafeInteger(amount)) {
    return Result.fail(inputError(
      operation,
      "budgetExceeded",
      dimension,
      Number.MAX_SAFE_INTEGER,
      budget[OPERATION_MAXIMUM[dimension]],
    ));
  }
  const observed = usage[dimension] > Number.MAX_SAFE_INTEGER - amount
    ? Number.MAX_SAFE_INTEGER
    : usage[dimension] + amount;
  const maximum = budget[OPERATION_MAXIMUM[dimension]];
  if (observed > maximum) {
    return Result.fail(inputError(
      operation,
      "budgetExceeded",
      dimension,
      observed,
      maximum,
    ));
  }
  usage[dimension] = observed;
  return Result.succeed(undefined);
}

function chargeOrThrow(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  dimension: keyof DeclarativeV2VerifierProgressRepositoryOperationUsageV2,
  amount: number,
): void {
  const result = charge(operation, budget, usage, dimension, amount);
  if (Result.isFailure(result)) {
    throw new RepositoryBudgetFailureV2(result.failure);
  }
}

function chargeSqlOrThrow(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  expectedRows: number,
): void {
  chargeOrThrow(operation, budget, usage, "calls", 1);
  chargeOrThrow(operation, budget, usage, "rows", expectedRows);
}

function setElapsed(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  start: number,
  monotonicMilliseconds: () => number,
): Result.Result<
  void,
  | DeclarativeV2VerifierProgressRepositoryConfigurationV2Error
  | DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  const now = monotonicMilliseconds();
  if (!Number.isFinite(start) || !Number.isFinite(now) || start < 0 || now < start) {
    return Result.fail(
      new DeclarativeV2VerifierProgressRepositoryConfigurationV2Error({
        reason: "invalidMonotonicClock",
      }),
    );
  }
  const elapsed = Math.ceil(now - start);
  usage.elapsedMilliseconds = 0;
  return charge(
    operation,
    budget,
    usage,
    "elapsedMilliseconds",
    elapsed,
  );
}

function requireElapsedOrThrow(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  start: number,
  monotonicMilliseconds: () => number,
): void {
  const result = setElapsed(
    operation,
    budget,
    usage,
    start,
    monotonicMilliseconds,
  );
  if (Result.isFailure(result)) throw result.failure;
}

function inputError(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  reason: DeclarativeV2VerifierProgressRepositoryInputV2Error["reason"],
  dimension?:
    keyof DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2,
  observed?: number,
  maximum?: number,
  codecCause?: DeclarativeV2VerifierProgressV2Error,
): DeclarativeV2VerifierProgressRepositoryInputV2Error {
  return new DeclarativeV2VerifierProgressRepositoryInputV2Error({
    operation,
    reason,
    ...(dimension === undefined ? {} : { dimension }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(codecCause === undefined ? {} : { codecCause }),
  });
}

function corruption(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  reason: DeclarativeV2VerifierProgressRepositoryCorruptionV2Error["reason"],
  storedCause?: DeclarativeV2VerifierProgressV2StoredRowError,
): DeclarativeV2VerifierProgressRepositoryCorruptionV2Error {
  return new DeclarativeV2VerifierProgressRepositoryCorruptionV2Error({
    operation,
    reason,
    ...(storedCause === undefined ? {} : { storedCause }),
  });
}

function stale(
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt"
  >,
  reason: DeclarativeV2VerifierProgressRepositoryStaleV2Error["reason"],
): DeclarativeV2VerifierProgressRepositoryStaleV2Error {
  return new DeclarativeV2VerifierProgressRepositoryStaleV2Error({
    operation,
    reason,
  });
}

function lifecycleError(
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt"
  >,
  lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): DeclarativeV2VerifierProgressRepositoryLifecycleV2Error {
  return new DeclarativeV2VerifierProgressRepositoryLifecycleV2Error({
    operation,
    lifecycle,
    phase,
  });
}

function remainingInertBudget(
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
) {
  return Object.freeze({
    maximumCalls: Math.max(0, budget.maximumCalls - usage.calls),
    maximumFrameBytes: Math.max(0, budget.maximumFrameBytes - usage.frameBytes),
    maximumCanonicalBytes:
      Math.max(0, budget.maximumCanonicalBytes - usage.canonicalBytes),
    maximumHashBytes: Math.max(0, budget.maximumHashBytes - usage.hashBytes),
  });
}

function mergeInertUsage(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  inert: Readonly<{
    readonly calls: number;
    readonly frameBytes: number;
    readonly canonicalBytes: number;
    readonly hashBytes: number;
  }>,
): Result.Result<void, DeclarativeV2VerifierProgressRepositoryInputV2Error> {
  return Result.gen(function* () {
    yield* charge(operation, budget, usage, "calls", inert.calls);
    yield* charge(operation, budget, usage, "frameBytes", inert.frameBytes);
    yield* charge(
      operation,
      budget,
      usage,
      "canonicalBytes",
      inert.canonicalBytes,
    );
    yield* charge(operation, budget, usage, "hashBytes", inert.hashBytes);
  });
}

function captureFrame<
  Kind extends DeclarativeV2VerifierProgressFrameV2["kind"],
>(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  input: unknown,
  expectedKind: Kind,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  CapturedFrameV2<
    Extract<DeclarativeV2VerifierProgressFrameV2, { readonly kind: Kind }>
  >,
  | DeclarativeV2VerifierProgressRepositoryInputV2Error
  | DeclarativeV2Sha256V1Error
> {
  return Effect.gen(function* () {
    const remainingFrame = Math.max(0, budget.maximumFrameBytes - usage.frameBytes);
    const remainingCanonical = Math.max(
      0,
      budget.maximumCanonicalBytes - usage.canonicalBytes,
    );
    const encoded = yield* Effect.fromResult(
      encodeDeclarativeV2VerifierProgressFrameV2(input, {
        maximumFrameBytes: remainingFrame,
        maximumCanonicalBytes: remainingCanonical,
      }).pipe(
        Result.mapError(codecCause =>
          inputError(operation, "invalidInput", undefined, undefined, undefined, codecCause)
        ),
      ),
    );
    if (encoded.frame.kind !== expectedKind) {
      return yield* inputError(operation, "invalidInput");
    }
    yield* Effect.fromResult(charge(
      operation,
      budget,
      usage,
      "frameBytes",
      encoded.usage.frameBytes,
    ));
    yield* Effect.fromResult(charge(
      operation,
      budget,
      usage,
      "canonicalBytes",
      encoded.usage.canonicalBytes,
    ));
    yield* Effect.fromResult(charge(
      operation,
      budget,
      usage,
      "hashBytes",
      encoded.canonicalBytes.byteLength,
    ));
    const digest = yield* sha256(encoded.canonicalBytes, {
      maximumInputBytes: encoded.canonicalBytes.byteLength,
    });
    return Object.freeze({
      frame: encoded.frame as Extract<
        DeclarativeV2VerifierProgressFrameV2,
        { readonly kind: Kind }
      >,
      bytes: new Uint8Array(encoded.canonicalBytes),
      sha256: new Uint8Array(digest),
    });
  });
}

function captureEvidencePageInput(
  input: unknown,
  work: MutableWorkStateV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  CapturedEvidencePageV2,
  | DeclarativeV2VerifierProgressRepositoryInputV2Error
  | DeclarativeV2Sha256V1Error
> {
  return Effect.gen(function* () {
    const record = yield* Effect.fromResult(
      captureExactRecord(
        "appendEvidencePage",
        input,
        ["manifestBytes", "payloadBytes"],
      ),
    );
    if (
      !isUint8Array(record.manifestBytes) ||
      record.manifestBytes.byteLength === 0 ||
      !isUint8Array(record.payloadBytes) ||
      record.payloadBytes.byteLength === 0
    ) {
      return yield* inputError("appendEvidencePage", "invalidInput");
    }
    const manifestLength = record.manifestBytes.byteLength;
    const payloadLength = record.payloadBytes.byteLength;
    yield* Effect.fromResult(chargePageDimension(
      "appendEvidencePage",
      budget,
      usage,
      "pages",
      1,
    ));
    yield* Effect.fromResult(chargePageDimension(
      "appendEvidencePage",
      budget,
      usage,
      "payloadBytes",
      payloadLength,
    ));
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierProgressFrameV2(
        record.manifestBytes,
        {
          maximumFrameBytes:
            Math.max(0, budget.maximumFrameBytes - usage.frameBytes),
          maximumCanonicalBytes:
            Math.max(0, budget.maximumCanonicalBytes - usage.canonicalBytes),
        },
      ).pipe(
        Result.mapError(codecCause =>
          inputError(
            "appendEvidencePage",
            "invalidInput",
            undefined,
            undefined,
            undefined,
            codecCause,
          )
        ),
      ),
    );
    if (decoded.frame.kind !== "evidence_page_manifest") {
      return yield* inputError("appendEvidencePage", "invalidInput");
    }
    yield* Effect.fromResult(charge(
      "appendEvidencePage",
      budget,
      usage,
      "frameBytes",
      decoded.usage.frameBytes,
    ));
    yield* Effect.fromResult(charge(
      "appendEvidencePage",
      budget,
      usage,
      "canonicalBytes",
      decoded.usage.canonicalBytes,
    ));
    yield* Effect.fromResult(charge(
      "appendEvidencePage",
      budget,
      usage,
      "hashBytes",
      manifestLength,
    ));
    yield* Effect.fromResult(charge(
      "appendEvidencePage",
      budget,
      usage,
      "hashBytes",
      payloadLength,
    ));
    const manifestBytes = new Uint8Array(decoded.canonicalBytes);
    const payloadBytes = new Uint8Array(record.payloadBytes);
    const manifestSha256 = yield* sha256(manifestBytes, {
      maximumInputBytes: manifestLength,
    });
    const payloadSha256 = yield* sha256(payloadBytes, {
      maximumInputBytes: payloadLength,
    });
    const manifest = decoded.frame;
    if (
      manifest.commandKind !== work.commandKind ||
      manifest.sequence !== work.sequence ||
      !bytesEqualFullScan(
        manifest.reservationSha256,
        work.reservationSha256,
      ) ||
      manifest.payloadByteLength !== BigInt(payloadLength) ||
      !bytesEqualFullScan(manifest.payloadSha256, payloadSha256)
    ) {
      return yield* inputError("appendEvidencePage", "commandMismatch");
    }
    return Object.freeze({
      manifest,
      manifestBytes,
      manifestSha256: new Uint8Array(manifestSha256),
      payloadBytes,
      payloadSha256: new Uint8Array(payloadSha256),
    });
  });
}

function captureReadEvidencePageBatchInput(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierProgressReadEvidencePageBatchInputV2,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    const record = yield* captureExactRecord(
      "readEvidencePageBatch",
      input,
      ["startPageOrdinal", "expectedPredecessorPageSha256"],
    );
    if (
      typeof record.startPageOrdinal !== "bigint" ||
      record.startPageOrdinal < 0n ||
      record.startPageOrdinal > MAX_SIGNED_INT64 ||
      (
        record.expectedPredecessorPageSha256 !== null &&
        !isUint8ArrayWithByteLength(
          record.expectedPredecessorPageSha256,
          32,
        )
      )
    ) {
      return yield* Result.fail(
        inputError("readEvidencePageBatch", "invalidInput"),
      );
    }
    return Object.freeze({
      startPageOrdinal: record.startPageOrdinal,
      expectedPredecessorPageSha256:
        record.expectedPredecessorPageSha256 === null
          ? null
          : new Uint8Array(record.expectedPredecessorPageSha256),
    });
  });
}

function captureReadSettledEvidencePageBatchInput(
  input: unknown,
): Result.Result<
  CapturedSettledEvidencePageBatchInputV2,
  DeclarativeV2VerifierProgressRepositoryInputV2Error
> {
  return Result.gen(function* () {
    const operation = "readSettledEvidencePageBatch" as const;
    const record = yield* captureExactRecord(operation, input, [
      "scopeId",
      "attemptSha256",
      "commandKind",
      "sequence",
      "reservationSha256",
      "outputManifestSha256",
      "receiptSha256",
      "startPageOrdinal",
      "expectedPredecessorPageSha256",
    ]);
    const scopeId = yield* decodeScopeId(operation, record.scopeId);
    if (
      !isUint8ArrayWithByteLength(record.attemptSha256, 32) ||
      (
        record.commandKind !== "parse_module" &&
        record.commandKind !== "link_page"
      ) ||
      typeof record.sequence !== "bigint" ||
      record.sequence < 1n ||
      record.sequence > MAX_SIGNED_INT64 ||
      !isUint8ArrayWithByteLength(record.reservationSha256, 32) ||
      !isUint8ArrayWithByteLength(record.outputManifestSha256, 32) ||
      !isUint8ArrayWithByteLength(record.receiptSha256, 32) ||
      typeof record.startPageOrdinal !== "bigint" ||
      record.startPageOrdinal < 0n ||
      record.startPageOrdinal > MAX_SIGNED_INT64 ||
      (
        record.expectedPredecessorPageSha256 !== null &&
        !isUint8ArrayWithByteLength(
          record.expectedPredecessorPageSha256,
          32,
        )
      )
    ) {
      return yield* Result.fail(inputError(operation, "invalidInput"));
    }
    return Object.freeze({
      scopeId,
      attemptSha256: new Uint8Array(record.attemptSha256),
      commandKind: record.commandKind,
      sequence: record.sequence,
      reservationSha256: new Uint8Array(record.reservationSha256),
      outputManifestSha256:
        new Uint8Array(record.outputManifestSha256),
      receiptSha256: new Uint8Array(record.receiptSha256),
      startPageOrdinal: record.startPageOrdinal,
      expectedPredecessorPageSha256:
        record.expectedPredecessorPageSha256 === null
          ? null
          : new Uint8Array(record.expectedPredecessorPageSha256),
    });
  });
}

function zeroBudgetFrame(
  kind: "attempt_usage",
): DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" } {
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        0n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
}

function addBudgetFrames(
  usage: DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" },
  command: DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" },
  ceilings: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_ceilings";
  },
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" },
  DeclarativeV2VerifierProgressRepositoryExhaustionV2Error
> {
  const result: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>> =
    {};
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const left = usage[dimension];
    const right = command[dimension];
    if (left > MAX_SIGNED_INT64 - right) {
      return Result.fail(
        new DeclarativeV2VerifierProgressRepositoryExhaustionV2Error({
          operation: "reserveCommand",
          dimension,
          observed: MAX_SIGNED_INT64,
          maximum: ceilings[dimension],
        }),
      );
    }
    const observed = left + right;
    if (observed > ceilings[dimension]) {
      return Result.fail(
        new DeclarativeV2VerifierProgressRepositoryExhaustionV2Error({
          operation: "reserveCommand",
          dimension,
          observed,
          maximum: ceilings[dimension],
        }),
      );
    }
    result[dimension] = observed;
  }
  return Result.succeed(Object.freeze({
    kind: "attempt_usage",
    ...result,
  }) as DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" });
}

function captureReserveInput(
  operation: "reserveCommand" | "resumePending",
  input: unknown,
  state: MutableRunStateV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
) {
  return Effect.gen(function* () {
    const authenticatedRecord = captureExactRecord(
      operation,
      input,
      ["reservation", "commandBudget", "authority"],
    );
    const record = Result.isSuccess(authenticatedRecord)
      ? authenticatedRecord.success
      : yield* Effect.fromResult(captureExactRecord(
        operation,
        input,
        ["reservation", "commandBudget"],
      ));
    const commandBudget = yield* captureFrame(
      operation,
      record.commandBudget,
      "command_budget",
      budget,
      usage,
      sha256,
    );
    const reservation = yield* captureFrame(
      operation,
      record.reservation,
      "command_reservation",
      budget,
      usage,
      sha256,
    );
    if (
      !bytesEqualFullScan(
        reservation.frame.commandBudgetSha256,
        commandBudget.sha256,
      ) ||
      !bytesEqualFullScan(
        reservation.frame.attemptSha256,
        state.attemptSha256,
      ) ||
      !bytesEqualFullScan(
        reservation.frame.candidateSha256,
        state.attempt.candidateSha256,
      )
    ) {
      return yield* inputError(operation, "commandMismatch");
    }
    const authority = Object.hasOwn(record, "authority")
      ? yield* captureCommandAuthority(
        operation,
        record.authority,
        reservation,
        budget,
        usage,
        sha256,
      )
      : null;
    return Object.freeze({ reservation, commandBudget, authority });
  });
}

function captureCommandAuthority(
  operation: "reserveCommand" | "resumePending",
  input: unknown,
  capturedReservation:
    CapturedFrameV2<DeclarativeV2VerifierCommandReservationFrameV2>,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  CapturedCommandAuthorityV1,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  return Effect.gen(function* () {
    const reservation = capturedReservation.frame;
    const record = yield* Effect.fromResult(captureExactRecord(
      operation,
      input,
      ["futureRegistrationIntentBytes"],
    ));
    const rawBytes = record.futureRegistrationIntentBytes;
    if (rawBytes === null) {
      if (
        reservation.commandKind === "link_page" ||
        reservation.commandKind === "registration_page"
      ) {
        return yield* inputError(operation, "commandMismatch");
      }
      return Object.freeze({ futureRegistrationIntent: null });
    }
    if (!isUint8Array(rawBytes)) {
      return yield* inputError(operation, "invalidInput");
    }
    const decoded = decodeDeclarativeV2FutureRegistrationIntentV1(rawBytes);
    if (Result.isFailure(decoded)) {
      return yield* inputError(operation, "commandMismatch");
    }
    const bytes = new Uint8Array(decoded.success.canonicalBytes);
    chargeOrThrow(operation, budget, usage, "frameBytes", bytes.byteLength);
    chargeOrThrow(operation, budget, usage, "canonicalBytes", bytes.byteLength);
    chargeOrThrow(operation, budget, usage, "hashBytes", bytes.byteLength);
    const intentSha256 = yield* sha256(bytes, {
      maximumInputBytes: bytes.byteLength,
    });
    const intent = decoded.success.intent;
    const commonMatches =
      bytesEqualFullScan(intent.attemptSha256, reservation.attemptSha256) &&
      bytesEqualFullScan(intent.candidateSha256, reservation.candidateSha256) &&
      bytesEqualFullScan(
        intent.analyzerIdentitySha256,
        reservation.analyzerIdentitySha256,
      ) &&
      bytesEqualFullScan(
        intent.verifierIdentitySha256,
        reservation.verifierIdentitySha256,
      );
    const commandMatches = reservation.commandKind === "link_page"
      ? intent.linkSequence === reservation.sequence &&
        bytesEqualFullScan(
          intent.linkReservationSha256,
          capturedReservation.sha256,
        )
      : reservation.commandKind === "registration_page" &&
        intent.registrationSequence === reservation.sequence &&
        bytesEqualFullScan(
          intent.registrationCurrentProgressSha256,
          reservation.currentProgressSha256,
        ) &&
        bytesEqualFullScan(
          intent.registrationCommandBudgetSha256,
          reservation.commandBudgetSha256,
        ) &&
        bytesEqualFullScan(
          intent.registrationCommandInputSha256,
          reservation.commandInputSha256,
        ) &&
        bytesEqualFullScan(
          intent.freshAuthenticatedInputSha256,
          reservation.freshAuthenticatedInputSha256,
        );
    if (!commonMatches || !commandMatches) {
      return yield* inputError(operation, "commandMismatch");
    }
    return Object.freeze({
      futureRegistrationIntent: Object.freeze({
        intent,
        bytes,
        sha256: new Uint8Array(intentSha256),
      }),
    });
  });
}

const captureSettlementInput = Effect.fn(
  "DeclarativeV2.verifierProgressV2.captureSettlementInput",
)(function* (
  input: unknown,
  runState: MutableRunStateV2,
  workState: MutableWorkStateV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
) {
  const authenticatedRecord = captureExactRecord(
    "settleCommand",
    input,
    [
      "outputManifest",
      "commandUsage",
      "resultingUsage",
      "nextProgress",
      "receipt",
      "authority",
    ],
  );
  const record = Result.isSuccess(authenticatedRecord)
    ? authenticatedRecord.success
    : yield* Effect.fromResult(captureExactRecord(
      "settleCommand",
      input,
      [
        "outputManifest",
        "commandUsage",
        "resultingUsage",
        "nextProgress",
        "receipt",
      ],
    ));
    const outputManifest = yield* captureFrame(
      "settleCommand",
      record.outputManifest,
      "command_output_manifest",
      budget,
      usage,
      sha256,
    );
    const commandUsage = yield* captureFrame(
      "settleCommand",
      record.commandUsage,
      "command_budget",
      budget,
      usage,
      sha256,
    );
    const resultingUsage = yield* captureFrame(
      "settleCommand",
      record.resultingUsage,
      "attempt_usage",
      budget,
      usage,
      sha256,
    );
    const nextProgress = yield* captureFrame(
      "settleCommand",
      record.nextProgress,
      "progress_cursor",
      budget,
      usage,
      sha256,
    );
    const receipt = yield* captureFrame(
      "settleCommand",
      record.receipt,
      "command_receipt",
      budget,
      usage,
      sha256,
    );
    if (
      !bytesEqualFullScan(
        outputManifest.frame.reservationSha256,
        workState.reservationSha256,
      ) ||
      outputManifest.frame.commandKind !== workState.commandKind ||
      outputManifest.frame.sequence !== workState.sequence ||
      !bytesEqualFullScan(
        outputManifest.frame.nextProgressSha256,
        nextProgress.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.reservationSha256,
        workState.reservationSha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.commandUsageSha256,
        commandUsage.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.resultingAttemptUsageSha256,
        resultingUsage.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.outputManifestSha256,
        outputManifest.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.nextProgressSha256,
        nextProgress.sha256,
      ) ||
      nextProgress.frame.settledSequence !== workState.sequence ||
      !optionalDigestEqual(
        nextProgress.frame.previousReceiptSha256,
        workState.reservation.predecessorReceiptSha256,
      ) ||
      !budgetFrameWithin(commandUsage.frame, workState.commandBudget) ||
      !budgetFramesEqual(resultingUsage.frame, runState.attempt.usage) ||
      !bytesEqualFullScan(resultingUsage.sha256, runState.usageSha256)
    ) {
      return yield* inputError("settleCommand", "commandMismatch");
    }
    const authority = Object.hasOwn(record, "authority")
      ? yield* captureTerminalAuthority(
        record.authority,
        runState,
        workState,
        outputManifest,
        commandUsage,
        nextProgress,
        receipt,
        budget,
        usage,
        sha256,
      )
      : null;
    if (
      (workState.authenticatedAuthority === null) !==
        (authority === null)
    ) {
      return yield* inputError("settleCommand", "commandMismatch");
    }
    const nextLifecycle = deriveNextLifecycle(
      runState.attempt.lifecycle,
      runState.attempt.progress.phase,
      workState.commandKind,
      nextProgress.frame.phase,
    );
    if (nextLifecycle === undefined) {
      return yield* inputError("settleCommand", "commandMismatch");
    }
  return Object.freeze({
    outputManifest,
    commandUsage,
    resultingUsage,
    nextProgress,
    receipt,
    authority,
    nextLifecycle,
  });
});

function captureTerminalAuthority(
  input: unknown,
  runState: MutableRunStateV2,
  workState: MutableWorkStateV2,
  outputManifest: CapturedFrameV2<
    DeclarativeV2VerifierCommandOutputManifestFrameV2
  >,
  commandUsage: CapturedFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" }
  >,
  nextProgress: CapturedFrameV2<
    DeclarativeV2VerifierProgressCursorFrameV2
  >,
  receipt: CapturedFrameV2<DeclarativeV2VerifierCommandReceiptFrameV2>,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  CapturedTerminalAuthorityV1,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  return Effect.gen(function* () {
    if (workState.authenticatedAuthority === null) {
      return yield* inputError("settleCommand", "commandMismatch");
    }
    const record = yield* Effect.fromResult(captureExactRecord(
      "settleCommand",
      input,
      ["terminalProofBytes"],
    ));
    if (!isUint8Array(record.terminalProofBytes)) {
      return yield* inputError("settleCommand", "invalidInput");
    }
    const decoded = decodeDeclarativeV2TerminalAuthorityProofV1(
      record.terminalProofBytes,
    );
    if (Result.isFailure(decoded)) {
      return yield* inputError("settleCommand", "commandMismatch");
    }
    const bytes = new Uint8Array(decoded.success.canonicalBytes);
    chargeOrThrow("settleCommand", budget, usage, "frameBytes", bytes.byteLength);
    chargeOrThrow(
      "settleCommand",
      budget,
      usage,
      "canonicalBytes",
      bytes.byteLength,
    );
    chargeOrThrow("settleCommand", budget, usage, "hashBytes", bytes.byteLength);
    const proofSha256 = yield* sha256(bytes, {
      maximumInputBytes: bytes.byteLength,
    });
    const proof = decoded.success.proof;
    const intent = workState.authenticatedAuthority.futureRegistrationIntent;
    const expectedIntent = intent === null ? null : intent.sha256;
    const expectedAuthorityKind = workState.commandKind === "source_page"
      ? "exact_requirement"
      : "capacity";
    const lineageMatches =
      proof.authorityKind === expectedAuthorityKind &&
      proof.commandKind === workState.commandKind &&
      proof.sequence === workState.sequence &&
      bytesEqualFullScan(proof.attemptSha256, runState.attemptSha256) &&
      bytesEqualFullScan(
        proof.candidateSha256,
        runState.attempt.candidateSha256,
      ) &&
      bytesEqualFullScan(
        proof.reservationSha256,
        workState.reservationSha256,
      ) &&
      optionalDigestEqual(
        proof.futureRegistrationIntentSha256,
        expectedIntent,
      ) &&
      (
        intent === null ||
        bytesEqualFullScan(
          proof.analyzerReleaseSha256,
          intent.intent.analyzerReleaseSha256,
        )
      ) &&
      bytesEqualFullScan(
        proof.commandBudgetSha256,
        workState.reservation.commandBudgetSha256,
      ) &&
      bytesEqualFullScan(
        proof.commandInputSha256,
        workState.reservation.commandInputSha256,
      ) &&
      bytesEqualFullScan(
        proof.freshAuthenticatedInputSha256,
        workState.reservation.freshAuthenticatedInputSha256,
      ) &&
      bytesEqualFullScan(
        proof.rangeAndPredecessorTailsSha256,
        workState.reservation.rangeAndPredecessorTailsSha256,
      ) &&
      bytesEqualFullScan(
        proof.analyzerIdentitySha256,
        workState.reservation.analyzerIdentitySha256,
      ) &&
      bytesEqualFullScan(
        proof.verifierIdentitySha256,
        workState.reservation.verifierIdentitySha256,
      ) &&
      bytesEqualFullScan(
        proof.currentProgressSha256,
        workState.reservation.currentProgressSha256,
      ) &&
      optionalDigestEqual(
        proof.predecessorReceiptSha256,
        workState.reservation.predecessorReceiptSha256,
      ) &&
      bytesEqualFullScan(
        proof.nextProgressSha256,
        nextProgress.sha256,
      ) &&
      bytesEqualFullScan(
        proof.outputManifestSha256,
        outputManifest.sha256,
      ) &&
       bytesEqualFullScan(proof.receiptSha256, receipt.sha256) &&
       DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.every(dimension =>
         proof.actual[dimension] === commandUsage.frame[dimension] &&
         proof.authority[dimension] <= workState.commandBudget[dimension] &&
         (proof.authorityKind !== "exact_requirement" ||
           proof.authority[dimension] === proof.actual[dimension])
       );
    if (!lineageMatches) {
      return yield* inputError("settleCommand", "commandMismatch");
    }
    return Object.freeze({
      proof,
      bytes,
      sha256: new Uint8Array(proofSha256),
    });
  });
}

function budgetFrameWithin(
  actual: DeclarativeV2VerifierBudgetFrameV2,
  reserved: DeclarativeV2VerifierBudgetFrameV2,
): boolean {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (actual[dimension] > reserved[dimension]) return false;
  }
  return true;
}

function budgetFramesEqual(
  left: DeclarativeV2VerifierBudgetFrameV2,
  right: DeclarativeV2VerifierBudgetFrameV2,
): boolean {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (left[dimension] !== right[dimension]) return false;
  }
  return true;
}

function deriveNextLifecycle(
  currentLifecycle:
    DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  currentPhase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  nextPhase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"] | undefined {
  switch (commandKind) {
    case "source_page":
      if (currentLifecycle !== "open" || currentPhase !== "source") {
        return undefined;
      }
      return nextPhase === "source"
        ? "open"
        : nextPhase === "parse" ? "parsing" : undefined;
    case "parse_module":
      if (currentLifecycle !== "parsing" || currentPhase !== "parse") {
        return undefined;
      }
      return nextPhase === "parse"
        ? "parsing"
        : nextPhase === "link" ? "parse_complete" : undefined;
    case "link_page":
      if (
        (currentLifecycle !== "parse_complete" &&
          currentLifecycle !== "linking") ||
        currentPhase !== "link"
      ) {
        return undefined;
      }
      return nextPhase === "link"
        ? "linking"
        : nextPhase === "registration" ? "link_complete" : undefined;
    case "registration_page":
      if (
        (currentLifecycle !== "link_complete" &&
          currentLifecycle !== "registering") ||
        currentPhase !== "registration"
      ) {
        return undefined;
      }
      return nextPhase === "registration" || nextPhase === "verdict"
        ? "registering"
        : undefined;
  }
}

function captureResultingUsage(
  state: MutableRunStateV2,
  commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  },
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
) {
  return Effect.gen(function* () {
    const projected = yield* Effect.fromResult(addBudgetFrames(
      state.attempt.usage,
      commandBudget,
      state.attempt.ceilings,
    ));
    return yield* captureFrame(
      "reserveCommand",
      projected,
      "attempt_usage",
      budget,
      usage,
      sha256,
    );
  });
}

function requireReservationLineage(
  state: MutableRunStateV2,
  input: Readonly<{
    readonly reservation: CapturedFrameV2<
      DeclarativeV2VerifierCommandReservationFrameV2
    >;
    readonly commandBudget: CapturedFrameV2<
      DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" }
    >;
  }>,
): void {
  const reservation = input.reservation.frame;
  if (
    reservation.sequence <= 0n ||
    reservation.sequence > MAX_SIGNED_INT64 ||
    reservation.sequence !== state.attempt.settledSequence + 1n ||
    !bytesEqualFullScan(
      reservation.currentProgressSha256,
      state.progressSha256,
    ) ||
    !optionalDigestEqual(
      reservation.predecessorReceiptSha256,
      state.attempt.lastReceiptSha256,
    ) ||
    !bytesEqualFullScan(
      reservation.commandBudgetSha256,
      input.commandBudget.sha256,
    )
  ) {
    throw stale("reserveCommand", "stateChanged");
  }
}

function requireCommandAllowed(
  operation: "reserveCommand",
  lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
): void {
  const allowed =
    lifecycle === "open" && phase === "source" && commandKind === "source_page" ||
    lifecycle === "parsing" && phase === "parse" &&
      commandKind === "parse_module" ||
    (lifecycle === "parse_complete" || lifecycle === "linking") &&
      phase === "link" && commandKind === "link_page" ||
    (lifecycle === "link_complete" || lifecycle === "registering") &&
      phase === "registration" && commandKind === "registration_page";
  if (!allowed) throw lifecycleError(operation, lifecycle, phase);
}

function loadAttempt(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Effect.Effect<
  LoadedAttemptV2 | null,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  return runTransactionWithConfirmedRollbackRetry(
    target,
    operation,
    scopeId,
    attemptSha256,
    budget,
    usage,
    () => 0,
    0,
    async (tx) => {
      const metadata = await selectAttemptMetadata(
        tx,
        operation,
        scopeId,
        attemptSha256,
        budget,
        usage,
        observer,
      );
      if (metadata === null) return null;
      const total = checkedFrameMetadataBytes([
        metadata.decoded.identity.byteLength,
        metadata.decoded.ceilings.byteLength,
        metadata.decoded.usage.byteLength,
        metadata.decoded.progress.byteLength,
      ], operation);
      chargeOrThrow(operation, budget, usage, "frameBytes", total);
      chargeOrThrow(operation, budget, usage, "canonicalBytes", total);
      chargeOrThrow(operation, budget, usage, "hashBytes", total);
      chargeSqlOrThrow(operation, budget, usage, 1);
      const query = tx
        .select({
          identityBytes: fxSystemDeclarativeV2VerifierAttemptsV2.identityBytes,
          ceilingsBytes: fxSystemDeclarativeV2VerifierAttemptsV2.ceilingsBytes,
          usageBytes: fxSystemDeclarativeV2VerifierAttemptsV2.usageBytes,
          progressBytes: fxSystemDeclarativeV2VerifierAttemptsV2.progressBytes,
        })
        .from(fxSystemDeclarativeV2VerifierAttemptsV2)
        .where(and(
          eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
            attemptSha256,
          ),
        ));
      observeDrizzleQuery("attemptFrames", query, observer);
      const rows = await runStatement(() => query);
      if (rows.length !== 1) throw corruption(operation, "rowCountMismatch");
      return Object.freeze({ metadata: metadata.raw, frames: rows[0]! });
    },
  ).pipe(
    Effect.flatMap(stored => {
      if (stored === null) return Effect.succeed(null);
      return Effect.gen(function* () {
        const identitySha = yield* sha256(stored.frames.identityBytes, {
          maximumInputBytes: stored.frames.identityBytes.byteLength,
        });
        const ceilingsSha = yield* sha256(stored.frames.ceilingsBytes, {
          maximumInputBytes: stored.frames.ceilingsBytes.byteLength,
        });
        const usageSha = yield* sha256(stored.frames.usageBytes, {
          maximumInputBytes: stored.frames.usageBytes.byteLength,
        });
        const progressSha = yield* sha256(stored.frames.progressBytes, {
          maximumInputBytes: stored.frames.progressBytes.byteLength,
        });
        const decoded = yield* Effect.fromResult(
          decodeDeclarativeV2VerifierAttemptStoredStateV2(
            stored.metadata,
            stored.frames.identityBytes,
            identitySha,
            stored.frames.ceilingsBytes,
            ceilingsSha,
            stored.frames.usageBytes,
            usageSha,
            stored.frames.progressBytes,
            progressSha,
            {
              maximumFrameBytes: budget.maximumFrameBytes,
              maximumCanonicalBytes: budget.maximumCanonicalBytes,
              maximumPayloadBytes: 0,
            },
          ).pipe(Result.mapError(cause => mapStoredError(operation, cause))),
        );
        return Object.freeze({ decoded });
      });
    }),
  );
}

const loadCommandDecisionRows = Effect.fn(
  "DeclarativeV2.verifierProgressV2.loadCommandDecisionRows",
)(function (
  target: LocatedReadCommittedAttemptTargetV1,
  input: DeclarativeV2VerifierProgressObserveCommandDecisionInputV2 & {
    readonly scopeId: ScopeId;
    readonly terminalProofSha256?: Uint8Array;
  },
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Effect.Effect<
  LoadedCommandDecisionRowsV2 | null,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  return runTransactionWithConfirmedRollbackRetry(
    target,
    "observeCommandDecision",
    input.scopeId,
    input.attemptSha256,
    budget,
    usage,
    () => 0,
    0,
    async (tx) => {
      chargeSqlOrThrow("observeCommandDecision", budget, usage, 1);
      const attemptQuery = tx
        .select(attemptMetadataSelection(false))
        .from(fxSystemDeclarativeV2VerifierAttemptsV2)
        .where(and(
          eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, input.scopeId),
          eq(
            fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
            input.attemptSha256,
          ),
        ))
        .for("share");
      observeDrizzleQuery(
        "decisionAttemptMetadata",
        attemptQuery,
        observer,
      );
      const attemptRows = await runStatement(() => attemptQuery);
      if (attemptRows.length === 0) return null;
      requireOneRow("observeCommandDecision", attemptRows.length);
      const attempt = resultOrThrow(
        decodeDeclarativeV2VerifierAttemptMetadataRowV2(attemptRows[0]),
        "observeCommandDecision",
      );
      chargeSqlOrThrow("observeCommandDecision", budget, usage, 1);
      const commandQuery = tx
        .select(commandMetadataSelection())
        .from(fxSystemDeclarativeV2VerifierCommandsV2)
        .where(and(
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
            input.scopeId,
          ),
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
            input.attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.sequence,
            input.sequence,
          ),
        ))
        .for("share");
      observeDrizzleQuery(
        "decisionCommandMetadata",
        commandQuery,
        observer,
      );
      const commandRows = await runStatement(() => commandQuery);
      if (commandRows.length === 0) return null;
      requireOneRow("observeCommandDecision", commandRows.length);
      const command = resultOrThrow(
        decodeDeclarativeV2VerifierCommandMetadataRowV2(commandRows[0]),
        "observeCommandDecision",
      );
      if (
        !bytesEqualFullScan(
          command.reservationSha256,
          input.reservationSha256,
        )
      ) {
        throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
          operation: "observeCommandDecision",
          reason: "commandChanged",
        });
      }
      if (command.settledAt === null) {
        return Object.freeze({ kind: "unsettled" as const, attempt, command });
      }
      if (
        input.terminalProofBytes !== undefined &&
        input.terminalProofSha256 !== undefined
      ) {
        chargeSqlOrThrow("observeCommandDecision", budget, usage, 1);
        const authority = fxSystemDeclarativeV2VerifierCommandAuthorityV1;
        const authorityQuery = tx
          .select({
            commandKind: authority.commandKind,
            reservationSha256: authority.reservationSha256,
            terminalProofCodecVersion: authority.terminalProofCodecVersion,
            terminalProofByteLength: authority.terminalProofByteLength,
            terminalProofSha256: authority.terminalProofSha256,
            terminalProofBytes: authority.terminalProofBytes,
            settledAt: authority.settledAt,
          })
          .from(authority)
          .where(and(
            eq(authority.scopeId, input.scopeId),
            eq(authority.attemptSha256, input.attemptSha256),
            eq(authority.sequence, input.sequence),
          ))
          .for("share");
        observeDrizzleQuery(
          "decisionCommandAuthority",
          authorityQuery,
          observer,
        );
        const authorityRows = await runStatement(() => authorityQuery);
        requireOneRow("observeCommandDecision", authorityRows.length);
        const storedAuthority = authorityRows[0]!;
        if (
          storedAuthority.commandKind !== command.commandKind ||
          !bytesEqualFullScan(
            storedAuthority.reservationSha256,
            input.reservationSha256,
          ) ||
          storedAuthority.terminalProofCodecVersion !== 1 ||
          storedAuthority.terminalProofByteLength !==
            BigInt(input.terminalProofBytes.byteLength) ||
          storedAuthority.terminalProofSha256 === null ||
          storedAuthority.terminalProofBytes === null ||
          storedAuthority.settledAt === null ||
          !bytesEqualFullScan(
            storedAuthority.terminalProofSha256,
            input.terminalProofSha256,
          ) ||
          !bytesEqualFullScan(
            storedAuthority.terminalProofBytes,
            input.terminalProofBytes,
          )
        ) {
          throw corruption("observeCommandDecision", "normalizedMismatch");
        }
      }
      let finalPageMetadata:
        DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null = null;
      if (
        command.commandKind === "parse_module" ||
        command.commandKind === "link_page"
      ) {
        if (command.pageCount < 1n || command.lastPageSha256 === null) {
          throw corruption(
            "observeCommandDecision",
            "normalizedMismatch",
          );
        }
        chargeSqlOrThrow("observeCommandDecision", budget, usage, 1);
        const pageQuery = tx
          .select(pageMetadataSelection())
          .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
          .where(and(
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.scopeId,
              input.scopeId,
            ),
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.attemptSha256,
              input.attemptSha256,
            ),
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.sequence,
              input.sequence,
            ),
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.commandKind,
              command.commandKind,
            ),
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2
                .reservationSha256,
              input.reservationSha256,
            ),
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
              command.pageCount - 1n,
            ),
          ))
          .for("share");
        observeDrizzleQuery(
          "decisionFinalPageMetadata",
          pageQuery,
          observer,
        );
        const pageRows = await runStatement(() => pageQuery);
        requireOneRow("observeCommandDecision", pageRows.length);
        finalPageMetadata = resultOrThrow(
          decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(pageRows[0]),
          "observeCommandDecision",
        );
        if (
          !bytesEqualFullScan(
            finalPageMetadata.pageSha256,
            command.lastPageSha256,
          )
        ) {
          throw corruption(
            "observeCommandDecision",
            "normalizedMismatch",
          );
        }
      } else if (
        command.pageCount !== 0n ||
        command.lastPageSha256 !== null
      ) {
        throw corruption("observeCommandDecision", "normalizedMismatch");
      }
      const total = checkedFrameMetadataBytes([
        attempt.usage.byteLength,
        attempt.progress.byteLength,
        command.reservation.byteLength,
        command.commandBudget.byteLength,
        command.outputManifest!.byteLength,
        command.commandUsage!.byteLength,
        command.resultingUsage!.byteLength,
        command.nextProgress!.byteLength,
        command.receipt!.byteLength,
      ], "observeCommandDecision");
      chargeOrThrow(
        "observeCommandDecision",
        budget,
        usage,
        "frameBytes",
        total,
      );
      chargeOrThrow(
        "observeCommandDecision",
        budget,
        usage,
        "canonicalBytes",
        total,
      );
      chargeOrThrow(
        "observeCommandDecision",
        budget,
        usage,
        "hashBytes",
        total,
      );
      chargeSqlOrThrow("observeCommandDecision", budget, usage, 1);
      const attemptFramesQuery = tx
        .select({
          usageBytes: fxSystemDeclarativeV2VerifierAttemptsV2.usageBytes,
          progressBytes: fxSystemDeclarativeV2VerifierAttemptsV2.progressBytes,
        })
        .from(fxSystemDeclarativeV2VerifierAttemptsV2)
        .where(and(
          eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, input.scopeId),
          eq(
            fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
            input.attemptSha256,
          ),
        ));
      observeDrizzleQuery(
        "decisionAttemptFrames",
        attemptFramesQuery,
        observer,
      );
      const attemptFrameRows = await runStatement(() => attemptFramesQuery);
      requireOneRow("observeCommandDecision", attemptFrameRows.length);
      chargeSqlOrThrow("observeCommandDecision", budget, usage, 1);
      const commandFramesQuery = tx
        .select({
          reservationBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.reservationBytes,
          commandBudgetBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.commandBudgetBytes,
          outputManifestBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.outputManifestBytes,
          commandUsageBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.commandUsageBytes,
          resultingUsageBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.resultingUsageBytes,
          nextProgressBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.nextProgressBytes,
          receiptBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.receiptBytes,
        })
        .from(fxSystemDeclarativeV2VerifierCommandsV2)
        .where(and(
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
            input.scopeId,
          ),
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
            input.attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.sequence,
            input.sequence,
          ),
          eq(
            fxSystemDeclarativeV2VerifierCommandsV2.reservationSha256,
            input.reservationSha256,
          ),
        ));
      observeDrizzleQuery(
        "decisionCommandFrames",
        commandFramesQuery,
        observer,
      );
      const commandFrameRows = await runStatement(() => commandFramesQuery);
      requireOneRow("observeCommandDecision", commandFrameRows.length);
      const attemptFrames = attemptFrameRows[0]!;
      const commandFrames = commandFrameRows[0]!;
      return Object.freeze({
        kind: "settled" as const,
        rows: Object.freeze({
          attemptMetadata: attemptRows[0],
          attemptUsageBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            attemptFrames.usageBytes,
            attempt.usage.byteLength,
          ),
          attemptProgressBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            attemptFrames.progressBytes,
            attempt.progress.byteLength,
          ),
          commandMetadata: commandRows[0],
          finalPageMetadata,
          reservationBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.reservationBytes,
            command.reservation.byteLength,
          ),
          commandBudgetBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.commandBudgetBytes,
            command.commandBudget.byteLength,
          ),
          outputManifestBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.outputManifestBytes,
            command.outputManifest!.byteLength,
          ),
          commandUsageBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.commandUsageBytes,
            command.commandUsage!.byteLength,
          ),
          resultingUsageBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.resultingUsageBytes,
            command.resultingUsage!.byteLength,
          ),
          nextProgressBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.nextProgressBytes,
            command.nextProgress!.byteLength,
          ),
          receiptBytes: copyStoredFrameBytes(
            "observeCommandDecision",
            commandFrames.receiptBytes,
            command.receipt!.byteLength,
          ),
        }),
      });
    },
  );
});

const decodeCommandDecision = Effect.fn(
  "DeclarativeV2.verifierProgressV2.decodeCommandDecision",
)(function (
  loaded: LoadedCommandDecisionRowsV2,
  input: DeclarativeV2VerifierProgressObserveCommandDecisionInputV2 & {
    readonly scopeId: ScopeId;
  },
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  DeclarativeV2VerifierProgressCommandDecisionV2,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  if (loaded.kind === "unsettled") {
    const base = Object.freeze({
      commandKind: loaded.command.commandKind,
      sequence: loaded.command.sequence,
      reservationSha256: new Uint8Array(loaded.command.reservationSha256),
    });
    if (
      loaded.attempt.lifecycle === "abandoned" ||
      loaded.attempt.lifecycle === "ready" ||
      loaded.attempt.lifecycle === "rejected"
    ) {
      return Effect.succeed(Object.freeze({
        kind: "terminalUnsettled" as const,
        lifecycle: loaded.attempt.lifecycle,
        ...base,
      }));
    }
    if (
      loaded.attempt.pendingKind !== loaded.command.commandKind ||
      loaded.attempt.pendingSequence !== loaded.command.sequence ||
      loaded.attempt.pendingReservationSha256 === null ||
      !bytesEqualFullScan(
        loaded.attempt.pendingReservationSha256,
        loaded.command.reservationSha256,
      )
    ) {
      return Effect.fail(
        corruption("observeCommandDecision", "normalizedMismatch"),
      );
    }
    return Effect.succeed(Object.freeze({ kind: "pending" as const, ...base }));
  }
  return Effect.gen(function* () {
    const rows = loaded.rows;
    const attemptMetadata = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierAttemptMetadataRowV2(
        rows.attemptMetadata,
      ).pipe(
        Result.mapError(cause =>
          mapStoredError("observeCommandDecision", cause)
        ),
      ),
    );
    const usageSha256 = yield* sha256(rows.attemptUsageBytes, {
      maximumInputBytes: rows.attemptUsageBytes.byteLength,
    });
    const progressSha256 = yield* sha256(rows.attemptProgressBytes, {
      maximumInputBytes: rows.attemptProgressBytes.byteLength,
    });
    yield* Effect.fromResult(
      decodeDeclarativeV2VerifierStoredFrameV2(
        attemptMetadata.usage,
        rows.attemptUsageBytes,
        usageSha256,
        "attempt_usage",
        storedDecoderBudget(budget),
      ).pipe(
        Result.mapError(cause =>
          mapStoredError("observeCommandDecision", cause)
        ),
      ),
    );
    const progress = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierStoredFrameV2(
        attemptMetadata.progress,
        rows.attemptProgressBytes,
        progressSha256,
        "progress_cursor",
        storedDecoderBudget(budget),
      ).pipe(
        Result.mapError(cause =>
          mapStoredError("observeCommandDecision", cause)
        ),
      ),
    );
    const reservationSha256 = yield* sha256(rows.reservationBytes, {
      maximumInputBytes: rows.reservationBytes.byteLength,
    });
    const commandBudgetSha256 = yield* sha256(rows.commandBudgetBytes, {
      maximumInputBytes: rows.commandBudgetBytes.byteLength,
    });
    const outputManifestSha256 = yield* sha256(rows.outputManifestBytes, {
      maximumInputBytes: rows.outputManifestBytes.byteLength,
    });
    const commandUsageSha256 = yield* sha256(rows.commandUsageBytes, {
      maximumInputBytes: rows.commandUsageBytes.byteLength,
    });
    const resultingUsageSha256 = yield* sha256(rows.resultingUsageBytes, {
      maximumInputBytes: rows.resultingUsageBytes.byteLength,
    });
    const nextProgressSha256 = yield* sha256(rows.nextProgressBytes, {
      maximumInputBytes: rows.nextProgressBytes.byteLength,
    });
    const receiptSha256 = yield* sha256(rows.receiptBytes, {
      maximumInputBytes: rows.receiptBytes.byteLength,
    });
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
        rows.commandMetadata,
        {
          candidateSha256: attemptMetadata.candidateSha256,
          lifecycle: attemptMetadata.lifecycle,
          settledSequence: attemptMetadata.settledSequence,
          lastReceiptSha256: attemptMetadata.lastReceiptSha256,
          usageSha256,
          progressSha256,
          phase: progress.frame.phase,
        },
        rows.reservationBytes,
        reservationSha256,
        rows.commandBudgetBytes,
        commandBudgetSha256,
        {
          outputManifestBytes: rows.outputManifestBytes,
          outputManifestObservedSha256: outputManifestSha256,
          commandUsageBytes: rows.commandUsageBytes,
          commandUsageObservedSha256: commandUsageSha256,
          resultingUsageBytes: rows.resultingUsageBytes,
          resultingUsageObservedSha256: resultingUsageSha256,
          nextProgressBytes: rows.nextProgressBytes,
          nextProgressObservedSha256: nextProgressSha256,
          receiptBytes: rows.receiptBytes,
          receiptObservedSha256: receiptSha256,
        },
        storedDecoderBudget(budget),
      ).pipe(
        Result.mapError(cause =>
          mapStoredError("observeCommandDecision", cause)
        ),
      ),
    );
    if (
      !bytesEqualFullScan(
        decoded.metadata.reservationSha256,
        input.reservationSha256,
      )
    ) {
      return yield* new
        DeclarativeV2VerifierProgressRepositoryConflictV2Error({
          operation: "observeCommandDecision",
          reason: "commandChanged",
        });
    }
    if (rows.finalPageMetadata !== null) {
      const finalValidation =
        validateDeclarativeV2VerifierFinalEvidencePageV2(
          evidencePageManifestFromMetadata(rows.finalPageMetadata),
          rows.finalPageMetadata.pageSha256,
          decoded.settlement.outputManifest.frame,
        );
      if (Result.isFailure(finalValidation)) {
        return yield* corruption(
          "observeCommandDecision",
          "normalizedMismatch",
        );
      }
    } else if (
      decoded.metadata.commandKind === "parse_module" ||
      decoded.metadata.commandKind === "link_page"
    ) {
      return yield* corruption(
        "observeCommandDecision",
        "normalizedMismatch",
      );
    }
    return Object.freeze({
      kind: "settled" as const,
      settlement: settlementSnapshotFromDecoded(decoded),
    });
  });
});

async function selectAttemptMetadata(
  tx: AppRowTransaction,
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<Readonly<{
  readonly raw: unknown;
  readonly decoded: DeclarativeV2VerifierStoredAttemptMetadataV2;
}> | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const base = tx
    .select(attemptMetadataSelection(false))
    .from(fxSystemDeclarativeV2VerifierAttemptsV2)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
        attemptSha256,
      ),
    ));
  const query = base.for("share");
  observeDrizzleQuery("attemptMetadata", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw corruption(operation, "selectorMismatch");
  return Object.freeze({
    raw: rows[0],
    decoded: resultOrThrow(
      decodeDeclarativeV2VerifierAttemptMetadataRowV2(rows[0]),
      operation,
    ),
  });
}

function attemptMetadataSelection(includeDatabaseNow: boolean) {
  const table = fxSystemDeclarativeV2VerifierAttemptsV2;
  return {
    scopeId: table.scopeId,
    attemptSha256: table.attemptSha256,
    candidateSha256: table.candidateSha256,
    lifecycle: table.lifecycle,
    writerOwnerId: table.writerOwnerId,
    writerFence: table.writerFence,
    leaseUpdatedAt: table.leaseUpdatedAt,
    leaseExpiresAt: table.leaseExpiresAt,
    settledSequence: table.settledSequence,
    lastReceiptSha256: table.lastReceiptSha256,
    pendingKind: table.pendingKind,
    pendingSequence: table.pendingSequence,
    pendingReservationSha256: table.pendingReservationSha256,
    pendingReservedByFence: table.pendingReservedByFence,
    pendingStartedAt: table.pendingStartedAt,
    identityCodecVersion: table.identityCodecVersion,
    identityByteLength: table.identityByteLength,
    identitySha256: table.identitySha256,
    ceilingsCodecVersion: table.ceilingsCodecVersion,
    ceilingsByteLength: table.ceilingsByteLength,
    ceilingsSha256: table.ceilingsSha256,
    usageCodecVersion: table.usageCodecVersion,
    usageByteLength: table.usageByteLength,
    usageSha256: table.usageSha256,
    progressCodecVersion: table.progressCodecVersion,
    progressByteLength: table.progressByteLength,
    progressSha256: table.progressSha256,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    ...(includeDatabaseNow
      ? {
          databaseNowMillisecondsText: sql<string>`
            floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text`,
      }
      : {}),
  };
}

async function lockAttemptMetadata(
  tx: AppRowTransaction,
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt"
  >,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<
  (DeclarativeV2VerifierStoredAttemptMetadataV2 & {
    readonly databaseNow: Date;
  }) | null
> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const query = tx
    .select(attemptMetadataSelection(true))
    .from(fxSystemDeclarativeV2VerifierAttemptsV2)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
        attemptSha256,
      ),
    ))
    .for("update");
  observeDrizzleQuery("lockAttempt", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw corruption(operation, "selectorMismatch");
  const { databaseNowMillisecondsText, ...metadata } = rows[0]!;
  const decoded = resultOrThrow(
    decodeDeclarativeV2VerifierAttemptMetadataRowV2(metadata),
    operation,
  );
  const databaseNowMilliseconds = parseNonNegativeSafeIntegerText(
    databaseNowMillisecondsText,
  );
  if (databaseNowMilliseconds === undefined) {
    throw corruption(operation, "invalidMetadata");
  }
  const databaseNow = new Date(databaseNowMilliseconds);
  return Object.freeze({ ...decoded, databaseNow: copyDate(databaseNow) });
}

type RawCommandRowsV2 = Readonly<{
  readonly metadata: unknown;
  readonly reservationBytes: Uint8Array;
  readonly commandBudgetBytes: Uint8Array;
}>;

type RawCommandAuthorityV1 = Readonly<{
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly reservationSha256: Uint8Array;
  readonly reservedByFence: bigint;
  readonly futureRegistrationIntentCodecVersion: number | null;
  readonly futureRegistrationIntentByteLength: bigint | null;
  readonly futureRegistrationIntentSha256: Uint8Array | null;
  readonly futureRegistrationIntentBytes: Uint8Array | null;
  readonly terminalProofCodecVersion: number | null;
  readonly terminalProofByteLength: bigint | null;
  readonly terminalProofSha256: Uint8Array | null;
  readonly terminalProofBytes: Uint8Array | null;
  readonly settledAt: Date | null;
}>;

async function readCommandAuthority(
  tx: AppRowTransaction,
  operation: "reserveCommand" | "resumePending" | "settleCommand",
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  sequence: bigint,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<RawCommandAuthorityV1 | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const table = fxSystemDeclarativeV2VerifierCommandAuthorityV1;
  const query = tx
    .select({
      commandKind: table.commandKind,
      reservationSha256: table.reservationSha256,
      reservedByFence: table.reservedByFence,
      futureRegistrationIntentCodecVersion:
        table.futureRegistrationIntentCodecVersion,
      futureRegistrationIntentByteLength:
        table.futureRegistrationIntentByteLength,
      futureRegistrationIntentSha256:
        table.futureRegistrationIntentSha256,
      futureRegistrationIntentBytes: table.futureRegistrationIntentBytes,
      terminalProofCodecVersion: table.terminalProofCodecVersion,
      terminalProofByteLength: table.terminalProofByteLength,
      terminalProofSha256: table.terminalProofSha256,
      terminalProofBytes: table.terminalProofBytes,
      settledAt: table.settledAt,
    })
    .from(table)
    .where(and(
      eq(table.scopeId, scopeId),
      eq(table.attemptSha256, attemptSha256),
      eq(table.sequence, sequence),
    ))
    .for("update");
  observeDrizzleQuery("commandAuthority", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw corruption(operation, "selectorMismatch");
  return rows[0]!;
}

async function requireRegistrationPredecessorAuthority(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  intent: NonNullable<
    CapturedCommandAuthorityV1["futureRegistrationIntent"]
  >,
  registrationReservation: CapturedFrameV2<
    DeclarativeV2VerifierCommandReservationFrameV2
  >,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<void> {
  chargeSqlOrThrow("reserveCommand", budget, usage, 1);
  const authority = fxSystemDeclarativeV2VerifierCommandAuthorityV1;
  const command = fxSystemDeclarativeV2VerifierCommandsV2;
  const query = tx
    .select({
      authorityKind: authority.commandKind,
      authorityReservationSha256: authority.reservationSha256,
      intentCodecVersion: authority.futureRegistrationIntentCodecVersion,
      intentByteLength: authority.futureRegistrationIntentByteLength,
      intentSha256: authority.futureRegistrationIntentSha256,
      intentBytes: authority.futureRegistrationIntentBytes,
      terminalProofCodecVersion: authority.terminalProofCodecVersion,
      terminalProofByteLength: authority.terminalProofByteLength,
      terminalProofSha256: authority.terminalProofSha256,
      terminalProofBytes: authority.terminalProofBytes,
      authoritySettledAt: authority.settledAt,
      commandKind: command.commandKind,
      commandReservationSha256: command.reservationSha256,
      receiptSha256: command.receiptSha256,
      commandSettledAt: command.settledAt,
    })
    .from(authority)
    .innerJoin(command, and(
      eq(command.scopeId, authority.scopeId),
      eq(command.attemptSha256, authority.attemptSha256),
      eq(command.sequence, authority.sequence),
      eq(command.reservationSha256, authority.reservationSha256),
      eq(command.commandKind, authority.commandKind),
    ))
    .where(and(
      eq(authority.scopeId, scopeId),
      eq(authority.attemptSha256, attemptSha256),
      eq(authority.sequence, intent.intent.linkSequence),
    ))
    .for("update");
  observeDrizzleQuery("registrationPredecessorAuthority", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length !== 1) {
    throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
      operation: "reserveCommand",
      reason: "commandChanged",
    });
  }
  const stored = rows[0]!;
  const predecessorReceiptSha256 =
    registrationReservation.frame.predecessorReceiptSha256;
  if (
    stored.authorityKind !== "link_page" ||
    stored.commandKind !== "link_page" ||
    !bytesEqualFullScan(
      stored.authorityReservationSha256,
      intent.intent.linkReservationSha256,
    ) ||
    !bytesEqualFullScan(
      stored.commandReservationSha256,
      intent.intent.linkReservationSha256,
    ) ||
    stored.intentCodecVersion !== 1 ||
    stored.intentByteLength !== BigInt(intent.bytes.byteLength) ||
    stored.intentSha256 === null ||
    stored.intentBytes === null ||
    !bytesEqualFullScan(stored.intentSha256, intent.sha256) ||
    !bytesEqualFullScan(stored.intentBytes, intent.bytes) ||
    stored.terminalProofCodecVersion !== 1 ||
    stored.terminalProofByteLength === null ||
    stored.terminalProofSha256 === null ||
    stored.terminalProofBytes === null ||
    stored.authoritySettledAt === null ||
    stored.receiptSha256 === null ||
    stored.commandSettledAt === null ||
    predecessorReceiptSha256 === null ||
    !bytesEqualFullScan(stored.receiptSha256, predecessorReceiptSha256)
  ) {
    throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
      operation: "reserveCommand",
      reason: "commandChanged",
    });
  }
  const terminalProof = decodeDeclarativeV2TerminalAuthorityProofV1(
    stored.terminalProofBytes,
  );
  if (
    Result.isFailure(terminalProof) ||
    terminalProof.success.proof.commandKind !== "link_page" ||
    terminalProof.success.proof.sequence !== intent.intent.linkSequence ||
    terminalProof.success.proof.futureRegistrationIntentSha256 === null ||
    !bytesEqualFullScan(
      terminalProof.success.proof.futureRegistrationIntentSha256,
      intent.sha256,
    ) ||
    !bytesEqualFullScan(
      terminalProof.success.proof.reservationSha256,
      intent.intent.linkReservationSha256,
    ) ||
    !bytesEqualFullScan(
      terminalProof.success.proof.receiptSha256,
      stored.receiptSha256,
    )
  ) {
    throw corruption("reserveCommand", "invalidStoredBytes");
  }
}

function requireCommandAuthorityPresenceAndEquality(
  operation: "reserveCommand" | "resumePending" | "settleCommand",
  expected: CapturedCommandAuthorityV1 | null,
  stored: RawCommandAuthorityV1 | null,
  reservation: CapturedFrameV2<
    DeclarativeV2VerifierCommandReservationFrameV2
  >,
  writerFence: bigint | null,
): void {
  if (expected === null) {
    if (stored !== null) {
      throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
        operation,
        reason: "commandChanged",
      });
    }
    return;
  }
  requireCommandAuthorityEquals(
    operation,
    expected,
    stored,
    reservation,
    writerFence,
  );
}

function requireCommandAuthorityEquals(
  operation: "reserveCommand" | "resumePending" | "settleCommand",
  expected: CapturedCommandAuthorityV1,
  stored: RawCommandAuthorityV1 | null,
  reservation: CapturedFrameV2<
    DeclarativeV2VerifierCommandReservationFrameV2
  >,
  writerFence: bigint | null,
): void {
  const intent = expected.futureRegistrationIntent;
  if (
    stored === null ||
    stored.commandKind !== reservation.frame.commandKind ||
    (writerFence !== null && stored.reservedByFence !== writerFence) ||
    !bytesEqualFullScan(
      stored.reservationSha256,
      reservation.sha256,
    ) ||
    stored.terminalProofCodecVersion !== null ||
    stored.terminalProofByteLength !== null ||
    stored.terminalProofSha256 !== null ||
    stored.terminalProofBytes !== null ||
    stored.settledAt !== null
  ) {
    throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
      operation,
      reason: "commandChanged",
    });
  }
  const sameIntent = intent === null
    ? stored.futureRegistrationIntentCodecVersion === null &&
      stored.futureRegistrationIntentByteLength === null &&
      stored.futureRegistrationIntentSha256 === null &&
      stored.futureRegistrationIntentBytes === null
    : stored.futureRegistrationIntentCodecVersion === 1 &&
      stored.futureRegistrationIntentByteLength ===
        BigInt(intent.bytes.byteLength) &&
      stored.futureRegistrationIntentSha256 !== null &&
      stored.futureRegistrationIntentBytes !== null &&
      bytesEqualFullScan(
        stored.futureRegistrationIntentSha256,
        intent.sha256,
      ) &&
      bytesEqualFullScan(
        stored.futureRegistrationIntentBytes,
        intent.bytes,
      );
  if (!sameIntent) {
    throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
      operation,
      reason: "commandChanged",
    });
  }
}

async function readCommandRows(
  tx: AppRowTransaction,
  operation: "reserveCommand" | "resumePending",
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  sequence: bigint,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<RawCommandRowsV2 | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const metadataQuery = tx
    .select(commandMetadataSelection())
    .from(fxSystemDeclarativeV2VerifierCommandsV2)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierCommandsV2.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
        attemptSha256,
      ),
      eq(fxSystemDeclarativeV2VerifierCommandsV2.sequence, sequence),
    ))
    .for("update");
  observeDrizzleQuery("commandMetadata", metadataQuery, observer);
  const metadataRows = await runStatement(() => metadataQuery);
  if (metadataRows.length === 0) return null;
  if (metadataRows.length !== 1) {
    throw corruption(operation, "selectorMismatch");
  }
  const metadata = resultOrThrow(
    decodeDeclarativeV2VerifierCommandMetadataRowV2(metadataRows[0]),
    operation,
  );
  const total = checkedFrameMetadataBytes([
    metadata.reservation.byteLength,
    metadata.commandBudget.byteLength,
  ], operation);
  chargeOrThrow(operation, budget, usage, "frameBytes", total);
  chargeOrThrow(operation, budget, usage, "canonicalBytes", total);
  chargeOrThrow(operation, budget, usage, "hashBytes", total);
  chargeSqlOrThrow(operation, budget, usage, 1);
  const frameQuery = tx
    .select({
      reservationBytes:
        fxSystemDeclarativeV2VerifierCommandsV2.reservationBytes,
      commandBudgetBytes:
        fxSystemDeclarativeV2VerifierCommandsV2.commandBudgetBytes,
    })
    .from(fxSystemDeclarativeV2VerifierCommandsV2)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierCommandsV2.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
        attemptSha256,
      ),
      eq(fxSystemDeclarativeV2VerifierCommandsV2.sequence, sequence),
    ));
  observeDrizzleQuery("commandFrames", frameQuery, observer);
  const frameRows = await runStatement(() => frameQuery);
  if (frameRows.length !== 1) throw corruption(operation, "rowCountMismatch");
  return Object.freeze({
    metadata: metadataRows[0],
    reservationBytes: frameRows[0]!.reservationBytes,
    commandBudgetBytes: frameRows[0]!.commandBudgetBytes,
  });
}

function commandMetadataSelection() {
  const table = fxSystemDeclarativeV2VerifierCommandsV2;
  return {
    scopeId: table.scopeId,
    attemptSha256: table.attemptSha256,
    sequence: table.sequence,
    commandKind: table.commandKind,
    reservationSha256: table.reservationSha256,
    reservationCodecVersion: table.reservationCodecVersion,
    reservationByteLength: table.reservationByteLength,
    reservationFrameSha256: table.reservationFrameSha256,
    commandBudgetCodecVersion: table.commandBudgetCodecVersion,
    commandBudgetByteLength: table.commandBudgetByteLength,
    commandBudgetSha256: table.commandBudgetSha256,
    reservedByFence: table.reservedByFence,
    reservedAt: table.reservedAt,
    pageCount: table.pageCount,
    lastPageSha256: table.lastPageSha256,
    outputManifestCodecVersion: table.outputManifestCodecVersion,
    outputManifestByteLength: table.outputManifestByteLength,
    outputManifestSha256: table.outputManifestSha256,
    commandUsageCodecVersion: table.commandUsageCodecVersion,
    commandUsageByteLength: table.commandUsageByteLength,
    commandUsageSha256: table.commandUsageSha256,
    resultingUsageCodecVersion: table.resultingUsageCodecVersion,
    resultingUsageByteLength: table.resultingUsageByteLength,
    resultingUsageSha256: table.resultingUsageSha256,
    nextProgressCodecVersion: table.nextProgressCodecVersion,
    nextProgressByteLength: table.nextProgressByteLength,
    nextProgressSha256: table.nextProgressSha256,
    receiptCodecVersion: table.receiptCodecVersion,
    receiptByteLength: table.receiptByteLength,
    receiptSha256: table.receiptSha256,
    settledAt: table.settledAt,
  };
}

function historicalCommandWhere(
  input: CapturedSettledEvidencePageBatchInputV2,
) {
  return and(
    eq(
      fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
      input.scopeId,
    ),
    eq(
      fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
      input.attemptSha256,
    ),
    eq(
      fxSystemDeclarativeV2VerifierCommandsV2.sequence,
      input.sequence,
    ),
  )!;
}

function historicalPageSelector(
  input: CapturedSettledEvidencePageBatchInputV2,
) {
  return and(
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.scopeId,
      input.scopeId,
    ),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.attemptSha256,
      input.attemptSha256,
    ),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.sequence,
      input.sequence,
    ),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.commandKind,
      input.commandKind,
    ),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.reservationSha256,
      input.reservationSha256,
    ),
  )!;
}

const loadHistoricalSettledEvidencePageBatch = Effect.fn(
  "DeclarativeV2.verifierProgressV2.loadHistoricalSettledEvidencePageBatch",
)(function (
  target: LocatedReadCommittedAttemptTargetV1,
  input: CapturedSettledEvidencePageBatchInputV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  monotonicMilliseconds: () => number,
  start: number,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Effect.Effect<
  RawHistoricalSettledCommandRowsV2,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  const operation = "readSettledEvidencePageBatch" as const;
  return runTransactionWithConfirmedRollbackRetry(
    target,
    operation,
    input.scopeId,
    input.attemptSha256,
    budget,
    usage,
    monotonicMilliseconds,
    start,
    async (tx) => {
      chargeSqlOrThrow(operation, budget, usage, 1);
      const commandQuery = tx
        .select(commandMetadataSelection())
        .from(fxSystemDeclarativeV2VerifierCommandsV2)
        .where(historicalCommandWhere(input))
        .for("share");
      observeDrizzleQuery(
        "settledReadCommandMetadata",
        commandQuery,
        observer,
      );
      const commandRows = await runStatement(() => commandQuery);
      if (commandRows.length === 0) {
        throw new DeclarativeV2VerifierProgressRepositoryNotFoundV2Error({
          operation,
        });
      }
      if (commandRows.length !== 1) {
        throw corruption(operation, "selectorMismatch");
      }
      const command = resultOrThrow(
        decodeDeclarativeV2VerifierCommandMetadataRowV2(commandRows[0]),
        operation,
      );
      if (
        command.commandKind !== input.commandKind ||
        command.sequence !== input.sequence ||
        !bytesEqualFullScan(
          command.reservationSha256,
          input.reservationSha256,
        ) ||
        command.outputManifest === null ||
        command.commandUsage === null ||
        command.resultingUsage === null ||
        command.nextProgress === null ||
        command.receipt === null ||
        command.settledAt === null
      ) {
        throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
          operation,
          reason: "settlementChanged",
        });
      }
      if (
        !bytesEqualFullScan(
          command.outputManifest.sha256,
          input.outputManifestSha256,
        ) ||
        !bytesEqualFullScan(command.receipt.sha256, input.receiptSha256)
      ) {
        throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
          operation,
          reason: "commandChanged",
        });
      }
      if (
        command.pageCount < 1n ||
        command.lastPageSha256 === null ||
        input.startPageOrdinal > command.pageCount
      ) {
        throw pageConflict(operation, "pageGap");
      }

      let predecessor:
        DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null = null;
      if (input.startPageOrdinal > 0n) {
        chargeSqlOrThrow(operation, budget, usage, 1);
        const predecessorQuery = tx
          .select(pageMetadataSelection())
          .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
          .where(and(
            historicalPageSelector(input),
            eq(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
              input.startPageOrdinal - 1n,
            ),
          ))
          .for("share");
        observeDrizzleQuery(
          "settledReadPredecessorMetadata",
          predecessorQuery,
          observer,
        );
        const predecessorRows = await runStatement(() => predecessorQuery);
        if (predecessorRows.length !== 1) {
          throw corruption(operation, "missingPageWithinTail");
        }
        predecessor = resultOrThrow(
          decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(
            predecessorRows[0],
          ),
          operation,
        );
      }
      requireSettledReadPredecessor(input, predecessor);

      chargeSqlOrThrow(
        operation,
        budget,
        usage,
        budget.maximumPages,
      );
      const metadataQuery = tx
        .select(pageMetadataSelection())
        .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
        .where(and(
          historicalPageSelector(input),
          gte(
            fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
            input.startPageOrdinal,
          ),
        ))
        .orderBy(asc(
          fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        ))
        .limit(budget.maximumPages)
        .for("share");
      observeDrizzleQuery(
        "settledReadPageMetadata",
        metadataQuery,
        observer,
      );
      const metadataRows = await runStatement(() => metadataQuery);
      const metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2[] = [];
      for (const row of metadataRows) {
        metadata.push(resultOrThrow(
          decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(row),
          operation,
        ));
      }
      if (
        metadata.some(page => page.pageOrdinal >= command.pageCount) ||
        (
          input.startPageOrdinal < command.pageCount &&
          metadata.length === 0
        )
      ) {
        throw corruption(operation, "missingPageWithinTail");
      }
      requireReadBatchContinuity(
        operation,
        input.startPageOrdinal,
        predecessor,
        metadata,
      );
      const nextOrdinal =
        input.startPageOrdinal + BigInt(metadata.length);
      if (
        metadata.length < budget.maximumPages &&
        nextOrdinal < command.pageCount
      ) {
        throw corruption(operation, "missingPageWithinTail");
      }

      chargeSqlOrThrow(operation, budget, usage, 1);
      const finalPageQuery = tx
        .select(pageMetadataSelection())
        .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
        .where(and(
          historicalPageSelector(input),
          eq(
            fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
            command.pageCount - 1n,
          ),
        ))
        .for("share");
      observeDrizzleQuery(
        "settledReadFinalPageMetadata",
        finalPageQuery,
        observer,
      );
      const finalPageRows = await runStatement(() => finalPageQuery);
      if (finalPageRows.length !== 1) {
        throw corruption(operation, "missingPageWithinTail");
      }
      const finalPageMetadata = resultOrThrow(
        decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(
          finalPageRows[0],
        ),
        operation,
      );
      requireCommandPageTail(operation, command, finalPageMetadata);
      if (nextOrdinal === command.pageCount) {
        requireCommandPageTail(
          operation,
          command,
          metadata[metadata.length - 1] ?? predecessor,
        );
      }

      const settlementFrameBytes = checkedFrameMetadataBytes([
        command.reservation.byteLength,
        command.commandBudget.byteLength,
        command.outputManifest.byteLength,
        command.commandUsage.byteLength,
        command.resultingUsage.byteLength,
        command.nextProgress.byteLength,
        command.receipt.byteLength,
      ], operation);
      chargeOrThrow(
        operation,
        budget,
        usage,
        "frameBytes",
        settlementFrameBytes,
      );
      chargeOrThrow(
        operation,
        budget,
        usage,
        "canonicalBytes",
        settlementFrameBytes,
      );
      chargeOrThrow(
        operation,
        budget,
        usage,
        "hashBytes",
        settlementFrameBytes,
      );

      admitEvidencePageManifest(
        operation,
        finalPageMetadata,
        budget,
        usage,
      );
      if (predecessor !== null) {
        admitEvidencePageManifest(
          operation,
          predecessor,
          budget,
          usage,
        );
      }
      for (const page of metadata) {
        admitEvidencePageBytes(operation, page, budget, usage);
      }
      chargePageDimensionOrThrow(
        operation,
        budget,
        usage,
        "pages",
        metadata.length,
      );

      // Admit both byte-bearing statements before either statement can expose
      // a stored byte column.
      chargeSqlOrThrow(operation, budget, usage, 1);
      if (metadata.length > 0) {
        chargeSqlOrThrow(operation, budget, usage, metadata.length);
      }
      if (predecessor !== null) {
        chargeSqlOrThrow(operation, budget, usage, 1);
      }
      chargeSqlOrThrow(operation, budget, usage, 1);
      requireElapsedOrThrow(
        operation,
        budget,
        usage,
        start,
        monotonicMilliseconds,
      );

      const settlementQuery = tx
        .select({
          reservationBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.reservationBytes,
          commandBudgetBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.commandBudgetBytes,
          outputManifestBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.outputManifestBytes,
          commandUsageBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.commandUsageBytes,
          resultingUsageBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.resultingUsageBytes,
          nextProgressBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.nextProgressBytes,
          receiptBytes:
            fxSystemDeclarativeV2VerifierCommandsV2.receiptBytes,
        })
        .from(fxSystemDeclarativeV2VerifierCommandsV2)
        .where(historicalCommandWhere(input));
      observeDrizzleQuery(
        "settledReadSettlementFrames",
        settlementQuery,
        observer,
      );
      const settlementRows = await runStatement(() => settlementQuery);
      if (settlementRows.length !== 1) {
        throw corruption(operation, "rowCountMismatch");
      }

      const pageRows = metadata.length === 0
        ? []
        : await (async () => {
          const query = tx
            .select({
              pageOrdinal:
                fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
              manifestBytes:
                fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
              payloadBytes:
                fxSystemDeclarativeV2VerifierEvidencePagesV2.payloadBytes,
            })
            .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
            .where(and(
              historicalPageSelector(input),
              gte(
                fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
                input.startPageOrdinal,
              ),
            ))
            .orderBy(asc(
              fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
            ))
            .limit(metadata.length);
          observeDrizzleQuery("settledReadPageBytes", query, observer);
          return await runStatement(() => query);
        })();
      if (pageRows.length !== metadata.length) {
        throw corruption(operation, "missingPageWithinTail");
      }

      const predecessorManifestRows = predecessor === null
        ? []
        : await (async () => {
          const query = tx
            .select({
              manifestBytes:
                fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
            })
            .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
            .where(and(
              historicalPageSelector(input),
              eq(
                fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
                predecessor.pageOrdinal,
              ),
            ));
          observeDrizzleQuery(
            "settledReadPredecessorManifest",
            query,
            observer,
          );
          return await runStatement(() => query);
        })();
      if (
        predecessor !== null &&
        predecessorManifestRows.length !== 1
      ) {
        throw corruption(operation, "missingPageWithinTail");
      }

      const finalManifestQuery = tx
        .select({
          manifestBytes:
            fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
        })
        .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
        .where(and(
          historicalPageSelector(input),
          eq(
            fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
            finalPageMetadata.pageOrdinal,
          ),
        ));
      observeDrizzleQuery(
        "settledReadFinalPageManifest",
        finalManifestQuery,
        observer,
      );
      const finalManifestRows = await runStatement(() => finalManifestQuery);
      if (finalManifestRows.length !== 1) {
        throw corruption(operation, "missingPageWithinTail");
      }

      const pages: LoadedEvidencePageBytesV2[] = [];
      for (let index = 0; index < metadata.length; index += 1) {
        const page = metadata[index]!;
        const row = pageRows[index]!;
        if (row.pageOrdinal !== page.pageOrdinal) {
          throw corruption(operation, "missingPageWithinTail");
        }
        pages.push(Object.freeze({
          metadata: page,
          manifestBytes: copyStoredBytes(
            operation,
            row.manifestBytes,
            page.manifest.byteLength,
          ),
          payloadBytes: copyStoredBytes(
            operation,
            row.payloadBytes,
            page.payloadByteLength,
          ),
        }));
      }
      const settlementRow = settlementRows[0]!;
      const commandMetadata = detachDriverRows([commandRows[0]!])[0]!;
      return Object.freeze({
        commandMetadata,
        finalPageMetadata,
        predecessorMetadata: predecessor,
        reservationBytes: copyStoredFrameBytes(
          operation,
          settlementRow.reservationBytes,
          command.reservation.byteLength,
        ),
        commandBudgetBytes: copyStoredFrameBytes(
          operation,
          settlementRow.commandBudgetBytes,
          command.commandBudget.byteLength,
        ),
        outputManifestBytes: copyStoredFrameBytes(
          operation,
          settlementRow.outputManifestBytes,
          command.outputManifest.byteLength,
        ),
        commandUsageBytes: copyStoredFrameBytes(
          operation,
          settlementRow.commandUsageBytes,
          command.commandUsage.byteLength,
        ),
        resultingUsageBytes: copyStoredFrameBytes(
          operation,
          settlementRow.resultingUsageBytes,
          command.resultingUsage.byteLength,
        ),
        nextProgressBytes: copyStoredFrameBytes(
          operation,
          settlementRow.nextProgressBytes,
          command.nextProgress.byteLength,
        ),
        receiptBytes: copyStoredFrameBytes(
          operation,
          settlementRow.receiptBytes,
          command.receipt.byteLength,
        ),
        predecessorManifestBytes: predecessor === null
          ? null
          : copyStoredBytes(
            operation,
            predecessorManifestRows[0]!.manifestBytes,
            predecessor.manifest.byteLength,
          ),
        finalPageManifestBytes: copyStoredBytes(
          operation,
          finalManifestRows[0]!.manifestBytes,
          finalPageMetadata.manifest.byteLength,
        ),
        pages: Object.freeze(pages),
        next: nextOrdinal < command.pageCount
          ? Object.freeze({
            startPageOrdinal: nextOrdinal,
            expectedPredecessorPageSha256: new Uint8Array(
              metadata[metadata.length - 1]!.pageSha256,
            ),
          })
          : null,
      });
    },
  );
});

const decodeHistoricalSettledEvidencePageBatch = Effect.fn(
  "DeclarativeV2.verifierProgressV2.decodeHistoricalSettledEvidencePageBatch",
)(function (
  loaded: RawHistoricalSettledCommandRowsV2,
  input: CapturedSettledEvidencePageBatchInputV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  Readonly<{
    readonly settlement:
      DeclarativeV2VerifierProgressSettlementSnapshotV2;
    readonly pages:
      readonly DeclarativeV2VerifierProgressEvidencePageSnapshotV2[];
  }>,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  const operation = "readSettledEvidencePageBatch" as const;
  return Effect.gen(function* () {
    const reservationSha256 = yield* sha256(loaded.reservationBytes, {
      maximumInputBytes: loaded.reservationBytes.byteLength,
    });
    const commandBudgetSha256 = yield* sha256(loaded.commandBudgetBytes, {
      maximumInputBytes: loaded.commandBudgetBytes.byteLength,
    });
    const outputManifestSha256 = yield* sha256(
      loaded.outputManifestBytes,
      { maximumInputBytes: loaded.outputManifestBytes.byteLength },
    );
    const commandUsageSha256 = yield* sha256(loaded.commandUsageBytes, {
      maximumInputBytes: loaded.commandUsageBytes.byteLength,
    });
    const resultingUsageSha256 = yield* sha256(
      loaded.resultingUsageBytes,
      { maximumInputBytes: loaded.resultingUsageBytes.byteLength },
    );
    const nextProgressSha256 = yield* sha256(loaded.nextProgressBytes, {
      maximumInputBytes: loaded.nextProgressBytes.byteLength,
    });
    const receiptSha256 = yield* sha256(loaded.receiptBytes, {
      maximumInputBytes: loaded.receiptBytes.byteLength,
    });
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2(
        loaded.commandMetadata,
        {
          scopeId: input.scopeId,
          attemptSha256: input.attemptSha256,
          commandKind: input.commandKind,
          sequence: input.sequence,
          reservationSha256: input.reservationSha256,
          outputManifestSha256: input.outputManifestSha256,
          receiptSha256: input.receiptSha256,
        },
        loaded.reservationBytes,
        reservationSha256,
        loaded.commandBudgetBytes,
        commandBudgetSha256,
        {
          outputManifestBytes: loaded.outputManifestBytes,
          outputManifestObservedSha256: outputManifestSha256,
          commandUsageBytes: loaded.commandUsageBytes,
          commandUsageObservedSha256: commandUsageSha256,
          resultingUsageBytes: loaded.resultingUsageBytes,
          resultingUsageObservedSha256: resultingUsageSha256,
          nextProgressBytes: loaded.nextProgressBytes,
          nextProgressObservedSha256: nextProgressSha256,
          receiptBytes: loaded.receiptBytes,
          receiptObservedSha256: receiptSha256,
        },
        storedDecoderBudget(budget),
      ).pipe(
        Result.mapError(cause => mapStoredError(operation, cause)),
      ),
    );
    if (
      (loaded.predecessorMetadata === null) !==
        (loaded.predecessorManifestBytes === null)
    ) {
      return yield* corruption(operation, "normalizedMismatch");
    }
    if (
      loaded.predecessorMetadata !== null &&
      loaded.predecessorManifestBytes !== null
    ) {
      const predecessorSha256 = yield* sha256(
        loaded.predecessorManifestBytes,
        { maximumInputBytes: loaded.predecessorManifestBytes.byteLength },
      );
      yield* Effect.fromResult(
        decodeDeclarativeV2VerifierEvidencePageManifestV2(
          loaded.predecessorMetadata,
          loaded.predecessorManifestBytes,
          predecessorSha256,
          storedDecoderBudget(budget),
        ).pipe(
          Result.mapError(cause => mapStoredError(operation, cause)),
        ),
      );
    }
    const finalPageSha256 = yield* sha256(
      loaded.finalPageManifestBytes,
      { maximumInputBytes: loaded.finalPageManifestBytes.byteLength },
    );
    const finalPage = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierEvidencePageManifestV2(
        loaded.finalPageMetadata,
        loaded.finalPageManifestBytes,
        finalPageSha256,
        storedDecoderBudget(budget),
      ).pipe(
        Result.mapError(cause => mapStoredError(operation, cause)),
      ),
    );
    const finalValidation =
      validateDeclarativeV2VerifierFinalEvidencePageV2(
        finalPage.frame,
        finalPageSha256,
        decoded.settlement.outputManifest.frame,
      );
    if (Result.isFailure(finalValidation)) {
      return yield* corruption(operation, "normalizedMismatch");
    }
    const pages: DeclarativeV2VerifierProgressEvidencePageSnapshotV2[] = [];
    for (const row of loaded.pages) {
      pages.push(yield* decodeLoadedEvidencePage(
        operation,
        row,
        budget,
        sha256,
      ));
    }
    return Object.freeze({
      settlement: settlementSnapshotFromDecoded(decoded, operation),
      pages: Object.freeze(pages),
    });
  });
});

const loadFinalPageProofForSettlement = Effect.fn(
  "DeclarativeV2.verifierProgressV2.loadFinalPageProofForSettlement",
)(function (
  target: LocatedReadCommittedAttemptTargetV1,
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Effect.Effect<
  LoadedFinalPageProofV2 | null,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  if (
    work.commandKind !== "parse_module" &&
    work.commandKind !== "link_page"
  ) {
    return Effect.succeed(null);
  }
  return runTransactionWithConfirmedRollbackRetry(
    target,
    "settleCommand",
    state.scopeId,
    state.attemptSha256,
    budget,
    usage,
    () => 0,
    0,
    async (tx) => {
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const commandQuery = tx
        .select(commandMetadataSelection())
        .from(fxSystemDeclarativeV2VerifierCommandsV2)
        .where(commandWhere(state, work))
        .for("share");
      observeDrizzleQuery(
        "settlementCommandMetadata",
        commandQuery,
        observer,
      );
      const commandRows = await runStatement(() => commandQuery);
      requireOneRow("settleCommand", commandRows.length);
      const command = resultOrThrow(
        decodeDeclarativeV2VerifierCommandMetadataRowV2(commandRows[0]),
        "settleCommand",
      );
      if (command.settledAt !== null) {
        throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
          operation: "settleCommand",
          reason: "settlementChanged",
        });
      }
      if (command.pageCount < 1n || command.lastPageSha256 === null) {
        throw inputError("settleCommand", "commandMismatch");
      }
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const metadataQuery = tx
        .select(pageMetadataSelection())
        .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
        .where(and(
          pageSelector(state, work),
          eq(
            fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
            command.pageCount - 1n,
          ),
        ))
        .for("share");
      observeDrizzleQuery(
        "settlementFinalPageMetadata",
        metadataQuery,
        observer,
      );
      const metadataRows = await runStatement(() => metadataQuery);
      requireOneRow("settleCommand", metadataRows.length);
      const metadata = resultOrThrow(
        decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(metadataRows[0]),
        "settleCommand",
      );
      if (
        !bytesEqualFullScan(metadata.pageSha256, command.lastPageSha256)
      ) {
        throw corruption("settleCommand", "normalizedMismatch");
      }
      const manifestLength = checkedFrameMetadataBytes(
        [metadata.manifest.byteLength],
        "settleCommand",
      );
      chargeOrThrow(
        "settleCommand",
        budget,
        usage,
        "frameBytes",
        manifestLength,
      );
      chargeOrThrow(
        "settleCommand",
        budget,
        usage,
        "canonicalBytes",
        manifestLength,
      );
      chargeOrThrow(
        "settleCommand",
        budget,
        usage,
        "hashBytes",
        manifestLength,
      );
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const manifestQuery = tx
        .select({
          manifestBytes:
            fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
        })
        .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
        .where(and(
          pageSelector(state, work),
          eq(
            fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
            metadata.pageOrdinal,
          ),
        ));
      observeDrizzleQuery(
        "settlementFinalPageManifest",
        manifestQuery,
        observer,
      );
      const manifestRows = await runStatement(() => manifestQuery);
      requireOneRow("settleCommand", manifestRows.length);
      return Object.freeze({
        metadata,
        manifestBytes: copyStoredFrameBytes(
          "settleCommand",
          manifestRows[0]!.manifestBytes,
          metadata.manifest.byteLength,
        ),
      });
    },
  ).pipe(
    Effect.flatMap(loaded =>
      Effect.gen(function* () {
        const observedSha256 = yield* sha256(loaded.manifestBytes, {
          maximumInputBytes: loaded.manifestBytes.byteLength,
        });
        const decoded = yield* Effect.fromResult(
          decodeDeclarativeV2VerifierEvidencePageManifestV2(
            loaded.metadata,
            loaded.manifestBytes,
            observedSha256,
            storedDecoderBudget(budget),
          ).pipe(
            Result.mapError(cause => mapStoredError("settleCommand", cause)),
          ),
        );
        const finalValidation =
          validateDeclarativeV2VerifierFinalEvidencePageV2(
            decoded.frame,
            observedSha256,
            outputManifest,
          );
        if (Result.isFailure(finalValidation)) {
          return yield* inputError(
            "settleCommand",
            "commandMismatch",
            undefined,
            undefined,
            undefined,
            finalValidation.failure,
          );
        }
        return Object.freeze({
          metadata: loaded.metadata,
          manifest: decoded.frame,
          manifestBytes: new Uint8Array(decoded.canonicalBytes),
          pageSha256: new Uint8Array(observedSha256),
        });
      })
    ),
  );
});

async function lockPageCommandMetadata(
  tx: AppRowTransaction,
  operation: "appendEvidencePage" | "readEvidencePageBatch",
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<DeclarativeV2VerifierStoredCommandMetadataV2> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const query = tx
    .select(commandMetadataSelection())
    .from(fxSystemDeclarativeV2VerifierCommandsV2)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierCommandsV2.scopeId, state.scopeId),
      eq(
        fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
        state.attemptSha256,
      ),
      eq(fxSystemDeclarativeV2VerifierCommandsV2.sequence, work.sequence),
    ))
    .for("update");
  observeDrizzleQuery("pageCommandMetadata", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length === 0) {
    throw corruption(operation, "normalizedMismatch");
  }
  if (rows.length !== 1) throw corruption(operation, "selectorMismatch");
  return resultOrThrow(
    decodeDeclarativeV2VerifierCommandMetadataRowV2(rows[0]),
    operation,
  );
}

async function lockSettlementCommandMetadata(
  tx: AppRowTransaction,
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<Readonly<{
  readonly raw: unknown;
  readonly decoded: DeclarativeV2VerifierDecodedCommandStoredStateV2;
}>> {
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const metadataQuery = tx
    .select(commandMetadataSelection())
    .from(fxSystemDeclarativeV2VerifierCommandsV2)
    .where(commandWhere(state, work))
    .for("update");
  observeDrizzleQuery(
    "settlementCommandMetadata",
    metadataQuery,
    observer,
  );
  const metadataRows = await runStatement(() => metadataQuery);
  requireOneRow("settleCommand", metadataRows.length);
  const metadata = resultOrThrow(
    decodeDeclarativeV2VerifierCommandMetadataRowV2(metadataRows[0]),
    "settleCommand",
  );
  const total = checkedFrameMetadataBytes([
    metadata.reservation.byteLength,
    metadata.commandBudget.byteLength,
  ], "settleCommand");
  chargeOrThrow("settleCommand", budget, usage, "frameBytes", total);
  chargeOrThrow("settleCommand", budget, usage, "canonicalBytes", total);
  chargeOrThrow("settleCommand", budget, usage, "hashBytes", total);
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const framesQuery = tx
    .select({
      reservationBytes:
        fxSystemDeclarativeV2VerifierCommandsV2.reservationBytes,
      commandBudgetBytes:
        fxSystemDeclarativeV2VerifierCommandsV2.commandBudgetBytes,
    })
    .from(fxSystemDeclarativeV2VerifierCommandsV2)
    .where(commandWhere(state, work));
  observeDrizzleQuery("settlementCommandFrames", framesQuery, observer);
  const frameRows = await runStatement(() => framesQuery);
  requireOneRow("settleCommand", frameRows.length);
  const reservationBytes = copyStoredFrameBytes(
    "settleCommand",
    frameRows[0]!.reservationBytes,
    metadata.reservation.byteLength,
  );
  const commandBudgetBytes = copyStoredFrameBytes(
    "settleCommand",
    frameRows[0]!.commandBudgetBytes,
    metadata.commandBudget.byteLength,
  );
  if (
    !bytesEqualFullScan(reservationBytes, work.reservationBytes) ||
    !bytesEqualFullScan(commandBudgetBytes, work.commandBudgetBytes)
  ) {
    throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
      operation: "settleCommand",
      reason: "commandChanged",
    });
  }
  const decoded = resultOrThrow(
    decodeDeclarativeV2VerifierCommandStoredStateV2(
      metadataRows[0],
      state.attempt.candidateSha256,
      state.progressSha256,
      state.attempt.lastReceiptSha256,
      state.attempt.lifecycle,
      state.attempt.progress.phase,
      state.attempt.lifecycle,
      reservationBytes,
      metadata.reservation.sha256,
      commandBudgetBytes,
      metadata.commandBudget.sha256,
      null,
      storedDecoderBudget(budget),
    ),
    "settleCommand",
  );
  return Object.freeze({ raw: metadataRows[0], decoded });
}

async function requirePageSettlementProof(
  tx: AppRowTransaction,
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  command: DeclarativeV2VerifierStoredCommandMetadataV2,
  proof: LoadedFinalPageProofV2 | null,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<void> {
  const pageKind =
    work.commandKind === "parse_module" || work.commandKind === "link_page";
  if (!pageKind) {
    if (
      proof !== null ||
      command.pageCount !== 0n ||
      command.lastPageSha256 !== null
    ) {
      throw corruption("settleCommand", "normalizedMismatch");
    }
    return;
  }
  if (
    proof === null ||
    command.pageCount < 1n ||
    command.lastPageSha256 === null ||
    proof.metadata.pageOrdinal !== command.pageCount - 1n ||
    !bytesEqualFullScan(proof.pageSha256, command.lastPageSha256)
  ) {
    throw corruption("settleCommand", "normalizedMismatch");
  }
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const metadataQuery = tx
    .select(pageMetadataSelection())
    .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
    .where(and(
      pageSelector(state, work),
      eq(
        fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        proof.metadata.pageOrdinal,
      ),
    ))
    .for("update");
  observeDrizzleQuery(
    "settlementFinalPageMetadata",
    metadataQuery,
    observer,
  );
  const metadataRows = await runStatement(() => metadataQuery);
  requireOneRow("settleCommand", metadataRows.length);
  const metadata = resultOrThrow(
    decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(metadataRows[0]),
    "settleCommand",
  );
  if (
    !evidencePageMetadataEqual(metadata, proof.metadata) ||
    !bytesEqualFullScan(metadata.pageSha256, proof.pageSha256)
  ) {
    throw stale("settleCommand", "stateChanged");
  }
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const manifestQuery = tx
    .select({
      manifestBytes:
        fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
    })
    .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
    .where(and(
      pageSelector(state, work),
      eq(
        fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        proof.metadata.pageOrdinal,
      ),
    ));
  observeDrizzleQuery(
    "settlementFinalPageManifest",
    manifestQuery,
    observer,
  );
  const manifestRows = await runStatement(() => manifestQuery);
  requireOneRow("settleCommand", manifestRows.length);
  const manifestBytes = copyStoredFrameBytes(
    "settleCommand",
    manifestRows[0]!.manifestBytes,
    proof.metadata.manifest.byteLength,
  );
  if (!bytesEqualFullScan(manifestBytes, proof.manifestBytes)) {
    throw stale("settleCommand", "stateChanged");
  }
}

function evidencePageMetadataEqual(
  left: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  right: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
): boolean {
  return left.scopeId === right.scopeId &&
    bytesEqualFullScan(left.attemptSha256, right.attemptSha256) &&
    left.sequence === right.sequence &&
    left.commandKind === right.commandKind &&
    bytesEqualFullScan(left.reservationSha256, right.reservationSha256) &&
    left.pageOrdinal === right.pageOrdinal &&
    bytesEqualFullScan(left.pageSha256, right.pageSha256) &&
    left.firstEvidenceOrdinal === right.firstEvidenceOrdinal &&
    left.evidenceCount === right.evidenceCount &&
    left.firstDiagnosticOrdinal === right.firstDiagnosticOrdinal &&
    left.diagnosticCount === right.diagnosticCount &&
    optionalDigestEqual(
      left.predecessorPageSha256,
      right.predecessorPageSha256,
    ) &&
    bytesEqualFullScan(
      left.cumulativeDiagnosticsRootSha256,
      right.cumulativeDiagnosticsRootSha256,
    ) &&
    left.manifest.byteLength === right.manifest.byteLength &&
    bytesEqualFullScan(left.manifest.sha256, right.manifest.sha256) &&
    left.payloadByteLength === right.payloadByteLength &&
    bytesEqualFullScan(left.payloadSha256, right.payloadSha256);
}

function commandWhere(
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
) {
  return and(
    eq(fxSystemDeclarativeV2VerifierCommandsV2.scopeId, state.scopeId),
    eq(
      fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
      state.attemptSha256,
    ),
    eq(fxSystemDeclarativeV2VerifierCommandsV2.sequence, work.sequence),
    eq(
      fxSystemDeclarativeV2VerifierCommandsV2.reservationSha256,
      work.reservationSha256,
    ),
    eq(
      fxSystemDeclarativeV2VerifierCommandsV2.commandKind,
      work.commandKind,
    ),
  )!;
}

function pageMetadataSelection() {
  const table = fxSystemDeclarativeV2VerifierEvidencePagesV2;
  return {
    scopeId: table.scopeId,
    attemptSha256: table.attemptSha256,
    sequence: table.sequence,
    commandKind: table.commandKind,
    reservationSha256: table.reservationSha256,
    pageOrdinal: table.pageOrdinal,
    pageSha256: table.pageSha256,
    firstEvidenceOrdinal: table.firstEvidenceOrdinal,
    evidenceCount: table.evidenceCount,
    firstDiagnosticOrdinal: table.firstDiagnosticOrdinal,
    diagnosticCount: table.diagnosticCount,
    predecessorPageSha256: table.predecessorPageSha256,
    cumulativeDiagnosticsRootSha256: table.cumulativeDiagnosticsRootSha256,
    manifestCodecVersion: table.manifestCodecVersion,
    manifestByteLength: table.manifestByteLength,
    manifestSha256: table.manifestSha256,
    payloadCodecVersion: table.payloadCodecVersion,
    payloadByteLength: table.payloadByteLength,
    payloadSha256: table.payloadSha256,
    createdAt: table.createdAt,
  };
}

function pageSelector(
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
) {
  return and(
    eq(fxSystemDeclarativeV2VerifierEvidencePagesV2.scopeId, state.scopeId),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.attemptSha256,
      state.attemptSha256,
    ),
    eq(fxSystemDeclarativeV2VerifierEvidencePagesV2.sequence, work.sequence),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.reservationSha256,
      work.reservationSha256,
    ),
    eq(
      fxSystemDeclarativeV2VerifierEvidencePagesV2.commandKind,
      work.commandKind as "parse_module" | "link_page",
    ),
  )!;
}

async function readEvidencePageMetadataExact(
  tx: AppRowTransaction,
  operation: "appendEvidencePage" | "readEvidencePageBatch",
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  pageOrdinal: bigint,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
  forUpdate: boolean,
): Promise<DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const base = tx
    .select(pageMetadataSelection())
    .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
    .where(and(
      pageSelector(state, work),
      eq(
        fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        pageOrdinal,
      ),
    ));
  const query = forUpdate ? base.for("update") : base.for("share");
  observeDrizzleQuery("pageMetadata", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw corruption(operation, "selectorMismatch");
  return resultOrThrow(
    decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(rows[0]),
    operation,
  );
}

async function readEvidencePageMetadataBatch(
  tx: AppRowTransaction,
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  startPageOrdinal: bigint,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<readonly DeclarativeV2VerifierStoredEvidencePageMetadataV2[]> {
  chargeSqlOrThrow(
    "readEvidencePageBatch",
    budget,
    usage,
    budget.maximumPages,
  );
  const query = tx
    .select(pageMetadataSelection())
    .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
    .where(and(
      pageSelector(state, work),
      gte(
        fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        startPageOrdinal,
      ),
    ))
    .orderBy(asc(fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal))
    .limit(budget.maximumPages);
  observeDrizzleQuery("pageMetadata", query, observer);
  const rows = await runStatement(() => query);
  const decoded: DeclarativeV2VerifierStoredEvidencePageMetadataV2[] = [];
  for (const row of rows) {
    decoded.push(resultOrThrow(
      decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(row),
      "readEvidencePageBatch",
    ));
  }
  return Object.freeze(decoded);
}

async function readExactEvidencePageRows(
  tx: AppRowTransaction,
  operation: "appendEvidencePage",
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  pageOrdinal: bigint,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<LoadedEvidencePageBytesV2 | null> {
  const metadata = await readEvidencePageMetadataExact(
    tx,
    operation,
    state,
    work,
    pageOrdinal,
    budget,
    usage,
    observer,
    true,
  );
  if (metadata === null) return null;
  admitEvidencePageBytes(operation, metadata, budget, usage);
  chargeSqlOrThrow(operation, budget, usage, 1);
  const query = tx
    .select({
      manifestBytes:
        fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
      payloadBytes: fxSystemDeclarativeV2VerifierEvidencePagesV2.payloadBytes,
    })
    .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
    .where(and(
      pageSelector(state, work),
      eq(
        fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        pageOrdinal,
      ),
    ))
    .for("share");
  observeDrizzleQuery("pageBytes", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length !== 1) {
    throw corruption(operation, "missingPageWithinTail");
  }
  return Object.freeze({
    metadata,
    manifestBytes: copyStoredBytes(
      operation,
      rows[0]!.manifestBytes,
      metadata.manifest.byteLength,
    ),
    payloadBytes: copyStoredBytes(
      operation,
      rows[0]!.payloadBytes,
      metadata.payloadByteLength,
    ),
  });
}

async function readEvidencePageBytesBatch(
  tx: AppRowTransaction,
  state: MutableRunStateV2,
  work: MutableWorkStateV2,
  metadata:
    readonly DeclarativeV2VerifierStoredEvidencePageMetadataV2[],
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
  observer:
    DeclarativeV2VerifierProgressRepositoryOptionsV2["observeQuery"],
): Promise<readonly LoadedEvidencePageBytesV2[]> {
  if (metadata.length === 0) return Object.freeze([]);
  for (const page of metadata) {
    admitEvidencePageBytes(
      "readEvidencePageBatch",
      page,
      budget,
      usage,
    );
  }
  chargePageDimensionOrThrow(
    "readEvidencePageBatch",
    budget,
    usage,
    "pages",
    metadata.length,
  );
  chargeSqlOrThrow(
    "readEvidencePageBatch",
    budget,
    usage,
    metadata.length,
  );
  const firstOrdinal = metadata[0]!.pageOrdinal;
  const query = tx
    .select({
      pageOrdinal: fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
      manifestBytes:
        fxSystemDeclarativeV2VerifierEvidencePagesV2.manifestBytes,
      payloadBytes: fxSystemDeclarativeV2VerifierEvidencePagesV2.payloadBytes,
    })
    .from(fxSystemDeclarativeV2VerifierEvidencePagesV2)
    .where(and(
      pageSelector(state, work),
      gte(
        fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal,
        firstOrdinal,
      ),
    ))
    .orderBy(asc(fxSystemDeclarativeV2VerifierEvidencePagesV2.pageOrdinal))
    .limit(metadata.length);
  observeDrizzleQuery("pageBytes", query, observer);
  const rows = await runStatement(() => query);
  if (rows.length !== metadata.length) {
    throw corruption("readEvidencePageBatch", "missingPageWithinTail");
  }
  const loaded: LoadedEvidencePageBytesV2[] = [];
  for (let index = 0; index < metadata.length; index += 1) {
    const page = metadata[index]!;
    const row = rows[index]!;
    if (row.pageOrdinal !== page.pageOrdinal) {
      throw corruption("readEvidencePageBatch", "missingPageWithinTail");
    }
    loaded.push(Object.freeze({
      metadata: page,
      manifestBytes: copyStoredBytes(
        "readEvidencePageBatch",
        row.manifestBytes,
        page.manifest.byteLength,
      ),
      payloadBytes: copyStoredBytes(
        "readEvidencePageBatch",
        row.payloadBytes,
        page.payloadByteLength,
      ),
    }));
  }
  return Object.freeze(loaded);
}

function admitEvidencePageBytes(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
): void {
  const manifestLength = checkedInt64ByteLength(
    operation,
    metadata.manifest.byteLength,
  );
  const payloadLength = checkedInt64ByteLength(
    operation,
    metadata.payloadByteLength,
  );
  chargeOrThrow(operation, budget, usage, "frameBytes", manifestLength);
  chargeOrThrow(operation, budget, usage, "canonicalBytes", manifestLength);
  chargeOrThrow(
    operation,
    budget,
    usage,
    "hashBytes",
    checkedSafeAdd(manifestLength, payloadLength, operation),
  );
  chargePageDimensionOrThrow(
    operation,
    budget,
    usage,
    "payloadBytes",
    payloadLength,
  );
}

function admitEvidencePageManifest(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  usage: MutablePageOperationUsageV2,
): void {
  const manifestLength = checkedInt64ByteLength(
    operation,
    metadata.manifest.byteLength,
  );
  chargeOrThrow(operation, budget, usage, "frameBytes", manifestLength);
  chargeOrThrow(operation, budget, usage, "canonicalBytes", manifestLength);
  chargeOrThrow(operation, budget, usage, "hashBytes", manifestLength);
}

function copyStoredBytes(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  input: unknown,
  expectedLength: bigint,
): Uint8Array {
  const length = checkedInt64ByteLength(operation, expectedLength);
  if (!isUint8ArrayWithByteLength(input, length)) {
    throw corruption(operation, "invalidStoredBytes");
  }
  return new Uint8Array(input);
}

function copyStoredFrameBytes(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  input: unknown,
  expectedLength: bigint,
): Uint8Array {
  if (
    expectedLength < 0n ||
    expectedLength > BigInt(Number.MAX_SAFE_INTEGER) ||
    !isUint8ArrayWithByteLength(input, Number(expectedLength))
  ) {
    throw corruption(operation, "invalidStoredBytes");
  }
  return new Uint8Array(input);
}

function checkedInt64ByteLength(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  value: bigint,
): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw corruption(operation, "invalidMetadata");
  }
  return Number(value);
}

function checkedSafeAdd(
  left: number,
  right: number,
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
): number {
  if (left > Number.MAX_SAFE_INTEGER - right) {
    throw inputError(
      operation,
      "budgetExceeded",
      "hashBytes",
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );
  }
  return left + right;
}

function requirePendingWork(
  operation:
    | "appendEvidencePage"
    | "readEvidencePageBatch"
    | "settleCommand",
  attempt: DeclarativeV2VerifierStoredAttemptMetadataV2,
  run: MutableRunStateV2,
  work: MutableWorkStateV2,
): void {
  if (
    attempt.pendingKind !== work.commandKind ||
    attempt.pendingSequence !== work.sequence ||
    attempt.pendingReservationSha256 === null ||
    !bytesEqualFullScan(
      attempt.pendingReservationSha256,
      work.reservationSha256,
    ) ||
    attempt.pendingReservedByFence !== run.writerFence
  ) {
    throw stale(operation, "pendingChanged");
  }
}

function requirePageMetadataMatchesCaptured(
  metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  captured: CapturedEvidencePageV2,
): void {
  const frame = captured.manifest;
  if (
    metadata.commandKind !== frame.commandKind ||
    metadata.sequence !== frame.sequence ||
    metadata.pageOrdinal !== frame.pageOrdinal ||
    !bytesEqualFullScan(
      metadata.reservationSha256,
      frame.reservationSha256,
    ) ||
    !bytesEqualFullScan(metadata.pageSha256, captured.manifestSha256) ||
    metadata.firstEvidenceOrdinal !== frame.firstEvidenceOrdinal ||
    metadata.evidenceCount !== frame.evidenceCount ||
    metadata.firstDiagnosticOrdinal !== frame.firstDiagnosticOrdinal ||
    metadata.diagnosticCount !== frame.diagnosticCount ||
    !optionalDigestEqual(
      metadata.predecessorPageSha256,
      frame.predecessorPageSha256,
    ) ||
    metadata.payloadByteLength !== frame.payloadByteLength ||
    !bytesEqualFullScan(metadata.payloadSha256, captured.payloadSha256) ||
    !bytesEqualFullScan(
      metadata.cumulativeDiagnosticsRootSha256,
      frame.cumulativeDiagnosticsRootSha256,
    )
  ) {
    throw pageConflict("appendEvidencePage", "pageCollision");
  }
}

function requirePageCommand(
  operation: "appendEvidencePage" | "readEvidencePageBatch",
  command: DeclarativeV2VerifierStoredCommandMetadataV2,
  work: MutableWorkStateV2,
): void {
  if (
    (work.commandKind !== "parse_module" &&
      work.commandKind !== "link_page") ||
    command.commandKind !== work.commandKind ||
    command.sequence !== work.sequence ||
    !bytesEqualFullScan(
      command.reservationSha256,
      work.reservationSha256,
    )
  ) {
    throw inputError(operation, "commandMismatch");
  }
  if (
    command.outputManifest !== null ||
    command.commandUsage !== null ||
    command.resultingUsage !== null ||
    command.nextProgress !== null ||
    command.receipt !== null ||
    command.settledAt !== null
  ) {
    throw stale(operation, "pendingChanged");
  }
}

function requireAppendTransition(
  current: DeclarativeV2VerifierEvidencePageManifestFrameV2,
  command: DeclarativeV2VerifierStoredCommandMetadataV2,
  predecessor: DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null,
): void {
  if (current.pageOrdinal !== command.pageCount) {
    throw pageConflict("appendEvidencePage", "pageGap");
  }
  if (command.pageCount === 0n) {
    if (
      command.lastPageSha256 !== null ||
      predecessor !== null ||
      current.predecessorPageSha256 !== null ||
      current.firstEvidenceOrdinal !== 0n ||
      current.firstDiagnosticOrdinal !== 0n
    ) {
      throw pageConflict("appendEvidencePage", "predecessorMismatch");
    }
    return;
  }
  if (
    predecessor === null ||
    command.lastPageSha256 === null ||
    predecessor.pageOrdinal !== command.pageCount - 1n ||
    !bytesEqualFullScan(
      predecessor.pageSha256,
      command.lastPageSha256,
    )
  ) {
    throw corruption("appendEvidencePage", "missingPageWithinTail");
  }
  const transition =
    validateDeclarativeV2VerifierEvidencePageTransitionV2(
      evidencePageManifestFromMetadata(predecessor),
      predecessor.pageSha256,
      current,
    );
  if (Result.isFailure(transition)) {
    throw pageConflict("appendEvidencePage", "predecessorMismatch");
  }
}

function requireReadPredecessor(
  input: DeclarativeV2VerifierProgressReadEvidencePageBatchInputV2,
  predecessor: DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null,
): void {
  if (input.startPageOrdinal === 0n) {
    if (
      input.expectedPredecessorPageSha256 !== null ||
      predecessor !== null
    ) {
      throw pageConflict("readEvidencePageBatch", "predecessorMismatch");
    }
    return;
  }
  if (predecessor === null) {
    throw corruption("readEvidencePageBatch", "missingPageWithinTail");
  }
  if (
    input.expectedPredecessorPageSha256 === null ||
    !bytesEqualFullScan(
      predecessor.pageSha256,
      input.expectedPredecessorPageSha256,
    )
  ) {
    throw pageConflict("readEvidencePageBatch", "predecessorMismatch");
  }
}

function requireSettledReadPredecessor(
  input: CapturedSettledEvidencePageBatchInputV2,
  predecessor: DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null,
): void {
  const operation = "readSettledEvidencePageBatch" as const;
  if (input.startPageOrdinal === 0n) {
    if (
      predecessor !== null ||
      input.expectedPredecessorPageSha256 !== null
    ) {
      throw pageConflict(operation, "predecessorMismatch");
    }
    return;
  }
  if (predecessor === null) {
    throw corruption(operation, "missingPageWithinTail");
  }
  if (
    input.expectedPredecessorPageSha256 === null ||
    !bytesEqualFullScan(
      predecessor.pageSha256,
      input.expectedPredecessorPageSha256,
    )
  ) {
    throw pageConflict(operation, "predecessorMismatch");
  }
}

function requireReadBatchContinuity(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  startPageOrdinal: bigint,
  predecessor: DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null,
  metadata:
    readonly DeclarativeV2VerifierStoredEvidencePageMetadataV2[],
): void {
  let previous = predecessor;
  let expectedOrdinal = startPageOrdinal;
  for (const page of metadata) {
    if (page.pageOrdinal !== expectedOrdinal) {
      throw corruption(operation, "missingPageWithinTail");
    }
    if (previous === null) {
      if (
        page.predecessorPageSha256 !== null ||
        page.firstEvidenceOrdinal !== 0n ||
        page.firstDiagnosticOrdinal !== 0n
      ) {
        throw corruption(operation, "normalizedMismatch");
      }
    } else {
      const transition =
        validateDeclarativeV2VerifierEvidencePageTransitionV2(
          evidencePageManifestFromMetadata(previous),
          previous.pageSha256,
          evidencePageManifestFromMetadata(page),
        );
      if (Result.isFailure(transition)) {
        throw corruption(operation, "normalizedMismatch");
      }
    }
    previous = page;
    if (expectedOrdinal >= MAX_SIGNED_INT64) {
      if (page !== metadata[metadata.length - 1]) {
        throw corruption(operation, "normalizedMismatch");
      }
    } else {
      expectedOrdinal += 1n;
    }
  }
}

function requireCommandPageTail(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  command: DeclarativeV2VerifierStoredCommandMetadataV2,
  tail: DeclarativeV2VerifierStoredEvidencePageMetadataV2 | null,
): void {
  if (command.pageCount === 0n) {
    if (command.lastPageSha256 !== null || tail !== null) {
      throw corruption(operation, "normalizedMismatch");
    }
    return;
  }
  if (
    tail === null ||
    tail.pageOrdinal !== command.pageCount - 1n ||
    command.lastPageSha256 === null ||
    !bytesEqualFullScan(tail.pageSha256, command.lastPageSha256)
  ) {
    throw corruption(operation, "normalizedMismatch");
  }
}

function evidencePageManifestFromMetadata(
  metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
): DeclarativeV2VerifierEvidencePageManifestFrameV2 {
  return Object.freeze({
    kind: "evidence_page_manifest",
    reservationSha256: new Uint8Array(metadata.reservationSha256),
    commandKind: metadata.commandKind,
    sequence: metadata.sequence,
    pageOrdinal: metadata.pageOrdinal,
    firstEvidenceOrdinal: metadata.firstEvidenceOrdinal,
    evidenceCount: metadata.evidenceCount,
    firstDiagnosticOrdinal: metadata.firstDiagnosticOrdinal,
    diagnosticCount: metadata.diagnosticCount,
    predecessorPageSha256: metadata.predecessorPageSha256 === null
      ? null
      : new Uint8Array(metadata.predecessorPageSha256),
    payloadByteLength: metadata.payloadByteLength,
    payloadSha256: new Uint8Array(metadata.payloadSha256),
    cumulativeDiagnosticsRootSha256: new Uint8Array(
      metadata.cumulativeDiagnosticsRootSha256,
    ),
  });
}

function pageConflict(
  operation: DeclarativeV2VerifierProgressRepositoryPageOperationV2,
  reason:
    | "pageCollision"
    | "pageGap"
    | "predecessorMismatch",
): DeclarativeV2VerifierProgressRepositoryConflictV2Error {
  return new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
    operation,
    reason,
  });
}

const decodeLoadedEvidencePage: (
  operation: "readEvidencePageBatch" | "readSettledEvidencePageBatch",
  row: LoadedEvidencePageBytesV2,
  budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  sha256: DeclarativeV2Sha256V1,
) => Effect.Effect<
  DeclarativeV2VerifierProgressEvidencePageSnapshotV2,
  DeclarativeV2VerifierProgressRepositoryV2Error
> = Effect.fn(function* (
  operation,
  row,
  budget,
  sha256,
) {
    const manifestSha256 = yield* sha256(row.manifestBytes, {
      maximumInputBytes: row.manifestBytes.byteLength,
    });
    const payloadSha256 = yield* sha256(row.payloadBytes, {
      maximumInputBytes: row.payloadBytes.byteLength,
    });
    const manifest = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierEvidencePageManifestV2(
        row.metadata,
        row.manifestBytes,
        manifestSha256,
        {
          maximumFrameBytes: budget.maximumFrameBytes,
          maximumCanonicalBytes: budget.maximumCanonicalBytes,
          maximumPayloadBytes: budget.maximumPayloadBytes,
        },
        ).pipe(
          Result.mapError(cause =>
          mapStoredError(operation, cause)
        ),
      ),
    );
    const payload = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierEvidencePagePayloadV2(
        row.metadata,
        row.payloadBytes,
        payloadSha256,
        {
          maximumFrameBytes: budget.maximumFrameBytes,
          maximumCanonicalBytes: budget.maximumCanonicalBytes,
          maximumPayloadBytes: budget.maximumPayloadBytes,
        },
        ).pipe(
          Result.mapError(cause =>
          mapStoredError(operation, cause)
        ),
      ),
    );
    return Object.freeze({
      manifest: manifest.frame,
      manifestBytes: new Uint8Array(manifest.canonicalBytes),
      pageSha256: new Uint8Array(manifestSha256),
      payloadBytes: new Uint8Array(payload),
      payloadSha256: new Uint8Array(payloadSha256),
      createdAt: copyDate(row.metadata.createdAt),
    });
});

function decodeCommandRows(
  operation: "reserveCommand" | "resumePending",
  rows: RawCommandRowsV2,
  attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  _usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
  expectedReservation:
    DeclarativeV2VerifierCommandReservationFrameV2,
): Effect.Effect<
  LoadedCommandV2,
  DeclarativeV2VerifierProgressRepositoryV2Error
> {
  return Effect.gen(function* () {
    const reservationSha = yield* sha256(rows.reservationBytes, {
      maximumInputBytes: rows.reservationBytes.byteLength,
    });
    const commandBudgetSha = yield* sha256(rows.commandBudgetBytes, {
      maximumInputBytes: rows.commandBudgetBytes.byteLength,
    });
    const decodedMetadata = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierCommandMetadataRowV2(rows.metadata).pipe(
        Result.mapError(cause => mapStoredError(operation, cause)),
      ),
    );
    const decodedReservation = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierStoredFrameV2(
        decodedMetadata.reservation,
        rows.reservationBytes,
        reservationSha,
        "command_reservation",
        {
          maximumFrameBytes: budget.maximumFrameBytes,
          maximumCanonicalBytes: budget.maximumCanonicalBytes,
          maximumPayloadBytes: 0,
        },
      ).pipe(Result.mapError(cause => mapStoredError(operation, cause))),
    );
    if (
      !bytesEqualFullScan(
        decodedReservation.frame.currentProgressSha256,
        expectedReservation.currentProgressSha256,
      )
    ) {
      return yield* new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
        operation,
        reason: "commandChanged",
      });
    }
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2VerifierCommandStoredStateV2(
        rows.metadata,
        attempt.candidateSha256,
        expectedReservation.currentProgressSha256,
        attempt.lastReceiptSha256,
        attempt.lifecycle,
        attempt.progress.phase,
        attempt.lifecycle,
        rows.reservationBytes,
        reservationSha,
        rows.commandBudgetBytes,
        commandBudgetSha,
        null,
        {
          maximumFrameBytes: budget.maximumFrameBytes,
          maximumCanonicalBytes: budget.maximumCanonicalBytes,
          maximumPayloadBytes: 0,
        },
      ).pipe(Result.mapError(cause => mapStoredError(operation, cause))),
    );
    return Object.freeze({ decoded });
  });
}

function resultOrThrow<Value>(
  result: Result.Result<Value, DeclarativeV2VerifierProgressV2StoredRowError>,
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
): Value {
  if (Result.isFailure(result)) throw mapStoredError(operation, result.failure);
  return result.success;
}

function mapStoredError(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  cause: DeclarativeV2VerifierProgressV2StoredRowError,
): DeclarativeV2VerifierProgressRepositoryCorruptionV2Error {
  const reason =
    cause.reason === "digestMismatch" ? "digestMismatch" :
    cause.reason === "normalizedMismatch" ? "normalizedMismatch" :
    cause.reason === "invalidStoredBytes" ? "invalidStoredBytes" :
    "invalidMetadata";
  return corruption(operation, reason, cause);
}

function checkedFrameMetadataBytes(
  lengths: readonly bigint[],
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
): number {
  let total = 0n;
  for (const length of lengths) {
    if (length < 0n || length > BigInt(Number.MAX_SAFE_INTEGER) - total) {
      throw corruption(operation, "invalidMetadata");
    }
    total += length;
  }
  return Number(total);
}

function requireCapturedCommandEquals(
  operation: "reserveCommand" | "resumePending",
  expected: Readonly<{
    readonly reservation: CapturedFrameV2<
      DeclarativeV2VerifierCommandReservationFrameV2
    >;
    readonly commandBudget: CapturedFrameV2<
      DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" }
    >;
  }>,
  observed: LoadedCommandV2,
): void {
  if (
    !bytesEqualFullScan(
      expected.reservation.bytes,
      observed.decoded.reservation.canonicalBytes,
    ) ||
    !bytesEqualFullScan(
      expected.commandBudget.bytes,
      observed.decoded.commandBudget.canonicalBytes,
    )
  ) {
    throw new DeclarativeV2VerifierProgressRepositoryConflictV2Error({
      operation,
      reason: "commandChanged",
    });
  }
}

function snapshotAttempt(
  value: DeclarativeV2VerifierDecodedAttemptStoredStateV2,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    scopeId: value.metadata.scopeId,
    attemptSha256: new Uint8Array(value.metadata.attemptSha256),
    candidateSha256: new Uint8Array(value.metadata.candidateSha256),
    lifecycle: value.metadata.lifecycle,
    writerFence: value.metadata.writerFence,
    leaseExpiresAt: value.metadata.leaseExpiresAt === null
      ? null
      : copyDate(value.metadata.leaseExpiresAt),
    settledSequence: value.metadata.settledSequence,
    lastReceiptSha256: copyOptionalDigest(value.metadata.lastReceiptSha256),
    pendingKind: value.metadata.pendingKind,
    pendingSequence: value.metadata.pendingSequence,
    pendingReservationSha256:
      copyOptionalDigest(value.metadata.pendingReservationSha256),
    pendingReservedByFence: value.metadata.pendingReservedByFence,
    identitySha256: new Uint8Array(value.identity.sha256),
    ceilingsSha256: new Uint8Array(value.ceilings.sha256),
    usageSha256: new Uint8Array(value.usage.sha256),
    progressSha256: new Uint8Array(value.progress.sha256),
    identity: copyAttemptIdentity(value.identity.frame),
    ceilings: copyBudgetFrame(value.ceilings.frame),
    usage: copyBudgetFrame(value.usage.frame),
    progress: copyProgress(value.progress.frame),
  });
}

function copyAttemptSnapshot(
  value: DeclarativeV2VerifierProgressAttemptSnapshotV2,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    ...value,
    attemptSha256: new Uint8Array(value.attemptSha256),
    candidateSha256: new Uint8Array(value.candidateSha256),
    leaseExpiresAt: value.leaseExpiresAt === null
      ? null
      : copyDate(value.leaseExpiresAt),
    lastReceiptSha256: copyOptionalDigest(value.lastReceiptSha256),
    pendingReservationSha256:
      copyOptionalDigest(value.pendingReservationSha256),
    identitySha256: new Uint8Array(value.identitySha256),
    ceilingsSha256: new Uint8Array(value.ceilingsSha256),
    usageSha256: new Uint8Array(value.usageSha256),
    progressSha256: new Uint8Array(value.progressSha256),
    identity: copyAttemptIdentity(value.identity),
    ceilings: copyBudgetFrame(value.ceilings),
    usage: copyBudgetFrame(value.usage),
    progress: copyProgress(value.progress),
  });
}

function copyAttemptIdentity(
  value: DeclarativeV2VerifierAttemptIdentityFrameV2,
): DeclarativeV2VerifierAttemptIdentityFrameV2 {
  return Object.freeze({
    ...value,
    candidateSha256: new Uint8Array(value.candidateSha256),
    ceilingsSha256: new Uint8Array(value.ceilingsSha256),
  });
}

function copyBudgetFrame<Frame extends DeclarativeV2VerifierBudgetFrameV2>(
  value: Frame,
): Frame {
  return Object.freeze({
    kind: value.kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        value[dimension],
      ]),
    ),
  }) as Frame;
}

function copyProgress(
  value: DeclarativeV2VerifierProgressCursorFrameV2,
): DeclarativeV2VerifierProgressCursorFrameV2 {
  return Object.freeze({
    ...value,
    previousReceiptSha256:
      copyOptionalDigest(value.previousReceiptSha256),
  });
}

function copyReservation(
  value: DeclarativeV2VerifierCommandReservationFrameV2,
): DeclarativeV2VerifierCommandReservationFrameV2 {
  return Object.freeze({
    ...value,
    attemptSha256: new Uint8Array(value.attemptSha256),
    candidateSha256: new Uint8Array(value.candidateSha256),
    currentProgressSha256: new Uint8Array(value.currentProgressSha256),
    predecessorReceiptSha256:
      copyOptionalDigest(value.predecessorReceiptSha256),
    commandBudgetSha256: new Uint8Array(value.commandBudgetSha256),
    commandInputSha256: new Uint8Array(value.commandInputSha256),
    freshAuthenticatedInputSha256:
      new Uint8Array(value.freshAuthenticatedInputSha256),
    analyzerIdentitySha256: new Uint8Array(value.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(value.verifierIdentitySha256),
    rangeAndPredecessorTailsSha256:
      new Uint8Array(value.rangeAndPredecessorTailsSha256),
  });
}

function settlementCommandMetadata(
  raw: unknown,
  input: CapturedSettlementV2,
  settledAt: Date,
): unknown {
  if (typeof raw !== "object" || raw === null) {
    throw corruption("settleCommand", "invalidMetadata");
  }
  return {
    ...raw,
    outputManifestCodecVersion: FRAME_CODEC_VERSION,
    outputManifestByteLength: BigInt(input.outputManifest.bytes.byteLength),
    outputManifestSha256: input.outputManifest.sha256,
    commandUsageCodecVersion: FRAME_CODEC_VERSION,
    commandUsageByteLength: BigInt(input.commandUsage.bytes.byteLength),
    commandUsageSha256: input.commandUsage.sha256,
    resultingUsageCodecVersion: FRAME_CODEC_VERSION,
    resultingUsageByteLength: BigInt(input.resultingUsage.bytes.byteLength),
    resultingUsageSha256: input.resultingUsage.sha256,
    nextProgressCodecVersion: FRAME_CODEC_VERSION,
    nextProgressByteLength: BigInt(input.nextProgress.bytes.byteLength),
    nextProgressSha256: input.nextProgress.sha256,
    receiptCodecVersion: FRAME_CODEC_VERSION,
    receiptByteLength: BigInt(input.receipt.bytes.byteLength),
    receiptSha256: input.receipt.sha256,
    settledAt,
  };
}

function settlementDecoderInput(input: CapturedSettlementV2) {
  return Object.freeze({
    outputManifestBytes: input.outputManifest.bytes,
    outputManifestObservedSha256: input.outputManifest.sha256,
    commandUsageBytes: input.commandUsage.bytes,
    commandUsageObservedSha256: input.commandUsage.sha256,
    resultingUsageBytes: input.resultingUsage.bytes,
    resultingUsageObservedSha256: input.resultingUsage.sha256,
    nextProgressBytes: input.nextProgress.bytes,
    nextProgressObservedSha256: input.nextProgress.sha256,
    receiptBytes: input.receipt.bytes,
    receiptObservedSha256: input.receipt.sha256,
  });
}

function storedDecoderBudget(
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
) {
  return Object.freeze({
    maximumFrameBytes: budget.maximumFrameBytes,
    maximumCanonicalBytes: budget.maximumCanonicalBytes,
    maximumPayloadBytes: Number.MAX_SAFE_INTEGER,
  });
}

function projectSettledAttempt(
  value: DeclarativeV2VerifierProgressAttemptSnapshotV2,
  input: CapturedSettlementV2,
  sequence: bigint,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    ...copyAttemptSnapshot(value),
    lifecycle: input.nextLifecycle,
    settledSequence: sequence,
    lastReceiptSha256: new Uint8Array(input.receipt.sha256),
    pendingKind: null,
    pendingSequence: null,
    pendingReservationSha256: null,
    pendingReservedByFence: null,
    progressSha256: new Uint8Array(input.nextProgress.sha256),
    progress: copyProgress(input.nextProgress.frame),
  });
}

function settlementSnapshot(
  input: CapturedSettlementV2,
  work: MutableWorkStateV2,
  settledAt: Date,
): DeclarativeV2VerifierProgressSettlementSnapshotV2 {
  return Object.freeze({
    commandKind: work.commandKind,
    sequence: work.sequence,
    reservationSha256: new Uint8Array(work.reservationSha256),
    reservation: copyReservation(work.reservation),
    reservationBytes: new Uint8Array(work.reservationBytes),
    outputManifest: copyOutputManifest(input.outputManifest.frame),
    outputManifestBytes: new Uint8Array(input.outputManifest.bytes),
    commandUsage: copyBudgetFrame(input.commandUsage.frame),
    commandUsageBytes: new Uint8Array(input.commandUsage.bytes),
    resultingUsage: copyBudgetFrame(input.resultingUsage.frame),
    resultingUsageBytes: new Uint8Array(input.resultingUsage.bytes),
    nextProgress: copyProgress(input.nextProgress.frame),
    nextProgressBytes: new Uint8Array(input.nextProgress.bytes),
    receipt: copyReceipt(input.receipt.frame),
    receiptBytes: new Uint8Array(input.receipt.bytes),
    receiptSha256: new Uint8Array(input.receipt.sha256),
    settledAt: copyDate(settledAt),
  });
}

function settlementSnapshotFromDecoded(
  decoded: DeclarativeV2VerifierDecodedCommandStoredStateV2 & {
    readonly settlement: DeclarativeV2VerifierDecodedCommandSettlementV2;
  },
  operation:
    | "observeCommandDecision"
    | "readSettledEvidencePageBatch" = "observeCommandDecision",
): DeclarativeV2VerifierProgressSettlementSnapshotV2 {
  const settlement = decoded.settlement;
  if (decoded.metadata.settledAt === null) {
    throw corruption(operation, "normalizedMismatch");
  }
  return Object.freeze({
    commandKind: decoded.metadata.commandKind,
    sequence: decoded.metadata.sequence,
    reservationSha256:
      new Uint8Array(decoded.metadata.reservationSha256),
    reservation: copyReservation(decoded.reservation.frame),
    reservationBytes: new Uint8Array(decoded.reservation.canonicalBytes),
    outputManifest: copyOutputManifest(settlement.outputManifest.frame),
    outputManifestBytes:
      new Uint8Array(settlement.outputManifest.canonicalBytes),
    commandUsage: copyBudgetFrame(settlement.commandUsage.frame),
    commandUsageBytes: new Uint8Array(settlement.commandUsage.canonicalBytes),
    resultingUsage: copyBudgetFrame(settlement.resultingUsage.frame),
    resultingUsageBytes:
      new Uint8Array(settlement.resultingUsage.canonicalBytes),
    nextProgress: copyProgress(settlement.nextProgress.frame),
    nextProgressBytes:
      new Uint8Array(settlement.nextProgress.canonicalBytes),
    receipt: copyReceipt(settlement.receipt.frame),
    receiptBytes: new Uint8Array(settlement.receipt.canonicalBytes),
    receiptSha256: new Uint8Array(settlement.receipt.sha256),
    settledAt: copyDate(decoded.metadata.settledAt),
  });
}

function copyOutputManifest(
  value: DeclarativeV2VerifierCommandOutputManifestFrameV2,
): DeclarativeV2VerifierCommandOutputManifestFrameV2 {
  return Object.freeze({
    ...value,
    reservationSha256: new Uint8Array(value.reservationSha256),
    evidenceRootSha256: new Uint8Array(value.evidenceRootSha256),
    diagnosticsRootSha256:
      new Uint8Array(value.diagnosticsRootSha256),
    nextProgressSha256: new Uint8Array(value.nextProgressSha256),
  });
}

function copyReceipt(
  value: DeclarativeV2VerifierCommandReceiptFrameV2,
): DeclarativeV2VerifierCommandReceiptFrameV2 {
  return Object.freeze({
    ...value,
    reservationSha256: new Uint8Array(value.reservationSha256),
    commandUsageSha256: new Uint8Array(value.commandUsageSha256),
    resultingAttemptUsageSha256:
      new Uint8Array(value.resultingAttemptUsageSha256),
    outputManifestSha256: new Uint8Array(value.outputManifestSha256),
    nextProgressSha256: new Uint8Array(value.nextProgressSha256),
  });
}

function projectClaimedAttempt(
  value: DeclarativeV2VerifierProgressAttemptSnapshotV2,
  writerFence: bigint,
  leaseExpiresAt: Date,
  pendingReservedByFence: bigint | null,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    ...copyAttemptSnapshot(value),
    writerFence,
    leaseExpiresAt: copyDate(leaseExpiresAt),
    pendingReservedByFence,
  });
}

function projectReservedAttempt(
  value: DeclarativeV2VerifierProgressAttemptSnapshotV2,
  input: Readonly<{
    readonly reservation: CapturedFrameV2<
      DeclarativeV2VerifierCommandReservationFrameV2
    >;
  }>,
  resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  },
  resultingUsageSha256: Uint8Array,
  fence: bigint,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    ...copyAttemptSnapshot(value),
    pendingKind: input.reservation.frame.commandKind,
    pendingSequence: input.reservation.frame.sequence,
    pendingReservationSha256: new Uint8Array(input.reservation.sha256),
    pendingReservedByFence: fence,
    usage: copyBudgetFrame(resultingUsage),
    usageSha256: new Uint8Array(resultingUsageSha256),
  });
}

function requireFrameLineage(
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt"
  >,
  current: DeclarativeV2VerifierStoredAttemptMetadataV2,
  expected: DeclarativeV2VerifierStoredAttemptMetadataV2,
): void {
  if (
    !bytesEqualFullScan(current.attemptSha256, expected.attemptSha256) ||
    !bytesEqualFullScan(current.candidateSha256, expected.candidateSha256) ||
    current.lifecycle !== expected.lifecycle ||
    current.writerOwnerId !== expected.writerOwnerId ||
    current.writerFence !== expected.writerFence ||
    !optionalDateEqual(current.leaseUpdatedAt, expected.leaseUpdatedAt) ||
    !optionalDateEqual(current.leaseExpiresAt, expected.leaseExpiresAt) ||
    current.settledSequence !== expected.settledSequence ||
    !bytesEqualFullScan(current.identity.sha256, expected.identity.sha256) ||
    !bytesEqualFullScan(current.ceilings.sha256, expected.ceilings.sha256) ||
    !bytesEqualFullScan(current.usage.sha256, expected.usage.sha256) ||
    !bytesEqualFullScan(current.progress.sha256, expected.progress.sha256) ||
    current.pendingKind !== expected.pendingKind ||
    current.pendingSequence !== expected.pendingSequence ||
    !optionalDigestEqual(
      current.pendingReservationSha256,
      expected.pendingReservationSha256,
    ) ||
    current.pendingReservedByFence !== expected.pendingReservedByFence ||
    !optionalDigestEqual(
      current.lastReceiptSha256,
      expected.lastReceiptSha256,
    )
  ) {
    throw stale(operation, "stateChanged");
  }
}

function requireAcquireTransitionLineage(
  current: DeclarativeV2VerifierStoredAttemptMetadataV2,
  expected: DeclarativeV2VerifierStoredAttemptMetadataV2,
): void {
  if (
    !bytesEqualFullScan(current.attemptSha256, expected.attemptSha256) ||
    !bytesEqualFullScan(current.candidateSha256, expected.candidateSha256) ||
    current.lifecycle !== expected.lifecycle ||
    current.writerFence !== expected.writerFence ||
    current.settledSequence !== expected.settledSequence ||
    !optionalDigestEqual(
      current.lastReceiptSha256,
      expected.lastReceiptSha256,
    ) ||
    current.pendingKind !== expected.pendingKind ||
    current.pendingSequence !== expected.pendingSequence ||
    !optionalDigestEqual(
      current.pendingReservationSha256,
      expected.pendingReservationSha256,
    ) ||
    current.pendingReservedByFence !== expected.pendingReservedByFence ||
    !bytesEqualFullScan(current.identity.sha256, expected.identity.sha256) ||
    !bytesEqualFullScan(current.ceilings.sha256, expected.ceilings.sha256) ||
    !bytesEqualFullScan(current.usage.sha256, expected.usage.sha256) ||
    !bytesEqualFullScan(current.progress.sha256, expected.progress.sha256)
  ) {
    throw stale("acquire", "stateChanged");
  }
}

function optionalDateEqual(left: Date | null, right: Date | null): boolean {
  return left === null || right === null
    ? left === right
    : left.getTime() === right.getTime();
}

function requireRunLineage(
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt" | "acquire"
  >,
  current: DeclarativeV2VerifierStoredAttemptMetadataV2,
  state: MutableRunStateV2,
): void {
  if (
    !bytesEqualFullScan(current.attemptSha256, state.attemptSha256) ||
    !bytesEqualFullScan(
      current.candidateSha256,
      state.attempt.candidateSha256,
    ) ||
    current.lifecycle !== state.attempt.lifecycle ||
    current.settledSequence !== state.attempt.settledSequence ||
    !optionalDigestEqual(
      current.lastReceiptSha256,
      state.attempt.lastReceiptSha256,
    ) ||
    !bytesEqualFullScan(current.identity.sha256, state.identitySha256) ||
    !bytesEqualFullScan(current.ceilings.sha256, state.ceilingsSha256) ||
    !bytesEqualFullScan(current.usage.sha256, state.usageSha256) ||
    !bytesEqualFullScan(current.progress.sha256, state.progressSha256)
  ) {
    throw stale(operation, "stateChanged");
  }
}

function requireLiveOwner(
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt" | "acquire"
  >,
  locked:
    (DeclarativeV2VerifierStoredAttemptMetadataV2 & {
      readonly databaseNow: Date;
    }) | null,
  state: MutableRunStateV2,
): asserts locked is DeclarativeV2VerifierStoredAttemptMetadataV2 & {
  readonly databaseNow: Date;
} {
  if (locked === null) throw stale(operation, "stateChanged");
  if (
    locked.writerOwnerId !== state.ownerId ||
    locked.writerFence !== state.writerFence
  ) {
    throw stale(operation, "ownerChanged");
  }
  const now = databaseNowMilliseconds(locked);
  const expiry = optionalDateMilliseconds(locked.leaseExpiresAt);
  if (expiry === null || expiry === undefined || expiry <= now) {
    throw stale(operation, "leaseExpired");
  }
  if (isTerminal(locked.lifecycle)) {
    throw lifecycleError(operation, locked.lifecycle, state.attempt.progress.phase);
  }
}

function ownerWhere(state: MutableRunStateV2) {
  return and(
    eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, state.scopeId),
    eq(
      fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
      state.attemptSha256,
    ),
    eq(fxSystemDeclarativeV2VerifierAttemptsV2.writerOwnerId, state.ownerId),
    eq(fxSystemDeclarativeV2VerifierAttemptsV2.writerFence, state.writerFence),
  )!;
}

function databaseNowMilliseconds(
  value: Readonly<{ readonly databaseNow: Date }>,
): number {
  const milliseconds = value.databaseNow.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw corruption("acquire", "invalidMetadata");
  }
  return milliseconds;
}

function optionalDateMilliseconds(value: Date | null): number | null | undefined {
  if (value === null) return null;
  const milliseconds = value.getTime();
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function checkedExpiry(now: number, duration: number): Date {
  if (!Number.isSafeInteger(now) || now > Number.MAX_SAFE_INTEGER - duration) {
    throw new DeclarativeV2VerifierProgressRepositoryConfigurationV2Error({
      reason: "invalidClaimDuration",
    });
  }
  const result = new Date(now + duration);
  if (!Number.isFinite(result.getTime())) {
    throw new DeclarativeV2VerifierProgressRepositoryConfigurationV2Error({
      reason: "invalidClaimDuration",
    });
  }
  return result;
}

function parseNonNegativeSafeIntegerText(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isTerminal(
  lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
): boolean {
  return lifecycle === "ready" ||
    lifecycle === "rejected" ||
    lifecycle === "abandoned";
}

function prepareWorkToken(
  run: DeclarativeV2VerifierProgressRunV2,
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  reservationBytes: Uint8Array,
  reservationSha256: Uint8Array,
  commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  },
  commandBudgetBytes: Uint8Array,
  authenticatedAuthority: CapturedCommandAuthorityV1 | null,
) {
  const work = Object.freeze({
    _tag: "DeclarativeV2VerifierProgressWorkV2" as const,
  });
  const state: MutableWorkStateV2 = {
    run,
    commandKind: reservation.commandKind,
    sequence: reservation.sequence,
    reservationSha256: new Uint8Array(reservationSha256),
    reservation: copyReservation(reservation),
    reservationBytes: new Uint8Array(reservationBytes),
    commandBudget: copyBudgetFrame(commandBudget),
    commandBudgetBytes: new Uint8Array(commandBudgetBytes),
    authenticatedAuthority,
    closed: false,
  };
  return Object.freeze({ work, state });
}

function withRun<Value, Failure, Requirements>(
  runs: WeakMap<object, MutableRunStateV2>,
  run: DeclarativeV2VerifierProgressRunV2,
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt" | "acquire"
  >,
  use: (
    state: MutableRunStateV2,
  ) => Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<
  Value,
  Failure | DeclarativeV2VerifierProgressRepositoryInputV2Error,
  Requirements
> {
  return Effect.gen(function* () {
    const state = yield* lookupRun(runs, run, operation);
    return yield* state.gate.withPermit(
      lookupRun(runs, run, operation).pipe(
        Effect.flatMap(use),
        Effect.onInterrupt(() => Effect.sync(() => {
          state.closed = true;
        })),
      ),
    );
  });
}

function withWork<Value, Failure, Requirements>(
  runs: WeakMap<object, MutableRunStateV2>,
  works: WeakMap<object, MutableWorkStateV2>,
  work: DeclarativeV2VerifierProgressWorkV2,
  operation:
    | "appendEvidencePage"
    | "readEvidencePageBatch"
    | "settleCommand",
  use: (
    runState: MutableRunStateV2,
    workState: MutableWorkStateV2,
  ) => Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<
  Value,
  Failure | DeclarativeV2VerifierProgressRepositoryInputV2Error,
  Requirements
> {
  const workState = typeof work === "object" && work !== null
    ? works.get(work)
    : undefined;
  if (workState === undefined) {
    return Effect.fail(inputError(operation, "invalidWork"));
  }
  if (workState.closed) {
    return Effect.fail(inputError(operation, "workClosed"));
  }
  return withRun(runs, workState.run, operation, runState =>
    use(runState, workState)
  );
}

function lookupRun(
  runs: WeakMap<object, MutableRunStateV2>,
  run: DeclarativeV2VerifierProgressRunV2,
  operation: Exclude<
    DeclarativeV2VerifierProgressRepositoryOperationV2,
    "createAttempt" | "observeAttempt" | "acquire"
  >,
) {
  const state = typeof run === "object" && run !== null
    ? runs.get(run)
    : undefined;
  if (state === undefined) return Effect.fail(inputError(operation, "invalidRun"));
  if (state.closed) return Effect.fail(inputError(operation, "runClosed"));
  return Effect.succeed(state);
}

function closeRun(
  state: MutableRunStateV2,
  activeRuns: Map<
    string,
    Readonly<{
      readonly run: DeclarativeV2VerifierProgressRunV2;
      readonly state: MutableRunStateV2;
    }>
  >,
): void {
  state.closed = true;
  const key = selectorKey(state.scopeId, state.attemptSha256);
  const current = activeRuns.get(key);
  if (current?.state === state) activeRuns.delete(key);
}

function closeRunOnFailure(
  state: MutableRunStateV2,
  activeRuns: Map<
    string,
    Readonly<{
      readonly run: DeclarativeV2VerifierProgressRunV2;
      readonly state: MutableRunStateV2;
    }>
  >,
) {
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.tapError(error =>
        shouldCloseRunAfterFailure(error)
          ? Effect.sync(() => closeRun(state, activeRuns))
          : Effect.void
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => closeRun(state, activeRuns))
      ),
    );
}

function shouldCloseRunAfterFailure(error: unknown): boolean {
  return error instanceof DeclarativeV2VerifierProgressRepositoryStaleV2Error ||
    error instanceof
      DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error ||
    error instanceof
      DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error ||
    error instanceof DeclarativeV2VerifierProgressRepositoryResourceV2Error;
}

function selectorKey(scopeId: string, digest: Uint8Array): string {
  let text = `${scopeId}:`;
  for (let index = 0; index < digest.byteLength; index += 1) {
    text += digest[index]!.toString(16).padStart(2, "0");
  }
  return text;
}

function requireOneRow(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  length: number,
): void {
  if (length !== 1) throw corruption(operation, "rowCountMismatch");
}

function optionalDigestEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right);
}

function copyOptionalDigest(value: Uint8Array | null): Uint8Array | null {
  return value === null ? null : new Uint8Array(value);
}

function copyDate(value: Date): Date {
  return new Date(value.getTime());
}

function runTransactionWithConfirmedRollbackRetry<Value>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  scopeId: string,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  monotonicMilliseconds: () => number,
  start: number,
  work: (tx: AppRowTransaction) => Promise<Value>,
): Effect.Effect<Value, DeclarativeV2VerifierProgressRepositoryV2Error> {
  const attempt = () =>
    Effect.fromResult(setElapsed(
      operation,
      budget,
      usage,
      start,
      monotonicMilliseconds,
    )).pipe(
      Effect.flatMap(() =>
        awaitSettlement(target[RUN_LOCATED_READ_COMMITTED_V1](work)).pipe(
          Effect.mapError(cause =>
            mapTransactionFailure(
              operation,
              scopeId,
              attemptSha256,
              cause,
            )
          ),
        )
      ),
    );
  return Effect.suspend(attempt).pipe(
    Effect.catchIf(
      (error): error is
        DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error =>
        error instanceof
          DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error &&
        error.retryable,
      () => Effect.suspend(attempt),
    ),
  );
}

function awaitSettlement<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptibleMask(restore =>
    restore(Effect.tryPromise({
      try: () => transaction,
      catch: cause => cause,
    })).pipe(
      Effect.onInterrupt(() =>
        Effect.promise(() =>
          transaction.then(() => undefined, () => undefined)
        )
      ),
    )
  );
}

function mapTransactionFailure(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  scopeId: string,
  attemptSha256: Uint8Array,
  cause: unknown,
): DeclarativeV2VerifierProgressRepositoryV2Error {
  if (isRepositoryError(cause)) return cause;
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    switch (cause.issue.kind) {
      case "callbackRolledBack": {
        const callbackCause = cause.issue.callbackCause;
        if (isRepositoryError(callbackCause)) return callbackCause;
        if (callbackCause instanceof RepositoryBudgetFailureV2) {
          return callbackCause.error;
        }
        if (callbackCause instanceof RepositoryStatementFailureV2) {
          return new
            DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error({
              operation,
              cause: callbackCause.cause,
              retryable: isRetryableTransactionCause(callbackCause.cause),
            });
        }
        throw callbackCause;
      }
      case "decisionUncertain":
        return new
          DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error({
            operation,
            scopeId,
            attemptSha256: new Uint8Array(attemptSha256),
            cause,
          });
      case "callbackCleanupFailed":
        return new DeclarativeV2VerifierProgressRepositoryResourceV2Error({
          operation,
          phase: "cleanup",
          cause,
        });
      case "infrastructureFailure":
        return new DeclarativeV2VerifierProgressRepositoryResourceV2Error({
          operation,
          phase: "infrastructure",
          cause,
        });
    }
  }
  if (cause instanceof RepositoryStatementFailureV2) {
    return new DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error({
      operation,
      cause: cause.cause,
      retryable: isRetryableTransactionCause(cause.cause),
    });
  }
  throw cause;
}

async function runStatement<Value>(
  statement: () => Promise<Value>,
): Promise<Value> {
  try {
    return await statement();
  } catch (cause) {
    if (
      isRepositoryError(cause) ||
      cause instanceof RepositoryBudgetFailureV2
    ) {
      throw cause;
    }
    throw new RepositoryStatementFailureV2(cause);
  }
}

function isRepositoryError(
  value: unknown,
): value is DeclarativeV2VerifierProgressRepositoryV2Error {
  return value instanceof
      DeclarativeV2VerifierProgressRepositoryConfigurationV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryInputV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryNotFoundV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryBusyV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryStaleV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryConflictV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryLifecycleV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryCorruptionV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryExhaustionV2Error ||
    value instanceof
      DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error ||
    value instanceof
      DeclarativeV2VerifierProgressRepositoryDecisionUncertainV2Error ||
    value instanceof DeclarativeV2VerifierProgressRepositoryResourceV2Error;
}

function isRetryableTransactionCause(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, "code");
    } catch {
      return false;
    }
    if (
      descriptor !== undefined &&
      Object.hasOwn(descriptor, "value") &&
      (descriptor.value === "40001" || descriptor.value === "40P01")
    ) {
      return true;
    }
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, "cause");
    } catch {
      return false;
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return false;
    }
    current = descriptor.value;
  }
  return false;
}

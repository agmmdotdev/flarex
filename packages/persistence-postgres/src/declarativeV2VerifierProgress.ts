import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  isLowercaseUuidText,
} from "@flarex/utils/strings";
import {
  and,
  desc,
  eq,
  gt,
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
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
  DECLARATIVE_V2_SHA256_BYTES_V1,
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2AttemptIdentityFrameV1,
  type DeclarativeV2AttemptLifecycleV1,
  type DeclarativeV2BudgetDimensionV1,
  type DeclarativeV2BudgetFrameV1,
  type DeclarativeV2CommandKindV1,
  type DeclarativeV2CommandReceiptFrameV1,
  type DeclarativeV2CommandReservationFrameV1,
  type DeclarativeV2DiagnosticFrameV1,
  type DeclarativeV2EncodedFrameV1,
  type DeclarativeV2FrontierEntryFrameV1,
  type DeclarativeV2ImportEdgeFrameV1,
  type DeclarativeV2LinkNodeFrameV1,
  type DeclarativeV2ModuleSummaryFrameV1,
  type DeclarativeV2PageManifestFrameV1,
  type DeclarativeV2PhysicalFrameV1,
  type DeclarativeV2PhysicalFrameV1Error,
  type DeclarativeV2ProgressCursorFrameV1,
  type DeclarativeV2RegistrationFrameV1,
  type DeclarativeV2VerifierPhaseV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  captureDeclarativeV2PageEvidenceKeyV1,
  compareDeclarativeV2PageEvidenceKeyV1,
  encodeDeclarativeV2PageEvidenceRootV1,
  type DeclarativeV2InertObjectReferenceEvidenceV1,
  type DeclarativeV2PageDispositionV1,
  type DeclarativeV2PageEvidenceKeyV1,
  type DeclarativeV2PageEvidenceRootV1Error,
} from "flarex-protocol/internal/declarative-v2-verification-evidence-v1";
import {
  ScopeIdSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  buildDeclarativeV2CommandOutputManifestPreimageV1,
  buildDeclarativeV2ModulePathProjectionPreimageV1,
  type DeclarativeV2ModulePathProjectionPreimageV1,
  type DeclarativeV2SettledEvidenceKeyV1,
  type DeclarativeV2VerifierDerivationInputV1Error,
} from "./declarativeV2VerifierDerivations";
import {
  makeDeclarativeV2InertRepositoryV1,
  type DeclarativeV2InertRepositoryReadV1Error,
  type DeclarativeV2InertRepositoryV1Error,
} from "./declarativeV2InertRepository";
import {
  makeLiveDeclarativeV2Sha256V1,
  DeclarativeV2Sha256InputV1Error,
  DeclarativeV2Sha256ResourceV1Error,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  fxSystemDeclarativeV2Diagnostics,
  fxSystemDeclarativeV2FrontierEntries,
  fxSystemDeclarativeV2ImportEdges,
  fxSystemDeclarativeV2LinkNodes,
  fxSystemDeclarativeV2ModuleSummaries,
  fxSystemDeclarativeV2PageManifests,
  fxSystemDeclarativeV2Registrations,
  fxSystemDeclarativeV2VerifierAttempts,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const ATTEMPT_PROTOCOL_IDENTITY =
  "flarex.declarative-v2/verifier-progress-page-evidence/v1";
const MAX_FENCE = DECLARATIVE_V2_MAX_SIGNED_INT64_V1;

export type DeclarativeV2VerifierProgressOperationV1 =
  | "createAttempt"
  | "observeAttempt"
  | "acquire"
  | "renew"
  | "reserveCommand"
  | "resumePending"
  | "settleCommand"
  | "observeSettledPhaseTails"
  | "release"
  | "abandon";

export interface DeclarativeV2VerifierProgressOperationBudgetV1 {
  readonly maximumCalls: number;
  readonly maximumRows: number;
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumHashBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface DeclarativeV2VerifierProgressOperationUsageV1 {
  readonly calls: number;
  readonly rows: number;
  readonly frameBytes: number;
  readonly canonicalBytes: number;
  readonly hashBytes: number;
  readonly elapsedMilliseconds: number;
}

export interface DeclarativeV2VerifierProgressOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly randomUuid?: () => string;
  readonly monotonicMilliseconds?: () => number;
}

export class DeclarativeV2VerifierProgressConfigurationV1Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressConfigurationV1Error",
  )<{
    readonly reason: "invalidClaimDuration" | "invalidMonotonicClock";
  }> {}

export class DeclarativeV2VerifierProgressInputV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressInputV1Error")<{
    readonly operation: DeclarativeV2VerifierProgressOperationV1;
    readonly reason:
      | "invalidInput"
      | "invalidBudget"
      | "budgetExceeded"
      | "invalidRun"
      | "runClosed"
      | "invalidWork"
      | "workClosed"
      | "commandMismatch";
    readonly dimension?: keyof DeclarativeV2VerifierProgressOperationUsageV1;
    readonly observed?: number;
    readonly maximum?: number;
    readonly semanticDimension?: DeclarativeV2BudgetDimensionV1;
    readonly observedSemantic?: bigint;
    readonly maximumSemantic?: bigint;
    readonly codecCause?: DeclarativeV2PhysicalFrameV1Error;
    readonly derivationCause?: DeclarativeV2VerifierDerivationInputV1Error;
    readonly evidenceCause?: DeclarativeV2PageEvidenceRootV1Error;
  }> {}

export class DeclarativeV2VerifierProgressBusyV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressBusyV1Error")<{
    readonly operation: "acquire";
    readonly claimExpiresAt: Date;
  }> {}

export class DeclarativeV2VerifierProgressStaleV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressStaleV1Error")<{
    readonly operation: Exclude<
      DeclarativeV2VerifierProgressOperationV1,
      "createAttempt" | "observeAttempt"
    >;
    readonly reason:
      | "ownerChanged"
      | "leaseExpired"
      | "stateChanged"
      | "pendingChanged";
  }> {}

export class DeclarativeV2VerifierProgressLifecycleV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressLifecycleV1Error")<{
    readonly operation: Exclude<
      DeclarativeV2VerifierProgressOperationV1,
      "createAttempt" | "observeAttempt"
    >;
    readonly lifecycle: DeclarativeV2AttemptLifecycleV1;
    readonly phase: DeclarativeV2VerifierPhaseV1;
  }> {}

export class DeclarativeV2VerifierProgressCollisionV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressCollisionV1Error")<{
    readonly operation:
      | "createAttempt"
      | "reserveCommand"
      | "settleCommand";
    readonly reason:
      | "attemptChanged"
      | "commandChanged"
      | "immutableEvidenceChanged"
      | "pageRangeConflict"
      | "mutableEvidenceChanged";
  }> {}

export class DeclarativeV2VerifierProgressCorruptionV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressCorruptionV1Error")<{
    readonly operation: DeclarativeV2VerifierProgressOperationV1;
    readonly reason:
      | "invalidMetadata"
      | "invalidStoredBytes"
      | "digestMismatch"
      | "normalizedMismatch"
      | "driverResultInvalid"
      | "selectorMismatch"
      | "unsupportedProtocol";
    readonly codecCause?: DeclarativeV2PhysicalFrameV1Error;
  }> {}

export class DeclarativeV2VerifierProgressExhaustionV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressExhaustionV1Error")<{
    readonly operation: "acquire" | "reserveCommand" | "settleCommand";
    readonly dimension:
      | "writerFence"
      | "settledSequence"
      | "moduleOrdinal"
      | "edgeOrdinal"
      | "pageOrdinal";
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class DeclarativeV2VerifierProgressConfirmedRollbackV1Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressConfirmedRollbackV1Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressOperationV1;
    readonly cause: unknown;
  }> {}

export class DeclarativeV2VerifierProgressDecisionUncertainV1Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressDecisionUncertainV1Error",
  )<{
    readonly operation: DeclarativeV2VerifierProgressOperationV1;
    readonly scopeId: string;
    readonly attemptSha256: Uint8Array;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class DeclarativeV2VerifierProgressResourceV1Error
  extends Data.TaggedError("DeclarativeV2VerifierProgressResourceV1Error")<{
    readonly operation: DeclarativeV2VerifierProgressOperationV1;
    readonly phase: "cleanup" | "infrastructure";
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export type DeclarativeV2VerifierProgressV1Error =
  | DeclarativeV2VerifierProgressConfigurationV1Error
  | DeclarativeV2VerifierProgressInputV1Error
  | DeclarativeV2VerifierProgressBusyV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error
  | DeclarativeV2VerifierProgressCollisionV1Error
  | DeclarativeV2VerifierProgressCorruptionV1Error
  | DeclarativeV2VerifierProgressExhaustionV1Error
  | DeclarativeV2VerifierProgressConfirmedRollbackV1Error
  | DeclarativeV2VerifierProgressDecisionUncertainV1Error
  | DeclarativeV2VerifierProgressResourceV1Error
  | DeclarativeV2InertRepositoryV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierTransactionV1Error =
  | DeclarativeV2VerifierProgressConfirmedRollbackV1Error
  | DeclarativeV2VerifierProgressDecisionUncertainV1Error
  | DeclarativeV2VerifierProgressResourceV1Error;

type VerifierBaseV1Error =
  | DeclarativeV2VerifierProgressConfigurationV1Error
  | DeclarativeV2VerifierProgressInputV1Error
  | DeclarativeV2VerifierProgressCorruptionV1Error
  | VerifierTransactionV1Error;

type VerifierCreateAttemptV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressCollisionV1Error
  | DeclarativeV2InertRepositoryReadV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierObserveAttemptV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierAcquireV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressBusyV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error
  | DeclarativeV2VerifierProgressExhaustionV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierRenewV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error;

type VerifierReserveV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error
  | DeclarativeV2VerifierProgressCollisionV1Error
  | DeclarativeV2VerifierProgressExhaustionV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierResumeV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierSettleV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error
  | DeclarativeV2VerifierProgressCollisionV1Error
  | DeclarativeV2VerifierProgressExhaustionV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierObserveTailsV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error
  | DeclarativeV2Sha256V1Error;

type VerifierCloseV1Error =
  | VerifierBaseV1Error
  | DeclarativeV2VerifierProgressStaleV1Error
  | DeclarativeV2VerifierProgressLifecycleV1Error;

export interface DeclarativeV2VerifierRunV1 {
  readonly _tag: "DeclarativeV2VerifierRunV1";
}

export interface DeclarativeV2VerifierWorkV1 {
  readonly _tag: "DeclarativeV2VerifierWorkV1";
}

export interface DeclarativeV2VerifierAttemptObservationV1 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly lifecycle: DeclarativeV2AttemptLifecycleV1;
  readonly writerFence: bigint;
  readonly claimExpiresAt: Date | null;
  readonly settledSequence: bigint;
  readonly lastCommandSha256: Uint8Array | null;
  readonly lastReceipt: DeclarativeV2CommandReceiptFrameV1 | null;
  readonly pendingKind: DeclarativeV2CommandKindV1 | null;
  readonly pendingSequence: bigint | null;
  readonly pendingCommandSha256: Uint8Array | null;
  readonly pendingReservedByFence: bigint | null;
  readonly identity: DeclarativeV2AttemptIdentityFrameV1;
  readonly ceilings: DeclarativeV2BudgetFrameV1;
  readonly usage: DeclarativeV2BudgetFrameV1;
  readonly progress: DeclarativeV2ProgressCursorFrameV1;
}

export type DeclarativeV2VerifierObserveResultV1 =
  | Readonly<{
    readonly kind: "missing";
    readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
  }>
  | Readonly<{
    readonly kind: "present";
    readonly attempt: DeclarativeV2VerifierAttemptObservationV1;
    readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
  }>;

export type DeclarativeV2VerifierAcquireResultV1 =
  | Readonly<{
    readonly kind: "missing";
    readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
  }>
  | Readonly<{
    readonly kind: "acquired";
    readonly run: DeclarativeV2VerifierRunV1;
    readonly attempt: DeclarativeV2VerifierAttemptObservationV1;
    readonly claimExpiresAt: Date;
    readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
  }>;

export interface DeclarativeV2VerifierCreateAttemptInputV1 {
  readonly scopeId: string;
  readonly candidateSha256: Uint8Array;
  readonly ceilings: DeclarativeV2BudgetFrameV1;
}

export interface DeclarativeV2VerifierReserveCommandInputV1 {
  readonly commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">;
  readonly sequence: bigint;
  readonly previousReceiptSha256: Uint8Array | null;
  readonly commandBudget: DeclarativeV2BudgetFrameV1;
  readonly inputSha256: Uint8Array;
}

export type DeclarativeV2VerifierReserveResultV1 =
  | Readonly<{
    readonly kind: "reserved" | "pendingReplay";
    readonly work: DeclarativeV2VerifierWorkV1;
    readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
  }>
  | Readonly<{
    readonly kind: "settledReplay";
    readonly receipt: DeclarativeV2CommandReceiptFrameV1;
    readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
  }>;

export interface DeclarativeV2VerifierSettleBatchV1 {
  readonly frames: readonly DeclarativeV2PhysicalFrameV1[];
  readonly objectReferences:
    readonly DeclarativeV2InertObjectReferenceEvidenceV1[];
  readonly disposition: DeclarativeV2PageDispositionV1;
  readonly nextLifecycle: DeclarativeV2AttemptLifecycleV1;
  readonly nextProgress: DeclarativeV2ProgressCursorFrameV1;
}

export interface DeclarativeV2SettledPhaseTailV1 {
  readonly phase: DeclarativeV2VerifierPhaseV1;
  readonly page: DeclarativeV2PageManifestFrameV1 | null;
  readonly pageSha256: Uint8Array | null;
}

export interface DeclarativeV2SettledPhaseTailsV1 {
  readonly attempt: DeclarativeV2VerifierAttemptObservationV1;
  readonly phases: readonly DeclarativeV2SettledPhaseTailV1[];
  readonly lastRegistrationOrdinal: bigint | null;
  readonly lastDiagnosticOrdinal: bigint | null;
}

export interface DeclarativeV2VerifierProgressRepositoryV1 {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    DeclarativeV2VerifierProgressConfigurationV1Error
  >;
  readonly createAttempt: (
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "inserted" | "replayed";
      readonly attemptSha256: Uint8Array;
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierCreateAttemptV1Error,
    never
  >;
  readonly observeAttempt: (
    scopeId: unknown,
    attemptSha256: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2VerifierObserveResultV1,
    VerifierObserveAttemptV1Error,
    never
  >;
  readonly acquire: (
    scopeId: unknown,
    attemptSha256: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2VerifierAcquireResultV1,
    VerifierAcquireV1Error,
    never
  >;
  readonly renew: (
    run: DeclarativeV2VerifierRunV1,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly claimExpiresAt: Date;
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierRenewV1Error,
    never
  >;
  readonly reserveCommand: (
    run: DeclarativeV2VerifierRunV1,
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2VerifierReserveResultV1,
    VerifierReserveV1Error,
    never
  >;
  readonly resumePending: (
    run: DeclarativeV2VerifierRunV1,
    inputSha256: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly work: DeclarativeV2VerifierWorkV1;
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierResumeV1Error,
    never
  >;
  readonly settleCommand: (
    work: DeclarativeV2VerifierWorkV1,
    batch: unknown,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly receipt: DeclarativeV2CommandReceiptFrameV1;
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierSettleV1Error,
    never
  >;
  readonly observeSettledPhaseTails: (
    run: DeclarativeV2VerifierRunV1,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly tails: DeclarativeV2SettledPhaseTailsV1;
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierObserveTailsV1Error,
    never
  >;
  readonly release: (
    run: DeclarativeV2VerifierRunV1,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "released";
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierCloseV1Error,
    never
  >;
  readonly abandon: (
    run: DeclarativeV2VerifierRunV1,
    budget: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "abandoned";
      readonly operationUsage: DeclarativeV2VerifierProgressOperationUsageV1;
    }>,
    VerifierCloseV1Error,
    never
  >;
}

interface MutableRunStateV1 {
  readonly scopeId: ScopeId;
  readonly attemptSha256: Uint8Array;
  readonly ownerId: string;
  readonly writerFence: bigint;
  attempt: DeclarativeV2VerifierAttemptObservationV1;
  claimExpiresAtMilliseconds: number;
  closed: boolean;
  readonly gate: ReturnType<typeof Semaphore.makeUnsafe>;
}

interface MutableWorkStateV1 {
  readonly run: DeclarativeV2VerifierRunV1;
  readonly commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly previousReceiptSha256: Uint8Array | null;
  closed: boolean;
}

interface MutableOperationUsageV1 {
  calls: number;
  rows: number;
  frameBytes: number;
  canonicalBytes: number;
  hashBytes: number;
  elapsedMilliseconds: number;
}

interface CapturedFrameV1<Frame extends DeclarativeV2PhysicalFrameV1> {
  readonly frame: Frame;
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}

interface CapturedFramePreimageV1<
  Frame extends DeclarativeV2PhysicalFrameV1,
> {
  readonly frame: Frame;
  readonly bytes: Uint8Array;
}

interface AttemptStoredFramesV1 {
  readonly identity: StoredFrameV1;
  readonly ceilings: StoredFrameV1;
  readonly usage: StoredFrameV1;
  readonly progress: StoredFrameV1;
  readonly lastReceipt: StoredFrameV1 | null;
  readonly pendingBudget: StoredFrameV1 | null;
}

interface StoredFrameV1 {
  readonly codecVersion: number;
  readonly byteLength: bigint;
  readonly sha256: Uint8Array;
  readonly bytes: Uint8Array;
}

interface LockedAttemptV1 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly lifecycle: DeclarativeV2AttemptLifecycleV1;
  readonly writerOwnerId: string | null;
  readonly writerFence: bigint;
  readonly leaseUpdatedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly settledSequence: bigint;
  readonly lastCommandSha256: Uint8Array | null;
  readonly pendingKind: DeclarativeV2CommandKindV1 | null;
  readonly pendingSequence: bigint | null;
  readonly pendingCommandSha256: Uint8Array | null;
  readonly pendingReservedByFence: bigint | null;
  readonly databaseNow: Date;
  readonly frames: AttemptStoredFramesV1;
}

class VerifierStatementFailureV1 {
  readonly _tag = "VerifierStatementFailureV1";
  constructor(readonly cause: unknown) {}
}

class VerifierBudgetFailureV1 {
  readonly _tag = "VerifierBudgetFailureV1";
  constructor(readonly error: DeclarativeV2VerifierProgressInputV1Error) {}
}

export function makeDeclarativeV2VerifierProgressRepositoryV1(
  target: LocatedReadCommittedAttemptTargetV1,
  options: DeclarativeV2VerifierProgressOptionsV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): DeclarativeV2VerifierProgressRepositoryV1 {
  const configuration = captureConfiguration(options);
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const monotonicMilliseconds = options.monotonicMilliseconds ??
    (() => performance.now());
  const inertRepository = makeDeclarativeV2InertRepositoryV1(target, sha256);
  const runs = new WeakMap<object, MutableRunStateV1>();
  const works = new WeakMap<object, MutableWorkStateV1>();

  const createAttempt = Effect.fn("DeclarativeV2.verifier.createAttempt")(
    function* (rawInput: unknown, rawBudget: unknown) {
      const start = monotonicMilliseconds();
      const budget = yield* Effect.fromResult(
        decodeOperationBudget("createAttempt", rawBudget),
      );
      const tracker = mutableUsage();
      const input = yield* Effect.fromResult(captureCreateInput(rawInput));
      const ceilings = yield* captureFrame(
        "createAttempt",
        input.ceilings,
        "attempt_ceilings",
        budget,
        tracker,
        sha256,
      );
      const candidateRead = yield* inertRepository.readCandidate(
        input.scopeId,
        input.candidateSha256,
        remainingInertBudget(budget, tracker),
      );
      yield* Effect.fromResult(
        mergeInertUsage(
          "createAttempt",
          budget,
          tracker,
          candidateRead.usage,
        ),
      );
      if (candidateRead.kind === "missing") {
        return yield* new DeclarativeV2VerifierProgressInputV1Error({
          operation: "createAttempt",
          reason: "invalidInput",
        });
      }
      const identity = yield* captureFrame(
        "createAttempt",
        {
          kind: "attempt_identity",
          candidateSha256: input.candidateSha256,
          verifierProgressProtocolIdentity: ATTEMPT_PROTOCOL_IDENTITY,
          ceilingsSha256: ceilings.sha256,
        },
        "attempt_identity",
        budget,
        tracker,
        sha256,
      );
      const zeroUsage = yield* captureFrame(
        "createAttempt",
        zeroBudgetFrame("attempt_usage"),
        "attempt_usage",
        budget,
        tracker,
        sha256,
      );
      const initialProgress = yield* captureFrame(
        "createAttempt",
        {
          kind: "progress_cursor",
          phase: "source",
          settledSequence: 0n,
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          pageOrdinal: 0n,
          previousReceiptSha256: null,
        },
        "progress_cursor",
        budget,
        tracker,
        sha256,
      );

      const result = yield* runTransactionWithConfirmedRollbackRetry(
        target,
        "createAttempt",
        input.scopeId,
        identity.sha256,
        budget,
        tracker,
        monotonicMilliseconds,
        start,
        async (tx) => {
          requireTimeOrThrow(
            "createAttempt",
            budget,
            tracker,
            start,
            monotonicMilliseconds,
          );
          chargeSqlOrThrow("createAttempt", budget, tracker, 1);
          const insertedRows = await runVerifierStatement(
            "createAttempt",
            () => tx
            .insert(fxSystemDeclarativeV2VerifierAttempts)
            .values({
              scopeId: input.scopeId,
              attemptSha256: identity.sha256,
              candidateSha256: input.candidateSha256,
              lifecycle: "open",
              identityCodecVersion:
                DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
              identityByteLength: BigInt(identity.bytes.byteLength),
              identitySha256: identity.sha256,
              identityBytes: identity.bytes,
              ceilingsCodecVersion:
                DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
              ceilingsByteLength: BigInt(ceilings.bytes.byteLength),
              ceilingsSha256: ceilings.sha256,
              ceilingsBytes: ceilings.bytes,
              usageCodecVersion:
                DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
              usageByteLength: BigInt(zeroUsage.bytes.byteLength),
              usageSha256: zeroUsage.sha256,
              usageBytes: zeroUsage.bytes,
              progressCodecVersion:
                DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
              progressByteLength: BigInt(initialProgress.bytes.byteLength),
              progressSha256: initialProgress.sha256,
              progressBytes: initialProgress.bytes,
            })
            .onConflictDoNothing({
              target: [
                fxSystemDeclarativeV2VerifierAttempts.scopeId,
                fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
              ],
            })
            .returning({
              attemptSha256:
                fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
            }),
          );
          if (insertedRows.length === 1) return "inserted" as const;
          const existing = await lockAttempt(
            tx,
            "createAttempt",
            input.scopeId,
            identity.sha256,
            budget,
            tracker,
            true,
          );
          if (
            existing === null ||
            !bytesEqualFullScan(existing.candidateSha256, input.candidateSha256) ||
            !storedFrameEquals(existing.frames.identity, identity) ||
            !storedFrameEquals(existing.frames.ceilings, ceilings)
          ) {
            throw new DeclarativeV2VerifierProgressCollisionV1Error({
              operation: "createAttempt",
              reason: "attemptChanged",
            });
          }
          return "replayed" as const;
        },
      );
      return Object.freeze({
        kind: result,
        attemptSha256: new Uint8Array(identity.sha256),
        operationUsage: freezeUsage(tracker),
      });
    },
  );

  const observeAttempt = Effect.fn("DeclarativeV2.verifier.observeAttempt")(
    function* (
      rawScopeId: unknown,
      rawAttemptSha256: unknown,
      rawBudget: unknown,
    ) {
      const start = monotonicMilliseconds();
      const budget = yield* Effect.fromResult(
        decodeOperationBudget("observeAttempt", rawBudget),
      );
      const tracker = mutableUsage();
      const selector = yield* Effect.fromResult(
        captureSelector("observeAttempt", rawScopeId, rawAttemptSha256),
      );
      const locked = yield* runTransactionWithConfirmedRollbackRetry(
        target,
        "observeAttempt",
        selector.scopeId,
        selector.attemptSha256,
        budget,
        tracker,
        monotonicMilliseconds,
        start,
        (tx) =>
          lockAttempt(
            tx,
            "observeAttempt",
            selector.scopeId,
            selector.attemptSha256,
            budget,
            tracker,
            true,
          ),
      );
      if (locked === null) {
        yield* Effect.fromResult(setElapsedResult(
          "observeAttempt",
          budget,
          tracker,
          start,
          monotonicMilliseconds,
        ));
        return Object.freeze({
          kind: "missing" as const,
          operationUsage: freezeUsage(tracker),
        });
      }
      const attempt = yield* decodeAttemptObservation(
        "observeAttempt",
        locked,
        budget,
        tracker,
        sha256,
      );
      yield* Effect.fromResult(setElapsedResult(
        "observeAttempt",
        budget,
        tracker,
        start,
        monotonicMilliseconds,
      ));
      return Object.freeze({
        kind: "present" as const,
        attempt: copyAttemptObservation(attempt),
        operationUsage: freezeUsage(tracker),
      });
    },
  );

  const acquire = Effect.fn("DeclarativeV2.verifier.acquire")(
    function* (
      rawScopeId: unknown,
      rawAttemptSha256: unknown,
      rawBudget: unknown,
    ) {
      const config = yield* Effect.fromResult(configuration);
      const start = monotonicMilliseconds();
      const budget = yield* Effect.fromResult(
        decodeOperationBudget("acquire", rawBudget),
      );
      const tracker = mutableUsage();
      const selector = yield* Effect.fromResult(
        captureSelector("acquire", rawScopeId, rawAttemptSha256),
      );
      const ownerId = randomUuid();
      if (!isLowercaseUuidText(ownerId)) {
        return yield* corruption("acquire", "invalidMetadata");
      }
      const run = Object.freeze({
        _tag: "DeclarativeV2VerifierRunV1" as const,
      });
      const preflight = yield* runTransactionWithConfirmedRollbackRetry(
        target,
        "acquire",
        selector.scopeId,
        selector.attemptSha256,
        budget,
        tracker,
        monotonicMilliseconds,
        start,
        (tx) =>
          lockAttempt(
            tx,
            "acquire",
            selector.scopeId,
            selector.attemptSha256,
            budget,
            tracker,
            true,
          ),
      );
      if (preflight === null) {
        yield* Effect.fromResult(setElapsedResult(
          "acquire",
          budget,
          tracker,
          start,
          monotonicMilliseconds,
        ));
        return Object.freeze({
          kind: "missing" as const,
          operationUsage: freezeUsage(tracker),
        });
      }
      const preflightAttempt = yield* decodeAttemptObservation(
        "acquire",
        preflight,
        budget,
        tracker,
        sha256,
      );
      const locked = yield* runTransactionWithConfirmedRollbackRetry(
        target,
        "acquire",
        selector.scopeId,
        selector.attemptSha256,
        budget,
        tracker,
        monotonicMilliseconds,
        start,
        async (tx) => {
          const current = await lockAttempt(
            tx,
            "acquire",
            selector.scopeId,
            selector.attemptSha256,
            budget,
            tracker,
            true,
          );
          if (current === null) return null;
          if (!lockedAttemptStateEquals(current, preflight)) {
            throw stale("acquire", "stateChanged");
          }
          if (isTerminal(current.lifecycle)) {
            const phase = phaseFromStoredFrame(
              "acquire",
              current.frames.progress,
            );
            if (Result.isFailure(phase)) throw phase.failure;
            throw new DeclarativeV2VerifierProgressLifecycleV1Error({
              operation: "acquire",
              lifecycle: current.lifecycle,
              phase: phase.success,
            });
          }
          const databaseNow = dateMilliseconds(current.databaseNow);
          const currentExpiry = current.leaseExpiresAt === null
            ? undefined
            : dateMilliseconds(current.leaseExpiresAt);
          if (databaseNow === undefined) {
            throw corruption("acquire", "invalidMetadata");
          }
          if (
            current.writerOwnerId !== null &&
            currentExpiry !== undefined &&
            currentExpiry > databaseNow
          ) {
            throw new DeclarativeV2VerifierProgressBusyV1Error({
              operation: "acquire",
              claimExpiresAt: new Date(currentExpiry),
            });
          }
          if (current.writerFence === MAX_FENCE) {
            throw new DeclarativeV2VerifierProgressExhaustionV1Error({
              operation: "acquire",
              dimension: "writerFence",
              observed: current.writerFence,
              maximum: MAX_FENCE,
            });
          }
          const nextFence = current.writerFence + 1n;
          const nextExpiry = checkedExpiry(
            databaseNow,
            config.claimDurationMilliseconds,
          );
          const attempt = projectClaimedAttempt(
            preflightAttempt,
            nextFence,
            nextExpiry,
            current.pendingKind === null ? null : nextFence,
          );
          const callerAttempt = copyAttemptObservation(attempt);
          const callerExpiry = copyDate(nextExpiry);
          const runState: MutableRunStateV1 = {
            scopeId: selector.scopeId,
            attemptSha256: new Uint8Array(selector.attemptSha256),
            ownerId,
            writerFence: nextFence,
            attempt,
            claimExpiresAtMilliseconds: nextExpiry.getTime(),
            closed: false,
            gate: Semaphore.makeUnsafe(1),
          };
          requireTimeOrThrow(
            "acquire",
            budget,
            tracker,
            start,
            monotonicMilliseconds,
          );
          chargeSqlOrThrow("acquire", budget, tracker, 1);
          const rows = await runVerifierStatement("acquire", () => tx
            .update(fxSystemDeclarativeV2VerifierAttempts)
            .set({
              writerOwnerId: ownerId,
              writerFence: nextFence,
              leaseUpdatedAt: current.databaseNow,
              leaseExpiresAt: nextExpiry,
              pendingReservedByFence:
                sql`case when ${fxSystemDeclarativeV2VerifierAttempts.pendingKind}
                  is null then null else ${nextFence}::bigint end`,
              updatedAt: current.databaseNow,
            })
            .where(and(
              eq(
                fxSystemDeclarativeV2VerifierAttempts.scopeId,
                selector.scopeId,
              ),
              eq(
                fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
                selector.attemptSha256,
              ),
              eq(
                fxSystemDeclarativeV2VerifierAttempts.writerFence,
                current.writerFence,
              ),
            ))
            .returning({
              writerFence:
                fxSystemDeclarativeV2VerifierAttempts.writerFence,
            }));
          if (rows.length !== 1) {
            throw stale("acquire", "stateChanged");
          }
          return Object.freeze({
            locked: Object.freeze({
              ...current,
              writerOwnerId: ownerId,
              writerFence: nextFence,
              leaseUpdatedAt: new Date(databaseNow),
              leaseExpiresAt: nextExpiry,
              pendingReservedByFence:
                current.pendingKind === null ? null : nextFence,
            }),
            nextExpiry,
            attempt,
            callerAttempt,
            callerExpiry,
            runState,
          });
        },
      );
      if (locked === null) {
        return yield* stale("acquire", "stateChanged");
      }
      runs.set(run, locked.runState);
      return Object.freeze({
        kind: "acquired" as const,
        run,
        attempt: locked.callerAttempt,
        claimExpiresAt: locked.callerExpiry,
        operationUsage: freezeUsage(tracker),
      });
    },
  );

  const renew = Effect.fn("DeclarativeV2.verifier.renew")(
    function* (run: DeclarativeV2VerifierRunV1, rawBudget: unknown) {
      const config = yield* Effect.fromResult(configuration);
      return yield* withRun(runs, run, "renew", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("renew", rawBudget),
          );
          const tracker = mutableUsage();
          const expiry = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "renew",
            state.scopeId,
            state.attemptSha256,
            budget,
            tracker,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const current = await lockAttempt(
                tx,
                "renew",
                state.scopeId,
                state.attemptSha256,
                budget,
                tracker,
                true,
              );
              requireLiveOwner(current, state, "renew");
              const now = dateMilliseconds(current.databaseNow);
              const existingExpiry = current.leaseExpiresAt === null
                ? undefined
                : dateMilliseconds(current.leaseExpiresAt);
              if (now === undefined || existingExpiry === undefined) {
                throw corruption("renew", "invalidMetadata");
              }
              const nextExpiry = new Date(Math.max(
                existingExpiry,
                checkedExpiry(
                  now,
                  config.claimDurationMilliseconds,
                ).getTime(),
              ));
              const expiryMilliseconds = nextExpiry.getTime();
              const callerExpiry = new Date(expiryMilliseconds);
              requireTimeOrThrow(
                "renew",
                budget,
                tracker,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("renew", budget, tracker, 1);
              const rows = await runVerifierStatement("renew", () => tx
                .update(fxSystemDeclarativeV2VerifierAttempts)
                .set({
                  leaseUpdatedAt: current.databaseNow,
                  leaseExpiresAt: nextExpiry,
                  updatedAt: current.databaseNow,
                })
                .where(and(
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.scopeId,
                    state.scopeId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
                    state.attemptSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerOwnerId,
                    state.ownerId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerFence,
                    state.writerFence,
                  ),
                ))
                .returning({
                  leaseExpiresAt:
                    fxSystemDeclarativeV2VerifierAttempts.leaseExpiresAt,
                }));
              if (rows.length !== 1) throw stale("renew", "ownerChanged");
              return Object.freeze({
                expiryMilliseconds,
                callerExpiry,
              });
            },
          ).pipe(closeRunOnTransactionFailure(state));
          state.claimExpiresAtMilliseconds = expiry.expiryMilliseconds;
          return Object.freeze({
            claimExpiresAt: expiry.callerExpiry,
            operationUsage: freezeUsage(tracker),
          });
        })
      );
    },
  );

  const reserveCommand = Effect.fn("DeclarativeV2.verifier.reserveCommand")(
    function* (
      run: DeclarativeV2VerifierRunV1,
      rawInput: unknown,
      rawBudget: unknown,
    ) {
      return yield* withRun(runs, run, "reserveCommand", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("reserveCommand", rawBudget),
          );
          const tracker = mutableUsage();
          const input = yield* Effect.fromResult(
            captureReserveInput(rawInput),
          );
          const commandBudget = yield* captureFrame<DeclarativeV2BudgetFrameV1>(
            "reserveCommand",
            input.commandBudget,
            "command_budget",
            budget,
            tracker,
            sha256,
          );
          const reservation =
            yield* captureFrame<DeclarativeV2CommandReservationFrameV1>(
            "reserveCommand",
            {
              kind: "command_reservation",
              commandKind: input.commandKind,
              sequence: input.sequence,
              previousReceiptSha256: input.previousReceiptSha256,
              budgetSha256: commandBudget.sha256,
              inputSha256: input.inputSha256,
            },
            "command_reservation",
            budget,
            tracker,
            sha256,
          );
          const isPotentialNewReservation =
            state.attempt.pendingKind === null &&
            input.sequence === state.attempt.settledSequence + 1n;
          const currentUsage = isPotentialNewReservation
            ? yield* captureFrame<DeclarativeV2BudgetFrameV1>(
              "reserveCommand",
              state.attempt.usage,
              "attempt_usage",
              budget,
              tracker,
              sha256,
            )
            : null;
          const nextUsage = isPotentialNewReservation
            ? yield* captureFrame<DeclarativeV2BudgetFrameV1>(
              "reserveCommand",
              yield* Effect.fromResult(
                addSemanticUsage(
                  state.attempt.ceilings,
                  state.attempt.usage,
                  commandBudget.frame,
                ),
              ),
              "attempt_usage",
              budget,
              tracker,
              sha256,
            )
            : null;
          const projectedAttempt = nextUsage === null
            ? null
            : projectReservedAttempt(
              state.attempt,
              input,
              reservation.sha256,
              nextUsage.frame,
            );
          const preparedWork = prepareWorkToken(
            run,
            input.commandKind,
            input.sequence,
            reservation.sha256,
            input.previousReceiptSha256,
          );
          const result = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "reserveCommand",
            state.scopeId,
            state.attemptSha256,
            budget,
            tracker,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const current = await lockAttempt(
                tx,
                "reserveCommand",
                state.scopeId,
                state.attemptSha256,
                budget,
                tracker,
                true,
              );
              requireLiveOwner(current, state, "reserveCommand");
              if (
                input.sequence === current.settledSequence &&
                current.lastCommandSha256 !== null &&
                bytesEqualFullScan(
                  current.lastCommandSha256,
                  reservation.sha256,
                ) &&
                current.frames.lastReceipt !== null
              ) {
                return Object.freeze({
                  kind: "settledReplay" as const,
                  receipt: current.frames.lastReceipt,
                  locked: current,
                });
              }
              const currentPhase = phaseFromStoredFrame(
                "reserveCommand",
                current.frames.progress,
              );
              if (Result.isFailure(currentPhase)) throw currentPhase.failure;
              requireCommandAllowed(
                "reserveCommand",
                current.lifecycle,
                currentPhase.success,
                input.commandKind,
              );
              if (input.sequence !== current.settledSequence + 1n) {
                throw new DeclarativeV2VerifierProgressCollisionV1Error({
                  operation: "reserveCommand",
                  reason: "commandChanged",
                });
              }
              if (
                !nullableDigestEqual(
                  input.previousReceiptSha256,
                  current.frames.lastReceipt?.sha256 ?? null,
                )
              ) {
                throw new DeclarativeV2VerifierProgressCollisionV1Error({
                  operation: "reserveCommand",
                  reason: "commandChanged",
                });
              }
              if (current.pendingKind !== null) {
                if (
                  current.pendingKind !== input.commandKind ||
                  current.pendingSequence !== input.sequence ||
                  current.pendingCommandSha256 === null ||
                  !bytesEqualFullScan(
                    current.pendingCommandSha256,
                    reservation.sha256,
                  ) ||
                  current.frames.pendingBudget === null ||
                  !storedFrameEquals(
                    current.frames.pendingBudget,
                    commandBudget,
                  )
                ) {
                  throw new DeclarativeV2VerifierProgressCollisionV1Error({
                    operation: "reserveCommand",
                    reason: "commandChanged",
                  });
                }
                return Object.freeze({
                  kind: "pendingReplay" as const,
                  locked: current,
                });
              }
              if (current.settledSequence === MAX_FENCE) {
                throw new DeclarativeV2VerifierProgressExhaustionV1Error({
                  operation: "reserveCommand",
                  dimension: "settledSequence",
                  observed: current.settledSequence,
                  maximum: MAX_FENCE,
                });
              }
              if (
                nextUsage === null ||
                currentUsage === null ||
                !bytesEqualFullScan(
                  current.frames.usage.sha256,
                  currentUsage.sha256,
                )
              ) {
                throw stale("reserveCommand", "stateChanged");
              }
              requireTimeOrThrow(
                "reserveCommand",
                budget,
                tracker,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("reserveCommand", budget, tracker, 1);
              const rows = await runVerifierStatement(
                "reserveCommand",
                () => tx
                .update(fxSystemDeclarativeV2VerifierAttempts)
                .set({
                  pendingKind: input.commandKind,
                  pendingSequence: input.sequence,
                  pendingCommandSha256: reservation.sha256,
                  pendingReservedByFence: state.writerFence,
                  pendingStartedAt: current.databaseNow,
                  pendingBudgetCodecVersion:
                    DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
                  pendingBudgetByteLength:
                    BigInt(commandBudget.bytes.byteLength),
                  pendingBudgetSha256: commandBudget.sha256,
                  pendingBudgetBytes: commandBudget.bytes,
                  usageCodecVersion:
                    DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
                  usageByteLength: BigInt(nextUsage.bytes.byteLength),
                  usageSha256: nextUsage.sha256,
                  usageBytes: nextUsage.bytes,
                  updatedAt: current.databaseNow,
                })
                .where(and(
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.scopeId,
                    state.scopeId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
                    state.attemptSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerOwnerId,
                    state.ownerId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerFence,
                    state.writerFence,
                  ),
                  sql`${fxSystemDeclarativeV2VerifierAttempts.pendingKind}
                    is null`,
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.settledSequence,
                    current.settledSequence,
                  ),
                ))
                .returning({
                  pendingCommandSha256:
                    fxSystemDeclarativeV2VerifierAttempts.pendingCommandSha256,
                }),
              );
              if (rows.length !== 1) {
                throw stale("reserveCommand", "pendingChanged");
              }
              return Object.freeze({
                kind: "reserved" as const,
                locked: Object.freeze({
                  ...current,
                  pendingKind: input.commandKind,
                  pendingSequence: input.sequence,
                  pendingCommandSha256: reservation.sha256,
                  pendingReservedByFence: state.writerFence,
                  frames: Object.freeze({
                    ...current.frames,
                    usage: storedFrameFromCaptured(nextUsage),
                    pendingBudget: storedFrameFromCaptured(commandBudget),
                  }),
                }),
              });
            },
          ).pipe(closeRunOnTransactionFailure(state));

          if (result.kind === "settledReplay") {
            yield* Effect.fromResult(setElapsedResult(
              "reserveCommand",
              budget,
              tracker,
              start,
              monotonicMilliseconds,
            ));
            if (state.attempt.lastReceipt === null) {
              return yield* corruption(
                "reserveCommand",
                "normalizedMismatch",
              );
            }
            return Object.freeze({
              kind: "settledReplay" as const,
              receipt: copyCommandReceipt(state.attempt.lastReceipt),
              operationUsage: freezeUsage(tracker),
            });
          }
          if (result.kind === "pendingReplay") {
            yield* Effect.fromResult(setElapsedResult(
              "reserveCommand",
              budget,
              tracker,
              start,
              monotonicMilliseconds,
            ));
          } else {
            if (projectedAttempt === null) {
              return yield* stale("reserveCommand", "stateChanged");
            }
            state.attempt = projectedAttempt;
          }
          works.set(preparedWork.work, preparedWork.state);
          return Object.freeze({
            kind: result.kind,
            work: preparedWork.work,
            operationUsage: freezeUsage(tracker),
          });
        })
      );
    },
  );

  const resumePending = Effect.fn("DeclarativeV2.verifier.resumePending")(
    function* (
      run: DeclarativeV2VerifierRunV1,
      rawInputSha256: unknown,
      rawBudget: unknown,
    ) {
      return yield* withRun(runs, run, "resumePending", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("resumePending", rawBudget),
          );
          const tracker = mutableUsage();
          if (
            !isUint8ArrayWithByteLength(
              rawInputSha256,
              DECLARATIVE_V2_SHA256_BYTES_V1,
            ) ||
            state.attempt.pendingKind === null ||
            state.attempt.pendingSequence === null ||
            state.attempt.pendingCommandSha256 === null
          ) {
            return yield* inputError("resumePending", "invalidInput");
          }
          const locked = yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "resumePending",
            state.scopeId,
            state.attemptSha256,
            budget,
            tracker,
            monotonicMilliseconds,
            start,
            (tx) =>
              lockAttempt(
                tx,
                "resumePending",
                state.scopeId,
                state.attemptSha256,
                budget,
                tracker,
                true,
              ),
          ).pipe(closeRunOnTransactionFailure(state));
          requireLiveOwner(locked, state, "resumePending");
          if (
            locked.pendingKind === null ||
            locked.pendingSequence === null ||
            locked.pendingCommandSha256 === null ||
            locked.frames.pendingBudget === null
          ) {
            return yield* stale("resumePending", "pendingChanged");
          }
          if (!isSettlingCommandKind(locked.pendingKind)) {
            const phase = yield* Effect.fromResult(phaseFromStoredFrame(
              "resumePending",
              locked.frames.progress,
            ));
            return yield* new DeclarativeV2VerifierProgressLifecycleV1Error({
              operation: "resumePending",
              lifecycle: locked.lifecycle,
              phase,
            });
          }
          const pendingBudget = yield* decodeStoredFrame(
            "resumePending",
            locked.frames.pendingBudget,
            "command_budget",
            budget,
            tracker,
            sha256,
          );
          const reservation = yield* captureFrame(
            "resumePending",
            {
              kind: "command_reservation",
              commandKind: locked.pendingKind,
              sequence: locked.pendingSequence,
              previousReceiptSha256:
                locked.frames.lastReceipt?.sha256 ?? null,
              budgetSha256: pendingBudget.sha256,
              inputSha256: new Uint8Array(rawInputSha256),
            },
            "command_reservation",
            budget,
            tracker,
            sha256,
          );
          if (
            !bytesEqualFullScan(
              reservation.sha256,
              locked.pendingCommandSha256,
            )
          ) {
            return yield* inputError("resumePending", "commandMismatch");
          }
          const attempt = yield* decodeAttemptObservation(
            "resumePending",
            locked,
            budget,
            tracker,
            sha256,
          );
          state.attempt = attempt;
          const preparedWork = prepareWorkToken(
            run,
            locked.pendingKind,
            locked.pendingSequence,
            reservation.sha256,
            locked.frames.lastReceipt?.sha256 ?? null,
          );
          works.set(preparedWork.work, preparedWork.state);
          yield* Effect.fromResult(setElapsedResult(
            "resumePending",
            budget,
            tracker,
            start,
            monotonicMilliseconds,
          ));
          return Object.freeze({
            work: preparedWork.work,
            operationUsage: freezeUsage(tracker),
          });
        })
      );
    },
  );

  const settleCommand = Effect.fn("DeclarativeV2.verifier.settleCommand")(
    function* (
      work: DeclarativeV2VerifierWorkV1,
      rawBatch: unknown,
      rawBudget: unknown,
    ) {
      const workState = yield* lookupWork(works, work);
      const runState = yield* lookupRun(runs, workState.run, "settleCommand");
      return yield* runState.gate.withPermit(Effect.gen(function* () {
        const currentWork = yield* lookupWork(works, work);
        const currentRun = yield* lookupRun(
          runs,
          currentWork.run,
          "settleCommand",
        );
        const start = monotonicMilliseconds();
        const budget = yield* Effect.fromResult(
          decodeOperationBudget("settleCommand", rawBudget),
        );
        const tracker = mutableUsage();
        const capturedInput = yield* captureSettlementInput(
          currentRun,
          currentWork,
          rawBatch,
          budget,
          tracker,
          sha256,
        );
        const tails = yield* readSettledTailsForRun(
          target,
          currentRun,
          "settleCommand",
          budget,
          tracker,
          monotonicMilliseconds,
          start,
          sha256,
        );
        const captured = yield* completeSettlementBatch(
          currentRun,
          currentWork,
          capturedInput,
          tails,
          budget,
          tracker,
          sha256,
        );
        const projectedAttempt = projectSettledAttempt(
          currentRun.attempt,
          currentWork,
          captured,
        );
        const callerReceipt = copyCommandReceipt(captured.receipt.frame);
        yield* runTransactionWithConfirmedRollbackRetry(
          target,
          "settleCommand",
          currentRun.scopeId,
          currentRun.attemptSha256,
          budget,
          tracker,
          monotonicMilliseconds,
          start,
          async (tx) => {
            const locked = await lockAttempt(
              tx,
              "settleCommand",
              currentRun.scopeId,
              currentRun.attemptSha256,
              budget,
              tracker,
              true,
            );
            requireLiveOwner(locked, currentRun, "settleCommand");
            requirePending(
              locked,
              currentWork.commandKind,
              currentWork.sequence,
              currentWork.reservationSha256,
              currentRun.writerFence,
            );
            await verifyPagePredecessors(
              tx,
              currentRun.scopeId,
              currentRun.attemptSha256,
              captured.frames,
              budget,
              tracker,
            );
            await insertImmutableEvidence(
              tx,
              currentRun.scopeId,
              currentRun.attemptSha256,
              captured,
              budget,
              tracker,
            );
            await settleLinkNodes(
              tx,
              currentRun.scopeId,
              currentRun.attemptSha256,
              captured,
              budget,
              tracker,
            );
            await settleFrontierEntries(
              tx,
              currentRun.scopeId,
              currentRun.attemptSha256,
              captured,
              budget,
              tracker,
            );
            requireTimeOrThrow(
              "settleCommand",
              budget,
              tracker,
              start,
              monotonicMilliseconds,
            );
            chargeSqlOrThrow("settleCommand", budget, tracker, 1);
            const rows = await runVerifierStatement(
              "settleCommand",
              () => tx
              .update(fxSystemDeclarativeV2VerifierAttempts)
              .set({
                lifecycle: captured.nextLifecycle,
                settledSequence: currentWork.sequence,
                lastCommandSha256: currentWork.reservationSha256,
                lastReceiptCodecVersion:
                  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
                lastReceiptByteLength:
                  BigInt(captured.receipt.bytes.byteLength),
                lastReceiptSha256: captured.receipt.sha256,
                lastReceiptBytes: captured.receipt.bytes,
                progressCodecVersion:
                  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
                progressByteLength:
                  BigInt(captured.progress.bytes.byteLength),
                progressSha256: captured.progress.sha256,
                progressBytes: captured.progress.bytes,
                pendingKind: null,
                pendingSequence: null,
                pendingCommandSha256: null,
                pendingReservedByFence: null,
                pendingStartedAt: null,
                pendingBudgetCodecVersion: null,
                pendingBudgetByteLength: null,
                pendingBudgetSha256: null,
                pendingBudgetBytes: null,
                updatedAt: locked.databaseNow,
              })
              .where(and(
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.scopeId,
                  currentRun.scopeId,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
                  currentRun.attemptSha256,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.writerOwnerId,
                  currentRun.ownerId,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.writerFence,
                  currentRun.writerFence,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.pendingKind,
                  currentWork.commandKind,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.pendingSequence,
                  currentWork.sequence,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.pendingCommandSha256,
                  currentWork.reservationSha256,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts
                    .pendingReservedByFence,
                  currentRun.writerFence,
                ),
                eq(
                  fxSystemDeclarativeV2VerifierAttempts.settledSequence,
                  currentWork.sequence - 1n,
                ),
                gt(
                  fxSystemDeclarativeV2VerifierAttempts.leaseExpiresAt,
                  sql`clock_timestamp()`,
                ),
              ))
              .returning({
                settledSequence:
                  fxSystemDeclarativeV2VerifierAttempts.settledSequence,
              }),
            );
            if (rows.length !== 1) {
              throw stale("settleCommand", "leaseExpired");
            }
            return Object.freeze({
              locked: Object.freeze({
                ...locked,
                lifecycle: captured.nextLifecycle,
                settledSequence: currentWork.sequence,
                lastCommandSha256: currentWork.reservationSha256,
                pendingKind: null,
                pendingSequence: null,
                pendingCommandSha256: null,
                pendingReservedByFence: null,
                frames: Object.freeze({
                  ...locked.frames,
                  lastReceipt: storedFrameFromCaptured(captured.receipt),
                  progress: storedFrameFromCaptured(captured.progress),
                  pendingBudget: null,
                }),
              }),
            });
          },
        ).pipe(closeRunAndWorkOnTransactionFailure(currentRun, currentWork));
        currentWork.closed = true;
        currentRun.attempt = projectedAttempt;
        return Object.freeze({
          receipt: callerReceipt,
          operationUsage: freezeUsage(tracker),
        });
      })).pipe(
        Effect.onInterrupt(() => Effect.sync(() => {
          closeRun(runState);
          workState.closed = true;
        })),
      );
    },
  );

  const observeSettledPhaseTails = Effect.fn(
    "DeclarativeV2.verifier.observeSettledPhaseTails",
  )(function* (
    run: DeclarativeV2VerifierRunV1,
    rawBudget: unknown,
  ) {
    return yield* withRun(
      runs,
      run,
      "observeSettledPhaseTails",
      state => Effect.gen(function* () {
        const start = monotonicMilliseconds();
        const budget = yield* Effect.fromResult(
          decodeOperationBudget("observeSettledPhaseTails", rawBudget),
        );
        const tracker = mutableUsage();
        const tails = yield* readSettledTailsForRun(
          target,
          state,
          "observeSettledPhaseTails",
          budget,
          tracker,
          monotonicMilliseconds,
          start,
          sha256,
        );
        yield* Effect.fromResult(setElapsedResult(
          "observeSettledPhaseTails",
          budget,
          tracker,
          start,
          monotonicMilliseconds,
        ));
        return Object.freeze({
          tails: copySettledPhaseTails(tails),
          operationUsage: freezeUsage(tracker),
        });
      }),
    );
  });

  const release = Effect.fn("DeclarativeV2.verifier.release")(
    function* (run: DeclarativeV2VerifierRunV1, rawBudget: unknown) {
      return yield* withRun(runs, run, "release", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("release", rawBudget),
          );
          const tracker = mutableUsage();
          yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "release",
            state.scopeId,
            state.attemptSha256,
            budget,
            tracker,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const locked = await lockAttempt(
                tx,
                "release",
                state.scopeId,
                state.attemptSha256,
                budget,
                tracker,
                true,
              );
              requireLiveOwner(locked, state, "release");
              if (locked.pendingKind !== null) {
                throw new DeclarativeV2VerifierProgressLifecycleV1Error({
                  operation: "release",
                  lifecycle: locked.lifecycle,
                  phase: state.attempt.progress.phase,
                });
              }
              requireTimeOrThrow(
                "release",
                budget,
                tracker,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("release", budget, tracker, 1);
              const rows = await runVerifierStatement("release", () => tx
                .update(fxSystemDeclarativeV2VerifierAttempts)
                .set({
                  writerOwnerId: null,
                  leaseUpdatedAt: null,
                  leaseExpiresAt: null,
                  updatedAt: locked.databaseNow,
                })
                .where(and(
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.scopeId,
                    state.scopeId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
                    state.attemptSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerOwnerId,
                    state.ownerId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerFence,
                    state.writerFence,
                  ),
                  sql`${fxSystemDeclarativeV2VerifierAttempts.pendingKind}
                    is null`,
                ))
                .returning({
                  writerFence:
                    fxSystemDeclarativeV2VerifierAttempts.writerFence,
                }));
              if (rows.length !== 1) throw stale("release", "ownerChanged");
            },
          ).pipe(closeRunOnTransactionFailure(state));
          closeRun(state);
          return Object.freeze({
            kind: "released" as const,
            operationUsage: freezeUsage(tracker),
          });
        })
      );
    },
  );

  const abandon = Effect.fn("DeclarativeV2.verifier.abandon")(
    function* (run: DeclarativeV2VerifierRunV1, rawBudget: unknown) {
      return yield* withRun(runs, run, "abandon", (state) =>
        Effect.gen(function* () {
          const start = monotonicMilliseconds();
          const budget = yield* Effect.fromResult(
            decodeOperationBudget("abandon", rawBudget),
          );
          const tracker = mutableUsage();
          yield* runTransactionWithConfirmedRollbackRetry(
            target,
            "abandon",
            state.scopeId,
            state.attemptSha256,
            budget,
            tracker,
            monotonicMilliseconds,
            start,
            async (tx) => {
              const locked = await lockAttempt(
                tx,
                "abandon",
                state.scopeId,
                state.attemptSha256,
                budget,
                tracker,
                true,
              );
              requireLiveOwner(locked, state, "abandon");
              if (locked.pendingKind !== null) {
                throw new DeclarativeV2VerifierProgressLifecycleV1Error({
                  operation: "abandon",
                  lifecycle: locked.lifecycle,
                  phase: state.attempt.progress.phase,
                });
              }
              requireTimeOrThrow(
                "abandon",
                budget,
                tracker,
                start,
                monotonicMilliseconds,
              );
              chargeSqlOrThrow("abandon", budget, tracker, 1);
              const rows = await runVerifierStatement("abandon", () => tx
                .update(fxSystemDeclarativeV2VerifierAttempts)
                .set({
                  lifecycle: "abandoned",
                  writerOwnerId: null,
                  leaseUpdatedAt: null,
                  leaseExpiresAt: null,
                  updatedAt: locked.databaseNow,
                })
                .where(and(
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.scopeId,
                    state.scopeId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
                    state.attemptSha256,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerOwnerId,
                    state.ownerId,
                  ),
                  eq(
                    fxSystemDeclarativeV2VerifierAttempts.writerFence,
                    state.writerFence,
                  ),
                  sql`${fxSystemDeclarativeV2VerifierAttempts.pendingKind}
                    is null`,
                ))
                .returning({
                  writerFence:
                    fxSystemDeclarativeV2VerifierAttempts.writerFence,
                }));
              if (rows.length !== 1) throw stale("abandon", "ownerChanged");
            },
          ).pipe(closeRunOnTransactionFailure(state));
          closeRun(state);
          return Object.freeze({
            kind: "abandoned" as const,
            operationUsage: freezeUsage(tracker),
          });
        })
      );
    },
  );

  return Object.freeze({
    configuration,
    createAttempt: (input: unknown, budget: unknown) =>
      createAttempt(input, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "createAttempt")
        ),
      ),
    observeAttempt: (
      scopeId: unknown,
      attemptSha256: unknown,
      budget: unknown,
    ) =>
      observeAttempt(scopeId, attemptSha256, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "observeAttempt")
        ),
      ),
    acquire: (
      scopeId: unknown,
      attemptSha256: unknown,
      budget: unknown,
    ) =>
      acquire(scopeId, attemptSha256, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "acquire")
        ),
      ),
    renew: (run: DeclarativeV2VerifierRunV1, budget: unknown) =>
      renew(run, budget).pipe(
        Effect.mapError(error => narrowVerifierOperationError(error, "renew")),
      ),
    reserveCommand: (
      run: DeclarativeV2VerifierRunV1,
      input: unknown,
      budget: unknown,
    ) =>
      reserveCommand(run, input, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "reserveCommand")
        ),
      ),
    resumePending: (
      run: DeclarativeV2VerifierRunV1,
      inputSha256: unknown,
      budget: unknown,
    ) =>
      resumePending(run, inputSha256, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "resumePending")
        ),
      ),
    settleCommand: (
      work: DeclarativeV2VerifierWorkV1,
      batch: unknown,
      budget: unknown,
    ) =>
      settleCommand(work, batch, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "settleCommand")
        ),
      ),
    observeSettledPhaseTails: (
      run: DeclarativeV2VerifierRunV1,
      budget: unknown,
    ) =>
      observeSettledPhaseTails(run, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "observeSettledPhaseTails")
        ),
      ),
    release: (run: DeclarativeV2VerifierRunV1, budget: unknown) =>
      release(run, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "release")
        ),
      ),
    abandon: (run: DeclarativeV2VerifierRunV1, budget: unknown) =>
      abandon(run, budget).pipe(
        Effect.mapError(error =>
          narrowVerifierOperationError(error, "abandon")
        ),
      ),
  });
}

function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "createAttempt",
): VerifierCreateAttemptV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "observeAttempt",
): VerifierObserveAttemptV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "acquire",
): VerifierAcquireV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "renew",
): VerifierRenewV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "reserveCommand",
): VerifierReserveV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "resumePending",
): VerifierResumeV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "settleCommand",
): VerifierSettleV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "observeSettledPhaseTails",
): VerifierObserveTailsV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: "release" | "abandon",
): VerifierCloseV1Error;
function narrowVerifierOperationError(
  error: DeclarativeV2VerifierProgressV1Error,
  operation: DeclarativeV2VerifierProgressOperationV1,
): DeclarativeV2VerifierProgressV1Error {
  if (
    error instanceof DeclarativeV2VerifierProgressConfigurationV1Error
  ) {
    return error;
  }
  if (
    error instanceof DeclarativeV2Sha256InputV1Error ||
    error instanceof DeclarativeV2Sha256ResourceV1Error
  ) {
    if (
      operation === "createAttempt" ||
      operation === "observeAttempt" ||
      operation === "acquire" ||
      operation === "reserveCommand" ||
      operation === "resumePending" ||
      operation === "settleCommand" ||
      operation === "observeSettledPhaseTails"
    ) {
      return error;
    }
    throw error;
  }
  if (
    operation === "createAttempt" &&
    error.operation === "readCandidate"
  ) {
    return error;
  }
  if (error.operation === operation) return error;
  throw error;
}

function captureConfiguration(
  options: DeclarativeV2VerifierProgressOptionsV1,
): DeclarativeV2VerifierProgressRepositoryV1["configuration"] {
  return isPositiveSafeInteger(options.claimDurationMilliseconds)
    ? Result.succeed(Object.freeze({
      claimDurationMilliseconds: options.claimDurationMilliseconds,
    }))
    : Result.fail(new DeclarativeV2VerifierProgressConfigurationV1Error({
      reason: "invalidClaimDuration",
    }));
}

function decodeOperationBudget(
  operation: DeclarativeV2VerifierProgressOperationV1,
  value: unknown,
): Result.Result<
  Readonly<DeclarativeV2VerifierProgressOperationBudgetV1>,
  DeclarativeV2VerifierProgressInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 6 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(inputError(operation, "invalidBudget"));
  }
  const maximumCalls = ownDataValue(value, "maximumCalls");
  const maximumRows = ownDataValue(value, "maximumRows");
  const maximumFrameBytes = ownDataValue(value, "maximumFrameBytes");
  const maximumCanonicalBytes = ownDataValue(value, "maximumCanonicalBytes");
  const maximumHashBytes = ownDataValue(value, "maximumHashBytes");
  const maximumElapsedMilliseconds = ownDataValue(
    value,
    "maximumElapsedMilliseconds",
  );
  if (
    !isNonNegativeSafeInteger(maximumCalls) ||
    !isNonNegativeSafeInteger(maximumRows) ||
    !isNonNegativeSafeInteger(maximumFrameBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes) ||
    !isNonNegativeSafeInteger(maximumHashBytes) ||
    !isNonNegativeSafeInteger(maximumElapsedMilliseconds)
  ) {
    return Result.fail(inputError(operation, "invalidBudget"));
  }
  return Result.succeed(Object.freeze({
    maximumCalls,
    maximumRows,
    maximumFrameBytes,
    maximumCanonicalBytes,
    maximumHashBytes,
    maximumElapsedMilliseconds,
  }));
}

function captureCreateInput(
  value: unknown,
): Result.Result<
  Readonly<{
    readonly scopeId: ScopeId;
    readonly candidateSha256: Uint8Array;
    readonly ceilings: DeclarativeV2BudgetFrameV1;
  }>,
  DeclarativeV2VerifierProgressInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 3 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(inputError("createAttempt", "invalidInput"));
  }
  const rawScopeId = ownDataValue(value, "scopeId");
  const candidateSha256 = ownDataValue(value, "candidateSha256");
  const ceilings = ownDataValue(value, "ceilings");
  const scopeIdResult = decodeScopeId(rawScopeId);
  if (
    Result.isFailure(scopeIdResult) ||
    !isUint8ArrayWithByteLength(
      candidateSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !isBudgetFrameKind(ceilings, "attempt_ceilings")
  ) {
    return Result.fail(inputError("createAttempt", "invalidInput"));
  }
  return Result.succeed(Object.freeze({
    scopeId: scopeIdResult.success,
    candidateSha256: new Uint8Array(candidateSha256),
    ceilings: captureBudgetFrame(ceilings),
  }));
}

function captureSelector(
  operation: "observeAttempt" | "acquire",
  rawScopeId: unknown,
  rawAttemptSha256: unknown,
): Result.Result<
  Readonly<{ readonly scopeId: ScopeId; readonly attemptSha256: Uint8Array }>,
  DeclarativeV2VerifierProgressInputV1Error
> {
  const scopeId = decodeScopeId(rawScopeId);
  if (
    Result.isFailure(scopeId) ||
    !isUint8ArrayWithByteLength(
      rawAttemptSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    )
  ) {
    return Result.fail(inputError(operation, "invalidInput"));
  }
  return Result.succeed(Object.freeze({
    scopeId: scopeId.success,
    attemptSha256: new Uint8Array(rawAttemptSha256),
  }));
}

function captureReserveInput(
  value: unknown,
): Result.Result<
  Readonly<DeclarativeV2VerifierReserveCommandInputV1>,
  DeclarativeV2VerifierProgressInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 5 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(inputError("reserveCommand", "invalidInput"));
  }
  const commandKind = ownDataValue(value, "commandKind");
  const sequence = ownDataValue(value, "sequence");
  const previousReceiptSha256 = ownDataValue(
    value,
    "previousReceiptSha256",
  );
  const commandBudget = ownDataValue(value, "commandBudget");
  const inputSha256 = ownDataValue(value, "inputSha256");
  if (
    !isSettlingCommandKind(commandKind) ||
    !isPositiveI64(sequence) ||
    !isNullableDigest(previousReceiptSha256) ||
    !isBudgetFrameKind(commandBudget, "command_budget") ||
    !isUint8ArrayWithByteLength(
      inputSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    )
  ) {
    return Result.fail(inputError("reserveCommand", "invalidInput"));
  }
  return Result.succeed(Object.freeze({
    commandKind,
    sequence,
    previousReceiptSha256: previousReceiptSha256 === null
      ? null
      : new Uint8Array(previousReceiptSha256),
    commandBudget: captureBudgetFrame(commandBudget),
    inputSha256: new Uint8Array(inputSha256),
  }));
}

const captureFrame = Effect.fn(
  "DeclarativeV2.verifier.captureFrame",
)(function* <Frame extends DeclarativeV2PhysicalFrameV1>(
  operation: DeclarativeV2VerifierProgressOperationV1,
  input: unknown,
  expectedKind: Frame["kind"],
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  sha256: DeclarativeV2Sha256V1,
): Generator<
  Effect.Effect<unknown, DeclarativeV2VerifierProgressV1Error>,
  CapturedFrameV1<Frame>,
  never
> {
    const preimage = yield* Effect.fromResult(
      captureFramePreimage<Frame>(
        operation,
        input,
        expectedKind,
        budget,
        usage,
      ),
    );
    return yield* hashCapturedFrame(preimage, sha256);
});

function captureFramePreimage<
  Frame extends DeclarativeV2PhysicalFrameV1,
>(
  operation: DeclarativeV2VerifierProgressOperationV1,
  input: unknown,
  expectedKind: Frame["kind"],
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Result.Result<
  CapturedFramePreimageV1<Frame>,
  DeclarativeV2VerifierProgressInputV1Error
> {
  return Result.gen(function* () {
    const encoded = yield* encodeDeclarativeV2PhysicalFrameV1(input, {
      maximumFrameBytes: remaining(budget.maximumFrameBytes, usage.frameBytes),
      maximumCanonicalBytes: remaining(
        budget.maximumCanonicalBytes,
        usage.canonicalBytes,
      ),
    }).pipe(
      Result.mapError((codecCause) =>
        mapCodecInputError(operation, codecCause, budget, usage)
      ),
    );
    if (encoded.frame.kind !== expectedKind) {
      return yield* Result.fail(inputError(operation, "invalidInput"));
    }
    yield* chargeResult(
      operation,
      budget,
      usage,
      "frameBytes",
      encoded.usage.frameBytes,
    );
    yield* chargeResult(
      operation,
      budget,
      usage,
      "canonicalBytes",
      encoded.usage.canonicalBytes,
    );
    yield* chargeResult(
      operation,
      budget,
      usage,
      "hashBytes",
      encoded.canonicalBytes.byteLength,
    );
    return Object.freeze({
      frame: encoded.frame as Frame,
      bytes: new Uint8Array(encoded.canonicalBytes),
    });
  });
}

const hashCapturedFrame = Effect.fn(
  "DeclarativeV2.verifier.hashCapturedFrame",
)(function* <Frame extends DeclarativeV2PhysicalFrameV1>(
  preimage: CapturedFramePreimageV1<Frame>,
  sha256: DeclarativeV2Sha256V1,
) {
    const digest = yield* sha256(preimage.bytes, {
      maximumInputBytes: preimage.bytes.byteLength,
    });
    return Object.freeze({
      frame: preimage.frame,
      bytes: new Uint8Array(preimage.bytes),
      sha256: new Uint8Array(digest),
    });
});

const decodeStoredFrame = Effect.fn(
  "DeclarativeV2.verifier.decodeStoredFrame",
)(function* <Frame extends DeclarativeV2PhysicalFrameV1>(
  operation: DeclarativeV2VerifierProgressOperationV1,
  stored: StoredFrameV1,
  expectedKind: Frame["kind"],
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  sha256: DeclarativeV2Sha256V1,
): Generator<
  Effect.Effect<unknown, DeclarativeV2VerifierProgressV1Error>,
  CapturedFrameV1<Frame>,
  never
> {
    if (
      stored.codecVersion !== DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 ||
      stored.byteLength < 1n ||
      stored.byteLength !== BigInt(stored.bytes.byteLength) ||
      !isUint8ArrayWithByteLength(
        stored.sha256,
        DECLARATIVE_V2_SHA256_BYTES_V1,
      )
    ) {
      return yield* corruption(operation, "invalidMetadata");
    }
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2PhysicalFrameV1(stored.bytes, {
        maximumFrameBytes: remaining(budget.maximumFrameBytes, usage.frameBytes),
        maximumCanonicalBytes: remaining(
          budget.maximumCanonicalBytes,
          usage.canonicalBytes,
        ),
      }).pipe(
        Result.mapError((codecCause) =>
          mapStoredCodecError(operation, codecCause, budget, usage)
        ),
      ),
    );
    yield* Effect.fromResult(chargeResult(
      operation,
      budget,
      usage,
      "frameBytes",
      decoded.usage.frameBytes,
    ));
    yield* Effect.fromResult(chargeResult(
      operation,
      budget,
      usage,
      "canonicalBytes",
      decoded.usage.canonicalBytes,
    ));
    yield* Effect.fromResult(chargeResult(
      operation,
      budget,
      usage,
      "hashBytes",
      decoded.canonicalBytes.byteLength,
    ));
    const digest = yield* sha256(decoded.canonicalBytes, {
      maximumInputBytes: decoded.canonicalBytes.byteLength,
    });
    if (
      decoded.frame.kind !== expectedKind ||
      !bytesEqualFullScan(digest, stored.sha256)
    ) {
      return yield* corruption(
        operation,
        decoded.frame.kind !== expectedKind
          ? "normalizedMismatch"
          : "digestMismatch",
      );
    }
    return Object.freeze({
      frame: decoded.frame as Frame,
      bytes: new Uint8Array(decoded.canonicalBytes),
      sha256: new Uint8Array(digest),
    });
});

const decodeAttemptObservation = Effect.fn(
  "DeclarativeV2.verifier.decodeAttemptObservation",
)(function* (
  operation: DeclarativeV2VerifierProgressOperationV1,
  locked: LockedAttemptV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  tracker: MutableOperationUsageV1,
  sha256: DeclarativeV2Sha256V1,
): Generator<
  Effect.Effect<unknown, DeclarativeV2VerifierProgressV1Error>,
  DeclarativeV2VerifierAttemptObservationV1,
  never
> {
    const identity = yield* decodeStoredFrame<DeclarativeV2AttemptIdentityFrameV1>(
      operation,
      locked.frames.identity,
      "attempt_identity",
      budget,
      tracker,
      sha256,
    );
    const ceilings = yield* decodeStoredFrame<DeclarativeV2BudgetFrameV1>(
      operation,
      locked.frames.ceilings,
      "attempt_ceilings",
      budget,
      tracker,
      sha256,
    );
    const usage = yield* decodeStoredFrame<DeclarativeV2BudgetFrameV1>(
      operation,
      locked.frames.usage,
      "attempt_usage",
      budget,
      tracker,
      sha256,
    );
    const progress = yield* decodeStoredFrame<DeclarativeV2ProgressCursorFrameV1>(
      operation,
      locked.frames.progress,
      "progress_cursor",
      budget,
      tracker,
      sha256,
    );
    const lastReceipt = locked.frames.lastReceipt === null
      ? null
      : yield* decodeStoredFrame<DeclarativeV2CommandReceiptFrameV1>(
        operation,
        locked.frames.lastReceipt,
        "command_receipt",
        budget,
        tracker,
        sha256,
      );
    const pendingBudget = locked.frames.pendingBudget === null
      ? null
      : yield* decodeStoredFrame<DeclarativeV2BudgetFrameV1>(
        operation,
        locked.frames.pendingBudget,
        "command_budget",
        budget,
        tracker,
        sha256,
      );
    const lastReceiptUsageSha256 = lastReceipt === null ||
        pendingBudget === null
      ? usage.sha256
      : (yield* captureFrame<DeclarativeV2BudgetFrameV1>(
        operation,
        yield* Effect.fromResult(
          subtractPendingBudget(operation, usage.frame, pendingBudget.frame),
        ),
        "attempt_usage",
        budget,
        tracker,
        sha256,
      )).sha256;
    if (
      identity.frame.verifierProgressProtocolIdentity !==
        ATTEMPT_PROTOCOL_IDENTITY
    ) {
      return yield* corruption(operation, "unsupportedProtocol");
    }
    if (
      !bytesEqualFullScan(identity.sha256, locked.attemptSha256) ||
      !bytesEqualFullScan(identity.frame.candidateSha256, locked.candidateSha256) ||
      !bytesEqualFullScan(
        identity.frame.ceilingsSha256,
        ceilings.sha256,
      ) ||
      progress.frame.settledSequence !== locked.settledSequence ||
      (locked.settledSequence === 0n) !== (lastReceipt === null) ||
      (
        lastReceipt !== null &&
        (
          lastReceipt.frame.sequence !== locked.settledSequence ||
          locked.lastCommandSha256 === null ||
          !bytesEqualFullScan(
            lastReceipt.frame.reservationSha256,
            locked.lastCommandSha256,
          ) ||
          !bytesEqualFullScan(
            lastReceipt.frame.usageSha256,
            lastReceiptUsageSha256,
          ) ||
          !bytesEqualFullScan(
            lastReceipt.frame.progressCursorSha256,
            progress.sha256,
          )
        )
      ) ||
      (
        locked.pendingKind === null
          ? locked.pendingSequence !== null ||
            locked.pendingCommandSha256 !== null ||
            locked.pendingReservedByFence !== null ||
            pendingBudget !== null
          : locked.pendingSequence !== locked.settledSequence + 1n ||
            locked.pendingCommandSha256 === null ||
            locked.pendingReservedByFence === null ||
            pendingBudget === null
      )
    ) {
      return yield* corruption(operation, "normalizedMismatch");
    }
    for (const dimension of BUDGET_DIMENSIONS) {
      if (usage.frame[dimension] > ceilings.frame[dimension]) {
        return yield* corruption(operation, "normalizedMismatch");
      }
    }
    const claimExpiresAt = locked.leaseExpiresAt === null
      ? null
      : copyDate(locked.leaseExpiresAt);
    return Object.freeze({
      scopeId: locked.scopeId,
      attemptSha256: new Uint8Array(locked.attemptSha256),
      candidateSha256: new Uint8Array(locked.candidateSha256),
      lifecycle: locked.lifecycle,
      writerFence: locked.writerFence,
      claimExpiresAt,
      settledSequence: locked.settledSequence,
      lastCommandSha256: copyNullableBytes(locked.lastCommandSha256),
      lastReceipt: lastReceipt?.frame ?? null,
      pendingKind: locked.pendingKind,
      pendingSequence: locked.pendingSequence,
      pendingCommandSha256: copyNullableBytes(locked.pendingCommandSha256),
      pendingReservedByFence: locked.pendingReservedByFence,
      identity: identity.frame,
      ceilings: ceilings.frame,
      usage: usage.frame,
      progress: progress.frame,
    });
});

async function lockAttempt(
  tx: AppRowTransaction,
  operation: DeclarativeV2VerifierProgressOperationV1,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  forUpdate: boolean,
): Promise<LockedAttemptV1 | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const metadataQuery = tx
    .select({
      scope_id: fxSystemDeclarativeV2VerifierAttempts.scopeId,
      attempt_sha256: fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      candidate_sha256:
        fxSystemDeclarativeV2VerifierAttempts.candidateSha256,
      lifecycle: fxSystemDeclarativeV2VerifierAttempts.lifecycle,
      writer_owner_id:
        fxSystemDeclarativeV2VerifierAttempts.writerOwnerId,
      writer_fence_text:
        sql<string>`${fxSystemDeclarativeV2VerifierAttempts.writerFence}::text`,
      lease_updated_at_milliseconds_text: sql<string | null>`
        case when ${fxSystemDeclarativeV2VerifierAttempts.leaseUpdatedAt}
          is null then null
        else floor(extract(epoch from
          ${fxSystemDeclarativeV2VerifierAttempts.leaseUpdatedAt})
          * 1000)::bigint::text end`,
      lease_expires_at_milliseconds_text: sql<string | null>`
        case when ${fxSystemDeclarativeV2VerifierAttempts.leaseExpiresAt}
          is null then null
        else floor(extract(epoch from
          ${fxSystemDeclarativeV2VerifierAttempts.leaseExpiresAt})
          * 1000)::bigint::text end`,
      settled_sequence_text:
        sql<string>`${fxSystemDeclarativeV2VerifierAttempts.settledSequence}::text`,
      last_command_sha256:
        fxSystemDeclarativeV2VerifierAttempts.lastCommandSha256,
      pending_kind: fxSystemDeclarativeV2VerifierAttempts.pendingKind,
      pending_sequence_text: sql<string | null>`
        case when ${fxSystemDeclarativeV2VerifierAttempts.pendingSequence}
          is null then null
        else ${fxSystemDeclarativeV2VerifierAttempts.pendingSequence}::text end`,
      pending_command_sha256:
        fxSystemDeclarativeV2VerifierAttempts.pendingCommandSha256,
      pending_reserved_by_fence_text: sql<string | null>`
        case when
          ${fxSystemDeclarativeV2VerifierAttempts.pendingReservedByFence}
          is null then null
        else
          ${fxSystemDeclarativeV2VerifierAttempts.pendingReservedByFence}::text
        end`,
      identity_codec_version:
        fxSystemDeclarativeV2VerifierAttempts.identityCodecVersion,
      identity_byte_length_text:
        sql<string>`${fxSystemDeclarativeV2VerifierAttempts.identityByteLength}::text`,
      identity_sha256:
        fxSystemDeclarativeV2VerifierAttempts.identitySha256,
      ceilings_codec_version:
        fxSystemDeclarativeV2VerifierAttempts.ceilingsCodecVersion,
      ceilings_byte_length_text:
        sql<string>`${fxSystemDeclarativeV2VerifierAttempts.ceilingsByteLength}::text`,
      ceilings_sha256:
        fxSystemDeclarativeV2VerifierAttempts.ceilingsSha256,
      usage_codec_version:
        fxSystemDeclarativeV2VerifierAttempts.usageCodecVersion,
      usage_byte_length_text:
        sql<string>`${fxSystemDeclarativeV2VerifierAttempts.usageByteLength}::text`,
      usage_sha256: fxSystemDeclarativeV2VerifierAttempts.usageSha256,
      progress_codec_version:
        fxSystemDeclarativeV2VerifierAttempts.progressCodecVersion,
      progress_byte_length_text:
        sql<string>`${fxSystemDeclarativeV2VerifierAttempts.progressByteLength}::text`,
      progress_sha256:
        fxSystemDeclarativeV2VerifierAttempts.progressSha256,
      last_receipt_codec_version:
        fxSystemDeclarativeV2VerifierAttempts.lastReceiptCodecVersion,
      last_receipt_byte_length_text: sql<string | null>`
        case when
          ${fxSystemDeclarativeV2VerifierAttempts.lastReceiptByteLength}
          is null then null
        else
          ${fxSystemDeclarativeV2VerifierAttempts.lastReceiptByteLength}::text
        end`,
      last_receipt_sha256:
        fxSystemDeclarativeV2VerifierAttempts.lastReceiptSha256,
      pending_budget_codec_version:
        fxSystemDeclarativeV2VerifierAttempts.pendingBudgetCodecVersion,
      pending_budget_byte_length_text: sql<string | null>`
        case when
          ${fxSystemDeclarativeV2VerifierAttempts.pendingBudgetByteLength}
          is null then null
        else
          ${fxSystemDeclarativeV2VerifierAttempts.pendingBudgetByteLength}::text
        end`,
      pending_budget_sha256:
        fxSystemDeclarativeV2VerifierAttempts.pendingBudgetSha256,
      database_now_milliseconds_text: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text`,
    })
    .from(fxSystemDeclarativeV2VerifierAttempts)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierAttempts.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
        attemptSha256,
      ),
    ));
  const metadataRows = await runVerifierStatement(
    operation,
    () => forUpdate ? metadataQuery.for("update") : metadataQuery,
  );
  if (metadataRows.length === 0) return null;
  if (metadataRows.length !== 1) {
    throw corruption(operation, "selectorMismatch");
  }
  const metadata = decodeAttemptMetadata(operation, metadataRows[0]);
  const storedByteLength = sumStoredFrameByteLengths(
    operation,
    metadata.frames,
  );
  chargeOrThrow(operation, budget, usage, "frameBytes", storedByteLength);

  chargeSqlOrThrow(operation, budget, usage, 1);
  const byteRows = await runVerifierStatement(operation, () =>
    tx
      .select({
        identity_bytes: fxSystemDeclarativeV2VerifierAttempts.identityBytes,
        ceilings_bytes: fxSystemDeclarativeV2VerifierAttempts.ceilingsBytes,
        usage_bytes: fxSystemDeclarativeV2VerifierAttempts.usageBytes,
        progress_bytes: fxSystemDeclarativeV2VerifierAttempts.progressBytes,
        last_receipt_bytes:
          fxSystemDeclarativeV2VerifierAttempts.lastReceiptBytes,
        pending_budget_bytes:
          fxSystemDeclarativeV2VerifierAttempts.pendingBudgetBytes,
      })
      .from(fxSystemDeclarativeV2VerifierAttempts)
      .where(and(
        eq(fxSystemDeclarativeV2VerifierAttempts.scopeId, scopeId),
        eq(
          fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
          attemptSha256,
        ),
      ))
  );
  if (byteRows.length !== 1) {
    throw corruption(operation, "invalidStoredBytes");
  }
  const byteRow = byteRows[0];
  return Object.freeze({
    ...metadata,
    frames: Object.freeze({
      identity: attachStoredBytes(
        operation,
        metadata.frames.identity,
        ownDataValue(byteRow, "identity_bytes"),
      ),
      ceilings: attachStoredBytes(
        operation,
        metadata.frames.ceilings,
        ownDataValue(byteRow, "ceilings_bytes"),
      ),
      usage: attachStoredBytes(
        operation,
        metadata.frames.usage,
        ownDataValue(byteRow, "usage_bytes"),
      ),
      progress: attachStoredBytes(
        operation,
        metadata.frames.progress,
        ownDataValue(byteRow, "progress_bytes"),
      ),
      lastReceipt: metadata.frames.lastReceipt === null
        ? null
        : attachStoredBytes(
          operation,
          metadata.frames.lastReceipt,
          ownDataValue(byteRow, "last_receipt_bytes"),
        ),
      pendingBudget: metadata.frames.pendingBudget === null
        ? null
        : attachStoredBytes(
          operation,
          metadata.frames.pendingBudget,
          ownDataValue(byteRow, "pending_budget_bytes"),
        ),
    }),
  });
}

function decodeAttemptMetadata(
  operation: DeclarativeV2VerifierProgressOperationV1,
  value: unknown,
): Omit<LockedAttemptV1, "frames"> & Readonly<{
  readonly frames: Readonly<{
    readonly identity: Omit<StoredFrameV1, "bytes">;
    readonly ceilings: Omit<StoredFrameV1, "bytes">;
    readonly usage: Omit<StoredFrameV1, "bytes">;
    readonly progress: Omit<StoredFrameV1, "bytes">;
    readonly lastReceipt: Omit<StoredFrameV1, "bytes"> | null;
    readonly pendingBudget: Omit<StoredFrameV1, "bytes"> | null;
  }>;
}> {
  if (!isNonArrayRecord(value)) {
    throw corruption(operation, "invalidMetadata");
  }
  const scopeId = ownDataValue(value, "scope_id");
  const attemptSha256 = ownDataValue(value, "attempt_sha256");
  const candidateSha256 = ownDataValue(value, "candidate_sha256");
  const lifecycle = ownDataValue(value, "lifecycle");
  const writerOwnerId = ownDataValue(value, "writer_owner_id");
  const writerFence = parseI64Text(
    ownDataValue(value, "writer_fence_text"),
  );
  const leaseUpdatedAt = parseNullableDateMilliseconds(
    ownDataValue(value, "lease_updated_at_milliseconds_text"),
  );
  const leaseExpiresAt = parseNullableDateMilliseconds(
    ownDataValue(value, "lease_expires_at_milliseconds_text"),
  );
  const settledSequence = parseI64Text(
    ownDataValue(value, "settled_sequence_text"),
  );
  const lastCommandSha256 = ownDataValue(value, "last_command_sha256");
  const pendingKind = ownDataValue(value, "pending_kind");
  const pendingSequence = parseNullableI64Text(
    ownDataValue(value, "pending_sequence_text"),
  );
  const pendingCommandSha256 = ownDataValue(
    value,
    "pending_command_sha256",
  );
  const pendingReservedByFence = parseNullableI64Text(
    ownDataValue(value, "pending_reserved_by_fence_text"),
  );
  const databaseNow = parseDateMilliseconds(
    ownDataValue(value, "database_now_milliseconds_text"),
  );
  if (
    typeof scopeId !== "string" ||
    !isUint8ArrayWithByteLength(
      attemptSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !isUint8ArrayWithByteLength(
      candidateSha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !isLifecycle(lifecycle) ||
    (writerOwnerId !== null &&
      (typeof writerOwnerId !== "string" ||
        !isLowercaseUuidText(writerOwnerId))) ||
    writerFence === undefined ||
    leaseUpdatedAt === undefined ||
    leaseExpiresAt === undefined ||
    settledSequence === undefined ||
    !isNullableDigest(lastCommandSha256) ||
    !isNullableCommandKind(pendingKind) ||
    pendingSequence === undefined ||
    !isNullableDigest(pendingCommandSha256) ||
    pendingReservedByFence === undefined ||
    databaseNow === undefined
  ) {
    throw corruption(operation, "invalidMetadata");
  }
  const identity = decodeStoredMetadata(
    operation,
    value,
    "identity",
    false,
  );
  const ceilings = decodeStoredMetadata(
    operation,
    value,
    "ceilings",
    false,
  );
  const usage = decodeStoredMetadata(
    operation,
    value,
    "usage",
    false,
  );
  const progress = decodeStoredMetadata(
    operation,
    value,
    "progress",
    false,
  );
  const lastReceipt = decodeStoredMetadata(
    operation,
    value,
    "last_receipt",
    true,
  );
  const pendingBudget = decodeStoredMetadata(
    operation,
    value,
    "pending_budget",
    true,
  );
  if (
    identity === null ||
    ceilings === null ||
    usage === null ||
    progress === null
  ) {
    throw corruption(operation, "invalidMetadata");
  }
  return Object.freeze({
    scopeId,
    attemptSha256: new Uint8Array(attemptSha256),
    candidateSha256: new Uint8Array(candidateSha256),
    lifecycle,
    writerOwnerId,
    writerFence,
    leaseUpdatedAt,
    leaseExpiresAt,
    settledSequence,
    lastCommandSha256: copyNullableBytes(lastCommandSha256),
    pendingKind,
    pendingSequence,
    pendingCommandSha256: copyNullableBytes(pendingCommandSha256),
    pendingReservedByFence,
    databaseNow,
    frames: Object.freeze({
      identity,
      ceilings,
      usage,
      progress,
      lastReceipt,
      pendingBudget,
    }),
  });
}

function decodeStoredMetadata(
  operation: DeclarativeV2VerifierProgressOperationV1,
  row: Readonly<Record<string, unknown>>,
  prefix: string,
  nullable: boolean,
): Omit<StoredFrameV1, "bytes"> | null {
  const codecVersion = ownDataValue(row, `${prefix}_codec_version`);
  const byteLength = parseNullableI64Text(
    ownDataValue(row, `${prefix}_byte_length_text`),
  );
  const sha256 = ownDataValue(row, `${prefix}_sha256`);
  if (
    nullable &&
    codecVersion === null &&
    byteLength === null &&
    sha256 === null
  ) {
    return null;
  }
  if (
    typeof codecVersion !== "number" ||
    !Number.isSafeInteger(codecVersion) ||
    byteLength === undefined ||
    byteLength === null ||
    byteLength < 1n ||
    !isUint8ArrayWithByteLength(sha256, DECLARATIVE_V2_SHA256_BYTES_V1)
  ) {
    throw corruption(operation, "invalidMetadata");
  }
  return Object.freeze({
    codecVersion,
    byteLength,
    sha256: new Uint8Array(sha256),
  });
}

function attachStoredBytes(
  operation: DeclarativeV2VerifierProgressOperationV1,
  metadata: Omit<StoredFrameV1, "bytes">,
  value: unknown,
): StoredFrameV1 {
  if (!isUint8Array(value)) {
    throw corruption(operation, "invalidStoredBytes");
  }
  const bytes = new Uint8Array(value);
  if (BigInt(bytes.byteLength) !== metadata.byteLength) {
    throw corruption(operation, "invalidStoredBytes");
  }
  return Object.freeze({ ...metadata, bytes });
}

function sumStoredFrameByteLengths(
  operation: DeclarativeV2VerifierProgressOperationV1,
  frames: Readonly<{
    readonly identity: Omit<StoredFrameV1, "bytes">;
    readonly ceilings: Omit<StoredFrameV1, "bytes">;
    readonly usage: Omit<StoredFrameV1, "bytes">;
    readonly progress: Omit<StoredFrameV1, "bytes">;
    readonly lastReceipt: Omit<StoredFrameV1, "bytes"> | null;
    readonly pendingBudget: Omit<StoredFrameV1, "bytes"> | null;
  }>,
): number {
  let total = 0;
  for (const frame of [
    frames.identity,
    frames.ceilings,
    frames.usage,
    frames.progress,
    frames.lastReceipt,
    frames.pendingBudget,
  ]) {
    if (frame === null) continue;
    if (frame.byteLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw corruption(operation, "invalidMetadata");
    }
    const length = Number(frame.byteLength);
    if (total > Number.MAX_SAFE_INTEGER - length) {
      throw corruption(operation, "invalidMetadata");
    }
    total += length;
  }
  return total;
}

function runTransactionWithConfirmedRollbackRetry<Value>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: DeclarativeV2VerifierProgressOperationV1,
  scopeId: string,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  monotonicMilliseconds: () => number,
  start: number,
  work: (tx: AppRowTransaction) => Promise<Value>,
): Effect.Effect<Value, DeclarativeV2VerifierProgressV1Error> {
  const attempt = () => Effect.fromResult(setElapsedResult(
      operation,
      budget,
      usage,
      start,
      monotonicMilliseconds,
    )).pipe(
      Effect.flatMap(() => {
        const transaction = target[RUN_LOCATED_READ_COMMITTED_V1](work);
        return awaitSettlement(transaction).pipe(
          Effect.mapError((cause) =>
            mapTransactionFailure(
              operation,
              scopeId,
              attemptSha256,
              cause,
            )
          ),
        );
      }),
    );
  return Effect.suspend(attempt).pipe(
    Effect.catchIf(
      (error): error is DeclarativeV2VerifierProgressConfirmedRollbackV1Error =>
        error instanceof DeclarativeV2VerifierProgressConfirmedRollbackV1Error,
      () => Effect.suspend(attempt),
    ),
  );
}

function awaitSettlement<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptibleMask((restore) =>
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
  operation: DeclarativeV2VerifierProgressOperationV1,
  scopeId: string,
  attemptSha256: Uint8Array,
  cause: unknown,
): DeclarativeV2VerifierProgressV1Error {
  if (isVerifierProgressError(cause)) return cause;
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    switch (cause.issue.kind) {
      case "callbackRolledBack": {
        const callbackCause = cause.issue.callbackCause;
        if (isVerifierProgressError(callbackCause)) return callbackCause;
        if (callbackCause instanceof VerifierBudgetFailureV1) {
          return callbackCause.error;
        }
        if (callbackCause instanceof VerifierStatementFailureV1) {
          return new DeclarativeV2VerifierProgressConfirmedRollbackV1Error({
            operation,
            cause: callbackCause.cause,
          });
        }
        throw callbackCause;
      }
      case "decisionUncertain":
        return new DeclarativeV2VerifierProgressDecisionUncertainV1Error({
          operation,
          scopeId,
          attemptSha256: new Uint8Array(attemptSha256),
          cause,
        });
      case "callbackCleanupFailed":
        return new DeclarativeV2VerifierProgressResourceV1Error({
          operation,
          phase: "cleanup",
          cause,
        });
      case "infrastructureFailure":
        return new DeclarativeV2VerifierProgressResourceV1Error({
          operation,
          phase: "infrastructure",
          cause,
        });
    }
  }
  if (cause instanceof VerifierStatementFailureV1) {
    return new DeclarativeV2VerifierProgressConfirmedRollbackV1Error({
      operation,
      cause: cause.cause,
    });
  }
  throw cause;
}

async function runVerifierStatement<Value>(
  operation: DeclarativeV2VerifierProgressOperationV1,
  statement: () => Promise<Value>,
): Promise<Value> {
  try {
    return await statement();
  } catch (cause) {
    if (
      isVerifierProgressError(cause) ||
      cause instanceof VerifierBudgetFailureV1
    ) {
      throw cause;
    }
    throw new VerifierStatementFailureV1(cause);
  }
}

const BUDGET_DIMENSIONS = [
  "calls",
  "sourceBytes",
  "modules",
  "importEdges",
  "tokens",
  "tokenBytes",
  "nestingDepth",
  "functions",
  "schemaNodes",
  "validatorNodes",
  "graphNodes",
  "frontierEntries",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "diagnosticBytes",
  "outputBytes",
  "elapsedMilliseconds",
] as const satisfies readonly DeclarativeV2BudgetDimensionV1[];

const OPERATION_USAGE_DIMENSIONS = [
  "calls",
  "rows",
  "frameBytes",
  "canonicalBytes",
  "hashBytes",
  "elapsedMilliseconds",
] as const satisfies readonly (keyof DeclarativeV2VerifierProgressOperationUsageV1)[];

const OPERATION_BUDGET_BY_USAGE = {
  calls: "maximumCalls",
  rows: "maximumRows",
  frameBytes: "maximumFrameBytes",
  canonicalBytes: "maximumCanonicalBytes",
  hashBytes: "maximumHashBytes",
  elapsedMilliseconds: "maximumElapsedMilliseconds",
} as const satisfies Readonly<Record<
  keyof DeclarativeV2VerifierProgressOperationUsageV1,
  keyof DeclarativeV2VerifierProgressOperationBudgetV1
>>;

function subtractPendingBudget(
  operation: DeclarativeV2VerifierProgressOperationV1,
  usage: DeclarativeV2BudgetFrameV1,
  pending: DeclarativeV2BudgetFrameV1,
): Result.Result<
  DeclarativeV2BudgetFrameV1,
  DeclarativeV2VerifierProgressCorruptionV1Error
> {
  const values: Partial<Record<DeclarativeV2BudgetDimensionV1, bigint>> = {};
  for (const dimension of BUDGET_DIMENSIONS) {
    if (usage[dimension] < pending[dimension]) {
      return Result.fail(corruption(operation, "normalizedMismatch"));
    }
    values[dimension] = usage[dimension] - pending[dimension];
  }
  return Result.succeed(Object.freeze({
    kind: "attempt_usage",
    ...values,
  }) as DeclarativeV2BudgetFrameV1);
}

function mutableUsage(): MutableOperationUsageV1 {
  return {
    calls: 0,
    rows: 0,
    frameBytes: 0,
    canonicalBytes: 0,
    hashBytes: 0,
    elapsedMilliseconds: 0,
  };
}

function freezeUsage(
  usage: DeclarativeV2VerifierProgressOperationUsageV1,
): DeclarativeV2VerifierProgressOperationUsageV1 {
  return Object.freeze({
    calls: usage.calls,
    rows: usage.rows,
    frameBytes: usage.frameBytes,
    canonicalBytes: usage.canonicalBytes,
    hashBytes: usage.hashBytes,
    elapsedMilliseconds: usage.elapsedMilliseconds,
  });
}

function chargeResult(
  operation: DeclarativeV2VerifierProgressOperationV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  dimension: keyof DeclarativeV2VerifierProgressOperationUsageV1,
  amount: number,
): Result.Result<void, DeclarativeV2VerifierProgressInputV1Error> {
  if (!isNonNegativeSafeInteger(amount)) {
    return Result.fail(inputError(
      operation,
      "budgetExceeded",
      dimension,
      Number.MAX_SAFE_INTEGER,
      budget[OPERATION_BUDGET_BY_USAGE[dimension]],
    ));
  }
  const current = usage[dimension];
  const observed = current > Number.MAX_SAFE_INTEGER - amount
    ? Number.MAX_SAFE_INTEGER
    : current + amount;
  const maximum = budget[OPERATION_BUDGET_BY_USAGE[dimension]];
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
  operation: DeclarativeV2VerifierProgressOperationV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  dimension: keyof DeclarativeV2VerifierProgressOperationUsageV1,
  amount: number,
): void {
  const result = chargeResult(operation, budget, usage, dimension, amount);
  if (Result.isFailure(result)) {
    throw new VerifierBudgetFailureV1(result.failure);
  }
}

function chargeSqlOrThrow(
  operation: DeclarativeV2VerifierProgressOperationV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  expectedRows: number,
): void {
  chargeOrThrow(operation, budget, usage, "calls", 1);
  chargeOrThrow(operation, budget, usage, "rows", expectedRows);
}

function setElapsedResult(
  operation: DeclarativeV2VerifierProgressOperationV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  start: number,
  monotonicMilliseconds: () => number,
): Result.Result<
  void,
  | DeclarativeV2VerifierProgressConfigurationV1Error
  | DeclarativeV2VerifierProgressInputV1Error
> {
  const now = monotonicMilliseconds();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(now) ||
    start < 0 ||
    now < start
  ) {
    return Result.fail(new DeclarativeV2VerifierProgressConfigurationV1Error({
      reason: "invalidMonotonicClock",
    }));
  }
  const elapsed = Math.ceil(now - start);
  if (!isNonNegativeSafeInteger(elapsed)) {
    return Result.fail(inputError(
      operation,
      "budgetExceeded",
      "elapsedMilliseconds",
      Number.MAX_SAFE_INTEGER,
      budget.maximumElapsedMilliseconds,
    ));
  }
  usage.elapsedMilliseconds = 0;
  if (elapsed > budget.maximumElapsedMilliseconds) {
    return Result.fail(inputError(
      operation,
      "budgetExceeded",
      "elapsedMilliseconds",
      elapsed,
      budget.maximumElapsedMilliseconds,
    ));
  }
  usage.elapsedMilliseconds = elapsed;
  return Result.succeed(undefined);
}

function requireTimeOrThrow(
  operation: DeclarativeV2VerifierProgressOperationV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  start: number,
  monotonicMilliseconds: () => number,
): void {
  const result = setElapsedResult(
    operation,
    budget,
    usage,
    start,
    monotonicMilliseconds,
  );
  if (Result.isFailure(result)) throw result.failure;
}

function remaining(maximum: number, used: number): number {
  return used >= maximum ? 0 : maximum - used;
}

function remainingInertBudget(
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: DeclarativeV2VerifierProgressOperationUsageV1,
): Readonly<{
  readonly maximumCalls: number;
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumHashBytes: number;
}> {
  return Object.freeze({
    maximumCalls: remaining(budget.maximumCalls, usage.calls),
    maximumFrameBytes: remaining(budget.maximumFrameBytes, usage.frameBytes),
    maximumCanonicalBytes: remaining(
      budget.maximumCanonicalBytes,
      usage.canonicalBytes,
    ),
    maximumHashBytes: remaining(budget.maximumHashBytes, usage.hashBytes),
  });
}

function mergeInertUsage(
  operation: DeclarativeV2VerifierProgressOperationV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  inertUsage: Readonly<{
    readonly calls: number;
    readonly frameBytes: number;
    readonly canonicalBytes: number;
    readonly hashBytes: number;
  }>,
): Result.Result<void, DeclarativeV2VerifierProgressInputV1Error> {
  for (const [dimension, amount] of [
    ["calls", inertUsage.calls],
    ["rows", inertUsage.calls],
    ["frameBytes", inertUsage.frameBytes],
    ["canonicalBytes", inertUsage.canonicalBytes],
    ["hashBytes", inertUsage.hashBytes],
  ] as const) {
    const result = chargeResult(operation, budget, usage, dimension, amount);
    if (Result.isFailure(result)) return result;
  }
  return Result.succeed(undefined);
}

function inputError(
  operation: DeclarativeV2VerifierProgressOperationV1,
  reason: DeclarativeV2VerifierProgressInputV1Error["reason"],
  dimension?: keyof DeclarativeV2VerifierProgressOperationUsageV1,
  observed?: number,
  maximum?: number,
  semanticDimension?: DeclarativeV2BudgetDimensionV1,
  observedSemantic?: bigint,
  maximumSemantic?: bigint,
): DeclarativeV2VerifierProgressInputV1Error {
  return new DeclarativeV2VerifierProgressInputV1Error({
    operation,
    reason,
    ...(dimension === undefined ? {} : { dimension }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(semanticDimension === undefined ? {} : { semanticDimension }),
    ...(observedSemantic === undefined ? {} : { observedSemantic }),
    ...(maximumSemantic === undefined ? {} : { maximumSemantic }),
  });
}

function corruption(
  operation: DeclarativeV2VerifierProgressOperationV1,
  reason: DeclarativeV2VerifierProgressCorruptionV1Error["reason"],
): DeclarativeV2VerifierProgressCorruptionV1Error {
  return new DeclarativeV2VerifierProgressCorruptionV1Error({
    operation,
    reason,
  });
}

function stale(
  operation: Exclude<
    DeclarativeV2VerifierProgressOperationV1,
    "createAttempt" | "observeAttempt"
  >,
  reason: DeclarativeV2VerifierProgressStaleV1Error["reason"],
): DeclarativeV2VerifierProgressStaleV1Error {
  return new DeclarativeV2VerifierProgressStaleV1Error({
    operation,
    reason,
  });
}

function ownDataValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable &&
      "value" in descriptor
    ? descriptor.value
    : undefined;
}

function mapCodecInputError(
  operation: DeclarativeV2VerifierProgressOperationV1,
  codecCause: DeclarativeV2PhysicalFrameV1Error,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: DeclarativeV2VerifierProgressOperationUsageV1,
): DeclarativeV2VerifierProgressInputV1Error {
  if (
    codecCause.reason === "frameBytesExceeded" ||
    codecCause.reason === "canonicalBytesExceeded"
  ) {
    const observed = codecCause.observed;
    if (observed === undefined || codecCause.maximum === undefined) {
      throw codecCause;
    }
    const dimension = codecCause.reason === "frameBytesExceeded"
      ? "frameBytes"
      : "canonicalBytes";
    const totalObserved = checkedAddNumber(usage[dimension], observed) ??
      Number.MAX_SAFE_INTEGER;
    return new DeclarativeV2VerifierProgressInputV1Error({
      operation,
      reason: "budgetExceeded",
      dimension,
      observed: totalObserved,
      maximum: budget[OPERATION_BUDGET_BY_USAGE[dimension]],
      codecCause,
    });
  }
  return new DeclarativeV2VerifierProgressInputV1Error({
    operation,
    reason: codecCause.reason === "invalidBudget"
      ? "invalidBudget"
      : "invalidInput",
    codecCause,
  });
}

function mapStoredCodecError(
  operation: DeclarativeV2VerifierProgressOperationV1,
  codecCause: DeclarativeV2PhysicalFrameV1Error,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: DeclarativeV2VerifierProgressOperationUsageV1,
):
  | DeclarativeV2VerifierProgressInputV1Error
  | DeclarativeV2VerifierProgressCorruptionV1Error {
  if (
    codecCause.reason === "frameBytesExceeded" ||
    codecCause.reason === "canonicalBytesExceeded"
  ) {
    return mapCodecInputError(operation, codecCause, budget, usage);
  }
  return new DeclarativeV2VerifierProgressCorruptionV1Error({
    operation,
    reason: "invalidStoredBytes",
    codecCause,
  });
}

function isVerifierProgressError(
  value: unknown,
): value is Exclude<
  DeclarativeV2VerifierProgressV1Error,
  DeclarativeV2InertRepositoryV1Error | DeclarativeV2Sha256V1Error
> {
  return value instanceof DeclarativeV2VerifierProgressConfigurationV1Error ||
    value instanceof DeclarativeV2VerifierProgressInputV1Error ||
    value instanceof DeclarativeV2VerifierProgressBusyV1Error ||
    value instanceof DeclarativeV2VerifierProgressStaleV1Error ||
    value instanceof DeclarativeV2VerifierProgressLifecycleV1Error ||
    value instanceof DeclarativeV2VerifierProgressCollisionV1Error ||
    value instanceof DeclarativeV2VerifierProgressCorruptionV1Error ||
    value instanceof DeclarativeV2VerifierProgressExhaustionV1Error ||
    value instanceof DeclarativeV2VerifierProgressConfirmedRollbackV1Error ||
    value instanceof DeclarativeV2VerifierProgressDecisionUncertainV1Error ||
    value instanceof DeclarativeV2VerifierProgressResourceV1Error;
}

function storedFrameFromCaptured(
  captured: CapturedFrameV1<DeclarativeV2PhysicalFrameV1>,
): StoredFrameV1 {
  return Object.freeze({
    codecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
    byteLength: BigInt(captured.bytes.byteLength),
    sha256: new Uint8Array(captured.sha256),
    bytes: new Uint8Array(captured.bytes),
  });
}

function storedFrameEquals(
  stored: StoredFrameV1,
  captured: CapturedFrameV1<DeclarativeV2PhysicalFrameV1>,
): boolean {
  return stored.codecVersion === DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 &&
    stored.byteLength === BigInt(captured.bytes.byteLength) &&
    bytesEqualFullScan(stored.sha256, captured.sha256) &&
    bytesEqualFullScan(stored.bytes, captured.bytes);
}

function zeroBudgetFrame(
  kind: "attempt_usage",
): DeclarativeV2BudgetFrameV1 {
  const values = Object.fromEntries(
    BUDGET_DIMENSIONS.map(dimension => [dimension, 0n]),
  );
  return Object.freeze({
    kind,
    ...values,
  }) as DeclarativeV2BudgetFrameV1;
}

function addSemanticUsage(
  ceilings: DeclarativeV2BudgetFrameV1,
  usage: DeclarativeV2BudgetFrameV1,
  command: DeclarativeV2BudgetFrameV1,
): Result.Result<
  DeclarativeV2BudgetFrameV1,
  DeclarativeV2VerifierProgressInputV1Error
> {
  const next: Record<string, bigint | string> = {
    kind: "attempt_usage",
  };
  for (const dimension of BUDGET_DIMENSIONS) {
    const current = usage[dimension];
    const addition = command[dimension];
    if (
      current > DECLARATIVE_V2_MAX_SIGNED_INT64_V1 - addition ||
      current + addition > ceilings[dimension]
    ) {
      return Result.fail(inputError(
        "reserveCommand",
        "budgetExceeded",
        undefined,
        undefined,
        undefined,
        dimension,
        current > DECLARATIVE_V2_MAX_SIGNED_INT64_V1 - addition
          ? DECLARATIVE_V2_MAX_SIGNED_INT64_V1
          : current + addition,
        ceilings[dimension],
      ));
    }
    next[dimension] = current + addition;
  }
  return Result.succeed(
    Object.freeze(next) as unknown as DeclarativeV2BudgetFrameV1,
  );
}

function isBudgetFrameKind(
  value: unknown,
  kind: DeclarativeV2BudgetFrameV1["kind"],
): value is DeclarativeV2BudgetFrameV1 {
  if (!isNonArrayRecord(value) || ownDataValue(value, "kind") !== kind) {
    return false;
  }
  return BUDGET_DIMENSIONS.every(dimension =>
    isI64(ownDataValue(value, dimension))
  );
}

function captureBudgetFrame(
  frame: DeclarativeV2BudgetFrameV1,
): DeclarativeV2BudgetFrameV1 {
  const captured: Record<string, bigint | string> = { kind: frame.kind };
  for (const dimension of BUDGET_DIMENSIONS) {
    captured[dimension] = frame[dimension];
  }
  return Object.freeze(captured) as unknown as DeclarativeV2BudgetFrameV1;
}

function isI64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1;
}

function isPositiveI64(value: unknown): value is bigint {
  return isI64(value) && value >= 1n;
}

function isNullableDigest(value: unknown): value is Uint8Array | null {
  return value === null ||
    isUint8ArrayWithByteLength(value, DECLARATIVE_V2_SHA256_BYTES_V1);
}

function nullableDigestEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && bytesEqualFullScan(left, right);
}

function isSettlingCommandKind(
  value: unknown,
): value is Exclude<DeclarativeV2CommandKindV1, "finalize"> {
  return value === "source_page" ||
    value === "parse_module" ||
    value === "link_page" ||
    value === "registration_page";
}

function isNullableCommandKind(
  value: unknown,
): value is DeclarativeV2CommandKindV1 | null {
  return value === null || isSettlingCommandKind(value) || value === "finalize";
}

function isLifecycle(
  value: unknown,
): value is DeclarativeV2AttemptLifecycleV1 {
  return value === "open" ||
    value === "parsing" ||
    value === "parse_complete" ||
    value === "linking" ||
    value === "link_complete" ||
    value === "registering" ||
    value === "ready" ||
    value === "rejected" ||
    value === "abandoned";
}

function isTerminal(lifecycle: DeclarativeV2AttemptLifecycleV1): boolean {
  return lifecycle === "ready" ||
    lifecycle === "rejected" ||
    lifecycle === "abandoned";
}

const decodeScopeId = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);

function parseI64Text(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return isI64(parsed) ? parsed : undefined;
}

function parseNullableI64Text(value: unknown): bigint | null | undefined {
  return value === null ? null : parseI64Text(value);
}

function parseDateMilliseconds(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return undefined;
  const date = new Date(numeric);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function parseNullableDateMilliseconds(
  value: unknown,
): Date | null | undefined {
  return value === null ? null : parseDateMilliseconds(value);
}

function dateMilliseconds(value: Date): number | undefined {
  const milliseconds = value.getTime();
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function checkedExpiry(
  databaseNowMilliseconds: number,
  claimDurationMilliseconds: number,
): Date {
  if (
    databaseNowMilliseconds >
      Number.MAX_SAFE_INTEGER - claimDurationMilliseconds
  ) {
    throw new DeclarativeV2VerifierProgressConfigurationV1Error({
      reason: "invalidClaimDuration",
    });
  }
  const date = new Date(databaseNowMilliseconds + claimDurationMilliseconds);
  if (dateMilliseconds(date) === undefined) {
    throw new DeclarativeV2VerifierProgressConfigurationV1Error({
      reason: "invalidClaimDuration",
    });
  }
  return date;
}

function copyDate(value: Date): Date {
  return new Date(value.getTime());
}

function copyNullableBytes(value: Uint8Array | null): Uint8Array | null {
  return value === null ? null : new Uint8Array(value);
}

function projectClaimedAttempt(
  attempt: DeclarativeV2VerifierAttemptObservationV1,
  writerFence: bigint,
  claimExpiresAt: Date,
  pendingReservedByFence: bigint | null,
): DeclarativeV2VerifierAttemptObservationV1 {
  return Object.freeze({
    ...attempt,
    writerFence,
    claimExpiresAt: copyDate(claimExpiresAt),
    pendingReservedByFence,
  });
}

function projectReservedAttempt(
  attempt: DeclarativeV2VerifierAttemptObservationV1,
  input: DeclarativeV2VerifierReserveCommandInputV1,
  reservationSha256: Uint8Array,
  usage: DeclarativeV2BudgetFrameV1,
): DeclarativeV2VerifierAttemptObservationV1 {
  return Object.freeze({
    ...attempt,
    pendingKind: input.commandKind,
    pendingSequence: input.sequence,
    pendingCommandSha256: new Uint8Array(reservationSha256),
    pendingReservedByFence: attempt.writerFence,
    usage,
  });
}

function projectSettledAttempt(
  attempt: DeclarativeV2VerifierAttemptObservationV1,
  work: MutableWorkStateV1,
  batch: CapturedSettlementBatchV1,
): DeclarativeV2VerifierAttemptObservationV1 {
  return Object.freeze({
    ...attempt,
    lifecycle: batch.nextLifecycle,
    settledSequence: work.sequence,
    lastCommandSha256: new Uint8Array(work.reservationSha256),
    lastReceipt: batch.receipt.frame,
    pendingKind: null,
    pendingSequence: null,
    pendingCommandSha256: null,
    pendingReservedByFence: null,
    progress: batch.progress.frame,
  });
}

function copyAttemptObservation(
  value: DeclarativeV2VerifierAttemptObservationV1,
): DeclarativeV2VerifierAttemptObservationV1 {
  return Object.freeze({
    scopeId: value.scopeId,
    attemptSha256: new Uint8Array(value.attemptSha256),
    candidateSha256: new Uint8Array(value.candidateSha256),
    lifecycle: value.lifecycle,
    writerFence: value.writerFence,
    claimExpiresAt: value.claimExpiresAt === null
      ? null
      : copyDate(value.claimExpiresAt),
    settledSequence: value.settledSequence,
    lastCommandSha256: copyNullableBytes(value.lastCommandSha256),
    lastReceipt: value.lastReceipt === null
      ? null
      : copyCommandReceipt(value.lastReceipt),
    pendingKind: value.pendingKind,
    pendingSequence: value.pendingSequence,
    pendingCommandSha256: copyNullableBytes(value.pendingCommandSha256),
    pendingReservedByFence: value.pendingReservedByFence,
    identity: Object.freeze({
      ...value.identity,
      candidateSha256: new Uint8Array(value.identity.candidateSha256),
      ceilingsSha256: new Uint8Array(value.identity.ceilingsSha256),
    }),
    ceilings: copyBudgetFrame(value.ceilings),
    usage: copyBudgetFrame(value.usage),
    progress: Object.freeze({
      ...value.progress,
      previousReceiptSha256: copyNullableBytes(
        value.progress.previousReceiptSha256,
      ),
    }),
  });
}

function copyCommandReceipt(
  value: DeclarativeV2CommandReceiptFrameV1,
): DeclarativeV2CommandReceiptFrameV1 {
  return Object.freeze({
    ...value,
    reservationSha256: new Uint8Array(value.reservationSha256),
    usageSha256: new Uint8Array(value.usageSha256),
    outputSha256: new Uint8Array(value.outputSha256),
    progressCursorSha256: new Uint8Array(value.progressCursorSha256),
  });
}

function copyBudgetFrame(
  value: DeclarativeV2BudgetFrameV1,
): DeclarativeV2BudgetFrameV1 {
  return Object.freeze({
    kind: value.kind,
    ...Object.fromEntries(
      BUDGET_DIMENSIONS.map(dimension => [dimension, value[dimension]]),
    ),
  }) as DeclarativeV2BudgetFrameV1;
}

function lockedAttemptStateEquals(
  left: LockedAttemptV1,
  right: LockedAttemptV1,
): boolean {
  return left.scopeId === right.scopeId &&
    bytesEqualFullScan(left.attemptSha256, right.attemptSha256) &&
    bytesEqualFullScan(left.candidateSha256, right.candidateSha256) &&
    left.lifecycle === right.lifecycle &&
    left.writerOwnerId === right.writerOwnerId &&
    left.writerFence === right.writerFence &&
    nullableDateEqual(left.leaseUpdatedAt, right.leaseUpdatedAt) &&
    nullableDateEqual(left.leaseExpiresAt, right.leaseExpiresAt) &&
    left.settledSequence === right.settledSequence &&
    nullableDigestEqual(left.lastCommandSha256, right.lastCommandSha256) &&
    left.pendingKind === right.pendingKind &&
    left.pendingSequence === right.pendingSequence &&
    nullableDigestEqual(
      left.pendingCommandSha256,
      right.pendingCommandSha256,
    ) &&
    left.pendingReservedByFence === right.pendingReservedByFence &&
    storedFrameEqualsStored(left.frames.identity, right.frames.identity) &&
    storedFrameEqualsStored(left.frames.ceilings, right.frames.ceilings) &&
    storedFrameEqualsStored(left.frames.usage, right.frames.usage) &&
    storedFrameEqualsStored(left.frames.progress, right.frames.progress) &&
    nullableStoredFrameEqual(
      left.frames.lastReceipt,
      right.frames.lastReceipt,
    ) &&
    nullableStoredFrameEqual(
      left.frames.pendingBudget,
      right.frames.pendingBudget,
    );
}

function storedFrameEqualsStored(
  left: StoredFrameV1,
  right: StoredFrameV1,
): boolean {
  return left.codecVersion === right.codecVersion &&
    left.byteLength === right.byteLength &&
    bytesEqualFullScan(left.sha256, right.sha256) &&
    bytesEqualFullScan(left.bytes, right.bytes);
}

function nullableStoredFrameEqual(
  left: StoredFrameV1 | null,
  right: StoredFrameV1 | null,
): boolean {
  return left === null || right === null
    ? left === right
    : storedFrameEqualsStored(left, right);
}

function nullableDateEqual(left: Date | null, right: Date | null): boolean {
  return left === null || right === null
    ? left === right
    : left.getTime() === right.getTime();
}

function phaseFromStoredFrame(
  operation: DeclarativeV2VerifierProgressOperationV1,
  stored: StoredFrameV1,
): Result.Result<
  DeclarativeV2VerifierPhaseV1,
  DeclarativeV2VerifierProgressCorruptionV1Error
> {
  const decoded = decodeDeclarativeV2PhysicalFrameV1(stored.bytes, {
    maximumFrameBytes: stored.bytes.byteLength,
    maximumCanonicalBytes: stored.bytes.byteLength,
  });
  if (
    Result.isFailure(decoded) ||
    decoded.success.frame.kind !== "progress_cursor"
  ) {
    return Result.fail(corruption(operation, "invalidStoredBytes"));
  }
  return Result.succeed(decoded.success.frame.phase);
}

function withRun<Value, Failure, Requirements>(
  runs: WeakMap<object, MutableRunStateV1>,
  run: DeclarativeV2VerifierRunV1,
  operation: Exclude<
    DeclarativeV2VerifierProgressOperationV1,
    "createAttempt" | "observeAttempt" | "acquire" | "settleCommand"
  >,
  use: (
    state: MutableRunStateV1,
  ) => Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<
  Value,
  Failure | DeclarativeV2VerifierProgressInputV1Error,
  Requirements
> {
  return lookupRun(runs, run, operation).pipe(
    Effect.flatMap(state => state.gate.withPermit(
      lookupRun(runs, run, operation).pipe(
        Effect.flatMap(use),
        Effect.onInterrupt(() => Effect.sync(() => closeRun(state))),
      ),
    )),
  );
}

function lookupRun(
  runs: WeakMap<object, MutableRunStateV1>,
  run: DeclarativeV2VerifierRunV1,
  operation: Exclude<
    DeclarativeV2VerifierProgressOperationV1,
    "createAttempt" | "observeAttempt" | "acquire"
  >,
): Effect.Effect<
  MutableRunStateV1,
  DeclarativeV2VerifierProgressInputV1Error
> {
  const state = typeof run === "object" && run !== null
    ? runs.get(run)
    : undefined;
  if (state === undefined) return Effect.fail(inputError(operation, "invalidRun"));
  if (state.closed) return Effect.fail(inputError(operation, "runClosed"));
  return Effect.succeed(state);
}

function lookupWork(
  works: WeakMap<object, MutableWorkStateV1>,
  work: DeclarativeV2VerifierWorkV1,
): Effect.Effect<
  MutableWorkStateV1,
  DeclarativeV2VerifierProgressInputV1Error
> {
  const state = typeof work === "object" && work !== null
    ? works.get(work)
    : undefined;
  if (state === undefined) {
    return Effect.fail(inputError("settleCommand", "invalidWork"));
  }
  if (state.closed) {
    return Effect.fail(inputError("settleCommand", "workClosed"));
  }
  return Effect.succeed(state);
}

function prepareWorkToken(
  run: DeclarativeV2VerifierRunV1,
  commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">,
  sequence: bigint,
  reservationSha256: Uint8Array,
  previousReceiptSha256: Uint8Array | null,
): Readonly<{
  readonly work: DeclarativeV2VerifierWorkV1;
  readonly state: MutableWorkStateV1;
}> {
  const work = Object.freeze({
    _tag: "DeclarativeV2VerifierWorkV1" as const,
  });
  return Object.freeze({
    work,
    state: {
      run,
      commandKind,
      sequence,
      reservationSha256: new Uint8Array(reservationSha256),
      previousReceiptSha256: copyNullableBytes(previousReceiptSha256),
      closed: false,
    },
  });
}

function closeRun(state: MutableRunStateV1): void {
  state.closed = true;
}

function closeRunOnTransactionFailure(
  state: MutableRunStateV1,
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return effect => effect.pipe(
    Effect.onExit(exit =>
      exit._tag === "Failure"
        ? Effect.sync(() => closeRun(state))
        : Effect.void
    ),
  );
}

function closeRunAndWorkOnTransactionFailure(
  run: MutableRunStateV1,
  work: MutableWorkStateV1,
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return effect => effect.pipe(
    Effect.onExit(exit =>
      exit._tag === "Failure"
        ? Effect.sync(() => {
          closeRun(run);
          work.closed = true;
        })
        : Effect.void
    ),
  );
}

function requireLiveOwner(
  locked: LockedAttemptV1 | null,
  state: MutableRunStateV1,
  operation: Exclude<
    DeclarativeV2VerifierProgressOperationV1,
    "createAttempt" | "observeAttempt" | "acquire"
  >,
): asserts locked is LockedAttemptV1 {
  if (locked === null) throw stale(operation, "stateChanged");
  if (
    locked.writerOwnerId !== state.ownerId ||
    locked.writerFence !== state.writerFence
  ) {
    throw stale(operation, "ownerChanged");
  }
  const databaseNow = dateMilliseconds(locked.databaseNow);
  const expiry = locked.leaseExpiresAt === null
    ? undefined
    : dateMilliseconds(locked.leaseExpiresAt);
  if (
    databaseNow === undefined ||
    expiry === undefined ||
    expiry <= databaseNow
  ) {
    throw stale(operation, "leaseExpired");
  }
  if (isTerminal(locked.lifecycle)) {
    throw new DeclarativeV2VerifierProgressLifecycleV1Error({
      operation,
      lifecycle: locked.lifecycle,
      phase: state.attempt.progress.phase,
    });
  }
}

function requirePending(
  locked: LockedAttemptV1,
  commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">,
  sequence: bigint,
  reservationSha256: Uint8Array,
  fence: bigint,
): void {
  if (
    locked.pendingKind !== commandKind ||
    locked.pendingSequence !== sequence ||
    locked.pendingCommandSha256 === null ||
    !bytesEqualFullScan(locked.pendingCommandSha256, reservationSha256) ||
    locked.pendingReservedByFence !== fence
  ) {
    throw stale("settleCommand", "pendingChanged");
  }
}

function requireCommandAllowed(
  operation: "reserveCommand",
  lifecycle: DeclarativeV2AttemptLifecycleV1,
  phase: DeclarativeV2VerifierPhaseV1,
  commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">,
): void {
  const allowed =
    lifecycle === "open" && phase === "source" &&
      commandKind === "source_page" ||
    lifecycle === "parsing" && phase === "parse" &&
      commandKind === "parse_module" ||
    (lifecycle === "parse_complete" || lifecycle === "linking") &&
      phase === "link" && commandKind === "link_page" ||
    (lifecycle === "link_complete" || lifecycle === "registering") &&
      phase === "registration" && commandKind === "registration_page";
  if (!allowed) {
    throw new DeclarativeV2VerifierProgressLifecycleV1Error({
      operation,
      lifecycle,
      phase,
    });
  }
}

function isValidSettlementTransition(
  currentLifecycle: DeclarativeV2AttemptLifecycleV1,
  currentPhase: DeclarativeV2VerifierPhaseV1,
  commandKind: Exclude<DeclarativeV2CommandKindV1, "finalize">,
  nextLifecycle: DeclarativeV2AttemptLifecycleV1,
  nextPhase: DeclarativeV2VerifierPhaseV1,
): boolean {
  if (isTerminal(nextLifecycle)) return false;
  switch (commandKind) {
    case "source_page":
      return currentLifecycle === "open" &&
        currentPhase === "source" &&
        (
          nextLifecycle === "open" && nextPhase === "source" ||
          nextLifecycle === "parsing" && nextPhase === "parse"
        );
    case "parse_module":
      return currentLifecycle === "parsing" &&
        currentPhase === "parse" &&
        (
          nextLifecycle === "parsing" && nextPhase === "parse" ||
          nextLifecycle === "parse_complete" && nextPhase === "link"
        );
    case "link_page":
      return (
        currentLifecycle === "parse_complete" ||
        currentLifecycle === "linking"
      ) &&
        currentPhase === "link" &&
        (
          nextLifecycle === "linking" && nextPhase === "link" ||
          nextLifecycle === "link_complete" &&
            nextPhase === "registration"
        );
    case "registration_page":
      return (
        currentLifecycle === "link_complete" ||
        currentLifecycle === "registering"
      ) &&
        currentPhase === "registration" &&
        nextLifecycle === "registering" &&
        (
          nextPhase === "registration" ||
          nextPhase === "verdict"
        );
  }
}

const SETTLED_TAIL_PHASES = [
  "source",
  "parse",
  "link",
  "registration",
] as const satisfies readonly DeclarativeV2VerifierPhaseV1[];

interface StoredPhaseTailV1 {
  readonly phase: DeclarativeV2VerifierPhaseV1;
  readonly pageOrdinal: bigint;
  readonly firstItemOrdinal: bigint;
  readonly itemCount: bigint;
  readonly previousPageSha256: Uint8Array | null;
  readonly stored: StoredFrameV1;
}

interface StoredOrdinalTailV1 {
  readonly ordinal: bigint;
  readonly stored: StoredFrameV1;
}

interface SettledTailsInternalV1 {
  readonly attempt: DeclarativeV2VerifierAttemptObservationV1;
  readonly phases: readonly Readonly<{
    readonly phase: DeclarativeV2VerifierPhaseV1;
    readonly captured:
      | CapturedFrameV1<DeclarativeV2PageManifestFrameV1>
      | null;
  }>[];
  readonly lastRegistration:
    | CapturedFrameV1<DeclarativeV2RegistrationFrameV1>
    | null;
  readonly lastDiagnostic:
    | CapturedFrameV1<DeclarativeV2DiagnosticFrameV1>
    | null;
}

const readSettledTailsForRun = Effect.fn(
  "DeclarativeV2.verifier.readSettledTailsForRun",
)(function* (
  target: LocatedReadCommittedAttemptTargetV1,
  run: MutableRunStateV1,
  operation: "settleCommand" | "observeSettledPhaseTails",
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  tracker: MutableOperationUsageV1,
  monotonicMilliseconds: () => number,
  start: number,
  sha256: DeclarativeV2Sha256V1,
): Generator<
  Effect.Effect<unknown, DeclarativeV2VerifierProgressV1Error>,
  SettledTailsInternalV1,
  never
> {
    const stored = yield* runTransactionWithConfirmedRollbackRetry(
      target,
      operation,
      run.scopeId,
      run.attemptSha256,
      budget,
      tracker,
      monotonicMilliseconds,
      start,
      async tx => {
        const locked = await lockAttempt(
          tx,
          operation,
          run.scopeId,
          run.attemptSha256,
          budget,
          tracker,
          true,
        );
        requireLiveOwner(locked, run, operation);
        const phases: StoredPhaseTailV1[] = [];
        for (const phase of SETTLED_TAIL_PHASES) {
          const tail = await readStoredPhaseTail(
            tx,
            operation,
            run.scopeId,
            run.attemptSha256,
            phase,
            budget,
            tracker,
          );
          if (tail !== null) phases.push(tail);
        }
        const lastRegistration = await readStoredOrdinalTail(
          tx,
          operation,
          "registration",
          run.scopeId,
          run.attemptSha256,
          budget,
          tracker,
        );
        const lastDiagnostic = await readStoredOrdinalTail(
          tx,
          operation,
          "diagnostic",
          run.scopeId,
          run.attemptSha256,
          budget,
          tracker,
        );
        return Object.freeze({
          locked,
          phases: Object.freeze(phases),
          lastRegistration,
          lastDiagnostic,
        });
      },
    ).pipe(closeRunOnTransactionFailure(run));

    const attempt = yield* decodeAttemptObservation(
      operation,
      stored.locked,
      budget,
      tracker,
      sha256,
    );
    const phaseMap = new Map<
      DeclarativeV2VerifierPhaseV1,
      CapturedFrameV1<DeclarativeV2PageManifestFrameV1>
    >();
    for (const tail of stored.phases) {
      const captured = yield* decodeStoredFrame<DeclarativeV2PageManifestFrameV1>(
        operation,
        tail.stored,
        "phase_page_manifest",
        budget,
        tracker,
        sha256,
      );
      if (
        !bytesEqualFullScan(
          captured.frame.attemptSha256,
          run.attemptSha256,
        ) ||
        captured.frame.phase !== tail.phase ||
        captured.frame.pageOrdinal !== tail.pageOrdinal ||
        captured.frame.firstItemOrdinal !== tail.firstItemOrdinal ||
        captured.frame.itemCount !== tail.itemCount ||
        !nullableDigestEqual(
          captured.frame.previousPageSha256,
          tail.previousPageSha256,
        )
      ) {
        return yield* corruption(operation, "normalizedMismatch");
      }
      phaseMap.set(tail.phase, captured);
    }
    const lastRegistration = stored.lastRegistration === null
      ? null
      : yield* decodeStoredOrdinalTail<
        DeclarativeV2RegistrationFrameV1
      >(
        operation,
        stored.lastRegistration,
        "registration",
        run.attemptSha256,
        budget,
        tracker,
        sha256,
      );
    const lastDiagnostic = stored.lastDiagnostic === null
      ? null
      : yield* decodeStoredOrdinalTail<
        DeclarativeV2DiagnosticFrameV1
      >(
        operation,
        stored.lastDiagnostic,
        "diagnostic",
        run.attemptSha256,
        budget,
        tracker,
        sha256,
      );
    let settledPageCount = 0n;
    const phases = SETTLED_TAIL_PHASES.map(phase => {
      const captured = phaseMap.get(phase) ?? null;
      if (captured !== null) {
        const count = captured.frame.pageOrdinal + 1n;
        if (settledPageCount > MAX_FENCE - count) {
          throw corruption(operation, "invalidMetadata");
        }
        settledPageCount += count;
      }
      return Object.freeze({ phase, captured });
    });
    if (
      settledPageCount !== attempt.settledSequence ||
      attempt.progress.pageOrdinal !== attempt.settledSequence
    ) {
      return yield* corruption(operation, "normalizedMismatch");
    }
    return Object.freeze({
      attempt,
      phases: Object.freeze(phases),
      lastRegistration,
      lastDiagnostic,
    });
});

async function readStoredPhaseTail(
  tx: AppRowTransaction,
  operation: "settleCommand" | "observeSettledPhaseTails",
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  phase: DeclarativeV2VerifierPhaseV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<StoredPhaseTailV1 | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const metadataRows = await runVerifierStatement(operation, () => tx
    .select({
      pageOrdinal: fxSystemDeclarativeV2PageManifests.pageOrdinal,
      firstItemOrdinal: fxSystemDeclarativeV2PageManifests.firstItemOrdinal,
      itemCount: fxSystemDeclarativeV2PageManifests.itemCount,
      previousPageSha256:
        fxSystemDeclarativeV2PageManifests.previousPageSha256,
      codecVersion: fxSystemDeclarativeV2PageManifests.frameCodecVersion,
      byteLength: fxSystemDeclarativeV2PageManifests.frameByteLength,
      sha256: fxSystemDeclarativeV2PageManifests.frameSha256,
    })
    .from(fxSystemDeclarativeV2PageManifests)
    .where(and(
      eq(fxSystemDeclarativeV2PageManifests.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2PageManifests.attemptSha256,
        attemptSha256,
      ),
      eq(fxSystemDeclarativeV2PageManifests.phase, phase),
    ))
    .orderBy(desc(fxSystemDeclarativeV2PageManifests.pageOrdinal))
    .limit(1));
  if (metadataRows.length === 0) return null;
  if (metadataRows.length !== 1) {
    throw corruption(operation, "driverResultInvalid");
  }
  const row = metadataRows[0]!;
  const metadata = captureStoredTailMetadata(
    operation,
    row.codecVersion,
    row.byteLength,
    row.sha256,
  );
  chargeOrThrow(
    operation,
    budget,
    usage,
    "frameBytes",
    storedByteLengthNumber(operation, metadata.byteLength),
  );
  chargeSqlOrThrow(operation, budget, usage, 1);
  const byteRows = await runVerifierStatement(operation, () => tx
    .select({ bytes: fxSystemDeclarativeV2PageManifests.frameBytes })
    .from(fxSystemDeclarativeV2PageManifests)
    .where(and(
      eq(fxSystemDeclarativeV2PageManifests.scopeId, scopeId),
      eq(
        fxSystemDeclarativeV2PageManifests.attemptSha256,
        attemptSha256,
      ),
      eq(fxSystemDeclarativeV2PageManifests.phase, phase),
      eq(
        fxSystemDeclarativeV2PageManifests.pageOrdinal,
        row.pageOrdinal,
      ),
    )));
  if (byteRows.length !== 1) {
    throw corruption(operation, "driverResultInvalid");
  }
  return Object.freeze({
    phase,
    pageOrdinal: row.pageOrdinal,
    firstItemOrdinal: row.firstItemOrdinal,
    itemCount: row.itemCount,
    previousPageSha256: copyNullableBytes(row.previousPageSha256),
    stored: attachStoredBytes(
      operation,
      metadata,
      byteRows[0]!.bytes,
    ),
  });
}

async function readStoredOrdinalTail(
  tx: AppRowTransaction,
  operation: "settleCommand" | "observeSettledPhaseTails",
  kind: "registration" | "diagnostic",
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<StoredOrdinalTailV1 | null> {
  chargeSqlOrThrow(operation, budget, usage, 1);
  const metadataRows = await runVerifierStatement(operation, () =>
    kind === "registration"
      ? tx.select({
        ordinal: fxSystemDeclarativeV2Registrations.registrationOrdinal,
        codecVersion: fxSystemDeclarativeV2Registrations.frameCodecVersion,
        byteLength: fxSystemDeclarativeV2Registrations.frameByteLength,
        sha256: fxSystemDeclarativeV2Registrations.frameSha256,
      }).from(fxSystemDeclarativeV2Registrations).where(and(
        eq(fxSystemDeclarativeV2Registrations.scopeId, scopeId),
        eq(
          fxSystemDeclarativeV2Registrations.attemptSha256,
          attemptSha256,
        ),
      )).orderBy(
        desc(fxSystemDeclarativeV2Registrations.registrationOrdinal),
      ).limit(1)
      : tx.select({
        ordinal: fxSystemDeclarativeV2Diagnostics.diagnosticOrdinal,
        codecVersion: fxSystemDeclarativeV2Diagnostics.frameCodecVersion,
        byteLength: fxSystemDeclarativeV2Diagnostics.frameByteLength,
        sha256: fxSystemDeclarativeV2Diagnostics.frameSha256,
      }).from(fxSystemDeclarativeV2Diagnostics).where(and(
        eq(fxSystemDeclarativeV2Diagnostics.scopeId, scopeId),
        eq(fxSystemDeclarativeV2Diagnostics.attemptSha256, attemptSha256),
      )).orderBy(
        desc(fxSystemDeclarativeV2Diagnostics.diagnosticOrdinal),
      ).limit(1)
  );
  if (metadataRows.length === 0) return null;
  if (metadataRows.length !== 1) {
    throw corruption(operation, "driverResultInvalid");
  }
  const row = metadataRows[0]!;
  const metadata = captureStoredTailMetadata(
    operation,
    row.codecVersion,
    row.byteLength,
    row.sha256,
  );
  chargeOrThrow(
    operation,
    budget,
    usage,
    "frameBytes",
    storedByteLengthNumber(operation, metadata.byteLength),
  );
  chargeSqlOrThrow(operation, budget, usage, 1);
  const byteRows = await runVerifierStatement(operation, () =>
    kind === "registration"
      ? tx.select({ bytes: fxSystemDeclarativeV2Registrations.frameBytes })
        .from(fxSystemDeclarativeV2Registrations)
        .where(and(
          eq(fxSystemDeclarativeV2Registrations.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2Registrations.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2Registrations.registrationOrdinal,
            row.ordinal,
          ),
        ))
      : tx.select({ bytes: fxSystemDeclarativeV2Diagnostics.frameBytes })
        .from(fxSystemDeclarativeV2Diagnostics)
        .where(and(
          eq(fxSystemDeclarativeV2Diagnostics.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2Diagnostics.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2Diagnostics.diagnosticOrdinal,
            row.ordinal,
          ),
        ))
  );
  if (byteRows.length !== 1) {
    throw corruption(operation, "driverResultInvalid");
  }
  return Object.freeze({
    ordinal: row.ordinal,
    stored: attachStoredBytes(operation, metadata, byteRows[0]!.bytes),
  });
}

function captureStoredTailMetadata(
  operation: "settleCommand" | "observeSettledPhaseTails",
  codecVersion: unknown,
  byteLength: unknown,
  sha256: unknown,
): Omit<StoredFrameV1, "bytes"> {
  if (
    codecVersion !== DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 ||
    typeof byteLength !== "bigint" ||
    byteLength < 1n ||
    !isUint8ArrayWithByteLength(sha256, DECLARATIVE_V2_SHA256_BYTES_V1)
  ) {
    throw corruption(operation, "invalidMetadata");
  }
  return Object.freeze({
    codecVersion,
    byteLength,
    sha256: new Uint8Array(sha256),
  });
}

function storedByteLengthNumber(
  operation: "settleCommand" | "observeSettledPhaseTails",
  byteLength: bigint,
): number {
  if (byteLength > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw corruption(operation, "invalidMetadata");
  }
  return Number(byteLength);
}

const decodeStoredOrdinalTail = Effect.fn(
  "DeclarativeV2.verifier.decodeStoredOrdinalTail",
)(function* <Frame extends
  DeclarativeV2RegistrationFrameV1 | DeclarativeV2DiagnosticFrameV1>(
  operation: "settleCommand" | "observeSettledPhaseTails",
  tail: StoredOrdinalTailV1,
  kind: Frame["kind"],
  expectedAttemptSha256: Uint8Array,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  tracker: MutableOperationUsageV1,
  sha256: DeclarativeV2Sha256V1,
) {
    const captured = yield* decodeStoredFrame<Frame>(
      operation,
      tail.stored,
      kind,
      budget,
      tracker,
      sha256,
    );
    const ordinal = captured.frame.kind === "registration"
      ? captured.frame.registrationOrdinal
      : captured.frame.diagnosticOrdinal;
    if (
      !bytesEqualFullScan(
        captured.frame.attemptSha256,
        expectedAttemptSha256,
      ) ||
      ordinal !== tail.ordinal
    ) {
      return yield* corruption(operation, "normalizedMismatch");
    }
    return captured;
});

function copySettledPhaseTails(
  value: SettledTailsInternalV1,
): DeclarativeV2SettledPhaseTailsV1 {
  return Object.freeze({
    attempt: copyAttemptObservation(value.attempt),
    phases: Object.freeze(value.phases.map(({ phase, captured }) =>
      Object.freeze({
        phase,
        page: captured === null
          ? null
          : copyPageManifest(captured.frame),
        pageSha256: captured === null
          ? null
          : new Uint8Array(captured.sha256),
      })
    )),
    lastRegistrationOrdinal:
      value.lastRegistration?.frame.registrationOrdinal ?? null,
    lastDiagnosticOrdinal:
      value.lastDiagnostic?.frame.diagnosticOrdinal ?? null,
  });
}

function copyPageManifest(
  value: DeclarativeV2PageManifestFrameV1,
): DeclarativeV2PageManifestFrameV1 {
  return Object.freeze({
    ...value,
    attemptSha256: new Uint8Array(value.attemptSha256),
    previousPageSha256: copyNullableBytes(value.previousPageSha256),
    pageRootSha256: new Uint8Array(value.pageRootSha256),
  });
}

interface DerivedSettlementV1 {
  readonly nextLifecycle: DeclarativeV2AttemptLifecycleV1;
  readonly nextProgress: DeclarativeV2ProgressCursorFrameV1;
  readonly page: Readonly<{
    readonly phase: DeclarativeV2VerifierPhaseV1;
    readonly pageOrdinal: bigint;
    readonly firstItemOrdinal: bigint;
    readonly itemCount: bigint;
    readonly previousPageSha256: Uint8Array | null;
  }>;
}

function deriveSettlement(
  run: MutableRunStateV1,
  work: MutableWorkStateV1,
  disposition: DeclarativeV2PageDispositionV1,
  tails: SettledTailsInternalV1,
  evidence: readonly DeclarativeV2PageEvidenceKeyV1[],
  modules: readonly Readonly<{
    readonly captured: CapturedFrameV1<DeclarativeV2ModuleSummaryFrameV1>;
    readonly modulePathSha256: Uint8Array;
  }>[],
  edges: readonly CapturedFrameV1<DeclarativeV2ImportEdgeFrameV1>[],
  links: readonly CapturedFrameV1<DeclarativeV2LinkNodeFrameV1>[],
  frontier: readonly CapturedFrameV1<DeclarativeV2FrontierEntryFrameV1>[],
  registrations: readonly CapturedFrameV1<DeclarativeV2RegistrationFrameV1>[],
  diagnostics: readonly CapturedFrameV1<DeclarativeV2DiagnosticFrameV1>[],
): Result.Result<
  DerivedSettlementV1,
  | DeclarativeV2VerifierProgressInputV1Error
  | DeclarativeV2VerifierProgressCollisionV1Error
  | DeclarativeV2VerifierProgressExhaustionV1Error
> {
  const current = tails.attempt;
  if (
    current.settledSequence + 1n !== work.sequence ||
    current.lifecycle !== run.attempt.lifecycle ||
    current.progress.phase !== run.attempt.progress.phase
  ) {
    return Result.fail(inputError("settleCommand", "invalidInput"));
  }
  const objectReferences = evidence.filter(
    (item): item is DeclarativeV2InertObjectReferenceEvidenceV1 =>
      item.kind === "inert_object_reference",
  );
  const hasErrorDiagnostic = diagnostics.some(
    item => item.frame.severity === "error",
  );
  const hasOnlyWarningDiagnostics = diagnostics.every(
    item => item.frame.severity === "warning",
  );
  let nextLifecycle: DeclarativeV2AttemptLifecycleV1;
  let nextPhase: DeclarativeV2VerifierPhaseV1;
  let itemCount: bigint;
  switch (work.commandKind) {
    case "source_page": {
      if (
        current.lifecycle !== "open" ||
        current.progress.phase !== "source" ||
        objectReferences.length === 0 ||
        modules.length !== 0 ||
        edges.length !== 0 ||
        links.length !== 0 ||
        frontier.length !== 0 ||
        registrations.length !== 0 ||
        diagnostics.length !== 0
      ) {
        return Result.fail(inputError("settleCommand", "invalidInput"));
      }
      let nextReferenceOrdinal = pageTailStart(tails, "source");
      itemCount = 0n;
      for (const reference of objectReferences) {
        if (reference.firstItemOrdinal !== nextReferenceOrdinal) {
          return Result.fail(new DeclarativeV2VerifierProgressCollisionV1Error({
            operation: "settleCommand",
            reason: "pageRangeConflict",
          }));
        }
        const next = checkedAddU64(
          nextReferenceOrdinal,
          reference.itemCount,
        );
        const total = checkedAddU64(itemCount, reference.itemCount);
        if (next === undefined || total === undefined) {
          return Result.fail(new DeclarativeV2VerifierProgressExhaustionV1Error({
            operation: "settleCommand",
            dimension: "pageOrdinal",
            observed: MAX_FENCE,
            maximum: MAX_FENCE,
          }));
        }
        nextReferenceOrdinal = next;
        itemCount = total;
      }
      nextLifecycle = disposition === "continuation" ? "open" : "parsing";
      nextPhase = disposition === "continuation" ? "source" : "parse";
      break;
    }
    case "parse_module": {
      if (
        current.lifecycle !== "parsing" ||
        current.progress.phase !== "parse" ||
        objectReferences.length !== 0 ||
        links.length !== 0 ||
        frontier.length !== 0 ||
        registrations.length !== 0
      ) {
        return Result.fail(inputError("settleCommand", "invalidInput"));
      }
      if (modules.length === 1) {
        const module = modules[0]!.captured.frame;
        if (
          module.moduleOrdinal !== current.progress.moduleOrdinal ||
          BigInt(edges.length) !== module.importCount ||
          !hasOnlyWarningDiagnostics
        ) {
          return Result.fail(inputError("settleCommand", "invalidInput"));
        }
        for (let index = 0; index < edges.length; index += 1) {
          if (
            edges[index]!.frame.moduleOrdinal !== module.moduleOrdinal ||
            edges[index]!.frame.edgeOrdinal !== BigInt(index)
          ) {
            return Result.fail(inputError("settleCommand", "invalidInput"));
          }
        }
        itemCount = 1n;
      } else {
        if (
          modules.length !== 0 ||
          edges.length !== 0 ||
          diagnostics.length === 0 ||
          !hasErrorDiagnostic
        ) {
          return Result.fail(inputError("settleCommand", "invalidInput"));
        }
        itemCount = BigInt(diagnostics.length);
      }
      nextLifecycle = disposition === "continuation"
        ? "parsing"
        : "parse_complete";
      nextPhase = disposition === "continuation" ? "parse" : "link";
      break;
    }
    case "link_page": {
      if (
        (current.lifecycle !== "parse_complete" &&
          current.lifecycle !== "linking") ||
        current.progress.phase !== "link" ||
        objectReferences.length !== 0 ||
        modules.length !== 0 ||
        edges.length !== 0 ||
        registrations.length !== 0 ||
        (links.length === 0 && frontier.length === 0 &&
          !hasErrorDiagnostic)
      ) {
        return Result.fail(inputError("settleCommand", "invalidInput"));
      }
      itemCount = BigInt(
        links.length + frontier.length +
          (links.length + frontier.length === 0 ? diagnostics.length : 0),
      );
      nextLifecycle = disposition === "continuation"
        ? "linking"
        : "link_complete";
      nextPhase = disposition === "continuation" ? "link" : "registration";
      break;
    }
    case "registration_page": {
      if (
        (current.lifecycle !== "link_complete" &&
          current.lifecycle !== "registering") ||
        current.progress.phase !== "registration" ||
        objectReferences.length !== 0 ||
        modules.length !== 0 ||
        edges.length !== 0 ||
        links.length !== 0 ||
        frontier.length !== 0 ||
        (registrations.length === 0 &&
          diagnostics.length === 0 &&
          disposition !== "completion")
      ) {
        return Result.fail(inputError("settleCommand", "invalidInput"));
      }
      const expectedRegistration =
        (tails.lastRegistration?.frame.registrationOrdinal ?? -1n) + 1n;
      for (let index = 0; index < registrations.length; index += 1) {
        if (
          registrations[index]!.frame.registrationOrdinal !==
            expectedRegistration + BigInt(index)
        ) {
          return Result.fail(inputError("settleCommand", "invalidInput"));
        }
      }
      itemCount = BigInt(
        registrations.length > 0
          ? registrations.length
          : diagnostics.length > 0
          ? diagnostics.length
          : 1,
      );
      nextLifecycle = "registering";
      nextPhase = disposition === "continuation"
        ? "registration"
        : "verdict";
      break;
    }
  }
  const expectedDiagnostic =
    (tails.lastDiagnostic?.frame.diagnosticOrdinal ?? -1n) + 1n;
  for (let index = 0; index < diagnostics.length; index += 1) {
    if (
      diagnostics[index]!.frame.diagnosticOrdinal !==
        expectedDiagnostic + BigInt(index)
    ) {
      return Result.fail(inputError("settleCommand", "invalidInput"));
    }
  }
  if (
    !isValidSettlementTransition(
      current.lifecycle,
      current.progress.phase,
      work.commandKind,
      nextLifecycle,
      nextPhase,
    )
  ) {
    return Result.fail(inputError("settleCommand", "invalidInput"));
  }
  const nextModuleOrdinal = checkedAddU64(
    current.progress.moduleOrdinal,
    BigInt(modules.length),
  );
  const nextEdgeOrdinal = checkedAddU64(
    current.progress.edgeOrdinal,
    BigInt(edges.length),
  );
  if (nextModuleOrdinal === undefined || nextEdgeOrdinal === undefined) {
    return Result.fail(new DeclarativeV2VerifierProgressExhaustionV1Error({
      operation: "settleCommand",
      dimension: nextModuleOrdinal === undefined
        ? "moduleOrdinal"
        : "edgeOrdinal",
      observed: MAX_FENCE,
      maximum: MAX_FENCE,
    }));
  }
  const tail = tails.phases.find(item =>
    item.phase === current.progress.phase
  )?.captured ?? null;
  const pageOrdinal = tail === null ? 0n : tail.frame.pageOrdinal + 1n;
  const firstItemOrdinal = tail === null
    ? 0n
    : tail.frame.firstItemOrdinal + tail.frame.itemCount;
  if (
    pageOrdinal > MAX_FENCE ||
    firstItemOrdinal > MAX_FENCE ||
    itemCount < 1n ||
    itemCount > MAX_FENCE
  ) {
    return Result.fail(inputError("settleCommand", "invalidInput"));
  }
  return Result.succeed(Object.freeze({
    nextLifecycle,
    nextProgress: Object.freeze({
      kind: "progress_cursor" as const,
      phase: nextPhase,
      settledSequence: work.sequence,
      moduleOrdinal: nextModuleOrdinal,
      edgeOrdinal: nextEdgeOrdinal,
      pageOrdinal: work.sequence,
      previousReceiptSha256: copyNullableBytes(work.previousReceiptSha256),
    }),
    page: Object.freeze({
      phase: current.progress.phase,
      pageOrdinal,
      firstItemOrdinal,
      itemCount,
      previousPageSha256: tail === null
        ? null
        : new Uint8Array(tail.sha256),
    }),
  }));
}

function pageTailStart(
  tails: SettledTailsInternalV1,
  phase: DeclarativeV2VerifierPhaseV1,
): bigint {
  const tail = tails.phases.find(item => item.phase === phase)?.captured;
  return tail === undefined || tail === null
    ? 0n
    : tail.frame.firstItemOrdinal + tail.frame.itemCount;
}

function progressCursorEquals(
  left: DeclarativeV2ProgressCursorFrameV1,
  right: DeclarativeV2ProgressCursorFrameV1,
): boolean {
  return left.phase === right.phase &&
    left.settledSequence === right.settledSequence &&
    left.moduleOrdinal === right.moduleOrdinal &&
    left.edgeOrdinal === right.edgeOrdinal &&
    left.pageOrdinal === right.pageOrdinal &&
    nullableDigestEqual(
      left.previousReceiptSha256,
      right.previousReceiptSha256,
    );
}

function isPageDisposition(
  value: unknown,
): value is DeclarativeV2PageDispositionV1 {
  return value === "continuation" || value === "completion";
}

function checkedAddU64(left: bigint, right: bigint): bigint | undefined {
  return left < 0n || right < 0n || left > MAX_FENCE - right
    ? undefined
    : left + right;
}

function checkedAddNumber(
  ...values: readonly number[]
): number | undefined {
  let total = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      total > Number.MAX_SAFE_INTEGER - value
    ) {
      return undefined;
    }
    total += value;
  }
  return total;
}

interface CapturedSettlementEvidenceV1 {
  readonly modules: readonly Readonly<{
    readonly captured: CapturedFrameV1<DeclarativeV2ModuleSummaryFrameV1>;
    readonly modulePathSha256: Uint8Array;
  }>[];
  readonly edges: readonly CapturedFrameV1<DeclarativeV2ImportEdgeFrameV1>[];
  readonly pages: readonly CapturedFrameV1<DeclarativeV2PageManifestFrameV1>[];
  readonly links: readonly CapturedFrameV1<DeclarativeV2LinkNodeFrameV1>[];
  readonly frontier: readonly CapturedFrameV1<DeclarativeV2FrontierEntryFrameV1>[];
  readonly registrations:
    readonly CapturedFrameV1<DeclarativeV2RegistrationFrameV1>[];
  readonly diagnostics:
    readonly CapturedFrameV1<DeclarativeV2DiagnosticFrameV1>[];
}

interface CapturedSettlementBatchV1 {
  readonly frames: CapturedSettlementEvidenceV1;
  readonly nextLifecycle: DeclarativeV2AttemptLifecycleV1;
  readonly progress: CapturedFrameV1<DeclarativeV2ProgressCursorFrameV1>;
  readonly receipt: CapturedFrameV1<DeclarativeV2CommandReceiptFrameV1>;
  readonly outputSha256: Uint8Array;
}

type CapturedSettlementFramePreimageV1 =
  | Readonly<{
    readonly kind: "module_summary";
    readonly frame:
      CapturedFramePreimageV1<DeclarativeV2ModuleSummaryFrameV1>;
    readonly path: DeclarativeV2ModulePathProjectionPreimageV1;
  }>
  | Readonly<{
    readonly kind: "import_edge";
    readonly frame:
      CapturedFramePreimageV1<DeclarativeV2ImportEdgeFrameV1>;
  }>
  | Readonly<{
    readonly kind: "link_node";
    readonly frame:
      CapturedFramePreimageV1<DeclarativeV2LinkNodeFrameV1>;
  }>
  | Readonly<{
    readonly kind: "frontier_entry";
    readonly frame:
      CapturedFramePreimageV1<DeclarativeV2FrontierEntryFrameV1>;
  }>
  | Readonly<{
    readonly kind: "registration";
    readonly frame:
      CapturedFramePreimageV1<DeclarativeV2RegistrationFrameV1>;
  }>
  | Readonly<{
    readonly kind: "diagnostic";
    readonly frame:
      CapturedFramePreimageV1<DeclarativeV2DiagnosticFrameV1>;
  }>;

interface CapturedSettlementInputV1 {
  readonly frames: Omit<CapturedSettlementEvidenceV1, "pages">;
  readonly pageEvidenceKeys: readonly DeclarativeV2PageEvidenceKeyV1[];
  readonly outputEvidenceKeys: readonly DeclarativeV2SettledEvidenceKeyV1[];
  readonly disposition: DeclarativeV2PageDispositionV1;
  readonly requestedNextLifecycle: DeclarativeV2AttemptLifecycleV1;
  readonly requestedProgress:
    CapturedFrameV1<DeclarativeV2ProgressCursorFrameV1>;
}

const captureSettlementInput = Effect.fn(
  "DeclarativeV2.verifier.captureSettlementInput",
)(function* (
  run: MutableRunStateV1,
  work: MutableWorkStateV1,
  rawBatch: unknown,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  tracker: MutableOperationUsageV1,
  sha256: DeclarativeV2Sha256V1,
): Generator<
  Effect.Effect<unknown, DeclarativeV2VerifierProgressV1Error>,
  CapturedSettlementInputV1,
  never
> {
    if (
      !isNonArrayRecord(rawBatch) ||
      Object.keys(rawBatch).length !== 5 ||
      Object.getOwnPropertySymbols(rawBatch).length !== 0
    ) {
      return yield* inputError("settleCommand", "invalidInput");
    }
    const rawFrames = ownDataValue(rawBatch, "frames");
    const rawObjectReferences = ownDataValue(rawBatch, "objectReferences");
    const disposition = ownDataValue(rawBatch, "disposition");
    const nextLifecycle = ownDataValue(rawBatch, "nextLifecycle");
    const rawNextProgress = ownDataValue(rawBatch, "nextProgress");
    if (
      !Array.isArray(rawFrames) ||
      !Array.isArray(rawObjectReferences) ||
      !isPageDisposition(disposition) ||
      !isLifecycle(nextLifecycle)
    ) {
      return yield* inputError("settleCommand", "invalidInput");
    }
    const frameCount = rawFrames.length;
    const objectReferenceCount = rawObjectReferences.length;
    const capturedRowCount = checkedAddNumber(
      frameCount,
      objectReferenceCount,
      1,
    );
    if (
      capturedRowCount === undefined ||
      capturedRowCount > remaining(budget.maximumRows, tracker.rows)
    ) {
      return yield* inputError(
        "settleCommand",
        "budgetExceeded",
        "rows",
        capturedRowCount ?? Number.MAX_SAFE_INTEGER,
        budget.maximumRows,
      );
    }

    const framePreimages: CapturedSettlementFramePreimageV1[] = [];
    const pageEvidenceKeys: DeclarativeV2PageEvidenceKeyV1[] = [];
    const outputEvidenceKeys: DeclarativeV2SettledEvidenceKeyV1[] = [];

    for (let index = 0; index < objectReferenceCount; index += 1) {
      const rawReference = rawObjectReferences[index];
      const captured = yield* Effect.fromResult(
        captureDeclarativeV2PageEvidenceKeyV1(rawReference).pipe(
          Result.mapError(evidenceCause =>
            new DeclarativeV2VerifierProgressInputV1Error({
              operation: "settleCommand",
              reason: "invalidInput",
              evidenceCause,
            })
          ),
        ),
      );
      if (captured.kind !== "inert_object_reference") {
        return yield* inputError("settleCommand", "invalidInput");
      }
      pageEvidenceKeys.push(captured);
      outputEvidenceKeys.push(captured);
    }

    for (let index = 0; index < frameCount; index += 1) {
      const rawFrame = rawFrames[index];
      const kind = isNonArrayRecord(rawFrame)
        ? ownDataValue(rawFrame, "kind")
        : undefined;
      if (!isSettlementFrameKind(kind)) {
        return yield* inputError("settleCommand", "invalidInput");
      }
      switch (kind) {
        case "module_summary": {
          const frame = yield* Effect.fromResult(
            captureFramePreimage<DeclarativeV2ModuleSummaryFrameV1>(
              "settleCommand",
              rawFrame,
              kind,
              budget,
              tracker,
            ),
          );
          yield* Effect.fromResult(
            requireFrameAttempt(run, frame.frame.attemptSha256),
          );
          const pathPreimage = yield* Effect.fromResult(
            buildDeclarativeV2ModulePathProjectionPreimageV1(
              frame.frame.modulePath,
              {
                maximumFrameBytes: remaining(
                  budget.maximumFrameBytes,
                  tracker.frameBytes,
                ),
              },
            ).pipe(
              Result.mapError(derivationCause =>
                new DeclarativeV2VerifierProgressInputV1Error({
                  operation: "settleCommand",
                  reason: derivationCause.reason === "frameBytesExceeded"
                    ? "budgetExceeded"
                    : "invalidInput",
                  ...(derivationCause.reason === "frameBytesExceeded"
                    ? {
                      dimension: "frameBytes" as const,
                      observed: checkedAddNumber(
                        tracker.frameBytes,
                        derivationCause.observed ?? Number.MAX_SAFE_INTEGER,
                      ) ?? Number.MAX_SAFE_INTEGER,
                      maximum: budget.maximumFrameBytes,
                    }
                    : {}),
                  derivationCause,
                })
              ),
            ),
          );
          yield* Effect.fromResult(chargeResult(
            "settleCommand",
            budget,
            tracker,
            "frameBytes",
            pathPreimage.usage.frameBytes,
          ));
          yield* Effect.fromResult(chargeResult(
            "settleCommand",
            budget,
            tracker,
            "hashBytes",
            pathPreimage.bytes.byteLength,
          ));
          framePreimages.push(Object.freeze({
            kind,
            frame,
            path: pathPreimage,
          }));
          break;
        }
        case "import_edge": {
          const captured = yield* Effect.fromResult(
            captureFramePreimage<DeclarativeV2ImportEdgeFrameV1>(
              "settleCommand",
              rawFrame,
              kind,
              budget,
              tracker,
            ),
          );
          yield* Effect.fromResult(
            requireFrameAttempt(run, captured.frame.attemptSha256),
          );
          framePreimages.push(Object.freeze({ kind, frame: captured }));
          break;
        }
        case "link_node": {
          const captured = yield* Effect.fromResult(
            captureFramePreimage<DeclarativeV2LinkNodeFrameV1>(
              "settleCommand",
              rawFrame,
              kind,
              budget,
              tracker,
            ),
          );
          yield* Effect.fromResult(
            requireFrameAttempt(run, captured.frame.attemptSha256),
          );
          framePreimages.push(Object.freeze({ kind, frame: captured }));
          break;
        }
        case "frontier_entry": {
          const captured = yield* Effect.fromResult(
            captureFramePreimage<DeclarativeV2FrontierEntryFrameV1>(
              "settleCommand",
              rawFrame,
              kind,
              budget,
              tracker,
            ),
          );
          yield* Effect.fromResult(
            requireFrameAttempt(run, captured.frame.attemptSha256),
          );
          framePreimages.push(Object.freeze({ kind, frame: captured }));
          break;
        }
        case "registration": {
          const captured = yield* Effect.fromResult(
            captureFramePreimage<DeclarativeV2RegistrationFrameV1>(
              "settleCommand",
              rawFrame,
              kind,
              budget,
              tracker,
            ),
          );
          yield* Effect.fromResult(
            requireFrameAttempt(run, captured.frame.attemptSha256),
          );
          framePreimages.push(Object.freeze({ kind, frame: captured }));
          break;
        }
        case "diagnostic": {
          const captured = yield* Effect.fromResult(
            captureFramePreimage<DeclarativeV2DiagnosticFrameV1>(
              "settleCommand",
              rawFrame,
              kind,
              budget,
              tracker,
            ),
          );
          yield* Effect.fromResult(
            requireFrameAttempt(run, captured.frame.attemptSha256),
          );
          framePreimages.push(Object.freeze({ kind, frame: captured }));
          break;
        }
      }
    }

    const requestedProgressPreimage = yield* Effect.fromResult(
      captureFramePreimage<DeclarativeV2ProgressCursorFrameV1>(
        "settleCommand",
        rawNextProgress,
        "progress_cursor",
        budget,
        tracker,
      ),
    );

    const modules: Array<{
      readonly captured: CapturedFrameV1<DeclarativeV2ModuleSummaryFrameV1>;
      readonly modulePathSha256: Uint8Array;
    }> = [];
    const edges: CapturedFrameV1<DeclarativeV2ImportEdgeFrameV1>[] = [];
    const pages: CapturedFrameV1<DeclarativeV2PageManifestFrameV1>[] = [];
    const links: CapturedFrameV1<DeclarativeV2LinkNodeFrameV1>[] = [];
    const frontier: CapturedFrameV1<DeclarativeV2FrontierEntryFrameV1>[] = [];
    const registrations: CapturedFrameV1<DeclarativeV2RegistrationFrameV1>[] =
      [];
    const diagnostics: CapturedFrameV1<DeclarativeV2DiagnosticFrameV1>[] = [];

    for (const preimage of framePreimages) {
      switch (preimage.kind) {
        case "module_summary": {
          const captured = yield* hashCapturedFrame(preimage.frame, sha256);
          const modulePathSha256 = yield* sha256(preimage.path.bytes, {
            maximumInputBytes: preimage.path.bytes.byteLength,
          });
          modules.push(Object.freeze({
            captured,
            modulePathSha256: new Uint8Array(modulePathSha256),
          }));
          const evidenceKey = Object.freeze({
            kind: preimage.kind,
            moduleOrdinal: captured.frame.moduleOrdinal,
            frameSha256: new Uint8Array(captured.sha256),
          });
          pageEvidenceKeys.push(evidenceKey);
          outputEvidenceKeys.push(evidenceKey);
          break;
        }
        case "import_edge": {
          const captured = yield* hashCapturedFrame(preimage.frame, sha256);
          edges.push(captured);
          const evidenceKey = Object.freeze({
            kind: preimage.kind,
            moduleOrdinal: captured.frame.moduleOrdinal,
            edgeOrdinal: captured.frame.edgeOrdinal,
            frameSha256: new Uint8Array(captured.sha256),
          });
          pageEvidenceKeys.push(evidenceKey);
          outputEvidenceKeys.push(evidenceKey);
          break;
        }
        case "link_node": {
          const captured = yield* hashCapturedFrame(preimage.frame, sha256);
          links.push(captured);
          const evidenceKey = Object.freeze({
            kind: preimage.kind,
            moduleOrdinal: captured.frame.moduleOrdinal,
            rowVersion: captured.frame.rowVersion,
            frameSha256: new Uint8Array(captured.sha256),
          });
          pageEvidenceKeys.push(evidenceKey);
          outputEvidenceKeys.push(evidenceKey);
          break;
        }
        case "frontier_entry": {
          const captured = yield* hashCapturedFrame(preimage.frame, sha256);
          frontier.push(captured);
          const evidenceKey = Object.freeze({
            kind: preimage.kind,
            frontierSequence: captured.frame.frontierSequence,
            rowVersion: captured.frame.rowVersion,
            frameSha256: new Uint8Array(captured.sha256),
          });
          pageEvidenceKeys.push(evidenceKey);
          outputEvidenceKeys.push(evidenceKey);
          break;
        }
        case "registration": {
          const captured = yield* hashCapturedFrame(preimage.frame, sha256);
          registrations.push(captured);
          const evidenceKey = Object.freeze({
            kind: preimage.kind,
            registrationOrdinal: captured.frame.registrationOrdinal,
            frameSha256: new Uint8Array(captured.sha256),
          });
          pageEvidenceKeys.push(evidenceKey);
          outputEvidenceKeys.push(evidenceKey);
          break;
        }
        case "diagnostic": {
          const captured = yield* hashCapturedFrame(preimage.frame, sha256);
          diagnostics.push(captured);
          const evidenceKey = Object.freeze({
            kind: preimage.kind,
            diagnosticOrdinal: captured.frame.diagnosticOrdinal,
            frameSha256: new Uint8Array(captured.sha256),
          });
          pageEvidenceKeys.push(evidenceKey);
          outputEvidenceKeys.push(evidenceKey);
          break;
        }
      }
    }
    const requestedProgress = yield* hashCapturedFrame(
      requestedProgressPreimage,
      sha256,
    );

    yield* Effect.fromResult(sortSettlementEvidence(
      modules,
      edges,
      pages,
      links,
      frontier,
      registrations,
      diagnostics,
      outputEvidenceKeys,
    ));
    pageEvidenceKeys.sort(compareDeclarativeV2PageEvidenceKeyV1);
    for (let index = 1; index < pageEvidenceKeys.length; index += 1) {
      if (
        compareDeclarativeV2PageEvidenceKeyV1(
          pageEvidenceKeys[index - 1]!,
          pageEvidenceKeys[index]!,
        ) === 0
      ) {
        return yield* new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "immutableEvidenceChanged",
        });
      }
    }
    return Object.freeze({
      frames: Object.freeze({
        modules: Object.freeze(modules),
        edges: Object.freeze(edges),
        links: Object.freeze(links),
        frontier: Object.freeze(frontier),
        registrations: Object.freeze(registrations),
        diagnostics: Object.freeze(diagnostics),
      }),
      pageEvidenceKeys: Object.freeze(pageEvidenceKeys),
      outputEvidenceKeys: Object.freeze(outputEvidenceKeys),
      disposition,
      requestedNextLifecycle: nextLifecycle,
      requestedProgress,
    });
});

const completeSettlementBatch = Effect.fn(
  "DeclarativeV2.verifier.completeSettlementBatch",
)(function* (
  run: MutableRunStateV1,
  work: MutableWorkStateV1,
  input: CapturedSettlementInputV1,
  tails: SettledTailsInternalV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  tracker: MutableOperationUsageV1,
  sha256: DeclarativeV2Sha256V1,
): Generator<
  Effect.Effect<unknown, DeclarativeV2VerifierProgressV1Error>,
  CapturedSettlementBatchV1,
  never
> {
    const {
      modules,
      edges,
      links,
      frontier,
      registrations,
      diagnostics,
    } = input.frames;
    const pageEvidenceKeys = input.pageEvidenceKeys;
    const outputEvidenceKeys = [...input.outputEvidenceKeys];
    const derived = yield* Effect.fromResult(deriveSettlement(
      run,
      work,
      input.disposition,
      tails,
      pageEvidenceKeys,
      modules,
      edges,
      links,
      frontier,
      registrations,
      diagnostics,
    ));
    if (input.requestedNextLifecycle !== derived.nextLifecycle) {
      return yield* inputError("settleCommand", "invalidInput");
    }
    if (
      !progressCursorEquals(
        input.requestedProgress.frame,
        derived.nextProgress,
      )
    ) {
      return yield* inputError("settleCommand", "invalidInput");
    }
    const pagePreimage = yield* Effect.fromResult(
      encodeDeclarativeV2PageEvidenceRootV1(
        {
          attemptSha256: run.attemptSha256,
          commandKind: work.commandKind,
          sequence: work.sequence,
          phase: derived.page.phase,
          disposition: input.disposition,
          pageOrdinal: derived.page.pageOrdinal,
          firstItemOrdinal: derived.page.firstItemOrdinal,
          itemCount: derived.page.itemCount,
          previousPageSha256: derived.page.previousPageSha256,
          evidence: pageEvidenceKeys,
        },
        {
          maximumFrameBytes: remaining(
            budget.maximumFrameBytes,
            tracker.frameBytes,
          ),
        },
      ).pipe(
        Result.mapError(evidenceCause =>
          new DeclarativeV2VerifierProgressInputV1Error({
            operation: "settleCommand",
            reason: evidenceCause.reason === "frameBytesExceeded"
              ? "budgetExceeded"
              : "invalidInput",
            ...(evidenceCause.reason === "frameBytesExceeded"
              ? {
                dimension: "frameBytes" as const,
                observed: checkedAddNumber(
                  tracker.frameBytes,
                  evidenceCause.observed ?? Number.MAX_SAFE_INTEGER,
                ) ?? Number.MAX_SAFE_INTEGER,
                maximum: budget.maximumFrameBytes,
              }
              : {}),
            evidenceCause,
          })
        ),
      ),
    );
    yield* Effect.fromResult(chargeResult(
      "settleCommand",
      budget,
      tracker,
      "frameBytes",
      pagePreimage.usage.frameBytes,
    ));
    yield* Effect.fromResult(chargeResult(
      "settleCommand",
      budget,
      tracker,
      "hashBytes",
      pagePreimage.canonicalBytes.byteLength,
    ));
    const pageRootSha256 = yield* sha256(pagePreimage.canonicalBytes, {
      maximumInputBytes: pagePreimage.canonicalBytes.byteLength,
    });
    const page = yield* captureFrame<DeclarativeV2PageManifestFrameV1>(
      "settleCommand",
      {
        kind: "phase_page_manifest",
        attemptSha256: run.attemptSha256,
        phase: derived.page.phase,
        pageOrdinal: derived.page.pageOrdinal,
        firstItemOrdinal: derived.page.firstItemOrdinal,
        itemCount: derived.page.itemCount,
        previousPageSha256: derived.page.previousPageSha256,
        pageRootSha256,
      },
      "phase_page_manifest",
      budget,
      tracker,
      sha256,
    );
    const pages = Object.freeze([page]);
    outputEvidenceKeys.push(Object.freeze({
      kind: "phase_page_manifest" as const,
      phase: page.frame.phase,
      pageOrdinal: page.frame.pageOrdinal,
      frameSha256: new Uint8Array(page.sha256),
    }));
    outputEvidenceKeys.sort(compareEvidenceForSettlement);
    const outputManifest = yield* Effect.fromResult(
      buildDeclarativeV2CommandOutputManifestPreimageV1(
        {
          attemptSha256: run.attemptSha256,
          commandKind: work.commandKind,
          sequence: work.sequence,
          evidence: outputEvidenceKeys,
        },
        {
          maximumFrameBytes: remaining(
            budget.maximumFrameBytes,
            tracker.frameBytes,
          ),
        },
      ).pipe(
        Result.mapError(derivationCause =>
          new DeclarativeV2VerifierProgressInputV1Error({
            operation: "settleCommand",
            reason: derivationCause.reason === "frameBytesExceeded"
              ? "budgetExceeded"
              : "invalidInput",
            ...(derivationCause.reason === "frameBytesExceeded"
              ? {
                  dimension: "frameBytes" as const,
                  observed: checkedAddNumber(
                    tracker.frameBytes,
                    derivationCause.observed ?? Number.MAX_SAFE_INTEGER,
                  ) ?? Number.MAX_SAFE_INTEGER,
                  maximum: budget.maximumFrameBytes,
              }
              : {}),
            derivationCause,
          })
        ),
      ),
    );
    yield* Effect.fromResult(chargeResult(
      "settleCommand",
      budget,
      tracker,
      "frameBytes",
      outputManifest.usage.frameBytes,
    ));
    yield* Effect.fromResult(chargeResult(
      "settleCommand",
      budget,
      tracker,
      "hashBytes",
      outputManifest.bytes.byteLength,
    ));
    const outputSha256 = yield* sha256(outputManifest.bytes, {
      maximumInputBytes: outputManifest.bytes.byteLength,
    });
    const usageFrame = yield* captureFrame<DeclarativeV2BudgetFrameV1>(
      "settleCommand",
      run.attempt.usage,
      "attempt_usage",
      budget,
      tracker,
      sha256,
    );
    const receipt = yield* captureFrame<DeclarativeV2CommandReceiptFrameV1>(
      "settleCommand",
      {
        kind: "command_receipt",
        commandKind: work.commandKind,
        sequence: work.sequence,
        reservationSha256: work.reservationSha256,
        usageSha256: usageFrame.sha256,
        outputSha256,
        progressCursorSha256: input.requestedProgress.sha256,
      },
      "command_receipt",
      budget,
      tracker,
      sha256,
    );
    return Object.freeze({
      frames: Object.freeze({
        modules: Object.freeze(modules),
        edges: Object.freeze(edges),
        pages: Object.freeze(pages),
        links: Object.freeze(links),
        frontier: Object.freeze(frontier),
        registrations: Object.freeze(registrations),
        diagnostics: Object.freeze(diagnostics),
      }),
      nextLifecycle: derived.nextLifecycle,
      progress: input.requestedProgress,
      receipt,
      outputSha256: new Uint8Array(outputSha256),
    });
});

function requireFrameAttempt(
  run: MutableRunStateV1,
  attemptSha256: Uint8Array,
): Result.Result<void, DeclarativeV2VerifierProgressInputV1Error> {
  return bytesEqualFullScan(run.attemptSha256, attemptSha256)
    ? Result.succeed(undefined)
    : Result.fail(inputError("settleCommand", "invalidInput"));
}

function isSettlementFrameKind(
  value: unknown,
): value is
  | "module_summary"
  | "import_edge"
  | "link_node"
  | "frontier_entry"
  | "registration"
  | "diagnostic" {
  return value === "module_summary" ||
    value === "import_edge" ||
    value === "link_node" ||
    value === "frontier_entry" ||
    value === "registration" ||
    value === "diagnostic";
}

function sortSettlementEvidence(
  modules: Array<{
    readonly captured: CapturedFrameV1<DeclarativeV2ModuleSummaryFrameV1>;
    readonly modulePathSha256: Uint8Array;
  }>,
  edges: CapturedFrameV1<DeclarativeV2ImportEdgeFrameV1>[],
  pages: CapturedFrameV1<DeclarativeV2PageManifestFrameV1>[],
  links: CapturedFrameV1<DeclarativeV2LinkNodeFrameV1>[],
  frontier: CapturedFrameV1<DeclarativeV2FrontierEntryFrameV1>[],
  registrations: CapturedFrameV1<DeclarativeV2RegistrationFrameV1>[],
  diagnostics: CapturedFrameV1<DeclarativeV2DiagnosticFrameV1>[],
  evidenceKeys: DeclarativeV2SettledEvidenceKeyV1[],
): Result.Result<void, DeclarativeV2VerifierProgressCollisionV1Error> {
  modules.sort((a, b) =>
    compareBigint(a.captured.frame.moduleOrdinal, b.captured.frame.moduleOrdinal)
  );
  edges.sort((a, b) =>
    compareBigint(a.frame.moduleOrdinal, b.frame.moduleOrdinal) ||
    compareBigint(a.frame.edgeOrdinal, b.frame.edgeOrdinal)
  );
  pages.sort((a, b) =>
    phaseRank(a.frame.phase) - phaseRank(b.frame.phase) ||
    compareBigint(a.frame.pageOrdinal, b.frame.pageOrdinal)
  );
  links.sort((a, b) =>
    compareBigint(a.frame.moduleOrdinal, b.frame.moduleOrdinal) ||
    compareBigint(a.frame.rowVersion, b.frame.rowVersion)
  );
  frontier.sort((a, b) =>
    compareBigint(a.frame.frontierSequence, b.frame.frontierSequence) ||
    compareBigint(a.frame.rowVersion, b.frame.rowVersion)
  );
  registrations.sort((a, b) =>
    compareBigint(
      a.frame.registrationOrdinal,
      b.frame.registrationOrdinal,
    )
  );
  diagnostics.sort((a, b) =>
    compareBigint(a.frame.diagnosticOrdinal, b.frame.diagnosticOrdinal)
  );
  for (let index = 1; index < links.length; index += 1) {
    if (
      links[index - 1]!.frame.moduleOrdinal ===
        links[index]!.frame.moduleOrdinal
    ) {
      return Result.fail(
        new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "mutableEvidenceChanged",
        }),
      );
    }
  }
  for (let index = 1; index < frontier.length; index += 1) {
    if (
      frontier[index - 1]!.frame.frontierSequence ===
        frontier[index]!.frame.frontierSequence
    ) {
      return Result.fail(
        new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "mutableEvidenceChanged",
        }),
      );
    }
  }
  evidenceKeys.sort(compareEvidenceForSettlement);
  for (let index = 1; index < evidenceKeys.length; index += 1) {
    if (
      compareEvidenceForSettlement(
        evidenceKeys[index - 1]!,
        evidenceKeys[index]!,
      ) === 0
    ) {
      return Result.fail(
        new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "immutableEvidenceChanged",
        }),
      );
    }
  }
  return Result.succeed(undefined);
}

function compareEvidenceForSettlement(
  left: DeclarativeV2SettledEvidenceKeyV1,
  right: DeclarativeV2SettledEvidenceKeyV1,
): number {
  const kindRank = settlementKindRank(left.kind) -
    settlementKindRank(right.kind);
  if (kindRank !== 0) return kindRank;
  if (left.kind !== right.kind) return kindRank;
  switch (left.kind) {
    case "inert_object_reference":
      return right.kind === left.kind
        ? compareDeclarativeV2PageEvidenceKeyV1(left, right)
        : 0;
    case "module_summary":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal)
        : 0;
    case "import_edge":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal) ||
          compareBigint(left.edgeOrdinal, right.edgeOrdinal)
        : 0;
    case "phase_page_manifest":
      return right.kind === left.kind
        ? phaseRank(left.phase) - phaseRank(right.phase) ||
          compareBigint(left.pageOrdinal, right.pageOrdinal)
        : 0;
    case "link_node":
      return right.kind === left.kind
        ? compareBigint(left.moduleOrdinal, right.moduleOrdinal) ||
          compareBigint(left.rowVersion, right.rowVersion)
        : 0;
    case "frontier_entry":
      return right.kind === left.kind
        ? compareBigint(left.frontierSequence, right.frontierSequence) ||
          compareBigint(left.rowVersion, right.rowVersion)
        : 0;
    case "registration":
      return right.kind === left.kind
        ? compareBigint(left.registrationOrdinal, right.registrationOrdinal)
        : 0;
    case "diagnostic":
      return right.kind === left.kind
        ? compareBigint(left.diagnosticOrdinal, right.diagnosticOrdinal)
        : 0;
    case "deployment_analysis_projection":
    case "deployment_codegen_analysis_projection":
    case "static_finalization":
      return right.kind === left.kind
        ? compareDeclarativeV2PageEvidenceKeyV1(left, right)
        : 0;
  }
}

function settlementKindRank(
  kind: DeclarativeV2SettledEvidenceKeyV1["kind"],
): number {
  switch (kind) {
    case "inert_object_reference":
      return 8;
    case "module_summary":
      return 1;
    case "import_edge":
      return 2;
    case "phase_page_manifest":
      return 3;
    case "link_node":
      return 4;
    case "frontier_entry":
      return 5;
    case "registration":
      return 6;
    case "diagnostic":
      return 7;
    case "deployment_analysis_projection":
      return 9;
    case "deployment_codegen_analysis_projection":
      return 10;
    case "static_finalization":
      return 11;
  }
}

function phaseRank(phase: DeclarativeV2VerifierPhaseV1): number {
  switch (phase) {
    case "source":
      return 1;
    case "parse":
      return 2;
    case "link":
      return 3;
    case "registration":
      return 4;
    case "verdict":
      return 5;
  }
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function verifyPagePredecessors(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  frames: CapturedSettlementEvidenceV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<void> {
  let previous:
    | Readonly<{
      readonly phase: DeclarativeV2VerifierPhaseV1;
      readonly pageOrdinal: bigint;
      readonly firstItemOrdinal: bigint;
      readonly itemCount: bigint;
      readonly sha256: Uint8Array;
    }>
    | undefined;
  for (const page of frames.pages) {
    const frame = page.frame;
    if (
      previous !== undefined &&
      previous.phase === frame.phase
    ) {
      if (
        frame.pageOrdinal !== previous.pageOrdinal + 1n ||
        frame.firstItemOrdinal !==
          previous.firstItemOrdinal + previous.itemCount ||
        frame.previousPageSha256 === null ||
        !bytesEqualFullScan(frame.previousPageSha256, previous.sha256)
      ) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "pageRangeConflict",
        });
      }
    } else if (frame.pageOrdinal === 0n) {
      if (
        frame.firstItemOrdinal !== 0n ||
        frame.previousPageSha256 !== null
      ) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "pageRangeConflict",
        });
      }
    } else {
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const rows = await runVerifierStatement("settleCommand", () => tx
        .select({
          pageOrdinal: fxSystemDeclarativeV2PageManifests.pageOrdinal,
          firstItemOrdinal:
            fxSystemDeclarativeV2PageManifests.firstItemOrdinal,
          itemCount: fxSystemDeclarativeV2PageManifests.itemCount,
          frameSha256: fxSystemDeclarativeV2PageManifests.frameSha256,
        })
        .from(fxSystemDeclarativeV2PageManifests)
        .where(and(
          eq(fxSystemDeclarativeV2PageManifests.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2PageManifests.attemptSha256,
            attemptSha256,
          ),
          eq(fxSystemDeclarativeV2PageManifests.phase, frame.phase),
          eq(
            fxSystemDeclarativeV2PageManifests.pageOrdinal,
            frame.pageOrdinal - 1n,
          ),
        ))
        .for("update"));
      if (rows.length !== 1) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "pageRangeConflict",
        });
      }
      const row = rows[0];
      if (
        !isUint8ArrayWithByteLength(
          row.frameSha256,
          DECLARATIVE_V2_SHA256_BYTES_V1,
        ) ||
        frame.firstItemOrdinal !== row.firstItemOrdinal + row.itemCount ||
        frame.previousPageSha256 === null ||
        !bytesEqualFullScan(
          frame.previousPageSha256,
          row.frameSha256,
        )
      ) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "pageRangeConflict",
        });
      }
    }
    previous = Object.freeze({
      phase: frame.phase,
      pageOrdinal: frame.pageOrdinal,
      firstItemOrdinal: frame.firstItemOrdinal,
      itemCount: frame.itemCount,
      sha256: new Uint8Array(page.sha256),
    });
  }
}

async function insertImmutableEvidence(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  batch: CapturedSettlementBatchV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<void> {
  for (const module of batch.frames.modules) {
    await insertOrVerifyImmutable(
      module.captured,
      budget,
      usage,
      () =>
        tx.insert(fxSystemDeclarativeV2ModuleSummaries).values({
          scopeId,
          attemptSha256,
          moduleOrdinal: module.captured.frame.moduleOrdinal,
          modulePathSha256: module.modulePathSha256,
          frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          frameByteLength: BigInt(module.captured.bytes.byteLength),
          frameSha256: module.captured.sha256,
          frameBytes: module.captured.bytes,
        }).onConflictDoNothing().returning({
          frameSha256: fxSystemDeclarativeV2ModuleSummaries.frameSha256,
        }),
      () =>
        tx.select({
          byteLength: fxSystemDeclarativeV2ModuleSummaries.frameByteLength,
          sha256: fxSystemDeclarativeV2ModuleSummaries.frameSha256,
        }).from(fxSystemDeclarativeV2ModuleSummaries).where(and(
          eq(fxSystemDeclarativeV2ModuleSummaries.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2ModuleSummaries.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2ModuleSummaries.moduleOrdinal,
            module.captured.frame.moduleOrdinal,
          ),
        )),
      () =>
        tx.select({
          bytes: fxSystemDeclarativeV2ModuleSummaries.frameBytes,
        }).from(fxSystemDeclarativeV2ModuleSummaries).where(and(
          eq(fxSystemDeclarativeV2ModuleSummaries.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2ModuleSummaries.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2ModuleSummaries.moduleOrdinal,
            module.captured.frame.moduleOrdinal,
          ),
        )),
    );
  }
  for (const edge of batch.frames.edges) {
    await insertOrVerifyImmutable(
      edge,
      budget,
      usage,
      () =>
        tx.insert(fxSystemDeclarativeV2ImportEdges).values({
          scopeId,
          attemptSha256,
          moduleOrdinal: edge.frame.moduleOrdinal,
          edgeOrdinal: edge.frame.edgeOrdinal,
          frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          frameByteLength: BigInt(edge.bytes.byteLength),
          frameSha256: edge.sha256,
          frameBytes: edge.bytes,
        }).onConflictDoNothing({
          target: [
            fxSystemDeclarativeV2ImportEdges.scopeId,
            fxSystemDeclarativeV2ImportEdges.attemptSha256,
            fxSystemDeclarativeV2ImportEdges.moduleOrdinal,
            fxSystemDeclarativeV2ImportEdges.edgeOrdinal,
          ],
        }).returning({
          frameSha256: fxSystemDeclarativeV2ImportEdges.frameSha256,
        }),
      () =>
        tx.select({
          byteLength: fxSystemDeclarativeV2ImportEdges.frameByteLength,
          sha256: fxSystemDeclarativeV2ImportEdges.frameSha256,
        }).from(fxSystemDeclarativeV2ImportEdges).where(and(
          eq(fxSystemDeclarativeV2ImportEdges.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2ImportEdges.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2ImportEdges.moduleOrdinal,
            edge.frame.moduleOrdinal,
          ),
          eq(
            fxSystemDeclarativeV2ImportEdges.edgeOrdinal,
            edge.frame.edgeOrdinal,
          ),
        )),
      () =>
        tx.select({
          bytes: fxSystemDeclarativeV2ImportEdges.frameBytes,
        }).from(fxSystemDeclarativeV2ImportEdges).where(and(
          eq(fxSystemDeclarativeV2ImportEdges.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2ImportEdges.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2ImportEdges.moduleOrdinal,
            edge.frame.moduleOrdinal,
          ),
          eq(
            fxSystemDeclarativeV2ImportEdges.edgeOrdinal,
            edge.frame.edgeOrdinal,
          ),
        )),
    );
  }
  for (const page of batch.frames.pages) {
    await insertOrVerifyImmutable(
      page,
      budget,
      usage,
      () =>
        tx.insert(fxSystemDeclarativeV2PageManifests).values({
          scopeId,
          attemptSha256,
          phase: page.frame.phase,
          pageOrdinal: page.frame.pageOrdinal,
          firstItemOrdinal: page.frame.firstItemOrdinal,
          itemCount: page.frame.itemCount,
          previousPageSha256: page.frame.previousPageSha256,
          frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          frameByteLength: BigInt(page.bytes.byteLength),
          frameSha256: page.sha256,
          frameBytes: page.bytes,
        }).onConflictDoNothing({
          target: [
            fxSystemDeclarativeV2PageManifests.scopeId,
            fxSystemDeclarativeV2PageManifests.attemptSha256,
            fxSystemDeclarativeV2PageManifests.phase,
            fxSystemDeclarativeV2PageManifests.pageOrdinal,
          ],
        }).returning({
          frameSha256: fxSystemDeclarativeV2PageManifests.frameSha256,
        }),
      () =>
        tx.select({
          byteLength: fxSystemDeclarativeV2PageManifests.frameByteLength,
          sha256: fxSystemDeclarativeV2PageManifests.frameSha256,
        }).from(fxSystemDeclarativeV2PageManifests).where(and(
          eq(fxSystemDeclarativeV2PageManifests.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2PageManifests.attemptSha256,
            attemptSha256,
          ),
          eq(fxSystemDeclarativeV2PageManifests.phase, page.frame.phase),
          eq(
            fxSystemDeclarativeV2PageManifests.pageOrdinal,
            page.frame.pageOrdinal,
          ),
        )),
      () =>
        tx.select({
          bytes: fxSystemDeclarativeV2PageManifests.frameBytes,
        }).from(fxSystemDeclarativeV2PageManifests).where(and(
          eq(fxSystemDeclarativeV2PageManifests.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2PageManifests.attemptSha256,
            attemptSha256,
          ),
          eq(fxSystemDeclarativeV2PageManifests.phase, page.frame.phase),
          eq(
            fxSystemDeclarativeV2PageManifests.pageOrdinal,
            page.frame.pageOrdinal,
          ),
        )),
    );
  }
  for (const registration of batch.frames.registrations) {
    await insertOrVerifyImmutable(
      registration,
      budget,
      usage,
      () =>
        tx.insert(fxSystemDeclarativeV2Registrations).values({
          scopeId,
          attemptSha256,
          registrationOrdinal: registration.frame.registrationOrdinal,
          handlerIdentitySha256:
            registration.frame.handlerIdentitySha256,
          frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          frameByteLength: BigInt(registration.bytes.byteLength),
          frameSha256: registration.sha256,
          frameBytes: registration.bytes,
        }).onConflictDoNothing().returning({
          frameSha256: fxSystemDeclarativeV2Registrations.frameSha256,
        }),
      () =>
        tx.select({
          byteLength: fxSystemDeclarativeV2Registrations.frameByteLength,
          sha256: fxSystemDeclarativeV2Registrations.frameSha256,
        }).from(fxSystemDeclarativeV2Registrations).where(and(
          eq(fxSystemDeclarativeV2Registrations.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2Registrations.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2Registrations.registrationOrdinal,
            registration.frame.registrationOrdinal,
          ),
        )),
      () =>
        tx.select({
          bytes: fxSystemDeclarativeV2Registrations.frameBytes,
        }).from(fxSystemDeclarativeV2Registrations).where(and(
          eq(fxSystemDeclarativeV2Registrations.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2Registrations.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2Registrations.registrationOrdinal,
            registration.frame.registrationOrdinal,
          ),
        )),
    );
  }
  for (const diagnostic of batch.frames.diagnostics) {
    await insertOrVerifyImmutable(
      diagnostic,
      budget,
      usage,
      () =>
        tx.insert(fxSystemDeclarativeV2Diagnostics).values({
          scopeId,
          attemptSha256,
          diagnosticOrdinal: diagnostic.frame.diagnosticOrdinal,
          frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          frameByteLength: BigInt(diagnostic.bytes.byteLength),
          frameSha256: diagnostic.sha256,
          frameBytes: diagnostic.bytes,
        }).onConflictDoNothing({
          target: [
            fxSystemDeclarativeV2Diagnostics.scopeId,
            fxSystemDeclarativeV2Diagnostics.attemptSha256,
            fxSystemDeclarativeV2Diagnostics.diagnosticOrdinal,
          ],
        }).returning({
          frameSha256: fxSystemDeclarativeV2Diagnostics.frameSha256,
        }),
      () =>
        tx.select({
          byteLength: fxSystemDeclarativeV2Diagnostics.frameByteLength,
          sha256: fxSystemDeclarativeV2Diagnostics.frameSha256,
        }).from(fxSystemDeclarativeV2Diagnostics).where(and(
          eq(fxSystemDeclarativeV2Diagnostics.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2Diagnostics.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2Diagnostics.diagnosticOrdinal,
            diagnostic.frame.diagnosticOrdinal,
          ),
        )),
      () =>
        tx.select({
          bytes: fxSystemDeclarativeV2Diagnostics.frameBytes,
        }).from(fxSystemDeclarativeV2Diagnostics).where(and(
          eq(fxSystemDeclarativeV2Diagnostics.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2Diagnostics.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2Diagnostics.diagnosticOrdinal,
            diagnostic.frame.diagnosticOrdinal,
          ),
        )),
    );
  }
}

async function insertOrVerifyImmutable(
  captured: CapturedFrameV1<DeclarativeV2PhysicalFrameV1>,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
  insert: () => Promise<ReadonlyArray<unknown>>,
  selectMetadata: () => Promise<ReadonlyArray<Readonly<{
    readonly byteLength: bigint;
    readonly sha256: Uint8Array;
  }>>>,
  selectBytes: () => Promise<ReadonlyArray<Readonly<{
    readonly bytes: Uint8Array;
  }>>>,
): Promise<void> {
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const inserted = await runVerifierStatement("settleCommand", insert);
  if (inserted.length === 1) return;
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const metadataRows = await runVerifierStatement(
    "settleCommand",
    selectMetadata,
  );
  if (metadataRows.length !== 1) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "immutableEvidenceChanged",
    });
  }
  const metadata = metadataRows[0]!;
  if (
    metadata.byteLength !== BigInt(captured.bytes.byteLength) ||
    !isUint8ArrayWithByteLength(
      metadata.sha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !bytesEqualFullScan(metadata.sha256, captured.sha256)
  ) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "immutableEvidenceChanged",
    });
  }
  chargeOrThrow(
    "settleCommand",
    budget,
    usage,
    "frameBytes",
    captured.bytes.byteLength,
  );
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const byteRows = await runVerifierStatement("settleCommand", selectBytes);
  if (byteRows.length !== 1) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "immutableEvidenceChanged",
    });
  }
  const bytes = byteRows[0]!.bytes;
  if (!isUint8Array(bytes) || !bytesEqualFullScan(bytes, captured.bytes)) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "immutableEvidenceChanged",
    });
  }
}

async function settleLinkNodes(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  batch: CapturedSettlementBatchV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<void> {
  for (const node of batch.frames.links) {
    if (node.frame.rowVersion === 0n) {
      if (node.frame.previousRowSha256 !== null) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "mutableEvidenceChanged",
        });
      }
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const rows = await runVerifierStatement("settleCommand", () =>
        tx.insert(fxSystemDeclarativeV2LinkNodes).values({
        scopeId,
        attemptSha256,
        moduleOrdinal: node.frame.moduleOrdinal,
        remainingIndegree: node.frame.remainingIndegree,
        nextEdgeOrdinal: node.frame.nextEdgeOrdinal,
        state: node.frame.state,
        rowVersion: node.frame.rowVersion,
        rowCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
        rowByteLength: BigInt(node.bytes.byteLength),
        rowSha256: node.sha256,
        rowBytes: node.bytes,
      }).onConflictDoNothing({
        target: [
          fxSystemDeclarativeV2LinkNodes.scopeId,
          fxSystemDeclarativeV2LinkNodes.attemptSha256,
          fxSystemDeclarativeV2LinkNodes.moduleOrdinal,
        ],
      }).returning({
        rowSha256: fxSystemDeclarativeV2LinkNodes.rowSha256,
      }));
      if (rows.length === 1) continue;
    } else {
      if (node.frame.previousRowSha256 === null) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "mutableEvidenceChanged",
        });
      }
      const previousRowSha256 = node.frame.previousRowSha256;
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const rows = await runVerifierStatement("settleCommand", () => tx
        .update(fxSystemDeclarativeV2LinkNodes)
        .set({
          remainingIndegree: node.frame.remainingIndegree,
          nextEdgeOrdinal: node.frame.nextEdgeOrdinal,
          state: node.frame.state,
          rowVersion: node.frame.rowVersion,
          rowCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          rowByteLength: BigInt(node.bytes.byteLength),
          rowSha256: node.sha256,
          rowBytes: node.bytes,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(fxSystemDeclarativeV2LinkNodes.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2LinkNodes.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2LinkNodes.moduleOrdinal,
            node.frame.moduleOrdinal,
          ),
          eq(
            fxSystemDeclarativeV2LinkNodes.rowVersion,
            node.frame.rowVersion - 1n,
          ),
          eq(
            fxSystemDeclarativeV2LinkNodes.rowSha256,
            previousRowSha256,
          ),
        ))
        .returning({
          rowSha256: fxSystemDeclarativeV2LinkNodes.rowSha256,
        }));
      if (rows.length === 1) continue;
    }
    await verifyMutableReplay(
      tx,
      "link",
      scopeId,
      attemptSha256,
      node.frame.moduleOrdinal,
      node.frame.rowVersion,
      node,
      budget,
      usage,
    );
  }
}

async function settleFrontierEntries(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  batch: CapturedSettlementBatchV1,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<void> {
  for (const entry of batch.frames.frontier) {
    if (entry.frame.rowVersion === 0n) {
      if (entry.frame.previousRowSha256 !== null) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "mutableEvidenceChanged",
        });
      }
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const rows = await runVerifierStatement("settleCommand", () =>
        tx.insert(fxSystemDeclarativeV2FrontierEntries)
        .values({
          scopeId,
          attemptSha256,
          frontierSequence: entry.frame.frontierSequence,
          moduleOrdinal: entry.frame.moduleOrdinal,
          state: entry.frame.state,
          rowVersion: entry.frame.rowVersion,
          rowCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          rowByteLength: BigInt(entry.bytes.byteLength),
          rowSha256: entry.sha256,
          rowBytes: entry.bytes,
        })
        .onConflictDoNothing()
        .returning({
          rowSha256: fxSystemDeclarativeV2FrontierEntries.rowSha256,
        }));
      if (rows.length === 1) continue;
    } else {
      if (entry.frame.previousRowSha256 === null) {
        throw new DeclarativeV2VerifierProgressCollisionV1Error({
          operation: "settleCommand",
          reason: "mutableEvidenceChanged",
        });
      }
      const previousRowSha256 = entry.frame.previousRowSha256;
      chargeSqlOrThrow("settleCommand", budget, usage, 1);
      const rows = await runVerifierStatement("settleCommand", () => tx
        .update(fxSystemDeclarativeV2FrontierEntries)
        .set({
          moduleOrdinal: entry.frame.moduleOrdinal,
          state: entry.frame.state,
          rowVersion: entry.frame.rowVersion,
          rowCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
          rowByteLength: BigInt(entry.bytes.byteLength),
          rowSha256: entry.sha256,
          rowBytes: entry.bytes,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(fxSystemDeclarativeV2FrontierEntries.scopeId, scopeId),
          eq(
            fxSystemDeclarativeV2FrontierEntries.attemptSha256,
            attemptSha256,
          ),
          eq(
            fxSystemDeclarativeV2FrontierEntries.frontierSequence,
            entry.frame.frontierSequence,
          ),
          eq(
            fxSystemDeclarativeV2FrontierEntries.rowVersion,
            entry.frame.rowVersion - 1n,
          ),
          eq(
            fxSystemDeclarativeV2FrontierEntries.rowSha256,
            previousRowSha256,
          ),
        ))
        .returning({
          rowSha256: fxSystemDeclarativeV2FrontierEntries.rowSha256,
        }));
      if (rows.length === 1) continue;
    }
    await verifyMutableReplay(
      tx,
      "frontier",
      scopeId,
      attemptSha256,
      entry.frame.frontierSequence,
      entry.frame.rowVersion,
      entry,
      budget,
      usage,
    );
  }
}

async function verifyMutableReplay(
  tx: AppRowTransaction,
  kind: "link" | "frontier",
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
  key: bigint,
  version: bigint,
  captured: CapturedFrameV1<
    DeclarativeV2LinkNodeFrameV1 | DeclarativeV2FrontierEntryFrameV1
  >,
  budget: DeclarativeV2VerifierProgressOperationBudgetV1,
  usage: MutableOperationUsageV1,
): Promise<void> {
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const metadataRows = await runVerifierStatement(
    "settleCommand",
    () => kind === "link"
      ? tx.select({
      rowVersion: fxSystemDeclarativeV2LinkNodes.rowVersion,
      byteLength: fxSystemDeclarativeV2LinkNodes.rowByteLength,
      sha256: fxSystemDeclarativeV2LinkNodes.rowSha256,
    }).from(fxSystemDeclarativeV2LinkNodes).where(and(
      eq(fxSystemDeclarativeV2LinkNodes.scopeId, scopeId),
      eq(fxSystemDeclarativeV2LinkNodes.attemptSha256, attemptSha256),
      eq(fxSystemDeclarativeV2LinkNodes.moduleOrdinal, key),
    ))
    : tx.select({
      rowVersion: fxSystemDeclarativeV2FrontierEntries.rowVersion,
      byteLength: fxSystemDeclarativeV2FrontierEntries.rowByteLength,
      sha256: fxSystemDeclarativeV2FrontierEntries.rowSha256,
    }).from(fxSystemDeclarativeV2FrontierEntries).where(and(
      eq(fxSystemDeclarativeV2FrontierEntries.scopeId, scopeId),
      eq(fxSystemDeclarativeV2FrontierEntries.attemptSha256, attemptSha256),
      eq(fxSystemDeclarativeV2FrontierEntries.frontierSequence, key),
    )),
  );
  if (metadataRows.length !== 1) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "mutableEvidenceChanged",
    });
  }
  const metadata = metadataRows[0]!;
  if (
    metadata.rowVersion !== version ||
    metadata.byteLength !== BigInt(captured.bytes.byteLength) ||
    !isUint8ArrayWithByteLength(
      metadata.sha256,
      DECLARATIVE_V2_SHA256_BYTES_V1,
    ) ||
    !bytesEqualFullScan(metadata.sha256, captured.sha256)
  ) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "mutableEvidenceChanged",
    });
  }
  chargeOrThrow(
    "settleCommand",
    budget,
    usage,
    "frameBytes",
    captured.bytes.byteLength,
  );
  chargeSqlOrThrow("settleCommand", budget, usage, 1);
  const bytesRows = await runVerifierStatement(
    "settleCommand",
    () => kind === "link"
      ? tx.select({
      bytes: fxSystemDeclarativeV2LinkNodes.rowBytes,
    }).from(fxSystemDeclarativeV2LinkNodes).where(and(
      eq(fxSystemDeclarativeV2LinkNodes.scopeId, scopeId),
      eq(fxSystemDeclarativeV2LinkNodes.attemptSha256, attemptSha256),
      eq(fxSystemDeclarativeV2LinkNodes.moduleOrdinal, key),
    ))
    : tx.select({
      bytes: fxSystemDeclarativeV2FrontierEntries.rowBytes,
    }).from(fxSystemDeclarativeV2FrontierEntries).where(and(
      eq(fxSystemDeclarativeV2FrontierEntries.scopeId, scopeId),
      eq(fxSystemDeclarativeV2FrontierEntries.attemptSha256, attemptSha256),
      eq(fxSystemDeclarativeV2FrontierEntries.frontierSequence, key),
    )),
  );
  if (
    bytesRows.length !== 1 ||
    !isUint8Array(bytesRows[0]!.bytes) ||
    !bytesEqualFullScan(
      bytesRows[0]!.bytes,
      captured.bytes,
    )
  ) {
    throw new DeclarativeV2VerifierProgressCollisionV1Error({
      operation: "settleCommand",
      reason: "mutableEvidenceChanged",
    });
  }
}

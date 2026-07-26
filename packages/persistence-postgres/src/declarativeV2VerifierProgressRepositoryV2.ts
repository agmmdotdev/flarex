import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isLowercaseUuidText } from "@flarex/utils/strings";
import {
  and,
  eq,
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
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierAttemptIdentityFrameV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
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
import {
  decodeDeclarativeV2VerifierAttemptMetadataRowV2,
  decodeDeclarativeV2VerifierAttemptStoredStateV2,
  decodeDeclarativeV2VerifierCommandMetadataRowV2,
  decodeDeclarativeV2VerifierCommandStoredStateV2,
  decodeDeclarativeV2VerifierStoredFrameV2,
  type DeclarativeV2VerifierDecodedAttemptStoredStateV2,
  type DeclarativeV2VerifierDecodedCommandStoredStateV2,
  type DeclarativeV2VerifierProgressV2StoredRowError,
  type DeclarativeV2VerifierStoredAttemptMetadataV2,
  type DeclarativeV2VerifierStoredCommandMetadataV2,
} from "./declarativeV2VerifierProgressV2";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import {
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandsV2,
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
  | "release"
  | "abandon";

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
  | "renewAttempt"
  | "insertCommand"
  | "commandMetadata"
  | "commandFrames"
  | "reserveAttempt"
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
      | "commandMismatch";
    readonly dimension?:
      keyof DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
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
      | "release";
    readonly reason: "attemptChanged" | "commandChanged" | "pendingExists";
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
      | "rowCountMismatch";
    readonly storedCause?: DeclarativeV2VerifierProgressV2StoredRowError;
  }> {}

export class DeclarativeV2VerifierProgressRepositoryExhaustionV2Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressRepositoryExhaustionV2Error",
  )<{
    readonly operation: "acquire" | "reserveCommand";
    readonly dimension: "writerFence" | "sequence" |
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
}

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

interface CapturedFrameV2<
  Frame extends
    | DeclarativeV2VerifierAttemptIdentityFrameV2
    | DeclarativeV2VerifierBudgetFrameV2
    | DeclarativeV2VerifierProgressCursorFrameV2
    | DeclarativeV2VerifierCommandReservationFrameV2,
> {
  readonly frame: Frame;
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
  readonly progressSha256: Uint8Array;
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
  closed: boolean;
}

interface LoadedAttemptV2 {
  readonly decoded: DeclarativeV2VerifierDecodedAttemptStoredStateV2;
}

interface LoadedCommandV2 {
  readonly decoded: DeclarativeV2VerifierDecodedCommandStoredStateV2;
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
              return Object.freeze({
                kind: "pendingReplay" as const,
                stored,
              });
            }
            if (resultingUsage === null) {
              throw stale("reserveCommand", "stateChanged");
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
          input.reservation.sha256,
        );
        works.set(token.work, token.state);
        return Object.freeze({
          kind: decision.kind,
          work: token.work,
          reservation: copyReservation(input.reservation.frame),
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
          input.reservation.sha256,
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
          operationUsage: freezeUsage(usage),
        });
      }))
  );

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

function freezeUsage(
  usage: MutableOperationUsageV2,
): DeclarativeV2VerifierProgressRepositoryOperationUsageV2 {
  return Object.freeze({ ...usage });
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
    keyof DeclarativeV2VerifierProgressRepositoryOperationUsageV2,
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
  Kind extends
    | "attempt_identity"
    | "attempt_ceilings"
    | "attempt_usage"
    | "command_budget"
    | "progress_cursor"
    | "command_reservation",
>(
  operation: DeclarativeV2VerifierProgressRepositoryOperationV2,
  input: unknown,
  expectedKind: Kind,
  budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  usage: MutableOperationUsageV2,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<
  CapturedFrameV2<Extract<
    | DeclarativeV2VerifierAttemptIdentityFrameV2
    | DeclarativeV2VerifierBudgetFrameV2
    | DeclarativeV2VerifierProgressCursorFrameV2
    | DeclarativeV2VerifierCommandReservationFrameV2,
    { readonly kind: Kind }
  >>,
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
        | DeclarativeV2VerifierAttemptIdentityFrameV2
        | DeclarativeV2VerifierBudgetFrameV2
        | DeclarativeV2VerifierProgressCursorFrameV2
        | DeclarativeV2VerifierCommandReservationFrameV2,
        { readonly kind: Kind }
      >,
      bytes: new Uint8Array(encoded.canonicalBytes),
      sha256: new Uint8Array(digest),
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
    const record = yield* Effect.fromResult(
      captureExactRecord(
        operation,
        input,
        ["reservation", "commandBudget"],
      ),
    );
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
    return Object.freeze({ reservation, commandBudget });
  });
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
  reservationSha256: Uint8Array,
) {
  const work = Object.freeze({
    _tag: "DeclarativeV2VerifierProgressWorkV2" as const,
  });
  const state: MutableWorkStateV2 = {
    run,
    commandKind: reservation.commandKind,
    sequence: reservation.sequence,
    reservationSha256: new Uint8Array(reservationSha256),
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

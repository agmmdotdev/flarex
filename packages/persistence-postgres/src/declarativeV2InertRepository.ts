import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
  DECLARATIVE_V2_SHA256_BYTES_V1,
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
  type DeclarativeV2EncodedFrameV1,
  type DeclarativeV2PhysicalFrameV1Error,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  fxSystemDeclarativeV2Candidates,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

export interface DeclarativeV2InertRepositoryBudgetV1 {
  readonly maximumCalls: number;
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumHashBytes: number;
}

export interface DeclarativeV2InertRepositoryUsageV1 {
  readonly calls: number;
  readonly frameBytes: number;
  readonly canonicalBytes: number;
  readonly hashBytes: number;
}

export class DeclarativeV2InertRepositoryInputV1Error extends Data.TaggedError(
  "DeclarativeV2InertRepositoryInputV1Error",
)<{
  readonly operation: "insertCandidate" | "readCandidate";
  readonly reason: "invalidInput" | "invalidBudget" | "budgetExceeded";
  readonly dimension?: keyof DeclarativeV2InertRepositoryUsageV1;
  readonly observed?: number;
  readonly maximum?: number;
  readonly codecCause?: DeclarativeV2PhysicalFrameV1Error;
}> {}

export class DeclarativeV2InertRepositoryCollisionV1Error extends Data.TaggedError(
  "DeclarativeV2InertRepositoryCollisionV1Error",
)<{
  readonly operation: "insertCandidate";
  readonly scopeId: string;
}> {}

export class DeclarativeV2InertRepositoryCorruptionV1Error extends Data.TaggedError(
  "DeclarativeV2InertRepositoryCorruptionV1Error",
)<{
  readonly operation: "insertCandidate" | "readCandidate";
  readonly reason:
    | "invalidMetadata"
    | "invalidStoredBytes"
    | "digestMismatch"
    | "normalizedMismatch";
  readonly codecCause?: DeclarativeV2PhysicalFrameV1Error;
}> {}

export class DeclarativeV2InertRepositoryConfirmedRollbackV1Error
  extends Data.TaggedError("DeclarativeV2InertRepositoryConfirmedRollbackV1Error")<{
    readonly operation: "insertCandidate" | "readCandidate";
    readonly cause: unknown;
  }> {}

export class DeclarativeV2InertRepositoryDecisionUncertainV1Error
  extends Data.TaggedError("DeclarativeV2InertRepositoryDecisionUncertainV1Error")<{
    readonly operation: "insertCandidate" | "readCandidate";
    readonly scopeId: string;
    readonly candidateSha256: Uint8Array;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class DeclarativeV2InertRepositoryResourceV1Error extends Data.TaggedError(
  "DeclarativeV2InertRepositoryResourceV1Error",
)<{
  readonly operation: "insertCandidate" | "readCandidate";
  readonly phase: "cleanup" | "infrastructure";
  readonly cause: LocatedReadCommittedTransactionFailureV1;
}> {}

export type DeclarativeV2InertRepositoryV1Error =
  | DeclarativeV2InertRepositoryInputV1Error
  | DeclarativeV2InertRepositoryCollisionV1Error
  | DeclarativeV2InertRepositoryCorruptionV1Error
  | DeclarativeV2InertRepositoryConfirmedRollbackV1Error
  | DeclarativeV2InertRepositoryDecisionUncertainV1Error
  | DeclarativeV2InertRepositoryResourceV1Error
  | DeclarativeV2Sha256V1Error;

export type DeclarativeV2CandidateInsertResultV1 = Readonly<{
  readonly kind: "inserted" | "replayed";
  readonly candidateSha256: Uint8Array;
  readonly usage: DeclarativeV2InertRepositoryUsageV1;
}>;

export type DeclarativeV2CandidateReadResultV1 =
  | Readonly<{
    readonly kind: "missing";
    readonly usage: DeclarativeV2InertRepositoryUsageV1;
  }>
  | Readonly<{
    readonly kind: "present";
    readonly candidateSha256: Uint8Array;
    readonly frame: DeclarativeV2CandidateFrameV1;
    readonly canonicalBytes: Uint8Array;
    readonly usage: DeclarativeV2InertRepositoryUsageV1;
  }>;

export interface DeclarativeV2InertRepositoryV1 {
  readonly insertCandidate: (
    input: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2CandidateInsertResultV1,
    DeclarativeV2InertRepositoryV1Error,
    never
  >;
  readonly readCandidate: (
    scopeId: unknown,
    candidateSha256: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2CandidateReadResultV1,
    DeclarativeV2InertRepositoryV1Error,
    never
  >;
}

type RepositoryOperationV1 = "insertCandidate" | "readCandidate";

type CandidateMetadataRowV1 = Readonly<{
  readonly scopeId: string;
  readonly candidateSha256: Uint8Array;
  readonly storageGeneration: string;
  readonly storageGenerationFence: bigint;
  readonly epoch: string;
  readonly frameCodecVersion: number;
  readonly frameByteLength: bigint;
  readonly frameSha256: Uint8Array;
}>;

class CandidateReplayCollisionV1 {
  readonly _tag = "CandidateReplayCollisionV1";

  constructor(readonly scopeId: string) {}
}

class CandidateBudgetFailureV1 {
  readonly _tag = "CandidateBudgetFailureV1";

  constructor(readonly error: DeclarativeV2InertRepositoryInputV1Error) {}
}

class CandidateStatementFailureV1 {
  readonly _tag = "CandidateStatementFailureV1";

  constructor(readonly cause: unknown) {}
}

export function makeDeclarativeV2InertRepositoryV1(
  target: LocatedReadCommittedAttemptTargetV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): DeclarativeV2InertRepositoryV1 {
  const insertCandidate = Effect.fn("DeclarativeV2.inertRepository.insertCandidate")(
    function* (input: unknown, rawBudget: unknown) {
      const budget = yield* Effect.fromResult(
        decodeBudget("insertCandidate", rawBudget),
      );
      const encoded = yield* Effect.fromResult(
        encodeDeclarativeV2PhysicalFrameV1(input, {
          maximumFrameBytes: budget.maximumFrameBytes,
          maximumCanonicalBytes: budget.maximumCanonicalBytes,
        }).pipe(
          Result.mapError(mapInsertCodecError),
        ),
      );
      const candidateFrame = yield* Effect.fromResult(
        encoded.frame.kind === "candidate"
          ? Result.succeed(encoded.frame)
          : Result.fail(new DeclarativeV2InertRepositoryInputV1Error({
            operation: "insertCandidate",
            reason: "invalidInput",
          })),
      );
      if (
        !isNonBlankString(candidateFrame.scopeId) ||
        !isNonBlankString(candidateFrame.scopeEpoch)
      ) {
        return yield* new DeclarativeV2InertRepositoryInputV1Error({
          operation: "insertCandidate",
          reason: "invalidInput",
        });
      }
      const scopeId = yield* Effect.fromResult(
        decodeScopeId(candidateFrame.scopeId).pipe(
          Result.mapError(() =>
            new DeclarativeV2InertRepositoryInputV1Error({
              operation: "insertCandidate",
              reason: "invalidInput",
            })
          ),
        ),
      );
      const epoch = yield* Effect.fromResult(
        decodeScopeEpoch(candidateFrame.scopeEpoch).pipe(
          Result.mapError(() =>
            new DeclarativeV2InertRepositoryInputV1Error({
              operation: "insertCandidate",
              reason: "invalidInput",
            })
          ),
        ),
      );
      const storageGeneration = yield* Effect.fromResult(
        decodeFlarexDbV1StorageGeneration(candidateFrame.storageGeneration).pipe(
          Result.mapError(() =>
            new DeclarativeV2InertRepositoryInputV1Error({
              operation: "insertCandidate",
              reason: "invalidInput",
            })
          ),
        ),
      );
      const initialUsage = Object.freeze({
        calls: 0,
        frameBytes: encoded.usage.frameBytes,
        canonicalBytes: encoded.usage.canonicalBytes,
        hashBytes: encoded.usage.frameBytes,
      });
      yield* requireUsageWithin("insertCandidate", budget, initialUsage);
      const candidateSha256 = yield* sha256(encoded.canonicalBytes, {
        maximumInputBytes: budget.maximumHashBytes,
      });
      const expectedFrameBytes = new Uint8Array(encoded.canonicalBytes);
      const expectedSha256 = new Uint8Array(candidateSha256);
      const tracker = mutableUsage(initialUsage);

      const kind = yield* runTransaction(
        target,
        "insertCandidate",
        Object.freeze({
          scopeId,
          candidateSha256: expectedSha256,
        }),
        async (tx) => {
          chargeCallOrThrow("insertCandidate", budget, tracker);
          const inserted = await runCandidateStatement(() =>
            tx
              .insert(fxSystemDeclarativeV2Candidates)
              .values({
                scopeId,
                candidateSha256: expectedSha256,
                storageGeneration,
                storageGenerationFence: candidateFrame.storageGenerationFence,
                epoch,
                frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
                frameByteLength: BigInt(expectedFrameBytes.byteLength),
                frameSha256: expectedSha256,
                frameBytes: expectedFrameBytes,
              })
              .onConflictDoNothing({
                target: [
                  fxSystemDeclarativeV2Candidates.scopeId,
                  fxSystemDeclarativeV2Candidates.candidateSha256,
                ],
              })
              .returning({
                candidateSha256:
                  fxSystemDeclarativeV2Candidates.candidateSha256,
              })
          );
          if (inserted.length === 1) return "inserted" as const;

          const metadata = await selectCandidateMetadata(
            tx,
            scopeId,
            expectedSha256,
            budget,
            tracker,
            "insertCandidate",
          );
          if (
            metadata === null ||
            !metadataMatchesExpected(metadata, encoded, expectedSha256)
          ) {
            throw new CandidateReplayCollisionV1(scopeId);
          }
          const storedBytes = await selectCandidateBytes(
            tx,
            scopeId,
            expectedSha256,
            budget,
            tracker,
            "insertCandidate",
            metadata.frameByteLength,
          );
          if (
            storedBytes === null ||
            !bytesEqualFullScan(storedBytes, expectedFrameBytes)
          ) {
            throw new CandidateReplayCollisionV1(scopeId);
          }
          return "replayed" as const;
        },
      );

      return Object.freeze({
        kind,
        candidateSha256: new Uint8Array(expectedSha256),
        usage: freezeUsage(tracker),
      });
    },
  );

  const readCandidate = Effect.fn("DeclarativeV2.inertRepository.readCandidate")(
    function* (
      rawScopeId: unknown,
      rawCandidateSha256: unknown,
      rawBudget: unknown,
    ) {
      const budget = yield* Effect.fromResult(
        decodeBudget("readCandidate", rawBudget),
      );
      if (
        !isNonBlankString(rawScopeId) ||
        !isUint8ArrayWithByteLength(
          rawCandidateSha256,
          DECLARATIVE_V2_SHA256_BYTES_V1,
        )
      ) {
        return yield* new DeclarativeV2InertRepositoryInputV1Error({
          operation: "readCandidate",
          reason: "invalidInput",
        });
      }
      const scopeId = yield* Effect.fromResult(
        decodeScopeId(rawScopeId).pipe(
          Result.mapError(() =>
            new DeclarativeV2InertRepositoryInputV1Error({
              operation: "readCandidate",
              reason: "invalidInput",
            })
          ),
        ),
      );
      const candidateSha256 = new Uint8Array(rawCandidateSha256);
      const tracker = mutableUsage();

      const stored = yield* runTransaction(
        target,
        "readCandidate",
        Object.freeze({
          scopeId,
          candidateSha256,
        }),
        async (tx) => {
          const metadata = await selectCandidateMetadata(
            tx,
            scopeId,
            candidateSha256,
            budget,
            tracker,
            "readCandidate",
          );
          if (metadata === null) return null;
          const bytes = await selectCandidateBytes(
            tx,
            scopeId,
            candidateSha256,
            budget,
            tracker,
            "readCandidate",
            metadata.frameByteLength,
          );
          if (bytes === null) {
            throw new DeclarativeV2InertRepositoryCorruptionV1Error({
              operation: "readCandidate",
              reason: "invalidStoredBytes",
            });
          }
          return Object.freeze({ metadata, bytes });
        },
      );
      if (stored === null) {
        return Object.freeze({
          kind: "missing" as const,
          usage: freezeUsage(tracker),
        });
      }

      const decoded = yield* Effect.fromResult(
        decodeDeclarativeV2PhysicalFrameV1(stored.bytes, {
          maximumFrameBytes:
            checkedRemaining(budget.maximumFrameBytes, tracker.frameBytes),
          maximumCanonicalBytes:
            checkedRemaining(
              budget.maximumCanonicalBytes,
              tracker.canonicalBytes,
            ),
        }).pipe(
          Result.mapError(codecCause =>
            new DeclarativeV2InertRepositoryCorruptionV1Error({
              operation: "readCandidate",
              reason: "invalidStoredBytes",
              codecCause,
            })
          ),
        ),
      );
      tracker.frameBytes += decoded.usage.frameBytes;
      tracker.canonicalBytes += decoded.usage.canonicalBytes;
      tracker.hashBytes += decoded.usage.frameBytes;
      yield* requireUsageWithin("readCandidate", budget, tracker);
      const observedSha256 = yield* sha256(decoded.canonicalBytes, {
        maximumInputBytes:
          checkedRemaining(
            budget.maximumHashBytes,
            tracker.hashBytes - decoded.usage.frameBytes,
          ),
      });
      if (
        !bytesEqualFullScan(observedSha256, stored.metadata.frameSha256) ||
        !bytesEqualFullScan(observedSha256, candidateSha256)
      ) {
        return yield* new DeclarativeV2InertRepositoryCorruptionV1Error({
          operation: "readCandidate",
          reason: "digestMismatch",
        });
      }
      if (
        decoded.frame.kind !== "candidate" ||
        !metadataMatchesExpected(
          stored.metadata,
          decoded,
          candidateSha256,
        )
      ) {
        return yield* new DeclarativeV2InertRepositoryCorruptionV1Error({
          operation: "readCandidate",
          reason: "normalizedMismatch",
        });
      }
      return Object.freeze({
        kind: "present" as const,
        candidateSha256: new Uint8Array(candidateSha256),
        frame: decoded.frame,
        canonicalBytes: new Uint8Array(decoded.canonicalBytes),
        usage: freezeUsage(tracker),
      });
    },
  );

  return Object.freeze({ insertCandidate, readCandidate });
}

function decodeBudget(
  operation: RepositoryOperationV1,
  value: unknown,
): Result.Result<
  Readonly<DeclarativeV2InertRepositoryBudgetV1>,
  DeclarativeV2InertRepositoryInputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    Object.keys(value).length !== 4 ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return Result.fail(new DeclarativeV2InertRepositoryInputV1Error({
      operation,
      reason: "invalidBudget",
    }));
  }
  const maximumCalls = ownDataValue(value, "maximumCalls");
  const maximumFrameBytes = ownDataValue(value, "maximumFrameBytes");
  const maximumCanonicalBytes = ownDataValue(
    value,
    "maximumCanonicalBytes",
  );
  const maximumHashBytes = ownDataValue(value, "maximumHashBytes");
  if (
    !isNonNegativeSafeInteger(maximumCalls) ||
    !isNonNegativeSafeInteger(maximumFrameBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes) ||
    !isNonNegativeSafeInteger(maximumHashBytes)
  ) {
    return Result.fail(new DeclarativeV2InertRepositoryInputV1Error({
      operation,
      reason: "invalidBudget",
    }));
  }
  return Result.succeed(Object.freeze({
    maximumCalls,
    maximumFrameBytes,
    maximumCanonicalBytes,
    maximumHashBytes,
  }));
}

function requireUsageWithin(
  operation: RepositoryOperationV1,
  budget: DeclarativeV2InertRepositoryBudgetV1,
  usage: DeclarativeV2InertRepositoryUsageV1,
): Effect.Effect<void, DeclarativeV2InertRepositoryInputV1Error> {
  for (const dimension of USAGE_DIMENSIONS) {
    const observed = usage[dimension];
    const maximum = budget[BUDGET_BY_USAGE[dimension]];
    if (observed > maximum) {
      return Effect.fail(new DeclarativeV2InertRepositoryInputV1Error({
        operation,
        reason: "budgetExceeded",
        dimension,
        observed,
        maximum,
      }));
    }
  }
  return Effect.void;
}

const USAGE_DIMENSIONS = [
  "calls",
  "frameBytes",
  "canonicalBytes",
  "hashBytes",
] as const;

const BUDGET_BY_USAGE = {
  calls: "maximumCalls",
  frameBytes: "maximumFrameBytes",
  canonicalBytes: "maximumCanonicalBytes",
  hashBytes: "maximumHashBytes",
} as const satisfies Readonly<Record<
  keyof DeclarativeV2InertRepositoryUsageV1,
  keyof DeclarativeV2InertRepositoryBudgetV1
>>;

function mutableUsage(
  initial: DeclarativeV2InertRepositoryUsageV1 = {
    calls: 0,
    frameBytes: 0,
    canonicalBytes: 0,
    hashBytes: 0,
  },
): {
  calls: number;
  frameBytes: number;
  canonicalBytes: number;
  hashBytes: number;
} {
  return { ...initial };
}

function freezeUsage(
  usage: DeclarativeV2InertRepositoryUsageV1,
): Readonly<DeclarativeV2InertRepositoryUsageV1> {
  return Object.freeze({
    calls: usage.calls,
    frameBytes: usage.frameBytes,
    canonicalBytes: usage.canonicalBytes,
    hashBytes: usage.hashBytes,
  });
}

function checkedRemaining(maximum: number, used: number): number {
  return used >= maximum ? 0 : maximum - used;
}

function chargeCallOrThrow(
  operation: RepositoryOperationV1,
  budget: DeclarativeV2InertRepositoryBudgetV1,
  usage: { calls: number },
): void {
  const observed = usage.calls + 1;
  if (!Number.isSafeInteger(observed) || observed > budget.maximumCalls) {
    throw new CandidateBudgetFailureV1(
      new DeclarativeV2InertRepositoryInputV1Error({
        operation,
        reason: "budgetExceeded",
        dimension: "calls",
        observed,
        maximum: budget.maximumCalls,
      }),
    );
  }
  usage.calls = observed;
}

async function selectCandidateMetadata(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  candidateSha256: Uint8Array,
  budget: DeclarativeV2InertRepositoryBudgetV1,
  usage: { calls: number },
  operation: RepositoryOperationV1,
): Promise<CandidateMetadataRowV1 | null> {
  chargeCallOrThrow(operation, budget, usage);
  const rows = await runCandidateStatement(() =>
    tx
      .select({
        scopeId: fxSystemDeclarativeV2Candidates.scopeId,
        candidateSha256: fxSystemDeclarativeV2Candidates.candidateSha256,
        storageGeneration: fxSystemDeclarativeV2Candidates.storageGeneration,
        storageGenerationFence:
          fxSystemDeclarativeV2Candidates.storageGenerationFence,
        epoch: fxSystemDeclarativeV2Candidates.epoch,
        frameCodecVersion:
          fxSystemDeclarativeV2Candidates.frameCodecVersion,
        frameByteLength: fxSystemDeclarativeV2Candidates.frameByteLength,
        frameSha256: fxSystemDeclarativeV2Candidates.frameSha256,
      })
      .from(fxSystemDeclarativeV2Candidates)
      .where(and(
        eq(fxSystemDeclarativeV2Candidates.scopeId, scopeId),
        eq(
          fxSystemDeclarativeV2Candidates.candidateSha256,
          candidateSha256,
        ),
      ))
      .limit(1)
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (
    typeof row.scopeId !== "string" ||
    !isUint8Array(row.candidateSha256) ||
    typeof row.storageGeneration !== "string" ||
    typeof row.storageGenerationFence !== "bigint" ||
    typeof row.epoch !== "string" ||
    typeof row.frameCodecVersion !== "number" ||
    typeof row.frameByteLength !== "bigint" ||
    !isUint8Array(row.frameSha256)
  ) {
    throw new DeclarativeV2InertRepositoryCorruptionV1Error({
      operation,
      reason: "invalidMetadata",
    });
  }
  return Object.freeze({
    scopeId: row.scopeId,
    candidateSha256: new Uint8Array(row.candidateSha256),
    storageGeneration: row.storageGeneration,
    storageGenerationFence: row.storageGenerationFence,
    epoch: row.epoch,
    frameCodecVersion: row.frameCodecVersion,
    frameByteLength: row.frameByteLength,
    frameSha256: new Uint8Array(row.frameSha256),
  });
}

async function selectCandidateBytes(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  candidateSha256: Uint8Array,
  budget: DeclarativeV2InertRepositoryBudgetV1,
  usage: {
    calls: number;
    frameBytes: number;
  },
  operation: RepositoryOperationV1,
  frameByteLength: bigint,
): Promise<Uint8Array | null> {
  if (frameByteLength < 1n) {
    throw new DeclarativeV2InertRepositoryCorruptionV1Error({
      operation,
      reason: "invalidMetadata",
    });
  }
  if (
    frameByteLength > BigInt(checkedRemaining(
      budget.maximumFrameBytes,
      usage.frameBytes,
    ))
  ) {
    if (frameByteLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new DeclarativeV2InertRepositoryCorruptionV1Error({
        operation,
        reason: "invalidMetadata",
      });
    }
    const observed = Number(frameByteLength);
    throw new CandidateBudgetFailureV1(
      new DeclarativeV2InertRepositoryInputV1Error({
        operation,
        reason: "budgetExceeded",
        dimension: "frameBytes",
        observed,
        maximum: budget.maximumFrameBytes,
      }),
    );
  }
  chargeCallOrThrow(operation, budget, usage);
  const rows = await runCandidateStatement(() =>
    tx
      .select({ frameBytes: fxSystemDeclarativeV2Candidates.frameBytes })
      .from(fxSystemDeclarativeV2Candidates)
      .where(and(
        eq(fxSystemDeclarativeV2Candidates.scopeId, scopeId),
        eq(
          fxSystemDeclarativeV2Candidates.candidateSha256,
          candidateSha256,
        ),
      ))
      .limit(1)
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (!isUint8Array(row.frameBytes)) {
    throw new DeclarativeV2InertRepositoryCorruptionV1Error({
      operation,
      reason: "invalidStoredBytes",
    });
  }
  const bytes = new Uint8Array(row.frameBytes);
  if (BigInt(bytes.byteLength) !== frameByteLength) {
    throw new DeclarativeV2InertRepositoryCorruptionV1Error({
      operation,
      reason: "invalidStoredBytes",
    });
  }
  usage.frameBytes += bytes.byteLength;
  return bytes;
}

function metadataMatchesExpected(
  metadata: CandidateMetadataRowV1,
  encoded: DeclarativeV2EncodedFrameV1,
  expectedSha256: Uint8Array,
): boolean {
  return encoded.frame.kind === "candidate" &&
    metadata.scopeId === encoded.frame.scopeId &&
    metadata.storageGeneration === encoded.frame.storageGeneration &&
    metadata.storageGenerationFence === encoded.frame.storageGenerationFence &&
    metadata.epoch === encoded.frame.scopeEpoch &&
    metadata.frameCodecVersion === DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 &&
    metadata.frameByteLength === BigInt(encoded.canonicalBytes.byteLength) &&
    bytesEqualFullScan(metadata.candidateSha256, expectedSha256) &&
    bytesEqualFullScan(metadata.frameSha256, expectedSha256);
}

function runTransaction<ResultValue>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: RepositoryOperationV1,
  observation: Readonly<{
    readonly scopeId: string;
    readonly candidateSha256: Uint8Array;
  }>,
  work: (tx: AppRowTransaction) => Promise<ResultValue>,
): Effect.Effect<
  ResultValue,
  DeclarativeV2InertRepositoryV1Error,
  never
> {
  return Effect.tryPromise({
    try: () =>
      target[RUN_LOCATED_READ_COMMITTED_V1](work) as Promise<ResultValue>,
    catch: (cause): DeclarativeV2InertRepositoryV1Error => {
      if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
        switch (cause.issue.kind) {
          case "callbackRolledBack": {
            const callbackCause = cause.issue.callbackCause;
            if (
              callbackCause instanceof DeclarativeV2InertRepositoryInputV1Error ||
              callbackCause instanceof DeclarativeV2InertRepositoryCorruptionV1Error
            ) {
              return callbackCause;
            }
            if (callbackCause instanceof CandidateBudgetFailureV1) {
              return callbackCause.error;
            }
            if (callbackCause instanceof CandidateReplayCollisionV1) {
              return new DeclarativeV2InertRepositoryCollisionV1Error({
                operation: "insertCandidate",
                scopeId: callbackCause.scopeId,
              });
            }
            if (callbackCause instanceof CandidateStatementFailureV1) {
              return new DeclarativeV2InertRepositoryConfirmedRollbackV1Error({
                operation,
                cause: callbackCause.cause,
              });
            }
            throw callbackCause;
          }
          case "decisionUncertain":
            return new DeclarativeV2InertRepositoryDecisionUncertainV1Error({
              operation,
              scopeId: observation.scopeId,
              candidateSha256: new Uint8Array(observation.candidateSha256),
              cause,
            });
          case "callbackCleanupFailed":
            return new DeclarativeV2InertRepositoryResourceV1Error({
              operation,
              phase: "cleanup",
              cause,
            });
          case "infrastructureFailure":
            return new DeclarativeV2InertRepositoryResourceV1Error({
              operation,
              phase: "infrastructure",
              cause,
            });
        }
      }
      throw cause;
    },
  });
}

async function runCandidateStatement<ResultValue>(
  statement: () => PromiseLike<ResultValue>,
): Promise<ResultValue> {
  const result = statement();
  try {
    return await result;
  } catch (cause) {
    throw new CandidateStatementFailureV1(cause);
  }
}

const decodeScopeId = Schema.decodeUnknownResult(Schema.toType(ScopeIdSchema));
const decodeScopeEpoch = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeFlarexDbV1StorageGeneration = Schema.decodeUnknownResult(
  Schema.toType(FlarexDbV1StorageGenerationSchema),
);

function ownDataValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function mapInsertCodecError(
  codecCause: DeclarativeV2PhysicalFrameV1Error,
): DeclarativeV2InertRepositoryInputV1Error {
  if (
    codecCause.reason === "frameBytesExceeded" ||
    codecCause.reason === "canonicalBytesExceeded"
  ) {
    const observed = codecCause.observed;
    const maximum = codecCause.maximum;
    if (observed === undefined || maximum === undefined) {
      throw codecCause;
    }
    return new DeclarativeV2InertRepositoryInputV1Error({
      operation: "insertCandidate",
      reason: "budgetExceeded",
      dimension: codecCause.reason === "frameBytesExceeded"
        ? "frameBytes"
        : "canonicalBytes",
      observed,
      maximum,
      codecCause,
    });
  }
  return new DeclarativeV2InertRepositoryInputV1Error({
    operation: "insertCandidate",
    reason: codecCause.reason === "invalidBudget"
      ? "invalidBudget"
      : "invalidInput",
    codecCause,
  });
}

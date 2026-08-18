import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Clock, Data, Effect, Result, Schema } from "effect";
import {
  CommitSeqSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import {
  compactRetainedAppRowHistoryPageEffect,
  createRetainedAppRowHistoryCompactionPort,
  type CompactRetainedAppRowHistoryPageError,
  type GuardedRetainedAppRowHistoryCompactionResult,
  type RetainedAppRowHistoryCompactionPort,
  type RetainedAppRowHistoryCursor,
} from "./retainedAppRowHistoryCompaction";
import {
  compactRetainedCommitHistoryPageEffect,
  createRetainedCommitHistoryCompactionPort,
  type CompactRetainedCommitHistoryPageError,
  type GuardedRetainedCommitHistoryCompactionResult,
  type RetainedCommitHistoryCompactionPort,
} from "./retainedCommitHistoryCompaction";
import {
  type LocatedRetainedHistoryFloorTarget,
} from "./retainedHistoryFloorObservation";
import type { RetainedHistoryPageExpectation } from
  "./retainedHistoryPageGuard";
import {
  compactRetainedIndexHistoryPageEffect,
  createRetainedIndexHistoryCompactionPort,
  type CompactRetainedIndexHistoryPageError,
  type GuardedRetainedIndexHistoryCompactionResult,
  type RetainedIndexHistoryCompactionPort,
  type RetainedIndexHistoryCursor,
} from "./retainedIndexHistoryCompaction";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "./scopePhysicalLocator";
import {
  type RetainedHistoryMaintenanceContinuationEvidenceV1,
} from "./retainedHistoryMaintenanceContinuationEvidenceV1";

export const MAX_RETAINED_HISTORY_MAINTENANCE_PAGES_PER_RUN = 1_024;
export const MAX_RETAINED_HISTORY_MAINTENANCE_ELAPSED_MILLISECONDS = 60_000;

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const retainedHistoryMaintenancePortBrand: unique symbol = Symbol(
  "FlarexDB/retainedHistoryMaintenancePort",
);
const retainedHistoryMaintenanceContinuationBrand: unique symbol = Symbol(
  "FlarexDB/retainedHistoryMaintenanceContinuation",
);

export interface RetainedHistoryMaintenancePolicy {
  readonly maximumPages: number;
  readonly maximumElapsedMilliseconds: number;
}

interface CapturedRetainedHistoryMaintenancePolicy extends
  RetainedHistoryMaintenancePolicy {
  readonly maximumElapsedNanoseconds: bigint;
}

export class RetainedHistoryMaintenanceConfigurationError extends
  Data.TaggedError("RetainedHistoryMaintenanceConfigurationError")<{
    readonly reason: "invalidPolicy";
  }> {}

export interface RetainedHistoryMaintenancePort {
  readonly [retainedHistoryMaintenancePortBrand]: true;
}

type RetainedHistoryMaintenancePhase =
  | Readonly<{ readonly kind: "commitHistory" }>
  | Readonly<{
      readonly kind: "indexHistory";
      readonly cursor: RetainedIndexHistoryCursor;
    }>
  | Readonly<{
      readonly kind: "appRowHistory";
      readonly cursor: RetainedAppRowHistoryCursor;
    }>;

export interface RetainedHistoryMaintenanceContinuation {
  readonly [retainedHistoryMaintenanceContinuationBrand]: true;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly retainedFloor: CommitSeq;
  readonly phase: RetainedHistoryMaintenancePhase["kind"];
}

export const inspectRetainedHistoryMaintenanceContinuationEffect = Effect.fn(
  "RetainedHistoryMaintenance.inspectContinuation",
)(function* (
  port: RetainedHistoryMaintenancePort,
  continuation: RetainedHistoryMaintenanceContinuation,
): Effect.fn.Return<
  RetainedHistoryMaintenanceContinuationEvidenceV1,
  RetainedHistoryMaintenanceError
> {
  const state = yield* captureContinuationEffect(
    port,
    continuation.deploymentId,
    continuation,
  );
  if (state === null) {
    return yield* new RetainedHistoryMaintenanceError({
      reason: "invalidContinuation",
      deploymentId: continuation.deploymentId,
      scopeId: continuation.scopeId,
    });
  }
  return continuationEvidence(state);
});

export const restoreRetainedHistoryMaintenanceContinuationEffect = Effect.fn(
  "RetainedHistoryMaintenance.restoreContinuation",
)((
  port: RetainedHistoryMaintenancePort,
  evidence: RetainedHistoryMaintenanceContinuationEvidenceV1,
): Effect.Effect<
  RetainedHistoryMaintenanceContinuation,
  RetainedHistoryMaintenanceError
> => Effect.fromResult(restoreContinuationResult(port, evidence)));

interface RetainedHistoryMaintenancePortState {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly commitHistory: RetainedCommitHistoryCompactionPort;
  readonly indexHistory: RetainedIndexHistoryCompactionPort;
  readonly appRowHistory: RetainedAppRowHistoryCompactionPort;
  readonly policy: CapturedRetainedHistoryMaintenancePolicy;
}

interface RetainedHistoryMaintenanceContinuationState {
  readonly issuer: RetainedHistoryMaintenancePort;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly retainedFloor: CommitSeq;
  readonly authority: RetainedHistoryMaintenanceAuthorityPin;
  readonly phase: RetainedHistoryMaintenancePhase;
}

type RetainedHistoryMaintenanceAuthorityPin = Omit<
  RetainedHistoryPageExpectation,
  "retainedFloor"
>;

const portStates = new WeakMap<
  RetainedHistoryMaintenancePort,
  RetainedHistoryMaintenancePortState
>();
const continuationStates = new WeakMap<
  RetainedHistoryMaintenanceContinuation,
  RetainedHistoryMaintenanceContinuationState
>();

const decodeEvidenceCommitSeqResult = Schema.decodeUnknownResult(
  CommitSeqSchema,
);
const decodeEvidenceStorageGenerationFenceResult = Schema.decodeUnknownResult(
  StorageGenerationFenceSchema,
);

/**
 * Creates one private, lifecycle-free O11-E maintenance operation. The three
 * owner ports are derived from one captured authority graph and cannot be
 * supplied independently.
 */
export function createRetainedHistoryMaintenancePort(input: {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly policy: RetainedHistoryMaintenancePolicy;
}): Result.Result<
  RetainedHistoryMaintenancePort,
  RetainedHistoryMaintenanceConfigurationError
> {
  const authorityInput = input.authority;
  const policyInput = input.policy;
  return capturePolicyResult(policyInput).pipe(Result.map((policy) => {
    const authority = captureTrustedScopeAuthorityResolutionPorts(
      authorityInput,
    );
    const port = Object.freeze({
      [retainedHistoryMaintenancePortBrand]: true as const,
    });
    portStates.set(port, Object.freeze({
      authority,
      commitHistory: createRetainedCommitHistoryCompactionPort({ authority }),
      indexHistory: createRetainedIndexHistoryCompactionPort({ authority }),
      appRowHistory: createRetainedAppRowHistoryCompactionPort({ authority }),
      policy,
    }));
    return port;
  }));
}

export type RetainedHistoryMaintenanceStopReason =
  | "exhausted"
  | "pageBudget"
  | "timeBudget"
  | "floorAdvanced"
  | "authorityChanged";

export interface RetainedHistoryMaintenanceReceipt {
  readonly status: "maintenanceComplete" | "maintenancePaused";
  readonly stopReason: RetainedHistoryMaintenanceStopReason;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly retainedFloor: CommitSeq;
  readonly elapsedMilliseconds: number;
  readonly pagesExecuted: number;
  readonly commitPagesExecuted: number;
  readonly indexPagesExecuted: number;
  readonly appRowPagesExecuted: number;
  readonly deletedCommitCount: number;
  readonly deletedChangeCount: number;
  readonly deletedIndexRevisionCount: number;
  readonly deletedAppRowRevisionCount: number;
  readonly continuation: RetainedHistoryMaintenanceContinuation | null;
}

export class RetainedHistoryMaintenanceError extends Data.TaggedError(
  "RetainedHistoryMaintenanceError",
)<{
  readonly reason:
    | "invalidPort"
    | "invalidContinuation"
    | "continuationIssuerMismatch"
    | "continuationDeploymentMismatch"
    | "ownerDeploymentMismatch"
    | "ownerScopeMismatch"
    | "retainedFloorRegressed";
  readonly deploymentId: string;
  readonly scopeId?: ScopeId;
  readonly expectedRetainedFloor?: CommitSeq;
  readonly actualRetainedFloor?: CommitSeq;
}> {}

export type RunRetainedHistoryMaintenanceError =
  | RetainedHistoryMaintenanceError
  | CompactRetainedCommitHistoryPageError
  | CompactRetainedIndexHistoryPageError
  | CompactRetainedAppRowHistoryPageError;

interface Counters {
  pagesExecuted: number;
  commitPagesExecuted: number;
  indexPagesExecuted: number;
  appRowPagesExecuted: number;
  deletedCommitCount: number;
  deletedChangeCount: number;
  deletedIndexRevisionCount: number;
  deletedAppRowRevisionCount: number;
}

interface RunPin {
  readonly scopeId: ScopeId;
  readonly retainedFloor: CommitSeq;
}

interface ReceiptContinuationState {
  readonly phase: RetainedHistoryMaintenancePhase;
  readonly authority: RetainedHistoryMaintenanceAuthorityPin;
}

type OwnerResult =
  | Readonly<{
      readonly owner: "commitHistory";
      readonly result: GuardedRetainedCommitHistoryCompactionResult;
    }>
  | Readonly<{
      readonly owner: "indexHistory";
      readonly result: GuardedRetainedIndexHistoryCompactionResult;
    }>
  | Readonly<{
      readonly owner: "appRowHistory";
      readonly result: GuardedRetainedAppRowHistoryCompactionResult;
    }>;

export const runRetainedHistoryMaintenanceEffect = Effect.fn(
  "RetainedHistoryMaintenance.run",
)(function* (
  port: RetainedHistoryMaintenancePort,
  deploymentId: string,
  continuation: RetainedHistoryMaintenanceContinuation | null,
): Effect.fn.Return<
  RetainedHistoryMaintenanceReceipt,
  RunRetainedHistoryMaintenanceError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "invalidPort",
      deploymentId,
    }));
  }
  const resumed = yield* captureContinuationEffect(
    port,
    deploymentId,
    continuation,
  );
  const initialAuthority = captureAuthorityPin((yield*
    resolveLocatedTrustedScopeAuthorityEffect(
      deploymentId,
      state.authority,
    )).authority);
  if (
    resumed !== null &&
    !authorityPinsEqual(resumed.authority, initialAuthority)
  ) {
    return makeReceipt(
      port,
      "maintenancePaused",
      "authorityChanged",
      deploymentId,
      Object.freeze({
        scopeId: resumed.scopeId,
        retainedFloor: resumed.retainedFloor,
      }),
      0,
      emptyCounters(),
      null,
    );
  }
  let phase = resumed?.phase ?? commitPhase();
  let pin: RunPin | null = resumed === null
    ? null
    : Object.freeze({
        scopeId: resumed.scopeId,
        retainedFloor: resumed.retainedFloor,
      });
  let authorityPin = initialAuthority;
  const counters = emptyCounters();
  const startedAt = yield* Clock.currentTimeNanos;

  while (true) {
    if (counters.pagesExecuted >= state.policy.maximumPages) {
      const observedAt = yield* Clock.currentTimeNanos;
      return yield* makePausedReceiptEffect(
        port,
        deploymentId,
        "pageBudget",
        startedAt,
        observedAt,
        counters,
        pin,
        phase,
        authorityPin,
      );
    }
    if (counters.pagesExecuted > 0) {
      const observedAt = yield* Clock.currentTimeNanos;
      if (
        observedAt - startedAt >= state.policy.maximumElapsedNanoseconds
      ) {
        return yield* makePausedReceiptEffect(
          port,
          deploymentId,
          "timeBudget",
          startedAt,
          observedAt,
          counters,
          pin,
          phase,
          authorityPin,
        );
      }
    }

    const ownerResult = yield* runOwnerPageEffect(
      state,
      deploymentId,
      phase,
      pin === null ? null : pageExpectation(authorityPin, pin.retainedFloor),
    );
    chargeOwnerResult(counters, ownerResult);
    if (
      ownerResult.result.disposition === "guardChanged" &&
      ownerResult.result.reason === "authorityChanged"
    ) {
      const observedAt = yield* Clock.currentTimeNanos;
      return makeReceipt(
        port,
        "maintenancePaused",
        "authorityChanged",
        deploymentId,
        Object.freeze({
          scopeId: ownerResult.result.scopeId,
          retainedFloor: ownerResult.result.retainedFloor,
        }),
        elapsedMilliseconds(startedAt, observedAt),
        counters,
        null,
      );
    }
    const nextPin = yield* requireOwnerPinEffect(
      deploymentId,
      pin,
      ownerResult.result,
    );
    const currentAuthority = captureAuthorityPin((yield*
      resolveLocatedTrustedScopeAuthorityEffect(
        deploymentId,
        state.authority,
      )).authority);
    if (!authorityPinsEqual(authorityPin, currentAuthority)) {
      const observedAt = yield* Clock.currentTimeNanos;
      return makeReceipt(
        port,
        "maintenancePaused",
        "authorityChanged",
        deploymentId,
        nextPin,
        elapsedMilliseconds(startedAt, observedAt),
        counters,
        null,
      );
    }
    authorityPin = currentAuthority;
    if (ownerResult.result.disposition === "guardChanged") {
      const observedAt = yield* Clock.currentTimeNanos;
      return makeReceipt(
        port,
        "maintenancePaused",
        "floorAdvanced",
        deploymentId,
        nextPin,
        elapsedMilliseconds(startedAt, observedAt),
        counters,
        Object.freeze({ phase: commitPhase(), authority: authorityPin }),
      );
    }
    pin = nextPin;

    switch (ownerResult.owner) {
      case "commitHistory":
        phase = ownerResult.result.disposition === "exhausted"
          ? indexPhase({ kind: "start" })
          : commitPhase();
        break;
      case "indexHistory":
        phase = ownerResult.result.disposition === "exhausted"
          ? appRowPhase({ kind: "start" })
          : indexPhase(ownerResult.result.continuation);
        break;
      case "appRowHistory":
        if (ownerResult.result.disposition === "exhausted") {
          const observedAt = yield* Clock.currentTimeNanos;
          return makeReceipt(
            port,
            "maintenanceComplete",
            "exhausted",
            deploymentId,
            pin,
            elapsedMilliseconds(startedAt, observedAt),
            counters,
            null,
          );
        }
        phase = appRowPhase(ownerResult.result.continuation);
        break;
    }
  }
});

function capturePolicyResult(
  input: RetainedHistoryMaintenancePolicy,
): Result.Result<
  CapturedRetainedHistoryMaintenancePolicy,
  RetainedHistoryMaintenanceConfigurationError
> {
  const maximumPages = input.maximumPages;
  const maximumElapsedMilliseconds = input.maximumElapsedMilliseconds;
  if (
    !isPositiveSafeInteger(maximumPages) ||
    maximumPages > MAX_RETAINED_HISTORY_MAINTENANCE_PAGES_PER_RUN ||
    !isPositiveSafeInteger(maximumElapsedMilliseconds) ||
    maximumElapsedMilliseconds >
      MAX_RETAINED_HISTORY_MAINTENANCE_ELAPSED_MILLISECONDS
  ) {
    return Result.fail(new RetainedHistoryMaintenanceConfigurationError({
      reason: "invalidPolicy",
    }));
  }
  return Result.succeed(Object.freeze({
    maximumPages,
    maximumElapsedMilliseconds,
    maximumElapsedNanoseconds:
      BigInt(maximumElapsedMilliseconds) * NANOSECONDS_PER_MILLISECOND,
  }));
}

function captureContinuationEffect(
  port: RetainedHistoryMaintenancePort,
  deploymentId: string,
  continuation: RetainedHistoryMaintenanceContinuation | null,
): Effect.Effect<
  RetainedHistoryMaintenanceContinuationState | null,
  RetainedHistoryMaintenanceError
> {
  if (continuation === null) return Effect.succeed(null);
  const state = continuationStates.get(continuation);
  if (state === undefined) {
    return Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "invalidContinuation",
      deploymentId,
    }));
  }
  if (state.issuer !== port) {
    return Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "continuationIssuerMismatch",
      deploymentId,
      scopeId: state.scopeId,
    }));
  }
  if (state.deploymentId !== deploymentId) {
    return Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "continuationDeploymentMismatch",
      deploymentId,
      scopeId: state.scopeId,
    }));
  }
  return Effect.succeed(state);
}

function runOwnerPageEffect(
  state: RetainedHistoryMaintenancePortState,
  deploymentId: string,
  phase: RetainedHistoryMaintenancePhase,
  expectation: RetainedHistoryPageExpectation | null,
): Effect.Effect<OwnerResult, RunRetainedHistoryMaintenanceError> {
  switch (phase.kind) {
    case "commitHistory": {
      const page = expectation === null
        ? compactRetainedCommitHistoryPageEffect(
            state.commitHistory,
            deploymentId,
          )
        : compactRetainedCommitHistoryPageEffect(
            state.commitHistory,
            deploymentId,
            expectation,
          );
      return page.pipe(Effect.map(result => Object.freeze({
        owner: "commitHistory" as const,
        result,
      })));
    }
    case "indexHistory": {
      const page = expectation === null
        ? compactRetainedIndexHistoryPageEffect(
            state.indexHistory,
            deploymentId,
            phase.cursor,
          )
        : compactRetainedIndexHistoryPageEffect(
            state.indexHistory,
            deploymentId,
            phase.cursor,
            expectation,
          );
      return page.pipe(Effect.map(result => Object.freeze({
        owner: "indexHistory" as const,
        result,
      })));
    }
    case "appRowHistory": {
      const page = expectation === null
        ? compactRetainedAppRowHistoryPageEffect(
            state.appRowHistory,
            deploymentId,
            phase.cursor,
          )
        : compactRetainedAppRowHistoryPageEffect(
            state.appRowHistory,
            deploymentId,
            phase.cursor,
            expectation,
          );
      return page.pipe(Effect.map(result => Object.freeze({
        owner: "appRowHistory" as const,
        result,
      })));
    }
  }
}

function chargeOwnerResult(
  counters: Counters,
  ownerResult: OwnerResult,
): void {
  counters.pagesExecuted += 1;
  switch (ownerResult.owner) {
    case "commitHistory":
      counters.commitPagesExecuted += 1;
      if (ownerResult.result.disposition === "deleted") {
        counters.deletedCommitCount += 1;
        counters.deletedChangeCount += ownerResult.result.deletedChangeCount;
      }
      break;
    case "indexHistory":
      counters.indexPagesExecuted += 1;
      if (ownerResult.result.disposition === "deleted") {
        counters.deletedIndexRevisionCount +=
          ownerResult.result.deletedRevisionCount;
      }
      break;
    case "appRowHistory":
      counters.appRowPagesExecuted += 1;
      if (ownerResult.result.disposition === "deleted") {
        counters.deletedAppRowRevisionCount +=
          ownerResult.result.deletedRevisionCount;
      }
      break;
  }
}

function requireOwnerPinEffect(
  deploymentId: string,
  expected: RunPin | null,
  result: OwnerResult["result"],
): Effect.Effect<RunPin, RetainedHistoryMaintenanceError> {
  if (result.deploymentId !== deploymentId) {
    return Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "ownerDeploymentMismatch",
      deploymentId,
      scopeId: result.scopeId,
    }));
  }
  if (expected === null) {
    return Effect.succeed(Object.freeze({
      scopeId: result.scopeId,
      retainedFloor: result.retainedFloor,
    }));
  }
  if (result.scopeId !== expected.scopeId) {
    return Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "ownerScopeMismatch",
      deploymentId,
      scopeId: result.scopeId,
      expectedRetainedFloor: expected.retainedFloor,
      actualRetainedFloor: result.retainedFloor,
    }));
  }
  if (result.retainedFloor < expected.retainedFloor) {
    return Effect.fail(new RetainedHistoryMaintenanceError({
      reason: "retainedFloorRegressed",
      deploymentId,
      scopeId: result.scopeId,
      expectedRetainedFloor: expected.retainedFloor,
      actualRetainedFloor: result.retainedFloor,
    }));
  }
  return Effect.succeed(Object.freeze({
    scopeId: result.scopeId,
    retainedFloor: result.retainedFloor,
  }));
}

function makePausedReceiptEffect(
  port: RetainedHistoryMaintenancePort,
  deploymentId: string,
  reason: "pageBudget" | "timeBudget",
  startedAt: bigint,
  observedAt: bigint,
  counters: Counters,
  pin: RunPin | null,
  phase: RetainedHistoryMaintenancePhase,
  authority: RetainedHistoryMaintenanceAuthorityPin,
): Effect.Effect<
  RetainedHistoryMaintenanceReceipt,
  RetainedHistoryMaintenanceError
> {
  return pin === null
    ? Effect.fail(new RetainedHistoryMaintenanceError({
        reason: "invalidContinuation",
        deploymentId,
      }))
    : Effect.succeed(makeReceipt(
        port,
        "maintenancePaused",
        reason,
        deploymentId,
        pin,
        elapsedMilliseconds(startedAt, observedAt),
        counters,
        Object.freeze({ phase, authority }),
      ));
}

function makeReceipt(
  port: RetainedHistoryMaintenancePort,
  status: RetainedHistoryMaintenanceReceipt["status"],
  stopReason: RetainedHistoryMaintenanceStopReason,
  deploymentId: string,
  pin: RunPin,
  elapsed: number,
  counters: Counters,
  continuationState: ReceiptContinuationState | null,
): RetainedHistoryMaintenanceReceipt {
  return Object.freeze({
    status,
    stopReason,
    deploymentId,
    scopeId: pin.scopeId,
    retainedFloor: pin.retainedFloor,
    elapsedMilliseconds: elapsed,
    pagesExecuted: counters.pagesExecuted,
    commitPagesExecuted: counters.commitPagesExecuted,
    indexPagesExecuted: counters.indexPagesExecuted,
    appRowPagesExecuted: counters.appRowPagesExecuted,
    deletedCommitCount: counters.deletedCommitCount,
    deletedChangeCount: counters.deletedChangeCount,
    deletedIndexRevisionCount: counters.deletedIndexRevisionCount,
    deletedAppRowRevisionCount: counters.deletedAppRowRevisionCount,
    continuation: continuationState === null
      ? null
      : makeContinuation(
          port,
          deploymentId,
          pin,
          continuationState.phase,
          continuationState.authority,
        ),
  });
}

function makeContinuation(
  port: RetainedHistoryMaintenancePort,
  deploymentId: string,
  pin: RunPin,
  phase: RetainedHistoryMaintenancePhase,
  authority: RetainedHistoryMaintenanceAuthorityPin,
): RetainedHistoryMaintenanceContinuation {
  const capturedPhase = capturePhase(phase);
  const continuation = Object.freeze({
    [retainedHistoryMaintenanceContinuationBrand]: true as const,
    deploymentId,
    scopeId: pin.scopeId,
    retainedFloor: pin.retainedFloor,
    phase: capturedPhase.kind,
  });
  continuationStates.set(continuation, Object.freeze({
    issuer: port,
    deploymentId,
    scopeId: pin.scopeId,
    retainedFloor: pin.retainedFloor,
    authority,
    phase: capturedPhase,
  }));
  return continuation;
}

function continuationEvidence(
  state: RetainedHistoryMaintenanceContinuationState,
): RetainedHistoryMaintenanceContinuationEvidenceV1 {
  return Object.freeze({
    version: "flarex.retained-history-maintenance-continuation.v1",
    deploymentId: state.deploymentId,
    scopeId: state.scopeId,
    retainedFloor: state.retainedFloor.toString(),
    authority: Object.freeze({
      physicalLocator: captureScopePhysicalLocator(
        state.authority.physicalLocator,
      ),
      storageGeneration: state.authority.storageGeneration,
      storageGenerationFence: state.authority.storageGenerationFence.toString(),
      epoch: state.authority.epoch,
    }),
    phase: phaseEvidence(state.phase),
  });
}

function restoreContinuationResult(
  port: RetainedHistoryMaintenancePort,
  evidence: RetainedHistoryMaintenanceContinuationEvidenceV1,
): Result.Result<
  RetainedHistoryMaintenanceContinuation,
  RetainedHistoryMaintenanceError
> {
  return Result.gen(function* () {
    if (!portStates.has(port)) {
      return yield* Result.fail(new RetainedHistoryMaintenanceError({
        reason: "invalidPort",
        deploymentId: evidence.deploymentId,
        scopeId: evidence.scopeId,
      }));
    }
    const retainedFloor = yield* decodeEvidenceCommitSeqResult(
      evidence.retainedFloor,
    ).pipe(Result.mapError(() => new RetainedHistoryMaintenanceError({
      reason: "invalidContinuation",
      deploymentId: evidence.deploymentId,
      scopeId: evidence.scopeId,
    })));
    const storageGenerationFence = yield*
      decodeEvidenceStorageGenerationFenceResult(
        evidence.authority.storageGenerationFence,
      ).pipe(Result.mapError(() => new RetainedHistoryMaintenanceError({
        reason: "invalidContinuation",
        deploymentId: evidence.deploymentId,
        scopeId: evidence.scopeId,
      })));
    return makeContinuation(
      port,
      evidence.deploymentId,
      Object.freeze({ scopeId: evidence.scopeId, retainedFloor }),
      phaseFromEvidence(evidence.phase),
      Object.freeze({
        scopeId: evidence.scopeId,
        physicalLocator: captureScopePhysicalLocator(
          evidence.authority.physicalLocator,
        ),
        storageGeneration: evidence.authority.storageGeneration,
        storageGenerationFence,
        epoch: evidence.authority.epoch,
      }),
    );
  });
}

function phaseEvidence(
  phase: RetainedHistoryMaintenancePhase,
): RetainedHistoryMaintenanceContinuationEvidenceV1["phase"] {
  switch (phase.kind) {
    case "commitHistory":
      return Object.freeze({ kind: "commitHistory" });
    case "indexHistory":
      return Object.freeze({
        kind: "indexHistory",
        cursor: captureIndexCursor(phase.cursor),
      });
    case "appRowHistory":
      return Object.freeze({
        kind: "appRowHistory",
        cursor: captureAppRowCursor(phase.cursor),
      });
  }
}

function phaseFromEvidence(
  phase: RetainedHistoryMaintenanceContinuationEvidenceV1["phase"],
): RetainedHistoryMaintenancePhase {
  switch (phase.kind) {
    case "commitHistory":
      return commitPhase();
    case "indexHistory":
      return indexPhase(captureIndexCursor(phase.cursor));
    case "appRowHistory":
      return appRowPhase(captureAppRowCursor(phase.cursor));
  }
}

function emptyCounters(): Counters {
  return {
    pagesExecuted: 0,
    commitPagesExecuted: 0,
    indexPagesExecuted: 0,
    appRowPagesExecuted: 0,
    deletedCommitCount: 0,
    deletedChangeCount: 0,
    deletedIndexRevisionCount: 0,
    deletedAppRowRevisionCount: 0,
  };
}

function captureAuthorityPin(
  authority: TrustedScopeAuthority,
): RetainedHistoryMaintenanceAuthorityPin {
  return Object.freeze({
    scopeId: authority.scopeId,
    physicalLocator: captureScopePhysicalLocator(authority.physicalLocator),
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
  });
}

function pageExpectation(
  authority: RetainedHistoryMaintenanceAuthorityPin,
  retainedFloor: CommitSeq,
): RetainedHistoryPageExpectation {
  return Object.freeze({
    ...authority,
    retainedFloor,
  });
}

function authorityPinsEqual(
  left: RetainedHistoryMaintenanceAuthorityPin,
  right: RetainedHistoryMaintenanceAuthorityPin,
): boolean {
  return left.scopeId === right.scopeId &&
    scopePhysicalLocatorsEqual(left.physicalLocator, right.physicalLocator) &&
    left.storageGeneration === right.storageGeneration &&
    left.storageGenerationFence === right.storageGenerationFence &&
    left.epoch === right.epoch;
}

function capturePhase(
  phase: RetainedHistoryMaintenancePhase,
): RetainedHistoryMaintenancePhase {
  switch (phase.kind) {
    case "commitHistory":
      return commitPhase();
    case "indexHistory":
      return indexPhase(captureIndexCursor(phase.cursor));
    case "appRowHistory":
      return appRowPhase(captureAppRowCursor(phase.cursor));
  }
}

function captureIndexCursor(
  cursor: RetainedIndexHistoryCursor,
): RetainedIndexHistoryCursor {
  if (cursor.kind === "start") return Object.freeze({ kind: "start" });
  return Object.freeze({
    kind: cursor.kind,
    identity: Object.freeze({ ...cursor.identity }),
  });
}

function captureAppRowCursor(
  cursor: RetainedAppRowHistoryCursor,
): RetainedAppRowHistoryCursor {
  if (cursor.kind === "start") return Object.freeze({ kind: "start" });
  return Object.freeze({
    kind: cursor.kind,
    identity: Object.freeze({ ...cursor.identity }),
  });
}

function commitPhase(): RetainedHistoryMaintenancePhase {
  return Object.freeze({ kind: "commitHistory" as const });
}

function indexPhase(
  cursor: RetainedIndexHistoryCursor,
): RetainedHistoryMaintenancePhase {
  return Object.freeze({ kind: "indexHistory" as const, cursor });
}

function appRowPhase(
  cursor: RetainedAppRowHistoryCursor,
): RetainedHistoryMaintenancePhase {
  return Object.freeze({ kind: "appRowHistory" as const, cursor });
}

function elapsedMilliseconds(startedAt: bigint, observedAt: bigint): number {
  const elapsed = observedAt > startedAt ? observedAt - startedAt : 0n;
  return Number(elapsed / NANOSECONDS_PER_MILLISECOND);
}

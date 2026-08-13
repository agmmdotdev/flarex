import type {
  ApplicationActiveSelection,
} from "@flarex/persistence-postgres/internal/application-activation";
import type {
  ApplicationActionAdmission,
} from "@flarex/persistence-postgres/internal/application-action-admission";
import {
  claimApplicationAuthorityActionExecution,
  revokeDirectActionExecutionSubjectV1,
  settleApplicationAuthorityActionInvocation,
  type ApplicationActionAuthorityV1Error,
  type ApplicationAuthorityActionInvocationProjection,
  type DirectActionExecutionSubjectCapabilityV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import {
  ApplicationActionCapabilitySessionError,
  type ApplicationActionCapabilitySession,
  type ApplicationActionRunner,
  type ApplicationActionRunnerError,
} from "flarex-backend/internal/application-action-runner";
import { Data, Effect, Exit, Result, Scope } from "effect";
import {
  decodeEdgeActionExactRuntimeAuthV1Effect,
  type EdgeActionExactRuntimeAuthV1,
} from "flarex-protocol/edge-action-exact-runtime";
import type { EdgeActionHostPolicyFrameV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";
import { encodeEdgeActionHostPolicyV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationActionWorkerRequestV1Effect,
  type ApplicationActionWorkerRequestV1,
} from "flarex-protocol/internal/application-worker-v1";
import {
  canonicalizeFlarexValueV1,
  decodeCanonicalFlarexValueEvidenceV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

import {
  type ActiveApplicationActionEffectRunnerV1,
  type ActiveApplicationActionEvidenceLiveV1,
} from "./actionAdmissionSystemV1";
import {
  makeActiveApplicationEdgeActionCallbackEvidencePortV1,
  makeEdgeActionCallbackBridgeV1,
  type EdgeActionCallbackBridgeV1,
  type EdgeActionCallbackSystemPortV1,
} from "./edgeActionCallbackBridgeV1";
import {
  makeActiveApplicationEdgeActionOutboundEvidencePortV1,
  makeEdgeActionOutboundGatewayV1,
  type EdgeActionOutboundGatewayV1,
  type EdgeActionOutboundHostFetchV1,
} from "./edgeActionOutboundGatewayV1";
import { makeEdgeActionHostSyscallSequencerV1 } from
  "./edgeActionHostSyscallSequencerV1";
import {
  inspectActiveApplicationEdgeActionSettlementV1,
  issueActiveApplicationEdgeActionSettlementV1,
  revokeActiveApplicationEdgeActionSettlementV1,
  type ActiveApplicationEdgeActionSettlementV1,
} from "./edgeActionSettlementCapabilityV1";

declare const applicationActionDispatchBundleBrand: unique symbol;
export interface ApplicationActionDispatchBundle {
  readonly [applicationActionDispatchBundleBrand]: true;
}

export interface ApplicationActionDispatchExecutionContext {
  readonly executionDurationMilliseconds: number;
  readonly randomSeed: Uint8Array;
  readonly auth: EdgeActionExactRuntimeAuthV1;
}

export interface PrepareApplicationActionDispatchInput {
  readonly admission: ApplicationActionAdmission;
  readonly invocation: ApplicationAuthorityActionInvocationProjection;
  readonly execution: ApplicationActionDispatchExecutionContext;
}

export interface ApplicationActionHostCompositionLive<
  HashError,
  CanonicalError,
> {
  readonly evidence: ActiveApplicationActionEvidenceLiveV1<
    HashError,
    CanonicalError
  >;
  readonly effectRunner: ActiveApplicationActionEffectRunnerV1;
  readonly callbackSystem: EdgeActionCallbackSystemPortV1<
    ApplicationActiveSelection
  >;
  readonly outboundHost: EdgeActionOutboundHostFetchV1;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly runner: ApplicationActionRunner;
}

export class ApplicationActionHostCompositionError extends Data.TaggedError(
  "ApplicationActionHostCompositionError",
)<{
  readonly reason:
    | "invalidInput"
    | "authorityMismatch"
    | "invalidArguments"
    | "invalidResult"
    | "invalidBundle"
    | "settlementUnavailable";
  readonly cause?: unknown;
}> {}

export type PrepareApplicationActionDispatchError<HashError, CanonicalError> =
  | ApplicationActionHostCompositionError
  | ApplicationActionAuthorityV1Error<HashError>
  | Effect.Error<
      ReturnType<
        ActiveApplicationActionEvidenceLiveV1<
          HashError,
          CanonicalError
        >["bodyStore"]["readImmutable"]
      >
    >;

export interface PreparedApplicationActionDispatch {
  readonly bundle: ApplicationActionDispatchBundle;
  readonly settlement: ActiveApplicationEdgeActionSettlementV1;
}

export type ApplicationActionDispatchResult = CanonicalFlarexRuntimeValueV1;

interface ApplicationActionDispatchBundleState {
  readonly runner: ApplicationActionRunner;
  readonly runnerInput: Parameters<ApplicationActionRunner["run"]>[0];
  readonly session: ApplicationActionCapabilitySession;
  readonly settlement: ActiveApplicationEdgeActionSettlementV1;
}

const bundleStates = new WeakMap<object, ApplicationActionDispatchBundleState>();
const dispatchedSettlements = new WeakSet<object>();
const HOST_POLICY_ENCODING_BUDGET = Object.freeze({
  maximumOrigins: 1_024,
  maximumOriginBytes: 8_192,
  maximumCanonicalBytes: 1_048_576,
});

export const prepareApplicationActionDispatch = Effect.fn(
  "ApplicationActionHostComposition.prepare",
)(function* <HashError, CanonicalError>(
  input: PrepareApplicationActionDispatchInput,
  live: ApplicationActionHostCompositionLive<HashError, CanonicalError>,
): Effect.fn.Return<
  PreparedApplicationActionDispatch,
  PrepareApplicationActionDispatchError<HashError, CanonicalError>,
  Scope.Scope
> {
  const randomSeed = yield* captureRandomSeed(input.execution.randomSeed);
  const randomSeedSha256 = yield* live.evidence.authority.sha256.hash(
    randomSeed,
  );
  const claimed = yield* Effect.acquireRelease(
    claimApplicationAuthorityActionExecution(
      input.invocation.requestKey,
      input.execution.executionDurationMilliseconds,
      randomSeedSha256,
      live.evidence.authority,
    ),
    execution => Effect.sync(() =>
      revokeDirectActionExecutionSubjectV1(execution.subject)
    ),
  );
  yield* requireClaimMatchesInput(input, claimed.invocation);
  const auth = yield* decodeEdgeActionExactRuntimeAuthV1Effect(
    input.execution.auth,
  ).pipe(Effect.mapError(cause => compositionError("invalidInput", cause)));
  const authEvidence = yield* Effect.tryPromise({
    try: () => canonicalizeFlarexValueV1(auth),
    catch: cause => compositionError("invalidInput", cause),
  });
  if (!bytesEqualFullScan(
    claimed.invocation.executionIdentitySha256,
    authEvidence.sha256,
  )) return yield* compositionError("authorityMismatch");
  const hostPolicy = yield* Effect.fromResult(
    encodeEdgeActionHostPolicyV1(
      live.hostPolicy,
      HOST_POLICY_ENCODING_BUDGET,
    ).pipe(Result.mapError(cause => compositionError("invalidInput", cause))),
  );
  const hostPolicySha256 = yield* live.evidence.authority.sha256.hash(
    hostPolicy.canonicalBytes,
  );
  if (!bytesEqualFullScan(
    claimed.invocation.hostPolicySha256,
    hostPolicySha256,
  )) return yield* compositionError("authorityMismatch");
  const argumentObject = yield* live.evidence.bodyStore.readImmutable(
    claimed.invocation.arguments,
    live.evidence.bodyBudget,
  );
  const argumentsValue = yield* Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: argumentObject.bytes,
      sha256: claimed.invocation.arguments.sha256,
    }),
    catch: cause => compositionError("invalidArguments", cause),
  });
  const request = yield* projectApplicationActionWorkerRequest({
    target: input.admission.executionAuthority.authority.runtimeTarget,
    auth,
    argumentsValue: argumentsValue.value,
    argumentSemanticBytes: argumentsValue.semanticSizeBytes,
    invocation: claimed.invocation,
    randomSeed,
  });
  const session = makeCapabilitySession(
    input.admission.selection,
    claimed.subject,
    claimed.invocation.requestKey,
    hostPolicy.frame,
    live,
  );
  const runnerInput = Object.freeze({
    executionAuthority: input.admission.executionAuthority,
    manifest: input.admission.basis.manifest,
    runtimeHostIdentity: input.admission.basis.runtimeHostIdentity,
    admittedCompatibilityDate: input.admission.basis.compatibilityDate,
    invocationCompatibilityDate: claimed.invocation.compatibilityDate,
    request,
    capabilities: session,
  });
  const settlement = yield* Effect.acquireRelease(
    Effect.sync(() => issueActiveApplicationEdgeActionSettlementV1(
      claimed.subject,
    )),
    capability => Effect.sync(() =>
      revokeActiveApplicationEdgeActionSettlementV1(capability)
    ),
  );
  const bundle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const value = Object.freeze({}) as ApplicationActionDispatchBundle;
      bundleStates.set(value, Object.freeze({
        runner: live.runner,
        runnerInput,
        session,
        settlement,
      }));
      return value;
    }),
    value => {
      const state = bundleStates.get(value);
      bundleStates.delete(value);
      return state === undefined
        ? Effect.void
        : state.session.closeAndDrain.pipe(Effect.orDie);
    },
  );
  return Object.freeze({ bundle, settlement });
});

export interface ProjectApplicationActionWorkerRequestInput {
  readonly target: ApplicationActionWorkerRequestV1["target"];
  readonly auth: EdgeActionExactRuntimeAuthV1;
  readonly argumentsValue: unknown;
  readonly argumentSemanticBytes: number;
  readonly invocation: ApplicationAuthorityActionInvocationProjection;
  readonly randomSeed: Uint8Array;
}

export const projectApplicationActionWorkerRequest = Effect.fn(
  "ApplicationActionHostComposition.projectRequest",
)(function* (
  input: ProjectApplicationActionWorkerRequestInput,
): Effect.fn.Return<
  ApplicationActionWorkerRequestV1,
  ApplicationActionHostCompositionError
> {
  return yield* decodeApplicationActionWorkerRequestV1Effect({
    format: APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
    target: input.target,
    auth: input.auth,
    arguments: input.argumentsValue,
    argumentSemanticBytes: input.argumentSemanticBytes,
    context: {
      executionId: input.invocation.invocationId,
      invocationId: input.invocation.invocationId,
      executionGeneration: input.invocation.executionGeneration,
      executionTime: input.invocation.invocationTime?.getTime(),
      executionDeadline: input.invocation.executionDeadline?.getTime(),
      randomSeed: input.randomSeed,
      hostPolicySha256: input.invocation.hostPolicySha256,
    },
  }).pipe(Effect.mapError(cause => compositionError("invalidInput", cause)));
});

export const dispatchPreparedApplicationAction = Effect.fn(
  "ApplicationActionHostComposition.dispatch",
)(function* (
  bundle: ApplicationActionDispatchBundle,
): Effect.fn.Return<
  ApplicationActionDispatchResult,
  ApplicationActionHostCompositionError | ApplicationActionRunnerError
> {
  const state = bundleStates.get(bundle);
  if (state === undefined) return yield* compositionError("invalidBundle");
  bundleStates.delete(bundle);
  const exit = yield* state.runner.run(state.runnerInput).pipe(Effect.exit);
  dispatchedSettlements.add(state.settlement);
  return yield* Exit.isSuccess(exit)
    ? Effect.succeed(exit.value)
    : Effect.failCause(exit.cause);
});

export type SettlePreparedApplicationActionOutcome =
  | Readonly<{
      readonly lifecycle: "completed";
      readonly resultValue: CanonicalFlarexRuntimeValueV1;
    }>
  | Readonly<{
      readonly lifecycle: "failed" | "uncertain" | "cancelled";
      readonly terminalCode: string;
    }>;

export const settlePreparedApplicationAction = Effect.fn(
  "ApplicationActionHostComposition.settle",
)(function* <HashError, CanonicalError>(
  settlement: ActiveApplicationEdgeActionSettlementV1,
  outcome: SettlePreparedApplicationActionOutcome,
  live: ActiveApplicationActionEvidenceLiveV1<HashError, CanonicalError>,
): Effect.fn.Return<
  ApplicationAuthorityActionInvocationProjection,
  | ApplicationActionHostCompositionError
  | ApplicationActionAuthorityV1Error<HashError>
  | Effect.Error<
      ReturnType<
        ActiveApplicationActionEvidenceLiveV1<
          HashError,
          CanonicalError
        >["bodyStore"]["putImmutable"]
      >
    >
> {
  const subject = inspectActiveApplicationEdgeActionSettlementV1(settlement);
  if (subject === undefined || !dispatchedSettlements.has(settlement)) {
    return yield* compositionError("settlementUnavailable");
  }
  let projectedOutcome;
  if (outcome.lifecycle === "completed") {
    const resultValue = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueV1(outcome.resultValue),
      catch: cause => compositionError("invalidResult", cause),
    });
    projectedOutcome = {
      lifecycle: "completed" as const,
      result: yield* live.bodyStore.putImmutable(
        "action_result",
        copyBytes(resultValue.canonicalBytes),
        live.bodyBudget,
      ),
    };
  } else {
    projectedOutcome = outcome;
  }
  const projection = yield* settleApplicationAuthorityActionInvocation(
    subject,
    projectedOutcome,
    live.authority,
  );
  dispatchedSettlements.delete(settlement);
  revokeActiveApplicationEdgeActionSettlementV1(settlement);
  return projection;
});

function requireClaimMatchesInput(
  input: PrepareApplicationActionDispatchInput,
  claimed: ApplicationAuthorityActionInvocationProjection,
): Effect.Effect<void, ApplicationActionHostCompositionError> {
  return claimed.executionAuthorityGeneration === "application_v1" &&
      claimed.requestKey === input.invocation.requestKey &&
      claimed.invocationId === input.invocation.invocationId &&
      claimed.actionFunctionPath ===
        input.admission.executionAuthority.authority.runtimeTarget.function.path &&
      bytesEqualFullScan(
        claimed.executionAuthority.sha256,
        input.admission.executionAuthority.sha256,
      ) && bytesEqualFullScan(
        claimed.requestIdentitySha256,
        input.invocation.requestIdentitySha256,
      )
    ? Effect.void
    : Effect.fail(compositionError("authorityMismatch"));
}

function makeCapabilitySession<HashError, CanonicalError>(
  selection: ApplicationActiveSelection,
  subject: DirectActionExecutionSubjectCapabilityV1,
  requestKey: string,
  hostPolicy: EdgeActionHostPolicyFrameV1,
  live: ApplicationActionHostCompositionLive<HashError, CanonicalError>,
): ApplicationActionCapabilitySession {
  const sequencer = makeEdgeActionHostSyscallSequencerV1(
    hostPolicy.maximumSyscalls,
  );
  const callback = makeEdgeActionCallbackBridgeV1({
    selection,
    evidence: makeActiveApplicationEdgeActionCallbackEvidencePortV1(
      subject,
      live.evidence.authority,
      live.effectRunner,
    ),
    sequencer,
    parentRequestKey: requestKey,
    maximumSyscalls: hostPolicy.maximumSyscalls,
    maximumArgumentBytes: hostPolicy.maximumArgumentBytes,
    maximumResultBytes: hostPolicy.maximumResultBytes,
    system: live.callbackSystem,
  });
  const outbound = makeEdgeActionOutboundGatewayV1({
    stableKeyPrefix: requestKey,
    policy: hostPolicy,
    sequencer,
    evidence: makeActiveApplicationEdgeActionOutboundEvidencePortV1(
      subject,
      live.evidence,
      live.effectRunner,
    ),
    host: live.outboundHost,
  });
  return capabilitySession(
    callback,
    outbound,
    hostPolicy.cleanupDrainMilliseconds,
  );
}

export function capabilitySession(
  callback: EdgeActionCallbackBridgeV1,
  outbound: EdgeActionOutboundGatewayV1,
  cleanupDrainMilliseconds = 5_000,
): ApplicationActionCapabilitySession {
  if (
    !Number.isSafeInteger(cleanupDrainMilliseconds) ||
    cleanupDrainMilliseconds < 1
  ) throw new Error("Application action cleanup deadline is invalid.");
  let closed = false;
  const closeAndDrain = Effect.uninterruptible(Effect.gen(function* () {
    let callbackCloseExit: Exit.Exit<
      void,
      ApplicationActionCapabilitySessionError
    > = Exit.succeed(undefined);
    let outboundCloseExit: Exit.Exit<
      void,
      ApplicationActionCapabilitySessionError
    > = Exit.succeed(undefined);
    if (!closed) {
      closed = true;
      [callbackCloseExit, outboundCloseExit] = yield* Effect.all([
        Effect.try({
          try: () => callback.close(),
          catch: cause => new ApplicationActionCapabilitySessionError({
            reason: "callbackFailed",
            cause,
          }),
        }).pipe(Effect.exit),
        Effect.try({
          try: () => outbound.close(),
          catch: cause => new ApplicationActionCapabilitySessionError({
            reason: "cleanupUncertain",
            cause,
          }),
        }).pipe(Effect.exit),
      ]);
    }
    const [callbackSettlement, outboundSettlement] = yield* Effect.tryPromise({
      try: () => drainCapabilitiesWithinDeadline(
        callback,
        outbound,
        cleanupDrainMilliseconds,
      ),
      catch: cause => cause instanceof ApplicationActionCapabilitySessionError
        ? cause
        : new ApplicationActionCapabilitySessionError({
            reason: "cleanupUncertain",
            cause,
          }),
    });
    if (outboundSettlement.status === "rejected") {
      return yield* new ApplicationActionCapabilitySessionError({
        reason: "cleanupUncertain",
        cause: outboundSettlement.reason,
      });
    }
    if (callbackSettlement.status === "rejected") {
      return yield* new ApplicationActionCapabilitySessionError({
        reason: "callbackFailed",
        cause: callbackSettlement.reason,
      });
    }
    if (Exit.isFailure(outboundCloseExit)) {
      return yield* Effect.failCause(outboundCloseExit.cause);
    }
    if (Exit.isFailure(callbackCloseExit)) {
      return yield* Effect.failCause(callbackCloseExit.cause);
    }
  }));
  return Object.freeze({
    callback,
    outbound: Object.freeze({
      fetch: (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => outbound.fetch(input, init),
      connect: () => {
        throw new Error("Application action raw outbound sockets are denied.");
      },
    }),
    closeAndDrain,
  });
}

function drainCapabilitiesWithinDeadline(
  callback: EdgeActionCallbackBridgeV1,
  outbound: EdgeActionOutboundGatewayV1,
  cleanupDrainMilliseconds: number,
): Promise<readonly [PromiseSettledResult<void>, PromiseSettledResult<void>]> {
  const settlements = Promise.allSettled([
    Promise.resolve().then(() => callback.drain()),
    Promise.resolve().then(() => outbound.drain()),
  ]);
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new ApplicationActionCapabilitySessionError({
        reason: "cleanupUncertain",
        cause: new Error("Application action cleanup deadline exceeded."),
      }));
    }, cleanupDrainMilliseconds);
    settlements.then(result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function captureRandomSeed(
  input: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationActionHostCompositionError> {
  return isUint8ArrayWithByteLength(input, 32)
    ? Effect.succeed(copyBytes(input))
    : Effect.fail(compositionError("invalidInput"));
}

function compositionError(
  reason: ApplicationActionHostCompositionError["reason"],
  cause?: unknown,
): ApplicationActionHostCompositionError {
  return new ApplicationActionHostCompositionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

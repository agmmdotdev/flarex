import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-activation-v1";
import type {
  DirectActionExecutionSubjectCapabilityV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import {
  claimCandidateBoundEdgeActionRuntimeTargetV1,
  type EdgeActionExactRuntimeWorkerDefinitionV1,
  type InvalidCandidateBoundEdgeActionRuntimeTargetV1Error,
} from "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1";
import { Data, Effect, Result, Scope } from "effect";
import type { EdgeActionExactRuntimeRequestV1 } from
  "flarex-protocol/edge-action-exact-runtime";

import type {
  ActiveApplicationActionEffectRunnerV1,
  ActiveApplicationActionEvidenceLiveV1,
  PreparedActiveApplicationEdgeActionDispatchV1,
} from "./actionAdmissionSystemV1";
import { claimPreparedActiveApplicationEdgeActionDispatchV1 } from
  "./edgeActionPreparedDispatchStateV1";
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
  issueActiveApplicationEdgeActionSettlementV1 as issueSettlement,
  revokeActiveApplicationEdgeActionSettlementV1,
  type ActiveApplicationEdgeActionSettlementV1,
} from "./edgeActionSettlementCapabilityV1";

export type { ActiveApplicationEdgeActionSettlementV1 } from
  "./edgeActionSettlementCapabilityV1";

declare const capabilityBundleBrand: unique symbol;
export interface ActiveApplicationEdgeActionCapabilityBundleV1 {
  readonly [capabilityBundleBrand]: true;
}

export interface ActiveApplicationEdgeActionCapabilityBundleLiveV1<
  HashError,
  CanonicalError,
> {
  readonly evidence: ActiveApplicationActionEvidenceLiveV1<
    HashError,
    CanonicalError
  >;
  readonly runner: ActiveApplicationActionEffectRunnerV1;
  readonly callbackSystem: EdgeActionCallbackSystemPortV1<
    AuthenticatedActiveApplicationRevisionSelectionV1
  >;
  readonly outboundHost: EdgeActionOutboundHostFetchV1;
}

export interface ActiveApplicationEdgeActionArtifactHostClaimV1 {
  readonly request: EdgeActionExactRuntimeRequestV1;
  readonly definition: EdgeActionExactRuntimeWorkerDefinitionV1;
  readonly callback: EdgeActionCallbackBridgeV1;
  readonly outbound: EdgeActionOutboundGatewayV1;
}

export class InvalidActiveApplicationEdgeActionCapabilityBundleV1Error
  extends Data.TaggedError(
    "InvalidActiveApplicationEdgeActionCapabilityBundleV1Error",
  )<{
    readonly reason:
      | "invalidPreparedDispatch"
      | "notIssuedOrAlreadyClaimed";
  }> {}

interface BundleStateV1 {
  readonly claim: ActiveApplicationEdgeActionArtifactHostClaimV1;
  readonly subject: DirectActionExecutionSubjectCapabilityV1;
}

const bundleStates = new WeakMap<object, BundleStateV1>();
const settlementIssuedBundles = new WeakSet<object>();

/**
 * The sole AAV-A2 callback/outbound composition owner. Both capabilities are
 * bound to the prepared candidate and AAV-A1 execution subject and consume one
 * shared host syscall sequencer. The opaque bundle is request-scoped and
 * single-use.
 */
export const issueActiveApplicationEdgeActionCapabilityBundleV1 = Effect.fn(
  "ActiveApplicationEdgeActionCapabilityBundle.issueV1",
)(function* <HashError, CanonicalError>(
  prepared: PreparedActiveApplicationEdgeActionDispatchV1,
  live: ActiveApplicationEdgeActionCapabilityBundleLiveV1<
    HashError,
    CanonicalError
  >,
): Effect.fn.Return<
  ActiveApplicationEdgeActionCapabilityBundleV1,
  | InvalidActiveApplicationEdgeActionCapabilityBundleV1Error
  | InvalidCandidateBoundEdgeActionRuntimeTargetV1Error,
  Scope.Scope
> {
  const preparedState = claimPreparedActiveApplicationEdgeActionDispatchV1(
    prepared,
  );
  if (preparedState === undefined) {
    return yield* new InvalidActiveApplicationEdgeActionCapabilityBundleV1Error({
      reason: "invalidPreparedDispatch",
    });
  }
  const target = yield* Effect.fromResult(
    claimCandidateBoundEdgeActionRuntimeTargetV1(
      preparedState.runtimeTarget.target,
    ),
  );
  const sequencer = makeEdgeActionHostSyscallSequencerV1(
    target.hostPolicy.maximumSyscalls,
  );
  const callback = makeEdgeActionCallbackBridgeV1({
    selection: preparedState.selection,
    identity: preparedState.request.auth,
    evidence: makeActiveApplicationEdgeActionCallbackEvidencePortV1(
      preparedState.execution.subject,
      live.evidence.authority,
      live.runner,
    ),
    sequencer,
    parentRequestKey: preparedState.execution.invocation.requestKey,
    maximumSyscalls: target.hostPolicy.maximumSyscalls,
    maximumArgumentBytes: target.hostPolicy.maximumArgumentBytes,
    maximumResultBytes: target.hostPolicy.maximumResultBytes,
    system: live.callbackSystem,
  });
  const outbound = makeEdgeActionOutboundGatewayV1({
    stableKeyPrefix: preparedState.execution.invocation.requestKey,
    policy: target.hostPolicy,
    sequencer,
    evidence: makeActiveApplicationEdgeActionOutboundEvidencePortV1(
      preparedState.execution.subject,
      live.evidence,
      live.runner,
    ),
    host: live.outboundHost,
  });
  const state = Object.freeze({
    claim: Object.freeze({
      request: preparedState.request,
      definition: target.definition,
      callback,
      outbound,
    }),
    subject: preparedState.execution.subject,
  });
  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      const bundle = Object.freeze({}) as
        ActiveApplicationEdgeActionCapabilityBundleV1;
      bundleStates.set(bundle, state);
      return bundle;
    }),
    bundle => Effect.sync(() => {
      const current = bundleStates.get(bundle);
      bundleStates.delete(bundle);
      current?.claim.callback.close();
      current?.claim.outbound.close();
    }),
  );
});

/** Transfers one issued capability bundle to the configured artifact host. */
export function claimActiveApplicationEdgeActionArtifactHostDispatchV1(
  bundle: unknown,
): Result.Result<
  ActiveApplicationEdgeActionArtifactHostClaimV1,
  InvalidActiveApplicationEdgeActionCapabilityBundleV1Error
> {
  if (bundle === null || typeof bundle !== "object") {
    return invalidBundle();
  }
  const state = bundleStates.get(bundle);
  if (state === undefined) return invalidBundle();
  bundleStates.delete(bundle);
  return Result.succeed(state.claim);
}

/**
 * Issues the only terminal-settlement capability before the host consumes the
 * dispatch bundle. It carries no persistence or execution-subject surface.
 */
export const issueActiveApplicationEdgeActionSettlementCapabilityV1 =
  Effect.fn("ActiveApplicationEdgeActionSettlement.issueV1")(function* (
    bundle: ActiveApplicationEdgeActionCapabilityBundleV1,
  ): Effect.fn.Return<
    ActiveApplicationEdgeActionSettlementV1,
    InvalidActiveApplicationEdgeActionCapabilityBundleV1Error,
    Scope.Scope
  > {
    const state = bundleStates.get(bundle);
    if (state === undefined || settlementIssuedBundles.has(bundle)) {
      return yield* new InvalidActiveApplicationEdgeActionCapabilityBundleV1Error({
        reason: "notIssuedOrAlreadyClaimed",
      });
    }
    settlementIssuedBundles.add(bundle);
    return yield* Effect.acquireRelease(
      Effect.sync(() => issueSettlement(state.subject)),
      settlement => Effect.sync(() => {
        revokeActiveApplicationEdgeActionSettlementV1(settlement);
      }),
    );
  });

function invalidBundle(): Result.Result<
  never,
  InvalidActiveApplicationEdgeActionCapabilityBundleV1Error
> {
  return Result.fail(
    new InvalidActiveApplicationEdgeActionCapabilityBundleV1Error({
      reason: "notIssuedOrAlreadyClaimed",
    }),
  );
}

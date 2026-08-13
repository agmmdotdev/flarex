import {
  ApplicationActionLifecycleConflictV1Error,
  ApplicationActionRequestKeyConflictV1Error,
  type ApplicationActionInvocationLifecycleV1,
  type ApplicationActionInvocationProjectionV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import type {
  EdgeActionExactRuntimeArtifactHostFailureReasonV1,
  EdgeActionRouteIndependentCoordinatorV1,
} from "flarex-backend/internal/edge-action-route-independent-coordinator-v1";
import type {
  InvalidCandidateBoundEdgeActionRuntimeTargetV1Error,
} from "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1";
import { Context, Data, Effect, Layer, Result, Schema, Scope } from "effect";
import {
  decodeEdgeActionExactRuntimeAuthV1Effect,
  type EdgeActionExactRuntimeAuthV1,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  encodeEdgeActionHostPolicyV1,
  type EdgeActionHostPolicyEncodingBudgetV1,
  type EdgeActionHostPolicyV1Error,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import type {
  ExecutionEvidenceProtocolV1Error,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import {
  canonicalizeFlarexValueV1,
  decodeCanonicalFlarexValueEvidenceV1,
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

import {
  admitActiveApplicationActionV1,
  inspectActiveApplicationActionInvocationV1,
  isActiveApplicationActionInvocationTargetCurrentV1,
  prepareActiveApplicationEdgeActionDispatchV1,
  recoverExpiredActiveApplicationActionExecutionV1,
  settleActiveApplicationEdgeActionV1,
  type ActiveApplicationActionAdmissionLiveV1,
  type ActiveApplicationEdgeActionDispatchLiveV1,
  type ActiveApplicationEdgeActionSettlementV1,
  type AdmitActiveApplicationActionV1Error,
  type PrepareActiveApplicationEdgeActionDispatchV1Error,
  type SettleActiveApplicationEdgeActionV1Error,
} from "./actionAdmissionSystemV1";
import {
  issueActiveApplicationEdgeActionCapabilityBundleV1,
  issueActiveApplicationEdgeActionSettlementCapabilityV1,
  type ActiveApplicationEdgeActionCapabilityBundleLiveV1,
  type InvalidActiveApplicationEdgeActionCapabilityBundleV1Error,
} from "./edgeActionDispatchCapabilityBundleV1";

type CanonicalBodyErrorV1 = ExecutionEvidenceProtocolV1Error;

export interface ApplicationActionExecutionContextV1 {
  readonly invocationId: string;
  readonly executionDurationMilliseconds: number;
  readonly randomSeed: Uint8Array;
  readonly auth: EdgeActionExactRuntimeAuthV1;
}

export interface LegacyApplicationActionSystemLiveV1 {
  readonly admission: ActiveApplicationActionAdmissionLiveV1<
    never,
    CanonicalBodyErrorV1
  >;
  readonly dispatch: ActiveApplicationEdgeActionDispatchLiveV1<
    never,
    CanonicalBodyErrorV1
  >;
  readonly capabilities: ActiveApplicationEdgeActionCapabilityBundleLiveV1<
    never,
    CanonicalBodyErrorV1
  >;
  readonly coordinator: EdgeActionRouteIndependentCoordinatorV1;
  readonly hostPolicyEncodingBudget: EdgeActionHostPolicyEncodingBudgetV1;
  readonly executionContextFactory: () => ApplicationActionExecutionContextV1;
}

export class InvalidApplicationActionInputV1Error extends Data.TaggedError(
  "InvalidApplicationActionInputV1Error",
)<{
  readonly field: "functionRef" | "args" | "requestKey";
}> {}

export class ApplicationActionSystemConfigurationV1Error
  extends Data.TaggedError("ApplicationActionSystemConfigurationV1Error")<{
    readonly reason: "invalidExecutionContext";
    readonly cause?: unknown;
  }> {}

export class ApplicationActionSystemCorruptionV1Error
  extends Data.TaggedError("ApplicationActionSystemCorruptionV1Error")<{
    readonly detail: "completedResultMissing" | "completedResultInvalid";
    readonly cause?: unknown;
  }> {}

export interface CompletedApplicationActionV1 {
  readonly status: "completed";
  readonly disposition: "published" | "replayed";
  readonly invocationId: string;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export interface NonCompletedApplicationActionV1 {
  readonly status: "notCompleted";
  readonly disposition: "replayed" | "settled";
  readonly invocationId: string;
  readonly lifecycle: Exclude<ApplicationActionInvocationLifecycleV1, "completed">;
  readonly terminalCode: string | null;
}

export type InvokeApplicationActionV1Result =
  | CompletedApplicationActionV1
  | NonCompletedApplicationActionV1;

export type InvokeApplicationActionV1Error =
  | InvalidApplicationActionInputV1Error
  | ApplicationActionSystemConfigurationV1Error
  | ApplicationActionSystemCorruptionV1Error
  | EdgeActionHostPolicyV1Error
  | AdmitActiveApplicationActionV1Error<never, CanonicalBodyErrorV1>
  | PrepareActiveApplicationEdgeActionDispatchV1Error<
      never,
      CanonicalBodyErrorV1
    >
  | InvalidCandidateBoundEdgeActionRuntimeTargetV1Error
  | InvalidActiveApplicationEdgeActionCapabilityBundleV1Error
  | SettleActiveApplicationEdgeActionV1Error<never, CanonicalBodyErrorV1>;

export interface LegacyApplicationActionSystemV1Api {
  readonly invoke: (
    activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    InvokeApplicationActionV1Result,
    InvokeApplicationActionV1Error,
    Scope.Scope
  >;
}

export class LegacyApplicationActionSystemV1 extends Context.Service<
  LegacyApplicationActionSystemV1,
  LegacyApplicationActionSystemV1Api
>()("flarex/standard-application-invocation/LegacyApplicationActionSystemV1") {}

/** Private, route-independent SAP07 System operation. */
export const invokeLegacyApplicationActionV1 = Effect.fn(
  "LegacyApplicationAction.invokeV1",
)(function* (
  activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  InvokeApplicationActionV1Result,
  InvokeApplicationActionV1Error,
  LegacyApplicationActionSystemV1 | Scope.Scope
> {
  const system = yield* LegacyApplicationActionSystemV1;
  return yield* system.invoke(activeRevision, functionRef, args, requestKey);
});

export function makeLegacyApplicationActionSystemV1Layer(
  live: LegacyApplicationActionSystemLiveV1,
): Layer.Layer<LegacyApplicationActionSystemV1> {
  return Layer.succeed(
    LegacyApplicationActionSystemV1,
    LegacyApplicationActionSystemV1.of({ invoke: makeInvoke(live) }),
  );
}

function makeInvoke(
  live: LegacyApplicationActionSystemLiveV1,
): LegacyApplicationActionSystemV1Api["invoke"] {
  return Effect.fn("LegacyApplicationActionSystem.invoke")(function* (
    activeRevision,
    functionRefInput,
    argsInput,
    requestKeyInput,
  ) {
    const functionRef = yield* decodeInput(
      decodeFunctionPath,
      functionRefInput,
      "functionRef",
    );
    const requestKey = yield* decodeInput(
      decodeRequestKey,
      requestKeyInput,
      "requestKey",
    );
    const args = yield* captureArguments(argsInput);
    const execution = yield* captureExecutionContext(
      live.executionContextFactory,
    );
    const policy = yield* Effect.fromResult(
      encodeEdgeActionHostPolicyV1(
        live.dispatch.hostPolicy,
        live.hostPolicyEncodingBudget,
      ),
    );
    const hostPolicySha256 = yield* live.admission.authority.sha256.hash(
      policy.canonicalBytes,
    );
    const executionIdentity = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueV1(execution.auth),
      catch: cause => new ApplicationActionSystemConfigurationV1Error({
        reason: "invalidExecutionContext",
        cause,
      }),
    });
    const existing = yield* inspectActiveApplicationActionInvocationV1(
      requestKey,
      live.dispatch.authority,
    ).pipe(
      Effect.map(invocation =>
        invocation as ApplicationActionInvocationProjectionV1 | null
      ),
      Effect.catchTag(
        "ApplicationActionInvocationMissingV1Error",
        () => Effect.succeed(null),
      ),
    );
    let invocation: ApplicationActionInvocationProjectionV1;
    if (existing === null) {
      const admitted = yield* admitActiveApplicationActionV1({
        selection: activeRevision,
        functionPath: functionRef,
        requestKey,
        invocationId: execution.invocationId,
        arguments: args,
        executionIdentitySha256: executionIdentity.sha256,
        compatibilityDate: live.dispatch.compatibilityDate,
        hostPolicySha256,
      }, live.admission);
      invocation = admitted.invocation;
    } else {
      invocation = existing;
      yield* requireReplayIdentity(
        invocation,
        functionRef,
        args.sha256,
        executionIdentity.sha256,
      );
    }
    if (invocation.lifecycle === "executing") {
      invocation = yield* recoverExpiredActiveApplicationActionExecutionV1(
        requestKey,
        live.dispatch.authority,
      ).pipe(Effect.catchIf(
        isNotExpiredRecoveryConflict,
        () => Effect.succeed(invocation),
      ));
    }
    if (invocation.lifecycle !== "admitted") {
      return yield* projectReplay(invocation, live);
    }
    const targetIsCurrent = yield*
      isActiveApplicationActionInvocationTargetCurrentV1(
      invocation,
      activeRevision,
      functionRef,
      live.dispatch.compatibilityDate,
      hostPolicySha256,
    );
    if (!targetIsCurrent) return projectNonCompleted(invocation, "replayed");
    const prepared = yield* prepareActiveApplicationEdgeActionDispatchV1({
      selection: activeRevision,
      requestKey,
      executionDurationMilliseconds:
        execution.executionDurationMilliseconds,
      randomSeed: execution.randomSeed,
      auth: execution.auth,
    }, live.dispatch);
    const bundle = yield* issueActiveApplicationEdgeActionCapabilityBundleV1(
      prepared,
      live.capabilities,
    );
    const settlement =
      yield* issueActiveApplicationEdgeActionSettlementCapabilityV1(bundle);
    const hostResult = yield* live.coordinator.dispatch(bundle).pipe(
      Effect.catchTag(
        "EdgeActionRouteIndependentCoordinatorV1Error",
        () => Effect.succeed(Object.freeze({
          kind: "failure" as const,
          reason: "cleanupUncertain" as const,
        })),
      ),
    );
    if (hostResult.kind === "success") {
      const result = yield* Effect.tryPromise({
        try: () => canonicalizeFlarexValueV1(hostResult.result.value),
        catch: cause => new ApplicationActionSystemCorruptionV1Error({
          detail: "completedResultInvalid",
          cause,
        }),
      });
      const completed = yield* settleActiveApplicationEdgeActionV1(
        settlement,
        Object.freeze({ lifecycle: "completed" as const, resultValue: result }),
        live.capabilities.evidence,
      ).pipe(Effect.catch(error =>
        isPossibleDispatchConflict(error)
          ? settleActiveApplicationEdgeActionV1(
              settlement,
              Object.freeze({
                lifecycle: "uncertain" as const,
                terminalCode: "edge_action_success_uncertain",
              }),
              live.capabilities.evidence,
            )
          : Effect.fail(error)
      ));
      if (completed.lifecycle !== "completed") {
        return projectNonCompleted(completed, "settled");
      }
      return Object.freeze({
        status: "completed" as const,
        disposition: "published" as const,
        invocationId: completed.invocationId,
        value: result.value,
      });
    }
    const settled = yield* settleHostFailure(
      settlement,
      hostResult.reason,
      live,
    );
    return projectNonCompleted(settled, "settled");
  });
}

function requireReplayIdentity(
  invocation: ApplicationActionInvocationProjectionV1,
  functionRef: TransactionFunctionPathV1,
  argumentsSha256: Uint8Array,
  executionIdentitySha256: Uint8Array,
): Effect.Effect<void, ApplicationActionRequestKeyConflictV1Error> {
  return invocation.actionFunctionPath === functionRef &&
      bytesEqualFullScan(invocation.arguments.sha256, argumentsSha256) &&
      bytesEqualFullScan(
        invocation.executionIdentitySha256,
        executionIdentitySha256,
      )
    ? Effect.void
    : Effect.fail(new ApplicationActionRequestKeyConflictV1Error({
        requestKey: invocation.requestKey,
      }));
}

function isNotExpiredRecoveryConflict(
  error: unknown,
): error is ApplicationActionLifecycleConflictV1Error {
  return error instanceof ApplicationActionLifecycleConflictV1Error &&
    error.operation === "recover" && error.expected === "expired" &&
    error.actual === "not_expired";
}

const projectReplay = Effect.fn("ApplicationActionSystem.projectReplay")(
  function* (
    invocation: ApplicationActionInvocationProjectionV1,
    live: LegacyApplicationActionSystemLiveV1,
  ): Effect.fn.Return<
    InvokeApplicationActionV1Result,
    InvokeApplicationActionV1Error
  > {
    if (invocation.lifecycle !== "completed") {
      return projectNonCompleted(invocation, "replayed");
    }
    if (invocation.result === null) {
      return yield* new ApplicationActionSystemCorruptionV1Error({
        detail: "completedResultMissing",
      });
    }
    const body = yield* live.capabilities.evidence.bodyStore.readImmutable(
      invocation.result,
      live.capabilities.evidence.bodyBudget,
    );
    const decoded = yield* Effect.tryPromise({
      try: () => decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: body.bytes,
        sha256: invocation.result!.sha256,
      }),
      catch: cause => new ApplicationActionSystemCorruptionV1Error({
        detail: "completedResultInvalid",
        cause,
      }),
    });
    return Object.freeze({
      status: "completed" as const,
      disposition: "replayed" as const,
      invocationId: invocation.invocationId,
      value: decoded.value,
    });
  },
);

const settleHostFailure = Effect.fn(
  "ApplicationActionSystem.settleHostFailure",
)(function* (
  settlement: ActiveApplicationEdgeActionSettlementV1,
  reason: EdgeActionExactRuntimeArtifactHostFailureReasonV1,
  live: LegacyApplicationActionSystemLiveV1,
): Effect.fn.Return<
  ApplicationActionInvocationProjectionV1,
  InvokeApplicationActionV1Error
> {
  const preferred = preferredFailureLifecycle(reason);
  return yield* settleActiveApplicationEdgeActionV1(
    settlement,
    Object.freeze({
      lifecycle: preferred,
      terminalCode: `edge_action_${reason}`,
    }),
    live.capabilities.evidence,
  ).pipe(Effect.catch(error =>
    preferred !== "uncertain" && isPossibleDispatchConflict(error)
      ? settleActiveApplicationEdgeActionV1(
          settlement,
          Object.freeze({
            lifecycle: "uncertain" as const,
            terminalCode: `edge_action_${reason}_uncertain`,
          }),
          live.capabilities.evidence,
        )
      : Effect.fail(error)
  ));
});

function preferredFailureLifecycle(
  reason: EdgeActionExactRuntimeArtifactHostFailureReasonV1,
): "failed" | "uncertain" | "cancelled" {
  switch (reason) {
    case "callbackFailed":
    case "cleanupUncertain":
      return "uncertain";
    case "cancelled":
      return "cancelled";
    case "authorityFailed":
    case "invalidRequest":
    case "workerLoadFailed":
    case "userCodeFailed":
    case "invalidResult":
    case "timedOut":
      return "failed";
  }
}

function isPossibleDispatchConflict(error: unknown): boolean {
  return error instanceof ApplicationActionLifecycleConflictV1Error &&
    error.operation === "settle" &&
    error.expected === "uncertain_after_possible_dispatch";
}

function projectNonCompleted(
  invocation: ApplicationActionInvocationProjectionV1,
  disposition: NonCompletedApplicationActionV1["disposition"],
): NonCompletedApplicationActionV1 {
  if (invocation.lifecycle === "completed") {
    throw new Error("A completed action cannot use the non-completed projection.");
  }
  return Object.freeze({
    status: "notCompleted" as const,
    disposition,
    invocationId: invocation.invocationId,
    lifecycle: invocation.lifecycle,
    terminalCode: invocation.terminalCode,
  });
}

function captureArguments(
  input: unknown,
): Effect.Effect<
  Awaited<ReturnType<typeof canonicalizeFlarexValueV1>>,
  InvalidApplicationActionInputV1Error
> {
  return Effect.tryPromise({
    try: () => canonicalizeFlarexValueV1(input),
    catch: () => new InvalidApplicationActionInputV1Error({ field: "args" }),
  }).pipe(Effect.filterOrFail(
    value => isCanonicalFlarexRuntimeObjectV1(value.value),
    () => new InvalidApplicationActionInputV1Error({ field: "args" }),
  ));
}

function captureExecutionContext(
  factory: () => ApplicationActionExecutionContextV1,
): Effect.Effect<
  ApplicationActionExecutionContextV1,
  ApplicationActionSystemConfigurationV1Error
> {
  return Effect.try({
    try: () => {
      const value = factory();
      if (
        !Number.isSafeInteger(value.executionDurationMilliseconds) ||
        value.executionDurationMilliseconds < 1 ||
        !isUint8ArrayWithByteLength(value.randomSeed, 32)
      ) throw new Error("Invalid edge-action execution context.");
      return Object.freeze({
        invocationId: value.invocationId,
        executionDurationMilliseconds: value.executionDurationMilliseconds,
        randomSeed: new Uint8Array(value.randomSeed),
        auth: value.auth,
      });
    },
    catch: cause => new ApplicationActionSystemConfigurationV1Error({
      reason: "invalidExecutionContext",
      cause,
    }),
  }).pipe(Effect.flatMap(value =>
    decodeEdgeActionExactRuntimeAuthV1Effect(value.auth).pipe(
      Effect.map(auth => Object.freeze({ ...value, auth })),
      Effect.mapError(cause =>
        new ApplicationActionSystemConfigurationV1Error({
          reason: "invalidExecutionContext",
          cause,
        })
      ),
    )
  ));
}

function decodeInput<A, I>(
  decode: (input: I) => Result.Result<A, unknown>,
  input: I,
  field: InvalidApplicationActionInputV1Error["field"],
): Effect.Effect<A, InvalidApplicationActionInputV1Error> {
  return Effect.fromResult(decode(input)).pipe(
    Effect.mapError(() => new InvalidApplicationActionInputV1Error({ field })),
  );
}

const decodeFunctionPath = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeRequestKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);

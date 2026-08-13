import type { ApplicationActivationRepository } from
  "@flarex/persistence-postgres/internal/application-activation";
import {
  selectApplicationActionAdmission,
  type ApplicationActionAdmission,
  type ApplicationActionAdmissionContext,
  type SelectApplicationActionAdmissionError,
} from "@flarex/persistence-postgres/internal/application-action-admission";
import {
  admitApplicationAuthorityActionInvocation,
  ApplicationActionLifecycleConflictV1Error,
  ApplicationActionRequestKeyConflictV1Error,
  inspectApplicationAuthorityActionInvocation,
  recoverExpiredApplicationAuthorityActionExecution,
  type ApplicationActionAuthorityV1Error,
  type ApplicationAuthorityActionInvocationProjection,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import { bytesEqualFullScan, isUint8ArrayWithByteLength } from
  "@flarex/utils/bytes";
import {
  ApplicationActionCapabilitySessionError,
  type ApplicationActionRunnerError,
} from "flarex-backend/internal/application-action-runner";
import { ApplicationExecutionHostError } from
  "flarex-backend/internal/application-execution-host";
import { Context, Data, Effect, Layer, Result, Schema, Scope } from "effect";
import {
  decodeEdgeActionExactRuntimeAuthV1Effect,
  type EdgeActionExactRuntimeAuthV1,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  encodeApplicationActionInvocationRequestV2,
  type ExecutionEvidenceProtocolV1Error,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  encodeEdgeActionHostPolicyV1,
  type EdgeActionHostPolicyEncodingBudgetV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
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
  dispatchPreparedApplicationAction,
  prepareApplicationActionDispatch,
  settlePreparedApplicationAction,
  type ApplicationActionHostCompositionError,
  type ApplicationActionHostCompositionLive,
} from "./ApplicationActionHostComposition";

type CanonicalBodyError = ExecutionEvidenceProtocolV1Error;

export interface ApplicationActionExecutionContext {
  readonly invocationId: string;
  readonly executionDurationMilliseconds: number;
  readonly randomSeed: Uint8Array;
  readonly auth: EdgeActionExactRuntimeAuthV1;
}

export interface ApplicationActionSystemLive {
  readonly activation: Pick<
    ApplicationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly admission: ApplicationActionAdmissionContext;
  readonly host: ApplicationActionHostCompositionLive<never, CanonicalBodyError>;
  readonly hostPolicyEncodingBudget: EdgeActionHostPolicyEncodingBudgetV1;
  readonly executionContextFactory: () => ApplicationActionExecutionContext;
}

export class ApplicationActionInputError extends Data.TaggedError(
  "ApplicationActionInputError",
)<{
  readonly field: "functionRef" | "args" | "requestKey";
  readonly cause?: unknown;
}> {}

export class ApplicationActionSystemConfigurationError extends Data.TaggedError(
  "ApplicationActionSystemConfigurationError",
)<{
  readonly reason: "invalidExecutionContext" | "invalidHostPolicy";
  readonly cause?: unknown;
}> {}

export class ApplicationActionSystemCorruptionError extends Data.TaggedError(
  "ApplicationActionSystemCorruptionError",
)<{
  readonly detail: "completedResultMissing" | "completedResultInvalid";
  readonly cause?: unknown;
}> {}

export interface CompletedApplicationAction {
  readonly status: "completed";
  readonly disposition: "published" | "replayed";
  readonly invocationId: string;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export interface NonCompletedApplicationAction {
  readonly status: "notCompleted";
  readonly disposition: "replayed" | "settled";
  readonly invocationId: string;
  readonly lifecycle: Exclude<
    ApplicationAuthorityActionInvocationProjection["lifecycle"],
    "completed"
  >;
  readonly terminalCode: string | null;
}

export type InvokeApplicationActionResult =
  | CompletedApplicationAction
  | NonCompletedApplicationAction;

type BodyStore = ApplicationActionSystemLive["host"]["evidence"]["bodyStore"];

export type InvokeApplicationActionError =
  | ApplicationActionInputError
  | ApplicationActionSystemConfigurationError
  | ApplicationActionSystemCorruptionError
  | SelectApplicationActionAdmissionError
  | ApplicationActionAuthorityV1Error<never>
  | ApplicationActionHostCompositionError
  | ApplicationActionRunnerError
  | ExecutionEvidenceProtocolV1Error
  | Effect.Error<ReturnType<ApplicationActionSystemLive["activation"]["readActive"]>>
  | Effect.Error<ReturnType<BodyStore["readImmutable"]>>
  | Effect.Error<ReturnType<BodyStore["putImmutable"]>>;

export interface ApplicationActionSystemApi {
  readonly invoke: (
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    InvokeApplicationActionResult,
    InvokeApplicationActionError,
    Scope.Scope
  >;
}

export class ApplicationActionSystem extends Context.Service<
  ApplicationActionSystem,
  ApplicationActionSystemApi
>()("flarex/standard-application-invocation/ApplicationActionSystem") {}

export const invokeApplicationAction = Effect.fn(
  "ApplicationAction.invoke",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  InvokeApplicationActionResult,
  InvokeApplicationActionError,
  ApplicationActionSystem | Scope.Scope
> {
  const system = yield* ApplicationActionSystem;
  return yield* system.invoke(functionRef, args, requestKey);
});

export function makeApplicationActionSystemLayer(
  live: ApplicationActionSystemLive,
): Layer.Layer<
  ApplicationActionSystem,
  ApplicationActionSystemConfigurationError
> {
  return Layer.effect(
    ApplicationActionSystem,
    prepareLive(live).pipe(Effect.map(captured =>
      ApplicationActionSystem.of({ invoke: makeInvoke(captured) })
    )),
  );
}

interface PreparedApplicationActionSystemLive
  extends Omit<ApplicationActionSystemLive, "hostPolicyEncodingBudget"> {
  readonly hostPolicySha256: Uint8Array;
}

const prepareLive = Effect.fn("ApplicationActionSystem.prepareLive")(
  function* (
    live: ApplicationActionSystemLive,
  ): Effect.fn.Return<
    PreparedApplicationActionSystemLive,
    ApplicationActionSystemConfigurationError
  > {
    const policy = yield* Effect.fromResult(
      encodeEdgeActionHostPolicyV1(
        live.host.hostPolicy,
        live.hostPolicyEncodingBudget,
      ).pipe(Result.mapError(cause =>
        new ApplicationActionSystemConfigurationError({
          reason: "invalidHostPolicy",
          cause,
        })
      )),
    );
    const hostPolicySha256 = yield* live.host.evidence.authority.sha256.hash(
      policy.canonicalBytes,
    );
    return Object.freeze({
      activation: Object.freeze({ readActive: live.activation.readActive }),
      admission: Object.freeze({ ...live.admission }),
      host: Object.freeze({
        evidence: Object.freeze({
          bodyStore: live.host.evidence.bodyStore,
          bodyBudget: Object.freeze({ ...live.host.evidence.bodyBudget }),
          authority: live.host.evidence.authority,
        }),
        effectRunner: live.host.effectRunner,
        callbackSystem: live.host.callbackSystem,
        outboundHost: live.host.outboundHost,
        hostPolicy: policy.frame,
        runner: live.host.runner,
      }),
      hostPolicySha256: new Uint8Array(hostPolicySha256),
      executionContextFactory: live.executionContextFactory,
    });
  },
);

function makeInvoke(
  live: PreparedApplicationActionSystemLive,
): ApplicationActionSystemApi["invoke"] {
  return Effect.fn("ApplicationActionSystem.invoke")(function* (
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
    const hostPolicySha256 = live.hostPolicySha256;
    const executionIdentity = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueV1(execution.auth),
      catch: cause => new ApplicationActionSystemConfigurationError({
        reason: "invalidExecutionContext",
        cause,
      }),
    });
    let admission: ApplicationActionAdmission | undefined;
    let invocation = yield* inspectApplicationAuthorityActionInvocation(
      requestKey,
      live.host.evidence.authority,
    ).pipe(
      Effect.map(value => value as ApplicationAuthorityActionInvocationProjection | null),
      Effect.catchTag(
        "ApplicationActionInvocationMissingV1Error",
        () => Effect.succeed(null),
      ),
    );
    if (invocation === null) {
      const active = yield* live.activation.readActive();
      admission = yield* selectApplicationActionAdmission(
        active.selection,
        functionRef,
        live.admission,
      );
      const argumentReference = yield* live.host.evidence.bodyStore.putImmutable(
        "action_arguments",
        args.canonicalBytes,
        live.host.evidence.bodyBudget,
      );
      const request = yield* Effect.fromResult(
        encodeApplicationActionInvocationRequestV2({
          scopeId: admission.basis.authority.scopeId,
          requestKey,
          executionAuthoritySha256: admission.executionAuthority.sha256,
          actionFunctionPath: functionRef,
          executionIdentitySha256: executionIdentity.sha256,
          compatibilityDate: admission.basis.compatibilityDate,
          hostPolicySha256,
          arguments: argumentReference,
        }),
      );
      invocation = (yield* admitApplicationAuthorityActionInvocation({
        selection: admission.selection,
        request,
        executionAuthority: admission.executionAuthority,
        invocationId: execution.invocationId,
      }, live.host.evidence.authority)).invocation;
    } else {
      yield* requireReplayIdentity(
        invocation,
        functionRef,
        args.sha256,
        executionIdentity.sha256,
      );
    }
    if (invocation.lifecycle === "executing") {
      invocation = yield* recoverExpiredApplicationAuthorityActionExecution(
        requestKey,
        live.host.evidence.authority,
      ).pipe(Effect.catchIf(
        isNotExpiredRecoveryConflict,
        () => Effect.succeed(invocation!),
      ));
    }
    if (invocation.lifecycle !== "admitted") {
      return yield* projectReplay(invocation, live);
    }
    if (admission === undefined) {
      const active = yield* live.activation.readActive();
      const candidate = yield* selectApplicationActionAdmission(
        active.selection,
        functionRef,
        live.admission,
      );
      if (
        !bytesEqualFullScan(
          candidate.executionAuthority.sha256,
          invocation.executionAuthority.sha256,
        ) || candidate.basis.compatibilityDate !== invocation.compatibilityDate ||
        !bytesEqualFullScan(hostPolicySha256, invocation.hostPolicySha256)
      ) return projectNonCompleted(invocation, "replayed");
      admission = candidate;
    }
    const prepared = yield* prepareApplicationActionDispatch({
      admission,
      invocation,
      execution,
    }, live.host);
    return yield* Effect.matchEffect(
      dispatchPreparedApplicationAction(prepared.bundle),
      {
        onFailure: error =>
          settleDispatchFailure(prepared.settlement, error, live).pipe(
            Effect.flatMap(settled =>
              error instanceof ApplicationExecutionHostError &&
                  error.reason === "applicationError"
                ? Effect.fail(error)
                : Effect.succeed(projectNonCompleted(settled, "settled"))
            ),
          ),
        onSuccess: value =>
          settleDispatchSuccess(prepared.settlement, value, live),
      },
    );
  });
}

const settleDispatchSuccess = Effect.fn(
  "ApplicationActionSystem.settleDispatchSuccess",
)(function* (
  settlement: Parameters<typeof settlePreparedApplicationAction>[0],
  value: CanonicalFlarexRuntimeValueV1,
  live: PreparedApplicationActionSystemLive,
): Effect.fn.Return<InvokeApplicationActionResult, InvokeApplicationActionError> {
  const completed = yield* settlePreparedApplicationAction(
    settlement,
    Object.freeze({ lifecycle: "completed" as const, resultValue: value }),
    live.host.evidence,
  ).pipe(Effect.catchIf(
    isPossibleDispatchConflict,
    () => settlePreparedApplicationAction(
          settlement,
          Object.freeze({
            lifecycle: "uncertain" as const,
            terminalCode: "application_action_success_uncertain",
          }),
          live.host.evidence,
        ),
  ));
  if (completed.lifecycle !== "completed") {
    return projectNonCompleted(completed, "settled");
  }
  return Object.freeze({
    status: "completed" as const,
    disposition: "published" as const,
    invocationId: completed.invocationId,
    value,
  });
});

const projectReplay = Effect.fn("ApplicationActionSystem.projectReplay")(
  function* (
    invocation: ApplicationAuthorityActionInvocationProjection,
    live: PreparedApplicationActionSystemLive,
  ): Effect.fn.Return<InvokeApplicationActionResult, InvokeApplicationActionError> {
    if (invocation.lifecycle !== "completed") {
      return projectNonCompleted(invocation, "replayed");
    }
    if (invocation.result === null) {
      return yield* new ApplicationActionSystemCorruptionError({
        detail: "completedResultMissing",
      });
    }
    const body = yield* live.host.evidence.bodyStore.readImmutable(
      invocation.result,
      live.host.evidence.bodyBudget,
    );
    const decoded = yield* Effect.tryPromise({
      try: () => decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: body.bytes,
        sha256: invocation.result!.sha256,
      }),
      catch: cause => new ApplicationActionSystemCorruptionError({
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

const settleDispatchFailure = Effect.fn(
  "ApplicationActionSystem.settleDispatchFailure",
)(function* (
  settlement: Parameters<typeof settlePreparedApplicationAction>[0],
  error: ApplicationActionRunnerError | ApplicationActionHostCompositionError,
  live: PreparedApplicationActionSystemLive,
) {
  const outcome = failureOutcome(error);
  return yield* settlePreparedApplicationAction(
    settlement,
    outcome,
    live.host.evidence,
  ).pipe(Effect.catchIf(
    settlementError => outcome.lifecycle !== "uncertain" &&
      isPossibleDispatchConflict(settlementError),
    () => settlePreparedApplicationAction(
          settlement,
          Object.freeze({
            lifecycle: "uncertain" as const,
            terminalCode: `${outcome.terminalCode}_uncertain`,
          }),
          live.host.evidence,
        ),
  ));
});

function failureOutcome(
  error: ApplicationActionRunnerError | ApplicationActionHostCompositionError,
) {
  const terminalCode = error instanceof ApplicationExecutionHostError
    ? `application_action_${error.reason}`
    : error instanceof ApplicationActionCapabilitySessionError
    ? `application_action_${error.reason}`
    : "application_action_composition_failed";
  if (
    error instanceof ApplicationActionCapabilitySessionError ||
    (error instanceof ApplicationExecutionHostError &&
      error.reason === "callbackFailed")
  ) return Object.freeze({
    lifecycle: "uncertain" as const,
    terminalCode,
  });
  return Object.freeze({ lifecycle: "failed" as const, terminalCode });
}

function requireReplayIdentity(
  invocation: ApplicationAuthorityActionInvocationProjection,
  functionRef: TransactionFunctionPathV1,
  argumentsSha256: Uint8Array,
  executionIdentitySha256: Uint8Array,
): Effect.Effect<void, ApplicationActionAuthorityV1Error<never>> {
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
    error.operation === "recoverApplication" && error.expected === "expired" &&
    error.actual === "not_expired";
}

function isPossibleDispatchConflict(error: unknown): boolean {
  return error instanceof ApplicationActionLifecycleConflictV1Error &&
    error.operation === "settleApplication" &&
    error.expected === "uncertain_after_possible_dispatch";
}

function projectNonCompleted(
  invocation: ApplicationAuthorityActionInvocationProjection,
  disposition: NonCompletedApplicationAction["disposition"],
): NonCompletedApplicationAction {
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

function captureArguments(input: unknown) {
  return Effect.tryPromise({
    try: () => canonicalizeFlarexValueV1(input),
    catch: cause => new ApplicationActionInputError({
      field: "args",
      cause,
    }),
  }).pipe(Effect.filterOrFail(
    value => isCanonicalFlarexRuntimeObjectV1(value.value),
    () => new ApplicationActionInputError({ field: "args" }),
  ));
}

function captureExecutionContext(
  factory: () => ApplicationActionExecutionContext,
): Effect.Effect<
  ApplicationActionExecutionContext,
  ApplicationActionSystemConfigurationError
> {
  return Effect.try({
    try: () => {
      const value = factory();
      if (
        typeof value.invocationId !== "string" ||
        value.invocationId.trim().length === 0 ||
        !Number.isSafeInteger(value.executionDurationMilliseconds) ||
        value.executionDurationMilliseconds < 1 ||
        !isUint8ArrayWithByteLength(value.randomSeed, 32)
      ) throw new Error("Invalid Application action execution context.");
      return Object.freeze({
        invocationId: value.invocationId,
        executionDurationMilliseconds: value.executionDurationMilliseconds,
        randomSeed: new Uint8Array(value.randomSeed),
        auth: value.auth,
      });
    },
    catch: cause => new ApplicationActionSystemConfigurationError({
      reason: "invalidExecutionContext",
      cause,
    }),
  }).pipe(Effect.flatMap(value =>
    decodeEdgeActionExactRuntimeAuthV1Effect(value.auth).pipe(
      Effect.map(auth => Object.freeze({ ...value, auth })),
      Effect.mapError(cause => new ApplicationActionSystemConfigurationError({
        reason: "invalidExecutionContext",
        cause,
      })),
    )
  ));
}

function decodeInput<A, I>(
  decode: (input: I) => Result.Result<A, unknown>,
  input: I,
  field: ApplicationActionInputError["field"],
): Effect.Effect<A, ApplicationActionInputError> {
  return Effect.fromResult(decode(input)).pipe(
    Effect.mapError(cause => new ApplicationActionInputError({ field, cause })),
  );
}

const decodeFunctionPath = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeRequestKey = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);

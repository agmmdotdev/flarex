import {
  claimActiveApplicationRevisionInvocationBasisV1,
  type ApplicationRevisionActivationContextV1,
  type AuthenticatedActiveApplicationRevisionSelectionV1,
  type InvalidActiveApplicationRevisionSelectionV1Error,
} from
  "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  openApplicationPointQuerySnapshotV1,
  readApplicationPointQueryDocumentV1,
  revalidateApplicationPointQuerySnapshotV1,
  type ApplicationPointQuerySnapshotBudgetV1,
  type InvalidApplicationPointQuerySnapshotV1Error,
  type OpenApplicationPointQuerySnapshotV1Error,
  type ReadApplicationPointQueryDocumentV1Error,
  type RevalidateApplicationPointQuerySnapshotV1Error,
} from
  "@flarex/persistence-postgres/internal/application-point-query-snapshot-v1";
import {
  claimApplicationRevisionQueryInternalCallRuntimeTargetAuthorityV1,
} from
  "@flarex/persistence-postgres/internal/application-revision-query-internal-call-runtime-target-v1";
import {
  prepareCandidateBoundPointQueryInternalCallRuntimeTargetV1,
  validateCandidateBoundPointQueryInternalCallResultV1,
  type CandidateBoundPointQueryInternalCallRuntimeTargetV1,
  type CandidateBoundQueryInternalCallRuntimeDispatchV1Error,
  type CandidateBoundQueryInternalCallRuntimeTargetBudgetV1,
  type InvalidCandidateBoundPointQueryInternalCallRuntimeTargetV1Error,
  type PrepareCandidateBoundPointQueryInternalCallRuntimeTargetV1Error,
} from
  "flarex-backend/internal/candidate-bound-point-query-internal-call-runtime-target-v1";
import type {
  DeclarativeV2RuntimeArtifactR2StoreV1,
} from "flarex-backend/internal/declarative-v2-runtime-artifact-r2-v1";
import { Context, Data, Effect, Layer, Schema, Scope } from "effect";
import {
  POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
  POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
  PointQueryExactRuntimeProtocolV1Error,
  decodePointQueryExactRuntimeRequestV1Effect,
  decodePointQueryExactRuntimeResultV1Effect,
  type PointQueryExactRuntimeRequestV1,
} from "flarex-protocol/point-query-exact-runtime";
import {
  TransactionFunctionPathV1Schema,
  type TransactionFunctionPathV1,
} from "flarex-protocol/transaction-session";
import {
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

export interface ApplicationPointQueryRouteIndependentDispatcherV1 {
  readonly dispatch: (
    target: CandidateBoundPointQueryInternalCallRuntimeTargetV1,
    request: PointQueryExactRuntimeRequestV1,
  ) => Effect.Effect<
    unknown,
    ApplicationPointQueryRouteIndependentDispatchV1Error,
    Scope.Scope
  >;
}

export class ApplicationPointQueryRouteIndependentDispatcherV1Error
  extends Data.TaggedError(
    "ApplicationPointQueryRouteIndependentDispatcherV1Error",
  )<{
    readonly reason:
      | "unavailable"
      | "targetRejected"
      | "invalidRequest"
      | "readBoundary"
      | "userCode"
      | "workerDefinition"
      | "cleanupUncertain";
    readonly cause?: unknown;
  }> {}

/**
 * In-process read failures retain the exact PQV-A1 owner error. Only foreign
 * Worker/host failures use the dispatcher-owned tagged error.
 */
export type ApplicationPointQueryRouteIndependentDispatchV1Error =
  | ApplicationPointQueryRouteIndependentDispatcherV1Error
  | InvalidCandidateBoundPointQueryInternalCallRuntimeTargetV1Error
  | CandidateBoundQueryInternalCallRuntimeDispatchV1Error
  | ReadApplicationPointQueryDocumentV1Error
  | RevalidateApplicationPointQuerySnapshotV1Error;

export class InvalidApplicationPointQueryInputV1Error
  extends Data.TaggedError("InvalidApplicationPointQueryInputV1Error")<{
    readonly field: "functionRef";
  }> {}

export class ApplicationPointQueryActiveSelectionMismatchV1Error
  extends Data.TaggedError(
    "ApplicationPointQueryActiveSelectionMismatchV1Error",
  )<{
    readonly reason: "deployment";
  }> {}

export interface ApplicationPointQueryExecutionContextV1 {
  readonly executionId: string;
  readonly randomSeed: Uint8Array;
  readonly executionTime: number;
}

export interface ApplicationPointQuerySystemLiveV1 {
  readonly deploymentId: string;
  readonly activationContext: ApplicationRevisionActivationContextV1;
  readonly snapshotBudget: ApplicationPointQuerySnapshotBudgetV1;
  readonly runtimeArtifacts: DeclarativeV2RuntimeArtifactR2StoreV1;
  readonly runtimeBudget: CandidateBoundQueryInternalCallRuntimeTargetBudgetV1;
  readonly compatibilityDate: string;
  readonly dispatcher: ApplicationPointQueryRouteIndependentDispatcherV1;
  readonly executionContextFactory: () => ApplicationPointQueryExecutionContextV1;
}

type QuerySnapshotReadErrorV1 =
  | ReadApplicationPointQueryDocumentV1Error
  | RevalidateApplicationPointQuerySnapshotV1Error;

type QueryRuntimeTargetErrorV1 =
  PrepareCandidateBoundPointQueryInternalCallRuntimeTargetV1Error<
    | Effect.Error<ReturnType<
        typeof claimApplicationRevisionQueryInternalCallRuntimeTargetAuthorityV1
      >>
    | QuerySnapshotReadErrorV1
  >;

export type InvokeApplicationPointQueryV1Error =
  | InvalidApplicationPointQueryInputV1Error
  | InvalidActiveApplicationRevisionSelectionV1Error
  | InvalidApplicationPointQuerySnapshotV1Error
  | OpenApplicationPointQuerySnapshotV1Error
  | QueryRuntimeTargetErrorV1
  | InvalidCandidateBoundPointQueryInternalCallRuntimeTargetV1Error
  | CandidateBoundQueryInternalCallRuntimeDispatchV1Error
  | PointQueryExactRuntimeProtocolV1Error
  | ApplicationPointQueryRouteIndependentDispatchV1Error
  | ApplicationPointQueryActiveSelectionMismatchV1Error;

export interface ApplicationPointQuerySystemV1Api {
  readonly invoke: (
    activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
    functionRef: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    InvokeApplicationPointQueryV1Error,
    Scope.Scope
  >;
}

export class ApplicationPointQuerySystemV1 extends Context.Service<
  ApplicationPointQuerySystemV1,
  ApplicationPointQuerySystemV1Api
>()("flarex/standard-application-invocation/ApplicationPointQuerySystemV1") {}

/**
 * Private SAP05 System Application Data operation. It returns only the
 * validated query value and owns no durable outcome or publication identity.
 */
export const invokeApplicationPointQueryV1 = Effect.fn(
  "ApplicationPointQuery.invokeV1",
)(function* (
  activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionRef: TransactionFunctionPathV1,
  args: unknown,
): Effect.fn.Return<
  CanonicalFlarexRuntimeValueV1,
  InvokeApplicationPointQueryV1Error,
  ApplicationPointQuerySystemV1 | Scope.Scope
> {
  const system = yield* ApplicationPointQuerySystemV1;
  return yield* system.invoke(activeRevision, functionRef, args);
});

export function makeApplicationPointQuerySystemV1Layer(
  live: ApplicationPointQuerySystemLiveV1,
): Layer.Layer<ApplicationPointQuerySystemV1> {
  return Layer.succeed(
    ApplicationPointQuerySystemV1,
    ApplicationPointQuerySystemV1.of({ invoke: makeInvoke(live) }),
  );
}

function makeInvoke(
  live: ApplicationPointQuerySystemLiveV1,
): ApplicationPointQuerySystemV1Api["invoke"] {
  return Effect.fn("ApplicationPointQuerySystem.invoke")(function* (
    activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
    functionRefInput: TransactionFunctionPathV1,
    argsInput: unknown,
  ) {
    const functionRef = yield* Effect.fromResult(
      decodeFunctionPath(functionRefInput),
    ).pipe(Effect.mapError(() => new InvalidApplicationPointQueryInputV1Error({
      field: "functionRef",
    })));
    const argumentsProjection = yield* Effect.try({
      try: () => normalizeFlarexValueV1(argsInput),
      catch: cause => new PointQueryExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidArguments",
        cause,
      }),
    });
    const invocationBasis = yield* Effect.fromResult(
      claimActiveApplicationRevisionInvocationBasisV1(activeRevision),
    );
    if (invocationBasis.deploymentId !== live.deploymentId) {
      return yield* new ApplicationPointQueryActiveSelectionMismatchV1Error({
        reason: "deployment",
      });
    }
    const snapshot = yield* openApplicationPointQuerySnapshotV1(
      activeRevision,
      functionRef,
      live.snapshotBudget,
      live.activationContext,
    );
    const runtimeTarget = yield* prepareCandidateBoundPointQueryInternalCallRuntimeTargetV1(
      activeRevision,
      snapshot.capability,
      functionRef,
      Object.freeze({
        claim: claimApplicationRevisionQueryInternalCallRuntimeTargetAuthorityV1,
      }),
      Object.freeze({
        revalidate: revalidateApplicationPointQuerySnapshotV1,
        read: readApplicationPointQueryDocumentV1,
      }),
      live.runtimeArtifacts,
      live.runtimeBudget,
      live.compatibilityDate,
    );
    const executionContext = yield* Effect.sync(
      () => live.executionContextFactory(),
    );
    const request = yield* decodePointQueryExactRuntimeRequestV1Effect({
      format: POINT_QUERY_EXACT_RUNTIME_FORMAT_V1,
      version: POINT_QUERY_EXACT_RUNTIME_VERSION_V1,
      runtimeTargetSha256: runtimeTarget.runtimeTargetSha256,
      artifact: runtimeTarget.artifact,
      function: runtimeTarget.function,
      auth: ANONYMOUS_AUTH,
      arguments: argumentsProjection.value,
      argumentSemanticBytes: argumentsProjection.semanticSizeBytes,
      tables: runtimeTarget.tables,
      context: {
        ...executionContext,
        snapshotCommitSeq: runtimeTarget.snapshotCommitSeq,
      },
    });
    const dispatched = yield* live.dispatcher.dispatch(
      runtimeTarget.target,
      request,
    );
    const decoded = yield* decodePointQueryExactRuntimeResultV1Effect(dispatched);
    return yield* validateCandidateBoundPointQueryInternalCallResultV1(
      runtimeTarget.target,
      decoded.value,
    );
  });
}

const decodeFunctionPath = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);

const ANONYMOUS_AUTH = Object.freeze({ kind: "anonymous" as const });

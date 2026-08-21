import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  TaskComputeCancellationRejectedError,
  TaskComputeCancellationStaleError,
  TaskComputeCancellationTransportError,
  TaskComputeCancellationUncertainError,
  TaskComputeDispatchConflictError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchTransportError,
  TaskComputeDispatchUncertainError,
  TaskComputeExecutionIdV1Schema,
  TaskComputeProvider,
  decodeTaskComputeProviderDescriptorV1,
  makeTaskComputeProviderV1,
  snapshotTaskComputeCancellationReceiptV1,
  snapshotTaskComputeDispatchAcceptanceV1,
  type CurrentTaskComputeDispatchRequestV1,
  type TaskComputeCancellationErrorV1,
  type TaskComputeCancellationReceiptV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchAcceptanceV1,
  type TaskComputeDispatchErrorV1,
  type TaskComputeExecutionIdV1,
  type TaskComputeExecutionRefV1,
  type TaskComputeProviderDescriptorV1,
  type TaskComputeProviderShape,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  makeLiveStandardApplicationTaskSha256V1,
  type StandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { RpcTarget } from "cloudflare:workers";
import {
  Cause,
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
  type ApplicationTaskWorkerInputCapabilityV1,
} from "flarex-protocol/internal/application-task-worker-v1";
import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import {
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
} from "flarex-protocol/internal/task-worker-session-v1";
import {
  decodeCanonicalFlarexValueEvidenceV1,
} from "flarex-protocol/value";

import {
  type ApplicationTaskWorkerHostPolicy,
  ApplicationTaskWorkerDefinitionError,
  makeApplicationTaskWorkerDefinition,
} from "../artifactRuntime/ApplicationTaskWorkerDefinition";
import {
  type LegacyTaskWorkerHostPolicy,
  LegacyTaskWorkerDefinitionError,
  makeLegacyTaskWorkerDefinition,
} from "../artifactRuntime/LegacyTaskWorkerDefinition";
import {
  type TaskWorkerSession,
  type TaskWorkerSessionHost,
  TaskWorkerSessionHostError,
  makeTaskWorkerSessionHost,
} from "../artifactRuntime/TaskWorkerSessionHost";
import {
  TaskRuntimeLaunchAuthority,
  type TaskRuntimeLaunchAuthorityShape,
} from "../taskRuntimeLaunch/Authority";
import {
  TaskRuntimeLaunchHashError,
  TaskRuntimeLaunchPortError,
  TaskRuntimeLaunchValidationError,
  type CurrentTaskRuntimeLaunchSubject,
  type TaskRuntimeInputSource,
} from "../taskRuntimeLaunch/Model";
import type {
  TaskAttemptSupervisor,
  TaskAttemptSupervisorError,
  TaskAttemptSupervisorInput,
  TaskAttemptSupervisorOutcome,
} from "./TaskAttemptSupervisor.js";
import {
  makeApplicationTaskQueryCallbackCapability,
  type ApplicationTaskQueryCallbackAuthority,
} from "./ApplicationTaskQueryCallback.js";
import {
  makeApplicationTaskMutationCallbackCapability,
  type ApplicationTaskMutationCallbackAuthority,
  type ApplicationTaskMutationCallbackLease,
} from "./ApplicationTaskMutationCallback.js";

export const WORKER_LOADER_TASK_COMPUTE_PROVIDER_NAME =
  "flarex-worker-loader" as const;
export const WORKER_LOADER_TASK_COMPUTE_PROVIDER_VERSION =
  "task-worker-session-v1" as const;

const DEFAULT_MAXIMUM_SCOPED_DISPATCHES = 4_096;
const EXECUTION_ID_PREFIX = "task-worker-";

export class WorkerLoaderTaskComputeProviderConfigurationError
  extends Data.TaggedError("WorkerLoaderTaskComputeProviderConfigurationError")<{
    readonly reason: "invalid_options";
    readonly cause?: unknown;
  }>
{}

export interface WorkerLoaderTaskComputeProviderOptions {
  readonly applicationHostPolicy: ApplicationTaskWorkerHostPolicy;
  readonly applicationQueryAuthority: ApplicationTaskQueryCallbackAuthority;
  readonly applicationMutationAuthority: ApplicationTaskMutationCallbackAuthority;
  readonly legacyHostPolicy: LegacyTaskWorkerHostPolicy;
  /** Hard admission ceiling for the lifetime of this private provider Layer. */
  readonly maximumScopedDispatches?: number;
  readonly handshakeMilliseconds?: number;
  readonly randomUuid?: () => string;
  readonly sha256?: StandardApplicationTaskSha256V1;
}

interface CapturedOptions {
  readonly descriptor: TaskComputeProviderDescriptorV1;
  readonly applicationHostPolicy: ApplicationTaskWorkerHostPolicy;
  readonly applicationQueryAuthority: ApplicationTaskQueryCallbackAuthority;
  readonly applicationMutationAuthority: ApplicationTaskMutationCallbackAuthority;
  readonly legacyHostPolicy: LegacyTaskWorkerHostPolicy;
  readonly maximumScopedDispatches: number;
  readonly randomUuid: () => string;
  readonly sha256: StandardApplicationTaskSha256V1;
  readonly handshakeMilliseconds: number | undefined;
}

interface CapturedProviderOptions extends CapturedOptions {
  readonly sessionSupervisor: TaskAttemptSupervisor | undefined;
  readonly supervisionObserver:
    | TaskAttemptSupervisionObserver
    | undefined;
}

export interface TaskAttemptSupervisionObserver {
  readonly admit: () => void;
  readonly observe: (
    observation: Readonly<{
      readonly dispatch: TaskAttemptSupervisorInput["dispatch"];
      readonly acceptance: TaskWorkerSession["acceptance"];
    }>,
    exit: Exit.Exit<
      TaskAttemptSupervisorOutcome,
      TaskAttemptSupervisorError
    >,
  ) => void;
}

export interface TaskComputeDeliverySupervisionControlShape {
  readonly quiesce: () => Effect.Effect<void>;
}

export class TaskComputeDeliverySupervisionControl
  extends Context.Service<
    TaskComputeDeliverySupervisionControl,
    TaskComputeDeliverySupervisionControlShape
  >()("flarex-backend/taskComputeDelivery/SupervisionControl") {}

interface StartingDispatch {
  readonly phase: "starting";
  readonly request: CurrentTaskComputeDispatchRequestV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly completion: Deferred.Deferred<
    TaskComputeDispatchAcceptanceV1,
    TaskComputeDispatchErrorV1
  >;
}

interface ActiveDispatch {
  readonly phase: "active";
  readonly request: CurrentTaskComputeDispatchRequestV1;
  readonly acceptance: TaskComputeDispatchAcceptanceV1;
  readonly session: TaskWorkerSession;
  readonly cancellationSemaphore: Semaphore.Semaphore;
  readonly cancellationState: Ref.Ref<CancellationState>;
}

interface CancellationState {
  readonly acceptedGeneration:
    TaskComputeCancellationRequestV1["cancellationGeneration"];
  readonly receipt: TaskComputeCancellationReceiptV1 | undefined;
}

interface UncertainDispatch {
  readonly phase: "uncertain";
  readonly request: CurrentTaskComputeDispatchRequestV1;
  readonly failure: TaskComputeDispatchUncertainError;
}

interface SettledDispatch {
  readonly phase: "settled";
  readonly request: CurrentTaskComputeDispatchRequestV1;
  readonly acceptance: TaskComputeDispatchAcceptanceV1;
}

type DispatchState =
  | StartingDispatch
  | ActiveDispatch
  | UncertainDispatch
  | SettledDispatch;

interface ProviderState {
  readonly closing: boolean;
  readonly acceptingDispatches: boolean;
  readonly dispatches: ReadonlyMap<string, DispatchState>;
  readonly inFlightClassifications: ReadonlySet<StartingDispatch["completion"]>;
}

interface ProviderBundle {
  readonly provider: TaskComputeProviderShape;
  readonly supervisionControl: TaskComputeDeliverySupervisionControlShape;
}

type DispatchClaim =
  | Readonly<{ readonly kind: "replay"; readonly acceptance: TaskComputeDispatchAcceptanceV1 }>
  | Readonly<{
      readonly kind: "await_start";
      readonly completion: StartingDispatch["completion"];
    }>
  | Readonly<{ readonly kind: "start"; readonly state: StartingDispatch }>;

const decodeExecutionId = Schema.decodeUnknownResult(TaskComputeExecutionIdV1Schema);

export function makeWorkerLoaderTaskComputeProviderLayer(
  loader: WorkerLoader,
  options: WorkerLoaderTaskComputeProviderOptions,
): Layer.Layer<
  TaskComputeProvider | TaskComputeDeliverySupervisionControl,
  WorkerLoaderTaskComputeProviderConfigurationError,
  TaskRuntimeLaunchAuthority
> {
  return makeWorkerLoaderTaskComputeProviderLayerInternal(
    loader,
    options,
    undefined,
    undefined,
  );
}

/**
 * E4-private adapter seam. It preserves the provider-neutral public contract
 * while handing each owned accepted Worker session to exactly one supervisor.
 */
export function makeSupervisedWorkerLoaderTaskComputeProviderLayer(
  loader: WorkerLoader,
  options: WorkerLoaderTaskComputeProviderOptions,
  supervisor: TaskAttemptSupervisor,
  supervisionObserver: TaskAttemptSupervisionObserver,
): Layer.Layer<
  TaskComputeProvider | TaskComputeDeliverySupervisionControl,
  WorkerLoaderTaskComputeProviderConfigurationError,
  TaskRuntimeLaunchAuthority
> {
  return makeWorkerLoaderTaskComputeProviderLayerInternal(
    loader,
    options,
    supervisor,
    supervisionObserver,
  );
}

function makeWorkerLoaderTaskComputeProviderLayerInternal(
  loader: WorkerLoader,
  options: WorkerLoaderTaskComputeProviderOptions,
  supervisor: TaskAttemptSupervisor | undefined,
  supervisionObserver: TaskAttemptSupervisionObserver | undefined,
): Layer.Layer<
  TaskComputeProvider | TaskComputeDeliverySupervisionControl,
  WorkerLoaderTaskComputeProviderConfigurationError,
  TaskRuntimeLaunchAuthority
> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const authority = yield* TaskRuntimeLaunchAuthority;
      const capturedOptions = yield* Effect.fromResult(captureOptions(options));
      const captured: CapturedProviderOptions = Object.freeze({
        ...capturedOptions,
        sessionSupervisor: supervisor,
        supervisionObserver,
      });
      const host = yield* Effect.try({
        try: () => makeTaskWorkerSessionHost(
          captureWorkerLoader(loader),
          captured.handshakeMilliseconds === undefined
            ? {}
            : { handshakeMilliseconds: captured.handshakeMilliseconds },
        ),
        catch: cause => configurationError(cause),
      });
      const bundle = yield* makeWorkerLoaderTaskComputeProvider(
        authority,
        host,
        captured,
      );
      return Context.make(TaskComputeProvider, bundle.provider).pipe(
        Context.add(
          TaskComputeDeliverySupervisionControl,
          bundle.supervisionControl,
        ),
      );
    }),
  );
}

const makeWorkerLoaderTaskComputeProvider = Effect.fn(
  "WorkerLoaderTaskComputeProvider.make",
)(function* (
  authority: TaskRuntimeLaunchAuthorityShape,
  host: TaskWorkerSessionHost,
  options: CapturedProviderOptions,
): Effect.fn.Return<ProviderBundle, never, Scope.Scope> {
  const providerScope = yield* Scope.Scope;
  const stateRef = yield* Ref.make<ProviderState>(Object.freeze({
    closing: false,
    acceptingDispatches: true,
    dispatches: new Map(),
    inFlightClassifications: new Set<StartingDispatch["completion"]>(),
  }));

  yield* Effect.addFinalizer(() => Effect.gen(function* () {
    const previous = yield* Ref.getAndSet(stateRef, Object.freeze({
      closing: true,
      acceptingDispatches: false,
      dispatches: new Map(),
      inFlightClassifications: new Set<StartingDispatch["completion"]>(),
    }));
    const active = [...previous.dispatches.values()].filter(
      (state): state is ActiveDispatch => state.phase === "active",
    );
    yield* Effect.forEach(
      active,
      state => Effect.exit(state.session.close),
      { concurrency: 16, discard: true },
    );
  }));

  const implementation: TaskComputeProviderShape = Object.freeze({
    dispatch: Effect.fn("WorkerLoaderTaskComputeProvider.dispatch")(
      request => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const claim = yield* Ref.modify(
          stateRef,
          state => claimDispatch(state, request, options),
        ).pipe(Effect.flatMap(Effect.fromResult));
        if (claim.kind === "replay") return claim.acceptance;
        if (claim.kind === "start") {
          yield* Effect.forkIn(
            completeStart(
              stateRef,
              authority,
              host,
              options,
              providerScope,
              claim.state,
            ),
            providerScope,
            { startImmediately: true },
          );
        }
        return yield* restore(Deferred.await(
          claim.kind === "start" ? claim.state.completion : claim.completion,
        ));
      })),
    ),
    requestCancellation: Effect.fn(
      "WorkerLoaderTaskComputeProvider.requestCancellation",
    )(request => Effect.gen(function* () {
      const providerState = yield* Ref.get(stateRef);
      const state = yield* Effect.fromResult(findActiveDispatch(
        providerState.dispatches,
        request,
      ));
      return yield* state.cancellationSemaphore.withPermit(
        deliverCancellation(stateRef, state, request),
      );
    })),
  });
  const quiesce = Effect.fn(
    "WorkerLoaderTaskComputeProvider.quiesceSupervision",
  )(function* () {
    const completions = yield* Ref.modify(stateRef, state => {
      const classifications = [...state.inFlightClassifications];
      return [classifications, state.acceptingDispatches
        ? Object.freeze({
            closing: state.closing,
            acceptingDispatches: false,
            dispatches: state.dispatches,
            inFlightClassifications: state.inFlightClassifications,
          })
        : state] as const;
    });
    yield* Effect.forEach(
      completions,
      completion => Effect.exit(Deferred.await(completion)),
      { concurrency: 16, discard: true },
    );
  });
  return Object.freeze({
    provider: makeTaskComputeProviderV1(implementation),
    supervisionControl: TaskComputeDeliverySupervisionControl.of(Object.freeze({
      quiesce,
    })),
  });
});

function claimDispatch(
  state: ProviderState,
  request: CurrentTaskComputeDispatchRequestV1,
  options: CapturedOptions,
): readonly [
  Result.Result<DispatchClaim, TaskComputeDispatchErrorV1>,
  ProviderState,
] {
  if (state.closing || !state.acceptingDispatches) {
    return [Result.fail(new TaskComputeDispatchRejectedError({
      operation: "dispatch",
      reason: "provider_disabled",
      retryable: true,
      computeProfile: request.computeProfile,
    })), state];
  }
  const key = dispatchIdentityKey(request);
  const existing = state.dispatches.get(key);
  if (existing !== undefined) {
    if (!dispatchRequestsEqual(existing.request, request)) {
      return [Result.fail(new TaskComputeDispatchConflictError({
        identity: request.identity,
        reason: "dispatch_request_mismatch",
      })), state];
    }
    if (existing.phase === "active" || existing.phase === "settled") {
      return [Result.succeed(Object.freeze({
        kind: "replay" as const,
        acceptance: existing.acceptance,
      })), state];
    }
    if (existing.phase === "starting") {
      return [Result.succeed(Object.freeze({
        kind: "await_start" as const,
        completion: existing.completion,
      })), state];
    }
    return [Result.fail(existing.failure), state];
  }
  if (state.dispatches.size >= options.maximumScopedDispatches) {
    return [Result.fail(new TaskComputeDispatchRejectedError({
      operation: "dispatch",
      reason: "capacity_unavailable",
      retryable: true,
      computeProfile: request.computeProfile,
    })), state];
  }
  return Result.match(allocateExecutionId(options, request), {
    onFailure: failure => [Result.fail(failure), state] as const,
    onSuccess: executionId => {
      const starting = Object.freeze({
        phase: "starting" as const,
        request,
        executionId,
        completion: Deferred.makeUnsafe<
          TaskComputeDispatchAcceptanceV1,
          TaskComputeDispatchErrorV1
        >(),
      });
      return [
        Result.succeed(Object.freeze({ kind: "start" as const, state: starting })),
        addStartingDispatchState(state, key, starting),
      ] as const;
    },
  });
}

const completeStart = Effect.fn("WorkerLoaderTaskComputeProvider.completeStart")(
  (
    stateRef: Ref.Ref<ProviderState>,
    authority: TaskRuntimeLaunchAuthorityShape,
    host: TaskWorkerSessionHost,
    options: CapturedProviderOptions,
    providerScope: Scope.Scope,
    starting: StartingDispatch,
  ) => Effect.gen(function* () {
    const started = yield* Effect.exit(startDispatch(
      authority,
      host,
      options,
      starting.request,
      starting.executionId,
    ).pipe(Effect.provideService(Scope.Scope, providerScope)));
    const key = dispatchIdentityKey(starting.request);
    if (Exit.isSuccess(started)) {
      const active = started.value;
      const retained = yield* Ref.modify(stateRef, state => {
        if (state.closing || state.dispatches.get(key) !== starting) {
          return [false, state] as const;
        }
        return [true, setDispatchState(state, key, active)] as const;
      });
      if (!retained) {
        yield* Effect.exit(active.session.close);
        yield* Deferred.done(starting.completion, Exit.fail(
          providerDisabled(starting.request),
        ));
        return;
      }
      yield* Effect.forkIn(
        superviseSession(
          stateRef,
          active,
          options.sessionSupervisor,
          options.supervisionObserver,
        ),
        providerScope,
        { startImmediately: true },
      );
      options.supervisionObserver?.admit();
      yield* Deferred.done(starting.completion, Exit.succeed(active.acceptance));
      return;
    }
    const failure = Cause.findErrorOption(started.cause);
    if (Option.isSome(failure) &&
      failure.value instanceof TaskComputeDispatchUncertainError) {
      const uncertainFailure = failure.value;
      yield* Ref.update(stateRef, state => state.closing ||
          state.dispatches.get(key) !== starting
        ? state
        : setDispatchState(state, key, Object.freeze({
            phase: "uncertain" as const,
            request: starting.request,
            failure: uncertainFailure,
          })));
    } else {
      yield* Ref.update(stateRef, state => state.dispatches.get(key) === starting
        ? deleteDispatchState(state, key)
        : state);
    }
    yield* Deferred.done(starting.completion, Exit.failCause(started.cause));
  }).pipe(Effect.ensuring(
    Ref.update(stateRef, state => removeInFlightClassification(state, starting)),
  )),
);

const startDispatch = Effect.fn("WorkerLoaderTaskComputeProvider.startDispatch")(
  function* (
    authority: TaskRuntimeLaunchAuthorityShape,
    host: TaskWorkerSessionHost,
    options: CapturedOptions,
    request: CurrentTaskComputeDispatchRequestV1,
    executionId: TaskComputeExecutionIdV1,
  ): Effect.fn.Return<
    ActiveDispatch,
    TaskComputeDispatchErrorV1,
    Scope.Scope
  > {
    const subject = yield* authority.resolve(request).pipe(
      Effect.mapError(cause => mapLaunchFailure(request, cause)),
    );
    const capability = new TaskWorkerInputCapabilityTarget(subject.input);
    const session = subject.generation === "application_v1"
      ? yield* Effect.gen(function* () {
          const definition = yield* makeApplicationTaskWorkerDefinition({
            source: subject.source,
            target: subject.runtimeTarget,
            runtimeTargetSha256:
              subject.request.applicationTaskRuntimeTargetSha256,
            manifest: subject.manifest,
            hostPolicy: options.applicationHostPolicy,
            sha256: options.sha256,
          }).pipe(Effect.mapError(cause => mapDefinitionFailure(request, cause)));
          const querySession = yield* Effect.fromResult(
            options.applicationQueryAuthority.bindLaunch({
              creationAuthority: subject.creationAuthority,
              runtimeTarget: subject.runtimeTarget,
              executionIdentity: subject.executionIdentity,
            }),
          ).pipe(Effect.mapError(cause => new TaskComputeDispatchTransportError({
            operation: "dispatch",
            retryable: false,
            cause,
          })));
          const mutationSession = yield*
            options.applicationMutationAuthority.bindLaunch({
              request: subject.request,
              creationAuthority: subject.creationAuthority,
              runtimeTarget: subject.runtimeTarget,
              executionIdentity: subject.executionIdentity,
            }).pipe(Effect.mapError(cause => new TaskComputeDispatchTransportError({
              operation: "dispatch",
              retryable: cause.reason === "integrationFailure",
              cause,
            })));
          const startedAt = yield* Clock.currentTimeMillis;
          const queryCapabilityLease = makeApplicationTaskQueryCallbackCapability(
            querySession,
            {
              executionId,
              absoluteTaskDeadlineMs: Math.min(
                Number.MAX_SAFE_INTEGER,
                startedAt + request.maximumDurationMs,
              ),
            },
          );
          const mutationCapabilityLease =
            makeApplicationTaskMutationCallbackCapability(
              mutationSession,
              {
                executionId,
                absoluteTaskDeadlineMs: Math.min(
                  Number.MAX_SAFE_INTEGER,
                  startedAt + request.maximumDurationMs,
                ),
              },
            );
          const startedSession = yield* Effect.acquireRelease(
            host.start({
              generation: "application_v1",
              definition,
              request: Object.freeze({
                format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
                version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
                dispatch: subject.request,
              }),
              capability,
              queryCapability: queryCapabilityLease.capability,
              mutationCapability: mutationCapabilityLease.capability,
              executionId,
            }).pipe(
              Effect.mapError(cause => mapStartFailure(request, cause)),
              Effect.onExit(exit => Exit.isFailure(exit)
                ? closeApplicationCallbackLeasesWithinDeadline(
                  queryCapabilityLease,
                  mutationCapabilityLease,
                ).pipe(Effect.mapError(cause => mapStartFailure(request, cause)))
                : Effect.void),
            ),
            session => closeBothApplicationSessionOwners(
              closeApplicationCallbackLeasesWithinDeadline(
                queryCapabilityLease,
                mutationCapabilityLease,
              ),
              session.close,
            ).pipe(
              Effect.exit,
              Effect.asVoid,
            ),
            { interruptible: true },
          );
          return withApplicationCallbackCapabilities(
            startedSession,
            queryCapabilityLease,
            mutationCapabilityLease,
          );
        })
      : yield* Effect.gen(function* () {
          const definition = yield* makeLegacyTaskWorkerDefinition({
            subject,
            hostPolicy: options.legacyHostPolicy,
            sha256: options.sha256,
          }).pipe(Effect.mapError(cause => mapDefinitionFailure(request, cause)));
          return yield* Effect.acquireRelease(
            host.start({
              generation: "legacy_dynamic_worker_v1",
              definition,
              request: Object.freeze({
                format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
                version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
                dispatch: subject.request,
              }),
              capability,
              executionId,
            }).pipe(Effect.mapError(cause => mapStartFailure(request, cause))),
            session => Effect.exit(session.close).pipe(Effect.asVoid),
            { interruptible: true },
          );
        });
    const execution: TaskComputeExecutionRefV1 = Object.freeze({
      ...options.descriptor,
      executionId,
    });
    const acceptance = snapshotTaskComputeDispatchAcceptanceV1({
      version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
      kind: "accepted",
      identity: request.identity,
      execution,
    });
    return {
      phase: "active",
      request,
      acceptance,
      session,
      cancellationSemaphore: Semaphore.makeUnsafe(1),
      cancellationState: Ref.makeUnsafe<CancellationState>(Object.freeze({
        acceptedGeneration: request.cancellation.generation,
        receipt: undefined,
      })),
    };
  },
);

function superviseSession(
  stateRef: Ref.Ref<ProviderState>,
  active: ActiveDispatch,
  supervisor: TaskAttemptSupervisor | undefined,
  exitObserver: TaskAttemptSupervisionObserver | undefined,
): Effect.Effect<void> {
  const supervision = supervisor === undefined || exitObserver === undefined
    ? Effect.exit(active.session.settlement).pipe(
        Effect.asVoid,
        Effect.ensuring(Effect.exit(active.session.close)),
      )
    : Effect.suspend(() => {
        const input = Object.freeze({
          dispatch: active.request,
          session: active.session,
        });
        const observation = Object.freeze({
          dispatch: active.request,
          acceptance: active.session.acceptance,
        });
        return Effect.exit(supervisor.supervise(input)).pipe(
          Effect.tap(exit => Effect.sync(() => {
            exitObserver.observe(observation, exit);
          })),
          Effect.asVoid,
        );
      });
  return supervision.pipe(
    Effect.ensuring(Ref.update(stateRef, state => {
      const key = dispatchIdentityKey(active.request);
      if (state.dispatches.get(key) !== active) return state;
      return setDispatchState(state, key, Object.freeze({
        phase: "settled" as const,
        request: active.request,
        acceptance: active.acceptance,
      }));
    })),
    Effect.asVoid,
  );
}

function withApplicationCallbackCapabilities(
  session: TaskWorkerSession,
  queryCapability: Readonly<{ readonly close: () => void }>,
  mutationCapability: ApplicationTaskMutationCallbackLease,
): TaskWorkerSession {
  const closeCallbacks = closeApplicationCallbackLeasesWithinDeadline(
    queryCapability,
    mutationCapability,
  );
  return Object.freeze({
    ...session,
    maximumCloseMilliseconds: Math.max(
      session.maximumCloseMilliseconds,
      mutationCapability.maximumCloseMilliseconds,
    ),
    settlement: session.settlement.pipe(Effect.tap(() => closeCallbacks)),
    close: closeBothApplicationSessionOwners(closeCallbacks, session.close),
  });
}

function closeApplicationCallbackLeasesWithinDeadline(
  queryCapability: Readonly<{ readonly close: () => void }>,
  mutationCapability: ApplicationTaskMutationCallbackLease,
): Effect.Effect<void, TaskWorkerSessionHostError> {
  return closeApplicationCallbackLeases(
    queryCapability,
    mutationCapability,
  ).pipe(Effect.timeoutOrElse({
    duration: `${mutationCapability.maximumCloseMilliseconds} millis`,
    orElse: () => Effect.fail(new TaskWorkerSessionHostError({
      operation: "close",
      reason: "timedOut",
    })),
  }));
}

function closeApplicationCallbackLeases(
  queryCapability: Readonly<{ readonly close: () => void }>,
  mutationCapability: ApplicationTaskMutationCallbackLease,
): Effect.Effect<void, TaskWorkerSessionHostError> {
  return Effect.all([
    Effect.exit(mutationCapability.close.pipe(Effect.mapError(cause =>
      new TaskWorkerSessionHostError({
        operation: "close",
        reason: "cleanupFailed",
        cause,
      })
    ))),
    Effect.exit(Effect.sync(() => queryCapability.close())),
  ], { concurrency: "unbounded" }).pipe(
    Effect.flatMap(([mutation, query]) => mergeCleanupExits(mutation, query)),
  );
}

function closeBothApplicationSessionOwners(
  callbacks: Effect.Effect<void, TaskWorkerSessionHostError>,
  session: TaskWorkerSession["close"],
): TaskWorkerSession["close"] {
  return Effect.all([
    Effect.exit(callbacks),
    Effect.exit(session),
  ], { concurrency: "unbounded" }).pipe(
    Effect.flatMap(([callbackExit, sessionExit]) =>
      mergeCleanupExits(callbackExit, sessionExit)
    ),
  );
}

function mergeCleanupExits<LeftFailure, RightFailure>(
  left: Exit.Exit<void, LeftFailure>,
  right: Exit.Exit<void, RightFailure>,
): Effect.Effect<void, LeftFailure | RightFailure> {
  return Exit.match(left, {
    onSuccess: () => Exit.match(right, {
      onSuccess: () => Effect.void,
      onFailure: Effect.failCause,
    }),
    onFailure: leftCause => Exit.match(right, {
      onSuccess: () => Effect.failCause(leftCause),
      onFailure: rightCause => Effect.failCause(
        Cause.combine(leftCause, rightCause),
      ),
    }),
  });
}

function findActiveDispatch(
  states: ReadonlyMap<string, DispatchState>,
  request: TaskComputeCancellationRequestV1,
): Result.Result<ActiveDispatch, TaskComputeCancellationRejectedError> {
  const state = states.get(dispatchIdentityKey(request));
  if (state === undefined || state.phase !== "active") {
    return Result.fail(new TaskComputeCancellationRejectedError({
      operation: "request_cancellation",
      reason: "execution_not_found",
      retryable: false,
    }));
  }
  if (!executionRefsEqual(state.acceptance.execution, request.execution)) {
    return Result.fail(new TaskComputeCancellationRejectedError({
      operation: "request_cancellation",
      reason: "execution_mismatch",
      retryable: false,
    }));
  }
  return Result.succeed(state);
}

function deliverCancellation(
  stateRef: Ref.Ref<ProviderState>,
  active: ActiveDispatch,
  request: TaskComputeCancellationRequestV1,
): Effect.Effect<TaskComputeCancellationReceiptV1, TaskComputeCancellationErrorV1> {
  return Effect.gen(function* () {
    const providerState = yield* Ref.get(stateRef);
    if (providerState.dispatches.get(dispatchIdentityKey(request)) !== active) {
      return yield* cancellationRejected("execution_not_found");
    }
    const cancellation = yield* Ref.get(active.cancellationState);
    if (request.cancellationGeneration < cancellation.acceptedGeneration) {
      return yield* new TaskComputeCancellationStaleError({
        identity: request.identity,
        receivedGeneration: request.cancellationGeneration,
        acceptedGeneration: cancellation.acceptedGeneration,
      });
    }
    if (request.cancellationGeneration === cancellation.acceptedGeneration) {
      return cancellation.receipt ?? cancellationReceipt(request);
    }
    const receipt = yield* active.session.requestInterruption(Object.freeze({
      format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
      version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
      generation: "applicationTaskRuntimeTargetSha256" in active.request
        ? "application_v1"
        : "legacy_dynamic_worker_v1",
      identity: request.identity,
      executionId: request.execution.executionId,
      cancellationGeneration: request.cancellationGeneration,
      reason: "cancellation_requested" as const,
    })).pipe(Effect.mapError(cause => mapCancellationFailure(request, cause)));
    const accepted = snapshotTaskComputeCancellationReceiptV1({
      version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
      kind: "interruption_requested",
      identity: request.identity,
      execution: request.execution,
      cancellationGeneration: request.cancellationGeneration,
    });
    yield* Ref.set(active.cancellationState, Object.freeze({
      acceptedGeneration: accepted.cancellationGeneration,
      receipt: accepted,
    }));
    return accepted;
  });
}

class TaskWorkerInputCapabilityTarget
  extends RpcTarget
  implements ApplicationTaskWorkerInputCapabilityV1
{
  readonly #source: TaskRuntimeInputSource;

  constructor(source: TaskRuntimeInputSource) {
    super();
    this.#source = source;
  }

  read(): Promise<unknown> {
    return Effect.runPromise(this.#source.read().pipe(
      Effect.flatMap(canonicalBytes => Effect.tryPromise({
        try: () => decodeCanonicalFlarexValueEvidenceV1({
          canonicalBytes,
          sha256: this.#source.reference.sha256,
        }),
        catch: cause => cause,
      })),
      Effect.map(canonical => canonical.value),
    ));
  }
}

function cancellationReceipt(
  request: TaskComputeCancellationRequestV1,
): TaskComputeCancellationReceiptV1 {
  return snapshotTaskComputeCancellationReceiptV1({
    version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
    kind: "interruption_requested",
    identity: request.identity,
    execution: request.execution,
    cancellationGeneration: request.cancellationGeneration,
  });
}

function cancellationRejected(
  reason: "execution_not_found" | "execution_mismatch",
): Effect.Effect<never, TaskComputeCancellationRejectedError> {
  return Effect.fail(new TaskComputeCancellationRejectedError({
    operation: "request_cancellation",
    reason,
    retryable: false,
  }));
}

function providerDisabled(
  request: CurrentTaskComputeDispatchRequestV1,
): TaskComputeDispatchRejectedError {
  return new TaskComputeDispatchRejectedError({
    operation: "dispatch",
    reason: "provider_disabled",
    retryable: true,
    computeProfile: request.computeProfile,
  });
}

function setDispatchState(
  state: ProviderState,
  key: string,
  dispatch: DispatchState,
): ProviderState {
  const dispatches = new Map(state.dispatches);
  dispatches.set(key, dispatch);
  return Object.freeze({
    closing: state.closing,
    acceptingDispatches: state.acceptingDispatches,
    dispatches,
    inFlightClassifications: state.inFlightClassifications,
  });
}

function deleteDispatchState(
  state: ProviderState,
  key: string,
): ProviderState {
  const dispatches = new Map(state.dispatches);
  dispatches.delete(key);
  return Object.freeze({
    closing: state.closing,
    acceptingDispatches: state.acceptingDispatches,
    dispatches,
    inFlightClassifications: state.inFlightClassifications,
  });
}

function addStartingDispatchState(
  state: ProviderState,
  key: string,
  dispatch: StartingDispatch,
): ProviderState {
  const dispatches = new Map(state.dispatches);
  dispatches.set(key, dispatch);
  const inFlightClassifications = new Set(state.inFlightClassifications);
  inFlightClassifications.add(dispatch.completion);
  return Object.freeze({
    closing: state.closing,
    acceptingDispatches: state.acceptingDispatches,
    dispatches,
    inFlightClassifications,
  });
}

function removeInFlightClassification(
  state: ProviderState,
  dispatch: StartingDispatch,
): ProviderState {
  if (!state.inFlightClassifications.has(dispatch.completion)) return state;
  const inFlightClassifications = new Set(state.inFlightClassifications);
  inFlightClassifications.delete(dispatch.completion);
  return Object.freeze({
    closing: state.closing,
    acceptingDispatches: state.acceptingDispatches,
    dispatches: state.dispatches,
    inFlightClassifications,
  });
}

function allocateExecutionId(
  options: CapturedOptions,
  request: CurrentTaskComputeDispatchRequestV1,
): Result.Result<TaskComputeExecutionIdV1, TaskComputeDispatchTransportError> {
  return Result.try({
    try: () => `${EXECUTION_ID_PREFIX}${options.randomUuid()}`,
    catch: cause => executionAllocationFailure(request, cause),
  }).pipe(
    Result.flatMap(executionId => decodeExecutionId(executionId).pipe(
      Result.mapError(cause => executionAllocationFailure(request, cause)),
    )),
  );
}

function executionAllocationFailure(
  request: CurrentTaskComputeDispatchRequestV1,
  cause: unknown,
): TaskComputeDispatchTransportError {
  return new TaskComputeDispatchTransportError({
    operation: "dispatch",
    retryable: false,
    cause: Object.freeze({ request: request.identity, cause }),
  });
}

function mapLaunchFailure(
  request: CurrentTaskComputeDispatchRequestV1,
  cause:
    | TaskRuntimeLaunchPortError
    | TaskRuntimeLaunchValidationError<"resolve">
    | TaskRuntimeLaunchHashError,
): TaskComputeDispatchTransportError {
  const retryable = cause instanceof TaskRuntimeLaunchPortError
    ? cause.reason === "resource_failure" || cause.reason === "authority_unavailable"
    : cause instanceof TaskRuntimeLaunchHashError
      ? cause.reason === "unavailable" || cause.reason === "native_rejected"
      : false;
  return new TaskComputeDispatchTransportError({
    operation: "dispatch",
    retryable,
    cause: Object.freeze({ identity: request.identity, cause }),
  });
}

function mapDefinitionFailure(
  request: CurrentTaskComputeDispatchRequestV1,
  cause: ApplicationTaskWorkerDefinitionError | LegacyTaskWorkerDefinitionError,
): TaskComputeDispatchRejectedError | TaskComputeDispatchTransportError {
  if (cause.reason === "unsupportedComputeProfile" ||
    cause.reason === "unsupportedDuration") {
    return new TaskComputeDispatchRejectedError({
      operation: "dispatch",
      reason: "unsupported_compute_profile",
      retryable: false,
      computeProfile: request.computeProfile,
    });
  }
  return new TaskComputeDispatchTransportError({
    operation: "dispatch",
    retryable: cause.reason === "resourceFailure",
    cause,
  });
}

function mapStartFailure(
  request: CurrentTaskComputeDispatchRequestV1,
  cause: TaskWorkerSessionHostError,
): TaskComputeDispatchTransportError | TaskComputeDispatchUncertainError {
  if (cause.reason === "workerLoadFailed" || cause.reason === "invalidRequest" ||
    cause.reason === "workerDefinitionFailed") {
    return new TaskComputeDispatchTransportError({
      operation: "dispatch",
      retryable: cause.reason === "workerLoadFailed",
      cause,
    });
  }
  return new TaskComputeDispatchUncertainError({
    operation: "dispatch",
    identity: request.identity,
    cause,
  });
}

function mapCancellationFailure(
  request: TaskComputeCancellationRequestV1,
  cause: TaskWorkerSessionHostError,
):
  | TaskComputeCancellationStaleError
  | TaskComputeCancellationRejectedError
  | TaskComputeCancellationTransportError
  | TaskComputeCancellationUncertainError {
  if (cause.reason === "staleCancellation") {
    return new TaskComputeCancellationUncertainError({
      operation: "request_cancellation",
      identity: request.identity,
      cause,
    });
  }
  if (cause.reason === "sessionLost" || cause.reason === "terminalFailed" ||
    cause.reason === "userCodeFailed" || cause.reason === "inputBoundaryFailed") {
    return new TaskComputeCancellationRejectedError({
      operation: "request_cancellation",
      reason: "execution_not_found",
      retryable: false,
    });
  }
  if (cause.reason === "invalidResponse" || cause.reason === "timedOut") {
    return new TaskComputeCancellationUncertainError({
      operation: "request_cancellation",
      identity: request.identity,
      cause,
    });
  }
  return new TaskComputeCancellationTransportError({
    operation: "request_cancellation",
    retryable: cause.reason === "workerStartFailed" ||
      cause.reason === "workerLoadFailed",
    cause,
  });
}

function captureOptions(
  input: WorkerLoaderTaskComputeProviderOptions,
): Result.Result<CapturedOptions, WorkerLoaderTaskComputeProviderConfigurationError> {
  return Result.gen(function* () {
    const outer = yield* captureProperties(input, [
      "applicationHostPolicy",
      "applicationQueryAuthority",
      "applicationMutationAuthority",
      "legacyHostPolicy",
      "maximumScopedDispatches",
      "handshakeMilliseconds",
      "randomUuid",
      "sha256",
    ]);
    const descriptor = yield* decodeTaskComputeProviderDescriptorV1({
      provider: WORKER_LOADER_TASK_COMPUTE_PROVIDER_NAME,
      providerVersion: WORKER_LOADER_TASK_COMPUTE_PROVIDER_VERSION,
    }).pipe(Result.mapError(configurationError));
    const applicationHostPolicy = yield* captureApplicationPolicy(
      outer.applicationHostPolicy,
    );
    const applicationQueryAuthority = yield* captureApplicationQueryAuthority(
      outer.applicationQueryAuthority,
    );
    const applicationMutationAuthority = yield* captureApplicationMutationAuthority(
      outer.applicationMutationAuthority,
    );
    const legacyHostPolicy = yield* captureLegacyPolicy(outer.legacyHostPolicy);
    const maximumScopedDispatches = outer.maximumScopedDispatches ??
      DEFAULT_MAXIMUM_SCOPED_DISPATCHES;
    const handshakeMilliseconds = outer.handshakeMilliseconds;
    if (!isPositiveSafeInteger(maximumScopedDispatches) ||
      handshakeMilliseconds !== undefined &&
        !isPositiveSafeInteger(handshakeMilliseconds) ||
      outer.randomUuid !== undefined && typeof outer.randomUuid !== "function" ||
      outer.sha256 !== undefined && typeof outer.sha256 !== "function") {
      return yield* Result.fail(configurationError());
    }
    const owner = input;
    const randomUuid = outer.randomUuid === undefined
      ? () => crypto.randomUUID()
      : () => Reflect.apply(outer.randomUuid as () => string, owner, []);
    const sha256 = outer.sha256 === undefined
      ? makeLiveStandardApplicationTaskSha256V1()
      : ((bytes: unknown, budget: unknown) => Reflect.apply(
          outer.sha256 as StandardApplicationTaskSha256V1,
          owner,
          [bytes, budget],
        ));
    return Object.freeze({
      descriptor,
      applicationHostPolicy,
      applicationQueryAuthority,
      applicationMutationAuthority,
      legacyHostPolicy,
      maximumScopedDispatches,
      randomUuid,
      sha256,
      handshakeMilliseconds,
    });
  });
}

function captureApplicationMutationAuthority(
  input: unknown,
): Result.Result<
  ApplicationTaskMutationCallbackAuthority,
  WorkerLoaderTaskComputeProviderConfigurationError
> {
  return Result.try({
    try: () => {
      if (input === null || typeof input !== "object") {
        throw new Error("Application Task mutation authority is unavailable.");
      }
      const bindLaunch = Reflect.get(input, "bindLaunch");
      if (typeof bindLaunch !== "function") {
        throw new Error("Application Task mutation authority is unavailable.");
      }
      // SAFETY: this is a typed private composition port; the runtime check
      // above proves its callable member while its Effect contract remains
      // owned by the supplying Application composition.
      const ownedBindLaunch = bindLaunch as ApplicationTaskMutationCallbackAuthority["bindLaunch"];
      return Object.freeze({
        bindLaunch: (subject: Parameters<
          ApplicationTaskMutationCallbackAuthority["bindLaunch"]
        >[0]) => Reflect.apply(ownedBindLaunch, input, [subject]),
      });
    },
    catch: configurationError,
  });
}

function captureApplicationQueryAuthority(
  input: unknown,
): Result.Result<
  ApplicationTaskQueryCallbackAuthority,
  WorkerLoaderTaskComputeProviderConfigurationError
> {
  return Result.try({
    try: () => {
      if (input === null || typeof input !== "object") {
        throw new Error("Application Task query authority is unavailable.");
      }
      const bindLaunch = Reflect.get(input, "bindLaunch");
      if (typeof bindLaunch !== "function") {
        throw new Error("Application Task query authority is unavailable.");
      }
      // SAFETY: this is a typed private composition port; the runtime check
      // above proves its callable member while its Result contract remains
      // owned by the supplying Application composition.
      const ownedBindLaunch = bindLaunch as ApplicationTaskQueryCallbackAuthority["bindLaunch"];
      return Object.freeze({
        bindLaunch: (subject: Parameters<
          ApplicationTaskQueryCallbackAuthority["bindLaunch"]
        >[0]) => Reflect.apply(ownedBindLaunch, input, [subject]),
      });
    },
    catch: configurationError,
  });
}

function captureApplicationPolicy(
  input: unknown,
): Result.Result<
  ApplicationTaskWorkerHostPolicy,
  WorkerLoaderTaskComputeProviderConfigurationError
> {
  return Result.gen(function* () {
    const policy = yield* captureProperties(input, [
      "runtimeHostIdentity",
      "compatibilityDate",
      "computeProfiles",
    ]);
    const profiles = yield* captureProfiles(policy.computeProfiles);
    if (typeof policy.runtimeHostIdentity !== "string" ||
      policy.runtimeHostIdentity.length === 0 ||
      typeof policy.compatibilityDate !== "string" ||
      policy.compatibilityDate.length === 0) {
      return yield* Result.fail(configurationError());
    }
    return Object.freeze({
      runtimeHostIdentity: policy.runtimeHostIdentity,
      compatibilityDate: policy.compatibilityDate,
      computeProfiles: profiles,
    });
  });
}

function captureLegacyPolicy(
  input: unknown,
): Result.Result<
  LegacyTaskWorkerHostPolicy,
  WorkerLoaderTaskComputeProviderConfigurationError
> {
  return Result.gen(function* () {
    const policy = yield* captureProperties(input, [
      "runtimeImplementationVersion",
      "admittedCompatibilityDate",
      "computeProfiles",
      "admittedCompatibilityFlags",
    ]);
    const profiles = yield* captureProfiles(policy.computeProfiles);
    const flags = yield* captureDenseArray(
      policy.admittedCompatibilityFlags,
      MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
    );
    const admittedCompatibilityFlags: string[] = [];
    for (const flag of flags) {
      if (typeof flag !== "string" || flag.length === 0) {
        return yield* Result.fail(configurationError());
      }
      admittedCompatibilityFlags.push(flag);
    }
    if (typeof policy.runtimeImplementationVersion !== "string" ||
      policy.runtimeImplementationVersion.length === 0 ||
      typeof policy.admittedCompatibilityDate !== "string" ||
      policy.admittedCompatibilityDate.length === 0) {
      return yield* Result.fail(configurationError());
    }
    return Object.freeze({
      runtimeImplementationVersion: policy.runtimeImplementationVersion,
      admittedCompatibilityDate: policy.admittedCompatibilityDate,
      computeProfiles: profiles,
      admittedCompatibilityFlags: Object.freeze(admittedCompatibilityFlags),
    });
  });
}

function captureProfiles(input: unknown): Result.Result<
  ApplicationTaskWorkerHostPolicy["computeProfiles"],
  WorkerLoaderTaskComputeProviderConfigurationError
> {
  return Result.gen(function* () {
    const inputs = yield* captureDenseArray(
      input,
      MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
    );
    const profiles: Array<{
      readonly computeProfile: string;
      readonly cpuMilliseconds: number;
      readonly maximumDurationMs: number;
    }> = [];
    const observed = new Set<string>();
    for (const input of inputs) {
      const value = yield* captureProperties(input, [
        "computeProfile",
        "cpuMilliseconds",
        "maximumDurationMs",
      ]);
      if (typeof value.computeProfile !== "string" ||
        value.computeProfile.length === 0 ||
        observed.has(value.computeProfile) ||
        !isPositiveSafeInteger(value.cpuMilliseconds) ||
        !isPositiveSafeInteger(value.maximumDurationMs)) {
        return yield* Result.fail(configurationError());
      }
      observed.add(value.computeProfile);
      profiles.push(Object.freeze({
        computeProfile: value.computeProfile,
        cpuMilliseconds: value.cpuMilliseconds,
        maximumDurationMs: value.maximumDurationMs,
      }));
    }
    return Object.freeze(profiles);
  });
}

function captureDenseArray(
  input: unknown,
  maximum: number,
): Result.Result<unknown[], WorkerLoaderTaskComputeProviderConfigurationError> {
  return Result.try({
    try: () => {
      if (!Array.isArray(input)) throw new Error("Expected an array.");
      const length = Object.getOwnPropertyDescriptor(input, "length");
      if (length === undefined || !("value" in length) ||
        !isNonNegativeSafeInteger(length.value) ||
        length.value > maximum) throw new Error("Invalid array length.");
      const keys = Reflect.ownKeys(input);
      if (keys.length !== length.value + 1 || !keys.includes("length")) {
        throw new Error("Expected a dense undecorated array.");
      }
      const output: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (descriptor === undefined || !("value" in descriptor) ||
          !descriptor.enumerable) throw new Error("Invalid array member.");
        output.push(descriptor.value);
      }
      return output;
    },
    catch: configurationError,
  });
}

function captureProperties(
  input: unknown,
  keys: ReadonlyArray<string>,
): Result.Result<
  Readonly<Record<string, unknown>>,
  WorkerLoaderTaskComputeProviderConfigurationError
> {
  return Result.try({
    try: () => {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Expected a configuration object.");
      }
      const output: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        output[key] = descriptor !== undefined && "value" in descriptor
          ? descriptor.value
          : undefined;
      }
      return Object.freeze(output);
    },
    catch: configurationError,
  });
}

function captureWorkerLoader(loader: WorkerLoader): WorkerLoader {
  if (loader === null || typeof loader !== "object") {
    throw new Error("Worker Loader is unavailable.");
  }
  const load = Reflect.get(loader, "load");
  const get = Reflect.get(loader, "get");
  if (typeof load !== "function" || typeof get !== "function") {
    throw new Error("Worker Loader is unavailable.");
  }
  return Object.freeze({
    load: (code: WorkerLoaderWorkerCode) => Reflect.apply(load, loader, [code]),
    get: (name: string | null, getCode: () => WorkerLoaderWorkerCode |
      Promise<WorkerLoaderWorkerCode>) => Reflect.apply(get, loader, [name, getCode]),
  });
}

function dispatchIdentityKey(
  request: Pick<CurrentTaskComputeDispatchRequestV1, "identity"> |
    Pick<TaskComputeCancellationRequestV1, "identity">,
): string {
  const identity = request.identity;
  return [
    identity.scopeId,
    identity.runId,
    identity.requestedEffectSequence,
    identity.attemptId,
    identity.executionFence,
  ].join("\u0000");
}

function dispatchRequestsEqual(
  left: CurrentTaskComputeDispatchRequestV1,
  right: CurrentTaskComputeDispatchRequestV1,
): boolean {
  return dispatchIdentityKey(left) === dispatchIdentityKey(right) &&
    left.version === right.version &&
    left.attemptNumber === right.attemptNumber &&
    left.leaseVersion === right.leaseVersion &&
    left.computeProfile === right.computeProfile &&
    left.cancellation.kind === right.cancellation.kind &&
    left.cancellation.generation === right.cancellation.generation &&
    left.maximumDurationMs === right.maximumDurationMs &&
    ("taskDefinitionRevisionId" in left
      ? "taskDefinitionRevisionId" in right &&
        left.taskDefinitionRevisionId === right.taskDefinitionRevisionId
      : "applicationTaskRuntimeTargetSha256" in right &&
        bytesEqualFullScan(left.applicationTaskRuntimeTargetSha256,
          right.applicationTaskRuntimeTargetSha256));
}

function executionRefsEqual(
  left: TaskComputeExecutionRefV1,
  right: TaskComputeExecutionRefV1,
): boolean {
  return left.provider === right.provider &&
    left.providerVersion === right.providerVersion &&
    left.executionId === right.executionId;
}

function configurationError(
  cause?: unknown,
): WorkerLoaderTaskComputeProviderConfigurationError {
  return new WorkerLoaderTaskComputeProviderConfigurationError({
    reason: "invalid_options",
    ...(cause === undefined ? {} : { cause }),
  });
}

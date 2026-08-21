import { Effect } from "effect";
import type { BeginInvokeSessionInput, FlarexExecutor } from "@flarex/executor";
import type {
  FlarexLiveQueryDeliveryConfig,
  FlarexLiveQueryRerunConfig,
} from "./config";
import {
  type ElysiaSet,
  ExecutorHttpOperationError,
  ExecutorHttpRoutePreconditionError,
  ExecutorHttpUnauthorizedError,
} from "./errors";
import {
  decodeBeginInvokeSessionBody,
  decodeInvokeAbortBody,
  decodeInvokeAbortStaleBody,
  decodeInvokeFinishBody,
  decodeInvokeSessionMaintenanceBody,
  decodeInvokeSyscallBody,
  decodeLiveQueryAckMaintenanceBody,
  decodeLiveQueryClaimMaintenanceBody,
  decodeLiveQueryConnectionCleanupBody,
  decodeLiveQueryConnectionTouchBody,
  decodeLiveQueryDeadLetterMaintenanceBody,
  decodeLiveQueryDeadLetterStuckMaintenanceBody,
  decodeLiveQueryDeliveryMaintenanceBody,
  decodeLiveQueryExpiredConnectionDeploymentsMaintenanceBody,
  decodeLiveQueryFailureMaintenanceBody,
  decodeLiveQueryPendingDeploymentsMaintenanceBody,
  decodeLiveQueryRerunMaintenanceBody,
  decodeLiveQueryStuckDeliveriesMaintenanceBody,
  decodeLiveQuerySubscriptionRecordBody,
  decodeLiveQuerySubscriptionRemoveBody,
  decodeLiveQuerySubscriptionRemoveConnectionBody,
  decodePrepareInvokeBody,
  type ExecutorHttpBodyDecoder,
  readExecutorHttpJsonBody,
} from "./requestDecoders";
import {
  executorErrorBody,
  executorHttpRouteErrorBody,
} from "./responses";

function handleExecutorHttpDecodedBody<A, R extends object, P = void>(
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
  decode: ExecutorHttpBodyDecoder<A>,
  execute: (input: A, preflight: P) => Promise<R>,
  preflight?: () => Effect.Effect<P, ExecutorHttpRoutePreconditionError>,
  validateInput?: (input: A) => Effect.Effect<void, ExecutorHttpRoutePreconditionError>,
): Promise<object> {
  // Deliberate runtime bridge: Elysia handlers return plain Promise payloads.
  return Effect.runPromise(
    routeExecutorHttpDecodedBody(
      request,
      capabilityToken,
      decode,
      execute,
      preflight,
      validateInput,
    ).pipe(
      Effect.catch(error => Effect.succeed(executorHttpRouteErrorBody(error, set))),
    ),
  );
}

const routeExecutorHttpDecodedBody = Effect.fn("ExecutorHttp.routeDecodedBody")(
  function* <A, R extends object, P = void>(
    request: Request,
    capabilityToken: string | undefined,
    decode: ExecutorHttpBodyDecoder<A>,
    execute: (input: A, preflight: P) => Promise<R>,
    preflight?: () => Effect.Effect<P, ExecutorHttpRoutePreconditionError>,
    validateInput?: (input: A) => Effect.Effect<void, ExecutorHttpRoutePreconditionError>,
  ) {
    yield* authorizeExecutorRequestEffect(request, capabilityToken);
    // SAFETY: routes without a preflight callback never read the preflight
    // value, so the absent value is never observed as P.
    const preflightResult = preflight === undefined
      ? undefined as P
      : yield* preflight();
    const body = yield* readExecutorHttpJsonBody(request);
    const input = yield* decode(body);
    if (validateInput !== undefined) {
      yield* validateInput(input);
    }
    return yield* Effect.tryPromise({
      try: () => execute(input, preflightResult),
      catch: cause => new ExecutorHttpOperationError({
        response: executorErrorBody(cause),
        cause,
      }),
    });
  },
);

const liveQueryRerunConfigured = Effect.fn("ExecutorHttp.liveQueryRerunConfigured")(
  (
    config: FlarexLiveQueryRerunConfig | undefined,
  ): Effect.Effect<FlarexLiveQueryRerunConfig, ExecutorHttpRoutePreconditionError> =>
    config === undefined
      ? Effect.fail(new ExecutorHttpRoutePreconditionError({
          response: {
            status: 501,
            body: {
              error: "not_implemented",
              message: "Live query rerun maintenance is not configured.",
            },
          },
        }))
      : Effect.succeed(config),
);

const liveQueryDeliveryConfigured = Effect.fn("ExecutorHttp.liveQueryDeliveryConfigured")(
  (
    config: FlarexLiveQueryDeliveryConfig | undefined,
  ): Effect.Effect<FlarexLiveQueryDeliveryConfig, ExecutorHttpRoutePreconditionError> =>
    config === undefined
      ? Effect.fail(new ExecutorHttpRoutePreconditionError({
          response: {
            status: 501,
            body: {
              error: "not_implemented",
              message: "Live query delivery maintenance is not configured.",
            },
          },
        }))
      : Effect.succeed(config),
);

export async function handleInvokePrepare(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodePrepareInvokeBody,
    async input => {
      const prepared = await executor.prepareInvoke(input);
      return {
        deploymentId: prepared.deployment.deploymentId,
        packageId: prepared.package.packageId,
        path: prepared.function.path,
        kind: prepared.function.kind,
        schemaVersion: prepared.schema.version,
        scope: prepared.scope,
        executionModule: prepared.executionModule,
      };
    },
  );
}

export async function handleInvokeStart(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeBeginInvokeSessionBody,
    input => executor.beginInvokeSession(input),
    undefined,
    input => requireCapabilityTokenForInvokeIdentity(input, capabilityToken),
  );
}

function requireCapabilityTokenForInvokeIdentity(
  input: BeginInvokeSessionInput,
  capabilityToken: string | undefined,
): Effect.Effect<void, ExecutorHttpRoutePreconditionError> {
  if (input.identity === undefined || capabilityToken !== undefined) {
    return Effect.void;
  }
  return Effect.fail(new ExecutorHttpRoutePreconditionError({
    response: {
      status: 403,
      body: {
        error: "trusted_identity_requires_capability_token",
        message:
          "Execution identity on executor start requires a configured capability token.",
      },
    },
  }));
}

export async function handleInvokeSyscall(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeInvokeSyscallBody,
    input => executor.invokeSyscall(input),
  );
}

export async function handleInvokeFinish(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeInvokeFinishBody,
    input => executor.finishInvokeSession(input),
  );
}

export async function handleInvokeAbort(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeInvokeAbortBody,
    input => executor.abortInvokeSession(input),
  );
}

export async function handleInvokeAbortStale(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeInvokeAbortStaleBody,
    input => executor.abortStaleInvokeSessions(input),
  );
}

export async function handleInvokeSessionMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeInvokeSessionMaintenanceBody,
    input => executor.runInvokeSessionMaintenance(input),
  );
}

export async function handleLiveQueryRerunMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
  config: FlarexLiveQueryRerunConfig | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryRerunMaintenanceBody,
    async (input, liveQueryRerun) => {
      const result = await executor.rerunStaleLiveQuerySubscriptions({
        deploymentId: input.deploymentId,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        freshnessStore: liveQueryRerun.freshnessStore,
        ...(liveQueryRerun.deliverChanges === undefined
          ? {}
          : { deliverChanges: liveQueryRerun.deliverChanges }),
        runQuery: (subscription) =>
          executor.runLiveQuerySubscriptionWithInvoke({
            subscription,
            projectId: input.projectId,
            executeQuery: liveQueryRerun.executeQuery,
          }),
      });
      if (result.changed.length > 0) {
        await liveQueryRerun.notifyDelivery?.({
          deploymentId: input.deploymentId,
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
      }
      return result;
    },
    () => liveQueryRerunConfigured(config),
  );
}

export async function handleLiveQueryDeliveryMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
  config: FlarexLiveQueryDeliveryConfig | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryDeliveryMaintenanceBody,
    async (input, liveQueryDelivery) => {
      return executor.runLiveQueryDeliveryBatch({
        deploymentId: input.deploymentId,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        deliver: liveQueryDelivery.deliver,
      });
    },
    () => liveQueryDeliveryConfigured(config),
  );
}

export async function handleLiveQuerySubscriptionRecord(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQuerySubscriptionRecordBody,
    input => executor.recordLiveQuerySubscription(input),
  );
}

export async function handleLiveQueryConnectionTouch(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryConnectionTouchBody,
    input => executor.touchLiveQueryConnection(input),
  );
}

export async function handleLiveQuerySubscriptionRemove(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQuerySubscriptionRemoveBody,
    input => executor.removeLiveQuerySubscription(input),
  );
}

export async function handleLiveQuerySubscriptionRemoveConnection(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQuerySubscriptionRemoveConnectionBody,
    input => executor.removeLiveQuerySubscriptionsForConnection(input),
  );
}

export async function handleLiveQueryConnectionCleanup(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryConnectionCleanupBody,
    input => executor.removeExpiredLiveQuerySubscriptions(input),
  );
}

export async function handleLiveQueryClaimMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryClaimMaintenanceBody,
    input => executor.claimLiveQueryDeliveryBatch(input),
  );
}

export async function handleLiveQueryAckMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryAckMaintenanceBody,
    input => executor.ackLiveQueryDeliveries(input),
  );
}

export async function handleLiveQueryFailureMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryFailureMaintenanceBody,
    input => executor.recordLiveQueryDeliveryFailure(input),
  );
}

export async function handleLiveQueryDeadLetterMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryDeadLetterMaintenanceBody,
    input => executor.markLiveQueryDeliveriesDeadLettered(input),
  );
}

export async function handleLiveQueryDeadLetterStuckMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryDeadLetterStuckMaintenanceBody,
    input => executor.deadLetterStuckLiveQueryDeliveries(input),
  );
}

export async function handleLiveQueryPendingDeploymentsMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryPendingDeploymentsMaintenanceBody,
    input => executor.listPendingLiveQueryDeliveryDeployments(input),
  );
}

export async function handleLiveQueryExpiredConnectionDeploymentsMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryExpiredConnectionDeploymentsMaintenanceBody,
    input => executor.listExpiredLiveQueryConnectionDeployments(input),
  );
}

export async function handleLiveQueryStuckDeliveriesMaintenance(
  executor: FlarexExecutor,
  request: Request,
  set: ElysiaSet,
  capabilityToken: string | undefined,
): Promise<object> {
  return handleExecutorHttpDecodedBody(
    request,
    set,
    capabilityToken,
    decodeLiveQueryStuckDeliveriesMaintenanceBody,
    input => executor.listStuckLiveQueryDeliveries(input),
  );
}

const authorizeExecutorRequestEffect = Effect.fn("ExecutorHttp.authorize")(
  function* (
    request: Request,
    capabilityToken: string | undefined,
  ): Effect.fn.Return<void, ExecutorHttpUnauthorizedError> {
    if (capabilityToken === undefined) return;
    const expected = `Bearer ${capabilityToken}`;
    if (request.headers.get("authorization") === expected) return;
    return yield* Effect.fail(new ExecutorHttpUnauthorizedError({
      body: {
        error: "unauthorized",
        message: "Unauthorized Flarex executor request.",
      },
    }));
  },
);

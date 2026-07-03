import { DurableObject } from "cloudflare:workers";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import { R2BackendExecutionArtifactStore } from "./artifactStore";
import { ServiceBindingExecutionArtifactRuntime } from "./artifactRuntime";
import {
  decodeConnectionClientMessage,
  type ConnectionClientMessageError,
} from "./connection/MessageBoundary";
import {
  decodeConnectionInvalidationRequest,
  decodeConnectionLiveQueryDeliveryRequest,
  ConnectionRouteValidationError,
  type ConnectionRouteError,
} from "./connection/RouteBoundary";
import {
  dispatchConnectionInvalidationEffect,
  dispatchConnectionLiveQueryDeliveryEffect,
  type ConnectionInvalidationHandler,
  type ConnectionLiveQueryDeliveryHandler,
} from "./connection/RouteDispatchBoundary";
import {
  connectionRouteOperationErrorToHttpError,
  connectionRouteOperationErrorToHttpErrorEffect,
  ConnectionRouteOperationError,
} from "./connection/RouteOperationError";
import {
  errorResponse,
  HttpError,
  json,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "./http";
import { Data, Effect } from "effect";
import {
  executeInvoke,
  loadActiveDeployment,
} from "./invoke";
import {
  addLiveQueryDeliverySkipReason,
  liveQueryDeliveryChangePayloadErrorToHttpError,
  liveQueryDeliverySkipMetadata,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliverySkipReasons,
} from "./liveQueryDelivery";
import { requireProjectIdEffect } from "./project";
import {
  partitionObjectName,
} from "./routing";
import {
  type AddQuery,
  type ClientMessage,
  type MutationRequest,
  type QueryId,
  type ServerMessage,
  type StateModification,
  type StateVersion,
} from "./syncProtocol";
import type {
  ActiveDeploymentStatus,
  Env,
  InvokeResponse,
  InvokeRequest,
  Json,
  ReadSet,
} from "./types";

type ActiveQuery = {
  queryId: QueryId;
  udfPath: string;
  args: Json[];
  partitionKey: string;
  journal: string | null;
  readSet?: ReadSet;
  readTs?: number;
  resultJson?: Json;
  resultHash?: string;
  rerunInFlight?: boolean;
  rerunQueued?: boolean;
};

type QueryInvokeResponse = InvokeResponse & {
  readSet: ReadSet;
  readTs: number;
};

type ConnectionState = {
  deploymentId: string | null;
  connectionName: string | null;
  executionIdentity: ExecutionIdentity;
  querySetVersion: number;
  identityVersion: number;
  ts: number;
  queries: Map<QueryId, ActiveQuery>;
};

const CONNECTION_HEARTBEAT_INTERVAL_MS = 30_000;
const CONNECTION_LEASE_DURATION_MS = 120_000;

export class ConnectionDO extends DurableObject<Env> {
  private mutationQueue: Promise<void> = Promise.resolve();
  private connectionUnregistered = false;

  private readonly state: ConnectionState = {
    deploymentId: null,
    connectionName: null,
    executionIdentity: { kind: "anonymous" },
    querySetVersion: 0,
    identityVersion: 0,
    ts: 0,
    queries: new Map(),
  };

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && isConnectionJsonRoutePath(url.pathname)) {
      return runConnectionRoute(routeConnectionDurableObject(request, url.pathname, {
        invalidate: queryId => this.invalidate(queryId),
        deliverLiveQuery: deliveries => this.deliverLiveQueryChanges(deliveries),
      }));
    }
    if (url.pathname === "/force-reconnect" && request.method === "POST") {
      return this.forceReconnect();
    }
    if (url.pathname === "/heartbeat" && request.method === "POST") {
      await this.refreshConnectionLease();
      await this.scheduleConnectionHeartbeat();
      return json({ touched: true });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ service: "flarex-connection", status: "ok" });
    }
    this.state.deploymentId = deploymentIdFromRequest(request);
    this.state.connectionName = connectionNameFromRequest(request);
    this.connectionUnregistered = false;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    await this.scheduleConnectionHeartbeat();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return runConnectionWebSocketMessage(
      routeConnectionWebSocketMessage(message, parsed => this.handleClientMessage(ws, parsed)),
      error => send(ws, { type: "FatalError", error }),
    );
  }

  async webSocketClose(): Promise<void> {
    await this.unregisterConnection();
    this.state.queries.clear();
  }

  async alarm(): Promise<void> {
    if (
      this.ctx.getWebSockets().length === 0 ||
      this.state.deploymentId === null ||
      this.state.connectionName === null ||
      this.connectionUnregistered
    ) {
      return;
    }
    try {
      await this.refreshConnectionLease();
    } finally {
      await this.scheduleConnectionHeartbeat();
    }
  }

  private async forceReconnect(): Promise<Response> {
    const sockets = this.ctx.getWebSockets();
    const activeQueries = this.state.queries.size;
    await this.unregisterConnection();
    this.state.queries.clear();
    for (const ws of sockets) {
      ws.close(1012, "flarex reconnect");
    }
    return json({
      closed: sockets.length,
      activeQueries,
    });
  }

  private async handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "Connect":
        return;
      case "Authenticate":
        if (message.baseVersion !== this.state.identityVersion) {
          send(ws, {
            type: "AuthError",
            error: `BaseIdentityVersionMismatch: base version ${message.baseVersion} does not match current identity version ${this.state.identityVersion}.`,
            baseVersion: message.baseVersion,
            authUpdateAttempted: true,
          });
          return;
        }
        const startVersion = this.currentVersion();
        this.state.identityVersion = message.baseVersion + 1;
        this.state.executionIdentity = { kind: "anonymous" };
        await this.rerunQueriesForIdentityChange(ws, startVersion);
        return;
      case "ModifyQuerySet":
        if (message.baseVersion !== this.state.querySetVersion) {
          throw new Error(
            `BaseVersionMismatch: base version ${message.baseVersion} does not match current query set version ${this.state.querySetVersion}.`,
          );
        }
        if (message.newVersion <= message.baseVersion) {
          throw new Error("ModifyQuerySet.newVersion must be greater than baseVersion.");
        }
        this.state.querySetVersion = message.newVersion;
        await this.applyQuerySetModifications(ws, message.baseVersion, message.modifications);
        return;
      case "Mutation":
        this.enqueueMutation(ws, message);
        return;
      case "Action":
        send(ws, {
          type: "FatalError",
          error: `${message.type} over /sync is not implemented yet.`,
        });
        return;
      case "Event":
        return;
      default:
        message satisfies never;
    }
  }

  private enqueueMutation(ws: WebSocket, message: MutationRequest): void {
    this.mutationQueue = this.mutationQueue
      .then(() => this.executeMutation(ws, message))
      .catch(error => {
        send(ws, {
          type: "FatalError",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private async executeMutation(ws: WebSocket, message: MutationRequest): Promise<void> {
    try {
      const deploymentId = requireDeploymentId(this.state.deploymentId);
      if (
        message.partitionKey === undefined &&
        !(await mutationAllowsMissingPartitionKey(this.env, deploymentId, message))
      ) {
        send(ws, {
          type: "MutationResponse",
          requestId: message.requestId,
          success: false,
          result: "Mutation.partitionKey is required until Flarex routing inference is implemented.",
          logLines: [],
        });
        return;
      }
      const response = await executeSyncInvoke(this.env, deploymentId, {
        path: message.udfPath,
        kind: "mutation",
        args: argsObjectForInvoke(message.args),
        ...(message.partitionKey === undefined ? {} : { partitionKey: message.partitionKey }),
      }, this.state.executionIdentity);
      send(ws, {
        type: "MutationResponse",
        requestId: message.requestId,
        success: true,
        result: response.value,
        ...(response.committedTs === undefined ? {} : { ts: response.committedTs }),
        logLines: [],
      });
      if (this.env.FLAREX_EXECUTOR !== undefined) return;
      const partitionKey = await committedPartitionKeyForMutation(
        this.env,
        deploymentId,
        message,
        response,
      );
      if (partitionKey !== null) await this.rerunQueriesForPartition(ws, partitionKey);
    } catch (error) {
      send(ws, {
        type: "MutationResponse",
        requestId: message.requestId,
        success: false,
        result: errorMessage(error),
        logLines: [],
      });
    }
  }

  private async applyQuerySetModifications(
    ws: WebSocket,
    baseVersion: number,
    modifications: Array<AddQuery | { type: "Remove"; queryId: QueryId }>,
  ): Promise<void> {
    const startVersion = this.currentVersion();
    startVersion.querySet = baseVersion;
    const stateModifications: StateModification[] = [];
    for (const modification of modifications) {
      if (modification.type === "Remove") {
        await this.unregisterQuery(modification.queryId);
        stateModifications.push({ type: "QueryRemoved", queryId: modification.queryId });
        continue;
      }

      const partitionKey = modification.partitionKey;
      const activeQuery: ActiveQuery = {
        queryId: modification.queryId,
        udfPath: modification.udfPath,
        args: modification.args,
        partitionKey: partitionKey ?? "",
        journal: modification.journal ?? null,
      };
      this.state.queries.set(modification.queryId, activeQuery);
      const stateModification = await this.executeQuery(activeQuery, { emitUnchanged: true });
      if (stateModification?.type === "QueryUpdated") {
        await this.registerQuery(activeQuery);
      } else {
        await this.unregisterQuery(activeQuery.queryId);
      }
      if (stateModification !== null) stateModifications.push(stateModification);
    }
    await this.sendTransition(ws, startVersion, stateModifications);
  }

  private async executeQuery(
    query: ActiveQuery,
    options: { emitUnchanged: boolean },
  ): Promise<StateModification | null> {
    try {
      if (query.partitionKey.length === 0) {
        throw new Error("Add.partitionKey is required until Flarex routing inference is implemented.");
      }
      const deploymentId = requireDeploymentId(this.state.deploymentId);
      const response = requireQueryInvokeResponse(await executeSyncInvoke(this.env, deploymentId, {
        path: query.udfPath,
        kind: "query",
        partitionKey: query.partitionKey,
        args: argsObjectForInvoke(query.args),
      }, this.state.executionIdentity));
      query.readSet = response.readSet;
      query.readTs = response.readTs;
      query.resultJson = response.value;
      const resultHash = fingerprintJson(response.value);
      const isUnchanged = query.resultHash === resultHash;
      query.resultHash = resultHash;
      this.state.ts = Math.max(this.state.ts + 1, response.readTs);
      if (isUnchanged && !options.emitUnchanged) return null;
      return {
        type: "QueryUpdated",
        queryId: query.queryId,
        value: response.value,
        logLines: [],
        journal: query.journal,
      };
    } catch (error) {
      this.state.ts += 1;
      return {
        type: "QueryFailed",
        queryId: query.queryId,
        errorMessage: errorMessage(error),
        logLines: [],
        errorData: null,
        journal: query.journal,
      };
    }
  }

  private async sendTransition(
    ws: WebSocket,
    startVersion: StateVersion | number,
    modifications: StateModification[],
  ): Promise<void> {
    const endVersion = this.currentVersion();
    const resolvedStartVersion =
      typeof startVersion === "number"
        ? { ...endVersion, querySet: startVersion }
        : startVersion;
    send(ws, {
      type: "Transition",
      startVersion: resolvedStartVersion,
      endVersion,
      modifications,
      serverTs: Date.now(),
    });
  }

  private currentVersion(): StateVersion {
    return {
      querySet: this.state.querySetVersion,
      ts: this.state.ts,
      identity: this.state.identityVersion,
    };
  }

  private async invalidate(queryId: QueryId): Promise<Response> {
    const query = this.state.queries.get(queryId);
    if (query === undefined) return json({ invalidated: false });
    if (query.rerunInFlight) {
      query.rerunQueued = true;
      return json({ invalidated: true, queued: true });
    }

    query.rerunInFlight = true;
    try {
      do {
        query.rerunQueued = false;
        const startVersion = this.currentVersion();
        const modification = await this.executeQuery(query, { emitUnchanged: false });
        if (modification?.type === "QueryUpdated") {
          await this.registerQuery(query);
        } else if (modification?.type === "QueryFailed") {
          await this.unregisterQuery(query.queryId);
        } else {
          await this.registerQuery(query);
        }
        for (const ws of this.ctx.getWebSockets()) {
          await this.sendTransition(ws, startVersion, modification === null ? [] : [modification]);
        }
      } while (query.rerunQueued && this.state.queries.has(query.queryId));
    } finally {
      query.rerunInFlight = false;
      query.rerunQueued = false;
    }
    return json({ invalidated: true });
  }

  private async deliverLiveQueryChanges(
    deliveries: LiveQueryDeliveryChange[],
  ): Promise<Response> {
    const startVersion = this.currentVersion();
    const modifications: StateModification[] = [];
    let skipped = 0;
    const skipReasons: LiveQueryDeliverySkipReasons = {};

    for (const delivery of deliveries) {
      if (this.state.deploymentId !== null && delivery.deploymentId !== this.state.deploymentId) {
        skipped += 1;
        addLiveQueryDeliverySkipReason(skipReasons, "wrongDeployment");
        continue;
      }
      if (this.state.connectionName !== null && delivery.connectionId !== this.state.connectionName) {
        skipped += 1;
        addLiveQueryDeliverySkipReason(skipReasons, "wrongConnection");
        continue;
      }
      const query = this.state.queries.get(delivery.queryId);
      if (query === undefined) {
        skipped += 1;
        addLiveQueryDeliverySkipReason(skipReasons, "missingQuery");
        continue;
      }
      if (delivery.kind === "failed") {
        if (
          query.resultHash !== undefined &&
          query.resultHash !== delivery.previousResultHash
        ) {
          skipped += 1;
          addLiveQueryDeliverySkipReason(skipReasons, "stale");
          continue;
        }
        this.state.ts += 1;
        modifications.push({
          type: "QueryFailed",
          queryId: delivery.queryId,
          errorMessage: delivery.errorMessage,
          logLines: [],
          errorData: delivery.errorData,
          journal: query.journal,
        });
        this.state.queries.delete(query.queryId);
        continue;
      }
      if (
        query.resultHash !== undefined &&
        query.resultHash !== delivery.previousResultHash
      ) {
        skipped += 1;
        addLiveQueryDeliverySkipReason(skipReasons, "stale");
        continue;
      }
      if (query.resultHash === delivery.resultHash) {
        skipped += 1;
        addLiveQueryDeliverySkipReason(skipReasons, "unchanged");
        continue;
      }

      query.resultHash = delivery.resultHash;
      this.state.ts += 1;
      modifications.push({
        type: "QueryUpdated",
        queryId: delivery.queryId,
        value: delivery.resultJson,
        logLines: [],
        journal: query.journal,
      });
    }

    if (modifications.length > 0) {
      for (const ws of this.ctx.getWebSockets()) {
        await this.sendTransition(ws, startVersion, modifications);
      }
    }
    return json({
      delivered: modifications.length,
      skipped,
      ...liveQueryDeliverySkipMetadata(skipReasons),
    });
  }

  private async rerunQueriesForPartition(ws: WebSocket, partitionKey: string): Promise<void> {
    const stateModifications: StateModification[] = [];
    const startVersion = this.currentVersion();
    for (const query of this.state.queries.values()) {
      if (query.partitionKey !== partitionKey) continue;
      const modification = await this.executeQuery(query, { emitUnchanged: false });
      if (modification?.type === "QueryUpdated") {
        await this.registerQuery(query);
      } else if (modification?.type === "QueryFailed") {
        await this.unregisterQuery(query.queryId);
      } else {
        await this.registerQuery(query);
      }
      if (modification !== null) stateModifications.push(modification);
    }
    if (stateModifications.length > 0) {
      await this.sendTransition(ws, startVersion, stateModifications);
    }
  }

  private async rerunQueriesForIdentityChange(
    ws: WebSocket,
    startVersion: StateVersion,
  ): Promise<void> {
    const stateModifications: StateModification[] = [];
    for (const query of this.state.queries.values()) {
      const modification = await this.executeQuery(query, { emitUnchanged: true });
      if (modification?.type === "QueryUpdated") {
        await this.registerQuery(query);
      } else if (modification?.type === "QueryFailed") {
        await this.unregisterQuery(query.queryId);
      } else {
        await this.registerQuery(query);
      }
      if (modification !== null) stateModifications.push(modification);
    }
    await this.sendTransition(ws, startVersion, stateModifications);
  }

  private async registerQuery(query: ActiveQuery): Promise<void> {
    if (query.readSet === undefined) return;
    const deploymentId = requireDeploymentId(this.state.deploymentId);
    const connectionName = requireConnectionName(this.state.connectionName);
    if (this.env.FLAREX_EXECUTOR !== undefined) {
      await this.registerQueryWithExecutor(query, deploymentId, connectionName);
      return;
    }
    const partition = this.env.PARTITIONS.getByName(
      partitionObjectName(deploymentId, query.partitionKey),
    );
    await partition.fetch("https://flarex.internal/subscriptions/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionName,
        queryId: query.queryId,
        readSet: query.readSet,
      }),
    });
  }

  private async unregisterQuery(queryId: QueryId): Promise<void> {
    const query = this.state.queries.get(queryId);
    if (query === undefined) return;
    this.state.queries.delete(queryId);
    if (this.env.FLAREX_EXECUTOR !== undefined && this.state.deploymentId !== null && this.state.connectionName !== null) {
      await this.removeQueryFromExecutor(
        this.state.deploymentId,
        this.state.connectionName,
        queryId,
      );
      return;
    }
    if (query.partitionKey.length === 0 || this.state.deploymentId === null || this.state.connectionName === null) {
      return;
    }
    const partition = this.env.PARTITIONS.getByName(
      partitionObjectName(this.state.deploymentId, query.partitionKey),
    );
    await partition.fetch("https://flarex.internal/subscriptions/unregister", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionName: this.state.connectionName,
        queryId,
      }),
    });
  }

  private async unregisterConnection(): Promise<void> {
    if (this.state.deploymentId === null || this.state.connectionName === null) return;
    if (this.connectionUnregistered) return;
    if (this.env.FLAREX_EXECUTOR !== undefined) {
      await this.removeConnectionFromExecutor(
        this.state.deploymentId,
        this.state.connectionName,
      );
      this.connectionUnregistered = true;
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const touchedPartitions = new Set(
      Array.from(this.state.queries.values())
        .map(query => query.partitionKey)
        .filter(partitionKey => partitionKey.length > 0),
    );
    await Promise.all(Array.from(touchedPartitions, partitionKey => {
      const partition = this.env.PARTITIONS.getByName(
        partitionObjectName(this.state.deploymentId!, partitionKey),
      );
      return partition.fetch("https://flarex.internal/subscriptions/unregister-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionName: this.state.connectionName }),
      });
    }));
    this.connectionUnregistered = true;
    await this.ctx.storage.deleteAlarm();
  }

  private async registerQueryWithExecutor(
    query: ActiveQuery,
    deploymentId: string,
    connectionName: string,
  ): Promise<void> {
    if (query.readSet === undefined || query.resultJson === undefined) return;
    if (query.readTs === undefined) {
      throw new Error("Cannot register executor live query without readTs.");
    }
    await postExecutor(this.env, "/live-query-subscriptions/record", {
      deploymentId,
      projectId: await requireProjectId(this.env),
      connectionId: connectionName,
      queryId: query.queryId,
      functionPath: query.udfPath,
      argsJson: argsObjectForInvoke(query.args),
      partitionKey: query.partitionKey.length === 0 ? null : query.partitionKey,
      beginTs: query.readTs,
      readSet: query.readSet,
      resultJson: query.resultJson,
    });
  }

  private async removeQueryFromExecutor(
    deploymentId: string,
    connectionName: string,
    queryId: QueryId,
  ): Promise<void> {
    await postExecutor(this.env, "/live-query-subscriptions/remove", {
      deploymentId,
      projectId: await requireProjectId(this.env),
      connectionId: connectionName,
      queryId,
    });
  }

  private async removeConnectionFromExecutor(
    deploymentId: string,
    connectionName: string,
  ): Promise<void> {
    await postExecutor(this.env, "/live-query-subscriptions/remove-connection", {
      deploymentId,
      projectId: await requireProjectId(this.env),
      connectionId: connectionName,
    });
  }

  private async refreshConnectionLease(): Promise<void> {
    if (
      this.env.FLAREX_EXECUTOR === undefined ||
      this.state.deploymentId === null ||
      this.state.connectionName === null ||
      this.connectionUnregistered
    ) {
      return;
    }
    await postExecutor(this.env, "/live-query-connections/touch", {
      deploymentId: this.state.deploymentId,
      projectId: await requireProjectId(this.env),
      connectionId: this.state.connectionName,
      leaseDurationMs: CONNECTION_LEASE_DURATION_MS,
    });
  }

  private async scheduleConnectionHeartbeat(): Promise<void> {
    if (this.env.FLAREX_EXECUTOR === undefined || this.connectionUnregistered) {
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + CONNECTION_HEARTBEAT_INTERVAL_MS);
  }
}

interface ConnectionRouteHandlers {
  invalidate: ConnectionInvalidationHandler;
  deliverLiveQuery: ConnectionLiveQueryDeliveryHandler;
}

const CONNECTION_JSON_ROUTE_PATHS = [
  "/invalidate",
  "/deliver/live-query",
] as const;

type ConnectionJsonRoutePath = typeof CONNECTION_JSON_ROUTE_PATHS[number];

function isConnectionJsonRoutePath(pathname: string): pathname is ConnectionJsonRoutePath {
  return (CONNECTION_JSON_ROUTE_PATHS as readonly string[]).includes(pathname);
}

const routeConnectionDurableObject = Effect.fn("ConnectionDO.route")(
  function* (
    request: Request,
    pathname: ConnectionJsonRoutePath,
    handlers: ConnectionRouteHandlers,
  ): Effect.fn.Return<Response, ConnectionInternalRouteError> {
    switch (pathname) {
      case "/invalidate":
        return yield* routeConnectionInvalidation(request, handlers.invalidate);
      case "/deliver/live-query":
        return yield* routeConnectionLiveQueryDelivery(request, handlers.deliverLiveQuery);
    }
  },
);

const routeConnectionInvalidation = Effect.fn("ConnectionDO.routeInvalidation")(
  function* (
    request: Request,
    invalidate: ConnectionInvalidationHandler,
  ) {
    const decoded = yield* decodeConnectionInvalidationRequest(request);
    return yield* dispatchConnectionInvalidationEffect(invalidate, decoded);
  },
);

const routeConnectionLiveQueryDelivery = Effect.fn("ConnectionDO.routeLiveQueryDelivery")(
  function* (
    request: Request,
    deliver: ConnectionLiveQueryDeliveryHandler,
  ) {
    const decoded = yield* decodeConnectionLiveQueryDeliveryRequest(request);
    return yield* dispatchConnectionLiveQueryDeliveryEffect(deliver, decoded);
  },
);

class ConnectionWebSocketMessageHandlerError extends Data.TaggedError(
  "ConnectionWebSocketMessageHandlerError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

type ConnectionWebSocketMessageError =
  | ConnectionWebSocketMessageHandlerError
  | ConnectionClientMessageError;

const routeConnectionWebSocketMessage = Effect.fn("ConnectionDO.routeWebSocketMessage")(
  function* (
    message: string | ArrayBuffer,
    handleMessage: (message: ClientMessage) => Promise<void>,
  ): Effect.fn.Return<void, ConnectionWebSocketMessageError> {
    const parsed = yield* decodeConnectionClientMessage(message);
    return yield* Effect.tryPromise({
      try: () => handleMessage(parsed),
      catch: cause => new ConnectionWebSocketMessageHandlerError({
        message: errorMessage(cause),
        cause,
      }),
    });
  },
);

function runConnectionWebSocketMessage(
  effect: Effect.Effect<void, ConnectionWebSocketMessageError>,
  sendFatalError: (error: string) => void,
): Promise<void> {
  // Deliberate runtime bridge: WebSocket callbacks complete through Promises.
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(error =>
        Effect.sync(() => {
          sendFatalError(error.message);
        })
      ),
    ),
  );
}

type ConnectionInternalRouteError =
  | ConnectionRouteError
  | ConnectionRouteOperationError;

function runConnectionRoute(
  effect: Effect.Effect<Response, ConnectionInternalRouteError>,
): Promise<Response> {
  // Deliberate runtime bridge: Durable Object fetch handlers return Promises.
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(connectionInternalRouteErrorToResponseEffect),
    ),
  );
}

function connectionInternalRouteErrorToHttpError(
  error: ConnectionInternalRouteError,
) {
  if (error instanceof ConnectionRouteOperationError) {
    return connectionRouteOperationErrorToHttpError(error);
  }
  return connectionRouteErrorToHttpError(error);
}

function connectionRouteErrorToHttpError(error: ConnectionRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  if (error instanceof ConnectionRouteValidationError) {
    return new HttpError(400, error.message);
  }
  return liveQueryDeliveryChangePayloadErrorToHttpError(error);
}

const connectionRouteErrorToHttpErrorEffect = Effect.fn(
  "ConnectionDO.connectionRouteErrorToHttpError",
)(function* (
  error: ConnectionRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(connectionRouteErrorToHttpError(error));
});

const connectionInternalRouteErrorToHttpErrorEffect = Effect.fn(
  "ConnectionDO.connectionInternalRouteErrorToHttpError",
)(function* (
  error: ConnectionInternalRouteError,
): Effect.fn.Return<never, HttpError> {
  if (error instanceof ConnectionRouteOperationError) {
    return yield* connectionRouteOperationErrorToHttpErrorEffect(error);
  }
  return yield* connectionRouteErrorToHttpErrorEffect(error);
});

const connectionInternalRouteErrorToResponseEffect = Effect.fn(
  "ConnectionDO.connectionInternalRouteErrorToResponse",
)(function* (
  error: ConnectionInternalRouteError,
): Effect.fn.Return<Response, never> {
  const httpError = yield* Effect.flip(connectionInternalRouteErrorToHttpErrorEffect(error));
  return errorResponse(httpError);
});

async function executeSyncInvoke(
  env: Env,
  deploymentId: string,
  request: InvokeRequest,
  identity: ExecutionIdentity,
) {
  const artifactRuntime = artifactRuntimeFromEnv(env, deploymentId);
  if (artifactRuntime !== undefined) {
    const activeDeployment = await loadActiveDeployment(env, deploymentId);
    return artifactRuntime.invoke(activeDeployment, request, identity);
  }
  return executeInvoke(env, deploymentId, request, {});
}

async function mutationAllowsMissingPartitionKey(
  env: Env,
  deploymentId: string,
  message: MutationRequest,
): Promise<boolean> {
  const activeDeployment = await loadActiveDeployment(env, deploymentId);
  const metadata = activeDeployment.analysis.functions.functions.find(
    fn => fn.path === message.udfPath,
  );
  return metadata?.partition?.type === "partitionCreateRoot";
}

async function committedPartitionKeyForMutation(
  env: Env,
  deploymentId: string,
  message: MutationRequest,
  response: InvokeResponse,
): Promise<string | null> {
  if (message.partitionKey !== undefined) return message.partitionKey;
  const activeDeployment = await loadActiveDeployment(env, deploymentId);
  const metadata = activeDeployment.analysis.functions.functions.find(
    fn => fn.path === message.udfPath,
  );
  if (metadata?.partition?.type !== "partitionCreateRoot") return null;
  return committedCreateRootId(activeDeployment, metadata.partition.table, response);
}

function committedCreateRootId(
  activeDeployment: ActiveDeploymentStatus,
  tableName: string,
  response: InvokeResponse,
): string | null {
  const rootTable = activeDeployment.analysis.schema.tables.find(
    table => table.name === tableName && table.state !== "deleted",
  );
  if (rootTable === undefined) return null;
  return response.writes?.find(
    write => write.tableId === rootTable.tableId && write.value !== null,
  )?.id ?? null;
}

function artifactRuntimeFromEnv(
  env: Env,
  deploymentId: string,
): ServiceBindingExecutionArtifactRuntime | undefined {
  if (env.ARTIFACTS === undefined || env.FLAREX_ARTIFACT_RUNTIME === undefined) return undefined;
  return new ServiceBindingExecutionArtifactRuntime({
    runtime: env.FLAREX_ARTIFACT_RUNTIME,
    store: new R2BackendExecutionArtifactStore(env.ARTIFACTS),
    deploymentId,
    sendSourcePackage: env.FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE !== "true",
    ...(env.FLAREX_ARTIFACT_RUNTIME_TOKEN === undefined
      ? {}
      : { capabilityToken: env.FLAREX_ARTIFACT_RUNTIME_TOKEN }),
  });
}

function requireProjectId(env: Env): Promise<string> {
  // Deliberate runtime bridge: WebSocket upgrade setup reads config as Promise.
  return Effect.runPromise(requireProjectIdEffect(env));
}

function deploymentIdFromRequest(request: Request): string {
  const explicit = request.headers.get("x-flarex-deployment");
  if (explicit !== null && explicit.length > 0) return explicit;
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts[0] === "deployments" && parts[1] !== undefined) return parts[1];
  throw new Error("Sync request is missing deployment id.");
}

function requireDeploymentId(value: string | null): string {
  if (value !== null) return value;
  throw new Error("Sync connection has not been initialized with a deployment id.");
}

function requireConnectionName(value: string | null): string {
  if (value !== null) return value;
  throw new Error("Sync connection has not been initialized with a connection name.");
}

function connectionNameFromRequest(request: Request): string {
  const value = request.headers.get("x-flarex-connection");
  if (value !== null && value.length > 0) return value;
  throw new Error("Sync request is missing connection name.");
}

function argsObjectForInvoke(args: Json[]): Json {
  if (args.length === 0) return null;
  if (args.length === 1) return args[0];
  return args;
}

function requireQueryInvokeResponse(response: InvokeResponse): QueryInvokeResponse {
  if (response.readSet === undefined) {
    throw new Error("Query response must include readSet.");
  }
  if (!isReadSet(response.readSet)) {
    throw new Error("Query response readSet must be an object.");
  }
  if (response.readTs === undefined) {
    throw new Error("Query response with readSet must include readTs.");
  }
  if (!Number.isFinite(response.readTs)) {
    throw new Error("Query response readTs must be a finite number.");
  }
  return {
    ...response,
    readSet: response.readSet,
    readTs: response.readTs,
  };
}

function isReadSet(value: unknown): value is ReadSet {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function postExecutor(
  env: Env,
  pathname: string,
  body: unknown,
): Promise<void> {
  const executor = env.FLAREX_EXECUTOR;
  if (executor === undefined) {
    throw new Error("Postgres executor service binding is not configured.");
  }
  const headers = new Headers({ "content-type": "application/json" });
  if (env.FLAREX_EXECUTOR_TOKEN !== undefined) {
    headers.set("authorization", `Bearer ${env.FLAREX_EXECUTOR_TOKEN}`);
  }
  const response = await executor.fetch(`https://flarex.executor${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Executor ${pathname} failed with ${response.status}: ${await response.text()}`,
    );
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fingerprintJson(value: Json): string {
  return stableJson(value);
}

function stableJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}

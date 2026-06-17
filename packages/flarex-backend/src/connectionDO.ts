import { DurableObject } from "cloudflare:workers";
import { R2BackendExecutionArtifactStore } from "./artifactStore";
import { ServiceBindingExecutionArtifactRuntime } from "./artifactRuntime";
import { json } from "./http";
import {
  executeInvoke,
  loadActiveDeployment,
} from "./invoke";
import {
  parseClientMessage,
  type AddQuery,
  type ClientMessage,
  type QueryId,
  type ServerMessage,
  type StateModification,
  type StateVersion,
} from "./syncProtocol";
import type { Env, InvokeRequest, Json, ReadSet } from "./types";

type ActiveQuery = {
  queryId: QueryId;
  udfPath: string;
  args: Json[];
  partitionKey: string;
  journal: string | null;
  readSet?: ReadSet;
  resultJson?: string;
};

type ConnectionState = {
  deploymentId: string | null;
  querySetVersion: number;
  identityVersion: number;
  ts: number;
  queries: Map<QueryId, ActiveQuery>;
};

export class ConnectionDO extends DurableObject<Env> {
  private readonly state: ConnectionState = {
    deploymentId: null,
    querySetVersion: 0,
    identityVersion: 0,
    ts: 0,
    queries: new Map(),
  };

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ service: "flarex-connection", status: "ok" });
    }
    this.state.deploymentId = deploymentIdFromRequest(request);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const parsed = parseClientMessage(parseSocketMessage(message));
      await this.handleClientMessage(ws, parsed);
    } catch (error) {
      send(ws, {
        type: "FatalError",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "Connect":
        return;
      case "Authenticate":
        if (message.baseVersion !== this.state.identityVersion) {
          throw new Error(
            `BaseIdentityVersionMismatch: base version ${message.baseVersion} does not match current identity version ${this.state.identityVersion}.`,
          );
        }
        const startVersion = this.currentVersion();
        this.state.identityVersion = message.baseVersion + 1;
        await this.sendTransition(ws, startVersion, []);
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
        this.state.queries.delete(modification.queryId);
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
      stateModifications.push(await this.executeQuery(activeQuery));
    }
    await this.sendTransition(ws, startVersion, stateModifications);
  }

  private async executeQuery(query: ActiveQuery): Promise<StateModification> {
    try {
      if (query.partitionKey.length === 0) {
        throw new Error("Add.partitionKey is required until Flarex routing inference is implemented.");
      }
      const deploymentId = requireDeploymentId(this.state.deploymentId);
      const response = await executeSyncInvoke(this.env, deploymentId, {
        path: query.udfPath,
        kind: "query",
        partitionKey: query.partitionKey,
        args: argsObjectForInvoke(query.args),
      });
      if (response.readSet !== undefined) query.readSet = response.readSet;
      query.resultJson = JSON.stringify(response.value);
      this.state.ts = Math.max(this.state.ts + 1, response.readTs ?? 0);
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
}

async function executeSyncInvoke(
  env: Env,
  deploymentId: string,
  request: InvokeRequest,
) {
  const artifactRuntime = artifactRuntimeFromEnv(env, deploymentId);
  if (artifactRuntime !== undefined) {
    const activeDeployment = await loadActiveDeployment(env, deploymentId);
    return artifactRuntime.invoke(activeDeployment, request);
  }
  return executeInvoke(env, deploymentId, request, {});
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

function parseSocketMessage(message: string | ArrayBuffer): unknown {
  if (typeof message !== "string") throw new Error("Binary sync messages are not supported.");
  return JSON.parse(message) as unknown;
}

function argsObjectForInvoke(args: Json[]): Json {
  if (args.length === 0) return null;
  if (args.length === 1) return args[0];
  return args;
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

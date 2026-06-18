import { LocalSyncState, type SubscribeOptions } from "./localState";
import {
  assertJson,
  parseServerMessage,
  type ClientMessage,
  type Json,
  type MutationResponse,
  type QueryToken,
  type RequestId,
  type ServerMessage,
  type Transition,
} from "./protocol";

const WEB_SOCKET_OPEN = 1;

export type WebSocketLike = {
  readonly readyState: number;
  send(message: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void, options?: { once?: boolean }): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
    options?: { once?: boolean },
  ): void;
  addEventListener(
    type: "error" | "close",
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ): void;
};

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export type BaseFlarexClientOptions = {
  webSocketConstructor?: WebSocketConstructor;
};

export type SyncMutationOptions = {
  partitionKey: string;
};

type QueryResult =
  | { success: true; value: Json; logLines: string[] }
  | { success: false; error: Error; logLines: string[]; errorData?: Json };

type PendingMutation = {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
};

export class BaseFlarexClient {
  private readonly state = new LocalSyncState();
  private readonly socket: WebSocketLike;
  private readonly pendingMessages: ClientMessage[] = [];
  private readonly queryResults = new Map<QueryToken, QueryResult>();
  private readonly pendingMutations = new Map<RequestId, PendingMutation>();
  private nextRequestId = 0;

  constructor(
    address: string,
    private readonly onTransition: (updatedQueries: QueryToken[]) => void,
    options: BaseFlarexClientOptions = {},
  ) {
    const WebSocketConstructor = options.webSocketConstructor ?? globalThis.WebSocket;
    if (WebSocketConstructor === undefined) {
      throw new Error("No WebSocket implementation is available for Flarex live sync.");
    }
    this.socket = new WebSocketConstructor(syncUrl(address));
    this.socket.addEventListener("open", () => this.flushPendingMessages());
    this.socket.addEventListener("message", event => this.handleMessageData(event.data));
    this.socket.addEventListener("error", event => this.failAll(new Error(String(event))));
    this.socket.addEventListener("close", () => this.failAll(new Error("Flarex sync socket closed.")));
  }

  subscribe(
    name: string,
    args: Record<string, unknown>,
    options: SubscribeOptions,
  ): { queryToken: QueryToken; unsubscribe: () => void } {
    const { modification, queryToken, unsubscribe } = this.state.subscribe(name, args, options);
    if (modification !== null) this.sendMessage(modification);
    return {
      queryToken,
      unsubscribe: () => {
        const remove = unsubscribe();
        if (remove !== null) this.sendMessage(remove);
      },
    };
  }

  async mutation(
    name: string,
    args: Record<string, unknown>,
    options: SyncMutationOptions,
  ): Promise<Json> {
    if (options.partitionKey.length === 0) {
      throw new Error("partitionKey is required for Flarex sync mutations.");
    }
    const requestId = this.nextRequestId++;
    const message = {
      type: "Mutation" as const,
      requestId,
      udfPath: name,
      args: [assertJson(args)],
      partitionKey: options.partitionKey,
    };
    const mutationPromise = new Promise<Json>((resolve, reject) => {
      this.pendingMutations.set(requestId, { resolve, reject });
    });
    this.sendMessage(message);
    return mutationPromise;
  }

  localQueryResultByToken(queryToken: QueryToken): Json | undefined {
    const result = this.queryResults.get(queryToken);
    if (result === undefined) return undefined;
    if (!result.success) throw result.error;
    return result.value;
  }

  hasLocalQueryResultByToken(queryToken: QueryToken): boolean {
    return this.queryResults.has(queryToken);
  }

  close(): void {
    this.socket.close();
    this.queryResults.clear();
    this.failAll(new Error("Flarex sync client closed."));
  }

  private handleMessageData(data: unknown): void {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const message = parseServerMessage(parsed);
    this.handleServerMessage(message);
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "Transition":
        this.handleTransition(message);
        return;
      case "MutationResponse":
        this.handleMutationResponse(message);
        return;
      case "FatalError":
        this.failAll(new Error(message.error));
        return;
      case "AuthError":
        this.failAll(new Error(message.error));
        return;
      case "Ping":
        return;
      default:
        message satisfies never;
    }
  }

  private handleTransition(transition: Transition): void {
    this.state.transition(transition);
    const changedQueries: QueryToken[] = [];
    for (const modification of transition.modifications) {
      const queryToken = this.state.queryToken(modification.queryId);
      if (queryToken === null) continue;
      if (modification.type === "QueryUpdated") {
        this.queryResults.set(queryToken, {
          success: true,
          value: modification.value,
          logLines: modification.logLines,
        });
        changedQueries.push(queryToken);
      } else if (modification.type === "QueryFailed") {
        const error = new Error(modification.errorMessage);
        this.queryResults.set(queryToken, {
          success: false,
          error,
          logLines: modification.logLines,
          ...(modification.errorData === undefined ? {} : { errorData: modification.errorData }),
        });
        changedQueries.push(queryToken);
      } else {
        this.queryResults.delete(queryToken);
        changedQueries.push(queryToken);
      }
    }
    if (changedQueries.length > 0) this.onTransition(changedQueries);
  }

  private handleMutationResponse(response: MutationResponse): void {
    const pending = this.pendingMutations.get(response.requestId);
    if (pending === undefined) return;
    this.pendingMutations.delete(response.requestId);
    if (response.success) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(response.result));
    }
  }

  private sendMessage(message: ClientMessage): void {
    if (this.socket.readyState === WEB_SOCKET_OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.pendingMessages.push(message);
  }

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift()!;
      this.socket.send(JSON.stringify(message));
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pendingMutations.values()) {
      pending.reject(error);
    }
    this.pendingMutations.clear();
  }
}

function syncUrl(address: string): string {
  const url = new URL(address);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported Flarex sync protocol: ${url.protocol}`);
  }
  if (!url.pathname.endsWith("/sync")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/sync`;
  }
  return url.toString();
}

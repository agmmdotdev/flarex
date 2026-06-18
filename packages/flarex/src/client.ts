import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "./api";
import { BaseFlarexClient, type WebSocketConstructor } from "./sync/baseClient";
import { serializePathArgsAndPartition } from "./sync/localState";
import type { QueryToken } from "./sync/protocol";
import type { OnUpdateOptions, Unsubscribe, Watch } from "./sync/simpleClient";

export type FlarexClientOptions = {
  fetch?: typeof globalThis.fetch;
  webSocketConstructor?: WebSocketConstructor;
};

export type InvokeOptions = {
  partitionKey: string;
  transport?: "http" | "sync";
};

export class FlarexInvocationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FlarexInvocationError";
  }
}

export class FlarexClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly webSocketConstructor: WebSocketConstructor | undefined;
  private syncClient: BaseFlarexClient | undefined;
  private readonly listeners = new Map<QueryToken, Set<() => void>>();
  private closed = false;

  constructor(
    private readonly deploymentUrl: string,
    options: FlarexClientOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.webSocketConstructor = options.webSocketConstructor;
  }

  query<Reference extends FunctionReference<"query">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: InvokeOptions,
  ): Promise<FunctionReturnType<Reference>> {
    return this.invoke(reference, args, options) as Promise<FunctionReturnType<Reference>>;
  }

  mutation<Reference extends FunctionReference<"mutation">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: InvokeOptions,
  ): Promise<FunctionReturnType<Reference>> {
    if (options.transport === "http") {
      return this.invoke(reference, args, options) as Promise<FunctionReturnType<Reference>>;
    }
    return this.ensureSyncClient().mutation(
      getFunctionName(reference),
      args as Record<string, unknown>,
      options,
    ) as Promise<FunctionReturnType<Reference>>;
  }

  watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    options: OnUpdateOptions,
  ): Watch<FunctionReturnType<Query>> {
    const name = getFunctionName(query);
    return {
      onUpdate: callback => {
        if (this.closed) return () => undefined;
        const sync = this.ensureSyncClient();
        const { queryToken, unsubscribe } = sync.subscribe(
          name,
          args as Record<string, unknown>,
          options,
        );
        const currentListeners = this.listeners.get(queryToken);
        if (currentListeners !== undefined) {
          currentListeners.add(callback);
        } else {
          this.listeners.set(queryToken, new Set([callback]));
        }
        return () => {
          if (this.closed) return;
          const listeners = this.listeners.get(queryToken);
          if (listeners !== undefined) {
            listeners.delete(callback);
            if (listeners.size === 0) this.listeners.delete(queryToken);
          }
          unsubscribe();
        };
      },
      localQueryResult: () => {
        if (this.syncClient === undefined) return undefined;
        return this.syncClient.localQueryResultByToken(
          serializePathArgsAndPartition(name, args as Record<string, unknown>, options.partitionKey),
        ) as FunctionReturnType<Query> | undefined;
      },
    };
  }

  onUpdate<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    callback: (result: FunctionReturnType<Query>) => unknown,
    options: OnUpdateOptions,
  ): Unsubscribe<FunctionReturnType<Query>>;
  onUpdate<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    callback: (result: FunctionReturnType<Query>) => unknown,
    onError: (error: Error) => unknown,
    options: OnUpdateOptions,
  ): Unsubscribe<FunctionReturnType<Query>>;
  onUpdate<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    callback: (result: FunctionReturnType<Query>) => unknown,
    onErrorOrOptions: ((error: Error) => unknown) | OnUpdateOptions,
    maybeOptions?: OnUpdateOptions,
  ): Unsubscribe<FunctionReturnType<Query>> {
    if (this.closed) throw new Error("FlarexClient has already been closed.");
    const onError = typeof onErrorOrOptions === "function" ? onErrorOrOptions : undefined;
    const options = typeof onErrorOrOptions === "function" ? maybeOptions : onErrorOrOptions;
    if (options === undefined) throw new Error("partitionKey is required for Flarex live queries.");
    const watch = this.watchQuery(query, args, options);
    const handleUpdate = () => callValueCallback(watch, callback, onError);
    const unsubscribe = watch.onUpdate(handleUpdate);
    scheduleExistingLocalResult(watch, handleUpdate);

    const unsubscribeProps = {
      unsubscribe: () => {
        if (this.closed) return;
        unsubscribe();
      },
      getCurrentValue: () => watch.localQueryResult(),
    };
    const ret = unsubscribeProps.unsubscribe as Unsubscribe<FunctionReturnType<Query>>;
    Object.assign(ret, unsubscribeProps);
    return ret;
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.syncClient?.close();
    this.syncClient = undefined;
  }

  private async invoke(
    reference: FunctionReference,
    args: unknown,
    options: InvokeOptions,
  ): Promise<unknown> {
    const response = await this.fetch(new URL("/invoke", this.deploymentUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: getFunctionName(reference),
        args,
        partitionKey: options.partitionKey,
      }),
    });
    const result = (await response.json()) as { value?: unknown; error?: string };
    if (!response.ok) {
      throw new FlarexInvocationError(result.error ?? "Flarex invocation failed", response.status);
    }
    return result.value;
  }

  private ensureSyncClient(): BaseFlarexClient {
    if (this.syncClient !== undefined) return this.syncClient;
    this.syncClient = new BaseFlarexClient(
      this.deploymentUrl,
      updatedQueries => this.handleSyncTransition(updatedQueries),
      this.webSocketConstructor === undefined
        ? {}
        : { webSocketConstructor: this.webSocketConstructor },
    );
    return this.syncClient;
  }

  private handleSyncTransition(updatedQueries: QueryToken[]): void {
    for (const queryToken of updatedQueries) {
      for (const callback of this.listeners.get(queryToken) ?? []) {
        callback();
      }
    }
  }
}

function scheduleExistingLocalResult(watch: Watch<unknown>, callback: () => void): void {
  try {
    if (watch.localQueryResult() !== undefined) setTimeout(callback, 0);
  } catch {
    setTimeout(callback, 0);
  }
}

function callValueCallback<Query extends FunctionReference<"query">>(
  watch: Watch<FunctionReturnType<Query>>,
  callback: (result: FunctionReturnType<Query>) => unknown,
  onError: ((error: Error) => unknown) | undefined,
): void {
  try {
    const value = watch.localQueryResult();
    if (value !== undefined) callback(value);
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    if (onError !== undefined) {
      onError(resolvedError);
    } else {
      setTimeout(() => {
        throw resolvedError;
      }, 0);
    }
  }
}

import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "./api";
import { BaseFlarexClient, type WebSocketConstructor } from "./sync/baseClient";
import type { QueryToken } from "./sync/protocol";
import type { OnUpdateOptions, Unsubscribe } from "./sync/simpleClient";

export type FlarexClientOptions = {
  fetch?: typeof globalThis.fetch;
  webSocketConstructor?: WebSocketConstructor;
};

export type InvokeOptions = {
  partitionKey: string;
  transport?: "http" | "sync";
};

type QueryInfo<Query extends FunctionReference<"query"> = FunctionReference<"query">> = {
  queryToken: QueryToken;
  callback: (result: FunctionReturnType<Query>) => unknown;
  onError?: (error: Error) => unknown;
  unsubscribe: () => void;
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
  private readonly listeners = new Set<QueryInfo>();
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
    const sync = this.ensureSyncClient();
    const { queryToken, unsubscribe } = sync.subscribe(
      getFunctionName(query),
      args as Record<string, unknown>,
      options,
    );
    const queryInfo: QueryInfo<Query> = {
      queryToken,
      callback,
      ...(onError === undefined ? {} : { onError }),
      unsubscribe,
    };
    this.listeners.add(queryInfo as QueryInfo);
    if (sync.hasLocalQueryResultByToken(queryToken)) {
      setTimeout(() => this.callListener(queryInfo), 0);
    }

    const unsubscribeProps = {
      unsubscribe: () => {
        if (this.closed) return;
        this.listeners.delete(queryInfo as QueryInfo);
        unsubscribe();
      },
      getCurrentValue: () =>
        sync.localQueryResultByToken(queryToken) as FunctionReturnType<Query> | undefined,
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
    const updated = new Set(updatedQueries);
    for (const listener of this.listeners) {
      if (updated.has(listener.queryToken)) this.callListener(listener);
    }
  }

  private callListener<Query extends FunctionReference<"query">>(listener: QueryInfo<Query>): void {
    try {
      const value = this.syncClient?.localQueryResultByToken(listener.queryToken);
      if (value !== undefined) listener.callback(value as FunctionReturnType<Query>);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      if (listener.onError !== undefined) {
        listener.onError(resolvedError);
      } else {
        setTimeout(() => {
          throw resolvedError;
        }, 0);
      }
    }
  }
}

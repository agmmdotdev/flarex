import { isNonArrayRecord } from "@flarex/utils/records";
import {
  TRUSTED_EXECUTION_IDENTITY_HEADER,
  TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER,
} from "flarex-protocol/auth-headers";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "./api";
import type { UserIdentity } from "./auth";
import { BaseFlarexClient, type WebSocketConstructor } from "./sync/baseClient";
import { serializePathArgsAndPartition } from "./sync/localState";
import type { QueryToken } from "./sync/protocol";
import type { OnUpdateOptions, Unsubscribe, Watch } from "./sync/simpleClient";

export type AuthTokenFetcher = (args: {
  forceRefreshToken: boolean;
}) => Promise<string | null | undefined>;

export type FlarexClientOptions = {
  fetch?: typeof globalThis.fetch;
  webSocketConstructor?: WebSocketConstructor;
};

export type InvokeOptions = {
  partitionKey?: string;
  transport?: "http" | "sync";
};

type ResolvedInvokeOptions = InvokeOptions;

type HttpAuthState =
  | { readonly kind: "none" }
  | { readonly kind: "bearer"; readonly fetchToken: AuthTokenFetcher }
  | {
      readonly kind: "trustedExecutionIdentity";
      readonly identity: UserIdentity;
      readonly token: string;
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
  private httpAuth: HttpAuthState = { kind: "none" };
  private lastSyncBearerToken: string | null = null;
  private syncAuthGeneration = 0;
  private syncAuthPendingGeneration: number | null = null;
  private syncAuthInFlightGeneration: number | null = null;
  private closed = false;

  constructor(
    private readonly deploymentUrl: string,
    options: FlarexClientOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.webSocketConstructor = options.webSocketConstructor;
  }

  setAuth(fetchToken: AuthTokenFetcher): void {
    this.httpAuth = { kind: "bearer", fetchToken };
    const generation = this.nextSyncAuthGeneration();
    this.syncAuthPendingGeneration = generation;
    this.syncClient?.pauseForAuthRefresh();
    this.refreshSyncAuthFromFetcher(fetchToken, generation);
  }

  /**
   * Set an explicitly trusted dev/test identity for one-shot HTTP invokes.
   *
   * Hosted deployments only accept this when their backend trusted identity
   * resolver is enabled with the matching shared token.
   */
  setTrustedExecutionIdentity(identity: UserIdentity, token: string): void {
    if (token.length === 0) {
      throw new Error("Trusted execution identity token must be a non-empty string.");
    }
    this.httpAuth = {
      kind: "trustedExecutionIdentity",
      identity: structuredClone(identity),
      token,
    };
    this.nextSyncAuthGeneration();
    this.syncAuthPendingGeneration = null;
    this.lastSyncBearerToken = null;
    this.syncClient?.clearAuth();
  }

  clearAuth(): void {
    this.httpAuth = { kind: "none" };
    this.nextSyncAuthGeneration();
    this.syncAuthPendingGeneration = null;
    this.lastSyncBearerToken = null;
    this.syncClient?.clearAuth();
  }

  query<Reference extends FunctionReference<"query">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: InvokeOptions = {},
  ): Promise<FunctionReturnType<Reference>> {
    return this.invoke(reference, args, resolveInvokeOptions(reference, args, options)) as Promise<
      FunctionReturnType<Reference>
    >;
  }

  mutation<Reference extends FunctionReference<"mutation">>(
    reference: Reference,
    args: FunctionArgs<Reference>,
    options: InvokeOptions = {},
  ): Promise<FunctionReturnType<Reference>> {
    const resolvedOptions = resolveInvokeOptions(reference, args, options);
    if (resolvedOptions.transport === "http") {
      return this.invoke(reference, args, resolvedOptions) as Promise<FunctionReturnType<Reference>>;
    }
    return this.ensureSyncClient().mutation(
      getFunctionName(reference),
      args as Record<string, unknown>,
      resolvedOptions.partitionKey === undefined
        ? {}
        : { partitionKey: resolvedOptions.partitionKey },
    ) as Promise<FunctionReturnType<Reference>>;
  }

  watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    options: OnUpdateOptions = {},
  ): Watch<FunctionReturnType<Query>> {
    const name = getFunctionName(query);
    const resolvedOptions = resolveOnUpdateOptions(query, args, options);
    return {
      onUpdate: callback => {
        if (this.closed) return () => undefined;
        const sync = this.ensureSyncClient();
        const { queryToken, unsubscribe } = sync.subscribe(
          name,
          args as Record<string, unknown>,
          resolvedOptions,
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
          serializePathArgsAndPartition(
            name,
            args as Record<string, unknown>,
            resolvedOptions.partitionKey,
          ),
        ) as FunctionReturnType<Query> | undefined;
      },
    };
  }

  onUpdate<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    callback: (result: FunctionReturnType<Query>) => unknown,
  ): Unsubscribe<FunctionReturnType<Query>>;
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
    onErrorOrOptions?: ((error: Error) => unknown) | OnUpdateOptions,
    maybeOptions?: OnUpdateOptions,
  ): Unsubscribe<FunctionReturnType<Query>> {
    if (this.closed) throw new Error("FlarexClient has already been closed.");
    const onError = typeof onErrorOrOptions === "function" ? onErrorOrOptions : undefined;
    const options = (typeof onErrorOrOptions === "function" ? maybeOptions : onErrorOrOptions) ?? {};
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
    options: ResolvedInvokeOptions,
  ): Promise<unknown> {
    const authHeaders = await this.httpAuthHeaders();
    const response = await this.fetch(new URL("/invoke", this.deploymentUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({
        path: getFunctionName(reference),
        args,
        ...(options.partitionKey === undefined ? {} : { partitionKey: options.partitionKey }),
      }),
    });
    const result = (await response.json()) as { value?: unknown; error?: string };
    if (!response.ok) {
      throw new FlarexInvocationError(result.error ?? "Flarex invocation failed", response.status);
    }
    return result.value;
  }

  private async httpAuthHeaders(): Promise<Record<string, string>> {
    switch (this.httpAuth.kind) {
      case "none":
        return {};
      case "bearer": {
        const token = await this.httpAuth.fetchToken({ forceRefreshToken: false });
        return token === null || token === undefined || token.length === 0
          ? {}
          : { authorization: `Bearer ${token}` };
      }
      case "trustedExecutionIdentity":
        return {
          [TRUSTED_EXECUTION_IDENTITY_HEADER]: JSON.stringify({
            kind: "user",
            user: this.httpAuth.identity,
          }),
          [TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER]: this.httpAuth.token,
        };
      default:
        this.httpAuth satisfies never;
        return {};
    }
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
    if (this.lastSyncBearerToken !== null) {
      this.syncClient.authenticate(this.lastSyncBearerToken);
    } else if (this.httpAuth.kind === "bearer") {
      const generation =
        this.syncAuthPendingGeneration ?? this.startSyncAuthRefreshGeneration();
      this.syncClient.pauseForAuthRefresh();
      this.refreshSyncAuthFromFetcher(this.httpAuth.fetchToken, generation);
    }
    return this.syncClient;
  }

  private nextSyncAuthGeneration(): number {
    this.syncAuthGeneration += 1;
    return this.syncAuthGeneration;
  }

  private startSyncAuthRefreshGeneration(): number {
    const generation = this.nextSyncAuthGeneration();
    this.syncAuthPendingGeneration = generation;
    return generation;
  }

  private refreshSyncAuthFromFetcher(fetchToken: AuthTokenFetcher, generation: number): void {
    if (this.syncAuthInFlightGeneration === generation) return;
    this.syncAuthInFlightGeneration = generation;
    void this.syncAuthFromFetcher(fetchToken, generation)
      .catch(() => {
        if (!this.isCurrentSyncAuthRefresh(fetchToken, generation)) return;
        this.lastSyncBearerToken = null;
        this.syncAuthPendingGeneration = null;
        this.syncClient?.clearAuth();
      })
      .finally(() => {
        if (this.syncAuthInFlightGeneration === generation) {
          this.syncAuthInFlightGeneration = null;
        }
      });
  }

  private async syncAuthFromFetcher(
    fetchToken: AuthTokenFetcher,
    generation: number,
  ): Promise<void> {
    const token = await fetchToken({ forceRefreshToken: false });
    if (!this.isCurrentSyncAuthRefresh(fetchToken, generation)) return;
    const normalizedToken = token === null || token === undefined || token.length === 0 ? null : token;
    this.syncAuthPendingGeneration = null;
    if (normalizedToken === this.lastSyncBearerToken) {
      this.syncClient?.resumeAfterAuthRefresh();
      return;
    }
    this.lastSyncBearerToken = normalizedToken;
    if (this.syncClient === undefined) return;
    if (normalizedToken === null) {
      this.syncClient.clearAuth();
    } else {
      this.syncClient.authenticate(normalizedToken);
    }
  }

  private isCurrentSyncAuthRefresh(
    fetchToken: AuthTokenFetcher,
    generation: number,
  ): boolean {
    return (
      this.httpAuth.kind === "bearer" &&
      this.httpAuth.fetchToken === fetchToken &&
      this.syncAuthGeneration === generation
    );
  }

  private handleSyncTransition(updatedQueries: QueryToken[]): void {
    for (const queryToken of updatedQueries) {
      for (const callback of this.listeners.get(queryToken) ?? []) {
        callback();
      }
    }
  }
}

export function resolvePartitionKey(
  reference: FunctionReference,
  args: unknown,
  options: { partitionKey?: string } = {},
): string | undefined {
  if (options.partitionKey !== undefined) {
    if (options.partitionKey.length === 0) {
      throw new Error("partitionKey must be a non-empty string.");
    }
    return options.partitionKey;
  }
  const partition = reference._partition;
  const name = getFunctionName(reference);
  if (partition?.type === "partition") {
    if (!isNonArrayRecord(args)) {
      throw new Error(
        `partitionKey for ${name} must be inferred from object args.${partition.argField}.`,
      );
    }
    const value = args[partition.argField];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `partitionKey for ${name} must be inferred from non-empty string args.${partition.argField}.`,
      );
    }
    return value;
  }
  if (partition?.type === "partitionCreateRoot") {
    return undefined;
  }
  throw new Error(
    `partitionKey is required for ${name}. Add partition: model.table.byX(...) to the function or pass { partitionKey }.`,
  );
}

function resolveInvokeOptions(
  reference: FunctionReference,
  args: unknown,
  options: InvokeOptions,
): ResolvedInvokeOptions {
  const partitionKey = resolvePartitionKey(reference, args, options);
  return partitionKey === undefined ? { ...options } : { ...options, partitionKey };
}

function resolveOnUpdateOptions<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
  options: OnUpdateOptions,
): OnUpdateOptions & { partitionKey: string } {
  const partitionKey = resolvePartitionKey(query, args, options);
  if (partitionKey === undefined) {
    throw new Error(
      `partitionKey is required for ${getFunctionName(query)} live queries.`,
    );
  }
  return { ...options, partitionKey };
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

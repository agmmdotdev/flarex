import {
  assertJson,
  type Authenticate,
  type Json,
  type IdentityVersion,
  type ModifyQuerySet,
  type QueryId,
  type QuerySetModification,
  type QueryToken,
  type Transition,
} from "./protocol";

export type SubscribeOptions = {
  partitionKey: string;
  journal?: string | null;
};

type LocalQuery = {
  id: QueryId;
  udfPath: string;
  args: Record<string, unknown>;
  partitionKey: string;
  numSubscribers: number;
  journal?: string | null;
};

export class LocalSyncState {
  private nextQueryId = 0;
  private querySetVersion = 0;
  private identityVersion: IdentityVersion = 0;
  private readonly querySet = new Map<QueryToken, LocalQuery>();
  private readonly queryIdToToken = new Map<QueryId, QueryToken>();

  authenticate(token: string): Authenticate {
    if (token.length === 0) {
      throw new Error("Auth token must be a non-empty string.");
    }
    const baseVersion = this.identityVersion;
    this.identityVersion = baseVersion + 1;
    return {
      type: "Authenticate",
      tokenType: "User",
      value: token,
      baseVersion,
    };
  }

  clearAuth(): Authenticate {
    const baseVersion = this.identityVersion;
    this.identityVersion = baseVersion + 1;
    return {
      type: "Authenticate",
      tokenType: "None",
      baseVersion,
    };
  }

  rollbackAuth(baseVersion: IdentityVersion): void {
    if (this.identityVersion === baseVersion + 1) {
      this.identityVersion = baseVersion;
    }
  }

  subscribe(
    udfPath: string,
    args: Record<string, unknown>,
    options: SubscribeOptions,
  ): {
    queryToken: QueryToken;
    modification: ModifyQuerySet | null;
    unsubscribe: () => ModifyQuerySet | null;
  } {
    if (options.partitionKey.length === 0) {
      throw new Error("partitionKey is required for Flarex sync subscriptions.");
    }
    const queryToken = serializePathArgsAndPartition(udfPath, args, options.partitionKey);
    const existingEntry = this.querySet.get(queryToken);
    if (existingEntry !== undefined) {
      existingEntry.numSubscribers += 1;
      return {
        queryToken,
        modification: null,
        unsubscribe: () => this.removeSubscriber(queryToken),
      };
    }

    const queryId = this.nextQueryId++;
    const query: LocalQuery = {
      id: queryId,
      udfPath,
      args,
      partitionKey: options.partitionKey,
      numSubscribers: 1,
      ...(options.journal === undefined ? {} : { journal: options.journal }),
    };
    this.querySet.set(queryToken, query);
    this.queryIdToToken.set(queryId, queryToken);

    const baseVersion = this.querySetVersion;
    const newVersion = baseVersion + 1;
    this.querySetVersion = newVersion;
    const add: QuerySetModification = {
      type: "Add",
      queryId,
      udfPath,
      args: [assertJson(args)],
      ...(options.journal === undefined ? {} : { journal: options.journal }),
      partitionKey: options.partitionKey,
    };
    return {
      queryToken,
      modification: {
        type: "ModifyQuerySet",
        baseVersion,
        newVersion,
        modifications: [add],
      },
      unsubscribe: () => this.removeSubscriber(queryToken),
    };
  }

  transition(transition: Transition): void {
    for (const modification of transition.modifications) {
      if (modification.type !== "QueryUpdated" && modification.type !== "QueryFailed") {
        continue;
      }
      const queryToken = this.queryIdToToken.get(modification.queryId);
      if (queryToken === undefined) continue;
      const query = this.querySet.get(queryToken);
      if (query !== undefined) query.journal = modification.journal;
    }
  }

  queryToken(queryId: QueryId): QueryToken | null {
    return this.queryIdToToken.get(queryId) ?? null;
  }

  queryPath(queryId: QueryId): string | null {
    const query = this.queryById(queryId);
    return query?.udfPath ?? null;
  }

  queryArgs(queryId: QueryId): Record<string, unknown> | null {
    const query = this.queryById(queryId);
    return query?.args ?? null;
  }

  private queryById(queryId: QueryId): LocalQuery | undefined {
    const token = this.queryIdToToken.get(queryId);
    return token === undefined ? undefined : this.querySet.get(token);
  }

  private removeSubscriber(queryToken: QueryToken): ModifyQuerySet | null {
    const localQuery = this.querySet.get(queryToken);
    if (localQuery === undefined) return null;
    if (localQuery.numSubscribers > 1) {
      localQuery.numSubscribers -= 1;
      return null;
    }

    this.querySet.delete(queryToken);
    this.queryIdToToken.delete(localQuery.id);
    const baseVersion = this.querySetVersion;
    const newVersion = baseVersion + 1;
    this.querySetVersion = newVersion;
    return {
      type: "ModifyQuerySet",
      baseVersion,
      newVersion,
      modifications: [{ type: "Remove", queryId: localQuery.id }],
    };
  }
}

export function serializePathArgsAndPartition(
  udfPath: string,
  args: Record<string, unknown>,
  partitionKey: string,
): QueryToken {
  return `${partitionKey}|${udfPath}|${stableJson(assertJson(args))}`;
}

function stableJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isJsonArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function isJsonArray(value: Json): value is ReadonlyArray<Json> {
  return Array.isArray(value);
}

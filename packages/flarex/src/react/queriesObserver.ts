import { getFunctionName, type FunctionReference } from "../api";
import type { OnUpdateOptions, Watch } from "../sync/simpleClient";

type Identifier = string;

type QueryRequest = {
  query: FunctionReference<"query">;
  args: Record<string, unknown>;
  options: OnUpdateOptions;
};

type QueryInfo = QueryRequest & {
  watch: Watch<unknown>;
  unsubscribe: () => void;
};

export type RequestForQueries = Record<Identifier, QueryRequest>;

export type CreateWatch = (
  query: FunctionReference<"query">,
  args: Record<string, unknown>,
  options: OnUpdateOptions,
) => Watch<unknown>;

export class QueriesObserver {
  private queries: Record<Identifier, QueryInfo> = {};
  private listeners = new Set<() => void>();

  constructor(public createWatch: CreateWatch) {}

  setCreateWatch(createWatch: CreateWatch): void {
    this.createWatch = createWatch;
    const currentQueries = this.queries;
    this.queries = {};
    for (const [identifier, info] of Object.entries(currentQueries)) {
      info.unsubscribe();
      this.addQuery(identifier, info.query, info.args, info.options);
    }
  }

  setQueries(newQueries: RequestForQueries): void {
    for (const [identifier, request] of Object.entries(newQueries)) {
      getFunctionName(request.query);
      const existing = this.queries[identifier];
      if (existing === undefined) {
        this.addQuery(identifier, request.query, request.args, request.options);
      } else if (!sameQuery(existing, request)) {
        this.removeQuery(identifier);
        this.addQuery(identifier, request.query, request.args, request.options);
      }
    }

    for (const identifier of Object.keys(this.queries)) {
      if (newQueries[identifier] === undefined) this.removeQuery(identifier);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLocalResults(queries: RequestForQueries): Record<Identifier, unknown | undefined | Error> {
    const result: Record<Identifier, unknown | undefined | Error> = {};
    for (const [identifier, request] of Object.entries(queries)) {
      getFunctionName(request.query);
      const watch = this.createWatch(request.query, request.args, request.options);
      try {
        result[identifier] = watch.localQueryResult();
      } catch (error) {
        if (error instanceof Error) {
          result[identifier] = error;
        } else {
          throw error;
        }
      }
    }
    return result;
  }

  destroy(): void {
    for (const identifier of Object.keys(this.queries)) {
      this.removeQuery(identifier);
    }
    this.listeners.clear();
  }

  private addQuery(
    identifier: Identifier,
    query: FunctionReference<"query">,
    args: Record<string, unknown>,
    options: OnUpdateOptions,
  ): void {
    if (this.queries[identifier] !== undefined) {
      throw new Error(`Tried to add a new query with identifier ${identifier}.`);
    }
    const watch = this.createWatch(query, args, options);
    const unsubscribe = watch.onUpdate(() => this.notifyListeners());
    this.queries[identifier] = { query, args, options, watch, unsubscribe };
  }

  private removeQuery(identifier: Identifier): void {
    const info = this.queries[identifier];
    if (info === undefined) throw new Error(`No query found with identifier ${identifier}.`);
    info.unsubscribe();
    delete this.queries[identifier];
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener();
  }
}

function sameQuery(left: QueryRequest, right: QueryRequest): boolean {
  return (
    getFunctionName(left.query) === getFunctionName(right.query) &&
    JSON.stringify(left.args) === JSON.stringify(right.args) &&
    JSON.stringify(left.options) === JSON.stringify(right.options)
  );
}

import React, { useContext, useMemo } from "react";
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "./api";
import { FlarexClient, type FlarexClientOptions, type InvokeOptions } from "./client";
import type { OnUpdateOptions, Watch } from "./sync/simpleClient";
import {
  QueriesObserver,
  type CreateWatch,
  type RequestForQueries,
} from "./react/queriesObserver";
import { useSubscription } from "./react/useSubscription";

export type FlarexReactClientOptions = FlarexClientOptions;

export class FlarexReactClient extends FlarexClient {}

const FlarexContext = React.createContext<FlarexReactClient | undefined>(undefined);

export const FlarexProvider: React.FC<{
  client: FlarexReactClient;
  children?: React.ReactNode;
}> = ({ client, children }) =>
  React.createElement(FlarexContext.Provider, { value: client }, children);

export function useFlarex(): FlarexReactClient {
  const client = useContext(FlarexContext);
  if (client === undefined) {
    throw new Error(
      "Could not find Flarex client. `useFlarex` must be used under `FlarexProvider`.",
    );
  }
  return client;
}

export type OptionalRestArgsOrSkip<Query extends FunctionReference<"query">> =
  FunctionArgs<Query> extends Record<string, never>
    ? [args?: FunctionArgs<Query> | "skip", options?: OnUpdateOptions]
    : [args: FunctionArgs<Query> | "skip", options?: OnUpdateOptions];

export type ReactMutation<Mutation extends FunctionReference<"mutation">> = (
  args: FunctionArgs<Mutation>,
  options?: InvokeOptions,
) => Promise<FunctionReturnType<Mutation>>;

export type UseQueryResult<QueryResult, ThrowOnError extends boolean = false> =
  | { status: "pending" }
  | { status: "success"; data: QueryResult }
  | (ThrowOnError extends true ? never : { status: "error"; error: Error });

type UseQueryOptions<
  Query extends FunctionReference<"query">,
  ThrowOnError extends boolean,
> = {
  query: Query;
  args: FunctionArgs<Query> | "skip";
  partitionKey?: string;
  journal?: string | null;
  throwOnError?: ThrowOnError;
};

export function useQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...argsAndOptions: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const skip = argsAndOptions[0] === "skip";
  const args = skip ? {} : ((argsAndOptions[0] ?? {}) as FunctionArgs<Query>);
  const options = argsAndOptions[1] ?? {};

  const queryReference =
    typeof query === "string"
      ? makeFunctionReference<"query", FunctionArgs<Query>, FunctionReturnType<Query>>(query)
      : query;
  const queryName = getFunctionName(queryReference);
  const argsKey = JSON.stringify(args);
  const optionsKey = JSON.stringify(options ?? {});

  const queries = useMemo<RequestForQueries>(
    () =>
      skip
        ? {}
        : {
            query: {
              query: queryReference,
              args: args as Record<string, unknown>,
              options,
            },
          },
    [argsKey, optionsKey, queryName, queryReference, skip],
  );

  const results = useQueries(queries);
  const result = results["query"];
  if (result instanceof Error) throw result;
  return result as FunctionReturnType<Query> | undefined;
}

export function useQuery_experimental<
  Query extends FunctionReference<"query">,
  ThrowOnError extends boolean = false,
>(
  options: UseQueryOptions<Query, ThrowOnError>,
): UseQueryResult<FunctionReturnType<Query>, ThrowOnError>;

export function useQuery_experimental<
  Query extends FunctionReference<"query">,
  ThrowOnError extends boolean = false,
>(
  options: UseQueryOptions<Query, ThrowOnError>,
): UseQueryResult<FunctionReturnType<Query>, false> {
  const throwOnError = options.throwOnError ?? false;
  const queryReference =
    typeof options.query === "string"
      ? makeFunctionReference<"query", FunctionArgs<Query>, FunctionReturnType<Query>>(
          options.query,
        )
      : options.query;
  const skip = options.args === "skip";

  const args = skip ? {} : options.args;
  const queryName = getFunctionName(queryReference);
  const argsKey = JSON.stringify(args);
  const watchOptions: OnUpdateOptions = {
    ...(options.partitionKey === undefined ? {} : { partitionKey: options.partitionKey }),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
  };
  const watchOptionsKey = JSON.stringify(watchOptions);

  const queries = useMemo<RequestForQueries>(
    () =>
      skip
        ? {}
        : {
            query: {
              query: queryReference,
              args: args as Record<string, unknown>,
              options: watchOptions,
            },
          },
    [argsKey, queryName, queryReference, skip, watchOptionsKey],
  );

  const results = useQueries(queries);
  const result = results["query"];

  if (result instanceof Error) {
    if (throwOnError) throw result;
    return { status: "error", error: result };
  }
  if (result === undefined) return { status: "pending" };
  return { status: "success", data: result as FunctionReturnType<Query> };
}

export function useQueries(
  queries: RequestForQueries,
): Record<string, unknown | undefined | Error> {
  const client = useFlarex();
  const createWatch = useMemo<CreateWatch>(
    () => (query, args, options) => client.watchQuery(query, args, options) as Watch<unknown>,
    [client],
  );
  return useQueriesHelper(queries, createWatch);
}

export function useQueriesHelper(
  queries: RequestForQueries,
  createWatch: CreateWatch,
): Record<string, unknown | undefined | Error> {
  const observer = React.useMemo(() => new QueriesObserver(createWatch), []);
  if (observer.createWatch !== createWatch) observer.setCreateWatch(createWatch);

  React.useEffect(() => () => observer.destroy(), [observer]);

  const subscription = useMemo(
    () => ({
      getCurrentValue: () => observer.getLocalResults(queries),
      subscribe: (callback: () => void) => {
        observer.setQueries(queries);
        return observer.subscribe(callback);
      },
    }),
    [observer, queries],
  );

  return useSubscription(subscription);
}

export function useMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
): ReactMutation<Mutation> {
  const client = useFlarex();
  const mutationReference =
    typeof mutation === "string"
      ? makeFunctionReference<"mutation", FunctionArgs<Mutation>, FunctionReturnType<Mutation>>(
          mutation,
        )
      : mutation;
  const mutationName = getFunctionName(mutationReference);

  return useMemo(
    () =>
      ((args: FunctionArgs<Mutation>, options: InvokeOptions = {}) => {
        assertNotAccidentalArgument(args);
        return client.mutation(mutationReference, args, options);
      }) as ReactMutation<Mutation>,
    [client, mutationName, mutationReference],
  );
}

function assertNotAccidentalArgument(value: unknown): void {
  if (
    typeof value === "object" &&
    value !== null &&
    "bubbles" in value &&
    "persist" in value &&
    "isDefaultPrevented" in value
  ) {
    throw new Error(
      "Flarex mutation called with a React event object. Wrap the mutation call in an event handler.",
    );
  }
}

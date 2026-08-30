import {
  type FunctionDefinition,
  type FunctionReference,
  type InferFunctionArgs,
  type InferFunctionReturn,
} from "@flarex/application-definition";
import { inspectFunctionReference } from
  "@flarex/application-definition/internal/function-reference";
import {
  ApplicationQuerySystem,
  invokeApplicationQuery,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { Effect, Scope } from "effect";
import type { ExecutionIdentity } from "flarex-protocol/auth";

import {
  projectQueryInvocationError,
  type QueryInvocationError,
} from "./QueryInvocationError.js";
import {
  type ApplicationQueryResultContractError,
  queryResultContractError,
  validateResultContract,
} from "./ResultContract.js";

type QueryReference = FunctionReference<
  string,
  FunctionDefinition<"query", "public">
>;

export interface QueryOptions {
  readonly identity?: ExecutionIdentity;
}

export type RunQueryError =
  | QueryInvocationError
  | ApplicationQueryResultContractError;

export const runQuery = Effect.fn("Application.runQuery")(function* <
  const Reference extends QueryReference,
>(
  reference: Reference,
  args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
  options: QueryOptions = {},
): Effect.fn.Return<
  InferFunctionReturn<Reference["contract"]>,
  RunQueryError,
  ApplicationQuerySystem | Scope.Scope
> {
  const inspected = inspectFunctionReference(reference);
  const value = yield* invokeApplicationQuery(
    inspected.path,
    args,
    options.identity,
  ).pipe(Effect.mapError(projectQueryInvocationError));
  const validated = yield* validateResultContract(
    inspected,
    value,
    queryResultContractError,
  );
  // SAFETY: the opaque reference's validator accepted this canonical value.
  return validated as InferFunctionReturn<Reference["contract"]>;
});

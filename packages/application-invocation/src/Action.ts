import {
  type FunctionDefinition,
  type FunctionReference,
  type InferFunctionArgs,
  type InferFunctionReturn,
} from "@flarex/application-definition";
import { inspectFunctionReference } from
  "@flarex/application-definition/internal/function-reference";
import {
  ApplicationActionSystem,
  invokeApplicationAction,
  type CompletedApplicationAction,
  type NonCompletedApplicationAction,
} from
  "@flarex/standard-application-invocation/internal/application-action-system";
import { Effect, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
} from "flarex-protocol/transaction-session";

import {
  projectActionInvocationError,
  type ActionInvocationError,
} from "./ActionInvocationError.js";
import {
  actionResultContractError,
  type ApplicationActionResultContractError,
  validateResultContract,
} from "./ResultContract.js";
import {
  type ApplicationRequestKeyError,
  normalizeApplicationRequestKey,
} from "./RequestKey.js";

type ActionReference = FunctionReference<
  string,
  FunctionDefinition<"action", "public">
>;

export interface ActionOptions {
  readonly requestKey: string;
}

export type ActionResult<Value> =
  | (Omit<CompletedApplicationAction, "value"> &
    Readonly<{ readonly value: Value }>)
  | NonCompletedApplicationAction;

export type RunActionError =
  | ActionInvocationError
  | ApplicationActionResultContractError
  | ApplicationRequestKeyError<"runAction">;

export const runAction = Effect.fn("Application.runAction")(function* <
  const Reference extends ActionReference,
>(
  reference: Reference,
  args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
  options: ActionOptions,
): Effect.fn.Return<
  ActionResult<InferFunctionReturn<Reference["contract"]>>,
  RunActionError,
  ApplicationActionSystem | Scope.Scope
> {
  const inspected = inspectFunctionReference(reference);
  const requestKey = yield* Effect.fromResult(
    normalizeApplicationRequestKey("runAction", options.requestKey),
  );
  // SAFETY: the legacy system re-decodes the path at runtime; this assertion
  // grants no authority and only crosses its overly narrow input type.
  const functionPath = inspected.path as TransactionFunctionPathV1;
  const result = yield* invokeApplicationAction(
    functionPath,
    args,
    requestKey,
  ).pipe(Effect.mapError(projectActionInvocationError));
  if (result.status === "notCompleted") return result;
  yield* validateResultContract(
    inspected,
    result.value,
    cause => actionResultContractError(cause, result),
  );
  // SAFETY: the opaque reference's validator accepted the completed value.
  return result as ActionResult<InferFunctionReturn<Reference["contract"]>>;
});

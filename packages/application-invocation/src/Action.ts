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
  type InvokeApplicationActionError,
  type NonCompletedApplicationAction,
} from
  "@flarex/standard-application-invocation/internal/application-action-system";
import { Effect, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";

import {
  actionResultContractError,
  type ApplicationActionResultContractError,
  validateResultContract,
} from "./ResultContract.js";

type ActionReference = FunctionReference<
  string,
  FunctionDefinition<"action", "public">
>;

export interface ActionOptions {
  readonly requestKey: TransactionRequestKeyV1;
}

export type ActionResult<Value> =
  | (Omit<CompletedApplicationAction, "value"> &
    Readonly<{ readonly value: Value }>)
  | NonCompletedApplicationAction;

export type RunActionError =
  | InvokeApplicationActionError
  | ApplicationActionResultContractError;

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
  // SAFETY: the legacy system re-decodes the path at runtime; this assertion
  // grants no authority and only crosses its overly narrow input type.
  const functionPath = inspected.path as TransactionFunctionPathV1;
  const result = yield* invokeApplicationAction(
    functionPath,
    args,
    options.requestKey,
  );
  if (result.status === "notCompleted") return result;
  yield* validateResultContract(
    inspected,
    result.value,
    cause => actionResultContractError(cause, result),
  );
  // SAFETY: the opaque reference's validator accepted the completed value.
  return result as ActionResult<InferFunctionReturn<Reference["contract"]>>;
});

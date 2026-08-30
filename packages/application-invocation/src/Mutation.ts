import {
  type FunctionDefinition,
  type FunctionReference,
  type InferFunctionArgs,
  type InferFunctionReturn,
} from "@flarex/application-definition";
import { inspectFunctionReference } from
  "@flarex/application-definition/internal/function-reference";
import {
  ApplicationMutationSystem,
  invokeApplicationMutation,
  type AuthoritativeCommittedApplicationMutationOutcome,
  type InvokeApplicationMutationError,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { Effect, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
} from "flarex-protocol/transaction-session";
import { jsonToFlarexValueV1 } from "flarex-protocol/value";

import {
  type ApplicationMutationResultContractError,
  mutationResultContractError,
  validateResultContract,
} from "./ResultContract.js";
import {
  type ApplicationRequestKeyError,
  normalizeApplicationRequestKey,
} from "./RequestKey.js";

type MutationReference = FunctionReference<
  string,
  FunctionDefinition<"mutation", "public">
>;

export interface MutationOptions {
  readonly requestKey: string;
}

export type MutationOutcome<Value> = Omit<
  AuthoritativeCommittedApplicationMutationOutcome,
  "value"
> & Readonly<{ readonly value: Value }>;

export type RunMutationError =
  | InvokeApplicationMutationError
  | ApplicationMutationResultContractError
  | ApplicationRequestKeyError<"runMutation">;

export const runMutation = Effect.fn("Application.runMutation")(function* <
  const Reference extends MutationReference,
>(
  reference: Reference,
  args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
  options: MutationOptions,
): Effect.fn.Return<
  MutationOutcome<InferFunctionReturn<Reference["contract"]>>,
  RunMutationError,
  ApplicationMutationSystem | Scope.Scope
> {
  const inspected = inspectFunctionReference(reference);
  const requestKey = yield* Effect.fromResult(
    normalizeApplicationRequestKey("runMutation", options.requestKey),
  );
  // SAFETY: the legacy system re-decodes the path at runtime; this assertion
  // grants no authority and only crosses its overly narrow input type.
  const functionPath = inspected.path as TransactionFunctionPathV1;
  const outcome = yield* invokeApplicationMutation(
    functionPath,
    args,
    requestKey,
  );
  const value = jsonToFlarexValueV1(outcome.value);
  const validated = yield* validateResultContract(
    inspected,
    value,
    cause => mutationResultContractError(cause, outcome),
  );
  // SAFETY: the opaque reference's validator accepted this canonical value.
  return Object.freeze({
    ...outcome,
    value: validated as InferFunctionReturn<Reference["contract"]>,
  });
});

import {
  readActiveApplicationRevisionV1,
  type ApplicationRevisionActivationContextV1,
} from
  "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import { Context, Effect, Layer, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

import {
  ApplicationMutationSystem,
  invokeApplicationMutation,
  type AuthoritativeCommittedApplicationMutationOutcome,
  type InvokeApplicationMutationError,
} from "./ApplicationMutationSystem";
import {
  ApplicationQuerySystem,
  invokeApplicationQuery,
  type InvokeApplicationQueryError,
} from "./ApplicationQuerySystem";
import {
  ApplicationActionSystem,
  invokeApplicationAction,
  type InvokeApplicationActionError,
  type InvokeApplicationActionResult,
} from "./ApplicationActionSystem";

export interface LegacyStandardApplicationActiveRevisionReaderV1Api {
  readonly read: ReturnType<typeof makeRead>;
}

export class LegacyStandardApplicationActiveRevisionReaderV1 extends Context.Service<
  LegacyStandardApplicationActiveRevisionReaderV1,
  LegacyStandardApplicationActiveRevisionReaderV1Api
>()(
  "flarex/standard-application-invocation/LegacyStandardApplicationActiveRevisionReaderV1",
) {}

export type InvokeStandardApplicationPointMutationV1Error =
  InvokeApplicationMutationError;

export type InvokeStandardApplicationPointQueryV1Error =
  InvokeApplicationQueryError;

export type InvokeStandardApplicationActionV1Error = InvokeApplicationActionError;

/**
 * Compatibility-named thin consumer for the unversioned Application mutation
 * System. Selection and authority admission are owned by that System.
 */
export const invokeStandardApplicationPointMutationV1 = Effect.fn(
  "StandardApplication.invokePointMutationV1",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  AuthoritativeCommittedApplicationMutationOutcome,
  InvokeStandardApplicationPointMutationV1Error,
  | ApplicationMutationSystem
  | Scope.Scope
> {
  return yield* invokeApplicationMutation(functionRef, args, requestKey);
});

/**
 * Compatibility-named thin consumer for the unversioned Application query
 * System. Selection and execution remain owned by that System.
 */
export const invokeStandardApplicationPointQueryV1 = Effect.fn(
  "StandardApplication.invokePointQueryV1",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  identity?: ExecutionIdentity,
): Effect.fn.Return<
  CanonicalFlarexRuntimeValueV1,
  InvokeStandardApplicationPointQueryV1Error,
  | ApplicationQuerySystem
  | Scope.Scope
> {
  return yield* invokeApplicationQuery(functionRef, args, identity);
});

/**
 * Compatibility-named thin consumer for the unversioned Application action
 * System. Selection, admission, execution and settlement are owned there.
 */
export const invokeStandardApplicationActionV1 = Effect.fn(
  "StandardApplication.invokeActionV1",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  InvokeApplicationActionResult,
  InvokeStandardApplicationActionV1Error,
  | ApplicationActionSystem
  | Scope.Scope
> {
  return yield* invokeApplicationAction(functionRef, args, requestKey);
});

export function makeLegacyStandardApplicationActiveRevisionReaderV1Layer(
  context: ApplicationRevisionActivationContextV1,
): Layer.Layer<LegacyStandardApplicationActiveRevisionReaderV1> {
  return Layer.succeed(
    LegacyStandardApplicationActiveRevisionReaderV1,
    LegacyStandardApplicationActiveRevisionReaderV1.of({
      read: makeRead(context),
    }),
  );
}

function makeRead(context: ApplicationRevisionActivationContextV1) {
  return Effect.fn("StandardApplicationActiveRevisionReader.read")(
    () => readActiveApplicationRevisionV1(context),
  )();
}

export {
  type AuthoritativeCommittedApplicationMutationOutcome as
    AuthoritativeCommittedApplicationPointMutationOutcomeV1,
} from "./ApplicationMutationSystem";
export type {
  CompletedApplicationAction as CompletedApplicationActionV1,
  InvokeApplicationActionResult as InvokeApplicationActionV1Result,
  NonCompletedApplicationAction as NonCompletedApplicationActionV1,
} from "./ApplicationActionSystem";

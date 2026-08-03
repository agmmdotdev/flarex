import {
  readActiveApplicationRevisionV1,
  type ApplicationRevisionActivationContextV1,
  type ReadActiveApplicationRevisionV1Error,
} from
  "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import { Context, Effect, Layer, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

import {
  ApplicationPointMutationSystemV1,
  invokeApplicationPointMutationV1,
  type AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  type InvokeApplicationPointMutationV1Error,
} from "./systemV1";
import {
  ApplicationPointQuerySystemV1,
  invokeApplicationPointQueryV1,
  type InvokeApplicationPointQueryV1Error,
} from "./querySystemV1";

export interface StandardApplicationActiveRevisionReaderV1Api {
  readonly read: ReturnType<typeof makeRead>;
}

export class StandardApplicationActiveRevisionReaderV1 extends Context.Service<
  StandardApplicationActiveRevisionReaderV1,
  StandardApplicationActiveRevisionReaderV1Api
>()(
  "flarex/standard-application-invocation/StandardApplicationActiveRevisionReaderV1",
) {}

export type InvokeStandardApplicationPointMutationV1Error =
  | ReadActiveApplicationRevisionV1Error
  | InvokeApplicationPointMutationV1Error;

export type InvokeStandardApplicationPointQueryV1Error =
  | ReadActiveApplicationRevisionV1Error
  | InvokeApplicationPointQueryV1Error;

/**
 * SAP04 thin consumer. It reads one coherent active revision and delegates to
 * the private System operation without translating its authoritative outcome
 * or typed owner failures.
 */
export const invokeStandardApplicationPointMutationV1 = Effect.fn(
  "StandardApplication.invokePointMutationV1",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  InvokeStandardApplicationPointMutationV1Error,
  | StandardApplicationActiveRevisionReaderV1
  | ApplicationPointMutationSystemV1
  | Scope.Scope
> {
  const reader = yield* StandardApplicationActiveRevisionReaderV1;
  const active = yield* reader.read;
  return yield* invokeApplicationPointMutationV1(
    active.selection,
    functionRef,
    args,
    requestKey,
  );
});

/**
 * SAP05 thin consumer. It reads one coherent active revision and delegates to
 * the private System query operation without translating its validated value
 * or typed owner failures.
 */
export const invokeStandardApplicationPointQueryV1 = Effect.fn(
  "StandardApplication.invokePointQueryV1",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
): Effect.fn.Return<
  CanonicalFlarexRuntimeValueV1,
  InvokeStandardApplicationPointQueryV1Error,
  | StandardApplicationActiveRevisionReaderV1
  | ApplicationPointQuerySystemV1
  | Scope.Scope
> {
  const reader = yield* StandardApplicationActiveRevisionReaderV1;
  const active = yield* reader.read;
  return yield* invokeApplicationPointQueryV1(
    active.selection,
    functionRef,
    args,
  );
});

export function makeStandardApplicationActiveRevisionReaderV1Layer(
  context: ApplicationRevisionActivationContextV1,
): Layer.Layer<StandardApplicationActiveRevisionReaderV1> {
  return Layer.succeed(
    StandardApplicationActiveRevisionReaderV1,
    StandardApplicationActiveRevisionReaderV1.of({ read: makeRead(context) }),
  );
}

function makeRead(context: ApplicationRevisionActivationContextV1) {
  return Effect.fn("StandardApplicationActiveRevisionReader.read")(
    () => readActiveApplicationRevisionV1(context),
  )();
}

export {
  type AuthoritativeCommittedApplicationPointMutationOutcomeV1,
} from "./systemV1";

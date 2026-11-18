/** App-lifetime admission: Core's function-type limiter plus callback and open-query limits. */
import { Effect, Schema } from "effect";
import { CoreAdmissionChannelsSchema, CoreAdmissionPositiveCount, CoreApplicationAdmissionError, makeCoreAdmissionLimiter,
  type CoreApplicationFunctionKind } from "@flarex/persistence-postgres/internal/core";

export { CoreApplicationAdmissionError, type CoreApplicationFunctionKind };

export const CoreApplicationAdmissionConfigurationSchema = Schema.Struct({
  ...CoreAdmissionChannelsSchema.fields,
  /** Outstanding foreign callbacks, including the currently executing callback. */
  maxPendingCallbacks: CoreAdmissionPositiveCount,
  /** Retained bridge stream handles; independent of unioned core read intervals. */
  maxOpenQueries: CoreAdmissionPositiveCount,
});
export type CoreApplicationAdmissionConfiguration = typeof CoreApplicationAdmissionConfigurationSchema.Type;

export interface CoreApplicationAdmission {
  readonly maxPendingCallbacks: number;
  readonly maxOpenQueries: number;
  readonly withPermit: <A, E, R>(kind: CoreApplicationFunctionKind,
    work: Effect.Effect<A, E, R>) => Effect.Effect<A, E | CoreApplicationAdmissionError, R>;
  /** Refuse new/queued work, then wait for active owners to drain before release. */
  readonly close: Effect.Effect<void>;
}

/** One app-lifetime owner; both fresh query and mutation layers borrow it.
 * Nested function calls stay inside their admitted root invocation. */
export const makeCoreApplicationAdmission = Effect.fn("CoreApplicationAdmission.make")(function* (
  input: CoreApplicationAdmissionConfiguration,
) {
  const configuration = yield* Schema.decodeUnknownEffect(CoreApplicationAdmissionConfigurationSchema)(input).pipe(
    Effect.mapError(cause => new CoreApplicationAdmissionError({ reason: "invalidConfiguration", cause })),
  );
  const limiter = makeCoreAdmissionLimiter(configuration);
  const close = Effect.fn("CoreApplicationAdmission.close")(() => Effect.andThen(limiter.stop, limiter.drained));
  const admission: CoreApplicationAdmission = Object.freeze({
    maxPendingCallbacks: configuration.maxPendingCallbacks,
    maxOpenQueries: configuration.maxOpenQueries,
    withPermit: Effect.fn("CoreApplicationAdmission.withPermit")(<A, E, R>(
      kind: CoreApplicationFunctionKind, work: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | CoreApplicationAdmissionError, R> => limiter.withPermit(kind, work, error => error)),
    close: close(),
  });
  yield* Effect.addFinalizer(() => admission.close);
  return admission;
});

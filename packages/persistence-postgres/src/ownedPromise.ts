import { Effect } from "effect";

/** A foreign operation with a bounded resource lifetime must settle before its
 * owner releases that resource. Cancellation signals stop subsequent work;
 * cleanup joins the one operation already started. */
export const runOwnedPromise = Effect.fn("OwnedPromise.run")(<Value, Failure>(
  work: (signal: AbortSignal) => Promise<Value>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<Value, Failure> => Effect.suspend(() => {
  const controller = new AbortController();
  let pending: Promise<Value> | undefined;
  return Effect.tryPromise({
    try: () => { pending = Promise.resolve().then(() => work(controller.signal)); return pending; },
    catch: mapFailure,
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: lifecycle - joins an already bounded owned Promise through nonthrowing settlement handlers before releasing its resource
  }).pipe(Effect.ensuring(Effect.promise(async () => {
    controller.abort();
    // This bridge is only for already bounded resource operations. It must not
    // be used for arbitrary framework callbacks that can ignore cancellation.
    await pending?.then(() => undefined, () => undefined);
  })));
}));

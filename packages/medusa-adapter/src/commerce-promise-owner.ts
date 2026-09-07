import { Effect, Option } from "effect";
import { commerceError, commerceLimits, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Own all DAL runners at the single framework boundary. Closing prevents late
 * Promise callbacks from starting SQL, interrupts and joins started runners,
 * and gives framework continuations a bounded opportunity to finish. */
export function makeCommercePromiseOwner() {
  const controller = new AbortController();
  const runners = new Set<Promise<unknown>>();
  const callbacks = new Set<Promise<unknown>>();
  let open = true;
  let refusal = Option.none<CommerceTransactionError>();
  // Synchronous framework signatures cannot return an Effect. Keep their first
  // refusal sticky until the owning service bridge can poison the transaction.
  const reject = (error: CommerceTransactionError): never => {
    if (Option.isNone(refusal)) refusal = Option.some(error);
    throw error;
  };
  const stop = () => { open = false; controller.abort(); };
  const track = <Value>(pending: Promise<Value>, set: Set<Promise<unknown>>) => {
    set.add(pending);
    void pending.then(() => set.delete(pending), () => set.delete(pending));
    return pending;
  };
  const run = <Value>(work: Effect.Effect<Value, CommerceTransactionError>): Promise<Value> => {
    if (!open) return Promise.reject(commerceError("closed"));
    return track(Effect.runPromise(work, { signal: controller.signal }), runners);
  };
  const callback = <Value>(work: () => Promise<Value>, signal: AbortSignal): Promise<Value> => {
    if (!open || signal.aborted) return Promise.reject(commerceError("closed"));
    signal.addEventListener("abort", stop, { once: true });
    return track(Promise.resolve().then(() => {
      if (!open) throw commerceError("closed");
      return work();
    }).finally(() => signal.removeEventListener("abort", stop)), callbacks);
  };
  const close = Effect.promise(async () => {
    stop();
    // Every runner uses the shared cancellation signal. Its Effect finalizers
    // join bounded SQL before the transaction callback can return.
    await Promise.allSettled([...runners]);
    if (callbacks.size !== 0) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, commerceLimits.cleanupMs);
        void Promise.allSettled([...callbacks]).then(() => { clearTimeout(timer); resolve(); });
      });
    }
  });
  return { run, callback, close, reject, refusal: () => refusal, hasPending: () => runners.size !== 0 || callbacks.size !== 0 };
}
export type CommercePromiseOwner = ReturnType<typeof makeCommercePromiseOwner>;

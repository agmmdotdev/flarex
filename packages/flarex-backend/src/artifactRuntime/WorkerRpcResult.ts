import { Effect } from "effect";

export const callOwnedWorkerRpc = Effect.fn(
  "WorkerRpcResult.callOwnedWorkerRpc",
)(<Failure>(input: {
  readonly wallMilliseconds: number;
  readonly invoke: () => PromiseLike<unknown>;
  readonly mapExpectedFailure: (cause: unknown) => Failure | undefined;
  readonly timedOut: () => Failure;
  readonly invalidResult: (cause: unknown) => Failure;
}): Effect.Effect<unknown, Failure> => Effect.acquireUseRelease(
    Effect.sync(createOwnedRpcResultLease),
    lease => Effect.tryPromise({
      try: signal => awaitRpcSettlement(input.invoke, signal, lease),
      catch: cause => cause,
    }).pipe(
      Effect.catch((cause: unknown) => {
        const failure = input.mapExpectedFailure(cause);
        return failure === undefined
          ? Effect.die(cause)
          : Effect.fail(failure);
      }),
      Effect.timeoutOrElse({
        duration: `${input.wallMilliseconds} millis`,
        orElse: () => Effect.fail(input.timedOut()),
      }),
      Effect.flatMap(value => Effect.try({
        try: () => detachRpcResult(value),
        catch: input.invalidResult,
      })),
    ),
    lease => Effect.sync(() => lease.dispose()),
  ));

function awaitRpcSettlement(
  invoke: () => PromiseLike<unknown>,
  signal: AbortSignal,
  lease: OwnedRpcResultLease,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      signal.removeEventListener("abort", onAbort);
    };
    const abandon = (cause: unknown): void => {
      if (abandoned) return;
      abandoned = true;
      cleanup();
      reject(cause);
    };
    const onAbort = (): void => { abandon(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(invoke());
    } catch (cause) {
      cleanup();
      reject(cause);
      return;
    }
    pending.then(value => {
      cleanup();
      if (abandoned) {
        try {
          lease.accept(value);
        } catch {
          // No live caller remains to receive late-result disposal failure.
        }
        return;
      }
      try {
        if (lease.accept(value)) resolve(value);
      } catch (cause) {
        reject(cause);
      }
    }, cause => {
      cleanup();
      if (!abandoned) reject(cause);
    });
  });
}

interface OwnedRpcResultLease {
  readonly accept: (value: unknown) => boolean;
  readonly dispose: () => void;
}

function createOwnedRpcResultLease(): OwnedRpcResultLease {
  let value: unknown;
  let attached = false;
  let closed = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    if (attached) disposeRpcValue(value);
  };
  return Object.freeze({
    accept: (next: unknown): boolean => {
      if (attached) {
        disposeRpcValue(next);
        throw new Error("Worker RPC result lease is already attached.");
      }
      if (closed) {
        disposeRpcValue(next);
        return false;
      }
      attached = true;
      value = next;
      return true;
    },
    dispose,
  });
}

function detachRpcResult(value: unknown): unknown {
  if (value === null ||
    (typeof value !== "object" && typeof value !== "function")) return value;
  const detached: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key === Symbol.dispose) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error("Worker RPC result must contain data properties.");
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}

function disposeRpcValue(value: unknown): void {
  if (value === null ||
    (typeof value !== "object" && typeof value !== "function")) return;
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") Reflect.apply(dispose, value, []);
}

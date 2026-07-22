import { Effect } from "effect";

export const readBackendBoundedBody = Effect.fn("BackendBoundedBody.read")(
  <LimitError, ResourceError>(
    body: ReadableStream<Uint8Array> | null,
    maximumBodyBytes: number,
    errors: Readonly<{
      readonly limitExceeded: () => LimitError;
      readonly resourceFailure: (cause: unknown) => ResourceError;
    }>,
  ): Effect.Effect<Uint8Array, LimitError | ResourceError> =>
    Effect.tryPromise({
      try: signal => readBoundedBodyPromise(body, maximumBodyBytes, signal),
      catch: cause => cause instanceof BackendBodyTooLarge
        ? errors.limitExceeded()
        : errors.resourceFailure(cause),
    }),
);

async function readBoundedBodyPromise(
  body: ReadableStream<Uint8Array> | null,
  maximumBodyBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const items: number[] = [];
  let reads = 0;
  const maximumReads = maximumBodyBytes === Number.MAX_SAFE_INTEGER
    ? Number.MAX_SAFE_INTEGER
    : maximumBodyBytes + 1;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      reads += 1;
      if (reads > maximumReads) {
        await reader.cancel().catch(() => undefined);
        throw new BackendBodyTooLarge();
      }
      for (const byte of Uint8Array.prototype.values.call(next.value)) {
        if (items.length >= maximumBodyBytes) {
          await reader.cancel().catch(() => undefined);
          throw new BackendBodyTooLarge();
        }
        items.push(byte);
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  return Uint8Array.from(items);
}

class BackendBodyTooLarge extends Error {}

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
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
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
      const chunk = new Uint8Array(next.value);
      const candidateBytes = totalBytes + chunk.byteLength;
      if (!Number.isSafeInteger(candidateBytes) ||
        candidateBytes > maximumBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BackendBodyTooLarge();
      }
      if (chunk.byteLength > 0) chunks.push(chunk);
      totalBytes = candidateBytes;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

class BackendBodyTooLarge extends Error {}

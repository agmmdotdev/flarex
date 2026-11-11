import { Effect } from "effect";

export const readBackendBoundedBody = Effect.fn("BackendBoundedBody.read")(
  <LimitError, ResourceError>(
    body: ReadableStream<Uint8Array> | null,
    maximumBodyBytes: number,
    errors: Readonly<{
      readonly limitExceeded: () => LimitError;
      readonly resourceFailure: (cause: unknown) => ResourceError;
    }>,
  ): Effect.Effect<Uint8Array, LimitError | ResourceError> => {
    if (body === null) return Effect.succeed(new Uint8Array());
    return Effect.gen(function* () {
      let ended = false;
      return yield* Effect.acquireUseRelease(
        Effect.try({ try: () => body.getReader(), catch: errors.resourceFailure }),
        reader => Effect.gen(function* () {
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          let reads = 0;
          const maximumReads = maximumBodyBytes === Number.MAX_SAFE_INTEGER
            ? Number.MAX_SAFE_INTEGER : maximumBodyBytes + 1;
          while (true) {
            const next = yield* Effect.tryPromise({ try: () => reader.read(), catch: cause => {
              // An errored stream is terminal. Cancelling it would repeat this
              // same rejection instead of contributing a distinct cleanup error.
              ended = true;
              return errors.resourceFailure(cause);
            } });
            if (next.done) { ended = true; break; }
            reads++;
            if (reads > maximumReads) return yield* Effect.fail(errors.limitExceeded());
            const chunk = new Uint8Array(next.value);
            const candidateBytes = totalBytes + chunk.byteLength;
            if (!Number.isSafeInteger(candidateBytes) || candidateBytes > maximumBodyBytes)
              return yield* Effect.fail(errors.limitExceeded());
            if (chunk.byteLength > 0) chunks.push(chunk);
            totalBytes = candidateBytes;
          }
          const bytes = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          return bytes;
        }),
        reader => {
          const release = Effect.sync(() => reader.releaseLock());
          // Release is uninterruptible: cancellation must settle before its
          // reader can leave the owner. A cleanup failure retains the use Cause.
          return ended ? release : Effect.tryPromise({ try: () => reader.cancel(), catch: errors.resourceFailure })
            .pipe(Effect.ensuring(release));
        },
      );
    });
  },
);

import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { readBackendBoundedBody } from "../src/boundedBody";

describe("backend bounded body reader", () => {
  it("copies multiple chunks at the exact limit and rejects limit plus one", async () => {
    const exact = await Effect.runPromise(readBackendBoundedBody(
      stream([Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)]),
      5,
      errors,
    ));
    expect(exact).toEqual(Uint8Array.of(1, 2, 3, 4, 5));

    const failure = await Effect.runPromise(Effect.flip(readBackendBoundedBody(
      stream([Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)]),
      4,
      errors,
    )));
    expect(failure).toBe(limitError);
  });

  it("owns chunk bytes instead of retaining mutable producer storage", async () => {
    const chunk = Uint8Array.of(1, 2, 3);
    const body = stream([chunk]);
    const read = await Effect.runPromise(readBackendBoundedBody(body, 3, errors));
    chunk.fill(9);
    expect(read).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("drains a held stream cancellation before releasing interruption", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const cancelling = yield* Deferred.make<void>();
      let finishCancellation: (() => void) | undefined;
      let cancellationSettled = false;
      const cancellation = new Promise<void>(resolve => { finishCancellation = resolve; });
      const body = new ReadableStream<Uint8Array>({
        pull() { Deferred.doneUnsafe(reading, Effect.void); },
        cancel() {
          Deferred.doneUnsafe(cancelling, Effect.void);
          return cancellation.then(() => { cancellationSettled = true; });
        },
      }, { highWaterMark: 0 });
      yield* Effect.gen(function* () {
        const work = yield* Effect.forkChild(readBackendBoundedBody(body, 16, errors));
        yield* Deferred.await(reading);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(work));
        yield* Deferred.await(cancelling);
        yield* Effect.yieldNow;
        expect(cancellationSettled).toBe(false);
        expect(interrupting.pollUnsafe()).toBeUndefined();
        finishCancellation?.();
        yield* Fiber.join(interrupting);
        const interrupted = yield* Fiber.await(work);
        expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
        expect(cancellationSettled).toBe(true);
        expect(body.locked).toBe(false);
      }).pipe(Effect.ensuring(Effect.sync(() => { finishCancellation?.(); })));
    })));
  });

  it("retains a held cancellation rejection alongside interruption", async () => {
    const cancelFailure = new Error("underlying cancellation failed");
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const cancelling = yield* Deferred.make<void>();
      let rejectCancellation: ((cause: unknown) => void) | undefined;
      const cancellation = new Promise<void>((_resolve, reject) => { rejectCancellation = reject; });
      void cancellation.catch(() => undefined);
      const body = new ReadableStream<Uint8Array>({
        pull() { Deferred.doneUnsafe(reading, Effect.void); },
        cancel() { Deferred.doneUnsafe(cancelling, Effect.void); return cancellation; },
      }, { highWaterMark: 0 });
      yield* Effect.gen(function* () {
        const work = yield* Effect.forkChild(readBackendBoundedBody(body, 16, {
          limitExceeded: () => limitError, resourceFailure: cause => ({ _tag: "ResourceError" as const, cause }),
        }));
        yield* Deferred.await(reading);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(work));
        yield* Deferred.await(cancelling);
        yield* Effect.yieldNow;
        expect(interrupting.pollUnsafe()).toBeUndefined();
        rejectCancellation?.(cancelFailure);
        yield* Fiber.join(interrupting);
        const interrupted = yield* Fiber.await(work);
        expect(Exit.isFailure(interrupted)).toBe(true);
        if (Exit.isFailure(interrupted)) {
          expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
          expect(interrupted.cause.reasons.some(reason => Cause.isFailReason(reason)
            && reason.error._tag === "ResourceError" && reason.error.cause === cancelFailure)).toBe(true);
        }
        expect(body.locked).toBe(false);
      }).pipe(Effect.ensuring(Effect.sync(() => { rejectCancellation?.(cancelFailure); })));
    })));
  });

  it("retains both the byte-limit refusal and cancellation failure", async () => {
    const cancelFailure = new Error("cancellation failed after byte limit");
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2)); },
      cancel() { return Promise.reject(cancelFailure); },
    });
    const result = await Effect.runPromiseExit(readBackendBoundedBody(body, 1, {
      limitExceeded: () => limitError, resourceFailure: cause => ({ _tag: "ResourceError" as const, cause }),
    }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === limitError)).toBe(true);
      expect(result.cause.reasons.some(reason => Cause.isFailReason(reason)
        && reason.error._tag === "ResourceError" && reason.error.cause === cancelFailure)).toBe(true);
    }
    expect(body.locked).toBe(false);
  });

  it("does not duplicate an already terminal read error during release", async () => {
    const readFailure = new Error("read failed");
    let cancellations = 0;
    let classifications = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(readFailure); },
      cancel() { cancellations++; },
    });
    const result = await Effect.runPromiseExit(readBackendBoundedBody(body, 1, {
      limitExceeded: () => limitError,
      resourceFailure: cause => { classifications++; return { _tag: "ResourceError" as const, cause }; },
    }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(result.cause.reasons).toHaveLength(1);
    expect(classifications).toBe(1);
    expect(cancellations).toBe(0);
    expect(body.locked).toBe(false);
  });
});

const limitError = Object.freeze({ _tag: "LimitError" as const });
const resourceError = Object.freeze({ _tag: "ResourceError" as const });
const errors = Object.freeze({
  limitExceeded: () => limitError,
  resourceFailure: () => resourceError,
});

function stream(chunks: ReadonlyArray<Uint8Array>): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}

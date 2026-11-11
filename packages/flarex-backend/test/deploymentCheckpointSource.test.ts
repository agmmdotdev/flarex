import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { makeDeploymentCheckpointSource } from "../src/deploymentSync/CheckpointSource";

const route = { deploymentId: "checkpoint-source", scopeUuid: "93000000-0000-4000-8000-000000000001",
  epochUuid: "93000000-0000-4000-8000-000000000002" };

describe("checkpoint source transport lifetime", () => {
  it("drains an aborted pending Fetch and cancels its late response", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const aborted = yield* Deferred.make<void>();
      let completeFetch: ((response: Response) => void) | undefined;
      let bodyCancels = 0;
      const pending = new Promise<Response>(resolve => { completeFetch = resolve; });
      const source = makeDeploymentCheckpointSource({ FLAREX_EXECUTOR_TOKEN: "test-secret",
        FLAREX_EXECUTOR: { fetch(request) {
          request.signal.addEventListener("abort", () => Deferred.doneUnsafe(aborted, Effect.void), { once: true });
          Deferred.doneUnsafe(entered, Effect.void);
          return pending;
        } } }, route);
      const late = () => new Response(new ReadableStream<Uint8Array>({ cancel() { bodyCancels++; } }));
      yield* Effect.gen(function* () {
        const work = yield* Effect.forkChild(source.certify({ checkpoint: undefined, maximumElapsedMilliseconds: 10_000 }));
        yield* Deferred.await(entered);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(work));
        yield* Deferred.await(aborted);
        yield* Effect.yieldNow;
        expect(interrupting.pollUnsafe()).toBeUndefined();
        completeFetch?.(late());
        yield* Fiber.join(interrupting);
        const interrupted = yield* Fiber.await(work);
        expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
        expect(bodyCancels).toBe(1);
      }).pipe(Effect.ensuring(Effect.sync(() => { completeFetch?.(late()); })));
    })));
  });

  it("retains body cancellation failure alongside source interruption", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const cancellationFailure = new Error("source body cancellation failed");
      const body = new ReadableStream<Uint8Array>({
        pull() { Deferred.doneUnsafe(reading, Effect.void); },
        cancel() { return Promise.reject(cancellationFailure); },
      }, { highWaterMark: 0 });
      const source = makeDeploymentCheckpointSource({ FLAREX_EXECUTOR_TOKEN: "test-secret",
        FLAREX_EXECUTOR: { fetch: () => Promise.resolve(new Response(body)) } }, route);
      const work = yield* Effect.forkChild(source.certify({ checkpoint: undefined, maximumElapsedMilliseconds: 10_000 }));
      yield* Deferred.await(reading);
      yield* Fiber.interrupt(work);
      const interrupted = yield* Fiber.await(work);
      expect(Exit.isFailure(interrupted)).toBe(true);
      if (Exit.isFailure(interrupted)) {
        expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
        expect(interrupted.cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error.reason === "sourceUnavailable" && reason.error.cause === cancellationFailure)).toBe(true);
      }
      expect(body.locked).toBe(false);
    })));
  });
});

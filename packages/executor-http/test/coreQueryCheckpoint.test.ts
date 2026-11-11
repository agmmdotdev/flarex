import { Cause, Data, Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { makeCoreQueryCheckpointHttpHandler } from "../src/coreQueryCheckpoint";
import { CoreApplicationTransportError } from "../src/coreApplication";

const route = { deploymentId: "checkpoint-owner", scopeUuid: "45000000-0000-4000-8000-000000000001", epochUuid: "45000000-0000-4000-8000-000000000002" };
const body = { format: "flarex.core-query-checkpoint.request", version: 1, route, sourceId: null, after: null, maximumElapsedMilliseconds: 10_000 };
const certificate = { format: "flarex.core-query-checkpoint.response" as const, version: 1 as const, kind: "certified" as const,
  route, sourceId: "aa".repeat(32), after: null, retainedFrom: "10", through: "20" };
const request = (value: unknown = body) => new Request(`https://checkpoint.test/applications/${route.deploymentId}/query-checkpoint`, {
  method: "POST", body: JSON.stringify(value),
});

describe("Core checkpoint HTTP boundary", () => {
  for (const trigger of ["deadline", "external interruption"] as const)
  it(`drains held request cancellation and retains its rejection after ${trigger}`, async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const cancelling = yield* Deferred.make<void>();
      const cleanupFailure = new Error(`Request cancellation failed after ${trigger}`);
      let rejectCancellation: (cause: unknown) => void = () => { throw new Error("Cancellation promise was not constructed"); };
      const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
      const stream = new ReadableStream<Uint8Array>({
        pull: () => { Deferred.doneUnsafe(reading, Effect.void); return new Promise<void>(() => {}); },
        cancel: () => { Deferred.doneUnsafe(cancelling, Effect.void); return cancellation; },
      }, { highWaterMark: 0 });
      const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
      const pending = new Request(`https://checkpoint.test/applications/${route.deploymentId}/query-checkpoint`, init);
      const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
        authorize: () => Effect.succeed(true), execute: () => Effect.die("An incomplete body invoked Core") });
      const running = yield* Effect.forkChild(handle(pending));
      yield* Effect.gen(function* () {
        yield* Deferred.await(reading);
        const interrupting = trigger === "external interruption" ? yield* Effect.forkChild(Fiber.interrupt(running)) : undefined;
        if (trigger === "deadline") yield* TestClock.adjust("10000 millis");
        yield* Deferred.await(cancelling);
        expect(yield* Effect.sync(() => running.pollUnsafe())).toBeUndefined();
        yield* Effect.sync(() => rejectCancellation(cleanupFailure));
        if (interrupting !== undefined) yield* Fiber.join(interrupting);
        const completed = yield* Fiber.await(running);
        expect(Exit.isFailure(completed)).toBe(true);
        if (Exit.isFailure(completed)) {
          expect(Cause.hasInterrupts(completed.cause)).toBe(true);
          expect(completed.cause.reasons.some(reason => Cause.isFailReason(reason)
            && reason.error instanceof CoreApplicationTransportError && reason.error.reason === "bodyReadFailed"
            && reason.error.cause === cleanupFailure)).toBe(true);
        }
        expect(stream.locked).toBe(false);
      }).pipe(Effect.ensuring(Effect.sync(() => rejectCancellation(cleanupFailure))));
    }).pipe(Effect.provide(TestClock.layer())));
  });
  it("originates a sole body timeout failure when its cancellation succeeds", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const stream = new ReadableStream<Uint8Array>({ pull: () => {
        Deferred.doneUnsafe(reading, Effect.void);
        return new Promise<void>(() => {});
      } }, { highWaterMark: 0 });
      const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
      const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
        authorize: () => Effect.succeed(true), execute: () => Effect.die("An expired body invoked Core") });
      const running = yield* Effect.forkChild(handle(new Request(`https://checkpoint.test/applications/${route.deploymentId}/query-checkpoint`, init)));
      yield* Deferred.await(reading);
      yield* TestClock.adjust("10000 millis");
      const completed = yield* Fiber.await(running);
      expect(Exit.isFailure(completed)).toBe(true);
      if (Exit.isFailure(completed)) expect(completed.cause.reasons).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ _tag: "CoreApplicationTransportError", reason: "bodyReadFailed" }) }),
      ]);
      expect(stream.locked).toBe(false);
    }).pipe(Effect.provide(TestClock.layer())));
  });
  it("authorizes before reading the body or invoking the source", async () => {
    const input = request();
    Object.defineProperty(input, "body", { get: () => { throw new Error("Unauthorized request read its body"); } });
    const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(false), execute: () => Effect.die("Unauthorized request invoked Core") });
    expect((await Effect.runPromise(handle(input))).status).toBe(401);
  });
  it("bounds actual request bytes, scope and strict decoding before source execution", async () => {
    const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.die("Malformed request invoked Core") });
    expect((await Effect.runPromise(handle(request({ ...body, extra: true })))).status).toBe(400);
    expect((await Effect.runPromise(handle(request({ ...body, route: { ...route, deploymentId: "foreign" } })))).status).toBe(403);
    const oversized = new Request(request(), { body: " ".repeat(4097), headers: { "content-length": "1" } });
    expect((await Effect.runPromise(handle(oversized))).status).toBe(413);
  });
  it("returns detached source evidence while retaining the source failure channel", async () => {
    class SourceFailure extends Data.TaggedError("CheckpointTestSourceFailure")<{ readonly reason: "unavailable" }> {}
    const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.succeed(certificate) });
    expect(await (await Effect.runPromise(handle(request()))).json()).toEqual(certificate);
    const fail = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.fail(new SourceFailure({ reason: "unavailable" })) });
    expect(await Effect.runPromise(fail(request()).pipe(Effect.flip))).toMatchObject({ _tag: "CheckpointTestSourceFailure", reason: "unavailable" });
  });
  it("preserves invalid response failure rather than disclosing malformed evidence", async () => {
    const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.succeed({ ...certificate, retainedFrom: "21" }) });
    expect(await Effect.runPromise(handle(request()).pipe(Effect.flip))).toBeInstanceOf(CoreApplicationTransportError);
  });
  it("refuses source evidence after the end-to-end request deadline", async () => {
    const handle = makeCoreQueryCheckpointHttpHandler({ route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.sleep("2 millis").pipe(Effect.as(certificate)) });
    expect((await Effect.runPromise(handle(request({ ...body, maximumElapsedMilliseconds: 1 })))).status).toBe(503);
  });
});

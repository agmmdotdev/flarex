import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import {
  canonicalPrivateAnalyzerHandshakeRequestV1,
  decodePrivateAnalyzerHandshakeBytesV1,
  makePrivateAnalyzerHandshakeHostV1,
  privateAnalyzerHandshakeBodyReadCause,
  readPrivateAnalyzerHandshakeBodyV1,
  type PrivateAnalyzerHandshakeHostV1,
  type PrivateAnalyzerIdentityTupleV1,
} from "../src/Handshake";
import { installedPrivateAnalyzerIdentityV1 } from "../src/Identity";
import {
  PrivateAnalyzerHostConfigurationV1Error,
} from "../src/Configuration";
import worker from "../src/worker";

const installed = installedPrivateAnalyzerIdentityV1();

describe("private analyzer identity handshake", () => {
  it("validates configuration before constructing a host and keeps the operation E/R closed", async () => {
    const failedHost = makePrivateAnalyzerHandshakeHostV1({
      configuration: {},
      identity: installed.identity,
    });
    expect(Result.isFailure(failedHost)).toBe(true);
    if (Result.isFailure(failedHost)) {
      expect(failedHost.failure).toBeInstanceOf(PrivateAnalyzerHostConfigurationV1Error);
      expect(failedHost.failure.field).toBe("toolchain");
      expect(failedHost.failure.reason).toBe("invalidConfiguration");
    }
    const host = makeHost();
    const request = validRequest();
    Object.defineProperty(request, "json", {
      value: () => {
        throw new Error("request.json must not be called");
      },
    });
    const effect: Effect.Effect<Response, never, never> = host.handle(request);
    const response = await Effect.runPromise(effect);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "compatible",
      ...installed.identity,
    });
  });

  it("rejects missing, extra, malformed, noncanonical, trailing, hostile, and mismatched evidence", () => {
    const canonical = canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity);
    const cases: unknown[] = [
      new Uint8Array(0),
      new TextEncoder().encode("{"),
      new TextEncoder().encode(JSON.stringify({ ...installed.identity, extra: true })),
      new TextEncoder().encode(JSON.stringify(installed.identity, null, 2)),
      new Uint8Array([...canonical, 0x20]),
      new Proxy(canonical, {}),
      { byteLength: canonical.byteLength },
    ];
    for (const value of cases) {
      const result = decodePrivateAnalyzerHandshakeBytesV1(value, installed.identity);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toBe("malformed");
    }
    const mismatchIdentity: PrivateAnalyzerIdentityTupleV1 = {
      ...installed.identity,
      implementationIdentity: "f".repeat(64),
    };
    const mismatch = decodePrivateAnalyzerHandshakeBytesV1(
      canonicalPrivateAnalyzerHandshakeRequestV1(mismatchIdentity),
      installed.identity,
    );
    expect(Result.isFailure(mismatch)).toBe(true);
    if (Result.isFailure(mismatch)) expect(mismatch.failure.reason).toBe("identityMismatch");
  });

  it("enforces routing, content type, fixed byte bounds, and redacted statuses before compatibility work", async () => {
    let accepted = 0;
    const host = makeHost({
      onCompatible: () => Effect.sync(() => {
        accepted += 1;
      }),
    });
    const wrongPath = await Effect.runPromise(host.handle(new Request("https://analyzer.test/nope")));
    expect(wrongPath.status).toBe(404);
    expect(await wrongPath.json()).toEqual({ error: "not_found" });

    const wrongMethod = await Effect.runPromise(host.handle(new Request(
      `https://analyzer.test${installed.configuration.handshake.path}`,
    )));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");

    const wrongType = await Effect.runPromise(host.handle(new Request(
      `https://analyzer.test${installed.configuration.handshake.path}`,
      {
        method: "POST",
        body: ownedArrayBuffer(canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity)),
      },
    )));
    expect(wrongType.status).toBe(415);

    const mismatch = await Effect.runPromise(host.handle(handshakeRequest({
      ...installed.identity,
      configurationIdentity: "f".repeat(64),
    })));
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: "incompatible_identity" });
    expect(accepted).toBe(0);

    const oversizedByHeader = await Effect.runPromise(host.handle(new Request(
      `https://analyzer.test${installed.configuration.handshake.path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(host.maximumBodyBytes + 1),
        },
        body: new ArrayBuffer(0),
      },
    )));
    expect(oversizedByHeader.status).toBe(413);

    const invalidLength = await Effect.runPromise(host.handle(new Request(
      `https://analyzer.test${installed.configuration.handshake.path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "+1" },
        body: new ArrayBuffer(0),
      },
    )));
    expect(invalidLength.status).toBe(400);

    const canonical = canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity);
    const mismatchedLength = await Effect.runPromise(host.handle(new Request(
      `https://analyzer.test${installed.configuration.handshake.path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(canonical.byteLength - 1),
        },
        body: ownedArrayBuffer(canonical),
      },
    )));
    expect(mismatchedLength.status).toBe(400);
    expect(accepted).toBe(0);
  });

  it("reads the body once, owns streamed chunks, and stops before an oversized later chunk", async () => {
    const body = canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity);
    const split = Math.floor(body.byteLength / 2);
    const first = body.slice(0, split);
    const second = body.slice(split);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(first);
        } else if (pulls === 2) {
          controller.enqueue(second);
        } else {
          controller.close();
        }
      },
    });
    const host = makeHost({
      onCompatible: () => Effect.sync(() => {
        first.fill(0);
        second.fill(0);
      }),
    });
    const response = await Effect.runPromise(host.handle(streamRequest(stream)));
    expect(response.status).toBe(200);
    expect(pulls).toBe(3);

    let cancelled = false;
    const overflow = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(host.maximumBodyBytes + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const overflowResponse = await Effect.runPromise(host.handle(streamRequest(overflow)));
    expect(overflowResponse.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("bounds empty chunks and times out a stalled body with the configured clock policy", async () => {
    const host = makeHost();
    let emptyPulls = 0;
    let emptyCancelled = false;
    const emptyChunks = new ReadableStream<Uint8Array>({
      pull(controller) {
        emptyPulls += 1;
        controller.enqueue(new Uint8Array(0));
      },
      cancel() {
        emptyCancelled = true;
      },
    });
    const overflow = await Effect.runPromise(host.handle(streamRequest(emptyChunks)));
    expect(overflow.status).toBe(413);
    expect(emptyPulls).toBeLessThanOrEqual(host.maximumBodyBytes + 1);
    expect(emptyCancelled).toBe(true);

    let stalled!: () => void;
    const stalledPromise = new Promise<void>(resolve => {
      stalled = resolve;
    });
    let stalledCancelled = false;
    const stalledBody = new ReadableStream<Uint8Array>({
      pull() {
        stalled();
      },
      cancel() {
        stalledCancelled = true;
      },
    });
    const timedExit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(host.handle(streamRequest(stalledBody)));
      yield* Effect.promise(() => stalledPromise);
      yield* TestClock.adjust(
        `${installed.configuration.handshake.maximumBodyReadMilliseconds} millis`,
      );
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(Exit.isSuccess(timedExit)).toBe(true);
    if (Exit.isSuccess(timedExit)) {
      expect(timedExit.value.status).toBe(408);
      expect(await timedExit.value.json()).toEqual({ error: "request_timeout" });
    }
    expect(stalledCancelled).toBe(true);
  });

  it("redacts a stream rejection while retaining its exact private cause", async () => {
    const cause = new Error("private-stream-cause");
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw cause;
      },
    });
    const host = makeHost();
    const response = await Effect.runPromise(host.handle(streamRequest(stream)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "body_read_failed" });

    const failingRequest = streamRequest(new ReadableStream({
      pull() {
        throw cause;
      },
    }));
    const requestError = await Effect.runPromise(
      readPrivateAnalyzerHandshakeBodyV1(
        failingRequest,
        host.maximumBodyBytes,
        installed.configuration.handshake.maximumBodyReadMilliseconds,
      ).pipe(Effect.result),
    );
    expect(Result.isFailure(requestError)).toBe(true);
    if (Result.isFailure(requestError)) {
      expect(privateAnalyzerHandshakeBodyReadCause(requestError.failure)).toBe(cause);
    }
  });

  it("preserves defects and interruption outside the typed failure translation", async () => {
    const defect = Object.freeze({ defect: "identity-handshake" });
    const defectHost = makeHost({
      onCompatible: () => Effect.die(defect),
    });
    const defectExit = await Effect.runPromiseExit(defectHost.handle(validRequest()));
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      const dies = defectExit.cause.reasons.filter(Cause.isDieReason);
      expect(dies).toHaveLength(1);
      expect(dies[0]?.defect).toBe(defect);
    }

    const interruptedHost = makeHost({
      onCompatible: () => Effect.never,
    });
    const interruptedExit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(interruptedHost.handle(validRequest()));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(interruptedExit)).toBe(true);
    if (Exit.isFailure(interruptedExit)) {
      expect(Cause.hasInterrupts(interruptedExit.cause)).toBe(true);
      expect(Cause.hasDies(interruptedExit.cause)).toBe(false);
    }
  });

  it("cancels the owned body reader when interrupted without minting a response", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    let cancelCalls = 0;
    const body = {
      getReader() {
        return {
          read() {
            started();
            return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
          },
          cancel() {
            cancelCalls += 1;
            return Promise.resolve();
          },
          releaseLock() {
            // The body reader owns and releases this private reader exactly once.
          },
        };
      },
    };
    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(readPrivateAnalyzerHandshakeBodyV1(
        { body } as unknown as Request,
        canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity).byteLength,
        installed.configuration.handshake.maximumBodyReadMilliseconds,
      ));
      yield* Effect.promise(() => startedPromise);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(cancelCalls).toBe(1);
  });

  it("bridges request cancellation through the sole Worker runtime boundary", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    let cancelCalls = 0;
    const body = {
      getReader() {
        return {
          read() {
            started();
            return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
          },
          cancel() {
            cancelCalls += 1;
            return Promise.resolve();
          },
          releaseLock() {
            // The body reader owns and releases this private reader exactly once.
          },
        };
      },
    };
    const controller = new AbortController();
    const request = {
      body,
      headers: new Headers({ "content-type": "application/json" }),
      method: "POST",
      signal: controller.signal,
      url: `https://analyzer.test${installed.configuration.handshake.path}`,
    } as unknown as Request;
    const responsePromise = worker.fetch(request);
    await startedPromise;
    controller.abort();
    await expect(responsePromise).rejects.toBeDefined();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(cancelCalls).toBe(1);
  });
});

function validRequest(): Request {
  return handshakeRequest(installed.identity);
}

function handshakeRequest(identity: PrivateAnalyzerIdentityTupleV1): Request {
  return new Request(`https://analyzer.test${installed.configuration.handshake.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: ownedArrayBuffer(canonicalPrivateAnalyzerHandshakeRequestV1(identity)),
  });
}

function streamRequest(body: ReadableStream<Uint8Array>): Request {
  return new Request(`https://analyzer.test${installed.configuration.handshake.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function makeHost(options: {
  readonly onCompatible?: () => Effect.Effect<void, never, never>;
} = {}): PrivateAnalyzerHandshakeHostV1 {
  const result = makePrivateAnalyzerHandshakeHostV1({
    configuration: installed.configuration,
    identity: installed.identity,
    ...options,
  });
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

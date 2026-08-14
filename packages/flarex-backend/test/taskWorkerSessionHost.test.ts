import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/application-task-worker-v1";
import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import {
  TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
  TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
} from "flarex-protocol/internal/task-worker-session-v1";

import type { ApplicationTaskWorkerDefinition } from
  "../src/artifactRuntime/ApplicationTaskWorkerDefinition";
import type { LegacyTaskWorkerDefinition } from
  "../src/artifactRuntime/LegacyTaskWorkerDefinition";
import {
  makeTaskWorkerSessionHost,
  type TaskWorkerSessionHostStartInput,
} from "../src/artifactRuntime/TaskWorkerSessionHost";

describe("Task Worker session host", () => {
  it.each(["application_v1", "legacy_dynamic_worker_v1"] as const)(
    "starts a fresh outbound-denied %s session before terminal settlement",
    async generation => {
      const terminal = deferred<unknown>();
      let interruptionCalls = 0;
      const loader = new FakeWorkerLoader(start => remoteSession(
        start,
        terminal.promise,
        request => {
          interruptionCalls += 1;
          return interruptionFor(
            start,
            (request as { cancellationGeneration: bigint }).cancellationGeneration,
          );
        },
      ));
      const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(
        startInput(generation),
      ));

      expect(session.acceptance).toMatchObject({
        kind: "accepted",
        generation,
        executionId: "execution-1",
      });
      expect(loader.loaded).toHaveLength(1);
      expect(loader.loaded[0]?.globalOutbound).toBeNull();
      let settled = false;
      const waiting = Effect.runPromise(session.settlement).then(value => {
        settled = true;
        return value;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      terminal.resolve(settlementFor(session.acceptance));
      await expect(waiting).resolves.toMatchObject({ kind: "settled", generation });
      await Effect.runPromise(session.close);
      expect(interruptionCalls).toBe(0);
      expect(loader.sessionDisposals).toBe(1);
      const lost = await Effect.runPromise(session.settlement.pipe(Effect.flip));
      expect(lost.reason).toBe("sessionLost");
    },
  );

  it("correlates interruption receipts and maps stale cancellation distinctly", async () => {
    let interruptionCalls = 0;
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        interruptionCalls += 1;
        const requested = (request as { cancellationGeneration: bigint })
          .cancellationGeneration;
        if (requested < 2n) {
          throw Object.assign(new Error("stale"), {
            name: "TaskWorkerSessionStaleCancellationV1Error",
          });
        }
        return interruptionFor(start, requested);
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(
      startInput("application_v1"),
    ));
    const accepted = await Effect.runPromise(session.requestInterruption(
      interruptionFor(startInput("application_v1"), 2n, false),
    ));
    expect(accepted.cancellationGeneration).toBe(2n);
    const stale = await Effect.runPromise(session.requestInterruption(
      interruptionFor(startInput("application_v1"), 1n, false),
    ).pipe(Effect.flip));
    expect(stale.reason).toBe("staleCancellation");

    const invalid = interruptionFor(startInput("application_v1"), 3n, false);
    invalid.executionId = "other-execution";
    const rejected = await Effect.runPromise(
      session.requestInterruption(invalid).pipe(Effect.flip),
    );
    expect(rejected.reason).toBe("invalidRequest");
    expect(interruptionCalls).toBe(1);
    await Effect.runPromise(session.close);
    expect(interruptionCalls).toBe(2);
  });

  it("disposes a session that arrives after start interruption", async () => {
    const pending = deferred<unknown>();
    const loader = new FakeWorkerLoader(() => pending.promise);
    const host = makeTaskWorkerSessionHost(loader);
    const fiber = Effect.runFork(host.start(startInput("application_v1")));
    await Promise.resolve();
    await Effect.runPromise(Fiber.interrupt(fiber));
    pending.resolve(remoteSessionValue(startInput("application_v1"), Promise.resolve(
      settlementForAcceptance(startInput("application_v1")),
    ), loader));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loader.sessionDisposals).toBe(1);
  });

  it("classifies an unknown start rejection as workerStartFailed", async () => {
    const host = makeTaskWorkerSessionHost(new FakeWorkerLoader(() => {
      throw new Error("transport disconnected");
    }));
    const failure = await Effect.runPromise(host.start(
      startInput("application_v1"),
    ).pipe(Effect.flip));
    expect(failure.reason).toBe("workerStartFailed");
  });

  it("recomputes the absolute deadline after synchronous Worker loading", async () => {
    const loader = new FakeWorkerLoader(
      start => remoteSession(start, new Promise(() => undefined)),
      20,
    );
    const failure = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(startInput("application_v1", 5)).pipe(Effect.flip));
    expect(failure.reason).toBe("timedOut");
    expect(loader.starts).toBe(0);
  });

  it.each(["requestInterruption", "settlement"] as const)(
    "classifies a post-acceptance %s disconnect as sessionLost",
    async operation => {
      const disconnected = Promise.reject(new Error("transport disconnected"));
      disconnected.catch(() => undefined);
      const input = startInput("application_v1");
      const loader = new FakeWorkerLoader(start => remoteSession(
        start,
        operation === "settlement" ? disconnected : new Promise(() => undefined),
        operation === "requestInterruption" ? () => disconnected : undefined,
      ));
      const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
      const failure = operation === "settlement"
        ? await Effect.runPromise(session.settlement.pipe(Effect.flip))
        : await Effect.runPromise(session.requestInterruption(
            interruptionFor(input, 1n, false),
          ).pipe(Effect.flip));
      expect(failure.reason).toBe("sessionLost");
      if (operation === "requestInterruption") {
        const cleanup = await Effect.runPromise(session.close.pipe(Effect.flip));
        expect(cleanup.reason).toBe("cleanupFailed");
      } else {
        await Effect.runPromise(session.close);
      }
    },
  );

  it("expires and disposes an unobserved session from the absolute start deadline", async () => {
    let expiryInterruptions = 0;
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      () => {
        expiryInterruptions += 1;
        return interruptionFor(start, 1n);
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(startInput("application_v1", 25)));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(loader.sessionDisposals).toBe(1);
    expect(expiryInterruptions).toBe(1);
    const expired = await Effect.runPromise(session.settlement.pipe(Effect.flip));
    expect(expired.reason).toBe("timedOut");
  });

  it("closes only after a concurrent settlement RPC drains", async () => {
    const pending = deferred<unknown>();
    const loader = new FakeWorkerLoader(start => remoteSession(start, pending.promise));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(
      startInput("application_v1"),
    ));
    const settling = Effect.runPromise(session.settlement);
    await Promise.resolve();
    let closeFinished = false;
    const closing = Effect.runPromise(session.close).then(() => { closeFinished = true; });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    expect(loader.sessionDisposals).toBe(0);

    pending.resolve(settlementFor(session.acceptance));
    await expect(settling).resolves.toMatchObject({ kind: "settled" });
    await closing;
    expect(loader.sessionDisposals).toBe(1);
  });

  it("advances beyond and drains a concurrent accepted interruption generation", async () => {
    const pending = deferred<unknown>();
    const input = startInput("application_v1");
    let closeGeneration: bigint | undefined;
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        const generation = (request as { cancellationGeneration: bigint })
          .cancellationGeneration;
        if (generation === 2n) return pending.promise;
        closeGeneration = generation;
        return interruptionFor(start, generation);
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
    const interrupting = Effect.runPromise(session.requestInterruption(
      interruptionFor(input, 2n, false),
    ));
    await Promise.resolve();
    let closeFinished = false;
    const closing = Effect.runPromise(session.close).then(() => { closeFinished = true; });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    expect(loader.sessionDisposals).toBe(0);
    expect(closeGeneration).toBe(3n);

    pending.resolve(interruptionFor(input, 2n));
    await expect(interrupting).resolves.toMatchObject({ kind: "interruption_requested" });
    await closing;
    expect(loader.sessionDisposals).toBe(1);
  });

  it("drains an active expiry interruption before explicit close", async () => {
    const pending = deferred<unknown>();
    const input = startInput("application_v1", 20);
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      () => pending.promise,
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader, {
      handshakeMilliseconds: 100,
    }).start(input));
    await new Promise(resolve => setTimeout(resolve, 30));
    let closeFinished = false;
    const closing = Effect.runPromise(session.close).then(() => { closeFinished = true; });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    expect(loader.sessionDisposals).toBe(0);

    pending.resolve(interruptionFor(input, 1n));
    await closing;
    expect(loader.sessionDisposals).toBe(1);
  });

  it("delivers interruption before an early explicit close disposes the session", async () => {
    let closeGeneration: bigint | undefined;
    const input = startInput("application_v1");
    const loader = new FakeWorkerLoader(start => remoteSession(
      start,
      new Promise(() => undefined),
      request => {
        closeGeneration = (request as { cancellationGeneration: bigint })
          .cancellationGeneration;
        return interruptionFor(start, closeGeneration);
      },
    ));
    const session = await Effect.runPromise(makeTaskWorkerSessionHost(loader).start(input));
    await Effect.runPromise(session.close);
    expect(closeGeneration).toBe(1n);
    expect(loader.sessionDisposals).toBe(1);
  });
});

function startInput(
  generation: "application_v1" | "legacy_dynamic_worker_v1",
  maximumDurationMs = 30_000,
): TaskWorkerSessionHostStartInput {
  return generation === "application_v1"
    ? {
        generation,
        definition: applicationDefinition(maximumDurationMs),
        request: applicationRequest(maximumDurationMs),
        capability: Object.freeze({ read: async () => null }),
        executionId: "execution-1",
      }
    : {
        generation,
        definition: legacyDefinition(maximumDurationMs),
        request: legacyRequest(maximumDurationMs),
        capability: Object.freeze({ read: async () => null }),
        executionId: "execution-1",
      };
}

function remoteSession(
  start: TaskWorkerSessionHostStartInput,
  settlement: Promise<unknown>,
  interrupt?: (request: unknown) => unknown,
): unknown {
  return remoteSessionValue(start, settlement, undefined, interrupt);
}

function remoteSessionValue(
  start: TaskWorkerSessionHostStartInput,
  settlement: Promise<unknown>,
  owner?: FakeWorkerLoader,
  interrupt?: (request: unknown) => unknown,
): unknown {
  const acceptance = acceptanceFor(start);
  return Object.assign({
    acceptance: async () => acceptance,
    requestInterruption: async (request: unknown) => {
      if (owner !== undefined) owner.interruptionCalls += 1;
      return interrupt?.(request) ?? interruptionFor(start, 1n);
    },
    settlement: () => settlement,
  }, owner === undefined ? {} : {
    [Symbol.dispose]: () => { owner.sessionDisposals += 1; },
  });
}

function acceptanceFor(start: TaskWorkerSessionHostStartInput) {
  return {
    format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
    version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
    kind: "accepted" as const,
    generation: start.generation,
    identity: (start.request as ReturnType<typeof applicationRequest>).dispatch.identity,
    executionId: start.executionId,
    cancellationGeneration: 0n,
  };
}

function interruptionFor(
  start: TaskWorkerSessionHostStartInput,
  cancellationGeneration: bigint,
  acceptance = true,
) {
  return {
    format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
    version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
    ...(acceptance ? { kind: "interruption_requested" as const } : {}),
    generation: start.generation,
    identity: (start.request as ReturnType<typeof applicationRequest>).dispatch.identity,
    executionId: start.executionId,
    cancellationGeneration,
  };
}

function settlementFor(acceptance: ReturnType<typeof acceptanceFor>) {
  return {
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled" as const,
    generation: acceptance.generation,
    identity: acceptance.identity,
    executionId: acceptance.executionId,
  };
}

function settlementForAcceptance(start: TaskWorkerSessionHostStartInput) {
  return settlementFor(acceptanceFor(start));
}

function applicationDefinition(wallMilliseconds = 30_000): ApplicationTaskWorkerDefinition {
  return Object.freeze({
    runtimeTargetSha256Hex: "07".repeat(32),
    computeProfile: "standard-1x",
    compatibilityDate: "2026-06-14",
    wallMilliseconds,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    mainModule: "application.js",
    modules: Object.freeze({ "application.js": "export default {};" }),
    env: Object.freeze({}),
    entrypoint: "FlarexApplicationTaskWorker",
  });
}

function legacyDefinition(wallMilliseconds = 30_000): LegacyTaskWorkerDefinition {
  return Object.freeze({
    taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    computeProfile: "standard-1x",
    compatibilityDate: "2026-06-14",
    compatibilityFlags: Object.freeze([]),
    wallMilliseconds,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    mainModule: "application.js",
    modules: Object.freeze({ "application.js": "export default {};" }),
    env: Object.freeze({}),
    entrypoint: "FlarexLegacyTaskWorker",
  });
}

function applicationRequest(maximumDurationMs = 30_000) {
  return {
    format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      ...dispatch(maximumDurationMs),
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
    },
  };
}

function legacyRequest(maximumDurationMs = 30_000) {
  return {
    format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
    version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      ...dispatch(maximumDurationMs),
      taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    },
  };
}

function dispatch(maximumDurationMs = 30_000) {
  return {
    version: "flarex.task-compute-dispatch-request.v1" as const,
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1" as const,
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      runId: "run_00000000-0000-4000-8000-000000000002",
      requestedEffectSequence: 1n,
      attemptId: "attempt_00000000-0000-4000-8000-000000000003",
      executionFence: 1n,
    },
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested" as const, generation: 0n },
    maximumDurationMs,
  };
}

type Start = (
  start: TaskWorkerSessionHostStartInput,
  capability: unknown,
) => PromiseLike<unknown> | unknown;

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  sessionDisposals = 0;
  interruptionCalls = 0;
  starts = 0;

  constructor(
    private readonly runStart: Start,
    private readonly synchronousLoadMilliseconds = 0,
  ) {}
  get(): WorkerStub { throw new Error("get forbidden"); }
  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    const stopAt = performance.now() + this.synchronousLoadMilliseconds;
    while (performance.now() < stopAt) {
      // Deliberately consume synchronous cold-load wall time.
    }
    return new FakeWorkerStub(this, this.runStart);
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: FakeWorkerLoader,
    private readonly runStart: Start,
  ) {}
  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const entrypoint = {
      start: async (request: unknown, capability: unknown) => {
        this.owner.starts += 1;
        const start = request as TaskWorkerSessionHostStartInput;
        const value = await this.runStart(start, capability);
        if (value !== null && (typeof value === "object" || typeof value === "function") &&
          !(Symbol.dispose in value)) {
          Object.defineProperty(value, Symbol.dispose, {
            value: () => { this.owner.sessionDisposals += 1; },
          });
        }
        return value;
      },
    };
    return entrypoint as unknown as Fetcher<T>;
  }
  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects forbidden");
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

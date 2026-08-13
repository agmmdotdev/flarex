import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
  APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
  APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
  normalizeApplicationTaskWorkerValueV1,
} from "flarex-protocol/internal/application-task-worker-v1";

import {
  ApplicationTaskExecutionHostError,
  makeApplicationTaskExecutionHost,
} from "../src/artifactRuntime/ApplicationTaskExecutionHost";
import type { ApplicationTaskWorkerDefinition } from
  "../src/artifactRuntime/ApplicationTaskWorkerDefinition";

describe("Application task execution host", () => {
  it("loads a fresh outbound-denied Worker for every invocation", async () => {
    const capability = Object.freeze({ read: () => null });
    const loader = new FakeWorkerLoader(async (_request, received) => {
      expect(received).toBe(capability);
      return rpcResult({ ok: true });
    });
    const host = makeApplicationTaskExecutionHost(loader);

    for (let invocation = 0; invocation < 2; invocation += 1) {
      await expect(Effect.runPromise(host.run({
        definition: definition(),
        request: request(),
        capability,
      }))).resolves.toEqual({ ok: true });
    }

    expect(loader.loaded).toHaveLength(2);
    expect(loader.stubs[0]).not.toBe(loader.stubs[1]);
    expect(loader.entrypoints[0]).not.toBe(loader.entrypoints[1]);
    expect(loader.resultDisposals).toBe(2);
    for (const code of loader.loaded) {
      expect(code.globalOutbound).toBeNull();
      expect(code.limits).toEqual({ cpuMs: 10_000, subRequests: 0 });
    }
  });

  it("rejects target and profile mismatches before Worker Loader", async () => {
    const loader = new FakeWorkerLoader(async () => rpcResult(null));
    const host = makeApplicationTaskExecutionHost(loader);
    const base = request();
    for (const invalid of [
      {
        ...base,
        dispatch: {
          ...base.dispatch,
          applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(8),
        },
      },
      {
        ...base,
        dispatch: { ...base.dispatch, maximumDurationMs: 0 },
      },
      {
        ...base,
        dispatch: { ...base.dispatch, computeProfile: "standard-2x" },
      },
      {
        ...base,
        dispatch: { ...base.dispatch, maximumDurationMs: 30_001 },
      },
    ]) {
      const error = await Effect.runPromise(host.run({
        definition: definition(),
        request: invalid,
        capability: { read: () => null },
      }).pipe(Effect.flip));
      expect(error.reason).toBe("invalidRequest");
    }
    expect(loader.loaded).toHaveLength(0);
  });

  it.each([
    ["ApplicationTaskWorkerInvalidRequestV1Error", "invalidRequest"],
    ["ApplicationTaskWorkerDefinitionV1Error", "workerDefinitionFailed"],
    ["ApplicationTaskWorkerInputBoundaryV1Error", "inputBoundaryFailed"],
    ["ApplicationTaskWorkerUserCodeV1Error", "userCodeFailed"],
    ["ApplicationTaskWorkerTerminalV1Error", "terminalFailed"],
  ] as const)("maps %s to %s", async (name, reason) => {
    const remote = Object.assign(new Error(name), { name });
    const host = makeApplicationTaskExecutionHost(
      new FakeWorkerLoader(() => Promise.reject(remote)),
    );
    const error = await Effect.runPromise(host.run({
      definition: definition(),
      request: request(),
      capability: { read: () => null },
    }).pipe(Effect.flip));
    expect(error).toMatchObject({ reason, cause: remote });
  });

  it("keeps unknown Worker rejection in the defect channel", async () => {
    const defect = new Error("unknown");
    const host = makeApplicationTaskExecutionHost(
      new FakeWorkerLoader(() => Promise.reject(defect)),
    );
    const exit = await Effect.runPromiseExit(host.run({
      definition: definition(),
      request: request(),
      capability: { read: () => null },
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) return;
    const found = Cause.findDefect(exit.cause);
    expect(Result.isSuccess(found) && found.success).toBe(defect);
  });

  it("rejects a result correlated to a different dispatch identity", async () => {
    const result = rpcResult("wrong");
    (result as { identity: object }).identity = {
      ...request().dispatch.identity,
      requestedEffectSequence: 2n,
    };
    const host = makeApplicationTaskExecutionHost(
      new FakeWorkerLoader(async () => result),
    );
    const error = await Effect.runPromise(host.run({
      definition: definition(),
      request: request(),
      capability: { read: () => null },
    }).pipe(Effect.flip));
    expect(error.reason).toBe("invalidResult");
  });

  it("interrupts a pending RPC and disposes its late result", async () => {
    const pending = deferred<unknown>();
    const loader = new FakeWorkerLoader(() => pending.promise);
    const host = makeApplicationTaskExecutionHost(loader);
    const fiber = Effect.runFork(host.run({
      definition: definition(),
      request: request(),
      capability: { read: () => null },
    }));

    await Promise.resolve();
    await Effect.runPromise(Fiber.interrupt(fiber));
    pending.resolve(rpcResult("late"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loader.resultDisposals).toBe(1);
  });
});

function definition(): ApplicationTaskWorkerDefinition {
  return Object.freeze({
    runtimeTargetSha256Hex: "07".repeat(32),
    computeProfile: "standard-1x",
    compatibilityDate: "2026-06-14",
    wallMilliseconds: 30_000,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    mainModule: "application.js",
    modules: Object.freeze({ "application.js": "export default {};" }),
    env: Object.freeze({}),
    entrypoint: "FlarexApplicationTaskWorker",
  });
}

function request() {
  return {
    format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      version: "flarex.task-compute-dispatch-request.v1",
      identity: {
        version: "flarex.task-compute-dispatch-identity.v1",
        scopeId: "scope_00000000-0000-4000-8000-000000000001",
        runId: "run_00000000-0000-4000-8000-000000000002",
        requestedEffectSequence: 1n,
        attemptId: "attempt_00000000-0000-4000-8000-000000000003",
        executionFence: 1n,
      },
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
      attemptNumber: 1,
      leaseVersion: 1n,
      computeProfile: "standard-1x",
      cancellation: { kind: "not_requested", generation: 0n },
      maximumDurationMs: 30_000,
    },
  };
}

function rpcResult(value: unknown): unknown {
  const normalized = Result.getOrThrow(
    normalizeApplicationTaskWorkerValueV1(value, "result"),
  );
  return {
    format: APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
    kind: "completed",
    identity: request().dispatch.identity,
    value: normalized.value,
    valueSemanticBytes: normalized.semanticSizeBytes,
  };
}

type Run = (request: unknown, capability: unknown) => PromiseLike<unknown>;

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly stubs: WorkerStub[] = [];
  readonly entrypoints: object[] = [];
  resultDisposals = 0;

  constructor(private readonly runWorker: Run) {}

  get(): WorkerStub { throw new Error("get forbidden"); }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    const stub = new FakeWorkerStub(this, this.runWorker);
    this.stubs.push(stub);
    return stub;
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: FakeWorkerLoader,
    private readonly runWorker: Run,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const owner = this.owner;
    const entrypoint = {
      run: async (requestValue: unknown, capability: unknown) => {
        const result = await this.runWorker(requestValue, capability);
        if (result !== null && typeof result === "object") {
          Object.defineProperty(result, Symbol.dispose, {
            configurable: true,
            value: () => { owner.resultDisposals += 1; },
          });
        }
        return result;
      },
    };
    owner.entrypoints.push(entrypoint);
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

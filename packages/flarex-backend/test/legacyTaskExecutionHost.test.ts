import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
  LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
  LEGACY_TASK_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import { normalizeApplicationTaskWorkerValueV1 } from
  "flarex-protocol/internal/application-task-worker-v1";

import { makeLegacyTaskExecutionHost } from
  "../src/artifactRuntime/LegacyTaskExecutionHost";
import type { LegacyTaskWorkerDefinition } from
  "../src/artifactRuntime/LegacyTaskWorkerDefinition";

describe("Legacy task execution host", () => {
  it("loads a fresh outbound-denied Worker and disposes its result", async () => {
    const loader = new FakeWorkerLoader(async () => rpcResult({ ok: true }));
    const host = makeLegacyTaskExecutionHost(loader);
    for (let index = 0; index < 2; index += 1) {
      await expect(Effect.runPromise(host.run({
        definition: definition(), request: request(), capability: { read: () => null },
      }))).resolves.toEqual({ ok: true });
    }
    expect(loader.loaded).toHaveLength(2);
    expect(loader.stubs[0]).not.toBe(loader.stubs[1]);
    expect(loader.resultDisposals).toBe(2);
    expect(loader.loaded.every(code => code.globalOutbound === null)).toBe(true);
  });

  it("rejects identity, profile, and duration mismatches before load", async () => {
    const loader = new FakeWorkerLoader(async () => rpcResult(null));
    const host = makeLegacyTaskExecutionHost(loader);
    const base = request();
    for (const dispatch of [
      {
        ...base.dispatch,
        taskDefinitionRevisionId:
          "taskdef_00000000-0000-4000-8000-000000000005",
      },
      { ...base.dispatch, computeProfile: "standard-2x" },
      { ...base.dispatch, maximumDurationMs: 30_001 },
    ]) {
      const failure = await Effect.runPromise(host.run({
        definition: definition(), request: { ...base, dispatch },
        capability: { read: () => null },
      }).pipe(Effect.flip));
      expect(failure.reason).toBe("invalidRequest");
    }
    expect(loader.loaded).toHaveLength(0);
  });

  it("maps named Worker failures and defects unknown rejections", async () => {
    for (const [name, reason] of [
      ["LegacyTaskWorkerInvalidRequestV1Error", "invalidRequest"],
      ["LegacyTaskWorkerDefinitionV1Error", "workerDefinitionFailed"],
      ["LegacyTaskWorkerInputBoundaryV1Error", "inputBoundaryFailed"],
      ["LegacyTaskWorkerUserCodeV1Error", "userCodeFailed"],
      ["LegacyTaskWorkerTerminalV1Error", "terminalFailed"],
    ] as const) {
      const remote = Object.assign(new Error(name), { name });
      const host = makeLegacyTaskExecutionHost(
        new FakeWorkerLoader(() => Promise.reject(remote)),
      );
      const failure = await Effect.runPromise(host.run({
        definition: definition(), request: request(), capability: { read: () => null },
      }).pipe(Effect.flip));
      expect(failure).toMatchObject({ reason, cause: remote });
    }
    const defect = new Error("unknown");
    const host = makeLegacyTaskExecutionHost(
      new FakeWorkerLoader(() => Promise.reject(defect)),
    );
    const exit = await Effect.runPromiseExit(host.run({
      definition: definition(), request: request(), capability: { read: () => null },
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const found = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(found) && found.success).toBe(defect);
    }
  });

  it("rejects a result correlated to another dispatch identity", async () => {
    const result = rpcResult("wrong") as {
      identity: ReturnType<typeof request>["dispatch"]["identity"];
    };
    result.identity = {
      ...result.identity,
      requestedEffectSequence: 2n,
    };
    const host = makeLegacyTaskExecutionHost(
      new FakeWorkerLoader(async () => result),
    );
    const failure = await Effect.runPromise(host.run({
      definition: definition(), request: request(), capability: { read: () => null },
    }).pipe(Effect.flip));
    expect(failure.reason).toBe("invalidResult");
  });
});

function definition(): LegacyTaskWorkerDefinition {
  return Object.freeze({
    taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    computeProfile: "standard-1x",
    compatibilityDate: "2026-06-14",
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    wallMilliseconds: 30_000,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    mainModule: "legacy.js",
    modules: Object.freeze({ "legacy.js": "export default {};" }),
    env: Object.freeze({}),
    entrypoint: "FlarexLegacyTaskWorker",
  });
}

function request() {
  return {
    format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
    version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
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
      taskDefinitionRevisionId: definition().taskDefinitionRevisionId,
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
    format: LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
    version: LEGACY_TASK_WORKER_RESULT_VERSION_V1,
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
  constructor(private readonly owner: FakeWorkerLoader, private readonly runWorker: Run) {}
  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const owner = this.owner;
    return { run: async (requestValue: unknown, capability: unknown) => {
      const result = await this.runWorker(requestValue, capability);
      if (result !== null && typeof result === "object") {
        Object.defineProperty(result, Symbol.dispose, {
          configurable: true, value: () => { owner.resultDisposals += 1; },
        });
      }
      return result;
    } } as unknown as Fetcher<T>;
  }
  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>(): DurableObjectClass<T> {
    throw new Error("Durable Objects forbidden");
  }
}

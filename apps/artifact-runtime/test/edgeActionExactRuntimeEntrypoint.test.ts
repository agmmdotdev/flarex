import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import type { EdgeActionExactRuntimeWorkerDefinitionV1 } from
  "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1";
import {
  EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
  EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
  type EdgeActionExactRuntimeRequestV1,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

import {
  runEdgeActionExactRuntimeArtifactHostV1,
  runEdgeActionExactRuntimeArtifactHostEffectV1,
} from "../src/edgeActionExactRuntimeEntrypoint";

describe("artifact runtime exact edge-action RPC host", () => {
  it("claims one trusted dispatch, loads once, and closes then drains capabilities", async () => {
    const callback = callbackStub();
    const outbound = outboundStub();
    const entrypointDispose = vi.fn();
    const requestValue = request();
    const definitionValue = definition(requestValue);
    const authority = vi.fn(() => Promise.resolve({
      request: requestValue,
      definition: definitionValue,
      callback,
      outbound,
    }));
    const loader = new FakeEdgeActionWorkerLoader(async (input, received) => {
      expect(input).toEqual(requestValue);
      const invoke = received === null || typeof received !== "object"
        ? undefined
        : Reflect.get(received, "invoke");
      expect(typeof invoke).toBe("function");
      if (typeof invoke === "function") {
        await Reflect.apply(invoke, received, [{ kind: "probe" }]);
      }
      return result();
    }, entrypointDispose);

    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: { claim: authority },
    }, { invocation: "opaque-admitted-input" })).resolves.toEqual({
      kind: "success",
      result: result(),
    });

    expect(authority).toHaveBeenCalledWith({ invocation: "opaque-admitted-input" });
    expect(loader.loaded).toHaveLength(1);
    expect(loader.loaded[0]?.globalOutbound).toBe(outbound);
    expect(loader.loaded[0]?.limits).toEqual({ cpuMs: 1_000, subRequests: 64 });
    expect(loader.requestedEntrypoints).toEqual([
      EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
    ]);
    expect(entrypointDispose).toHaveBeenCalledOnce();
    expect(callback.invoke).toHaveBeenCalledWith({ kind: "probe" });
    expect(callback.close).toHaveBeenCalledOnce();
    expect(outbound.close).toHaveBeenCalledOnce();
    expect(callback.drain).toHaveBeenCalledOnce();
    expect(outbound.drain).toHaveBeenCalledOnce();
    expect(callback[Symbol.dispose]).toHaveBeenCalledOnce();
    expect(outbound[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("does not accept caller-authored definitions or capabilities", async () => {
    const loader = new FakeEdgeActionWorkerLoader(() =>
      Promise.reject(new Error("must not run"))
    );
    const authority = vi.fn(() => Promise.reject(new Error("not admitted")));
    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: { claim: authority },
    }, {
      definition: definition(request()),
      callback: callbackStub(),
      outbound: outboundStub(),
    })).resolves.toEqual({ kind: "failure", reason: "authorityFailed" });
    expect(loader.loaded).toHaveLength(0);
  });

  it("rejects a trusted claim whose candidate binding is inconsistent before load", async () => {
    const callback = callbackStub();
    const outbound = outboundStub();
    const requestValue = request();
    const definitionValue = {
      ...definition(requestValue),
      hostPolicySha256Hex: "4".repeat(64),
    };
    const loader = new FakeEdgeActionWorkerLoader(() =>
      Promise.reject(new Error("must not run"))
    );
    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => Promise.resolve({
          request: requestValue,
          definition: definitionValue,
          callback,
          outbound,
        }),
      },
    }, { invocation: "admitted" })).resolves.toEqual({
      kind: "failure",
      reason: "authorityFailed",
    });
    expect(loader.loaded).toHaveLength(0);
    expect(callback.close).toHaveBeenCalledOnce();
    expect(outbound.close).toHaveBeenCalledOnce();
    expect(callback.drain).toHaveBeenCalledOnce();
    expect(outbound.drain).toHaveBeenCalledOnce();
  });

  it("times out a non-settling worker and performs bounded lifecycle cleanup", async () => {
    const lifecycle: string[] = [];
    const callback = callbackStub(lifecycle);
    const outbound = outboundStub(lifecycle);
    const entrypointDispose = vi.fn(() => lifecycle.push("worker.dispose"));
    const requestValue = request();
    const definitionValue = {
      ...definition(requestValue),
      wallMilliseconds: 1,
    };
    const loader = new FakeEdgeActionWorkerLoader(
      () => new Promise<never>(() => {}),
      entrypointDispose,
    );
    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => Promise.resolve({
          request: requestValue,
          definition: definitionValue,
          callback,
          outbound,
        }),
      },
    }, { invocation: "admitted" })).resolves.toEqual({
      kind: "failure",
      reason: "timedOut",
    });
    expect(entrypointDispose).toHaveBeenCalledOnce();
    expect(callback.close).toHaveBeenCalledOnce();
    expect(outbound.close).toHaveBeenCalledOnce();
    expect(callback.drain).toHaveBeenCalledOnce();
    expect(outbound.drain).toHaveBeenCalledOnce();
    expect(lifecycle).toEqual([
      "callback.close",
      "outbound.close",
      "worker.dispose",
      "callback.drain",
      "outbound.drain",
    ]);
  });

  it("returns cleanup uncertainty when a closed capability cannot drain", async () => {
    const callback = callbackStub();
    callback.drain.mockRejectedValueOnce(new Error("lost callback outcome"));
    const outbound = outboundStub();
    const requestValue = request();
    const definitionValue = definition(requestValue);
    const loader = new FakeEdgeActionWorkerLoader(() => Promise.resolve(result()));
    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => Promise.resolve({
          request: requestValue,
          definition: definitionValue,
          callback,
          outbound,
        }),
      },
    }, { invocation: "admitted" })).resolves.toEqual({
      kind: "failure",
      reason: "cleanupUncertain",
    });
    expect(callback[Symbol.dispose]).toHaveBeenCalledOnce();
    expect(outbound[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("continues draining and reports cleanup uncertainty when Worker release fails", async () => {
    const callback = callbackStub();
    const outbound = outboundStub();
    const requestValue = request();
    const loader = new FakeEdgeActionWorkerLoader(
      () => Promise.resolve(result()),
      () => { throw new Error("worker release failed"); },
    );
    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => Promise.resolve({
          request: requestValue,
          definition: definition(requestValue),
          callback,
          outbound,
        }),
      },
    }, { invocation: "admitted" })).resolves.toEqual({
      kind: "failure",
      reason: "cleanupUncertain",
    });
    expect(callback.drain).toHaveBeenCalledOnce();
    expect(outbound.drain).toHaveBeenCalledOnce();
    expect(callback[Symbol.dispose]).toHaveBeenCalledOnce();
    expect(outbound[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("bounds a non-settling close and still releases owned capabilities", async () => {
    const callback = callbackStub();
    callback.close.mockImplementationOnce(() => new Promise<never>(() => {}));
    const outbound = outboundStub();
    const requestValue = request();
    const entrypointDispose = vi.fn();
    const definitionValue = {
      ...definition(requestValue),
      cleanupDrainMilliseconds: 1,
    };
    const loader = new FakeEdgeActionWorkerLoader(
      () => Promise.resolve(result()),
      entrypointDispose,
    );
    await expect(runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => Promise.resolve({
          request: requestValue,
          definition: definitionValue,
          callback,
          outbound,
        }),
      },
    }, { invocation: "admitted" })).resolves.toEqual({
      kind: "failure",
      reason: "cleanupUncertain",
    });
    expect(entrypointDispose).toHaveBeenCalledOnce();
    expect(callback[Symbol.dispose]).toHaveBeenCalledOnce();
    expect(outbound[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("closes and drains capabilities before returning typed caller cancellation", async () => {
    const lifecycle: string[] = [];
    const callback = callbackStub(lifecycle);
    const outbound = outboundStub(lifecycle);
    const requestValue = request();
    const definitionValue = {
      ...definition(requestValue),
      wallMilliseconds: 1_000,
      cleanupDrainMilliseconds: 100,
    };
    const loader = new FakeEdgeActionWorkerLoader(
      () => new Promise<never>(() => {}),
      () => { lifecycle.push("worker.dispose"); },
    );
    const controller = new AbortController();
    const effect = runEdgeActionExactRuntimeArtifactHostEffectV1({
      LOADER: loader,
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => Promise.resolve({
          request: requestValue,
          definition: definitionValue,
          callback,
          outbound,
        }),
      },
    }, { invocation: "admitted" }, { signal: controller.signal });
    const outcome = Effect.runPromise(effect);
    await vi.waitFor(() => expect(loader.loaded).toHaveLength(1));
    controller.abort();
    await expect(outcome).resolves.toEqual({
      kind: "failure",
      reason: "cancelled",
    });
    expect(callback.close).toHaveBeenCalledOnce();
    expect(outbound.close).toHaveBeenCalledOnce();
    expect(callback.drain).toHaveBeenCalledOnce();
    expect(outbound.drain).toHaveBeenCalledOnce();
    expect(lifecycle).toEqual([
      "callback.close",
      "outbound.close",
      "worker.dispose",
      "callback.drain",
      "outbound.drain",
    ]);
  });

  it("releases capabilities from an authority claim that resolves after cancellation", async () => {
    const callback = callbackStub();
    const outbound = outboundStub();
    const requestValue = request();
    let resolveClaim: ((value: unknown) => void) | undefined;
    const pendingClaim = new Promise<unknown>(resolve => {
      resolveClaim = resolve;
    });
    const controller = new AbortController();
    const outcome = runEdgeActionExactRuntimeArtifactHostV1({
      LOADER: new FakeEdgeActionWorkerLoader(() => Promise.resolve(result())),
      FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY: {
        claim: () => pendingClaim,
      },
    }, { invocation: "admitted" }, { signal: controller.signal });
    controller.abort();
    await expect(outcome).resolves.toEqual({
      kind: "failure",
      reason: "cancelled",
    });
    resolveClaim?.({
      request: requestValue,
      definition: definition(requestValue),
      callback,
      outbound,
    });
    await vi.waitFor(() => {
      expect(callback.close).toHaveBeenCalledOnce();
      expect(outbound.close).toHaveBeenCalledOnce();
      expect(callback.drain).toHaveBeenCalledOnce();
      expect(outbound.drain).toHaveBeenCalledOnce();
      expect(callback[Symbol.dispose]).toHaveBeenCalledOnce();
      expect(outbound[Symbol.dispose]).toHaveBeenCalledOnce();
    });
  });
});

function request(): EdgeActionExactRuntimeRequestV1 {
  const args = { orderId: "order-1" };
  return {
    format: EDGE_ACTION_EXACT_RUNTIME_FORMAT_V1,
    version: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    artifact: artifact(),
    function: actionFunction(),
    auth: { kind: "anonymous" },
    arguments: args,
    argumentSemanticBytes: normalizeFlarexValueV1(args).semanticSizeBytes,
    context: {
      executionId: "execution-1",
      invocationId: "invocation-1",
      executionGeneration: 1n,
      executionTime: 1_800_000_000_000,
      executionDeadline: 1_800_000_030_000,
      randomSeed: new Uint8Array(32).fill(1),
      runtimeTargetSha256: new Uint8Array(32).fill(2),
      hostPolicySha256: new Uint8Array(32).fill(3),
    },
  };
}

function artifact() {
  return {
    runtime: "dynamic-worker" as const,
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
  };
}

function actionFunction() {
  return {
    path: "orders:place",
    executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
    kind: "action" as const,
    visibility: "public" as const,
    argsValidator: { type: "any" as const },
    returnsValidator: null,
  };
}

function definition(
  requestValue: EdgeActionExactRuntimeRequestV1,
): EdgeActionExactRuntimeWorkerDefinitionV1 {
  return Object.freeze({
    compatibilityDate: "2026-06-14",
    mainModule: "main.js",
    modules: Object.freeze({ "main.js": "export default {};" }),
    env: Object.freeze({}),
    limits: Object.freeze({ cpuMs: 1_000, subRequests: 64 }),
    runtimeTargetSha256Hex: "02".repeat(32),
    hostPolicySha256Hex: "03".repeat(32),
    artifact: requestValue.artifact,
    function: requestValue.function,
    wallMilliseconds: 30_000,
    cleanupDrainMilliseconds: 5_000,
    entrypoint: EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
  });
}

function result() {
  return {
    format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
    version: 1 as const,
    value: { ok: true },
  };
}

function callbackStub(lifecycle?: string[]) {
  return Object.assign({
    invoke: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(() => { lifecycle?.push("callback.close"); }),
    drain: vi.fn(() => {
      lifecycle?.push("callback.drain");
      return Promise.resolve();
    }),
  }, { [Symbol.dispose]: vi.fn() });
}

function outboundStub(lifecycle?: string[]) {
  return Object.assign({
    fetch: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(() => { lifecycle?.push("outbound.close"); }),
    drain: vi.fn(() => {
      lifecycle?.push("outbound.drain");
      return Promise.resolve();
    }),
  }, { [Symbol.dispose]: vi.fn() });
}

type Run = (input: unknown, callback: unknown) => Promise<unknown>;

class FakeEdgeActionWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly requestedEntrypoints: string[] = [];
  constructor(
    private readonly run: Run,
    private readonly dispose: () => void = () => undefined,
  ) {}

  get(): WorkerStub {
    throw new Error("Exact edge-action runtime forbids WorkerLoader.get().");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    return new FakeEdgeActionWorkerStub(
      this.requestedEntrypoints,
      this.run,
      this.dispose,
    );
  }
}

class FakeEdgeActionWorkerStub implements WorkerStub {
  constructor(
    private readonly requestedEntrypoints: string[],
    private readonly run: Run,
    private readonly dispose: () => void,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    this.requestedEntrypoints.push(name ?? "");
    return {
      run: this.run,
      [Symbol.dispose]: this.dispose,
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Exact edge-action runtime does not use Durable Objects.");
  }
}

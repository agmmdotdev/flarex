import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type ApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it, vi } from "vitest";
import { TestClock } from "effect/testing";

import {
  ApplicationExecutionHostError,
  makeApplicationExecutionHost,
} from "../src/artifactRuntime/ApplicationExecutionHost";
import type {
  ApplicationWorkerDefinition,
} from "../src/artifactRuntime/ApplicationWorkerDefinition";

describe("Application execution host", () => {
  it.each(["query", "mutation"] as const)(
    "runs a fresh %s transaction with outbound denied",
    async kind => {
      const target = runtimeTarget(kind);
      const capability = Object.freeze({});
      const loader = new FakeWorkerLoader(async (request, received) => {
        expect(received).toBe(capability);
        expect(request).toMatchObject({ target, context: { mode:
          kind === "query" ? "query" : "write" } });
        return rpcResult({ kind });
      });
      const host = makeApplicationExecutionHost(loader);

      for (let invocation = 0; invocation < 2; invocation += 1) {
        await expect(Effect.runPromise(host.runTransaction({
          definition: definition(target),
          request: transactionRequest(target),
          capability,
        }))).resolves.toEqual({ kind });
      }

      expect(loader.loaded).toHaveLength(2);
      for (const code of loader.loaded) {
        expect(code.globalOutbound).toBeNull();
        expect(code.limits).toEqual({ cpuMs: 10_000, subRequests: 0 });
      }
      expect(loader.stubs).toHaveLength(2);
      expect(loader.stubs[0]).not.toBe(loader.stubs[1]);
      expect(loader.entrypoints).toHaveLength(2);
      expect(loader.entrypoints[0]).not.toBe(loader.entrypoints[1]);
      expect(loader.requestedEntrypoints).toEqual([
        "FlarexApplicationTransactionWorker",
        "FlarexApplicationTransactionWorker",
      ]);
      expect(loader.resultDisposals).toBe(2);
    },
  );

  it("runs an action with the exact outbound gateway and policy limits", async () => {
    const target = runtimeTarget("action");
    const callback = Object.freeze({});
    const outbound = { fetch: vi.fn() } as unknown as Fetcher;
    const loader = new FakeWorkerLoader(async (_request, received) => {
      expect(received).toBe(callback);
      return rpcResult("action-result");
    });
    const host = makeApplicationExecutionHost(loader);

    await expect(Effect.runPromise(host.runAction({
      definition: definition(target),
      request: actionRequest(target),
      callback,
      outbound,
    }))).resolves.toBe("action-result");

    expect(loader.loaded[0]?.globalOutbound).toBe(outbound);
    expect(loader.loaded[0]?.limits).toEqual({ cpuMs: 1_000, subRequests: 64 });
    expect(loader.requestedEntrypoints).toEqual([
      "FlarexApplicationActionWorker",
    ]);
    expect(loader.resultDisposals).toBe(1);
  });

  it("rejects malformed and mismatched requests before Worker Loader", async () => {
    const target = runtimeTarget("query");
    const loader = new FakeWorkerLoader(async () => rpcResult(null));
    const host = makeApplicationExecutionHost(loader);
    const mismatch = runtimeTarget("query", "other:get");

    for (const request of [
      { invalid: true },
      transactionRequest(mismatch),
    ]) {
      const error = await Effect.runPromise(
        host.runTransaction({
          definition: definition(target),
          request,
          capability: {},
        }).pipe(Effect.flip),
      );
      expect(error).toBeInstanceOf(ApplicationExecutionHostError);
      expect(error.reason).toBe("invalidRequest");
    }
    expect(loader.loaded).toHaveLength(0);
  });

  it("rejects an action host-policy mismatch before Worker Loader", async () => {
    const target = runtimeTarget("action");
    const loader = new FakeWorkerLoader(async () => rpcResult(null));
    const host = makeApplicationExecutionHost(loader);
    const request = actionRequest(target);
    const error = await Effect.runPromise(host.runAction({
      definition: definition(target),
      request: {
        ...request,
        context: {
          ...request.context,
          hostPolicySha256: new Uint8Array(32).fill(8),
        },
      },
      callback: {},
      outbound: { fetch: vi.fn() } as unknown as Fetcher,
    }).pipe(Effect.flip));

    expect(error.reason).toBe("invalidRequest");
    expect(loader.loaded).toHaveLength(0);
  });

  it("uses the Effect clock to reject an expired action before Worker Loader", async () => {
    const target = runtimeTarget("action");
    const loader = new FakeWorkerLoader(async () => rpcResult(null));
    const host = makeApplicationExecutionHost(loader);
    const request = actionRequest(target);
    const error = await Effect.runPromise(Effect.gen(function* () {
      yield* TestClock.setTime(2_000);
      return yield* host.runAction({
        definition: definition(target),
        request: {
          ...request,
          context: {
            ...request.context,
            executionTime: 1_000,
            executionDeadline: 1_999,
          },
        },
        callback: {},
        outbound: { fetch: vi.fn() } as unknown as Fetcher,
      }).pipe(Effect.flip);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(error.reason).toBe("timedOut");
    expect(loader.loaded).toHaveLength(0);
  });

  it.each([
    ["ApplicationWorkerInvalidRequestV1Error", "invalidRequest"],
    ["ApplicationWorkerDefinitionV1Error", "workerDefinitionFailed"],
    ["ApplicationWorkerReadBoundaryV1Error", "readBoundaryFailed"],
    ["ApplicationWorkerJournalBoundaryV1Error", "journalBoundaryFailed"],
    ["ApplicationWorkerCallbackBoundaryV1Error", "callbackFailed"],
    ["ApplicationWorkerUserCodeV1Error", "userCodeFailed"],
    ["ApplicationWorkerTerminalV1Error", "terminalFailed"],
  ] as const)("maps %s to %s", async (name, reason) => {
    const target = runtimeTarget("query");
    const remote = Object.assign(new Error("remote"), { name });
    const loader = new FakeWorkerLoader(() => Promise.reject(remote));
    const host = makeApplicationExecutionHost(loader);
    const error = await Effect.runPromise(host.runTransaction({
      definition: definition(target),
      request: transactionRequest(target),
      capability: {},
    }).pipe(Effect.flip));

    expect(error.reason).toBe(reason);
    expect(error.cause).toBe(remote);
  });

  it("keeps an unknown Worker rejection in the defect channel", async () => {
    const target = runtimeTarget("query");
    const defect = new Error("unknown remote defect");
    const loader = new FakeWorkerLoader(() => Promise.reject(defect));
    const host = makeApplicationExecutionHost(loader);
    const exit = await Effect.runPromiseExit(host.runTransaction({
      definition: definition(target),
      request: transactionRequest(target),
      capability: {},
    }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("Expected defect.");
    const observed = Cause.findDefect(exit.cause);
    expect(Result.isSuccess(observed)).toBe(true);
    if (Result.isSuccess(observed)) expect(observed.success).toBe(defect);
  });

  it("rejects and disposes an invalid RPC result", async () => {
    const target = runtimeTarget("query");
    const loader = new FakeWorkerLoader(async () => rpcValue({ invalid: true }));
    const host = makeApplicationExecutionHost(loader);
    const error = await Effect.runPromise(host.runTransaction({
      definition: definition(target),
      request: transactionRequest(target),
      capability: {},
    }).pipe(Effect.flip));

    expect(error.reason).toBe("invalidResult");
    expect(loader.resultDisposals).toBe(1);
  });

  it("classifies Worker Loader failure without invoking a capability", async () => {
    const target = runtimeTarget("query");
    const loader = {
      get(): WorkerStub {
        throw new Error("cached loading is forbidden");
      },
      load(): WorkerStub {
        throw new Error("loader unavailable");
      },
    } satisfies WorkerLoader;
    const host = makeApplicationExecutionHost(loader);
    const error = await Effect.runPromise(host.runTransaction({
      definition: definition(target),
      request: transactionRequest(target),
      capability: {},
    }).pipe(Effect.flip));

    expect(error.reason).toBe("workerLoadFailed");
  });

  it("times out and disposes a late result", async () => {
    const target = runtimeTarget("query");
    const late = deferred<unknown>();
    const loader = new FakeWorkerLoader(() => late.promise);
    const host = makeApplicationExecutionHost(loader);
    const base = definition(target);
    const error = await Effect.runPromise(host.runTransaction({
      definition: Object.freeze({
        ...base,
        transactionWallMilliseconds: 5,
      }),
      request: transactionRequest(target),
      capability: {},
    }).pipe(Effect.flip));

    expect(error.reason).toBe("timedOut");
    late.resolve(rpcResult("late"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loader.resultDisposals).toBe(1);
  });

  it("interrupts the wait while still observing and disposing a late result", async () => {
    const target = runtimeTarget("query");
    const started = deferred<void>();
    const late = deferred<unknown>();
    const loader = new FakeWorkerLoader(() => {
      started.resolve();
      return late.promise;
    });
    const host = makeApplicationExecutionHost(loader);
    const fiber = Effect.runFork(host.runTransaction({
      definition: definition(target),
      request: transactionRequest(target),
      capability: {},
    }));
    await started.promise;

    await Effect.runPromise(Fiber.interrupt(fiber));
    late.resolve(rpcResult("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.resultDisposals).toBe(1);
  });
});

type FunctionKind = "query" | "mutation" | "action";

function runtimeTarget(
  kind: FunctionKind,
  path = kind === "query" ? "users:get" :
    kind === "mutation" ? "users:create" : "users:notify",
): ApplicationRuntimeTargetV1 {
  const [moduleName, exportName] = path.split(":") as [string, string];
  return Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: "scope",
    revisionId: "revision",
    candidateId: "candidate",
    analysisId: "analysis",
    sourceArtifactRootSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    schemaSha256: "c".repeat(64),
    functionCatalogSha256: "d".repeat(64),
    publicationSha256: "e".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path,
      moduleName,
      exportName,
      kind,
      visibility: "public",
      args: { type: "any" },
      returns: { type: "any" },
      partition: null,
      entrySha256: "f".repeat(64),
    },
  })).target;
}

function definition(
  target: ApplicationRuntimeTargetV1,
): ApplicationWorkerDefinition {
  return Object.freeze({
    targetCanonicalText: Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1(target),
    ).canonicalText,
    hostPolicySha256Hex: "07".repeat(32),
    transactionWallMilliseconds: 30_000,
    actionWallMilliseconds: 30_000,
    compatibilityDate: "2026-06-14",
    transactionLimits: Object.freeze({ cpuMs: 10_000, subRequests: 0 }),
    actionLimits: Object.freeze({ cpuMs: 1_000, subRequests: 64 }),
    mainModule: "application.js",
    modules: Object.freeze({ "application.js": "export default {};" }),
    env: Object.freeze({}),
    transactionEntrypoint: "FlarexApplicationTransactionWorker",
    actionEntrypoint: "FlarexApplicationActionWorker",
  });
}

function transactionRequest(target: ApplicationRuntimeTargetV1) {
  const argumentsValue = { value: 1 };
  const mode = target.function.kind === "query" ? "query" as const :
    "write" as const;
  return {
    format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth: { kind: "anonymous" as const },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    tables: [],
    context: mode === "query" ? {
      mode,
      executionId: "execution",
      randomSeed: new Uint8Array(32).fill(1),
      executionTime: 1_800_000_000_000,
      snapshotCommitSeq: 1n,
    } : {
      mode,
      executionId: "execution",
      logScopeId: "log-scope",
      randomSeed: new Uint8Array(32).fill(1),
      executionTime: 1_800_000_000_000,
      initialCreationTimeCursor: 1_800_000_000_000,
    },
  };
}

function actionRequest(target: ApplicationRuntimeTargetV1) {
  const argumentsValue = { value: 1 };
  return {
    format: APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth: { kind: "anonymous" as const },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    context: {
      executionId: "execution",
      invocationId: "invocation",
      executionGeneration: 1n,
      executionTime: Date.now(),
      executionDeadline: Date.now() + 60_000,
      randomSeed: new Uint8Array(32).fill(1),
      hostPolicySha256: new Uint8Array(32).fill(7),
    },
  };
}

function rpcResult(value: unknown): unknown {
  return rpcValue({
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    value,
  });
}

function rpcValue(value: Readonly<Record<string, unknown>>): unknown {
  return value;
}

type Run = (request: unknown, capability: unknown) => PromiseLike<unknown>;

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly stubs: WorkerStub[] = [];
  readonly entrypoints: object[] = [];
  readonly requestedEntrypoints: string[] = [];
  resultDisposals = 0;

  constructor(private readonly run: Run) {}

  get(): WorkerStub {
    throw new Error("Application execution host forbids WorkerLoader.get().");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    const stub = new FakeWorkerStub(this, this.run);
    this.stubs.push(stub);
    return stub;
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: FakeWorkerLoader,
    private readonly run: Run,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    this.owner.requestedEntrypoints.push(name ?? "");
    const owner = this.owner;
    const entrypoint = {
      run: async (request: unknown, capability: unknown) => {
        const result = await this.run(request, capability);
        if (result !== null && typeof result === "object") {
          Object.defineProperty(result, Symbol.dispose, {
            configurable: true,
            value: () => { owner.resultDisposals += 1; },
          });
        }
        return result;
      },
    };
    this.owner.entrypoints.push(entrypoint);
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application execution host does not load Durable Objects.");
  }
}

function deferred<A>(): Readonly<{
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
}> {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>(accept => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

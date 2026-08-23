import type {
  TaskComputeDeliveryConnectedRunnerOptions,
} from "flarex-backend/internal/task-compute-delivery";
import type { TaskInputStoreBucket } from
  "flarex-backend/internal/task-input-store";
import type { TaskResultStoreBucket } from
  "flarex-backend/internal/task-result-store";
import type { TaskRuntimeObjectStoreBucket } from
  "flarex-backend/internal/task-runtime-object-store";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "flarex-backend/artifact-runtime";
import {
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  type TaskWorkerSessionAcceptanceV1,
  type TaskWorkerSessionInterruptionAcceptanceV1,
  type TaskWorkerSessionInterruptionRequestV1,
  type TaskWorkerSessionStartRequestV1,
  type TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";
import { Data, Effect, type Scope } from "effect";
import { Miniflare } from "miniflare";

export const APPLICATION_TASK_HOSTED_RUNTIME_HOST_IDENTITY =
  APPLICATION_RUNTIME_HOST_IDENTITY;
export const APPLICATION_TASK_HOSTED_COMPATIBILITY_DATE = "2026-06-14";

function makeApplicationTaskHostedApplicationPolicy() {
  return Object.freeze({
    runtimeHostIdentity: APPLICATION_TASK_HOSTED_RUNTIME_HOST_IDENTITY,
    compatibilityDate: APPLICATION_TASK_HOSTED_COMPATIBILITY_DATE,
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
  });
}

function makeApplicationTaskHostedLegacyPolicy() {
  return Object.freeze({
    runtimeImplementationVersion: "worker-loader-2026.08.14",
    admittedCompatibilityDate: APPLICATION_TASK_HOSTED_COMPATIBILITY_DATE,
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
    admittedCompatibilityFlags: Object.freeze(["nodejs_compat"]),
  });
}

function makeApplicationTaskHostedOneCandidatePolicy():
  TaskComputeDeliveryConnectedRunnerOptions {
  return Object.freeze({
    maximumDirectoryPages: 2,
    maximumScopeVisits: 2,
    maximumDispatchPages: 2,
    maximumCancellationPages: 2,
    maximumDispatchCandidates: 1,
    maximumCancellationCandidates: 1,
    maximumDispatchProviderCalls: 1,
    maximumCancellationProviderCalls: 1,
    maximumTotalOperations: 1,
    maximumDispatchPagesPerScope: 1,
    maximumCancellationPagesPerScope: 1,
    candidatesPerPage: 1,
    maximumRunMilliseconds: 30_000,
    maximumOperationMilliseconds: 15_000,
    settlementReserveMilliseconds: 2_000,
  });
}

export interface ApplicationTaskHostedResourceBucket
  extends TaskInputStoreBucket, TaskRuntimeObjectStoreBucket,
    TaskResultStoreBucket {
  readonly values: ReadonlyMap<string, Uint8Array>;
  readonly putKeys: readonly string[];
  readonly getKeys: readonly string[];
  readonly putCalls: number;
  readonly getCalls: number;
}

export interface ApplicationTaskHostedResources {
  readonly inputs: ApplicationTaskHostedResourceBucket;
  readonly principals: ApplicationTaskHostedResourceBucket;
  readonly runtimeObjects: ApplicationTaskHostedResourceBucket;
  readonly results: ApplicationTaskHostedResourceBucket;
  readonly forkPorts: () => ApplicationTaskHostedResourcePorts;
}

export interface ApplicationTaskHostedResourcePorts {
  readonly inputs: ApplicationTaskHostedResourceBucket;
  readonly principals: ApplicationTaskHostedResourceBucket;
  readonly runtimeObjects: ApplicationTaskHostedResourceBucket;
  readonly results: ApplicationTaskHostedResourceBucket;
}

export class ApplicationTaskHostedResourceAcquisitionError
  extends Data.TaggedError("ApplicationTaskHostedResourceAcquisitionError")<{
    readonly operation: "acquire_resources";
    readonly cause: unknown;
  }> {}

export interface ApplicationTaskHostedWorkerLoader extends WorkerLoader {
  readonly loads: number;
  readonly starts: number;
  readonly workerInputReads: number;
  readonly workerSettlements: number;
  readonly generations: readonly string[];
  readonly payloads: readonly unknown[];
  readonly settlements: readonly TaskWorkerSessionSettlementV1[];
  readonly awaitAcceptedStart: () => Promise<void>;
  readonly releaseSettlement: () => void;
  readonly awaitWorkerSettlement: () => Promise<void>;
}

export interface ApplicationTaskHostedWorkerLoaderOptions {
  readonly interruptionMode:
    | "settle_without_interruption"
    | "wait_for_interruption";
}

export interface ApplicationTaskHostedTestKit {
  readonly resources: ApplicationTaskHostedResources | null;
  readonly acquireWorkerLoader: (
    options: ApplicationTaskHostedWorkerLoaderOptions,
  ) => Effect.Effect<
    ApplicationTaskHostedWorkerLoader,
    never,
    Scope.Scope
  >;
  readonly makeApplicationHostPolicy:
    typeof makeApplicationTaskHostedApplicationPolicy;
  readonly makeLegacyHostPolicy: typeof makeApplicationTaskHostedLegacyPolicy;
  readonly makeOneCandidatePolicy:
    typeof makeApplicationTaskHostedOneCandidatePolicy;
}

export const acquireApplicationTaskHostedTestKit = Effect.fn(
  "ApplicationTaskHostedTestKit.acquire",
)(function* (options: Readonly<{ readonly resources: "none" | "r2" }>) {
  const resources = options.resources === "r2"
    ? yield* acquireApplicationTaskHostedResources()
    : null;
  return Object.freeze({
    resources,
    acquireWorkerLoader: acquireApplicationTaskHostedWorkerLoader,
    makeApplicationHostPolicy: makeApplicationTaskHostedApplicationPolicy,
    makeLegacyHostPolicy: makeApplicationTaskHostedLegacyPolicy,
    makeOneCandidatePolicy: makeApplicationTaskHostedOneCandidatePolicy,
  });
});

interface OwnedApplicationTaskHostedResources
  extends ApplicationTaskHostedResources {
  readonly dispose: () => Promise<void>;
}

const acquireApplicationTaskHostedResources = Effect.fn(
  "ApplicationTaskHostedTestKit.acquireResources",
)(function* () {
  return yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: createApplicationTaskHostedResourceFixture,
      catch: cause => new ApplicationTaskHostedResourceAcquisitionError({
        operation: "acquire_resources",
        cause,
      }),
    }),
    resources => Effect.tryPromise({
      try: resources.dispose,
      catch: cause => cause,
    }).pipe(Effect.orDie),
  );
});

async function createApplicationTaskHostedResourceFixture(): Promise<
  OwnedApplicationTaskHostedResources
> {
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    r2Buckets: [
      "TASK_INPUTS",
      "TASK_PRINCIPALS",
      "TASK_RUNTIME_OBJECTS",
      "TASK_RESULTS",
    ],
  });
  try {
    const [inputs, principals, runtimeObjects, results] = await Promise.all([
      makeApplicationTaskHostedResourceBucket(runtime, "TASK_INPUTS"),
      makeApplicationTaskHostedResourceBucket(runtime, "TASK_PRINCIPALS"),
      makeApplicationTaskHostedResourceBucket(runtime, "TASK_RUNTIME_OBJECTS"),
      makeApplicationTaskHostedResourceBucket(runtime, "TASK_RESULTS"),
    ]);
    let disposed = false;
    return Object.freeze({
      inputs,
      principals,
      runtimeObjects,
      results,
      forkPorts: () => Object.freeze({
        inputs: inputs.fork(),
        principals: principals.fork(),
        runtimeObjects: runtimeObjects.fork(),
        results: results.fork(),
      }),
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await runtime.dispose();
      },
    });
  } catch (cause) {
    await runtime.dispose();
    throw cause;
  }
}

async function makeApplicationTaskHostedResourceBucket(
  runtime: Miniflare,
  binding: string,
): Promise<MiniflareApplicationTaskHostedResourceBucket> {
  const bucket = await runtime.getR2Bucket(binding);
  return new MiniflareApplicationTaskHostedResourceBucket(
    bucket as unknown as TaskInputStoreBucket,
  );
}

class MiniflareApplicationTaskHostedResourceBucket
  implements ApplicationTaskHostedResourceBucket {
  readonly values = new Map<string, Uint8Array>();
  readonly putKeys: string[] = [];
  readonly getKeys: string[] = [];
  putCalls = 0;
  getCalls = 0;

  constructor(private readonly owner: TaskInputStoreBucket) {}

  fork(): MiniflareApplicationTaskHostedResourceBucket {
    return new MiniflareApplicationTaskHostedResourceBucket(this.owner);
  }

  async put(
    key: string,
    value: ArrayBuffer,
    options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    this.putCalls += 1;
    this.putKeys.push(key);
    const result = await Reflect.apply(this.owner.put, this.owner, [
      key,
      value,
      options,
    ]);
    this.values.set(key, new Uint8Array(value.slice(0)));
    return result;
  }

  get(key: string): PromiseLike<unknown> {
    this.getCalls += 1;
    this.getKeys.push(key);
    return Reflect.apply(this.owner.get, this.owner, [key]) as
      PromiseLike<unknown>;
  }
}

const acquireApplicationTaskHostedWorkerLoader = Effect.fn(
  "ApplicationTaskHostedTestKit.acquireWorkerLoader",
)(function* (options: ApplicationTaskHostedWorkerLoaderOptions) {
  return yield* Effect.acquireRelease(
    Effect.sync(() => new LiveApplicationTaskHostedWorkerLoader(
      options.interruptionMode,
    )),
    owner => Effect.tryPromise({
      try: () => owner.disposeAll(),
      catch: cause => cause,
    }).pipe(Effect.orDie),
  );
});

class LiveApplicationTaskHostedWorkerLoader
  implements ApplicationTaskHostedWorkerLoader {
  loads = 0;
  starts = 0;
  workerInputReads = 0;
  workerSettlements = 0;
  readonly generations: string[] = [];
  readonly payloads: unknown[] = [];
  readonly settlements: TaskWorkerSessionSettlementV1[] = [];
  private readonly settlementGate: Promise<void>;
  private releaseSettlementGate: (() => void) | undefined;
  private readonly acceptedStart: Promise<void>;
  private resolveAcceptedStart: (() => void) | undefined;
  private readonly sessions = new Set<LiveGeneratedTaskSession>();
  private readonly disposals = new Set<Promise<void>>();

  constructor(
    private readonly interruptionMode:
      ApplicationTaskHostedWorkerLoaderOptions["interruptionMode"],
  ) {
    this.settlementGate = new Promise(resolve => {
      this.releaseSettlementGate = resolve;
    });
    this.acceptedStart = new Promise(resolve => {
      this.resolveAcceptedStart = resolve;
    });
  }

  awaitAcceptedStart(): Promise<void> {
    return this.acceptedStart;
  }

  releaseSettlement(): void {
    this.releaseSettlementGate?.();
    this.releaseSettlementGate = undefined;
  }

  async awaitWorkerSettlement(): Promise<void> {
    const sessions = [...this.sessions];
    if (sessions.length !== 1 || sessions[0] === undefined) {
      throw new Error(
        "Expected exactly one live Application Task Worker session.",
      );
    }
    await sessions[0].settlement();
  }

  async disposeAll(): Promise<void> {
    for (const session of this.sessions) this.disposeSession(session);
    const outcomes = await Promise.allSettled(this.disposals);
    const failure = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new ApplicationTaskHostedWorkerStub(this, code);
  }

  get(
    _name: string | null,
    _getCode: () => WorkerLoaderWorkerCode | Promise<WorkerLoaderWorkerCode>,
  ): WorkerStub {
    throw new Error("WorkerLoader.get is forbidden for fresh task execution.");
  }

  async start(
    code: WorkerLoaderWorkerCode,
    entrypoint: string | undefined,
    request: TaskWorkerSessionStartRequestV1,
    capability: unknown,
    queryCapability: unknown,
    mutationCapability: unknown,
  ) {
    this.starts += 1;
    this.generations.push(request.generation);
    const read = Reflect.get(capability as object, "read");
    const payload = await Reflect.apply(read, capability, []);
    this.payloads.push(payload);
    const session = await LiveGeneratedTaskSession.start(
      code,
      entrypoint,
      request,
      payload,
      queryCapability,
      mutationCapability,
      this.interruptionMode,
    );
    this.sessions.add(session);
    this.resolveAcceptedStart?.();
    this.resolveAcceptedStart = undefined;
    let settlement: Promise<TaskWorkerSessionSettlementV1> | undefined;
    const remote = {
      acceptance: () => owned(session.acceptance),
      requestInterruption: async (
        interruption: TaskWorkerSessionInterruptionRequestV1,
      ) => owned(await session.requestInterruption(interruption)),
      settlement: async () => {
        settlement ??= (async () => {
          await this.settlementGate;
          const executed = await session.settlement();
          this.workerInputReads += executed.inputReads;
          this.workerSettlements += 1;
          this.settlements.push(executed.settlement);
          return executed.settlement;
        })();
        return owned(await settlement);
      },
    };
    Object.defineProperty(remote, Symbol.dispose, {
      configurable: true,
      value: () => this.disposeSession(session),
    });
    return remote;
  }

  private disposeSession(session: LiveGeneratedTaskSession): void {
    if (!this.sessions.delete(session)) return;
    const disposal = session.dispose();
    this.disposals.add(disposal);
    void disposal.catch(() => undefined);
  }
}

class ApplicationTaskHostedWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: LiveApplicationTaskHostedWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    return {
      start: (
        request: TaskWorkerSessionStartRequestV1,
        capability: unknown,
        queryCapability: unknown,
        mutationCapability: unknown,
      ) => this.owner.start(
        this.code,
        name,
        request,
        capability,
        queryCapability,
        mutationCapability,
      ),
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects are forbidden for task execution.");
  }
}

class LiveGeneratedTaskSession {
  private disposal: Promise<void> | undefined;

  private constructor(
    private readonly runtime: Miniflare,
    private readonly control: LiveTaskSessionControl,
    private readonly running: Promise<Readonly<{
      readonly settlement: TaskWorkerSessionSettlementV1;
      readonly inputReads: number;
    }>>,
    readonly acceptance: TaskWorkerSessionAcceptanceV1,
  ) {}

  static async start(
    code: WorkerLoaderWorkerCode,
    entrypoint: string | undefined,
    request: TaskWorkerSessionStartRequestV1,
    payload: unknown,
    queryCapability: unknown,
    mutationCapability: unknown,
    interruptionMode:
      ApplicationTaskHostedWorkerLoaderOptions["interruptionMode"],
  ): Promise<LiveGeneratedTaskSession> {
    if (entrypoint === undefined) {
      throw new Error("Application Task Worker entrypoint was not selected.");
    }
    const encoded = JSON.stringify({ request, payload }, encodeRpcValue);
    const waitsForInterruption = interruptionMode === "wait_for_interruption";
    const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify(code)};
const waitsForInterruption = ${JSON.stringify(waitsForInterruption)};
const input = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
      ? BigInt(value.__bigint)
      : value
);
globalThis.inputReads = 0;
class InputCapability extends RpcTarget {
  read() {
    globalThis.inputReads += 1;
    return structuredClone(input.payload);
  }
}
const encode = (value) => JSON.stringify(value, (_key, member) =>
  typeof member === "bigint"
    ? { __bigint: String(member) }
    : member instanceof Uint8Array
      ? { __bytes: Array.from(member) }
      : member
);
const decode = (text) => JSON.parse(text, (_key, member) =>
  member && typeof member === "object" && Array.isArray(member.__bytes)
    ? new Uint8Array(member.__bytes)
    : member && typeof member === "object" && typeof member.__bigint === "string"
      ? BigInt(member.__bigint)
      : member
);
const response = (value) => new Response(encode(value), {
  headers: { "content-type": "application/json" },
});
export default {
  async fetch(_request, env) {
    let session;
    try {
      class QueryCapability extends RpcTarget {
        async invoke(request) {
          const response = await env.CONTROL.fetch(
            "https://task-control.test/query",
            { method: "POST", body: encode(request) },
          );
          const text = await response.text();
          if (!response.ok) throw new Error(text);
          return decode(text);
        }
      }
      class MutationCapability extends RpcTarget {
        async invoke(request) {
          const response = await env.CONTROL.fetch(
            "https://task-control.test/mutation",
            { method: "POST", body: encode(request) },
          );
          const text = await response.text();
          if (!response.ok) throw new Error(text);
          return decode(text);
        }
      }
      const worker = env.LOADER.load(code);
      session = await worker
        .getEntrypoint(${JSON.stringify(entrypoint)})
        .start(
          input.request,
          new InputCapability(),
          new QueryCapability(),
          new MutationCapability(),
        );
      const acceptance = await session.acceptance();
      await env.CONTROL.fetch("https://task-control.test/accepted", {
        method: "POST",
        body: encode({ acceptance }),
      });
      if (waitsForInterruption) {
        const interruptionResponse = await env.CONTROL.fetch(
          "https://task-control.test/interruption",
          { method: "POST" },
        );
        const interruption = decode(await interruptionResponse.text());
        const interruptionAcceptance = await session.requestInterruption(
          interruption,
        );
        await env.CONTROL.fetch(
          "https://task-control.test/interruption-accepted",
          {
            method: "POST",
            body: encode({ interruptionAcceptance }),
          },
        );
      }
      return response({
        settlement: await session.settlement(),
        inputReads: globalThis.inputReads,
      });
    } finally {
      session?.[Symbol.dispose]?.();
    }
  },
};`;
    const control = new LiveTaskSessionControl(
      queryCapability,
      mutationCapability,
    );
    const runtime = new Miniflare({
      compatibilityDate: APPLICATION_TASK_HOSTED_COMPATIBILITY_DATE,
      modules: true,
      script: outerSource,
      workerLoaders: { LOADER: {} },
      serviceBindings: {
        CONTROL: (requestValue: Request) => control.fetch(requestValue),
      },
    });
    const running = callLiveTaskSession<Readonly<{
      readonly settlement: TaskWorkerSessionSettlementV1;
      readonly inputReads: number;
    }>>(runtime);
    try {
      const acceptance = await control.awaitAcceptance(running);
      return new LiveGeneratedTaskSession(
        runtime,
        control,
        running,
        acceptance,
      );
    } catch (cause) {
      await runtime.dispose();
      throw cause;
    }
  }

  async requestInterruption(
    interruption: TaskWorkerSessionInterruptionRequestV1,
  ): Promise<TaskWorkerSessionInterruptionAcceptanceV1> {
    return this.control.requestInterruption(interruption, this.running);
  }

  async settlement(): Promise<Readonly<{
    readonly settlement: TaskWorkerSessionSettlementV1;
    readonly inputReads: number;
  }>> {
    return this.running;
  }

  dispose(): Promise<void> {
    this.disposal ??= this.runtime.dispose();
    return this.disposal;
  }
}

class LiveTaskSessionControl {
  private readonly queryReceiver: object;
  private readonly queryInvoke: (request: unknown) => unknown;
  private readonly mutationReceiver: object;
  private readonly mutationInvoke: (request: unknown) => unknown;
  private readonly acceptance: Promise<TaskWorkerSessionAcceptanceV1>;
  private resolveAcceptance: ((value: TaskWorkerSessionAcceptanceV1) => void) |
    undefined;
  private readonly interruptionRequest: Promise<
    TaskWorkerSessionInterruptionRequestV1
  >;
  private resolveInterruptionRequest: ((
    value: TaskWorkerSessionInterruptionRequestV1,
  ) => void) | undefined;
  private readonly interruptionAcceptance: Promise<
    TaskWorkerSessionInterruptionAcceptanceV1
  >;
  private resolveInterruptionAcceptance: ((
    value: TaskWorkerSessionInterruptionAcceptanceV1,
  ) => void) | undefined;
  private interruptionRequested = false;

  constructor(queryCapability: unknown, mutationCapability: unknown) {
    if (queryCapability === null ||
      (typeof queryCapability !== "object" &&
        typeof queryCapability !== "function")) {
      throw new Error("Application Task query capability is unavailable.");
    }
    const queryInvoke = Reflect.get(queryCapability, "invoke");
    if (typeof queryInvoke !== "function") {
      throw new Error("Application Task query capability is unavailable.");
    }
    this.queryReceiver = queryCapability;
    this.queryInvoke = queryInvoke;
    if (mutationCapability === null ||
      (typeof mutationCapability !== "object" &&
        typeof mutationCapability !== "function")) {
      throw new Error("Application Task mutation capability is unavailable.");
    }
    const mutationInvoke = Reflect.get(mutationCapability, "invoke");
    if (typeof mutationInvoke !== "function") {
      throw new Error("Application Task mutation capability is unavailable.");
    }
    this.mutationReceiver = mutationCapability;
    this.mutationInvoke = mutationInvoke;
    this.acceptance = new Promise(resolve => {
      this.resolveAcceptance = resolve;
    });
    this.interruptionRequest = new Promise(resolve => {
      this.resolveInterruptionRequest = resolve;
    });
    this.interruptionAcceptance = new Promise(resolve => {
      this.resolveInterruptionAcceptance = resolve;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/accepted") {
      const body = JSON.parse(await request.text(), decodeRpcValue) as Readonly<{
        readonly acceptance: TaskWorkerSessionAcceptanceV1;
      }>;
      this.resolveAcceptance?.(body.acceptance);
      return new Response(null, { status: 204 });
    }
    if (pathname === "/interruption") {
      return new Response(JSON.stringify(
        await this.interruptionRequest,
        encodeRpcValue,
      ), { headers: { "content-type": "application/json" } });
    }
    if (pathname === "/interruption-accepted") {
      const body = JSON.parse(await request.text(), decodeRpcValue) as Readonly<{
        readonly interruptionAcceptance:
          TaskWorkerSessionInterruptionAcceptanceV1;
      }>;
      this.resolveInterruptionAcceptance?.(body.interruptionAcceptance);
      return new Response(null, { status: 204 });
    }
    if (pathname === "/query") {
      try {
        const queryRequest = JSON.parse(await request.text(), decodeRpcValue);
        const result = await Reflect.apply(
          this.queryInvoke,
          this.queryReceiver,
          [queryRequest],
        );
        try {
          return new Response(JSON.stringify(result, encodeRpcValue), {
            headers: { "content-type": "application/json" },
          });
        } finally {
          if (result !== null &&
            (typeof result === "object" || typeof result === "function")) {
            const dispose = Reflect.get(result, Symbol.dispose);
            if (typeof dispose === "function") Reflect.apply(dispose, result, []);
          }
        }
      } catch (cause) {
        return new Response(String(cause), { status: 500 });
      }
    }
    if (pathname === "/mutation") {
      try {
        const mutationRequest = JSON.parse(await request.text(), decodeRpcValue);
        const result = await Reflect.apply(
          this.mutationInvoke,
          this.mutationReceiver,
          [mutationRequest],
        );
        try {
          return new Response(JSON.stringify(result, encodeRpcValue), {
            headers: { "content-type": "application/json" },
          });
        } finally {
          if (result !== null &&
            (typeof result === "object" || typeof result === "function")) {
            const dispose = Reflect.get(result, Symbol.dispose);
            if (typeof dispose === "function") Reflect.apply(dispose, result, []);
          }
        }
      } catch (cause) {
        return new Response(String(cause), { status: 500 });
      }
    }
    return new Response("not found", { status: 404 });
  }

  awaitAcceptance(
    running: Promise<unknown>,
  ): Promise<TaskWorkerSessionAcceptanceV1> {
    return raceWithSessionRun(this.acceptance, running);
  }

  requestInterruption(
    interruption: TaskWorkerSessionInterruptionRequestV1,
    running: Promise<unknown>,
  ): Promise<TaskWorkerSessionInterruptionAcceptanceV1> {
    if (this.interruptionRequested) {
      throw new Error("Application Task Worker interruption was requested twice.");
    }
    this.interruptionRequested = true;
    this.resolveInterruptionRequest?.(interruption);
    return raceWithSessionRun(this.interruptionAcceptance, running);
  }
}

function raceWithSessionRun<Value>(
  value: Promise<Value>,
  running: Promise<unknown>,
): Promise<Value> {
  return Promise.race([
    value,
    running.then(
      () => Promise.reject(new Error(
        "Application Task Worker session ended before the requested evidence.",
      )),
      cause => Promise.reject(cause),
    ),
  ]);
}

async function callLiveTaskSession<Value>(
  runtime: Miniflare,
): Promise<Value> {
  const response = await runtime.dispatchFetch("https://task-worker.test/run", {
    method: "POST",
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Application Task Worker session failed: ${responseText}`);
  }
  return JSON.parse(responseText, decodeRpcValue) as Value;
}

function encodeRpcValue(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { __bigint: String(value) };
  if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
  return value;
}

function decodeRpcValue(_key: string, value: unknown): unknown {
  if (
    value !== null && typeof value === "object"
    && "__bigint" in value
    && typeof value.__bigint === "string"
  ) return BigInt(value.__bigint);
  return value;
}

function owned<Value extends object>(value: Value): Value {
  Object.defineProperty(value, Symbol.dispose, {
    configurable: true,
    value: () => {},
  });
  return value;
}

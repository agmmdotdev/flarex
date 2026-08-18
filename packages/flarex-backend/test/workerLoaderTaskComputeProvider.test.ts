import {
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
  TaskComputeCancellationRejectedError,
  TaskComputeCancellationStaleError,
  TaskComputeDispatchConflictError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchUncertainError,
  TaskComputeProvider,
  validateApplicationTaskComputeDispatchRequestV1,
  validateTaskComputeCancellationRequestV1,
  validateTaskComputeDispatchRequestV1,
  type CurrentTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  ApplicationTaskWorkerDefinitionError,
  type ApplicationTaskWorkerDefinition,
} from "../src/artifactRuntime/ApplicationTaskWorkerDefinition";
import {
  TaskRuntimeLaunchAuthority,
} from "../src/taskRuntimeLaunch/Authority";
import type {
  ApplicationTaskRuntimeLaunchSubject,
  CurrentTaskRuntimeLaunchSubject,
  TaskRuntimeLaunchSubject,
} from "../src/taskRuntimeLaunch/Model";
import {
  makeWorkerLoaderTaskComputeProviderLayer,
  makeSupervisedWorkerLoaderTaskComputeProviderLayer,
  type TaskAttemptSupervisionExitObserver,
} from "../src/taskComputeDelivery/WorkerLoaderTaskComputeProvider";
import {
  TaskAttemptSupervisorContractError,
  type TaskAttemptSupervisor,
  type TaskAttemptSupervisorInput,
} from "../src/taskComputeDelivery/TaskAttemptSupervisor";
import { Deferred, Effect, Exit, Layer, Result } from "effect";
import {
  TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
  TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
  type TaskWorkerSessionStartRequestV1,
} from "flarex-protocol/internal/task-worker-session-v1";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/artifactRuntime/ApplicationTaskWorkerDefinition", async importOriginal => {
  const original = await importOriginal<
    typeof import("../src/artifactRuntime/ApplicationTaskWorkerDefinition")
  >();
  const { Effect: TestEffect } = await import("effect");
  return {
    ...original,
    makeApplicationTaskWorkerDefinition: (
      input: Parameters<typeof original.makeApplicationTaskWorkerDefinition>[0],
    ): ReturnType<typeof original.makeApplicationTaskWorkerDefinition> => {
      const manifest = input.manifest as Readonly<{
        readonly computeProfile: string;
        readonly maximumDurationInSeconds: number;
      }>;
      return manifest.computeProfile === "unsupported"
        ? TestEffect.fail(new original.ApplicationTaskWorkerDefinitionError({
            reason: "unsupportedComputeProfile",
          }))
        : TestEffect.succeed(applicationDefinition(
            input.runtimeTargetSha256,
            manifest.computeProfile,
            manifest.maximumDurationInSeconds * 1_000,
          ));
    },
  };
});

vi.mock("../src/artifactRuntime/LegacyTaskWorkerDefinition", async importOriginal => {
  const original = await importOriginal<
    typeof import("../src/artifactRuntime/LegacyTaskWorkerDefinition")
  >();
  const { Effect: TestEffect } = await import("effect");
  return {
    ...original,
    makeLegacyTaskWorkerDefinition: (
      input: Parameters<typeof original.makeLegacyTaskWorkerDefinition>[0],
    ): ReturnType<typeof original.makeLegacyTaskWorkerDefinition> =>
      TestEffect.succeed(Object.freeze({
        taskDefinitionRevisionId: input.subject.request.taskDefinitionRevisionId,
        computeProfile: input.subject.request.computeProfile,
        compatibilityDate: "2026-06-14",
        compatibilityFlags: Object.freeze(["nodejs_compat"]),
        wallMilliseconds: input.subject.request.maximumDurationMs,
        limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 as const }),
        mainModule: "main.js",
        modules: Object.freeze({ "main.js": Object.freeze({ js: "export {};" }) }),
        env: Object.freeze({}),
        entrypoint: "FlarexLegacyTaskWorker" as const,
      })),
  };
});

describe("DTE06-D3b.iii Worker Loader TaskComputeProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shares an exact Application start, decodes input, and delivers monotonic cancellation", async () => {
    const input = await canonicalizeFlarexValueV1({ orderId: "order-1" });
    const request = applicationRequest();
    const authority = new FakeLaunchAuthority(input, request);
    const loader = new FakeWorkerLoader();

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      const [first, replay] = yield* Effect.all([
        provider.dispatch(request),
        provider.dispatch(request),
      ], { concurrency: "unbounded" });
      expect(replay).toEqual(first);
      expect(loader.starts).toBe(1);
      expect(authority.resolutions).toBe(1);
      expect(loader.payloads).toEqual([{ orderId: "order-1" }]);

      const firstCancellation = yield* provider.requestCancellation(cancellation({
        version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
        identity: request.identity,
        execution: first.execution,
        cancellationGeneration: 1n,
      }));
      const sameCancellation = yield* provider.requestCancellation(cancellation({
        version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
        identity: request.identity,
        execution: first.execution,
        cancellationGeneration: 1n,
      }));
      expect(sameCancellation).toEqual(firstCancellation);
      expect(loader.interruptions).toBe(1);
      yield* provider.requestCancellation(cancellation({
        version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
        identity: request.identity,
        execution: first.execution,
        cancellationGeneration: 2n,
      }));
      expect(loader.interruptions).toBe(2);
      const stale = yield* provider.requestCancellation(cancellation({
        version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
        identity: request.identity,
        execution: first.execution,
        cancellationGeneration: 1n,
      })).pipe(Effect.flip);
      expect(stale).toBeInstanceOf(TaskComputeCancellationStaleError);
    }));
    expect(loader.sessionDisposals).toBe(1);
  });

  it("uses both generation-specific definitions and performs fresh cold/warm loads", async () => {
    const input = await canonicalizeFlarexValueV1(null);
    const application = applicationRequest();
    const legacy = legacyRequest(2n);
    const authority = new FakeLaunchAuthority(input, application, legacy);
    const loader = new FakeWorkerLoader();

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      const applicationAcceptance = yield* provider.dispatch(application);
      const legacyAcceptance = yield* provider.dispatch(legacy);
      expect(applicationAcceptance.execution.executionId)
        .not.toBe(legacyAcceptance.execution.executionId);
      expect(loader.generations).toEqual([
        "application_v1",
        "legacy_dynamic_worker_v1",
      ]);
      expect(loader.loaded).toHaveLength(2);
      expect(loader.loaded[0]).not.toBe(loader.loaded[1]);
    }));
  });

  it("rejects conflicting replay and unsupported profiles before Worker load", async () => {
    const input = await canonicalizeFlarexValueV1(null);
    const request = applicationRequest();
    const authority = new FakeLaunchAuthority(input, request);
    const loader = new FakeWorkerLoader();

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      yield* provider.dispatch(request);
      const conflictRequest = success(validateApplicationTaskComputeDispatchRequestV1({
        ...request,
        maximumDurationMs: request.maximumDurationMs - 1,
      }));
      const conflict = yield* provider.dispatch(conflictRequest).pipe(Effect.flip);
      expect(conflict).toBeInstanceOf(TaskComputeDispatchConflictError);

      const unsupported = applicationRequest(9n, "unsupported");
      const rejection = yield* provider.dispatch(unsupported).pipe(Effect.flip);
      expect(rejection).toBeInstanceOf(TaskComputeDispatchRejectedError);
      expect(rejection).toMatchObject({
        reason: "unsupported_compute_profile",
        retryable: false,
      });
      expect(loader.starts).toBe(1);
    }));
  });

  it("keeps an unknown start response sticky without a second Worker", async () => {
    const input = await canonicalizeFlarexValueV1(null);
    const request = applicationRequest();
    const authority = new FakeLaunchAuthority(input, request);
    const loader = new FakeWorkerLoader({ invalidFirstAcceptance: true });
    let allocations = 0;

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      const uncertain = yield* provider.dispatch(request).pipe(Effect.flip);
      expect(uncertain).toBeInstanceOf(TaskComputeDispatchUncertainError);
      expect(loader.sessionDisposals).toBe(1);
      const replay = yield* provider.dispatch(request).pipe(Effect.flip);
      expect(replay).toEqual(uncertain);
      expect(loader.executionIds).toHaveLength(1);
      expect(loader.starts).toBe(1);
    }), () => {
      allocations += 1;
      return "00000000-0000-4000-8000-000000000001";
    });
    expect(allocations).toBe(1);
    expect(loader.sessionDisposals).toBe(1);
  });

  it("treats the configured dispatch bound as a provider-scope admission limit", async () => {
    const input = await canonicalizeFlarexValueV1(null);
    const firstRequest = applicationRequest();
    const secondRequest = applicationRequest(2n);
    const authority = new FakeLaunchAuthority(input, firstRequest);
    const loader = new FakeWorkerLoader();

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      const accepted = yield* provider.dispatch(firstRequest);
      const capacity = yield* provider.dispatch(secondRequest).pipe(Effect.flip);
      expect(capacity).toBeInstanceOf(TaskComputeDispatchRejectedError);
      expect(capacity).toMatchObject({
        reason: "capacity_unavailable",
        retryable: true,
      });
      expect(yield* provider.dispatch(firstRequest)).toEqual(accepted);
      expect(loader.starts).toBe(1);
    }), undefined, 100, 1);
  });

  it("reports a settled session as lost and bounds start timeout as uncertain", async () => {
    const input = await canonicalizeFlarexValueV1(null);
    const request = applicationRequest();
    const authority = new FakeLaunchAuthority(input, request);
    const loader = new FakeWorkerLoader();

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      const accepted = yield* provider.dispatch(request);
      loader.sessions[0]!.complete();
      yield* Effect.sleep("10 millis");
      const lost = yield* provider.requestCancellation(cancellation({
        version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
        identity: request.identity,
        execution: accepted.execution,
        cancellationGeneration: 1n,
      })).pipe(Effect.flip);
      expect(lost).toBeInstanceOf(TaskComputeCancellationRejectedError);
      expect(lost).toMatchObject({ reason: "execution_not_found" });
      expect(yield* provider.dispatch(request)).toEqual(accepted);
    }));

    const timeoutLoader = new FakeWorkerLoader({ neverStart: true });
    const timeout = await runWithProvider(
      timeoutLoader,
      authority,
      Effect.gen(function* () {
        const provider = yield* TaskComputeProvider;
        const first = yield* provider.dispatch(request).pipe(Effect.flip);
        const replay = yield* provider.dispatch(request).pipe(Effect.flip);
        expect(replay).toEqual(first);
        return first;
      }),
      undefined,
      5,
    );
    expect(timeout).toBeInstanceOf(TaskComputeDispatchUncertainError);
    expect(timeoutLoader.starts).toBe(1);
  });

  it("delegates one accepted session and observes the exact supervisor failure", async () => {
    const input = await canonicalizeFlarexValueV1(null);
    const request = applicationRequest();
    const authority = new FakeLaunchAuthority(input, request);
    const loader = new FakeWorkerLoader();
    const supervised: TaskAttemptSupervisorInput[] = [];
    const observed = Deferred.makeUnsafe<Parameters<
      TaskAttemptSupervisionExitObserver["observe"]
    >[1]>();
    const supervise: TaskAttemptSupervisor["supervise"] = sessionInput =>
      Effect.gen(function* () {
        supervised.push(sessionInput);
        return yield* new TaskAttemptSupervisorContractError({
          reason: "lifecycle_identity_mismatch",
        });
      }).pipe(Effect.ensuring(Effect.exit(sessionInput.session.close)));
    const supervisor: TaskAttemptSupervisor = Object.freeze({ supervise });
    const observe: TaskAttemptSupervisionExitObserver["observe"] =
      (_sessionInput, exit) => {
        Deferred.doneUnsafe(observed, Effect.succeed(exit));
      };
    const observer: TaskAttemptSupervisionExitObserver = Object.freeze({
      observe,
    });

    await runWithProvider(loader, authority, Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      yield* provider.dispatch(request);
      const exit = yield* Deferred.await(observed);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(supervised).toHaveLength(1);
      expect(supervised[0]?.dispatch).toEqual(request);
      expect(supervised[0]?.session.acceptance.identity).toEqual(
        request.identity,
      );
    }), undefined, 100, 32, { supervisor, observer });
    expect(loader.starts).toBe(1);
    expect(loader.sessionDisposals).toBe(1);
  });
});

async function runWithProvider<Success, Failure>(
  loader: WorkerLoader,
  authority: FakeLaunchAuthority,
  effect: Effect.Effect<Success, Failure, TaskComputeProvider>,
  randomUuid: (() => string) | undefined = undefined,
  handshakeMilliseconds = 100,
  maximumScopedDispatches = 32,
  supervision: Readonly<{
    readonly supervisor: TaskAttemptSupervisor;
    readonly observer: TaskAttemptSupervisionExitObserver;
  }> | undefined = undefined,
): Promise<Success> {
  const authorityLayer = Layer.succeed(
    TaskRuntimeLaunchAuthority,
    TaskRuntimeLaunchAuthority.of(authority),
  );
  const options = {
    applicationHostPolicy: applicationHostPolicy(),
    legacyHostPolicy: legacyHostPolicy(),
    maximumScopedDispatches,
    handshakeMilliseconds,
    randomUuid: randomUuid ?? (() => crypto.randomUUID()),
    sha256: () => Effect.succeed(new Uint8Array(32)),
  };
  const providerLayer = (supervision === undefined
    ? makeWorkerLoaderTaskComputeProviderLayer(loader, options)
    : makeSupervisedWorkerLoaderTaskComputeProviderLayer(
        loader,
        options,
        supervision.supervisor,
        supervision.observer,
      )).pipe(Layer.provide(authorityLayer));
  return Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(providerLayer))));
}

class FakeLaunchAuthority {
  resolutions = 0;

  constructor(
    private readonly input: Awaited<ReturnType<typeof canonicalizeFlarexValueV1>>,
    private readonly application: ReturnType<typeof applicationRequest>,
    private readonly legacy: ReturnType<typeof legacyRequest> | undefined = undefined,
  ) {}

  resolve = (request: unknown): Effect.Effect<CurrentTaskRuntimeLaunchSubject> =>
    Effect.sync(() => {
      this.resolutions += 1;
      const decoded = request as CurrentTaskComputeDispatchRequestV1;
      return "applicationTaskRuntimeTargetSha256" in decoded
        ? applicationSubject(success(
            validateApplicationTaskComputeDispatchRequestV1(decoded),
          ), this.input)
        : legacySubject(success(validateTaskComputeDispatchRequestV1(decoded)),
            this.input, this.legacy);
    });
}

function applicationSubject(
  request: Extract<CurrentTaskComputeDispatchRequestV1, {
    readonly applicationTaskRuntimeTargetSha256: Uint8Array;
  }>,
  input: Awaited<ReturnType<typeof canonicalizeFlarexValueV1>>,
): ApplicationTaskRuntimeLaunchSubject {
  return Object.freeze({
    generation: "application_v1",
    request,
    runtimeTarget: Object.freeze({}) as ApplicationTaskRuntimeLaunchSubject["runtimeTarget"],
    manifest: Object.freeze({
      computeProfile: request.computeProfile,
      maximumDurationInSeconds: request.maximumDurationMs / 1_000,
    }) as ApplicationTaskRuntimeLaunchSubject["manifest"],
    creationAuthority: Object.freeze({}) as ApplicationTaskRuntimeLaunchSubject["creationAuthority"],
    executionIdentity: Object.freeze({
      kind: "user",
      user: Object.freeze({
        tokenIdentifier: "worker-loader-test",
        subject: "worker-loader-user",
        issuer: "https://worker-loader.flarex.invalid",
      }),
    }),
    source: Object.freeze({
      sourceArtifact: Object.freeze({
        rootSha256: "a".repeat(64),
        executionModulePath: "_flarex/application.js",
        schemaModulePath: null,
        modules: Object.freeze([]),
      }),
      modules: Object.freeze([]),
    }),
    input: inputSource(input),
  });
}

function legacySubject(
  request: Extract<CurrentTaskComputeDispatchRequestV1, {
    readonly taskDefinitionRevisionId: string;
  }>,
  input: Awaited<ReturnType<typeof canonicalizeFlarexValueV1>>,
  expected: ReturnType<typeof legacyRequest> | undefined,
): TaskRuntimeLaunchSubject {
  if (expected !== undefined && expected.identity.runId !== request.identity.runId) {
    throw new Error("Unexpected Legacy request fixture.");
  }
  return Object.freeze({
    request,
    runtimeBinding: Object.freeze({}) as TaskRuntimeLaunchSubject["runtimeBinding"],
    runtimeObjects: Object.freeze([]),
    input: inputSource(input),
  });
}

function inputSource(
  input: Awaited<ReturnType<typeof canonicalizeFlarexValueV1>>,
) {
  const reference = success(makeTaskInputReferenceV1(
    input.sha256,
    input.canonicalBytes.byteLength,
  ));
  return Object.freeze({
    reference,
    read: () => Effect.succeed(new Uint8Array(input.canonicalBytes)),
  });
}

function applicationRequest(
  sequence = 1n,
  computeProfile = "standard-1x",
) {
  return success(validateApplicationTaskComputeDispatchRequestV1({
    version: TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
    identity: identity(sequence),
    applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile,
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: 30_000,
  }));
}

function legacyRequest(sequence = 2n) {
  return success(validateTaskComputeDispatchRequestV1({
    version: TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
    identity: identity(sequence),
    taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: 30_000,
  }));
}

function cancellation(
  input: Parameters<typeof validateTaskComputeCancellationRequestV1>[0],
) {
  return success(validateTaskComputeCancellationRequestV1(input));
}

function identity(sequence: bigint) {
  return {
    version: "flarex.task-compute-dispatch-identity.v1" as const,
    scopeId: "scope_00000000-0000-4000-8000-000000000001",
    runId: `run_00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    requestedEffectSequence: sequence,
    attemptId: `attempt_00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    executionFence: 1n,
  };
}

function applicationDefinition(
  digest: Uint8Array,
  computeProfile: string,
  wallMilliseconds: number,
): ApplicationTaskWorkerDefinition {
  return Object.freeze({
    runtimeTargetSha256Hex: hex(digest),
    computeProfile,
    compatibilityDate: "2026-06-14",
    wallMilliseconds,
    limits: Object.freeze({ cpuMs: 10_000, subRequests: 0 as const }),
    mainModule: "main.js",
    modules: Object.freeze({ "main.js": Object.freeze({ js: "export {};" }) }),
    env: Object.freeze({}),
    entrypoint: "FlarexApplicationTaskWorker",
  });
}

function applicationHostPolicy() {
  return Object.freeze({
    runtimeHostIdentity: "flarex-application-runtime-host-v1",
    compatibilityDate: "2026-06-14",
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    }), Object.freeze({
      computeProfile: "unsupported",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
  });
}

function legacyHostPolicy() {
  return Object.freeze({
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    admittedCompatibilityDate: "2026-06-14",
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
    admittedCompatibilityFlags: Object.freeze(["nodejs_compat"]),
  });
}

class FakeWorkerSession {
  readonly raw: object;
  readonly completion: Promise<unknown>;
  readonly #resolve: (value: unknown) => void;

  constructor(
    readonly start: TaskWorkerSessionStartRequestV1,
    onDispose: () => void,
    private readonly onInterruption: () => void,
    invalidAcceptance: boolean,
  ) {
    let resolve!: (value: unknown) => void;
    this.completion = new Promise(resolveValue => {
      resolve = resolveValue;
    });
    this.#resolve = resolve;
    this.raw = owned({
      acceptance: () => owned({
        format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
        version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        generation: start.generation,
        identity: invalidAcceptance
          ? { ...start.request.dispatch.identity, executionFence: 99n }
          : start.request.dispatch.identity,
        executionId: start.executionId,
        cancellationGeneration: start.request.dispatch.cancellation.generation,
      }),
      requestInterruption: (request: Readonly<{
        generation: "application_v1" | "legacy_dynamic_worker_v1";
        identity: TaskWorkerSessionStartRequestV1["request"]["dispatch"]["identity"];
        executionId: string;
        cancellationGeneration: bigint;
        reason: "cancellation_requested" | "maximum_duration" | "host_shutdown";
      }>) => {
        this.onInterruption();
        return owned({
          format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
          version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
          kind: "interruption_requested",
          generation: request.generation,
          identity: request.identity,
          executionId: request.executionId,
          cancellationGeneration: request.cancellationGeneration,
          reason: request.reason,
        });
      },
      settlement: () => this.completion,
    }, onDispose);
  }

  complete(): void {
    this.#resolve(owned({
      format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
      version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
      kind: "settled",
      generation: this.start.generation,
      identity: this.start.request.dispatch.identity,
      executionId: this.start.executionId,
      outcome: {
        kind: "failed",
        failure: { code: "handler_failed", message: null },
      },
    }));
  }
}

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly generations: string[] = [];
  readonly executionIds: string[] = [];
  readonly payloads: unknown[] = [];
  readonly sessions: FakeWorkerSession[] = [];
  starts = 0;
  interruptions = 0;
  sessionDisposals = 0;

  constructor(private readonly behavior: Readonly<{
    readonly invalidFirstAcceptance?: boolean;
    readonly neverStart?: boolean;
  }> = {}) {}

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loaded.push(code);
    return new FakeWorkerStub(this);
  }

  get(_name: string | null, getCode: () => WorkerLoaderWorkerCode |
    Promise<WorkerLoaderWorkerCode>): WorkerStub {
    throw new Error(`Unexpected WorkerLoader.get: ${String(getCode)}`);
  }

  async start(request: TaskWorkerSessionStartRequestV1, capability: unknown) {
    this.starts += 1;
    this.generations.push(request.generation);
    this.executionIds.push(request.executionId);
    if (this.behavior.neverStart === true) return await new Promise<never>(() => {});
    const read = Reflect.get(capability as object, "read");
    this.payloads.push(await Reflect.apply(read, capability, []));
    const session = new FakeWorkerSession(
      request,
      () => { this.sessionDisposals += 1; },
      () => { this.interruptions += 1; },
      this.behavior.invalidFirstAcceptance === true && this.starts === 1,
    );
    this.sessions.push(session);
    return session.raw;
  }
}

class FakeWorkerStub implements WorkerStub {
  constructor(private readonly owner: FakeWorkerLoader) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    return {
      start: (request: TaskWorkerSessionStartRequestV1, capability: unknown) =>
        this.owner.start(request, capability),
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects forbidden");
  }
}

function owned<Value extends object>(value: Value, dispose = () => {}): Value {
  Object.defineProperty(value, Symbol.dispose, {
    configurable: true,
    value: dispose,
  });
  return value;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function success<Success, Failure>(result: Result.Result<Success, Failure>): Success {
  return Result.getOrThrow(result);
}

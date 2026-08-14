import {
  decideApplicationStartAttemptV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
} from "../../durable-task/src/runAttempt/v1.js";
import {
  decodeTaskRunCreationRequestKeyV1,
  makeTaskInputReferenceV1,
} from "../../durable-task/src/runCreation/v1.js";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  readTaskComputePreparedExecutionV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeApplicationTaskSystemRunAttemptStoreV1,
} from "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import {
  makeApplicationTaskSystemRunCreationStore,
} from "@flarex/persistence-postgres/internal/application-task-system-run-creation";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  decodeTaskDurationMsV1,
} from "../../durable-task/src/runAttempt/v1.js";
import {
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  ApplicationTaskSystem,
  createApplicationTaskRun,
  makeApplicationTaskSystemLayer,
} from "@flarex/standard-application-invocation/internal/application-task-system";
import {
  makeApplicationTaskComputeDeliveryLayer,
} from "@flarex/standard-application-invocation/internal/application-task-compute-delivery";
import {
  TaskComputeDeliveryConnectedRunner,
  type TaskComputeDeliveryConnectedRunnerOptions,
} from "flarex-backend/internal/task-compute-delivery";
import {
  TaskRuntimeLaunchPortError,
  type TaskRuntimeLaunchDirectory,
  type TaskRuntimeLaunchLocatedSource,
} from "flarex-backend/internal/task-runtime-launch";
import { Effect, Result } from "effect";
import { Miniflare } from "miniflare";
import {
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  type TaskWorkerSessionAcceptanceV1,
  type TaskWorkerSessionStartRequestV1,
  type TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { expect } from "vitest";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres";
import type { LocatedTaskSystemRunAttemptTargetV1 } from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import type { TaskComputeDeliveryControlDirectoryTarget } from
  "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
import {
  createTaskComputeDeliveryControlDirectoryTargetForSystemTest,
} from
  "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionActivation";

const RUNTIME_HOST_IDENTITY = "flarex-application-runtime-host-v1";
const COMPATIBILITY_DATE = "2026-06-14";
const TASK_ID = "tasks.users.task";
const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 2_000,
  transactionTimeoutMilliseconds: 5_000,
  settlementReserveMilliseconds: 6_000,
});

export interface ApplicationTaskSystemConnectedLane {
  readonly createFixture: () => Promise<
    ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
  >;
  readonly locateRunTarget: (
    fixture: ApplicationNativeMutationFixture<
      ApplicationNativeMutationPersistence
    >,
  ) => LocatedTaskSystemRunAttemptTargetV1;
  readonly createControlTarget: (
    fixture: ApplicationNativeMutationFixture<
      ApplicationNativeMutationPersistence
    >,
  ) => Promise<Readonly<{
    readonly target: TaskComputeDeliveryControlDirectoryTarget;
    readonly close: () => Promise<void>;
  }>>;
}

export async function proveApplicationTaskSystemConnected(
  lane: ApplicationTaskSystemConnectedLane = pgliteLane(),
): Promise<void> {
    const fixture = await lane.createFixture();
    const locatedRunTarget = lane.locateRunTarget(fixture);
    const control = await lane.createControlTarget(fixture);
    try {
    const locatedRunAuthority = Object.freeze({
      authority: fixture.active.basis.authority,
      target: locatedRunTarget,
    });
    const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
      globalThis.crypto.subtle.digest("SHA-256", input)
    );
    const creation = makeApplicationTaskSystemRunCreationStore(
      locatedRunAuthority,
      {
        sha256: taskSha256,
        leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
        immediateRetryThresholdMs: Result.getOrThrow(
          decodeTaskDurationMsV1(5_000),
        ),
        randomUuid: uuidSequence(1),
      },
    );
    const applicationTaskSystem = makeApplicationTaskSystemLayer({
      activation: fixture.activation,
      selection: {
        deploymentId: fixture.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
      creation,
    });
    const input = await canonicalizeFlarexValueV1({ orderId: "order-1" });
    const request = Object.freeze({
      version: 1 as const,
      requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
        "application-task-system-connected-1",
      )),
      input: Result.getOrThrow(makeTaskInputReferenceV1(
        input.sha256,
        input.canonicalBytes.byteLength,
      )),
    });
    await Effect.runPromise(Effect.gen(function* () {
    const created = yield* createApplicationTaskRun(TASK_ID, request).pipe(
        Effect.provide(applicationTaskSystem),
      );
    const exactReplay = yield* createApplicationTaskRun(TASK_ID, request).pipe(
        Effect.provide(applicationTaskSystem),
      );
    expect(exactReplay).toEqual(created);
    yield* Effect.promise(() => fixture.moveHead());
    const pinnedReplay = yield* createApplicationTaskRun(TASK_ID, request).pipe(
        Effect.provide(applicationTaskSystem),
      );
    expect(pinnedReplay).toEqual(created);

    const lifecycle = makeApplicationTaskSystemRunAttemptStoreV1(
      locatedRunAuthority,
      { randomUuid: uuidSequence(2) },
    );
    const startCommand = Object.freeze({
      type: "start_attempt" as const,
      runId: created.runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
    });
    const started = yield* lifecycle.transactRunAttempt({
      operation: "start_attempt",
      runId: created.runId,
      decide: state => decideApplicationStartAttemptV1(startCommand, state),
    });
    expect(started).toMatchObject({
      disposition: "accepted",
      outcome: { kind: "attempt_granted" },
    });

    const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
      fixture.target.drizzle,
      fixture.active.basis.authority.physicalLocator,
    );
    const deliveryAuthority = Object.freeze({
      authority: fixture.active.basis.authority,
      target: deliveryTarget,
    });
    let legacyRuntimeObjectReads = 0;
    const launchScopeId = ReplacementScopeIdV1Schema.make(
      fixture.active.basis.authority.scopeId,
    );
    const readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"] =
      providerRequest => readTaskComputePreparedExecutionV1(
        deliveryAuthority,
        providerRequest,
      ).pipe(
        Effect.map(preparedExecution => Object.freeze({
          generation: "application_v1" as const,
          preparedExecution,
        })),
        Effect.mapError(cause => new TaskRuntimeLaunchPortError({
          operation: "read_evidence",
          reason: cause.reason === "not_found"
            ? "not_found"
            : cause.reason === "resource_failure"
              ? "resource_failure"
              : "corrupt",
          cause,
        })),
      );
    const readApplicationSource:
      NonNullable<TaskRuntimeLaunchLocatedSource["readApplicationSource"]> =
        rootSha256 =>
          rootSha256 === fixture.source.sourceArtifact.rootSha256
            ? Effect.succeed(fixture.source)
            : Effect.fail(new TaskRuntimeLaunchPortError({
              operation: "read_application_source",
              reason: "not_found",
            }));
    const launchSource: TaskRuntimeLaunchLocatedSource = Object.freeze({
      scopeId: launchScopeId,
      readEvidence,
      readRuntimeObject: () => {
        legacyRuntimeObjectReads += 1;
        return Effect.fail(new TaskRuntimeLaunchPortError({
          operation: "read_runtime_object",
          reason: "not_found",
        }));
      },
      readInput: () => Effect.succeed(new Uint8Array(input.canonicalBytes)),
      readApplicationSource,
    });
    const resolveSource: TaskRuntimeLaunchDirectory["resolve"] = scopeId =>
      scopeId === launchScopeId
        ? Effect.succeed(launchSource)
        : Effect.fail(new TaskRuntimeLaunchPortError({
          operation: "resolve_source",
          reason: "authority_unavailable",
        }));
    const launchDirectory: TaskRuntimeLaunchDirectory = Object.freeze({
      resolve: resolveSource,
    });
    const loader = new MiniflareWorkerLoader();
    const layer = makeApplicationTaskComputeDeliveryLayer({
      controlTarget: control.target,
      directory: {
        authority: Object.freeze({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async (physicalLocator: ScopePhysicalLocator) =>
              createLocatedTaskComputeDeliveryTargetV1(
                fixture.target.drizzle,
                physicalLocator,
              ),
          }),
        }),
        repository: {
          claimDurationMilliseconds: 30_000,
          retryDelayMilliseconds: [1_000, 2_000],
          maximumDeliveryAttempts: 3,
          randomUuid: uuidSequence(3),
        },
        discoveryDeadline: DEADLINE_POLICY,
        resolutionTimeoutMilliseconds: 1_000,
      },
      launchDirectory,
      launchAuthority: {
        maximumRuntimeObjectBytes: 1_048_576,
        maximumTotalRuntimeObjectBytes: 2_000_000,
        validateRuntimeObject: () => Effect.void,
      },
      workerLoader: loader,
      provider: {
        applicationHostPolicy: applicationHostPolicy(),
        legacyHostPolicy: legacyHostPolicy(),
        maximumScopedDispatches: 4,
        handshakeMilliseconds: 1_000,
        randomUuid: uuidSequence(4),
        sha256: taskSha256,
      },
      runner: oneCandidatePolicy(),
    });
    const delivery = yield* Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* TaskComputeDeliveryConnectedRunner;
        return yield* runner.run(null);
      }).pipe(Effect.provide(layer)),
    );
    if (delivery.candidateFailures !== 0) {
      throw new Error("Application Task delivery failed.", { cause: delivery });
    }
    expect(delivery).toMatchObject({
      confirmedDispatchCandidatesHandled: 1,
      confirmedDispatchProviderCalls: 1,
      candidateFailures: 0,
    });
    expect(loader.loads).toBe(1);
    expect(loader.starts).toBe(1);
    expect(loader.generations).toEqual(["application_v1"]);
    expect(loader.payloads).toEqual([{ orderId: "order-1" }]);
    expect(loader.workerInputReads).toBe(1);
    expect(loader.workerSettlements).toBe(1);
    expect(legacyRuntimeObjectReads).toBe(0);
    }));
    } finally {
      await control.close();
    }
}

function pgliteLane(): ApplicationTaskSystemConnectedLane {
  return Object.freeze({
    createFixture: () => createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      includeTask: true,
    }),
    locateRunTarget: (
      fixture: ApplicationNativeMutationFixture<
        ApplicationNativeMutationPersistence
      >,
    ) =>
      createLocatedTaskSystemRunAttemptTargetV1(
        fixture.target.drizzle,
        fixture.active.basis.authority.physicalLocator,
      ),
    createControlTarget: async (
      fixture: ApplicationNativeMutationFixture<
        ApplicationNativeMutationPersistence
      >,
    ) => Object.freeze({
      target: Result.getOrThrow(
        createTaskComputeDeliveryControlDirectoryTargetForSystemTest(
          createDefaultLocatedReadCommittedTransactionRunnerV1(
            fixture.control.drizzle,
          ),
          DEADLINE_POLICY,
        ),
      ),
      close: () => Promise.resolve(),
    }),
  });
}

function applicationHostPolicy() {
  return Object.freeze({
    runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
    compatibilityDate: COMPATIBILITY_DATE,
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
  });
}

function legacyHostPolicy() {
  return Object.freeze({
    runtimeImplementationVersion: "worker-loader-2026.08.14",
    admittedCompatibilityDate: COMPATIBILITY_DATE,
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
    admittedCompatibilityFlags: Object.freeze(["nodejs_compat"]),
  });
}

function oneCandidatePolicy(): TaskComputeDeliveryConnectedRunnerOptions {
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

class MiniflareWorkerLoader implements WorkerLoader {
  loads = 0;
  starts = 0;
  workerInputReads = 0;
  workerSettlements = 0;
  readonly generations: string[] = [];
  readonly payloads: unknown[] = [];

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareWorkerStub(this, code);
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
  ) {
    this.starts += 1;
    this.generations.push(request.generation);
    const read = Reflect.get(capability as object, "read");
    const payload = await Reflect.apply(read, capability, []);
    this.payloads.push(payload);
    const executed = await executeGeneratedTaskSession(
      code,
      entrypoint,
      request,
      payload,
    );
    this.workerInputReads += executed.inputReads;
    this.workerSettlements += 1;
    return owned({
      acceptance: () => owned(executed.acceptance),
      requestInterruption: (interruption: Readonly<{
        readonly generation: "application_v1" | "legacy_dynamic_worker_v1";
        readonly identity: TaskWorkerSessionStartRequestV1["request"]["dispatch"]["identity"];
        readonly executionId: string;
        readonly cancellationGeneration: bigint;
      }>) => owned({
        format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
        version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
        kind: "interruption_requested",
        generation: interruption.generation,
        identity: interruption.identity,
        executionId: interruption.executionId,
        cancellationGeneration: interruption.cancellationGeneration,
      }),
      settlement: () => Promise.resolve(owned(executed.settlement)),
    });
  }
}

class MiniflareWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: MiniflareWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    return {
      start: (request: TaskWorkerSessionStartRequestV1, capability: unknown) =>
        this.owner.start(this.code, name, request, capability),
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects are forbidden for task execution.");
  }
}

async function executeGeneratedTaskSession(
  code: WorkerLoaderWorkerCode,
  entrypoint: string | undefined,
  request: TaskWorkerSessionStartRequestV1,
  payload: unknown,
): Promise<Readonly<{
  readonly acceptance: TaskWorkerSessionAcceptanceV1;
  readonly settlement: TaskWorkerSessionSettlementV1;
  readonly inputReads: number;
}>> {
  if (entrypoint === undefined) {
    throw new Error("Application Task Worker entrypoint was not selected.");
  }
  const encoded = JSON.stringify({ request, payload }, encodeRpcValue);
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify(code)};
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
export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(code);
    const session = await worker.getEntrypoint(${JSON.stringify(entrypoint)})
      .start(input.request, new InputCapability());
    try {
      const acceptance = await session.acceptance();
      const settlement = await session.settlement();
      return new Response(JSON.stringify({
        acceptance,
        settlement,
        inputReads: globalThis.inputReads,
      }, (_key, value) => typeof value === "bigint"
        ? { __bigint: String(value) }
        : value), { headers: { "content-type": "application/json" } });
    } finally {
      session[Symbol.dispose]?.();
    }
  },
};`;
  const runtime = new Miniflare({
    compatibilityDate: COMPATIBILITY_DATE,
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  try {
    const response = await runtime.dispatchFetch("https://task-worker.test/");
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Application Task Worker failed: ${responseText}`);
    }
    const result = JSON.parse(responseText, decodeRpcValue) as Readonly<{
      readonly acceptance: TaskWorkerSessionAcceptanceV1;
      readonly settlement: TaskWorkerSessionSettlementV1;
      readonly inputReads: number;
    }>;
    return result;
  } finally {
    await runtime.dispose();
  }
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

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `76000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

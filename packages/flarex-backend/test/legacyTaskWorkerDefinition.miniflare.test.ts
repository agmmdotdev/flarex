import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  decodeCanonicalTaskManifestV1,
  decodeTaskDefinitionRuntimeBindingV1,
  encodeTaskRuntimeEntryPreimageV1,
  encodeTaskRuntimeGroupManifestPreimageV1,
  encodeTaskRuntimeMaterializationSpecPreimageV1,
  encodeTaskRuntimeProjectionModulePreimageV1,
  encodeTaskRuntimeProjectionPreimageV1,
  hashCanonicalTaskManifestV1,
  hashTaskRuntimeEntryFrameV1,
  hashTaskRuntimeEntryRootV1,
  hashTaskRuntimeGroupManifestFrameV1,
  hashTaskRuntimeMaterializationSpecV1,
  hashTaskRuntimeProjectionModuleFrameV1,
  hashTaskRuntimeProjectionModuleRootV1,
  hashTaskRuntimeProjectionFrameV1,
  makeLiveStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { validateTaskComputeDispatchRequestV1 } from
  "@flarex/durable-task/internal/compute-provider-v1";

import {
  makeLegacyTaskWorkerDefinition,
  type LegacyTaskWorkerDefinition,
} from "../src/artifactRuntime/LegacyTaskWorkerDefinition";
import type { TaskRuntimeLaunchSubject } from
  "../src/taskRuntimeLaunch/Model";

const UTF8 = new TextEncoder();
const sha256 = makeLiveStandardApplicationTaskSha256V1();
const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("Legacy task Worker definition", () => {
  it("returns a correlated session acceptance before interruption settlement", async () => {
    const fixture = await legacyFixture(
      "export async function run() { await new Promise(() => {}); }",
    );
    const definition = await buildDefinition(fixture.subject);
    const receipt = await executeSessionDefinition(definition, requestFor(definition));
    expect(receipt).toMatchObject({
      acceptance: {
        kind: "accepted",
        generation: "legacy_dynamic_worker_v1",
        executionId: "execution-1",
        cancellationGeneration: { __bigint: "0" },
      },
      interruption: {
        kind: "interruption_requested",
        cancellationGeneration: { __bigint: "1" },
        reason: "cancellation_requested",
      },
      settlement: {
        kind: "settled",
        outcome: {
          kind: "interrupted",
          interruption: {
            cancellationGeneration: { __bigint: "1" },
            reason: "cancellation_requested",
          },
        },
      },
      payloadDisposals: 1,
    });
  }, 20_000);

  it("does not hide Legacy cleanup uncertainty behind a handler failure", async () => {
    const fixture = await legacyFixture("export function run() { return null; }");
    const definition = await buildDefinition(fixture.subject);
    const receipt = await executeSessionCleanupFailure(
      definition,
      requestFor(definition),
    );
    expect(receipt).toEqual({
      name: "LegacyTaskWorkerCleanupV1Error",
      primaryName: "LegacyTaskWorkerHandlerV1Error",
      cleanupMessage: "legacy input capability dispose failed",
    });
  }, 20_000);

  it("executes canonical Legacy runtime objects without Application authority", async () => {
    const fixture = await legacyFixture([
      "export function run(payload) {",
      "  return { message: payload.message, now: Date.now(), random: Math.random() };",
      "}",
    ].join("\n"));
    const definition = await buildDefinition(fixture.subject);

    const first = await executeDefinition(definition, requestFor(definition), {
      message: "legacy-terminal",
    });
    const second = await executeDefinition(definition, requestFor(definition), {
      message: "legacy-terminal",
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "flarex.legacy-task-worker-result",
      kind: "completed",
      value: { message: "legacy-terminal", now: 0 },
    });
    expect(definition.entrypoint).toBe("FlarexLegacyTaskWorker");
    const entrypoint = definition.modules[definition.mainModule];
    expect(JSON.stringify(entrypoint)).not.toContain(
      "applicationTaskRuntimeTargetSha256",
    );
  }, 20_000);

  it("rejects corrupt object bodies and materialization policy", async () => {
    const fixture = await legacyFixture("export function run() { return null; }");
    const corrupt = fixture.subject.runtimeObjects.map((item, index) => index === 0
      ? { ...item, bytes: new Uint8Array(item.bytes).fill(7) }
      : item);
    const bodyFailure = await Effect.runPromise(makeLegacyTaskWorkerDefinition({
      subject: { ...fixture.subject, runtimeObjects: corrupt },
      hostPolicy: hostPolicy(),
      sha256,
    }).pipe(Effect.flip));
    expect(bodyFailure.reason).toBe("authorityMismatch");

    const policyFailure = await Effect.runPromise(makeLegacyTaskWorkerDefinition({
      subject: fixture.subject,
      hostPolicy: { ...hostPolicy(), runtimeImplementationVersion: "other" },
      sha256,
    }).pipe(Effect.flip));
    expect(policyFailure.reason).toBe("hostPolicyMismatch");

    const dateFailure = await Effect.runPromise(makeLegacyTaskWorkerDefinition({
      subject: fixture.subject,
      hostPolicy: { ...hostPolicy(), admittedCompatibilityDate: "2026-06-15" },
      sha256,
    }).pipe(Effect.flip));
    expect(dateFailure.reason).toBe("hostPolicyMismatch");

    const manifestFailure = await Effect.runPromise(makeLegacyTaskWorkerDefinition({
      subject: {
        ...fixture.subject,
        runtimeBinding: {
          ...fixture.subject.runtimeBinding,
          manifest: {
            ...fixture.subject.runtimeBinding.manifest,
            maximumDurationInSeconds: 29,
          },
        } as TaskDefinitionRuntimeBindingV1,
      },
      hostPolicy: hostPolicy(),
      sha256,
    }).pipe(Effect.flip));
    expect(manifestFailure.reason).toBe("authorityMismatch");

    const embeddedEntryFailure = await Effect.runPromise(
      makeLegacyTaskWorkerDefinition({
        subject: {
          ...fixture.subject,
          runtimeBinding: {
            ...fixture.subject.runtimeBinding,
            taskRuntimeEntry: {
              ...fixture.subject.runtimeBinding.taskRuntimeEntry,
              exportName: "other",
            },
          } as TaskDefinitionRuntimeBindingV1,
        },
        hostPolicy: hostPolicy(),
        sha256,
      }).pipe(Effect.flip),
    );
    expect(embeddedEntryFailure.reason).toBe("invalidLaunchSubject");

    const duplicateProfileFailure = await Effect.runPromise(
      makeLegacyTaskWorkerDefinition({
        subject: fixture.subject,
        hostPolicy: {
          ...hostPolicy(),
          computeProfiles: [
            hostPolicy().computeProfiles[0]!,
            { ...hostPolicy().computeProfiles[0]!, cpuMilliseconds: 1 },
          ],
        },
        sha256,
      }).pipe(Effect.flip),
    );
    expect(duplicateProfileFailure.reason).toBe("hostPolicyMismatch");
  });

  it("keeps Legacy input and definition failures in the Legacy error family", async () => {
    const fixture = await legacyFixture("export const wrong = true;");
    const definition = await buildDefinition(fixture.subject);
    const missingExport = await executeDefinitionFailure(
      definition,
      requestFor(definition),
      Object.freeze({ read() { return null; } }),
    );
    expect(missingExport.name).toBe("LegacyTaskWorkerDefinitionV1Error");

    const invalidCapability = await executeDefinitionFailure(
      definition,
      requestFor(definition),
      Object.freeze({}),
    );
    expect(invalidCapability.name).toBe("LegacyTaskWorkerInputBoundaryV1Error");
  }, 20_000);

  it("admits a canonical compute profile beyond index 63", async () => {
    const profiles = Array.from(
      { length: 65 },
      (_, index) => `profile-${String(index).padStart(3, "0")}`,
    );
    const fixture = await legacyFixture(
      "export function run() { return 'profile-64'; }",
      profiles[64]!,
      profiles,
    );
    const definition = await Effect.runPromise(makeLegacyTaskWorkerDefinition({
      subject: fixture.subject,
      hostPolicy: {
        ...hostPolicy(),
        computeProfiles: profiles.map(computeProfile => ({
          computeProfile,
          cpuMilliseconds: 10_000,
          maximumDurationMs: 60_000,
        })),
      },
      sha256,
    }));
    expect(definition.computeProfile).toBe("profile-064");
  });
});

async function legacyFixture(
  source: string,
  selectedComputeProfile = "standard-1x",
  supportedComputeProfiles: ReadonlyArray<string> = [selectedComputeProfile],
): Promise<Readonly<{
  readonly subject: TaskRuntimeLaunchSubject;
}>> {
  const sourceBytes = UTF8.encode(source);
  const sourceSha256 = await digest(sourceBytes);
  const moduleFrame = {
    kind: "runtime_projection_module" as const,
    group: "durable_task" as const,
    moduleOrdinal: 0n,
    artifactModulePath: "tasks/orders.js",
    sourceRoles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION |
      SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
    sourceEnvironment: "isolate" as const,
    moduleFormat: "es_module" as const,
    rawByteLength: BigInt(sourceBytes.byteLength),
    sourceSha256,
    sourceBytes,
  };
  const modules = await Effect.runPromise(
    hashTaskRuntimeProjectionModuleRootV1([moduleFrame], sha256),
  );
  const projection = {
    kind: "task_runtime_projection" as const,
    group: "durable_task" as const,
    executionModule: moduleFrame.artifactModulePath,
    moduleCount: 1n,
    rawByteLength: BigInt(sourceBytes.byteLength),
    moduleRootSha256: modules.moduleRootSha256,
  };
  const projectionSha256 = await Effect.runPromise(
    hashTaskRuntimeProjectionFrameV1(projection, sha256),
  );
  const manifest = Result.getOrThrow(decodeCanonicalTaskManifestV1({
    version: 1,
    taskId: "tasks.orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: moduleFrame.artifactModulePath,
      exportName: "run",
    },
    payloadValidator: { type: "any" },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 30,
    computeProfile: selectedComputeProfile,
    queue: { kind: "default" },
  }));
  const canonicalTaskManifestSha256 = await Effect.runPromise(
    hashCanonicalTaskManifestV1(manifest, sha256),
  );
  const entry = {
    kind: "task_runtime_entry" as const,
    taskOrdinal: 0n,
    taskId: manifest.taskId,
    canonicalTaskManifestSha256,
    logicalExecutionModule: manifest.handler.logicalModulePath,
    artifactExecutionModule: manifest.handler.artifactModulePath,
    exportName: manifest.handler.exportName,
    group: "durable_task" as const,
    projectionSha256,
  };
  const taskRuntimeEntrySha256 = await Effect.runPromise(
    hashTaskRuntimeEntryFrameV1(entry, sha256),
  );
  const taskEntryRootSha256 = await Effect.runPromise(
    hashTaskRuntimeEntryRootV1([entry], sha256),
  );
  const materialization = {
    kind: "task_runtime_materialization_spec" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    compatibilityDate: "2026-06-14",
    compatibilityFlags: ["nodejs_compat"],
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    supportedComputeProfiles,
    moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  };
  const taskRuntimeMaterializationSpecSha256 = await Effect.runPromise(
    hashTaskRuntimeMaterializationSpecV1(materialization, sha256),
  );
  const taskCatalogSha256 = seededDigest(0x13);
  const group = {
    kind: "task_runtime_group_manifest" as const,
    taskCatalogSha256,
    taskCount: 1n,
    taskEntryRootSha256,
    taskRuntimeProjectionSha256: projectionSha256,
    taskRuntimeMaterializationSpecSha256,
  };
  const taskRuntimeGroupManifestSha256 = await Effect.runPromise(
    hashTaskRuntimeGroupManifestFrameV1(group, sha256),
  );
  const bodies = [
    ["runtime_projection_module", Result.getOrThrow(
      encodeTaskRuntimeProjectionModulePreimageV1(moduleFrame),
    ), modules.moduleFrameSha256[0]!],
    ["task_runtime_projection", Result.getOrThrow(
      encodeTaskRuntimeProjectionPreimageV1(projection),
    ), projectionSha256],
    ["task_runtime_entry", Result.getOrThrow(
      encodeTaskRuntimeEntryPreimageV1(entry),
    ), taskRuntimeEntrySha256],
    ["task_runtime_group_manifest", Result.getOrThrow(
      encodeTaskRuntimeGroupManifestPreimageV1(group),
    ), taskRuntimeGroupManifestSha256],
    ["task_runtime_materialization_spec", Result.getOrThrow(
      encodeTaskRuntimeMaterializationSpecPreimageV1(materialization),
    ), taskRuntimeMaterializationSpecSha256],
  ] as const;
  const references = bodies.map(([role, bytes, digestValue]) =>
    runtimeReference(role, bytes, digestValue)
  );
  const binding: TaskDefinitionRuntimeBindingV1 = Result.getOrThrow(
    decodeTaskDefinitionRuntimeBindingV1({
      version: 1,
      applicationRevisionId: "application-revision",
      candidateSha256: seededDigest(1),
      applicationRevisionTaskBindingSha256: seededDigest(2),
      taskId: manifest.taskId,
      manifest,
      canonicalTaskManifestSha256,
      taskRuntimeEntrySha256,
      taskRuntimeEntry: entry,
      taskCatalogSha256,
      taskEntryRootSha256,
      taskRuntimeProjectionSha256: projectionSha256,
      taskRuntimeGroupManifestSha256,
      taskRuntimeMaterializationSpecSha256,
      packageSha256: seededDigest(3),
      artifactSha256: seededDigest(4),
      sourceRootSha256: seededDigest(5),
      semanticRootSha256: seededDigest(6),
      runtimeObjects: references,
    }),
  );
  const request = Result.getOrThrow(validateTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: identity(),
    taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: 30_000,
  }));
  return Object.freeze({
    subject: Object.freeze({
      request,
      runtimeBinding: binding,
      runtimeObjects: Object.freeze(bodies.map(([role, bytes], index) =>
        Object.freeze({ reference: references[index]!, bytes })
      )),
      input: Object.freeze({
        reference: Object.freeze({}) as TaskRuntimeLaunchSubject["input"]["reference"],
        read: () => Effect.succeed(new Uint8Array()),
      }),
    }),
  });
}

function hostPolicy() {
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

function buildDefinition(subject: TaskRuntimeLaunchSubject) {
  return Effect.runPromise(makeLegacyTaskWorkerDefinition({
    subject,
    hostPolicy: hostPolicy(),
    sha256,
  }));
}

function requestFor(definition: LegacyTaskWorkerDefinition) {
  return {
    format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
    version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      version: "flarex.task-compute-dispatch-request.v1",
      identity: identity(),
      taskDefinitionRevisionId: definition.taskDefinitionRevisionId,
      attemptNumber: 1,
      leaseVersion: 1n,
      computeProfile: definition.computeProfile,
      cancellation: { kind: "not_requested", generation: 0n },
      maximumDurationMs: 30_000,
    },
  };
}

async function executeDefinition(
  definition: LegacyTaskWorkerDefinition,
  request: unknown,
  payload: unknown,
): Promise<unknown> {
  const encoded = JSON.stringify({ request, payload }, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    return value;
  });
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify({
    compatibilityDate: definition.compatibilityDate,
    compatibilityFlags: definition.compatibilityFlags,
    limits: definition.limits,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: null,
  })};
const input = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
class Input extends RpcTarget { read() { return structuredClone(input.payload); } }
export default { async fetch(_request, env) {
  const worker = env.LOADER.load(code);
  const result = await worker.getEntrypoint(${JSON.stringify(definition.entrypoint)})
    .run(input.request, new Input());
  try { return new Response(JSON.stringify(structuredClone(result), (_key, value) =>
    typeof value === "bigint" ? { __bigint: String(value) } : value),
    { headers: { "content-type": "application/json" } }); }
  finally { result[Symbol.dispose]?.(); }
} };`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://legacy-task.test/");
  const text = await response.text();
  if (!response.ok) throw new Error(`Legacy Worker failed: ${text}`);
  return JSON.parse(text);
}

async function executeSessionDefinition(
  definition: LegacyTaskWorkerDefinition,
  request: unknown,
): Promise<unknown> {
  const encoded = JSON.stringify(request, (_key, value: unknown) =>
    typeof value === "bigint" ? { __bigint: String(value) } : value
  );
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify({
    compatibilityDate: definition.compatibilityDate,
    compatibilityFlags: definition.compatibilityFlags,
    limits: definition.limits,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: null,
  })};
const request = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
globalThis.payloadDisposals = 0;
class Payload extends RpcTarget {
  [Symbol.dispose]() { globalThis.payloadDisposals += 1; }
}
class Input extends RpcTarget {
  async read() { await scheduler.wait(50); return new Payload(); }
}
export default { async fetch(_request, env) {
  const worker = env.LOADER.load(code);
  const session = await worker.getEntrypoint(${JSON.stringify(definition.entrypoint)})
    .start({ format: "flarex.task-worker-session-start", version: 1,
      generation: "legacy_dynamic_worker_v1", executionId: "execution-1", request },
      new Input());
  try {
    const acceptance = await session.acceptance();
    await scheduler.wait(10);
    const interruption = await session.requestInterruption({
      format: "flarex.task-worker-session-interruption", version: 1,
      generation: acceptance.generation, identity: acceptance.identity,
      executionId: acceptance.executionId, cancellationGeneration: 1n,
      reason: "cancellation_requested",
    });
    const settlement = await session.settlement();
    await scheduler.wait(75);
    return new Response(JSON.stringify({ acceptance, interruption, settlement,
      payloadDisposals: globalThis.payloadDisposals },
      (_key, value) => typeof value === "bigint"
        ? { __bigint: String(value) } : value),
      { headers: { "content-type": "application/json" } });
  } finally { session[Symbol.dispose]?.(); }
} };`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://legacy-session.test/");
  const body = await response.json();
  if (!response.ok) throw new Error(`Legacy session failed: ${JSON.stringify(body)}`);
  return body;
}

async function executeSessionCleanupFailure(
  definition: LegacyTaskWorkerDefinition,
  request: unknown,
): Promise<unknown> {
  const requestJson = JSON.stringify(request, (_key, value: unknown) =>
    typeof value === "bigint" ? { __bigint: String(value) } : value
  );
  const outerSource = `
import { startLegacyTaskWorkerSessionV1 } from "./core.js";
const request = JSON.parse(${JSON.stringify(requestJson)}, (_key, value) =>
  value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
export default { async fetch() {
  const session = await startLegacyTaskWorkerSessionV1({
    startRequest: { format: "flarex.task-worker-session-start", version: 1,
      generation: "legacy_dynamic_worker_v1", executionId: "execution-1", request },
    capability: {
      read() { return null; },
      [Symbol.dispose]() { throw new Error("legacy input capability dispose failed"); },
    },
    definition: {
      taskDefinitionRevisionId: ${JSON.stringify(definition.taskDefinitionRevisionId)},
      handlerExportName: "run",
      manifest: { payloadValidator: { type: "any" }, outputValidator: null,
        computeProfile: ${JSON.stringify(definition.computeProfile)} },
    },
    loadExecution: async () => ({ run() { throw new Error("handler failed"); } }),
  });
  try {
    await session.settlement();
    return Response.json({ name: "must-not-succeed" });
  } catch (error) {
    return Response.json({
      name: error?.name,
      primaryName: error?.cause?.primaryFailure?.name ?? null,
      cleanupMessage: error?.cause?.cleanupFailure?.message,
    });
  }
} };`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "test.js", contents: outerSource }, {
      type: "ESModule",
      path: "core.js",
      contents: (definition.modules[Object.keys(definition.modules).find(key =>
        key.includes("_core.js"))!] as { readonly js: string }).js,
    }],
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://legacy-cleanup-session.test/");
  return await response.json();
}

async function executeDefinitionFailure(
  definition: LegacyTaskWorkerDefinition,
  request: unknown,
  capability: Readonly<Record<string, unknown>>,
): Promise<Readonly<{ readonly name?: string }>> {
  const requestJson = JSON.stringify(request, (_key, value: unknown) =>
    typeof value === "bigint" ? { __bigint: String(value) } : value
  );
  const outerSource = `
import { executeLegacyTaskWorkerV1 } from "./core.js";
const request = JSON.parse(${JSON.stringify(requestJson)}, (_key, value) =>
  value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
export default { async fetch() {
  try {
    await executeLegacyTaskWorkerV1({
      request,
      capability: ${Object.hasOwn(capability, "read")
        ? "{ read() { return null; } }"
        : "{}"},
      definition: {
        taskDefinitionRevisionId: ${JSON.stringify(definition.taskDefinitionRevisionId)},
        handlerExportName: "run",
        manifest: { payloadValidator: { type: "any" }, outputValidator: null,
          computeProfile: ${JSON.stringify(definition.computeProfile)} },
      },
      loadExecution: async () => ({ wrong: true }),
    });
    return Response.json({ name: "must-not-succeed" });
  } catch (error) { return Response.json({ name: error?.name }); }
} };`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "test.js", contents: outerSource }, {
      type: "ESModule",
      path: "core.js",
      contents: (definition.modules[Object.keys(definition.modules).find(key =>
        key.includes("_core.js"))!] as { readonly js: string }).js,
    }],
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://legacy-failure.test/");
  return await response.json() as Readonly<{ readonly name?: string }>;
}

function runtimeReference(
  role: TaskRuntimeObjectRoleV1,
  bytes: Uint8Array,
  sha256Value: TaskDefinitionSha256V1,
): TaskRuntimeObjectReferenceV1 {
  return {
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(role, Buffer.from(sha256Value).toString("hex")),
    byteLength: BigInt(bytes.byteLength),
    sha256: sha256Value,
  };
}

async function digest(bytes: Uint8Array): Promise<TaskDefinitionSha256V1> {
  return await Effect.runPromise(sha256(bytes, {
    maximumInputBytes: bytes.byteLength,
  })) as TaskDefinitionSha256V1;
}

function seededDigest(seed: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(seed) as TaskDefinitionSha256V1;
}

function identity() {
  return {
    version: "flarex.task-compute-dispatch-identity.v1",
    scopeId: "scope_00000000-0000-4000-8000-000000000001",
    runId: "run_00000000-0000-4000-8000-000000000002",
    requestedEffectSequence: 1n,
    attemptId: "attempt_00000000-0000-4000-8000-000000000003",
    executionFence: 1n,
  };
}

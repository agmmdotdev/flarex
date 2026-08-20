import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/application-task-worker-v1";
import { Effect, Result } from "effect";
import {
  decodeApplicationTaskRuntimeTargetV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  decodeCanonicalTaskManifestV1,
  encodeCanonicalTaskManifestPreimageV1,
  makeLiveStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";

import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "../src/artifactRuntime/ApplicationRuntimeMaterializer";
import {
  APPLICATION_TASK_WORKER_ENTRYPOINT,
  makeApplicationTaskWorkerDefinition,
  type ApplicationTaskWorkerDefinition,
  type ApplicationTaskWorkerHostPolicy,
} from "../src/artifactRuntime/ApplicationTaskWorkerDefinition";
import { APPLICATION_WORKER_CORE_SOURCE } from
  "../src/artifactRuntime/ApplicationWorkerCore.generated";
import type { ApplicationAnalysisSourceBundle } from
  "../src/sourceArtifactV2/ApplicationAnalysisReader";

const instances: Miniflare[] = [];
const sha256 = makeLiveStandardApplicationTaskSha256V1();

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("Application task Worker definition", () => {
  it("returns a correlated session acceptance before interruption settlement", async () => {
    const definition = await buildDefinition(taskFixture(
      "export async function run() { await new Promise(() => {}); }",
    ));
    const receipt = await executeSessionDefinition(
      definition,
      requestFor(definition),
    );
    expect(receipt).toMatchObject({
      acceptance: {
        kind: "accepted",
        generation: "application_v1",
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

  it.each([
    ["export function run() { return null; }", "completed", undefined],
    ["export function run() { throw new Error('private'); }", "failed", "handler_failed"],
  ] as const)(
    "returns an exact %s terminal session outcome",
    async (handlerSource, outcomeKind, failureCode) => {
      const definition = await buildDefinition(taskFixture(handlerSource));
      const settlement = await executeTerminalSessionDefinition(
        definition,
        requestFor(definition),
        null,
      ) as {
        readonly outcome: {
          readonly kind: string;
          readonly failure?: { readonly code: string; readonly message: null };
        };
      };
      expect(settlement.outcome.kind).toBe(outcomeKind);
      if (failureCode !== undefined) {
        expect(settlement.outcome.failure).toEqual({
          code: failureCode,
          message: null,
        });
      }
    },
    20_000,
  );

  it("keeps post-execution capability cleanup failure out of terminal data", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const definition = await buildDefinition(fixture);
    const receipt = await executeSessionCapabilityCleanupFailure(
      definition,
      fixture.manifest,
      requestFor(definition),
    );
    expect(receipt).toEqual({
      name: "ApplicationTaskWorkerCleanupV1Error",
      primaryName: null,
      cleanupMessage: "input capability dispose failed",
    });
  }, 20_000);

  it("does not hide cleanup uncertainty behind a handler failure", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const definition = await buildDefinition(fixture);
    const receipt = await executeSessionCapabilityCleanupFailure(
      definition,
      fixture.manifest,
      requestFor(definition),
      true,
    );
    expect(receipt).toEqual({
      name: "ApplicationTaskWorkerCleanupV1Error",
      primaryName: "ApplicationTaskWorkerHandlerV1Error",
      cleanupMessage: "input capability dispose failed",
    });
  }, 20_000);

  it("keeps unexpected trusted-runtime defects out of terminal data", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const definition = await buildDefinition(fixture);
    const receipt = await executeSessionUnexpectedDefect(
      definition,
      fixture.manifest,
      requestFor(definition),
    );
    expect(receipt).toEqual({ name: "ApplicationTaskWorkerDefectV1Error" });
  }, 20_000);

  it("disposes the duplicated capability when a second start is rejected", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const definition = await buildDefinition(fixture);
    const receipt = await executeDuplicateSessionStart(
      definition,
      fixture.manifest,
      requestFor(definition),
    );
    expect(receipt).toEqual({
      disposals: 6,
      secondName: "ApplicationTaskWorkerInvalidRequestV1Error",
    });
  }, 20_000);

  it("executes only the selected plain export with deterministic globals", async () => {
    const fixture = taskFixture([
      "const importedNow = Date.now();",
      "const importedRandom = Math.random();",
      "export function run(_ctx, payload) {",
      "  return { payload, importedNow, importedRandom, now: Date.now(), random: Math.random(), performance: performance.now() };",
      "}",
      "export function ignored() { throw new Error('wrong export'); }",
    ].join("\n"));
    const definition = await buildDefinition(fixture);

    const first = await executeDefinition(definition, requestFor(definition), { name: "Ada" });
    const second = await executeDefinition(definition, requestFor(definition), { name: "Ada" });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "flarex.application-task-worker-result",
      version: 1,
      kind: "completed",
      value: {
        payload: { name: "Ada" },
        importedNow: 0,
        now: 0,
        performance: 0,
      },
    });
    expect(first).toHaveProperty("disposals", 1);
  }, 20_000);

  it("exposes only a query callback context to the genuine Application task Worker", async () => {
    const fixture = taskFixture([
      "export async function run(ctx, payload) {",
      "  return await ctx.runQuery('users:get', payload);",
      "}",
    ].join("\n"));
    const definition = await buildDefinition(fixture);

    await expect(executeDefinition(
      definition,
      requestFor(definition),
      { orderId: "order-query" },
      true,
    )).resolves.toMatchObject({
      value: { orderId: "order-query" },
      queryPath: "users:get",
    });
  }, 20_000);

  it("exposes a sequential mutation callback only to the Application task Worker", async () => {
    const fixture = taskFixture([
      "export async function run(ctx, payload) {",
      "  const first = await ctx.runMutation('orders:update', payload);",
      "  return await ctx.runMutation('orders:audit', first);",
      "}",
    ].join("\n"));
    const definition = await buildDefinition(fixture);

    await expect(executeDefinition(
      definition,
      requestFor(definition),
      { orderId: "order-mutation" },
      false,
      true,
    )).resolves.toMatchObject({
      value: { orderId: "order-mutation" },
      mutationCalls: [
        { ordinal: { __bigint: "1" }, path: "orders:update" },
        { ordinal: { __bigint: "2" }, path: "orders:audit" },
      ],
    });
  }, 20_000);

  it("does not consume a mutation ordinal for a locally invalid request", async () => {
    const fixture = taskFixture([
      "export async function run(ctx, payload) {",
      "  try { await ctx.runMutation('', payload); } catch {}",
      "  return await ctx.runMutation('orders:update', payload);",
      "}",
    ].join("\n"));
    const definition = await buildDefinition(fixture);

    await expect(executeDefinition(
      definition,
      requestFor(definition),
      { orderId: "order-valid-after-local-rejection" },
      false,
      true,
    )).resolves.toMatchObject({
      mutationCalls: [
        { ordinal: { __bigint: "1" }, path: "orders:update" },
      ],
    });
  }, 20_000);

  it("drains a fire-and-forget mutation before reporting Task completion", async () => {
    const fixture = taskFixture([
      "export function run(ctx, payload) {",
      "  void ctx.runMutation('orders:update', payload);",
      "  return payload;",
      "}",
    ].join("\n"));
    const definition = await buildDefinition(fixture);

    await expect(executeDefinition(
      definition,
      requestFor(definition),
      { orderId: "order-fire-and-forget" },
      false,
      true,
      "delayed_failure",
    )).rejects.toThrow("ApplicationTaskWorkerMutationBoundaryV1Error");
  }, 20_000);

  it("rejects payload and output validator violations", async () => {
    const fixture = taskFixture(
      "export function run(_ctx, payload) { return payload.name.length; }",
      { type: "object", value: {
        name: { fieldType: { type: "string" }, optional: false },
      } },
      { type: "string" },
    );
    const definition = await buildDefinition(fixture);

    const inputFailure = await executeDefinition(
      definition,
      requestFor(definition),
      { wrong: "secret-input-must-not-cross" },
    ).then(() => "must-not-succeed", error => String(error));
    expect(inputFailure).toContain("ApplicationTaskWorkerInputValidationV1Error");
    expect(inputFailure).toContain("missingRequiredField");
    expect(inputFailure).not.toContain("secret-input-must-not-cross");

    const outputFailure = await executeDefinition(
      definition,
      requestFor(definition),
      { name: "Ada" },
    ).then(() => "must-not-succeed", error => String(error));
    expect(outputFailure).toContain("ApplicationTaskWorkerOutputValidationV1Error");
    expect(outputFailure).toContain("typeMismatch");
    expect(outputFailure).not.toContain("Ada");
  }, 20_000);

  it("classifies returned payload disposal failure at the input boundary", async () => {
    const fixture = taskFixture(
      "export function run(_ctx, payload) { return payload; }",
    );
    const definition = await buildDefinition(fixture);
    for (const invalidPayload of [false, true]) {
      const response = await executeDisposalFailure(
        definition,
        fixture.manifest,
        requestFor(definition),
        invalidPayload,
      );
      expect(response).toMatchObject({
        name: "ApplicationTaskWorkerCleanupV1Error",
        ...(invalidPayload
          ? {
            primaryName: "ApplicationTaskWorkerInputValidationV1Error",
            primaryCauseName: "ApplicationTaskWorkerContractV1Error",
            primaryCauseReason: "invalid_value",
          }
          : { primaryName: null }),
        cleanupMessage: "payload dispose failed",
      });
    }
  }, 20_000);

  it("embeds canonical definition JSON through JSON.parse", async () => {
    const definition = await buildDefinition(taskFixture(
      "export function run() { return null; }",
    ));
    const entrypoint = definition.modules[definition.mainModule];
    expect(entrypoint).toBeTypeOf("object");
    expect((entrypoint as { readonly js: string }).js)
      .toContain("const definition = Object.freeze(JSON.parse(");
  });

  it("disposes the input duplicate when query-capability duplication fails", async () => {
    const definition = await buildDefinition(taskFixture(
      "export function run() { return null; }",
    ));
    const entrypoint = definition.modules[definition.mainModule];
    expect(entrypoint).toBeTypeOf("object");
    const Entrypoint = evaluateGeneratedEntrypoint(
      (entrypoint as { readonly js: string }).js,
    );
    const queryFailure = new Error("query duplication failed");
    let inputDisposals = 0;
    const input = { dup: () => ({
      [Symbol.dispose]: () => { inputDisposals += 1; },
    }) };
    const query = { dup: () => { throw queryFailure; } };

    await expect(new Entrypoint().start({}, input, query, {})).rejects.toBe(queryFailure);
    expect(inputDisposals).toBe(1);
  });

  it("preserves duplication and cleanup causes when both operations fail", async () => {
    const definition = await buildDefinition(taskFixture(
      "export function run() { return null; }",
    ));
    const entrypoint = definition.modules[definition.mainModule];
    expect(entrypoint).toBeTypeOf("object");
    const Entrypoint = evaluateGeneratedEntrypoint(
      (entrypoint as { readonly js: string }).js,
    );
    const queryFailure = new Error("query duplication failed");
    const cleanupFailure = new Error("input cleanup failed");
    const input = { dup: () => ({
      [Symbol.dispose]: () => { throw cleanupFailure; },
    }) };
    const query = { dup: () => { throw queryFailure; } };

    await expect(new Entrypoint().start({}, input, query, {})).rejects.toMatchObject({
      cause: {
        queryCapabilityFailure: queryFailure,
        inputCapabilityCleanupFailure: cleanupFailure,
      },
    });
  });

  it("disposes earlier duplicates when mutation-capability duplication fails", async () => {
    const definition = await buildDefinition(taskFixture(
      "export function run() { return null; }",
    ));
    const entrypoint = definition.modules[definition.mainModule];
    expect(entrypoint).toBeTypeOf("object");
    const Entrypoint = evaluateGeneratedEntrypoint(
      (entrypoint as { readonly js: string }).js,
    );
    const mutationFailure = new Error("mutation duplication failed");
    const disposals: string[] = [];
    const input = { dup: () => ({
      [Symbol.dispose]: () => { disposals.push("input"); },
    }) };
    const query = { dup: () => ({
      [Symbol.dispose]: () => { disposals.push("query"); },
    }) };
    const mutation = { dup: () => { throw mutationFailure; } };

    await expect(new Entrypoint().start({}, input, query, mutation)).rejects
      .toBe(mutationFailure);
    expect(disposals).toEqual(["query", "input"]);
  });

  it("fails closed on forbidden import-time capability use", async () => {
    const fixture = taskFixture([
      "try { crypto.randomUUID(); } catch {}",
      "export function run() { return 'must-not-run'; }",
    ].join("\n"));
    const definition = await buildDefinition(fixture);

    await expect(executeDefinition(definition, requestFor(definition), null))
      .rejects.toThrow("ApplicationTaskWorkerDefinitionV1Error");
  }, 20_000);

  it("rejects an oversized output under the task result ceiling", async () => {
    const fixture = taskFixture(
      "export function run(_ctx, payload) { return 'x'.repeat(payload.size); }",
    );
    const definition = await buildDefinition(fixture);
    await expect(executeDefinition(
      definition,
      requestFor(definition),
      { size: 8 * 1_048_576 },
    )).rejects.toThrow("ApplicationTaskWorkerOutputValidationV1Error");
  }, 20_000);

  it("rejects mismatched source and runtime-host authority before loading", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const hostFailure = await Effect.runPromise(buildDefinitionEffect({
      ...fixture,
      hostPolicy: {
        ...fixture.hostPolicy,
        runtimeHostIdentity: "wrong-host",
      } as ApplicationTaskWorkerHostPolicy,
    }).pipe(Effect.flip));
    expect(hostFailure.reason).toBe("hostPolicyMismatch");
    const sourceFailure = await Effect.runPromise(buildDefinitionEffect({
      ...fixture,
      source: {
        ...fixture.source,
        modules: fixture.source.modules.filter(
          module => module.path !== fixture.target.handler.sourceModulePath,
        ),
      },
    }).pipe(Effect.flip));
    expect(sourceFailure.reason).toBe("authorityMismatch");
  });

  it("recomputes manifest and runtime-target digests before definition", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const targetFailure = await Effect.runPromise(buildDefinitionEffect({
      ...fixture,
      runtimeTargetSha256: new Uint8Array(32).fill(9),
    }).pipe(Effect.flip));
    expect(targetFailure.reason).toBe("authorityMismatch");

    const manifestFailure = await Effect.runPromise(buildDefinitionEffect({
      ...fixture,
      manifest: { ...fixture.manifest, computeProfile: "standard-2x" } as unknown,
    }).pipe(Effect.flip));
    expect(manifestFailure.reason).toBe("authorityMismatch");
  });

  it("captures definition inputs before asynchronous hashing", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const mutableDigest = new Uint8Array(fixture.runtimeTargetSha256);
    const mutableProfiles: Array<{
      computeProfile: string;
      cpuMilliseconds: number;
      maximumDurationMs: number;
    }> = fixture.hostPolicy.computeProfiles.map(profile => ({ ...profile }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const gatedSha256 = (...args: Parameters<typeof sha256>) => {
      calls += 1;
      return Effect.promise(async () => {
        if (calls === 1) await gate;
        return await Effect.runPromise(sha256(...args));
      });
    };
    const pending = Effect.runPromise(makeApplicationTaskWorkerDefinition({
      ...fixture,
      runtimeTargetSha256: mutableDigest,
      hostPolicy: { ...fixture.hostPolicy, computeProfiles: mutableProfiles },
      sha256: gatedSha256,
    }));
    await Promise.resolve();
    mutableDigest.fill(9);
    mutableProfiles[0]!.cpuMilliseconds = 1;
    release();
    const definition = await pending;
    expect(definition.runtimeTargetSha256Hex)
      .toBe(Buffer.from(fixture.runtimeTargetSha256).toString("hex"));
    expect(definition.limits.cpuMs).toBe(10_000);
  });

  it("freezes every authenticated module descriptor", async () => {
    const definition = await buildDefinition(taskFixture(
      "export function run() { return 'original'; }",
    ));
    const selected = Object.values(definition.modules).find(module =>
      typeof module === "object" && module !== null &&
      "js" in module && module.js.includes("return 'original'")
    );
    expect(selected).toBeDefined();
    expect(Object.isFrozen(selected)).toBe(true);
    expect(() => {
      (selected as { js: string }).js =
        "export function run() { return 'replaced'; }";
    }).toThrow();
    await expect(executeDefinition(
      definition,
      requestFor(definition),
      null,
    )).resolves.toMatchObject({ value: "original" });
  }, 20_000);

  it("derives limits from the admitted profile and duration policy", async () => {
    const fixture = taskFixture(
      "export function run() { return null; }",
      { type: "any" },
      null,
      { computeProfile: "standard-2x", maximumDurationInSeconds: 45 },
    );
    const definition = await buildDefinition({
      ...fixture,
      hostPolicy: {
        ...fixture.hostPolicy,
        computeProfiles: [{
          computeProfile: "standard-2x",
          cpuMilliseconds: 20_000,
          maximumDurationMs: 60_000,
        }],
      } satisfies ApplicationTaskWorkerHostPolicy,
    });
    expect(definition.computeProfile).toBe("standard-2x");
    expect(definition.limits).toEqual({ cpuMs: 20_000, subRequests: 0 });
    expect(definition.wallMilliseconds).toBe(45_000);

    for (const hostPolicy of [
      { ...fixture.hostPolicy, computeProfiles: [] },
      {
        ...fixture.hostPolicy,
        computeProfiles: [{
          computeProfile: "standard-2x",
          cpuMilliseconds: 20_000,
          maximumDurationMs: 30_000,
        }],
      },
    ] satisfies ReadonlyArray<ApplicationTaskWorkerHostPolicy>) {
      const failure = await Effect.runPromise(buildDefinitionEffect({
        ...fixture,
        hostPolicy,
      }).pipe(Effect.flip));
      expect(["unsupportedComputeProfile", "unsupportedDuration"])
        .toContain(failure.reason);
    }
  });

  it("rejects malformed runtime host policy through the typed channel", async () => {
    const fixture = taskFixture("export function run() { return null; }");
    const throwingProfiles = new Proxy([], {
      ownKeys() { throw new Error("ownKeys trap"); },
      get(_target, key) {
        if (key === Symbol.iterator) throw new Error("iterator trap");
        return Reflect.get(_target, key);
      },
    });
    const throwingIndex = [fixture.hostPolicy.computeProfiles[0]];
    Object.defineProperty(throwingIndex, "0", {
      enumerable: true,
      get() { throw new Error("index getter"); },
    });
    for (const hostPolicy of [
      {
        ...fixture.hostPolicy,
        computeProfiles: [{
          computeProfile: null,
          cpuMilliseconds: 10_000,
          maximumDurationMs: 30_000,
        }],
      },
      {
        ...fixture.hostPolicy,
        computeProfiles: [null],
      },
      { ...fixture.hostPolicy, computeProfiles: throwingProfiles },
      { ...fixture.hostPolicy, computeProfiles: throwingIndex },
    ]) {
      const failure = await Effect.runPromise(
        makeApplicationTaskWorkerDefinition({
          ...fixture,
          hostPolicy: hostPolicy as unknown as ApplicationTaskWorkerHostPolicy,
          sha256,
        }).pipe(Effect.flip),
      );
      expect(failure).toMatchObject({
        _tag: "ApplicationTaskWorkerDefinitionError",
      });
      expect(["hostPolicyMismatch", "unsupportedComputeProfile"])
        .toContain(failure.reason);
    }
  });
});

function taskFixture(
  handlerSource: string,
  payloadValidator: unknown = { type: "any" },
  outputValidator: unknown = null,
  policy: Readonly<{
    readonly computeProfile: string;
    readonly maximumDurationInSeconds: number;
  }> = Object.freeze({
    computeProfile: "standard-1x",
    maximumDurationInSeconds: 30,
  }),
) {
  const execution = "export {};\n";
  const modules = Object.freeze([
    Object.freeze({
      path: "_flarex/application.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "b".repeat(64),
      sourceByteLength: new TextEncoder().encode(execution).byteLength,
      source: execution,
    }),
    Object.freeze({
      path: "tasks/orders.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceSha256: "c".repeat(64),
      sourceByteLength: new TextEncoder().encode(handlerSource).byteLength,
      source: handlerSource,
    }),
  ]);
  const sourceArtifact = Object.freeze({
    rootSha256: "a".repeat(64),
    executionModulePath: "_flarex/application.js",
    schemaModulePath: null,
    modules: Object.freeze(modules.map(module => Object.freeze({
      path: module.path,
      roles: module.roles,
      sourceSha256: module.sourceSha256,
      sourceByteLength: module.sourceByteLength,
    }))),
  });
  const source: ApplicationAnalysisSourceBundle = Object.freeze({
    sourceArtifact,
    modules,
  });
  const manifest = Result.getOrThrow(decodeCanonicalTaskManifestV1({
    version: 1,
    taskId: "tasks.orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator,
    outputValidator,
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
    maximumDurationInSeconds: policy.maximumDurationInSeconds,
    computeProfile: policy.computeProfile,
    queue: { kind: "default" },
  }));
  const canonicalTaskManifestSha256 = digest(Result.getOrThrow(
    encodeCanonicalTaskManifestPreimageV1(manifest),
  ));
  const target = Result.getOrThrow(decodeApplicationTaskRuntimeTargetV1({
    version: 1,
    scopeId: "scope_00000000-0000-4000-8000-000000000001",
    revisionId: "revision",
    candidateId: "candidate",
    analysisId: "analysis",
    sourceArtifactRootSha256: sourceArtifact.rootSha256,
    publicationSha256: "d".repeat(64),
    applicationTaskCatalogBindingSha256: new Uint8Array(32).fill(1),
    applicationTaskDefinitionBindingSha256: new Uint8Array(32).fill(2),
    taskCatalogSha256: new Uint8Array(32).fill(3),
    taskId: manifest.taskId,
    canonicalTaskManifestSha256,
    handler: {
      logicalModulePath: manifest.handler.logicalModulePath,
      sourceModulePath: manifest.handler.artifactModulePath,
      exportName: manifest.handler.exportName,
    },
    runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
    compatibilityDate: "2026-06-14",
  }));
  const runtimeTargetSha256 = digest(Result.getOrThrow(
    encodeApplicationTaskRuntimeTargetPreimageV1(target),
  ));
  return Object.freeze({
    source,
    target,
    runtimeTargetSha256,
    manifest,
    hostPolicy: Object.freeze({
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: "2026-06-14",
      computeProfiles: Object.freeze([Object.freeze({
        computeProfile: "standard-1x",
        cpuMilliseconds: 10_000,
        maximumDurationMs: 120_000,
      })]),
    }),
  });
}

function requestFor(definition: ApplicationTaskWorkerDefinition) {
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
      applicationTaskRuntimeTargetSha256: fromHex(
        definition.runtimeTargetSha256Hex,
      ),
      attemptNumber: 1,
      leaseVersion: 1n,
      computeProfile: "standard-1x",
      cancellation: { kind: "not_requested", generation: 0n },
      maximumDurationMs: 30_000,
    },
  };
}

function buildDefinitionEffect(
  fixture: Omit<Parameters<typeof makeApplicationTaskWorkerDefinition>[0], "sha256">,
) {
  return makeApplicationTaskWorkerDefinition({ ...fixture, sha256 });
}

function buildDefinition(
  fixture: Omit<Parameters<typeof makeApplicationTaskWorkerDefinition>[0], "sha256">,
): Promise<ApplicationTaskWorkerDefinition> {
  return Effect.runPromise(buildDefinitionEffect(fixture));
}

function digest(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "hex"));
}

async function executeDefinition(
  definition: ApplicationTaskWorkerDefinition,
  requestValue: unknown,
  payload: unknown,
  enableQuery = false,
  enableMutation = false,
  mutationBehavior: "success" | "delayed_failure" = "success",
): Promise<unknown> {
  const encoded = JSON.stringify({ request: requestValue, payload },
    (_key, value: unknown) => {
      if (typeof value === "bigint") return { __bigint: String(value) };
      if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
      return value;
    });
  const workerCode = {
    compatibilityDate: definition.compatibilityDate,
    limits: definition.limits,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: null,
  };
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const workerCode = ${JSON.stringify(workerCode)};
const input = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint)
    : value
);
class InputCapability extends RpcTarget {
  read() { return JSON.parse(JSON.stringify(input.payload)); }
  [Symbol.dispose]() { globalThis.capabilityDisposals += 1; }
}
class QueryCapability extends RpcTarget {
  invoke(request) {
    if (!${JSON.stringify(enableQuery)}) {
      throw new Error("query callback was not expected");
    }
    globalThis.queryPath = request.functionPath;
    return {
      format: "flarex.application-task-query-callback",
      version: 1,
      kind: "success",
      callId: "task-worker-test:query:1",
      deadlineMs: Date.now() + 1_000,
      value: request.arguments,
      valueSemanticBytes: request.argumentSemanticBytes,
    };
  }
}
class MutationCapability extends RpcTarget {
  async invoke(request) {
    if (!${JSON.stringify(enableMutation)}) {
      throw new Error("mutation callback was not expected");
    }
    globalThis.mutationCalls.push({ ordinal: request.ordinal, path: request.functionPath });
    if (${JSON.stringify(mutationBehavior)} === "delayed_failure") {
      await scheduler.wait(25);
      return {
        format: "flarex.application-task-mutation-callback",
        version: 1,
        kind: "failure",
        callId: "task-worker-test:mutation:" + String(request.ordinal),
        deadlineMs: Date.now() + 1_000,
        reason: "outcome_uncertain",
      };
    }
    return {
      format: "flarex.application-task-mutation-callback",
      version: 1,
      kind: "success",
      callId: "task-worker-test:mutation:" + String(request.ordinal),
      deadlineMs: Date.now() + 1_000,
      value: request.arguments,
      valueSemanticBytes: request.argumentSemanticBytes,
    };
  }
}
globalThis.capabilityDisposals = 0;
globalThis.queryPath = null;
globalThis.mutationCalls = [];
export default {
  async fetch(_request, env) {
    try {
      const worker = env.LOADER.load(workerCode);
      const stub = worker.getEntrypoint(${JSON.stringify(definition.entrypoint)});
      const result = await stub.run(
        input.request,
        new InputCapability(),
        new QueryCapability(),
        new MutationCapability(),
      );
      try {
        const projection = { ...structuredClone(result),
          disposals: globalThis.capabilityDisposals,
          queryPath: globalThis.queryPath,
          mutationCalls: globalThis.mutationCalls };
        return new Response(JSON.stringify(projection, (_key, value) =>
          typeof value === "bigint" ? { __bigint: String(value) } : value
        ), { headers: { "content-type": "application/json" } });
      }
      finally { result[Symbol.dispose]?.(); }
    } catch (error) {
      return Response.json({
        name: error?.name,
        message: error?.message,
        causeName: error?.cause?.name,
        causeMessage: error?.cause?.message,
        causeReason: error?.cause?.reason,
        causeBoundary: error?.cause?.boundary,
        causeIssue: error?.cause?.cause?.issue,
      }, { status: 500 });
    }
  },
};`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://application-task.test/");
  const body = await response.json() as { readonly name?: string };
  if (!response.ok) throw new Error(`Worker failure ${JSON.stringify(body)}`);
  return body;
}

async function executeSessionDefinition(
  definition: ApplicationTaskWorkerDefinition,
  requestValue: unknown,
): Promise<unknown> {
  const encoded = JSON.stringify(requestValue, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const workerCode = {
    compatibilityDate: definition.compatibilityDate,
    limits: definition.limits,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: null,
  };
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify(workerCode)};
const request = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
globalThis.payloadDisposals = 0;
class Payload extends RpcTarget {
  [Symbol.dispose]() { globalThis.payloadDisposals += 1; }
}
class Input extends RpcTarget {
  async read() { await scheduler.wait(50); return new Payload(); }
}
class Query extends RpcTarget { invoke() { throw new Error("unexpected query"); } }
class Mutation extends RpcTarget { invoke() { throw new Error("unexpected mutation"); } }
export default { async fetch(_request, env) {
  const worker = env.LOADER.load(code);
  const session = await worker.getEntrypoint(${JSON.stringify(definition.entrypoint)})
    .start({ format: "flarex.task-worker-session-start", version: 1,
      generation: "application_v1", executionId: "execution-1", request },
      new Input(), new Query(), new Mutation());
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
  const response = await runtime.dispatchFetch("https://application-session.test/");
  const body = await response.json();
  if (!response.ok) throw new Error(`Application session failed: ${JSON.stringify(body)}`);
  return body;
}

async function executeTerminalSessionDefinition(
  definition: ApplicationTaskWorkerDefinition,
  requestValue: unknown,
  payload: unknown,
): Promise<unknown> {
  const encoded = JSON.stringify({ requestValue, payload }, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const workerCode = {
    compatibilityDate: definition.compatibilityDate,
    limits: definition.limits,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: null,
  };
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify(workerCode)};
const input = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
class Input extends RpcTarget { read() { return structuredClone(input.payload); } }
class Query extends RpcTarget { invoke() { throw new Error("unexpected query"); } }
class Mutation extends RpcTarget { invoke() { throw new Error("unexpected mutation"); } }
export default { async fetch(_request, env) {
  const worker = env.LOADER.load(code);
  const session = await worker.getEntrypoint(${JSON.stringify(definition.entrypoint)})
    .start({ format: "flarex.task-worker-session-start", version: 1,
      generation: "application_v1", executionId: "execution-1",
      request: input.requestValue }, new Input(), new Query(), new Mutation());
  try {
    const settlement = await session.settlement();
    return new Response(JSON.stringify(structuredClone(settlement), (_key, value) =>
      typeof value === "bigint" ? { __bigint: String(value) } : value),
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
  const response = await runtime.dispatchFetch("https://application-terminal-session.test/");
  const body = await response.json();
  if (!response.ok) throw new Error(`Application terminal session failed: ${
    JSON.stringify(body)
  }`);
  return body;
}

async function executeDisposalFailure(
  definition: ApplicationTaskWorkerDefinition,
  manifest: unknown,
  requestValue: unknown,
  invalidPayload: boolean,
): Promise<unknown> {
  const encoded = JSON.stringify(requestValue, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const outerSource = `
import { executeApplicationTaskWorkerV1 } from "./core.js";
const request = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint)
    : value
);
const definition = {
  handlerExportName: "run",
  manifest: JSON.parse(${JSON.stringify(JSON.stringify(manifest))}),
  runtimeTargetSha256Hex: ${JSON.stringify(definition.runtimeTargetSha256Hex)},
};
export default {
  async fetch() {
    try {
      await executeApplicationTaskWorkerV1({
        request,
        capability: {
          read() {
            return {
              value: ${invalidPayload ? "() => {}" : "'ok'"},
              [Symbol.dispose]() { throw new Error("payload dispose failed"); },
            };
          },
        },
        queryCapability: {
          invoke() { throw new Error("unexpected query"); },
        },
        mutationCapability: {
          invoke() { throw new Error("unexpected mutation"); },
        },
        definition,
        loadExecution: async () => ({ run(_ctx, payload) { return payload; } }),
      });
      return Response.json({ name: "must-not-succeed" });
    } catch (error) {
      return Response.json({
        name: error?.name,
        primaryName: error?.cause?.primaryFailure?.name ?? null,
        primaryCauseName: error?.cause?.primaryFailure?.cause?.name,
        primaryCauseReason: error?.cause?.primaryFailure?.cause?.reason,
        cleanupMessage: error?.cause?.cleanupFailure?.message,
      });
    }
  },
};`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "test.js", contents: outerSource }, {
      type: "ESModule", path: "core.js", contents: APPLICATION_WORKER_CORE_SOURCE,
    }],
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://dispose-task.test/");
  return await response.json();
}

async function executeSessionCapabilityCleanupFailure(
  definition: ApplicationTaskWorkerDefinition,
  manifest: unknown,
  requestValue: unknown,
  handlerFails = false,
): Promise<unknown> {
  const encoded = JSON.stringify(requestValue, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const source = `
import { startApplicationTaskWorkerSessionV1 } from "./core.js";
const request = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
const definition = {
  handlerExportName: "run",
  manifest: JSON.parse(${JSON.stringify(JSON.stringify(manifest))}),
  runtimeTargetSha256Hex: ${JSON.stringify(definition.runtimeTargetSha256Hex)},
};
export default {
  async fetch() {
    const session = await startApplicationTaskWorkerSessionV1({
      startRequest: { format: "flarex.task-worker-session-start", version: 1,
        generation: "application_v1", executionId: "execution-1", request },
      capability: {
        read() { return null; },
        [Symbol.dispose]() { throw new Error("input capability dispose failed"); },
      },
      queryCapability: { invoke() { throw new Error("unexpected query"); } },
      mutationCapability: { invoke() { throw new Error("unexpected mutation"); } },
      definition,
      loadExecution: async () => ({ run() {
        ${handlerFails ? 'throw new Error("handler failed");' : "return null;"}
      } }),
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
  },
};`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "test.js", contents: source }, {
      type: "ESModule", path: "core.js", contents: APPLICATION_WORKER_CORE_SOURCE,
    }],
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://cleanup-session.test/");
  return await response.json();
}

async function executeSessionUnexpectedDefect(
  definition: ApplicationTaskWorkerDefinition,
  manifest: unknown,
  requestValue: unknown,
): Promise<unknown> {
  const encoded = JSON.stringify(requestValue, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const source = `
import { startApplicationTaskWorkerSessionV1 } from "./core.js";
const request = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
let runtimeTargetReads = 0;
const definition = {
  handlerExportName: "run",
  manifest: JSON.parse(${JSON.stringify(JSON.stringify(manifest))}),
  get runtimeTargetSha256Hex() {
    runtimeTargetReads += 1;
    if (runtimeTargetReads === 1) {
      return ${JSON.stringify(definition.runtimeTargetSha256Hex)};
    }
    throw new Error("trusted runtime defect");
  },
};
export default { async fetch() {
  const session = await startApplicationTaskWorkerSessionV1({
    startRequest: { format: "flarex.task-worker-session-start", version: 1,
      generation: "application_v1", executionId: "execution-1", request },
    capability: { read() { return null; } },
    queryCapability: { invoke() { throw new Error("unexpected query"); } },
    mutationCapability: { invoke() { throw new Error("unexpected mutation"); } },
    definition,
    loadExecution: async () => ({ run() { return null; } }),
  });
  try {
    await session.settlement();
    return Response.json({ name: "must-not-succeed" });
  } catch (error) {
    return Response.json({ name: error?.name });
  }
} };`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "test.js", contents: source }, {
      type: "ESModule", path: "core.js", contents: APPLICATION_WORKER_CORE_SOURCE,
    }],
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://defect-session.test/");
  return await response.json();
}

async function executeDuplicateSessionStart(
  definition: ApplicationTaskWorkerDefinition,
  manifest: unknown,
  requestValue: unknown,
): Promise<unknown> {
  const encoded = JSON.stringify(requestValue, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const source = `
import { startApplicationTaskWorkerSessionV1 } from "./core.js";
const request = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint) : value);
const startRequest = { format: "flarex.task-worker-session-start", version: 1,
  generation: "application_v1", executionId: "execution-1", request };
const definition = { handlerExportName: "run",
  manifest: JSON.parse(${JSON.stringify(JSON.stringify(manifest))}),
  runtimeTargetSha256Hex: ${JSON.stringify(definition.runtimeTargetSha256Hex)} };
let disposals = 0;
const capability = () => ({ read() { return null; },
  [Symbol.dispose]() { disposals += 1; } });
const queryCapability = () => ({ invoke() { throw new Error("unexpected query"); },
  [Symbol.dispose]() { disposals += 1; } });
const mutationCapability = () => ({ invoke() { throw new Error("unexpected mutation"); },
  [Symbol.dispose]() { disposals += 1; } });
const loadExecution = async () => ({ run() { return null; } });
export default { async fetch() {
  const first = await startApplicationTaskWorkerSessionV1({
    startRequest, capability: capability(), queryCapability: queryCapability(),
    mutationCapability: mutationCapability(),
    definition, loadExecution,
  });
  await first.terminal;
  let secondName;
  try {
    await startApplicationTaskWorkerSessionV1({
      startRequest, capability: capability(), queryCapability: queryCapability(),
      mutationCapability: mutationCapability(),
      definition, loadExecution,
    });
  } catch (error) { secondName = error?.name; }
  return Response.json({ disposals, secondName });
} };`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "test.js", contents: source }, {
      type: "ESModule",
      path: "core.js",
      contents: APPLICATION_WORKER_CORE_SOURCE,
    }],
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://duplicate-session.test/");
  return await response.json();
}

interface EvaluatedApplicationTaskEntrypoint {
  readonly start: (
    startRequest: unknown,
    inputCapability: unknown,
    queryCapability: unknown,
    mutationCapability: unknown,
  ) => Promise<unknown>;
}

function evaluateGeneratedEntrypoint(source: string): new () =>
  EvaluatedApplicationTaskEntrypoint {
  const executable = source.split("\n")
    .filter(line => !line.startsWith("import "))
    .join("\n")
    .replace(
      `export class ${APPLICATION_TASK_WORKER_ENTRYPOINT}`,
      `class ${APPLICATION_TASK_WORKER_ENTRYPOINT}`,
    ) + `\nreturn ${APPLICATION_TASK_WORKER_ENTRYPOINT};`;
  class TestRpcTarget {}
  class TestWorkerEntrypoint {
    readonly ctx = Object.freeze({ waitUntil: (_pending: Promise<unknown>) => {} });
  }
  const factory = Function(
    "RpcTarget",
    "WorkerEntrypoint",
    "executeApplicationTaskWorkerV1",
    "startApplicationTaskWorkerSessionV1",
    executable,
  );
  const evaluated: unknown = factory(
    TestRpcTarget,
    TestWorkerEntrypoint,
    () => undefined,
    () => undefined,
  );
  if (typeof evaluated !== "function") {
    throw new Error("Generated Application Task entrypoint did not evaluate.");
  }
  // SAFETY: the exact generated class is checked as callable above and the
  // tests invoke only its declared start method before any imported operation.
  return evaluated as new () => EvaluatedApplicationTaskEntrypoint;
}

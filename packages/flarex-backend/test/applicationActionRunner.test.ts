import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  encodeEdgeActionHostPolicyV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, it, vi } from "vitest";

import {
  ApplicationActionCapabilitySessionError,
  ApplicationActionRunnerCompositionError,
  makeApplicationActionRunner,
} from "../src/artifactRuntime/ApplicationActionRunner";
import { ApplicationExecutionHostError } from
  "../src/artifactRuntime/ApplicationExecutionHost";
import { makeApplicationExecutionHost } from
  "../src/artifactRuntime/ApplicationExecutionHost";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "../src/artifactRuntime/ApplicationRuntimeMaterializer";

describe("Application action runner", () => {
  it("uses the pinned source, authenticated manifest and target on every run", async () => {
    const fixture = await applicationFixture();
    const policy = hostPolicy();
    const policyBytes = Result.getOrThrow(encodeEdgeActionHostPolicyV1(
      policy,
      policyBudget(),
    )).canonicalBytes;
    const policySha256 = await sha256(policyBytes);
    const sourceRead = vi.fn(() => Effect.succeed(fixture.source));
    const hostRun = vi.fn(input => {
      expect(input.request.target).toEqual(fixture.target);
      expect(input.definition.compatibilityDate).toBe("2026-06-14");
      expect(input.definition.hostPolicySha256Hex).toBe(hex(policySha256));
      expect(input.callback).toEqual(expect.objectContaining({}));
      expect(input.outbound.fetch).toEqual(expect.any(Function));
      return Effect.succeed({ ok: true });
    });
    const runner = makeApplicationActionRunner({
      source: { read: sourceRead },
      host: { runTransaction: vi.fn(), runAction: hostRun },
      hostPolicy: policy,
      hostPolicySha256: policySha256,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });

    await expect(Effect.runPromise(runner.run(fixture.input))).resolves.toEqual({
      ok: true,
    });
    await expect(Effect.runPromise(runner.run({
      ...fixture.input,
      capabilities: capabilitySession(),
    }))).resolves.toEqual({ ok: true });

    expect(sourceRead).toHaveBeenCalledTimes(2);
    expect(sourceRead).toHaveBeenNthCalledWith(1, "1".repeat(64));
    expect(sourceRead).toHaveBeenNthCalledWith(2, "1".repeat(64));
    expect(hostRun).toHaveBeenCalledTimes(2);
    expect(fixture.capabilities.drain).toHaveBeenCalledOnce();
  });

  it("owns authority, manifest and request before asynchronous policy hashing", async () => {
    const fixture = await applicationFixture();
    const policy = hostPolicy();
    const policySha256 = await sha256(Result.getOrThrow(
      encodeEdgeActionHostPolicyV1(policy, policyBudget()),
    ).canonicalBytes);
    let announceHash!: () => void;
    const hashStarted = new Promise<void>(resolve => { announceHash = resolve; });
    let resumeHash!: () => void;
    const hashGate = new Promise<void>(resolve => { resumeHash = resolve; });
    const hostRun = vi.fn(() => Effect.succeed({ owned: true }));
    const runner = makeApplicationActionRunner({
      source: { read: () => Effect.succeed(fixture.source) },
      host: { runTransaction: vi.fn(), runAction: hostRun },
      hostPolicy: policy,
      hostPolicySha256: policySha256,
      sha256: bytes => Effect.promise(async () => {
        announceHash();
        await hashGate;
        return sha256(bytes);
      }),
    });
    const mutableManifest = structuredClone(fixture.manifest) as unknown as {
      functions: Array<{ path: string }>;
    };
    const mutableRequest = structuredClone(fixture.request);
    const mutableAuthority = {
      authorityJson: structuredClone(fixture.authority.authorityJson),
      canonicalBytes: fixture.authority.canonicalBytes,
      sha256: fixture.authority.sha256,
    } as typeof fixture.authority;
    const running = Effect.runPromise(runner.run({
      ...fixture.input,
      manifest: mutableManifest as unknown as ApplicationManifestV1,
      request: mutableRequest,
      executionAuthority: mutableAuthority,
      capabilities: capabilitySession(),
    }));
    await hashStarted;
    mutableManifest.functions[0]!.path = "changed:path";
    mutableRequest.context.hostPolicySha256.fill(0);
    const mutableAuthorityJson = mutableAuthority.authorityJson as unknown as {
      runtimeTarget: { function: { path: string } };
    };
    mutableAuthorityJson.runtimeTarget.function.path = "changed:path";
    resumeHash();

    await expect(running).resolves.toEqual({ owned: true });
    expect(hostRun).toHaveBeenCalledOnce();
  });

  it("rejects authority and environment mismatches before source access and drains", async () => {
    const fixture = await applicationFixture();
    const policy = hostPolicy();
    const policySha256 = await sha256(Result.getOrThrow(
      encodeEdgeActionHostPolicyV1(policy, policyBudget()),
    ).canonicalBytes);
    const sourceRead = vi.fn(() => Effect.succeed(fixture.source));
    const runner = makeApplicationActionRunner({
      source: { read: sourceRead },
      host: { runTransaction: vi.fn(), runAction: vi.fn() },
      hostPolicy: policy,
      hostPolicySha256: policySha256,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });

    for (const mismatch of [
      { runtimeHostIdentity: "wrong-host", reason: "runtimeHostMismatch" },
      {
        invocationCompatibilityDate: "2026-06-15",
        reason: "compatibilityDateMismatch",
      },
    ] as const) {
      const capabilities = capabilitySession();
      const error = await Effect.runPromise(runner.run({
        ...fixture.input,
        ...mismatch,
        capabilities,
      }).pipe(Effect.flip));
      expect(error).toBeInstanceOf(ApplicationActionRunnerCompositionError);
      expect(error).toMatchObject({ reason: mismatch.reason });
      expect(capabilities.drain).toHaveBeenCalledOnce();
    }
    const invalidCapabilities = capabilitySession();
    const invalidRequestError = await Effect.runPromise(runner.run({
      ...fixture.input,
      request: { invalid: true } as never,
      capabilities: invalidCapabilities,
    }).pipe(Effect.flip));
    expect(invalidRequestError).toMatchObject({ reason: "invalidRequest" });
    expect(invalidCapabilities.drain).toHaveBeenCalledOnce();
    const mismatchedManifest = structuredClone(fixture.manifest) as unknown as {
      functions: Array<{ returns: unknown }>;
    };
    mismatchedManifest.functions[0]!.returns = null;
    const manifestCapabilities = capabilitySession();
    const manifestError = await Effect.runPromise(runner.run({
      ...fixture.input,
      manifest: mismatchedManifest as unknown as ApplicationManifestV1,
      capabilities: manifestCapabilities,
    }).pipe(Effect.flip));
    expect(manifestError).toMatchObject({ reason: "invalidManifest" });
    expect(manifestCapabilities.drain).toHaveBeenCalledOnce();
    const authorityCapabilities = capabilitySession();
    const authorityError = await Effect.runPromise(runner.run({
      ...fixture.input,
      executionAuthority: {
        authorityJson: fixture.authority.authorityJson,
        canonicalBytes: new Uint8Array([1]),
        sha256: new Uint8Array(32),
      } as typeof fixture.authority,
      capabilities: authorityCapabilities,
    }).pipe(Effect.flip));
    expect(authorityError).toMatchObject({ reason: "invalidAuthority" });
    expect(authorityCapabilities.drain).toHaveBeenCalledOnce();
    expect(sourceRead).not.toHaveBeenCalled();
  });

  it("lets close-and-drain uncertainty override host success or failure", async () => {
    const fixture = await applicationFixture();
    const policy = hostPolicy();
    const policySha256 = await sha256(Result.getOrThrow(
      encodeEdgeActionHostPolicyV1(policy, policyBudget()),
    ).canonicalBytes);
    const runner = makeApplicationActionRunner({
      source: { read: () => Effect.succeed(fixture.source) },
      host: {
        runTransaction: vi.fn(),
        runAction: () => Effect.fail(new ApplicationExecutionHostError({
          operation: "action",
          reason: "userCodeFailed",
        })),
      },
      hostPolicy: policy,
      hostPolicySha256: policySha256,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });
    const uncertainty = new ApplicationActionCapabilitySessionError({
      reason: "cleanupUncertain",
    });
    const error = await Effect.runPromise(runner.run({
      ...fixture.input,
      capabilities: {
        callback: {},
        outbound: fetcher(),
        closeAndDrain: Effect.fail(uncertainty),
      },
    }).pipe(Effect.flip));

    expect(error).toBe(uncertainty);
  });

  it("finishes capability cleanup before exposing host interruption", async () => {
    const fixture = await applicationFixture();
    const policy = hostPolicy();
    const policySha256 = await sha256(Result.getOrThrow(
      encodeEdgeActionHostPolicyV1(policy, policyBudget()),
    ).canonicalBytes);
    const cleanupCompleted = vi.fn();

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const hostEntered = yield* Deferred.make<void>();
      const cleanupEntered = yield* Deferred.make<void>();
      const releaseCleanup = yield* Deferred.make<void>();
      const runner = makeApplicationActionRunner({
        source: { read: () => Effect.succeed(fixture.source) },
        host: {
          runTransaction: vi.fn(),
          runAction: () => Deferred.succeed(hostEntered, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
        },
        hostPolicy: policy,
        hostPolicySha256: policySha256,
        sha256: bytes => Effect.promise(() => sha256(bytes)),
      });
      const fiber = yield* runner.run({
        ...fixture.input,
        capabilities: {
          callback: {},
          outbound: fetcher(),
          closeAndDrain: Deferred.succeed(cleanupEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCleanup)),
            Effect.tap(() => Effect.sync(cleanupCompleted)),
          ),
        },
      }).pipe(Effect.forkChild);
      yield* Deferred.await(hostEntered);
      const interruption = yield* Fiber.interrupt(fiber).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(cleanupEntered);
      expect(cleanupCompleted).not.toHaveBeenCalled();
      yield* Deferred.succeed(releaseCleanup, undefined);
      yield* Fiber.join(interruption);
      return yield* Fiber.await(fiber);
    }));

    expect(cleanupCompleted).toHaveBeenCalledOnce();
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("loads a fresh Application Worker for every runner invocation", async () => {
    const fixture = await applicationFixture();
    const policy = hostPolicy();
    const policySha256 = await sha256(Result.getOrThrow(
      encodeEdgeActionHostPolicyV1(policy, policyBudget()),
    ).canonicalBytes);
    const loader = new FakeWorkerLoader(async (_request, capability) => {
      expect(capability).toEqual(expect.objectContaining({}));
      return {
        format: APPLICATION_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_WORKER_RESULT_VERSION_V1,
        value: { fresh: true },
      };
    });
    const runner = makeApplicationActionRunner({
      source: { read: () => Effect.succeed(fixture.source) },
      host: makeApplicationExecutionHost(loader),
      hostPolicy: policy,
      hostPolicySha256: policySha256,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(Effect.runPromise(runner.run({
        ...fixture.input,
        capabilities: capabilitySession(),
      }))).resolves.toEqual({ fresh: true });
    }

    expect(loader.loaded).toHaveLength(2);
    expect(loader.stubs).toHaveLength(2);
    expect(loader.stubs[0]).not.toBe(loader.stubs[1]);
    expect(loader.entrypoints).toHaveLength(2);
    expect(loader.entrypoints[0]).not.toBe(loader.entrypoints[1]);
    expect(loader.requestedEntrypoints).toEqual([
      "FlarexApplicationActionWorker",
      "FlarexApplicationActionWorker",
    ]);
  });
});

async function applicationFixture() {
  const sourceText = "export const notify = action(() => ({ ok: true }));\n";
  const canonicalManifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: "1".repeat(64),
      executionModulePath: "_flarex/application.js",
      schemaModulePath: null,
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "c".repeat(64),
        sourceByteLength: new TextEncoder().encode(sourceText).byteLength,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [{
      path: "users:notify",
      moduleName: "users",
      exportName: "notify",
      kind: "action",
      visibility: "public",
      args: { type: "any" },
      returns: { type: "any" },
      partition: null,
    }],
  }));
  const manifest = canonicalManifest.manifest;
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: "scope-action",
    revisionId: "revision-action",
    candidateId: "candidate-action",
    analysisId: "analysis-action",
    sourceArtifactRootSha256: manifest.sourceArtifact.rootSha256,
    manifestSha256: hex(await sha256(canonicalManifest.canonicalBytes)),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: manifest.sourceArtifact.executionModulePath,
    function: { ...manifest.functions[0]!, entrySha256: "6".repeat(64) },
  })).target;
  const canonicalTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(target),
  );
  const authority = await Effect.runPromise(
    canonicalizeApplicationActionExecutionAuthorityV1({
      format: "flarex.application-action-execution-authority",
      version: 1,
      runtimeTarget: target,
      runtimeTargetSha256: hex(await sha256(canonicalTarget.canonicalBytes)),
      activationSequence: "1",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId: "schema-action",
    }),
  );
  const policy = hostPolicy();
  const policySha256 = await sha256(Result.getOrThrow(
    encodeEdgeActionHostPolicyV1(policy, policyBudget()),
  ).canonicalBytes);
  const argumentsValue = { value: 1 };
  const capabilities = capabilitySession();
  const request = {
    format: APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth: { kind: "anonymous" as const },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    context: {
      executionId: "execution-action",
      invocationId: "invocation-action",
      executionGeneration: 1n,
      executionTime: 1_800_000_000_000,
      executionDeadline: 1_800_000_030_000,
      randomSeed: new Uint8Array(32).fill(1),
      hostPolicySha256: policySha256,
    },
  };
  const source = Object.freeze({
    sourceArtifact: manifest.sourceArtifact,
    modules: Object.freeze([{
      path: "_flarex/application.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "c".repeat(64),
      sourceByteLength: new TextEncoder().encode(sourceText).byteLength,
      source: sourceText,
    }]),
  });
  return {
    manifest,
    target,
    authority,
    request,
    source,
    capabilities,
    input: {
      executionAuthority: authority,
      manifest,
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      admittedCompatibilityDate: "2026-06-14",
      invocationCompatibilityDate: "2026-06-14",
      request,
      capabilities,
    },
  };
}

function capabilitySession() {
  const drain = vi.fn(() => Effect.void);
  return Object.freeze({
    callback: Object.freeze({}),
    outbound: fetcher(),
    closeAndDrain: Effect.suspend(drain),
    drain,
  });
}

function fetcher(): Fetcher {
  return {
    fetch: vi.fn(),
    connect: vi.fn(),
  } as Fetcher;
}

function hostPolicy() {
  return Object.freeze({
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: Object.freeze(["https://api.example.com"]),
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 8,
    maximumOutboundRequests: 4,
    maximumConcurrentOutboundRequests: 2,
    maximumWorkerSubrequests: 8,
    maximumArgumentBytes: 16_384,
    maximumResultBytes: 16_384,
    maximumCallbackArgumentBytes: 16_384,
    maximumCallbackResultBytes: 16_384,
    maximumUrlBytes: 2_048,
    maximumMethodBytes: 16,
    maximumHeaderCount: 32,
    maximumHeaderBytes: 8_192,
    maximumStatusTextBytes: 256,
    maximumOutboundRequestBodyBytes: 65_536,
    maximumOutboundResponseBodyBytes: 65_536,
    maximumCumulativeOutboundBodyBytes: 131_072,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
  });
}

function policyBudget() {
  return Object.freeze({
    maximumOrigins: 1_024,
    maximumOriginBytes: 8_192,
    maximumCanonicalBytes: 1_048_576,
  });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

type Run = (request: unknown, capability: unknown) => PromiseLike<unknown>;

class FakeWorkerLoader implements WorkerLoader {
  readonly loaded: WorkerLoaderWorkerCode[] = [];
  readonly stubs: WorkerStub[] = [];
  readonly entrypoints: object[] = [];
  readonly requestedEntrypoints: string[] = [];

  constructor(private readonly run: Run) {}

  get(): WorkerStub {
    throw new Error("Application action runner forbids WorkerLoader.get().");
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
    const entrypoint = { run: this.run };
    this.owner.entrypoints.push(entrypoint);
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application action runner does not load Durable Objects.");
  }
}

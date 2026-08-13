import type {
  ApplicationAuthorityActionInvocationProjection,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import type {
  ApplicationActionHostCompositionLive,
} from "../src/ApplicationActionHostComposition";
import type { ApplicationActionRunner } from
  "flarex-backend/internal/application-action-runner";
import {
  makeExecutionEvidenceBodyReferenceV1,
} from "flarex-protocol/internal/execution-evidence-v1";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Effect, Result } from "effect";
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
  MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import {
  canonicalizeFlarexValueV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  claim: vi.fn(),
  revoke: vi.fn(),
  settle: vi.fn(),
}));

vi.mock(
  "@flarex/persistence-postgres/internal/application-action-authority-v1",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    claimApplicationAuthorityActionExecution: persistence.claim,
    revokeDirectActionExecutionSubjectV1: persistence.revoke,
    settleApplicationAuthorityActionInvocation: persistence.settle,
  }),
);

import {
  capabilitySession,
  dispatchPreparedApplicationAction,
  prepareApplicationActionDispatch,
  projectApplicationActionWorkerRequest,
  settlePreparedApplicationAction,
} from "../src/ApplicationActionHostComposition";
import {
  ApplicationActionRunnerCompositionError,
} from "flarex-backend/internal/application-action-runner";

describe("Application action host composition", () => {
  it("closes both capability gates before draining either one", async () => {
    const order: string[] = [];
    const callback = {
      invoke: vi.fn(),
      close: () => { order.push("callback.close"); },
      drain: async () => { order.push("callback.drain"); },
    };
    const outbound = {
      fetch: vi.fn(),
      close: () => { order.push("outbound.close"); },
      drain: async () => { order.push("outbound.drain"); },
    };
    const session = capabilitySession(callback, outbound);

    await Effect.runPromise(session.closeAndDrain);

    expect(order.slice(0, 2)).toEqual([
      "callback.close",
      "outbound.close",
    ]);
    expect(order.slice(2).sort()).toEqual([
      "callback.drain",
      "outbound.drain",
    ]);
    expect(() => session.outbound.connect("example.com:443")).toThrow(
      "raw outbound sockets are denied",
    );
  });

  it("drains both and preserves outbound uncertainty over callback failure", async () => {
    const callbackDrain = vi.fn(async () => {
      throw new Error("callback failed");
    });
    const outboundDrain = vi.fn(async () => {
      throw new Error("possible dispatch");
    });
    const session = capabilitySession({
      invoke: vi.fn(),
      close: vi.fn(),
      drain: callbackDrain,
    }, {
      fetch: vi.fn(),
      close: vi.fn(),
      drain: outboundDrain,
    });

    const error = await Effect.runPromise(
      session.closeAndDrain.pipe(Effect.flip),
    );

    expect(error).toMatchObject({ reason: "cleanupUncertain" });
    expect(callbackDrain).toHaveBeenCalledOnce();
    expect(outboundDrain).toHaveBeenCalledOnce();
  });

  it("bounds a callback drain that never settles as cleanup uncertainty", async () => {
    const callbackDrain = vi.fn(() => new Promise<void>(() => {}));
    const outboundDrain = vi.fn(async () => {});
    const session = capabilitySession({
      invoke: vi.fn(),
      close: vi.fn(),
      drain: callbackDrain,
    }, {
      fetch: vi.fn(),
      close: vi.fn(),
      drain: outboundDrain,
    }, 10);

    const error = await Effect.runPromise(
      Effect.uninterruptible(session.closeAndDrain).pipe(Effect.flip),
    );

    expect(error).toMatchObject({ reason: "cleanupUncertain" });
    expect(callbackDrain).toHaveBeenCalledOnce();
    expect(outboundDrain).toHaveBeenCalledOnce();
  });

  it("projects and owns a bounded Application action request", async () => {
    const target = runtimeTarget();
    const invocation = invocationProjection();
    const args = { message: "hello" };
    const normalized = normalizeFlarexValueV1(args);
    const randomSeed = new Uint8Array(32).fill(3);
    const request = await Effect.runPromise(
      projectApplicationActionWorkerRequest({
        target,
        auth: { kind: "anonymous" },
        argumentsValue: args,
        argumentSemanticBytes: normalized.semanticSizeBytes,
        invocation,
        randomSeed,
      }),
    );
    randomSeed.fill(0);
    invocation.hostPolicySha256.fill(0);

    expect(request.target).toEqual(target);
    expect(request.arguments).toEqual(args);
    expect(request.context).toMatchObject({
      executionId: "invocation-action",
      invocationId: "invocation-action",
      executionGeneration: 2n,
      executionTime: 1_800_000_000_000,
      executionDeadline: 1_800_000_030_000,
    });
    expect(request.context.randomSeed).toEqual(new Uint8Array(32).fill(3));
    expect(request.context.hostPolicySha256).toEqual(
      new Uint8Array(32).fill(7),
    );
  });

  it("rejects an over-limit action argument during request projection", async () => {
    const value = {
      bytes: new ArrayBuffer(
        MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
      ),
    };
    const normalized = normalizeFlarexValueV1(value);
    const error = await Effect.runPromise(
      projectApplicationActionWorkerRequest({
        target: runtimeTarget(),
        auth: { kind: "anonymous" },
        argumentsValue: value,
        argumentSemanticBytes: normalized.semanticSizeBytes,
        invocation: invocationProjection(),
        randomSeed: new Uint8Array(32),
      }).pipe(Effect.flip),
    );

    expect(error).toMatchObject({ reason: "invalidInput" });
  });

  it("connects claim, single-use dispatch, cleanup, and settlement authority", async () => {
    const fixture = await compositionFixture();
    const subject = Object.freeze({});
    persistence.claim.mockReturnValue(Effect.succeed({
      invocation: fixture.invocation,
      subject,
    }));
    persistence.settle.mockImplementation((_subject, outcome) =>
      Effect.succeed({
        ...fixture.invocation,
        lifecycle: outcome.lifecycle,
        result: outcome.lifecycle === "completed" ? outcome.result : null,
      })
    );

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const prepared = yield* prepareApplicationActionDispatch({
        admission: fixture.admission,
        invocation: fixture.invocation,
        execution: {
          executionDurationMilliseconds: 30_000,
          randomSeed: new Uint8Array(32).fill(3),
          auth: { kind: "anonymous" },
        },
      }, fixture.live);
      const premature = yield* settlePreparedApplicationAction(
        prepared.settlement,
        { lifecycle: "failed", terminalCode: "premature" },
        fixture.live.evidence,
      ).pipe(Effect.result);
      expect(Result.isFailure(premature)).toBe(true);
      if (Result.isFailure(premature)) {
        expect(premature.failure).toMatchObject({
          reason: "settlementUnavailable",
        });
      }
      const result = yield* dispatchPreparedApplicationAction(prepared.bundle);
      expect(result).toEqual({ delivered: true });
      const replay = yield* dispatchPreparedApplicationAction(
        prepared.bundle,
      ).pipe(Effect.result);
      expect(Result.isFailure(replay)).toBe(true);
      if (Result.isFailure(replay)) {
        expect(replay.failure).toMatchObject({ reason: "invalidBundle" });
      }
      const settled = yield* settlePreparedApplicationAction(
        prepared.settlement,
        { lifecycle: "completed", resultValue: result },
        fixture.live.evidence,
      );
      expect(settled.lifecycle).toBe("completed");
    })));

    expect(persistence.claim).toHaveBeenCalledWith(
      fixture.invocation.requestKey,
      30_000,
      expect.any(Uint8Array),
      fixture.live.evidence.authority,
    );
    expect(persistence.settle).toHaveBeenCalledOnce();
    expect(persistence.settle.mock.calls[0]?.[0]).toBe(subject);
    expect(persistence.settle.mock.calls[0]?.[1]).toMatchObject({
      lifecycle: "completed",
    });
  });

  it("permits explicit uncertain settlement after a failed cleaned dispatch", async () => {
    const fixture = await compositionFixture(true);
    const subject = Object.freeze({});
    persistence.claim.mockReturnValue(Effect.succeed({
      invocation: fixture.invocation,
      subject,
    }));
    persistence.settle.mockImplementation((_subject, outcome) =>
      Effect.succeed({ ...fixture.invocation, ...outcome, result: null })
    );
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const prepared = yield* prepareApplicationActionDispatch({
        admission: fixture.admission,
        invocation: fixture.invocation,
        execution: {
          executionDurationMilliseconds: 30_000,
          randomSeed: new Uint8Array(32).fill(3),
          auth: { kind: "anonymous" },
        },
      }, fixture.live);
      const failed = yield* dispatchPreparedApplicationAction(
        prepared.bundle,
      ).pipe(Effect.result);
      expect(Result.isFailure(failed)).toBe(true);
      const settled = yield* settlePreparedApplicationAction(
        prepared.settlement,
        { lifecycle: "uncertain", terminalCode: "host_failed_after_cleanup" },
        fixture.live.evidence,
      );
      expect(settled.lifecycle).toBe("uncertain");
    })));
  });

  it("rejects a claimed invocation that does not match the admitted projection", async () => {
    const fixture = await compositionFixture();
    persistence.claim.mockReturnValue(Effect.succeed({
      invocation: fixture.invocation,
      subject: Object.freeze({}),
    }));
    const mismatched = {
      ...fixture.invocation,
      requestIdentitySha256: new Uint8Array(32).fill(0xff),
    };

    const result = await Effect.runPromise(Effect.scoped(
      prepareApplicationActionDispatch({
        admission: fixture.admission,
        invocation: mismatched,
        execution: {
          executionDurationMilliseconds: 30_000,
          randomSeed: new Uint8Array(32).fill(3),
          auth: { kind: "anonymous" },
        },
      }, fixture.live).pipe(Effect.result),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "authorityMismatch" });
    }
  });
});

async function compositionFixture(runFailure = false) {
  const manifestCanonical = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: "1".repeat(64),
      executionModulePath: "_flarex/application.js",
      schemaModulePath: null,
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "2".repeat(64),
        sourceByteLength: 1,
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
  const target = runtimeTarget();
  const targetCanonical = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(target),
  );
  const authority = await Effect.runPromise(
    canonicalizeApplicationActionExecutionAuthorityV1({
      format: "flarex.application-action-execution-authority",
      version: 1,
      runtimeTarget: target,
      runtimeTargetSha256: hex(await sha256(targetCanonical.canonicalBytes)),
      activationSequence: "1",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId: "schema-action",
    }),
  );
  const policy = hostPolicy();
  const policySha256 = await sha256(Result.getOrThrow(
    encodeEdgeActionHostPolicyV1(policy, {
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    }),
  ).canonicalBytes);
  const args = await canonicalizeFlarexValueV1({ message: "hello" });
  const argumentReference = Result.getOrThrow(
    makeExecutionEvidenceBodyReferenceV1(
      "action_arguments",
      args.sha256,
      args.canonicalBytes.byteLength,
    ),
  );
  const invocation: ApplicationAuthorityActionInvocationProjection = {
    ...invocationProjection(),
    executionAuthority: authority,
    executionIdentitySha256: (await canonicalizeFlarexValueV1({
      kind: "anonymous",
    })).sha256,
    hostPolicySha256: policySha256,
    arguments: argumentReference,
    lifecycle: "admitted" as const,
    executionGeneration: 0n,
    randomSeedSha256: null,
    invocationTime: null,
    executionDeadline: null,
  };
  const claimedInvocation = {
    ...invocation,
    lifecycle: "executing" as const,
    executionGeneration: 1n,
    randomSeedSha256: new Uint8Array(32),
    invocationTime: new Date(1_800_000_000_000),
    executionDeadline: new Date(1_800_000_030_000),
  };
  Object.assign(invocation, claimedInvocation);
  const bodyStore = {
    readImmutable: () => Effect.succeed({ bytes: args.canonicalBytes }),
    putImmutable: (_kind: unknown, bytes: Uint8Array) => Effect.succeed(
      Result.getOrThrow(makeExecutionEvidenceBodyReferenceV1(
        "action_result",
        new Uint8Array(32),
        bytes.byteLength,
      )),
    ),
  };
  const runner: ApplicationActionRunner = {
    run: vi.fn(() => runFailure
      ? Effect.fail(new ApplicationActionRunnerCompositionError({
          reason: "sourceReadFailed",
        }))
      : Effect.succeed({ delivered: true })),
  };
  const live = {
    evidence: {
      bodyStore,
      bodyBudget: { maximumBodyBytes: 1_048_576, maximumHashBytes: 1_048_576 },
      authority: {
        target: {},
        authority: { scopeId: invocation.scopeId },
        sha256: { hash: (bytes: Uint8Array) =>
          Effect.promise(() => sha256(bytes)) },
      },
    },
    effectRunner: { runPromise: Effect.runPromise },
    callbackSystem: {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    },
    outboundHost: { fetch: vi.fn() },
    hostPolicy: policy,
    runner,
  } as unknown as ApplicationActionHostCompositionLive<never, never>;
  return {
    invocation,
    admission: {
      selection: Object.freeze({}),
      basis: {
        manifest: manifestCanonical.manifest,
        runtimeHostIdentity: "test-host",
        compatibilityDate: "2026-06-14",
      },
      executionAuthority: authority,
      schema: {},
    } as never,
    live,
  };
}

function runtimeTarget() {
  return Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: ScopeIdSchema.make("scope-action"),
    revisionId: "revision-action",
    candidateId: "candidate-action",
    analysisId: "analysis-action",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "users:notify",
      moduleName: "users",
      exportName: "notify",
      kind: "action",
      visibility: "public",
      args: { type: "any" },
      returns: { type: "any" },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  })).target;
}

function invocationProjection(): ApplicationAuthorityActionInvocationProjection {
  return {
    scopeId: ScopeIdSchema.make("scope-action"),
    requestKey: "request-action",
    invocationId: "invocation-action",
    requestIdentitySha256: new Uint8Array(32).fill(1),
    executionAuthorityGeneration: "application_v1",
    executionAuthority: {} as never,
    actionFunctionPath: "users:notify",
    executionIdentitySha256: new Uint8Array(32).fill(2),
    compatibilityDate: "2026-06-14",
    hostPolicySha256: new Uint8Array(32).fill(7),
    arguments: {} as never,
    lifecycle: "executing",
    executionGeneration: 2n,
    randomSeedSha256: new Uint8Array(32).fill(3),
    invocationTime: new Date(1_800_000_000_000),
    executionDeadline: new Date(1_800_000_030_000),
    lastEffectOrdinal: 0n,
    cancellationRequestedAt: null,
    result: null,
    terminalCode: null,
    admittedAt: new Date(1_799_999_999_000),
    updatedAt: new Date(1_800_000_000_000),
    terminalAt: null,
  };
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
    cleanupDrainMilliseconds: 100,
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

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

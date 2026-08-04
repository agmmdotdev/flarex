import { Effect, Result } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  claimExecution: vi.fn(),
  settleExecution: vi.fn(),
  revokeExecution: vi.fn(),
  prepareTarget: vi.fn(),
  claimTarget: vi.fn(),
}));

vi.mock(
  "@flarex/persistence-postgres/internal/application-action-authority-v1",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    claimDirectActionExecutionV1: operations.claimExecution,
    settleDirectActionInvocationV1: operations.settleExecution,
    revokeDirectActionExecutionSubjectV1: operations.revokeExecution,
  }),
);

vi.mock(
  "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    prepareCandidateBoundEdgeActionRuntimeTargetV1: operations.prepareTarget,
    claimCandidateBoundEdgeActionRuntimeTargetV1: operations.claimTarget,
  }),
);

import {
  prepareActiveApplicationEdgeActionDispatchV1,
  settleActiveApplicationEdgeActionV1,
  type ActiveApplicationActionEvidenceLiveV1,
  type ActiveApplicationEdgeActionDispatchLiveV1,
  type PrepareActiveApplicationEdgeActionDispatchV1Input,
} from "../src/actionAdmissionSystemV1";
import {
  claimActiveApplicationEdgeActionArtifactHostDispatchV1,
  issueActiveApplicationEdgeActionCapabilityBundleV1,
  issueActiveApplicationEdgeActionSettlementCapabilityV1,
  type ActiveApplicationEdgeActionCapabilityBundleLiveV1,
} from "../src/edgeActionDispatchCapabilityBundleV1";
import type { AuthenticatedActiveApplicationRevisionSelectionV1 } from
  "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  canonicalizeFlarexValueV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";

describe("active application edge-action dispatch composition v1", () => {
  beforeEach(() => {
    operations.claimExecution.mockReset();
    operations.settleExecution.mockReset();
    operations.revokeExecution.mockReset();
    operations.prepareTarget.mockReset();
    operations.claimTarget.mockReset();
  });

  it("binds one executing AAV-A1 subject to the exact candidate target and R2 arguments", async () => {
    const fixture = await makeFixture();
    let authReads = 0;
    const callerOwnedAuth = Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        authReads += 1;
        return authReads === 1 ? "anonymous" : "user";
      },
    }) as unknown as PrepareActiveApplicationEdgeActionDispatchV1Input["auth"];
    const input = { ...fixture.input, auth: callerOwnedAuth };
    operations.claimExecution.mockReturnValue(Effect.succeed(fixture.execution));
    operations.prepareTarget.mockReturnValue(Effect.succeed(fixture.target));
    operations.claimTarget.mockReturnValue(Result.succeed({
      ...fixture.target,
      definition: fixture.definition,
      hostPolicy: fixture.hostPolicy,
    }));
    operations.settleExecution.mockReturnValue(Effect.succeed({
      ...fixture.execution.invocation,
      lifecycle: "failed",
      terminalCode: "edge_action_userCodeFailed",
    }));

    const { claim, replay, settled, settlementReplay } = await Effect.runPromise(Effect.scoped(
      Effect.gen(function* () {
        const prepared = yield* prepareActiveApplicationEdgeActionDispatchV1(
        input,
        fixture.live as unknown as
          ActiveApplicationEdgeActionDispatchLiveV1<never, never>,
        );
        const bundle = yield* issueActiveApplicationEdgeActionCapabilityBundleV1(
          prepared,
          fixture.bundleLive as unknown as
            ActiveApplicationEdgeActionCapabilityBundleLiveV1<never, never>,
        );
        const settlement =
          yield* issueActiveApplicationEdgeActionSettlementCapabilityV1(bundle);
        const claim = claimActiveApplicationEdgeActionArtifactHostDispatchV1(
          bundle,
        );
        const settled = yield* settleActiveApplicationEdgeActionV1(
          settlement,
          {
            lifecycle: "failed",
            terminalCode: "edge_action_userCodeFailed",
          },
          fixture.bundleLive.evidence as unknown as
            ActiveApplicationActionEvidenceLiveV1<never, never>,
        );
        const settlementReplay = yield* Effect.result(
          settleActiveApplicationEdgeActionV1(
            settlement,
            {
              lifecycle: "failed",
              terminalCode: "edge_action_userCodeFailed",
            },
            fixture.bundleLive.evidence as unknown as
              ActiveApplicationActionEvidenceLiveV1<never, never>,
          ),
        );
        return {
          claim,
          settled,
          settlementReplay,
          replay: claimActiveApplicationEdgeActionArtifactHostDispatchV1(bundle),
        };
      }),
    ));

    expect(fixture.live.bodyStore.readImmutable).toHaveBeenCalledWith(
      fixture.execution.invocation.arguments,
      fixture.live.argumentBudget,
    );
    expect(operations.revokeExecution).toHaveBeenCalledWith(
      fixture.execution.subject,
    );
    expect(Result.isSuccess(claim)).toBe(true);
    if (Result.isSuccess(claim)) {
      expect(claim.success.request).toMatchObject({
        artifact: fixture.target.artifact,
        function: fixture.target.function,
        arguments: { orderId: "order-1" },
        context: {
          invocationId: "00000000-0000-0000-0000-000000000001",
          executionGeneration: 2n,
          executionTime: 1_800_000_000_000,
          executionDeadline: 1_800_000_030_000,
        },
      });
      expect(claim.success.request.auth).toEqual({ kind: "anonymous" });
      expect(authReads).toBe(1);
      expect(claim.success.definition).toBe(fixture.definition);
      expect(typeof claim.success.callback.invoke).toBe("function");
      expect(typeof claim.success.outbound.fetch).toBe("function");
      const callbackArguments = normalizeFlarexValueV1({});
      await expect(claim.success.callback.invoke({
        kind: "runQuery",
        ordinal: 1n,
        functionPath: "orders:get",
        arguments: callbackArguments.value,
        argumentSemanticBytes: callbackArguments.semanticSizeBytes,
      })).resolves.toBe(null);
      await expect(claim.success.outbound.fetch(
        "https://api.example.com/orders",
      )).rejects.toMatchObject({ reason: "resourceExceeded" });
      await expect(claim.success.outbound.drain()).rejects.toMatchObject({
        reason: "resourceExceeded",
      });
    }
    expect(Result.isFailure(replay)).toBe(true);
    expect(settled.lifecycle).toBe("failed");
    expect(Result.isFailure(settlementReplay)).toBe(true);
    expect(operations.settleExecution).toHaveBeenCalledWith(
      fixture.execution.subject,
      {
        lifecycle: "failed",
        terminalCode: "edge_action_userCodeFailed",
      },
      fixture.bundleLive.evidence.authority,
    );
    expect(Result.isFailure(
      claimActiveApplicationEdgeActionArtifactHostDispatchV1({}),
    )).toBe(true);
  });

  it("fails closed when the claimed candidate differs from the admitted invocation", async () => {
    const fixture = await makeFixture();
    operations.claimExecution.mockReturnValue(Effect.succeed(fixture.execution));
    operations.prepareTarget.mockReturnValue(Effect.succeed({
      ...fixture.target,
      binding: {
        ...fixture.target.binding,
        candidateSha256: new Uint8Array(32).fill(9),
      },
    }));

    await expect(Effect.runPromise(Effect.scoped(
      prepareActiveApplicationEdgeActionDispatchV1(
        fixture.input,
        fixture.live as unknown as
          ActiveApplicationEdgeActionDispatchLiveV1<never, never>,
      ),
    ))).rejects.toMatchObject({ reason: "authorityMismatch" });
    expect(fixture.live.bodyStore.readImmutable).not.toHaveBeenCalled();
    expect(operations.revokeExecution).toHaveBeenCalledWith(
      fixture.execution.subject,
    );
  });

  it("fails closed when runtime auth differs from the admitted execution identity", async () => {
    const fixture = await makeFixture();
    operations.claimExecution.mockReturnValue(Effect.succeed({
      ...fixture.execution,
      invocation: {
        ...fixture.execution.invocation,
        executionIdentitySha256: new Uint8Array(32).fill(9),
      },
    }));
    operations.prepareTarget.mockReturnValue(Effect.succeed(fixture.target));

    await expect(Effect.runPromise(Effect.scoped(
      prepareActiveApplicationEdgeActionDispatchV1(
        fixture.input,
        fixture.live as unknown as
          ActiveApplicationEdgeActionDispatchLiveV1<never, never>,
      ),
    ))).rejects.toMatchObject({ reason: "authorityMismatch" });
    expect(operations.prepareTarget).not.toHaveBeenCalled();
    expect(fixture.live.bodyStore.readImmutable).not.toHaveBeenCalled();
  });
});

async function makeFixture() {
  const canonicalArguments = await canonicalizeFlarexValueV1({
    orderId: "order-1",
  });
  const candidateSha256 = new Uint8Array(32).fill(2);
  const hostPolicySha256 = new Uint8Array(32).fill(3);
  const actionBindingSha256 = new Uint8Array(32).fill(4);
  const randomSeedSha256 = new Uint8Array(32).fill(5);
  const executionIdentity = await canonicalizeFlarexValueV1({
    kind: "anonymous",
  });
  const argumentReference = Object.freeze({
    storeIdentity: "flarex.r2/execution-evidence-body/v1" as const,
    kind: "action_arguments" as const,
    codecIdentity: "flarex.codec/canonical-flarex-value/v1" as const,
    objectKey:
      `execution-evidence-body/v1/action_arguments/${"01".repeat(32)}`,
    byteLength: BigInt(canonicalArguments.canonicalBytes.byteLength),
    sha256: canonicalArguments.sha256,
  });
  const subject = Object.freeze({});
  const execution = Object.freeze({
    subject,
    invocation: Object.freeze({
      scopeId: "scope-1",
      requestKey: "request-1",
      invocationId: "00000000-0000-0000-0000-000000000001",
      requestIdentitySha256: new Uint8Array(32).fill(1),
      applicationRevisionId: "revision-1",
      candidateSha256,
      actionFunctionPath: "orders:place",
      actionBindingSha256,
      executionIdentitySha256: executionIdentity.sha256,
      compatibilityDate: "2026-06-14",
      hostPolicySha256,
      arguments: argumentReference,
      lifecycle: "executing" as const,
      executionGeneration: 2n,
      randomSeedSha256,
      invocationTime: new Date(1_800_000_000_000),
      executionDeadline: new Date(1_800_000_030_000),
      lastEffectOrdinal: 0n,
      cancellationRequestedAt: null,
      result: null,
      terminalCode: null,
      admittedAt: new Date(1_799_999_999_000),
      updatedAt: new Date(1_800_000_000_000),
      terminalAt: null,
    }),
  });
  const artifact = Object.freeze({
    runtime: "dynamic-worker" as const,
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
  });
  const fn = Object.freeze({
    path: "orders:place",
    executionModule: artifact.executionModule,
    kind: "action" as const,
    visibility: "public" as const,
    argsValidator: { type: "any" as const },
    returnsValidator: null,
  });
  const target = Object.freeze({
    target: Object.freeze({}),
    binding: Object.freeze({
      scopeId: "scope-1",
      applicationRevisionId: "revision-1",
      candidateSha256,
      actionBindingSha256,
      functionPath: "orders:place",
      compatibilityDate: "2026-06-14",
    }),
    runtimeTargetSha256: new Uint8Array(32).fill(7),
    hostPolicySha256,
    artifact,
    function: fn,
  });
  const definition = Object.freeze({
    compatibilityDate: "2026-06-14",
    mainModule: "main.js",
    modules: Object.freeze({ "main.js": "export default {};" }),
    env: Object.freeze({}),
    limits: Object.freeze({ cpuMs: 1_000, subRequests: 64 }),
    runtimeTargetSha256Hex: "07".repeat(32),
    hostPolicySha256Hex: "03".repeat(32),
    artifact,
    function: fn,
    wallMilliseconds: 30_000,
    cleanupDrainMilliseconds: 5_000,
    entrypoint: "FlarexEdgeActionExactRuntimeV1" as const,
  });
  const bodyStore = {
    putImmutable: vi.fn(),
    readImmutable: vi.fn(() => Effect.succeed({
      reference: argumentReference,
      bytes: canonicalArguments.canonicalBytes,
    })),
  };
  const live = {
    authority: {
      target: Object.freeze({}),
      authority: Object.freeze({ scopeId: "scope-1" }),
      sha256: {
        hash: () => Effect.succeed(randomSeedSha256),
      },
    },
    bodyStore,
    bodyBudget: Object.freeze({
      maximumBodyBytes: 1_048_576,
      maximumHashBytes: 1_048_576,
    }),
    argumentBudget: Object.freeze({
      maximumBodyBytes: 1_048_576,
      maximumHashBytes: 1_048_576,
    }),
    runtimeArtifacts: Object.freeze({}),
    runtimeBudget: Object.freeze({
      maximumModules: 64,
      maximumObjects: 256,
      maximumObjectBytes: 16 * 1_048_576,
      maximumRawBytes: 16 * 1_048_576,
      maximumHashBytes: 16 * 1_048_576,
    }),
    hostPolicy: Object.freeze({}),
    compatibilityDate: "2026-06-14",
  };
  const input: PrepareActiveApplicationEdgeActionDispatchV1Input = {
    selection: Object.freeze({}) as unknown as
      AuthenticatedActiveApplicationRevisionSelectionV1,
    requestKey: "request-1",
    executionDurationMilliseconds: 30_000,
    randomSeed: new Uint8Array(32).fill(8),
    auth: Object.freeze({ kind: "anonymous" as const }),
  };
  const hostPolicy = Object.freeze({
    identity: "flarex.system/edge-action-host-policy/v1" as const,
    exactRuntimeProfile: "edge-action-exact-runtime-v1" as const,
    syscallAbiIdentity: "flarex.system/edge-action-syscall-abi/v1" as const,
    outboundGatewayIdentity: "flarex.host/edge-action-outbound-gateway/v1" as const,
    callbackBridgeIdentity: "flarex.host/edge-action-callback-bridge/v1" as const,
    allowedOrigins: ["https://api.example.com"],
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 1,
    maximumOutboundRequests: 1,
    maximumConcurrentOutboundRequests: 1,
    maximumWorkerSubrequests: 64,
    maximumArgumentBytes: 1_048_576,
    maximumResultBytes: 1_048_576,
    maximumCallbackArgumentBytes: 1_048_576,
    maximumCallbackResultBytes: 1_048_576,
    maximumUrlBytes: 8_192,
    maximumMethodBytes: 32,
    maximumHeaderCount: 128,
    maximumHeaderBytes: 64 * 1_024,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8 * 1_048_576,
    maximumCumulativeOutboundBodyBytes: 16 * 1_048_576,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true as const,
    allowRunMutation: true as const,
    allowRunAction: false as const,
    allowRedirects: false as const,
    allowStreaming: false as const,
    allowAmbientCredentials: false as const,
    fixedInvocationTime: true as const,
    deterministicRandom: true as const,
    allowNondeterministicCrypto: false as const,
  });
  const bundleLive = {
    evidence: live,
    runner: {
      runPromise: <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.runPromise(effect),
    },
    callbackSystem: {
      runQuery: vi.fn(() => Promise.resolve(null)),
      runMutation: vi.fn(() => Promise.resolve(null)),
    },
    outboundHost: {
      fetch: vi.fn(() => Promise.resolve(new Response("ok"))),
    },
  };
  return {
    execution,
    target,
    definition,
    hostPolicy,
    live,
    bundleLive,
    input,
  } as const;
}

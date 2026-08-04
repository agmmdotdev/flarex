import {
  ApplicationActionInvocationMissingV1Error,
  ApplicationActionLifecycleConflictV1Error,
  type ApplicationActionInvocationProjectionV1,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import type {
  AuthenticatedActiveApplicationRevisionSelectionV1,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import { Cause, Effect, Exit, Result } from "effect";
import {
  EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
} from "flarex-protocol/edge-action-exact-runtime";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  admit: vi.fn(),
  inspect: vi.fn(),
  recover: vi.fn(),
  targetCurrent: vi.fn(),
  prepare: vi.fn(),
  issueBundle: vi.fn(),
  issueSettlement: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("../src/actionAdmissionSystemV1", async importOriginal => ({
  ...await importOriginal<Readonly<Record<string, unknown>>>(),
  admitActiveApplicationActionV1: operations.admit,
  inspectActiveApplicationActionInvocationV1: operations.inspect,
  recoverExpiredActiveApplicationActionExecutionV1: operations.recover,
  isActiveApplicationActionInvocationTargetCurrentV1:
    operations.targetCurrent,
  prepareActiveApplicationEdgeActionDispatchV1: operations.prepare,
  settleActiveApplicationEdgeActionV1: operations.settle,
}));

vi.mock("../src/edgeActionDispatchCapabilityBundleV1", async importOriginal => ({
  ...await importOriginal<Readonly<Record<string, unknown>>>(),
  issueActiveApplicationEdgeActionCapabilityBundleV1: operations.issueBundle,
  issueActiveApplicationEdgeActionSettlementCapabilityV1:
    operations.issueSettlement,
}));

import {
  invokeApplicationActionV1,
  makeApplicationActionSystemV1Layer,
  type ApplicationActionSystemLiveV1,
} from "../src/actionSystemV1";

describe("SAP07 action System composition", () => {
  it("selects once, dispatches one opaque bundle, and durably completes", async () => {
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.admitted,
    }));
    operations.prepare.mockReturnValue(Effect.succeed(fixture.prepared));
    operations.issueBundle.mockReturnValue(Effect.succeed(fixture.bundle));
    operations.issueSettlement.mockReturnValue(
      Effect.succeed(fixture.settlement),
    );
    operations.settle.mockReturnValue(Effect.succeed({
      ...fixture.admitted,
      lifecycle: "completed",
      result: fixture.resultReference,
    }));

    const result = await runStandard(fixture);

    expect(result).toEqual({
      status: "completed",
      disposition: "published",
      invocationId: fixture.admitted.invocationId,
      value: { sent: true },
    });
    expect(fixture.coordinator.dispatch).toHaveBeenCalledWith(fixture.bundle);
    expect(operations.issueSettlement).toHaveBeenCalledWith(fixture.bundle);
    expect(operations.settle).toHaveBeenCalledWith(
      fixture.settlement,
      expect.objectContaining({ lifecycle: "completed" }),
      fixture.live.capabilities.evidence,
    );
  });

  it("returns an executing replay without issuing another Worker", async () => {
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "replayed",
      invocation: { ...fixture.admitted, lifecycle: "executing" },
    }));

    const result = await runStandard(fixture);

    expect(result).toMatchObject({
      status: "notCompleted",
      disposition: "replayed",
      lifecycle: "executing",
    });
    expect(operations.prepare).not.toHaveBeenCalled();
    expect(fixture.coordinator.dispatch).not.toHaveBeenCalled();
  });

  it("does not claim an admitted replay when its active target authority is not current", async () => {
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "replayed",
      invocation: fixture.admitted,
    }));
    operations.targetCurrent.mockReturnValue(Effect.succeed(false));

    const result = await runStandard(fixture);

    expect(result).toMatchObject({
      status: "notCompleted",
      disposition: "replayed",
      lifecycle: "admitted",
    });
    expect(operations.prepare).not.toHaveBeenCalled();
    expect(fixture.coordinator.dispatch).not.toHaveBeenCalled();
  });

  it("replays a completed request before consulting a later active target", async () => {
    const fixture = makeFixture();
    const args = await canonicalizeFlarexValueV1({ message: "hello" });
    const identity = await canonicalizeFlarexValueV1({ kind: "anonymous" });
    const result = await canonicalizeFlarexValueV1({ sent: true });
    const resultReference = Object.freeze({
      ...fixture.resultReference,
      kind: "action_result" as const,
      byteLength: BigInt(result.canonicalBytes.byteLength),
      sha256: result.sha256,
    });
    operations.inspect.mockReturnValue(Effect.succeed({
      ...fixture.admitted,
      arguments: Object.freeze({
        ...fixture.admitted.arguments,
        byteLength: BigInt(args.canonicalBytes.byteLength),
        sha256: args.sha256,
      }),
      executionIdentitySha256: identity.sha256,
      lifecycle: "completed",
      result: resultReference,
    }));
    fixture.bodyStore.readImmutable.mockReturnValue(
      Effect.succeed(Object.freeze({
        reference: resultReference,
        bytes: result.canonicalBytes,
      })),
    );

    const replay = await runStandard(fixture);

    expect(replay).toEqual({
      status: "completed",
      disposition: "replayed",
      invocationId: fixture.admitted.invocationId,
      value: { sent: true },
    });
    expect(operations.admit).not.toHaveBeenCalled();
    expect(operations.targetCurrent).not.toHaveBeenCalled();
    expect(fixture.coordinator.dispatch).not.toHaveBeenCalled();
  });

  it("recovers an expired no-dispatch execution and resumes the current target", async () => {
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "replayed",
      invocation: { ...fixture.admitted, lifecycle: "executing" },
    }));
    operations.recover.mockReturnValue(Effect.succeed(fixture.admitted));
    operations.prepare.mockReturnValue(Effect.succeed(fixture.prepared));
    operations.issueBundle.mockReturnValue(Effect.succeed(fixture.bundle));
    operations.issueSettlement.mockReturnValue(
      Effect.succeed(fixture.settlement),
    );
    operations.settle.mockReturnValue(Effect.succeed({
      ...fixture.admitted,
      lifecycle: "completed",
      result: fixture.resultReference,
    }));

    const recovered = await runStandard(fixture);

    expect(recovered.status).toBe("completed");
    expect(operations.recover).toHaveBeenCalledOnce();
    expect(fixture.coordinator.dispatch).toHaveBeenCalledOnce();
  });

  it("projects expired possible-dispatch recovery as uncertain without another Worker", async () => {
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "replayed",
      invocation: { ...fixture.admitted, lifecycle: "executing" },
    }));
    operations.recover.mockReturnValue(Effect.succeed({
      ...fixture.admitted,
      lifecycle: "uncertain",
      terminalCode: "execution_expired_after_possible_dispatch",
    }));

    const recovered = await runStandard(fixture);

    expect(recovered).toMatchObject({
      status: "notCompleted",
      lifecycle: "uncertain",
      terminalCode: "execution_expired_after_possible_dispatch",
    });
    expect(fixture.coordinator.dispatch).not.toHaveBeenCalled();
  });

  it("falls back to durable uncertainty when dispatch evidence may exist", async () => {
    const fixture = makeFixture({ hostFailure: "userCodeFailed" });
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.admitted,
    }));
    operations.prepare.mockReturnValue(Effect.succeed(fixture.prepared));
    operations.issueBundle.mockReturnValue(Effect.succeed(fixture.bundle));
    operations.issueSettlement.mockReturnValue(
      Effect.succeed(fixture.settlement),
    );
    operations.settle
      .mockReturnValueOnce(Effect.fail(
        new ApplicationActionLifecycleConflictV1Error({
          operation: "settle",
          expected: "uncertain_after_possible_dispatch",
          actual: "failed",
        }),
      ))
      .mockReturnValueOnce(Effect.succeed({
        ...fixture.admitted,
        lifecycle: "uncertain",
        terminalCode: "edge_action_userCodeFailed_uncertain",
      }));

    const result = await runStandard(fixture);

    expect(result).toMatchObject({
      status: "notCompleted",
      disposition: "settled",
      lifecycle: "uncertain",
      terminalCode: "edge_action_userCodeFailed_uncertain",
    });
    expect(operations.settle).toHaveBeenCalledTimes(2);
  });

  it("does not publish success over durable possible-dispatch evidence", async () => {
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.admitted,
    }));
    operations.prepare.mockReturnValue(Effect.succeed(fixture.prepared));
    operations.issueBundle.mockReturnValue(Effect.succeed(fixture.bundle));
    operations.issueSettlement.mockReturnValue(
      Effect.succeed(fixture.settlement),
    );
    operations.settle
      .mockReturnValueOnce(Effect.fail(
        new ApplicationActionLifecycleConflictV1Error({
          operation: "settle",
          expected: "uncertain_after_possible_dispatch",
          actual: "completed",
        }),
      ))
      .mockReturnValueOnce(Effect.succeed({
        ...fixture.admitted,
        lifecycle: "uncertain",
        terminalCode: "edge_action_success_uncertain",
      }));

    const result = await runStandard(fixture);

    expect(result).toMatchObject({
      status: "notCompleted",
      disposition: "settled",
      lifecycle: "uncertain",
      terminalCode: "edge_action_success_uncertain",
    });
    expect(operations.settle).toHaveBeenCalledTimes(2);
  });

  it("preserves an unexpected artifact-host defect in the full Cause", async () => {
    const defect = new Error("unexpected artifact-host defect");
    const fixture = makeFixture();
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.admitted,
    }));
    operations.prepare.mockReturnValue(Effect.succeed(fixture.prepared));
    operations.issueBundle.mockReturnValue(Effect.succeed(fixture.bundle));
    operations.issueSettlement.mockReturnValue(
      Effect.succeed(fixture.settlement),
    );
    fixture.coordinator.dispatch.mockReturnValueOnce(Effect.die(defect));

    const exit = await Effect.runPromiseExit(Effect.scoped(
      invokeApplicationActionV1(
        fixture.selection as unknown as
          AuthenticatedActiveApplicationRevisionSelectionV1,
        TransactionFunctionPathV1Schema.make("actions:send"),
        { message: "hello" },
        TransactionRequestKeyV1Schema.make("sap07:test:request"),
      ).pipe(Effect.provide(makeApplicationActionSystemV1Layer(fixture.live))),
    ));

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected the artifact-host defect to escape.");
    }
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);
    expect(operations.settle).not.toHaveBeenCalled();
  });
});

async function runStandard(fixture: ReturnType<typeof makeFixture>) {
  return await Effect.runPromise(Effect.scoped(
    invokeApplicationActionV1(
      fixture.selection as unknown as
        AuthenticatedActiveApplicationRevisionSelectionV1,
      TransactionFunctionPathV1Schema.make("actions:send"),
      { message: "hello" },
      TransactionRequestKeyV1Schema.make("sap07:test:request"),
    ).pipe(Effect.provide(makeApplicationActionSystemV1Layer(fixture.live))),
  ));
}

function makeFixture(options: Readonly<{
  readonly hostFailure?: "userCodeFailed";
}> = {}) {
  operations.admit.mockReset();
  operations.inspect.mockReset();
  operations.recover.mockReset();
  operations.targetCurrent.mockReset();
  operations.prepare.mockReset();
  operations.issueBundle.mockReset();
  operations.issueSettlement.mockReset();
  operations.settle.mockReset();
  operations.inspect.mockReturnValue(Effect.fail(
    new ApplicationActionInvocationMissingV1Error({
      requestKey: "sap07:test:request",
    }),
  ));
  operations.recover.mockReturnValue(Effect.fail(
    new ApplicationActionLifecycleConflictV1Error({
      operation: "recover",
      expected: "expired",
      actual: "not_expired",
    }),
  ));
  operations.targetCurrent.mockReturnValue(Effect.succeed(true));
  const selection = Object.freeze({ selection: true });
  const admitted = invocation();
  const prepared = Object.freeze({ prepared: true });
  const bundle = Object.freeze({ bundle: true });
  const settlement = Object.freeze({ settlement: true });
  const resultReference = admitted.arguments;
  const coordinator = {
    dispatch: vi.fn(() => Effect.succeed(options.hostFailure === undefined
      ? Object.freeze({
          kind: "success" as const,
          result: Object.freeze({
            format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
            version: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
            value: Object.freeze({ sent: true }),
          }),
        })
      : Object.freeze({
          kind: "failure" as const,
          reason: options.hostFailure,
        }))),
  };
  const bodyStore = Object.freeze({
    putImmutable: vi.fn(),
    readImmutable: vi.fn(),
  });
  const authority = Object.freeze({
    target: Object.freeze({}),
    authority: Object.freeze({ scopeId: "scope-1" }),
    sha256: Object.freeze({
      hash: () => Effect.succeed(new Uint8Array(32).fill(4)),
    }),
  });
  const budget = Object.freeze({
    maximumBodyBytes: 1_048_576,
    maximumHashBytes: 1_048_576,
  });
  const evidence = Object.freeze({ bodyStore, bodyBudget: budget, authority });
  const live = Object.freeze({
    admission: Object.freeze({
      bodyStore,
      argumentBudget: budget,
      authority: Object.freeze({ target: authority.target, sha256: authority.sha256 }),
    }),
    dispatch: Object.freeze({
      authority,
      bodyStore,
      argumentBudget: budget,
      runtimeArtifacts: Object.freeze({}),
      runtimeBudget: Object.freeze({
        maximumModules: 8,
        maximumObjects: 16,
        maximumObjectBytes: 1_048_576,
        maximumRawBytes: 2_097_152,
        maximumHashBytes: 2_097_152,
      }),
      hostPolicy: hostPolicy(),
      compatibilityDate: "2026-08-04",
    }),
    capabilities: Object.freeze({
      evidence,
      runner: Object.freeze({ runPromise: Effect.runPromise }),
      callbackSystem: Object.freeze({
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      }),
      outboundHost: Object.freeze({ fetch: vi.fn() }),
    }),
    coordinator,
    hostPolicyEncodingBudget: Object.freeze({
      maximumOrigins: 4,
      maximumOriginBytes: 256,
      maximumCanonicalBytes: 16_384,
    }),
    executionContextFactory: () => Object.freeze({
      invocationId: "00000000-0000-4000-8000-000000000071",
      executionDurationMilliseconds: 30_000,
      randomSeed: new Uint8Array(32).fill(7),
      auth: Object.freeze({ kind: "anonymous" as const }),
    }),
  }) as unknown as ApplicationActionSystemLiveV1;
  return {
    admitted,
    bodyStore,
    bundle,
    coordinator,
    live,
    prepared,
    resultReference,
    selection,
    settlement,
  };
}

function invocation(): ApplicationActionInvocationProjectionV1 {
  const reference = Object.freeze({
    storeIdentity: "flarex.r2/execution-evidence-body/v1" as const,
    kind: "action_arguments" as const,
    codecIdentity: "flarex.codec/canonical-flarex-value/v1" as const,
    objectKey: `execution-evidence-body/v1/action_arguments/${"01".repeat(32)}`,
    byteLength: 2n,
    sha256: new Uint8Array(32).fill(1),
  });
  return Object.freeze({
    scopeId: "scope-1",
    requestKey: "sap07:test:request",
    invocationId: "00000000-0000-4000-8000-000000000071",
    requestIdentitySha256: new Uint8Array(32).fill(2),
    applicationRevisionId: "revision-1",
    candidateSha256: new Uint8Array(32).fill(3),
    actionFunctionPath: "actions:send",
    actionBindingSha256: new Uint8Array(32).fill(4),
    executionIdentitySha256: new Uint8Array(32).fill(5),
    compatibilityDate: "2026-08-04",
    hostPolicySha256: new Uint8Array(32).fill(6),
    arguments: reference,
    lifecycle: "admitted",
    executionGeneration: 0n,
    randomSeedSha256: null,
    invocationTime: null,
    executionDeadline: null,
    lastEffectOrdinal: 0n,
    cancellationRequestedAt: null,
    result: null,
    terminalCode: null,
    admittedAt: new Date(1_800_000_000_000),
    updatedAt: new Date(1_800_000_000_000),
    terminalAt: null,
  }) as unknown as ApplicationActionInvocationProjectionV1;
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

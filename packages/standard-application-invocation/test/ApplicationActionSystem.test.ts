import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  ApplicationActionCapabilitySessionError,
} from "flarex-backend/internal/application-action-runner";
import { ApplicationExecutionHostError } from
  "flarex-backend/internal/application-execution-host";
import {
  makeExecutionEvidenceBodyReferenceV1,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  ApplicationActionInvocationMissingV1Error,
  ApplicationActionRequestKeyConflictV1Error,
  type ApplicationAuthorityActionInvocationProjection,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";

const operations = vi.hoisted(() => ({
  select: vi.fn(),
  inspect: vi.fn(),
  admit: vi.fn(),
  recover: vi.fn(),
  prepare: vi.fn(),
  dispatch: vi.fn(),
  settle: vi.fn(),
}));

vi.mock(
  "@flarex/persistence-postgres/internal/application-action-admission",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    selectApplicationActionAdmission: operations.select,
  }),
);

vi.mock(
  "@flarex/persistence-postgres/internal/application-action-authority-v1",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    inspectApplicationAuthorityActionInvocation: operations.inspect,
    admitApplicationAuthorityActionInvocation: operations.admit,
    recoverExpiredApplicationAuthorityActionExecution: operations.recover,
  }),
);

vi.mock(
  "../src/ApplicationActionHostComposition",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    prepareApplicationActionDispatch: operations.prepare,
    dispatchPreparedApplicationAction: operations.dispatch,
    settlePreparedApplicationAction: operations.settle,
  }),
);

import {
  invokeApplicationAction,
  makeApplicationActionSystemLayer,
  type ApplicationActionSystemLive,
} from "../src/ApplicationActionSystem";

describe("Application action System", () => {
  it("connects selection, Application admission, host dispatch and settlement", async () => {
    const fixture = await systemFixture();
    operations.inspect.mockReturnValue(Effect.fail(
      new ApplicationActionInvocationMissingV1Error({
        requestKey: fixture.invocation.requestKey,
      }),
    ));
    operations.select.mockReturnValue(Effect.succeed(fixture.admission));
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.invocation,
    }));
    operations.prepare.mockReturnValue(Effect.succeed({
      bundle: fixture.bundle,
      settlement: fixture.settlement,
    }));
    operations.dispatch.mockReturnValue(Effect.succeed({ delivered: true }));
    operations.settle.mockReturnValue(Effect.succeed({
      ...fixture.invocation,
      lifecycle: "completed",
      result: fixture.resultReference,
    }));

    const result = await run(fixture, { message: "hello" });

    expect(result).toEqual({
      status: "completed",
      disposition: "published",
      invocationId: fixture.invocation.invocationId,
      value: { delivered: true },
    });
    expect(fixture.activationRead).toHaveBeenCalledOnce();
    expect(operations.select).toHaveBeenCalledOnce();
    expect(operations.admit).toHaveBeenCalledOnce();
    expect(operations.prepare).toHaveBeenCalledOnce();
    expect(operations.dispatch).toHaveBeenCalledOnce();
    expect(operations.settle).toHaveBeenCalledOnce();
  });

  it("replays a completed row without reading active selection or loading a Worker", async () => {
    const fixture = await systemFixture();
    operations.inspect.mockReturnValue(Effect.succeed({
      ...fixture.invocation,
      lifecycle: "completed",
      result: fixture.resultReference,
    }));

    const result = await run(fixture, { message: "hello" });

    expect(result).toEqual({
      status: "completed",
      disposition: "replayed",
      invocationId: fixture.invocation.invocationId,
      value: { replayed: true },
    });
    expect(fixture.activationRead).not.toHaveBeenCalled();
    expect(operations.select).not.toHaveBeenCalled();
    expect(operations.prepare).not.toHaveBeenCalled();
    expect(operations.dispatch).not.toHaveBeenCalled();
  });

  it("rejects conflicting request-key reuse before reading active selection", async () => {
    const fixture = await systemFixture();
    operations.inspect.mockReturnValue(Effect.succeed(fixture.invocation));

    const failure = await Effect.runPromise(Effect.scoped(Effect.flip(
      invokeApplicationAction(
        TransactionFunctionPathV1Schema.make("users:notify"),
        { message: "conflicting" },
        TransactionRequestKeyV1Schema.make(fixture.invocation.requestKey),
      ).pipe(Effect.provide(makeApplicationActionSystemLayer(fixture.live))),
    )));

    expect(failure).toBeInstanceOf(ApplicationActionRequestKeyConflictV1Error);
    expect(fixture.activationRead).not.toHaveBeenCalled();
    expect(operations.select).not.toHaveBeenCalled();
    expect(operations.prepare).not.toHaveBeenCalled();
    expect(operations.dispatch).not.toHaveBeenCalled();
  });

  it("fails closed when an admitted row no longer matches the active authority", async () => {
    const fixture = await systemFixture();
    operations.inspect.mockReturnValue(Effect.succeed(fixture.invocation));
    operations.select.mockReturnValue(Effect.succeed({
      ...fixture.admission,
      executionAuthority: {
        ...fixture.admission.executionAuthority,
        sha256: new Uint8Array(32).fill(0xee),
      },
    }));

    const result = await run(fixture, { message: "hello" });

    expect(result).toMatchObject({
      status: "notCompleted",
      disposition: "replayed",
      lifecycle: "admitted",
    });
    expect(fixture.activationRead).toHaveBeenCalledOnce();
    expect(operations.prepare).not.toHaveBeenCalled();
    expect(operations.dispatch).not.toHaveBeenCalled();
  });

  it("settles cleanup uncertainty as an uncertain durable outcome", async () => {
    const fixture = await systemFixture();
    operations.inspect.mockReturnValue(Effect.fail(
      new ApplicationActionInvocationMissingV1Error({
        requestKey: fixture.invocation.requestKey,
      }),
    ));
    operations.select.mockReturnValue(Effect.succeed(fixture.admission));
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.invocation,
    }));
    operations.prepare.mockReturnValue(Effect.succeed({
      bundle: fixture.bundle,
      settlement: fixture.settlement,
    }));
    operations.dispatch.mockReturnValue(Effect.fail(
      new ApplicationActionCapabilitySessionError({
        reason: "cleanupUncertain",
      }),
    ));
    operations.settle.mockReturnValue(Effect.succeed({
      ...fixture.invocation,
      lifecycle: "uncertain",
      terminalCode: "application_action_cleanupUncertain",
    }));

    const result = await run(fixture, { message: "hello" });

    expect(result).toMatchObject({
      status: "notCompleted",
      disposition: "settled",
      lifecycle: "uncertain",
    });
    expect(operations.settle).toHaveBeenCalledWith(
      fixture.settlement,
      {
        lifecycle: "uncertain",
        terminalCode: "application_action_cleanupUncertain",
      },
      fixture.live.host.evidence,
    );
  });

  it("durably settles and preserves a structured Application error", async () => {
    const fixture = await systemFixture();
    operations.inspect.mockReturnValue(Effect.fail(
      new ApplicationActionInvocationMissingV1Error({
        requestKey: fixture.invocation.requestKey,
      }),
    ));
    operations.select.mockReturnValue(Effect.succeed(fixture.admission));
    operations.admit.mockReturnValue(Effect.succeed({
      disposition: "inserted",
      invocation: fixture.invocation,
    }));
    operations.prepare.mockReturnValue(Effect.succeed({
      bundle: fixture.bundle,
      settlement: fixture.settlement,
    }));
    const structured = new ApplicationExecutionHostError({
      operation: "action",
      reason: "applicationError",
      applicationError: Object.freeze({ code: "CLOSED", message: "closed" }),
    });
    operations.dispatch.mockReturnValue(Effect.fail(structured));
    operations.settle.mockReturnValue(Effect.succeed({
      ...fixture.invocation,
      lifecycle: "failed",
      terminalCode: "application_action_applicationError",
    }));

    const failure = await Effect.runPromise(Effect.scoped(Effect.flip(
      invokeApplicationAction(
        TransactionFunctionPathV1Schema.make("users:notify"),
        { message: "hello" },
        TransactionRequestKeyV1Schema.make(fixture.invocation.requestKey),
      ).pipe(Effect.provide(makeApplicationActionSystemLayer(fixture.live))),
    )));

    expect(failure).toBe(structured);
    expect(operations.settle).toHaveBeenCalledOnce();
  });
});

async function run(
  fixture: Awaited<ReturnType<typeof systemFixture>>,
  args: unknown,
) {
  return Effect.runPromise(Effect.scoped(
    invokeApplicationAction(
      TransactionFunctionPathV1Schema.make("users:notify"),
      args,
      TransactionRequestKeyV1Schema.make(fixture.invocation.requestKey),
    ).pipe(Effect.provide(makeApplicationActionSystemLayer(fixture.live))),
  ));
}

async function systemFixture() {
  vi.clearAllMocks();
  const argumentsValue = await canonicalizeFlarexValueV1({ message: "hello" });
  const replayValue = await canonicalizeFlarexValueV1({ replayed: true });
  const argumentsReference = Result.getOrThrow(
    makeExecutionEvidenceBodyReferenceV1(
      "action_arguments",
      argumentsValue.sha256,
      argumentsValue.canonicalBytes.byteLength,
    ),
  );
  const resultReference = Result.getOrThrow(
    makeExecutionEvidenceBodyReferenceV1(
      "action_result",
      replayValue.sha256,
      replayValue.canonicalBytes.byteLength,
    ),
  );
  const selection = Object.freeze({});
  const authoritySha256 = new Uint8Array(32).fill(0x11);
  const executionIdentitySha256 = (await canonicalizeFlarexValueV1({
    kind: "anonymous",
  })).sha256;
  const hostPolicy = policy();
  const hostPolicySha256 = new Uint8Array(32).fill(0x22);
  const admission = {
    selection,
    basis: {
      authority: { scopeId: "scope-action" },
      compatibilityDate: "2026-06-14",
    },
    executionAuthority: {
      sha256: authoritySha256,
    },
  } as unknown as Parameters<typeof operations.select.mockReturnValue>[0];
  const invocation = {
    scopeId: "scope-action",
    requestKey: "request-action",
    invocationId: "00000000-0000-4000-8000-000000000901",
    requestIdentitySha256: new Uint8Array(32).fill(0x31),
    actionFunctionPath: "users:notify",
    executionIdentitySha256,
    compatibilityDate: "2026-06-14",
    hostPolicySha256,
    arguments: argumentsReference,
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
    executionAuthorityGeneration: "application_v1",
    executionAuthority: { sha256: authoritySha256 },
  } as unknown as ApplicationAuthorityActionInvocationProjection;
  const activationRead = vi.fn(() => Effect.succeed({ selection }));
  const bodyStore = {
    putImmutable: vi.fn(() => Effect.succeed(argumentsReference)),
    readImmutable: vi.fn(() => Effect.succeed({
      bytes: replayValue.canonicalBytes,
    })),
  };
  const live = {
    activation: { readActive: activationRead },
    admission: {},
    host: {
      evidence: {
        bodyStore,
        bodyBudget: {
          maximumBodyBytes: 1_048_576,
          maximumHashBytes: 1_048_576,
        },
        authority: {
          sha256: { hash: () => Effect.succeed(hostPolicySha256) },
        },
      },
      hostPolicy,
    },
    hostPolicyEncodingBudget: {
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    },
    executionContextFactory: () => ({
      invocationId: invocation.invocationId,
      executionDurationMilliseconds: 30_000,
      randomSeed: new Uint8Array(32).fill(3),
      auth: { kind: "anonymous" },
    }),
  } as unknown as ApplicationActionSystemLive;
  return {
    admission,
    invocation,
    resultReference,
    bundle: Object.freeze({}),
    settlement: Object.freeze({}),
    activationRead,
    live,
  };
}

function policy() {
  return {
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: [],
    cpuMilliseconds: 100,
    wallMilliseconds: 1_000,
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
  } as const;
}

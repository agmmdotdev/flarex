import { describe, expect, it, vi } from "vitest";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";

import {
  makeEdgeActionOutboundGatewayV1,
  type EdgeActionOutboundEvidencePortV1,
} from "../src/edgeActionOutboundGatewayV1";
import { makeEdgeActionHostSyscallSequencerV1 } from
  "../src/edgeActionHostSyscallSequencerV1";

describe("edge action outbound gateway v1", () => {
  it("binds the exact request digest before declared dispatch and confirmation", async () => {
    const events: string[] = [];
    const evidence = evidencePort(events);
    const host = vi.fn(async () => {
      events.push("fetch");
      return new Response("ok", { status: 200 });
    });
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-1",
      policy: policy(),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: host },
    });
    const response = await gateway.fetch("https://api.example.com/orders", {
      method: "POST",
      body: "request",
    });
    expect(await response.text()).toBe("ok");
    expect(events).toEqual(["hash", "prepare", "declare", "fetch", "confirm"]);
    const prepareInput = vi.mocked(evidence.prepare).mock.calls[0]?.[0];
    expect(prepareInput?.stableEffectKey).toMatch(
      /^action:request-1:http:1:[0-9a-f]{64}$/,
    );
    expect(prepareInput?.canonicalRequestBytes).toBeInstanceOf(Uint8Array);
  });

  it("rejects denied origins and ambient credentials before evidence or dispatch", async () => {
    const evidence = evidencePort([]);
    const host = vi.fn(() => Promise.resolve(new Response("unexpected")));
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-1",
      policy: policy(),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: host },
    });
    await expect(gateway.fetch("https://denied.example.com"))
      .rejects.toMatchObject({ reason: "originDenied", phase: "beforeDispatch" });
    await expect(gateway.fetch("https://api.example.com", {
      headers: { authorization: "secret" },
    })).rejects.toMatchObject({ reason: "invalidRequest", phase: "beforeDispatch" });
    expect(evidence.prepare).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
  });

  it("marks durable uncertainty when the host outcome is lost after declaration", async () => {
    const events: string[] = [];
    const evidence = evidencePort(events);
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-1",
      policy: policy(),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: () => Promise.reject(new Error("connection lost")) },
    });
    await expect(gateway.fetch("https://api.example.com"))
      .rejects.toMatchObject({
        reason: "dispatchUncertain",
        phase: "afterDispatch",
      });
    expect(evidence.markUncertain).toHaveBeenCalledWith(
      1n,
      "edge_action_dispatch_uncertain",
    );
    expect(events).toEqual(["hash", "prepare", "declare", "uncertain"]);
    await expect(gateway.drain()).rejects.toMatchObject({
      reason: "dispatchUncertain",
    });
  });

  it("stops reading and cancels an oversized request stream before evidence or dispatch", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel: cancelled,
    });
    const request = new Request("https://api.example.com/orders", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { readonly duplex: "half" });
    const evidence = evidencePort([]);
    const host = vi.fn(() => Promise.resolve(new Response("unexpected")));
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-1",
      policy: policy({ maximumOutboundRequestBodyBytes: 4 }),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: host },
    });
    await expect(gateway.fetch(request)).rejects.toMatchObject({
      reason: "resourceExceeded",
      phase: "beforeDispatch",
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(evidence.prepare).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
    await expect(gateway.drain()).rejects.toMatchObject({
      reason: "resourceExceeded",
      phase: "beforeDispatch",
    });
  });

  it("bounds response streaming and poisons cleanup after declared dispatch", async () => {
    const cancelled = vi.fn();
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel: cancelled,
    });
    const evidence = evidencePort([]);
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-1",
      policy: policy({ maximumOutboundResponseBodyBytes: 4 }),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: () => Promise.resolve(new Response(responseBody)) },
    });
    await expect(gateway.fetch("https://api.example.com/orders"))
      .rejects.toMatchObject({
        reason: "dispatchUncertain",
        phase: "afterDispatch",
      });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(evidence.markUncertain).toHaveBeenCalledWith(
      1n,
      "edge_action_dispatch_uncertain",
    );
    await expect(gateway.drain()).rejects.toMatchObject({
      reason: "dispatchUncertain",
    });
  });

  it("rejects oversized URL and header framing before evidence", async () => {
    const evidence = evidencePort([]);
    const host = vi.fn(() => Promise.resolve(new Response("unexpected")));
    const urlGateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-1",
      policy: policy({ maximumUrlBytes: 20 }),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: host },
    });
    await expect(urlGateway.fetch("https://api.example.com/orders"))
      .rejects.toMatchObject({ reason: "resourceExceeded" });
    const headerGateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-2",
      policy: policy({ maximumHeaderBytes: 4 }),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence,
      host: { fetch: host },
    });
    await expect(headerGateway.fetch("https://api.example.com", {
      headers: { "x-test": "large" },
    })).rejects.toMatchObject({ reason: "resourceExceeded" });
    expect(evidence.prepare).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
  });

  it("poisons cleanup when user code catches request-count exhaustion", async () => {
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:request-count",
      policy: policy({ maximumOutboundRequests: 1 }),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence: evidencePort([]),
      host: { fetch: () => Promise.resolve(new Response("ok")) },
    });
    await gateway.fetch("https://api.example.com/first");
    await expect(gateway.fetch("https://api.example.com/second"))
      .rejects.toMatchObject({ reason: "resourceExceeded" });
    await expect(gateway.drain()).rejects.toMatchObject({
      reason: "resourceExceeded",
    });
  });

  it("poisons cleanup when user code catches concurrency exhaustion", async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve;
    });
    const firstResponse = new Promise<Response>(resolve => {
      releaseFirst = () => resolve(new Response("ok"));
    });
    const gateway = makeEdgeActionOutboundGatewayV1({
      stableKeyPrefix: "action:concurrency",
      policy: policy({ maximumConcurrentOutboundRequests: 1 }),
      sequencer: makeEdgeActionHostSyscallSequencerV1(64),
      evidence: evidencePort([]),
      host: { fetch: () => {
        markFirstStarted?.();
        return firstResponse;
      } },
    });
    const first = gateway.fetch("https://api.example.com/first");
    await firstStarted;
    await expect(gateway.fetch(
      "https://api.example.com/second",
    )).rejects.toMatchObject({ reason: "resourceExceeded" });
    releaseFirst?.();
    await first;
    await expect(gateway.drain()).rejects.toMatchObject({
      reason: "resourceExceeded",
    });
  });
});

function evidencePort(events: string[]): EdgeActionOutboundEvidencePortV1 {
  return {
    hash: vi.fn(() => {
      events.push("hash");
      return Promise.resolve(new Uint8Array(32).fill(7));
    }),
    prepare: vi.fn(() => {
      events.push("prepare");
      return Promise.resolve({ effectOrdinal: 1n });
    }),
    declareDispatch: vi.fn(() => {
      events.push("declare");
      return Promise.resolve();
    }),
    failBeforeDispatch: vi.fn(() => {
      events.push("failed");
      return Promise.resolve();
    }),
    confirm: vi.fn(() => {
      events.push("confirm");
      return Promise.resolve();
    }),
    markUncertain: vi.fn(() => {
      events.push("uncertain");
      return Promise.resolve();
    }),
  };
}

function policy(
  overrides: Partial<EdgeActionHostPolicyFrameV1> = {},
): EdgeActionHostPolicyFrameV1 {
  return {
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: ["https://api.example.com"],
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 64,
    maximumOutboundRequests: 16,
    maximumConcurrentOutboundRequests: 4,
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
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
    ...overrides,
  };
}

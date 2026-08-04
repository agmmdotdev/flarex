import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  encodeEdgeActionHostPolicyV1,
  type EdgeActionHostPolicyFrameV1,
} from "../src/edge-action-host-policy-v1";

const BUDGET = Object.freeze({
  maximumOrigins: 8,
  maximumOriginBytes: 256,
  maximumCanonicalBytes: 16_384,
});

describe("edge action host policy v1", () => {
  it("encodes one stable exact policy and changes identity with authority", () => {
    const first = Result.getOrThrow(encodeEdgeActionHostPolicyV1(policy(), BUDGET));
    const alias = Result.getOrThrow(encodeEdgeActionHostPolicyV1({
      ...policy(),
      allowedOrigins: [...policy().allowedOrigins],
    }, BUDGET));
    expect(first.canonicalBytes).toEqual(alias.canonicalBytes);
    const changed = Result.getOrThrow(encodeEdgeActionHostPolicyV1({
      ...policy(),
      maximumSyscalls: 65,
    }, BUDGET));
    expect(digest(first.canonicalBytes)).not.toBe(digest(changed.canonicalBytes));
    expect(Object.isFrozen(first.frame.allowedOrigins)).toBe(true);
  });

  it("rejects noncanonical, duplicate, wildcard, and insecure origins", () => {
    for (const allowedOrigins of [
      ["http://api.example.com"],
      ["https://*.example.com"],
      ["https://api.example.com/path"],
      ["https://api.example.com", "https://api.example.com"],
    ]) {
      expect(Result.isFailure(encodeEdgeActionHostPolicyV1({
        ...policy(),
        allowedOrigins,
      }, BUDGET))).toBe(true);
    }
  });
});

function policy(): EdgeActionHostPolicyFrameV1 {
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
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

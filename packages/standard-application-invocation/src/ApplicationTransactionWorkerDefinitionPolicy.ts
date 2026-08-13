import { Effect, Result } from "effect";
import {
  encodeEdgeActionHostPolicyV1,
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";

const POLICY_ENCODING_BUDGET = Object.freeze({
  maximumOrigins: 1,
  maximumOriginBytes: 1,
  maximumCanonicalBytes: 16_384,
});

const TRANSACTION_WORKER_DEFINITION_POLICY = Object.freeze({
  identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  allowedOrigins: Object.freeze([]),
  cpuMilliseconds: 1,
  wallMilliseconds: 1,
  maximumSyscalls: 1,
  maximumOutboundRequests: 1,
  maximumConcurrentOutboundRequests: 1,
  maximumWorkerSubrequests: 1,
  maximumArgumentBytes: 1,
  maximumResultBytes: 1,
  maximumCallbackArgumentBytes: 1,
  maximumCallbackResultBytes: 1,
  maximumUrlBytes: 1,
  maximumMethodBytes: 1,
  maximumHeaderCount: 1,
  maximumHeaderBytes: 1,
  maximumStatusTextBytes: 1,
  maximumOutboundRequestBodyBytes: 1,
  maximumOutboundResponseBodyBytes: 1,
  maximumCumulativeOutboundBodyBytes: 1,
  cleanupDrainMilliseconds: 1,
  allowRunQuery: true,
  allowRunMutation: true,
  allowRunAction: false,
  allowRedirects: false,
  allowStreaming: false,
  allowAmbientCredentials: false,
  fixedInvocationTime: true,
  deterministicRandom: true,
  allowNondeterministicCrypto: false,
} as const satisfies EdgeActionHostPolicyFrameV1);

export interface ApplicationTransactionWorkerDefinitionPolicy {
  readonly frame: EdgeActionHostPolicyFrameV1;
  readonly sha256: Uint8Array;
}

/**
 * Application transaction Workers do not receive action/outbound capability,
 * but Worker-definition construction still binds the common host-policy frame.
 * Keep one exact inert policy owner for query and mutation definitions.
 */
export const applicationTransactionWorkerDefinitionPolicy = Effect.suspend(() => {
  const encoded = encodeEdgeActionHostPolicyV1(
    TRANSACTION_WORKER_DEFINITION_POLICY,
    POLICY_ENCODING_BUDGET,
  ).pipe(Result.getOrThrow);
  return Effect.promise(() => crypto.subtle.digest(
    "SHA-256",
    encoded.canonicalBytes.slice().buffer,
  )).pipe(Effect.map(buffer => Object.freeze({
    frame: encoded.frame,
    sha256: new Uint8Array(buffer),
  })));
});

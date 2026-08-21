import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

export const EDGE_ACTION_HOST_POLICY_IDENTITY_V1 =
  "flarex.system/edge-action-host-policy/v1" as const;
export const EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1 =
  "edge-action-exact-runtime-v1" as const;
export const EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1 =
  "flarex.system/edge-action-syscall-abi/v1" as const;
export const EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1 =
  "flarex.host/edge-action-outbound-gateway/v1" as const;
export const EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1 =
  "flarex.host/edge-action-callback-bridge/v1" as const;

const UTF8 = new TextEncoder();
const DOMAIN = UTF8.encode(`${EDGE_ACTION_HOST_POLICY_IDENTITY_V1}\0`);

export interface EdgeActionHostPolicyFrameV1 {
  readonly identity: typeof EDGE_ACTION_HOST_POLICY_IDENTITY_V1;
  readonly exactRuntimeProfile: typeof EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1;
  readonly syscallAbiIdentity: typeof EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1;
  readonly outboundGatewayIdentity:
    typeof EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1;
  readonly callbackBridgeIdentity:
    typeof EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1;
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly cpuMilliseconds: number;
  readonly wallMilliseconds: number;
  readonly maximumSyscalls: number;
  readonly maximumOutboundRequests: number;
  readonly maximumConcurrentOutboundRequests: number;
  readonly maximumWorkerSubrequests: number;
  readonly maximumArgumentBytes: number;
  readonly maximumResultBytes: number;
  readonly maximumCallbackArgumentBytes: number;
  readonly maximumCallbackResultBytes: number;
  readonly maximumUrlBytes: number;
  readonly maximumMethodBytes: number;
  readonly maximumHeaderCount: number;
  readonly maximumHeaderBytes: number;
  readonly maximumStatusTextBytes: number;
  readonly maximumOutboundRequestBodyBytes: number;
  readonly maximumOutboundResponseBodyBytes: number;
  readonly maximumCumulativeOutboundBodyBytes: number;
  readonly cleanupDrainMilliseconds: number;
  readonly allowRunQuery: true;
  readonly allowRunMutation: true;
  readonly allowRunAction: false;
  readonly allowRedirects: false;
  readonly allowStreaming: false;
  readonly allowAmbientCredentials: false;
  readonly fixedInvocationTime: true;
  readonly deterministicRandom: true;
  readonly allowNondeterministicCrypto: false;
}

export interface EdgeActionHostPolicyEncodingBudgetV1 {
  readonly maximumOrigins: number;
  readonly maximumOriginBytes: number;
  readonly maximumCanonicalBytes: number;
}

export class EdgeActionHostPolicyV1Error extends Data.TaggedError(
  "EdgeActionHostPolicyV1Error",
)<{
  readonly reason: "invalidBudget" | "invalidPolicy" | "budgetExceeded";
  readonly path: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

const NUMERIC_FIELDS = [
  "cpuMilliseconds",
  "wallMilliseconds",
  "maximumSyscalls",
  "maximumOutboundRequests",
  "maximumConcurrentOutboundRequests",
  "maximumWorkerSubrequests",
  "maximumArgumentBytes",
  "maximumResultBytes",
  "maximumCallbackArgumentBytes",
  "maximumCallbackResultBytes",
  "maximumUrlBytes",
  "maximumMethodBytes",
  "maximumHeaderCount",
  "maximumHeaderBytes",
  "maximumStatusTextBytes",
  "maximumOutboundRequestBodyBytes",
  "maximumOutboundResponseBodyBytes",
  "maximumCumulativeOutboundBodyBytes",
  "cleanupDrainMilliseconds",
] as const;

const BOOLEAN_POLICY = Object.freeze({
  allowRunQuery: true,
  allowRunMutation: true,
  allowRunAction: false,
  allowRedirects: false,
  allowStreaming: false,
  allowAmbientCredentials: false,
  fixedInvocationTime: true,
  deterministicRandom: true,
  allowNondeterministicCrypto: false,
} as const);

export function encodeEdgeActionHostPolicyV1(
  input: unknown,
  budgetInput: unknown,
): Result.Result<
  Readonly<{
    readonly frame: EdgeActionHostPolicyFrameV1;
    readonly canonicalBytes: Uint8Array;
  }>,
  EdgeActionHostPolicyV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureBudget(budgetInput);
    const frame = yield* captureFrame(input, budget);
    const projection = [
      frame.identity,
      frame.exactRuntimeProfile,
      frame.syscallAbiIdentity,
      frame.outboundGatewayIdentity,
      frame.callbackBridgeIdentity,
      frame.allowedOrigins,
      ...NUMERIC_FIELDS.map(field => frame[field]),
      ...Object.keys(BOOLEAN_POLICY).map(
        // SAFETY: Object.keys of the BOOLEAN_POLICY record yields exactly
        // its own policy keys, which are frame fields.
        key => frame[key as keyof typeof BOOLEAN_POLICY],
      ),
    ];
    const body = UTF8.encode(JSON.stringify(projection));
    const byteLength = DOMAIN.byteLength + body.byteLength;
    if (byteLength > budget.maximumCanonicalBytes) {
      return yield* exceeded(
        "$bytes",
        byteLength,
        budget.maximumCanonicalBytes,
      );
    }
    const canonicalBytes = new Uint8Array(byteLength);
    canonicalBytes.set(DOMAIN);
    canonicalBytes.set(body, DOMAIN.byteLength);
    return Object.freeze({ frame, canonicalBytes });
  });
}

export function edgeActionHostPolicyDigestMatchesV1(
  expected: Uint8Array,
  actual: Uint8Array,
): boolean {
  if (
    !isUint8ArrayWithByteLength(expected, 32) ||
    !isUint8ArrayWithByteLength(actual, 32)
  ) return false;
  let difference = 0;
  for (let index = 0; index < 32; index += 1) {
    difference |= expected[index]! ^ actual[index]!;
  }
  return difference === 0;
}

function captureBudget(
  input: unknown,
): Result.Result<
  EdgeActionHostPolicyEncodingBudgetV1,
  EdgeActionHostPolicyV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    Reflect.ownKeys(input).length !== 3 ||
    !isPositiveSafeInteger(input.maximumOrigins) ||
    !isPositiveSafeInteger(input.maximumOriginBytes) ||
    !isPositiveSafeInteger(input.maximumCanonicalBytes)
  ) return failure("invalidBudget", "budget");
  return Result.succeed(Object.freeze({
    maximumOrigins: input.maximumOrigins,
    maximumOriginBytes: input.maximumOriginBytes,
    maximumCanonicalBytes: input.maximumCanonicalBytes,
  }));
}

function captureFrame(
  input: unknown,
  budget: EdgeActionHostPolicyEncodingBudgetV1,
): Result.Result<EdgeActionHostPolicyFrameV1, EdgeActionHostPolicyV1Error> {
  return Result.gen(function* () {
    const expectedKeys = 5 + 1 + NUMERIC_FIELDS.length +
      Reflect.ownKeys(BOOLEAN_POLICY).length;
    if (
      !isNonArrayRecord(input) ||
      Reflect.ownKeys(input).length !== expectedKeys ||
      input.identity !== EDGE_ACTION_HOST_POLICY_IDENTITY_V1 ||
      input.exactRuntimeProfile !== EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1 ||
      input.syscallAbiIdentity !== EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1 ||
      input.outboundGatewayIdentity !== EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1 ||
      input.callbackBridgeIdentity !== EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1
    ) return yield* failure("invalidPolicy", "$policy");
    for (const [key, value] of Object.entries(BOOLEAN_POLICY)) {
      if (input[key] !== value) {
        return yield* failure("invalidPolicy", key);
      }
    }
    const numeric = yield* captureNumericPolicy(input);
    if (
      numeric.maximumConcurrentOutboundRequests >
        numeric.maximumOutboundRequests ||
      numeric.maximumOutboundRequests > numeric.maximumSyscalls ||
      numeric.maximumCumulativeOutboundBodyBytes <
        numeric.maximumOutboundResponseBodyBytes
    ) return yield* failure("invalidPolicy", "limits");
    if (
      !Array.isArray(input.allowedOrigins) ||
      input.allowedOrigins.length > budget.maximumOrigins
    ) return yield* failure("invalidPolicy", "allowedOrigins");
    const origins: string[] = [];
    let previous = "";
    for (let index = 0; index < input.allowedOrigins.length; index += 1) {
      const origin = input.allowedOrigins[index];
      const path = `allowedOrigins[${index}]`;
      if (!isCanonicalHttpsOrigin(origin, budget.maximumOriginBytes)) {
        return yield* failure("invalidPolicy", path);
      }
      if (index > 0 && origin <= previous) {
        return yield* failure("invalidPolicy", path);
      }
      previous = origin;
      origins.push(origin);
    }
    return Object.freeze({
      identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
      exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
      syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
      outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
      callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
      allowedOrigins: Object.freeze(origins),
      cpuMilliseconds: numeric.cpuMilliseconds,
      wallMilliseconds: numeric.wallMilliseconds,
      maximumSyscalls: numeric.maximumSyscalls,
      maximumOutboundRequests: numeric.maximumOutboundRequests,
      maximumConcurrentOutboundRequests:
        numeric.maximumConcurrentOutboundRequests,
      maximumWorkerSubrequests: numeric.maximumWorkerSubrequests,
      maximumArgumentBytes: numeric.maximumArgumentBytes,
      maximumResultBytes: numeric.maximumResultBytes,
      maximumCallbackArgumentBytes: numeric.maximumCallbackArgumentBytes,
      maximumCallbackResultBytes: numeric.maximumCallbackResultBytes,
      maximumUrlBytes: numeric.maximumUrlBytes,
      maximumMethodBytes: numeric.maximumMethodBytes,
      maximumHeaderCount: numeric.maximumHeaderCount,
      maximumHeaderBytes: numeric.maximumHeaderBytes,
      maximumStatusTextBytes: numeric.maximumStatusTextBytes,
      maximumOutboundRequestBodyBytes: numeric.maximumOutboundRequestBodyBytes,
      maximumOutboundResponseBodyBytes:
        numeric.maximumOutboundResponseBodyBytes,
      maximumCumulativeOutboundBodyBytes:
        numeric.maximumCumulativeOutboundBodyBytes,
      cleanupDrainMilliseconds: numeric.cleanupDrainMilliseconds,
      ...BOOLEAN_POLICY,
    });
  });
}

type EdgeActionNumericPolicyV1 = Pick<
  EdgeActionHostPolicyFrameV1,
  (typeof NUMERIC_FIELDS)[number]
>;

function captureNumericPolicy(
  input: Readonly<Record<string, unknown>>,
): Result.Result<EdgeActionNumericPolicyV1, EdgeActionHostPolicyV1Error> {
  return Result.gen(function* () {
    const values = new Map<(typeof NUMERIC_FIELDS)[number], number>();
    for (const field of NUMERIC_FIELDS) {
      const value = input[field];
      if (!isPositiveSafeInteger(value)) {
        return yield* failure("invalidPolicy", field);
      }
      values.set(field, value);
    }
    const read = (field: (typeof NUMERIC_FIELDS)[number]): number => {
      const value = values.get(field);
      if (value === undefined) throw new Error(`Missing captured ${field}.`);
      return value;
    };
    return Object.freeze({
      cpuMilliseconds: read("cpuMilliseconds"),
      wallMilliseconds: read("wallMilliseconds"),
      maximumSyscalls: read("maximumSyscalls"),
      maximumOutboundRequests: read("maximumOutboundRequests"),
      maximumConcurrentOutboundRequests:
        read("maximumConcurrentOutboundRequests"),
      maximumWorkerSubrequests: read("maximumWorkerSubrequests"),
      maximumArgumentBytes: read("maximumArgumentBytes"),
      maximumResultBytes: read("maximumResultBytes"),
      maximumCallbackArgumentBytes: read("maximumCallbackArgumentBytes"),
      maximumCallbackResultBytes: read("maximumCallbackResultBytes"),
      maximumUrlBytes: read("maximumUrlBytes"),
      maximumMethodBytes: read("maximumMethodBytes"),
      maximumHeaderCount: read("maximumHeaderCount"),
      maximumHeaderBytes: read("maximumHeaderBytes"),
      maximumStatusTextBytes: read("maximumStatusTextBytes"),
      maximumOutboundRequestBodyBytes:
        read("maximumOutboundRequestBodyBytes"),
      maximumOutboundResponseBodyBytes:
        read("maximumOutboundResponseBodyBytes"),
      maximumCumulativeOutboundBodyBytes:
        read("maximumCumulativeOutboundBodyBytes"),
      cleanupDrainMilliseconds: read("cleanupDrainMilliseconds"),
    });
  });
}

function isCanonicalHttpsOrigin(
  input: unknown,
  maximumBytes: number,
): input is string {
  if (
    typeof input !== "string" ||
    !isNonBlankString(input) ||
    input.includes("\0") ||
    input.includes("*") ||
    UTF8.encode(input).byteLength > maximumBytes
  ) return false;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.origin === input;
}

function failure(
  reason: EdgeActionHostPolicyV1Error["reason"],
  path: string,
): Result.Result<never, EdgeActionHostPolicyV1Error> {
  return Result.fail(new EdgeActionHostPolicyV1Error({ reason, path }));
}

function exceeded(
  path: string,
  observed: number,
  maximum: number,
): Result.Result<never, EdgeActionHostPolicyV1Error> {
  return Result.fail(new EdgeActionHostPolicyV1Error({
    reason: "budgetExceeded",
    path,
    observed,
    maximum,
  }));
}

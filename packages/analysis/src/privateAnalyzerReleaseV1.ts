import { bytesEqualFullScan, isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1 } from "./privateAnalyzerReleaseV1.generated";

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export const PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1 =
  "flarex.private-source-analyzer-handshake.v1";
export const PRIVATE_ANALYZER_PROTOCOL_VERSION_V1 = 1;
export const PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX =
  "__FLAREX_PRIVATE_ANALYZER_IMPLEMENTATION_V1__";
export const PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX = "__END__";
export const PRIVATE_ANALYZER_IDENTITY_HEX_LENGTH = 64;

export interface PrivateAnalyzerReleaseTupleV1 {
  readonly protocolIdentity: typeof PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1;
  readonly protocolVersion: typeof PRIVATE_ANALYZER_PROTOCOL_VERSION_V1;
  readonly implementationIdentity: string;
  readonly configurationIdentity: string;
}

export interface PrivateAnalyzerReleaseManifestV1 {
  readonly implementationIdentityMarker: string;
  readonly implementationIdentityOffset: number;
  readonly implementationIdentityLength: typeof PRIVATE_ANALYZER_IDENTITY_HEX_LENGTH;
  readonly configurationIdentity: string;
  readonly toolchain: {
    readonly wrangler: string;
    readonly typescript: string;
    readonly effect: string;
    readonly workersTypes: string;
    readonly esbuild: string;
  };
}

export class PrivateAnalyzerReleaseCodecV1Error extends Data.TaggedError(
  "PrivateAnalyzerReleaseCodecV1Error",
)<{
  readonly reason: "malformed" | "identityMismatch";
}> {}

interface DecodedPrivateAnalyzerHandshakeTupleV1 {
  readonly protocolIdentity: string;
  readonly protocolVersion: typeof PRIVATE_ANALYZER_PROTOCOL_VERSION_V1;
  readonly implementationIdentity: string;
  readonly configurationIdentity: string;
}

export { GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1 };

export function isPrivateAnalyzerIdentityV1(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function installedPrivateAnalyzerReleaseTupleV1(): PrivateAnalyzerReleaseTupleV1 {
  const generated = GENERATED_PRIVATE_ANALYZER_RELEASE_MANIFEST_V1;
  const identityStart = generated.implementationIdentityOffset;
  const identityEnd = identityStart + generated.implementationIdentityLength;
  const implementationIdentity = generated.implementationIdentityMarker.slice(
    identityStart,
    identityEnd,
  );
  if (
    generated.implementationIdentityLength !== PRIVATE_ANALYZER_IDENTITY_HEX_LENGTH ||
    identityStart !== PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX.length ||
    generated.implementationIdentityMarker.slice(0, identityStart) !==
      PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX ||
    generated.implementationIdentityMarker.slice(identityEnd) !==
      PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX ||
    !isPrivateAnalyzerIdentityV1(implementationIdentity) ||
    !isPrivateAnalyzerIdentityV1(generated.configurationIdentity)
  ) {
    throw new Error("Private analyzer generated release manifest is malformed.");
  }
  return Object.freeze({
    protocolIdentity: PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1,
    protocolVersion: PRIVATE_ANALYZER_PROTOCOL_VERSION_V1,
    implementationIdentity,
    configurationIdentity: generated.configurationIdentity,
  });
}

export function capturePrivateAnalyzerReleaseTupleV1(
  value: unknown,
): Result.Result<PrivateAnalyzerReleaseTupleV1, PrivateAnalyzerReleaseCodecV1Error> {
  if (!isNonArrayRecord(value) || !hasExactTupleOwnKeys(value)) return malformed();
  const protocolIdentity = value.protocolIdentity;
  const protocolVersion = value.protocolVersion;
  const implementationIdentity = value.implementationIdentity;
  const configurationIdentity = value.configurationIdentity;
  if (
    protocolIdentity !== PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1 ||
    protocolVersion !== PRIVATE_ANALYZER_PROTOCOL_VERSION_V1 ||
    !isPrivateAnalyzerIdentityV1(implementationIdentity) ||
    !isPrivateAnalyzerIdentityV1(configurationIdentity)
  ) return malformed();
  return Result.succeed(Object.freeze({
    protocolIdentity,
    protocolVersion,
    implementationIdentity,
    configurationIdentity,
  }));
}

function hasExactTupleOwnKeys(value: object): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === 4 &&
    Object.hasOwn(value, "protocolIdentity") &&
    Object.hasOwn(value, "protocolVersion") &&
    Object.hasOwn(value, "implementationIdentity") &&
    Object.hasOwn(value, "configurationIdentity");
}

export function canonicalPrivateAnalyzerHandshakeRequestV1(
  identity: PrivateAnalyzerReleaseTupleV1,
): Uint8Array {
  return canonicalHandshakeRequest(identity);
}

function canonicalHandshakeRequest(
  identity: DecodedPrivateAnalyzerHandshakeTupleV1,
): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson({
    configurationIdentity: identity.configurationIdentity,
    implementationIdentity: identity.implementationIdentity,
    protocolIdentity: identity.protocolIdentity,
    protocolVersion: identity.protocolVersion,
  }, releaseInvariant));
}

export function canonicalPrivateAnalyzerHandshakeResponseV1(
  identity: PrivateAnalyzerReleaseTupleV1,
): Uint8Array {
  return canonicalHandshakeResponse(identity);
}

function canonicalHandshakeResponse(
  identity: DecodedPrivateAnalyzerHandshakeTupleV1,
): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson({
    configurationIdentity: identity.configurationIdentity,
    implementationIdentity: identity.implementationIdentity,
    kind: "compatible",
    protocolIdentity: identity.protocolIdentity,
    protocolVersion: identity.protocolVersion,
  }, releaseInvariant));
}

export function decodePrivateAnalyzerHandshakeRequestV1(
  bytes: unknown,
  expected: PrivateAnalyzerReleaseTupleV1,
): Result.Result<PrivateAnalyzerReleaseTupleV1, PrivateAnalyzerReleaseCodecV1Error> {
  return decodeHandshake(bytes, expected, "request");
}

export function decodePrivateAnalyzerHandshakeResponseV1(
  bytes: unknown,
  expected: PrivateAnalyzerReleaseTupleV1,
): Result.Result<PrivateAnalyzerReleaseTupleV1, PrivateAnalyzerReleaseCodecV1Error> {
  return decodeHandshake(bytes, expected, "response");
}

function decodeHandshake(
  bytes: unknown,
  expected: PrivateAnalyzerReleaseTupleV1,
  kind: "request" | "response",
): Result.Result<PrivateAnalyzerReleaseTupleV1, PrivateAnalyzerReleaseCodecV1Error> {
  if (!isUint8Array(bytes)) return malformed();
  let parsed: unknown;
  try {
    parsed = JSON.parse(FATAL_UTF8_DECODER.decode(bytes)) as unknown;
  } catch {
    return malformed();
  }
  const expectedKeyCount = kind === "request" ? 4 : 5;
  if (!isNonArrayRecord(parsed) || Object.keys(parsed).length !== expectedKeyCount) {
    return malformed();
  }
  if (
    (kind === "response" && parsed.kind !== "compatible") ||
    parsed.protocolVersion !== PRIVATE_ANALYZER_PROTOCOL_VERSION_V1 ||
    typeof parsed.protocolIdentity !== "string" ||
    !isPrivateAnalyzerIdentityV1(parsed.implementationIdentity) ||
    !isPrivateAnalyzerIdentityV1(parsed.configurationIdentity)
  ) return malformed();
  const decoded = Object.freeze({
    protocolIdentity: parsed.protocolIdentity,
    protocolVersion: PRIVATE_ANALYZER_PROTOCOL_VERSION_V1,
    implementationIdentity: parsed.implementationIdentity,
    configurationIdentity: parsed.configurationIdentity,
  });
  const canonical = kind === "request"
    ? canonicalHandshakeRequest(decoded)
    : canonicalHandshakeResponse(decoded);
  if (!bytesEqualFullScan(bytes, canonical)) return malformed();
  if (
    decoded.protocolIdentity !== expected.protocolIdentity ||
    decoded.protocolVersion !== expected.protocolVersion ||
    decoded.implementationIdentity !== expected.implementationIdentity ||
    decoded.configurationIdentity !== expected.configurationIdentity
  ) return Result.fail(new PrivateAnalyzerReleaseCodecV1Error({ reason: "identityMismatch" }));
  return Result.succeed(Object.freeze({
    protocolIdentity: expected.protocolIdentity,
    protocolVersion: expected.protocolVersion,
    implementationIdentity: decoded.implementationIdentity,
    configurationIdentity: decoded.configurationIdentity,
  }));
}

function malformed(): Result.Result<never, PrivateAnalyzerReleaseCodecV1Error> {
  return Result.fail(new PrivateAnalyzerReleaseCodecV1Error({ reason: "malformed" }));
}

function releaseInvariant(): never {
  throw new Error("Private analyzer release contract lost its canonical JSON invariant.");
}

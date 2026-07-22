import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Result } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

export const PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1 =
  "flarex.private-source-analyzer-handshake.v1";
export const PRIVATE_ANALYZER_PROTOCOL_VERSION_V1 = 1;
export const PRIVATE_ANALYZER_HANDSHAKE_CODEC_VERSION_V1 = 1;
export const PRIVATE_ANALYZER_HANDSHAKE_PATH_V1 =
  "/__flarex_private/source-analyzer-v2/identity";
export const PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_PREFIX =
  "__FLAREX_PRIVATE_ANALYZER_IMPLEMENTATION_V1__";
export const PRIVATE_ANALYZER_IMPLEMENTATION_MARKER_SUFFIX = "__END__";
export const PRIVATE_ANALYZER_IDENTITY_HEX_LENGTH = 64;
const PRIVATE_ANALYZER_COMPATIBILITY_FLAGS_V1: readonly [] = Object.freeze([]);

export interface PrivateAnalyzerToolchainV1 {
  readonly wrangler: string;
  readonly typescript: string;
  readonly effect: string;
  readonly workersTypes: string;
  readonly esbuild: string;
}

export interface PrivateAnalyzerHostConfigurationV1 {
  readonly format: "flarex.private-source-analyzer-host-configuration";
  readonly version: 1;
  readonly compatibilityDate: "2026-06-14";
  readonly compatibilityFlags: readonly [];
  readonly protocolIdentity: typeof PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1;
  readonly protocolVersion: typeof PRIVATE_ANALYZER_PROTOCOL_VERSION_V1;
  readonly handshakeCodecVersion: typeof PRIVATE_ANALYZER_HANDSHAKE_CODEC_VERSION_V1;
  readonly handshake: {
    readonly method: "POST";
    readonly path: typeof PRIVATE_ANALYZER_HANDSHAKE_PATH_V1;
    readonly contentType: "application/json";
    readonly maximumBodyReadMilliseconds: 5_000;
    readonly framing: "canonical-json-utf8-full-scan-v1";
    readonly redaction: "private-code-only-v1";
    readonly statuses: {
      readonly success: 200;
      readonly malformed: 400;
      readonly notFound: 404;
      readonly methodNotAllowed: 405;
      readonly identityMismatch: 409;
      readonly payloadTooLarge: 413;
      readonly unsupportedMediaType: 415;
      readonly bodyReadFailed: 400;
      readonly bodyReadTimedOut: 408;
    };
  };
  readonly toolchain: PrivateAnalyzerToolchainV1;
}

export class PrivateAnalyzerHostConfigurationV1Error extends Data.TaggedError(
  "PrivateAnalyzerHostConfigurationV1Error",
)<{
  readonly field: string;
  readonly reason: "invalidConfiguration" | "invalidIdentity";
}> {}

export function privateAnalyzerHostConfigurationV1(
  toolchain: PrivateAnalyzerToolchainV1,
): PrivateAnalyzerHostConfigurationV1 {
  return Object.freeze({
    format: "flarex.private-source-analyzer-host-configuration",
    version: 1,
    compatibilityDate: "2026-06-14",
    compatibilityFlags: PRIVATE_ANALYZER_COMPATIBILITY_FLAGS_V1,
    protocolIdentity: PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1,
    protocolVersion: PRIVATE_ANALYZER_PROTOCOL_VERSION_V1,
    handshakeCodecVersion: PRIVATE_ANALYZER_HANDSHAKE_CODEC_VERSION_V1,
    handshake: Object.freeze({
      method: "POST",
      path: PRIVATE_ANALYZER_HANDSHAKE_PATH_V1,
      contentType: "application/json",
      maximumBodyReadMilliseconds: 5_000,
      framing: "canonical-json-utf8-full-scan-v1",
      redaction: "private-code-only-v1",
      statuses: Object.freeze({
        success: 200,
        malformed: 400,
        notFound: 404,
        methodNotAllowed: 405,
        identityMismatch: 409,
        payloadTooLarge: 413,
        unsupportedMediaType: 415,
        bodyReadFailed: 400,
        bodyReadTimedOut: 408,
      }),
    }),
    toolchain: Object.freeze({ ...toolchain }),
  });
}

export function validatePrivateAnalyzerHostConfigurationV1(
  value: unknown,
): Result.Result<PrivateAnalyzerHostConfigurationV1, PrivateAnalyzerHostConfigurationV1Error> {
  if (!isNonArrayRecord(value)) return invalidConfiguration("configuration");
  if (!isValidToolchain(value.toolchain)) return invalidConfiguration("toolchain");
  const expected = privateAnalyzerHostConfigurationV1(value.toolchain);
  const encoded = canonicalConfiguration(value);
  const canonicalExpected = canonicalConfiguration(expected);
  return Result.all([encoded, canonicalExpected] as const).pipe(
    Result.flatMap(([actual, canonical]) => actual === canonical
      ? Result.succeed(expected)
      : invalidConfiguration("configuration")),
  );
}

export function canonicalPrivateAnalyzerHostConfigurationV1(
  value: PrivateAnalyzerHostConfigurationV1,
): string {
  return encodeCanonicalJson(value as unknown as Json, configurationInvariant);
}

export function isPrivateAnalyzerIdentityV1(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function canonicalConfiguration(
  value: unknown,
): Result.Result<string, PrivateAnalyzerHostConfigurationV1Error> {
  try {
    return Result.succeed(encodeCanonicalJson(value as Json, configurationInvariant));
  } catch {
    return invalidConfiguration("configuration");
  }
}

function isValidToolchain(value: unknown): value is PrivateAnalyzerToolchainV1 {
  if (!isNonArrayRecord(value)) return false;
  const keys = ["wrangler", "typescript", "effect", "workersTypes", "esbuild"] as const;
  return Object.keys(value).length === keys.length &&
    keys.every(key => isNonEmptyString(value[key]));
}

function invalidConfiguration(
  field: string,
): Result.Result<never, PrivateAnalyzerHostConfigurationV1Error> {
  return Result.fail(new PrivateAnalyzerHostConfigurationV1Error({
    field,
    reason: "invalidConfiguration",
  }));
}

function configurationInvariant(): never {
  throw new Error("Private analyzer configuration lost its canonical JSON invariant.");
}

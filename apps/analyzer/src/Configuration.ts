import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import {
  isPrivateAnalyzerIdentityV1,
  PRIVATE_ANALYZER_PROTOCOL_IDENTITY_V1,
  PRIVATE_ANALYZER_PROTOCOL_VERSION_V1,
} from "@flarex/analysis/internal/private-analyzer-release-v1";
import {
  PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
  PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1,
  PRIVATE_ANALYZER_VERIFICATION_PATH_V1,
  PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1,
  PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1,
  PRIVATE_ANALYZER_VERIFICATION_TRANSITION_QUANTUM_V1,
} from "@flarex/analysis/internal/private-analyzer-verification-v1";
import { Data, Result } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

export const PRIVATE_ANALYZER_HANDSHAKE_CODEC_VERSION_V1 = 1;
export const PRIVATE_ANALYZER_HANDSHAKE_PATH_V1 =
  "/__flarex_private/source-analyzer-v2/identity";
const PRIVATE_ANALYZER_COMPATIBILITY_FLAGS_V1: readonly [] = Object.freeze([]);
const PRIVATE_ANALYZER_DEPLOYMENT_ROUTES_V1: readonly [] = Object.freeze([]);
const PRIVATE_ANALYZER_DEPLOYMENT_RESOURCE_BINDINGS_V1: readonly [] = Object.freeze([]);

export interface PrivateAnalyzerDeploymentPostureV1 {
  readonly format: "flarex.private-source-analyzer-deployment-posture";
  readonly version: 1;
  readonly workersDev: false;
  readonly previewUrls: false;
  readonly routes: readonly [];
  readonly resourceBindings: readonly [];
}

export const PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1: PrivateAnalyzerDeploymentPostureV1 =
  Object.freeze({
    format: "flarex.private-source-analyzer-deployment-posture",
    version: 1,
    workersDev: false,
    previewUrls: false,
    routes: PRIVATE_ANALYZER_DEPLOYMENT_ROUTES_V1,
    resourceBindings: PRIVATE_ANALYZER_DEPLOYMENT_RESOURCE_BINDINGS_V1,
  });

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
  readonly deploymentPosture: PrivateAnalyzerDeploymentPostureV1;
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
  readonly verification: {
    readonly method: "POST";
    readonly path: typeof PRIVATE_ANALYZER_VERIFICATION_PATH_V1;
    readonly contentType: typeof PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1;
    readonly protocolIdentity:
      typeof PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1;
    readonly protocolVersion:
      typeof PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1;
    readonly maximumFrameBytes:
      typeof PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1;
    readonly transitionQuantum:
      typeof PRIVATE_ANALYZER_VERIFICATION_TRANSITION_QUANTUM_V1;
    readonly maximumBodyReadMilliseconds: 30_000;
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
  deploymentPosture: PrivateAnalyzerDeploymentPostureV1,
): PrivateAnalyzerHostConfigurationV1 {
  const ownedDeploymentPosture = capturePrivateAnalyzerDeploymentPostureV1(deploymentPosture);
  return Object.freeze({
    format: "flarex.private-source-analyzer-host-configuration",
    version: 1,
    compatibilityDate: "2026-06-14",
    compatibilityFlags: PRIVATE_ANALYZER_COMPATIBILITY_FLAGS_V1,
    deploymentPosture: ownedDeploymentPosture,
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
    verification: Object.freeze({
      method: "POST",
      path: PRIVATE_ANALYZER_VERIFICATION_PATH_V1,
      contentType: PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
      protocolIdentity: PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1,
      protocolVersion: PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1,
      maximumFrameBytes: PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1,
      transitionQuantum: PRIVATE_ANALYZER_VERIFICATION_TRANSITION_QUANTUM_V1,
      maximumBodyReadMilliseconds: 30_000,
    }),
    toolchain: Object.freeze({ ...toolchain }),
  });
}

function capturePrivateAnalyzerDeploymentPostureV1(
  value: PrivateAnalyzerDeploymentPostureV1,
): PrivateAnalyzerDeploymentPostureV1 {
  const format = value.format;
  const version = value.version;
  const workersDev = value.workersDev;
  const previewUrls = value.previewUrls;
  const routesLength = value.routes.length;
  const resourceBindingsLength = value.resourceBindings.length;
  if (
    format !== "flarex.private-source-analyzer-deployment-posture" ||
    version !== 1 ||
    workersDev !== false ||
    previewUrls !== false ||
    routesLength !== 0 ||
    resourceBindingsLength !== 0
  ) {
    throw new Error("Private analyzer deployment posture lost its configuration invariant.");
  }
  const routes: readonly [] = Object.freeze([]);
  const resourceBindings: readonly [] = Object.freeze([]);
  return Object.freeze({
    format,
    version,
    workersDev,
    previewUrls,
    routes,
    resourceBindings,
  });
}

export function validatePrivateAnalyzerHostConfigurationV1(
  value: unknown,
): Result.Result<PrivateAnalyzerHostConfigurationV1, PrivateAnalyzerHostConfigurationV1Error> {
  if (!isNonArrayRecord(value)) return invalidConfiguration("configuration");
  if (!isValidToolchain(value.toolchain)) return invalidConfiguration("toolchain");
  const expected = privateAnalyzerHostConfigurationV1(
    value.toolchain,
    PRIVATE_ANALYZER_DEPLOYMENT_POSTURE_V1,
  );
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

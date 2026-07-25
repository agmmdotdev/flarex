import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

import {
  DECLARATIVE_V2_EXECUTABLE_CORE_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_DIAGNOSTIC_IDENTITY_V1,
  DECLARATIVE_V2_VERIFIER_UNICODE_IDENTITY_V1,
} from "./declarativeV2VerifierV1.contract";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "./declarativeV2VerifierV1.generated";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
} from "./declarativeV2VerifierExecutableV1";
import {
  capturePrivateAnalyzerReleaseTupleV1,
  type PrivateAnalyzerReleaseTupleV1,
} from "./privateAnalyzerReleaseV1";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const FRAME_HEADER_BYTES = 5;

export const PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1 =
  "flarex.private-source-analyzer-verification.v1" as const;
export const PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1 = 1 as const;
export const PRIVATE_ANALYZER_VERIFICATION_PATH_V1 =
  "/__flarex_private/source-analyzer-v2/verify" as const;
export const PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1 =
  "application/x-flarex-declarative-v2-verification-v1" as const;
export const PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1 = 65_536;
export const PRIVATE_ANALYZER_VERIFICATION_TRANSITION_QUANTUM_V1 = 1_024;

export type PrivateAnalyzerVerificationFrameKindV1 =
  | "requestHeader"
  | "moduleHeader"
  | "moduleBytes"
  | "semanticBytes"
  | "requestEnd"
  | "responseHeader"
  | "evidence"
  | "responseEnd";

const FRAME_KIND_ID = Object.freeze({
  requestHeader: 1,
  moduleHeader: 2,
  moduleBytes: 3,
  semanticBytes: 4,
  requestEnd: 5,
  responseHeader: 17,
  evidence: 18,
  responseEnd: 19,
} satisfies Record<PrivateAnalyzerVerificationFrameKindV1, number>);

const FRAME_KIND_BY_ID = new Map<number, PrivateAnalyzerVerificationFrameKindV1>(
  Object.entries(FRAME_KIND_ID).map(([kind, id]) => [
    id,
    kind as PrivateAnalyzerVerificationFrameKindV1,
  ]),
);

export interface PrivateAnalyzerVerificationAuthorityPinsV1 {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootSha256: string;
  readonly sourceSelectorSha256: string;
  readonly semanticUploadId: string;
  readonly semanticGeneration: number;
  readonly semanticMutationFence: number;
  readonly semanticRootSha256: string;
  readonly semanticSelectorSha256: string;
  readonly semanticAttemptIdentitySha256: string;
}

export interface PrivateAnalyzerVerificationRequestHeaderV1 {
  readonly kind: "private_analyzer_verification_request_v1";
  readonly protocolIdentity: typeof PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1;
  readonly protocolVersion: typeof PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1;
  readonly release: PrivateAnalyzerReleaseTupleV1;
  readonly requestIdentitySha256: string;
  readonly moduleManifestSha256: string;
  readonly semanticContentSha256: string;
  readonly pins: PrivateAnalyzerVerificationAuthorityPinsV1;
  readonly moduleCount: number;
  readonly semanticByteLength: number;
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
  readonly linkerMaximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly linkerRequired: DeclarativeV2VerifierBudgetFrameV2;
  readonly hostMaximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly hostRequired: DeclarativeV2VerifierBudgetFrameV2;
  readonly verifier: {
    readonly specificationIdentity: string;
    readonly unicodeIdentity: string;
    readonly arenaIdentity: string;
    readonly diagnosticIdentity: string;
    readonly executableCoreIdentity: string;
    readonly grammarAssetIdentity: string;
    readonly executableAssetIdentity: string;
  };
}

export interface PrivateAnalyzerVerificationModuleHeaderV1 {
  readonly kind: "private_analyzer_verification_module_v1";
  readonly ordinal: number;
  readonly roles: number;
  readonly modulePath: string;
  readonly sourceByteLength: number;
  readonly sourceSha256: string;
  readonly frameSha256: string;
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
}

export interface PrivateAnalyzerVerificationResponseHeaderV1 {
  readonly kind: "private_analyzer_verification_response_v1";
  readonly protocolIdentity: typeof PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1;
  readonly protocolVersion: typeof PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1;
  readonly requestIdentitySha256: string;
  readonly resultIdentitySha256: string;
  readonly evidenceSha256: string;
  readonly verified: boolean;
  readonly moduleCount: number;
  readonly evidenceCount: number;
  readonly diagnosticCount: number;
}

export interface PrivateAnalyzerVerificationFrameV1 {
  readonly kind: PrivateAnalyzerVerificationFrameKindV1;
  readonly payload: Uint8Array;
}

export class PrivateAnalyzerVerificationV1Error extends Data.TaggedError(
  "PrivateAnalyzerVerificationV1Error",
)<{
  readonly operation: "encode" | "decode" | "capture" | "stream";
  readonly reason:
    | "invalidInput"
    | "invalidBudget"
    | "budgetExceeded"
    | "malformed"
    | "nonCanonical"
    | "identityMismatch"
    | "closed";
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

const issue = (
  operation: PrivateAnalyzerVerificationV1Error["operation"],
  reason: PrivateAnalyzerVerificationV1Error["reason"],
  path?: string,
  observed?: number,
  maximum?: number,
): PrivateAnalyzerVerificationV1Error =>
  new PrivateAnalyzerVerificationV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });

export function installedPrivateAnalyzerVerifierIdentitiesV1() {
  return Object.freeze({
    specificationIdentity:
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.specificationSha256,
    unicodeIdentity: DECLARATIVE_V2_VERIFIER_UNICODE_IDENTITY_V1,
    arenaIdentity: DECLARATIVE_V2_VERIFIER_ARENA_IDENTITY_V1,
    diagnosticIdentity: DECLARATIVE_V2_VERIFIER_DIAGNOSTIC_IDENTITY_V1,
    executableCoreIdentity: DECLARATIVE_V2_EXECUTABLE_CORE_IDENTITY_V1,
    grammarAssetIdentity: GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetSha256,
    executableAssetIdentity:
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetSha256,
  });
}

export function installedPrivateAnalyzerVerifierTableBytesV1(): bigint {
  return BigInt(
    GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength +
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
  );
}

export function canonicalPrivateAnalyzerVerificationRequestHeaderV1(
  value: PrivateAnalyzerVerificationRequestHeaderV1,
): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson(
    requestHeaderJson(value),
    canonicalInvariant,
  ));
}

export function canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1(
  value: Omit<PrivateAnalyzerVerificationRequestHeaderV1, "requestIdentitySha256">,
): Uint8Array {
  return canonicalPrivateAnalyzerVerificationRequestHeaderV1(Object.freeze({
    ...value,
    requestIdentitySha256: "0".repeat(64),
  }));
}

export function decodePrivateAnalyzerVerificationRequestHeaderV1(
  bytes: unknown,
  expectedRelease: PrivateAnalyzerReleaseTupleV1,
): Result.Result<
  PrivateAnalyzerVerificationRequestHeaderV1,
  PrivateAnalyzerVerificationV1Error
> {
  return decodeCanonicalRecord(bytes).pipe(
    Result.flatMap(value => captureRequestHeader(value, expectedRelease)),
    Result.flatMap(value =>
      bytesEqualFullScan(
          bytes as Uint8Array,
          canonicalPrivateAnalyzerVerificationRequestHeaderV1(value),
        )
        ? Result.succeed(value)
        : Result.fail(issue("decode", "nonCanonical"))
    ),
  );
}

export function canonicalPrivateAnalyzerVerificationModuleHeaderV1(
  value: PrivateAnalyzerVerificationModuleHeaderV1,
): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson(
    {
      ...value,
      maximums: budgetJson(value.maximums),
      required: budgetJson(value.required),
    } as unknown as Json,
    canonicalInvariant,
  ));
}

export function decodePrivateAnalyzerVerificationModuleHeaderV1(
  bytes: unknown,
): Result.Result<
  PrivateAnalyzerVerificationModuleHeaderV1,
  PrivateAnalyzerVerificationV1Error
> {
  return decodeCanonicalRecord(bytes).pipe(
    Result.flatMap(captureModuleHeader),
    Result.flatMap(value =>
      bytesEqualFullScan(
          bytes as Uint8Array,
          canonicalPrivateAnalyzerVerificationModuleHeaderV1(value),
        )
        ? Result.succeed(value)
        : Result.fail(issue("decode", "nonCanonical"))
    ),
  );
}

export function canonicalPrivateAnalyzerVerificationResponseHeaderV1(
  value: PrivateAnalyzerVerificationResponseHeaderV1,
): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson(
    value as unknown as Json,
    canonicalInvariant,
  ));
}

export function canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1(
  value: Omit<PrivateAnalyzerVerificationResponseHeaderV1, "resultIdentitySha256">,
): Uint8Array {
  return canonicalPrivateAnalyzerVerificationResponseHeaderV1(Object.freeze({
    ...value,
    resultIdentitySha256: "0".repeat(64),
  }));
}

export function decodePrivateAnalyzerVerificationResponseHeaderV1(
  bytes: unknown,
  requestIdentitySha256: string,
): Result.Result<
  PrivateAnalyzerVerificationResponseHeaderV1,
  PrivateAnalyzerVerificationV1Error
> {
  return decodeCanonicalRecord(bytes).pipe(
    Result.flatMap(captureResponseHeader),
    Result.flatMap(value =>
      value.requestIdentitySha256 !== requestIdentitySha256
        ? Result.fail(issue("decode", "identityMismatch"))
        : bytesEqualFullScan(
            bytes as Uint8Array,
            canonicalPrivateAnalyzerVerificationResponseHeaderV1(value),
          )
        ? Result.succeed(value)
        : Result.fail(issue("decode", "nonCanonical"))
    ),
  );
}

export function encodePrivateAnalyzerVerificationFrameV1(
  kind: PrivateAnalyzerVerificationFrameKindV1,
  payload: unknown,
  maximumPayloadBytes = PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1,
): Result.Result<Uint8Array, PrivateAnalyzerVerificationV1Error> {
  if (
    !isNonNegativeSafeInteger(maximumPayloadBytes) ||
    maximumPayloadBytes > PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1 ||
    !isUint8Array(payload)
  ) {
    return Result.fail(issue("encode", "invalidInput"));
  }
  const length = payload.byteLength;
  if (length > maximumPayloadBytes) {
    return Result.fail(issue(
      "encode",
      "budgetExceeded",
      "payloadBytes",
      length,
      maximumPayloadBytes,
    ));
  }
  try {
    const output = new Uint8Array(FRAME_HEADER_BYTES + length);
    output[0] = FRAME_KIND_ID[kind];
    new DataView(output.buffer).setUint32(1, length, false);
    output.set(payload, FRAME_HEADER_BYTES);
    return Result.succeed(output);
  } catch {
    return Result.fail(issue("encode", "invalidInput"));
  }
}

export function decodePrivateAnalyzerVerificationFrameV1(
  bytes: unknown,
  maximumPayloadBytes = PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1,
): Result.Result<PrivateAnalyzerVerificationFrameV1, PrivateAnalyzerVerificationV1Error> {
  if (
    !isUint8Array(bytes) ||
    !isNonNegativeSafeInteger(maximumPayloadBytes) ||
    maximumPayloadBytes > PRIVATE_ANALYZER_VERIFICATION_MAXIMUM_FRAME_BYTES_V1 ||
    bytes.byteLength < FRAME_HEADER_BYTES
  ) {
    return Result.fail(issue("decode", "invalidInput"));
  }
  const kind = FRAME_KIND_BY_ID.get(bytes[0]!);
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(1, false);
  if (
    kind === undefined ||
    length > maximumPayloadBytes ||
    bytes.byteLength !== FRAME_HEADER_BYTES + length
  ) {
    return Result.fail(issue(
      "decode",
      length > maximumPayloadBytes ? "budgetExceeded" : "malformed",
      "payloadBytes",
      length,
      maximumPayloadBytes,
    ));
  }
  return Result.succeed(Object.freeze({
    kind,
    payload: bytes.slice(FRAME_HEADER_BYTES),
  }));
}

function decodeCanonicalRecord(
  bytes: unknown,
): Result.Result<Record<string, unknown>, PrivateAnalyzerVerificationV1Error> {
  if (!isUint8Array(bytes)) return Result.fail(issue("decode", "invalidInput"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(bytes)) as unknown;
  } catch {
    return Result.fail(issue("decode", "malformed"));
  }
  return isNonArrayRecord(parsed)
    ? Result.succeed(parsed)
    : Result.fail(issue("decode", "malformed"));
}

function captureRequestHeader(
  value: Record<string, unknown>,
  expectedRelease: PrivateAnalyzerReleaseTupleV1,
): Result.Result<
  PrivateAnalyzerVerificationRequestHeaderV1,
  PrivateAnalyzerVerificationV1Error
> {
  const release = capturePrivateAnalyzerReleaseTupleV1(value.release);
  const pins = capturePins(value.pins);
  const maximums = captureBudget(value.maximums, "command_budget");
  const required = captureBudget(value.required, "attempt_usage");
  const linkerMaximums = captureBudget(
    value.linkerMaximums,
    "command_budget",
  );
  const linkerRequired = captureBudget(
    value.linkerRequired,
    "attempt_usage",
  );
  const hostMaximums = captureBudget(value.hostMaximums, "command_budget");
  const hostRequired = captureBudget(value.hostRequired, "attempt_usage");
  const verifier = captureVerifier(value.verifier);
  if (
    value.kind !== "private_analyzer_verification_request_v1" ||
    value.protocolIdentity !== PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1 ||
    value.protocolVersion !== PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1 ||
    Result.isFailure(release) ||
    release.success.implementationIdentity !==
      expectedRelease.implementationIdentity ||
    release.success.configurationIdentity !==
      expectedRelease.configurationIdentity ||
    !isHexSha256(value.requestIdentitySha256) ||
    !isHexSha256(value.moduleManifestSha256) ||
    !isHexSha256(value.semanticContentSha256) ||
    Result.isFailure(pins) ||
    !isNonNegativeSafeInteger(value.moduleCount) ||
    !isNonNegativeSafeInteger(value.semanticByteLength) ||
    Result.isFailure(maximums) ||
    Result.isFailure(required) ||
    Result.isFailure(linkerMaximums) ||
    Result.isFailure(linkerRequired) ||
    Result.isFailure(hostMaximums) ||
    Result.isFailure(hostRequired) ||
    Result.isFailure(verifier) ||
    !sameVerifierIdentities(verifier.success, installedPrivateAnalyzerVerifierIdentitiesV1())
  ) {
    return Result.fail(issue("capture", "malformed"));
  }
  return Result.succeed(Object.freeze({
    kind: "private_analyzer_verification_request_v1",
    protocolIdentity: PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1,
    protocolVersion: PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1,
    release: release.success,
    requestIdentitySha256: value.requestIdentitySha256,
    moduleManifestSha256: value.moduleManifestSha256,
    semanticContentSha256: value.semanticContentSha256,
    pins: pins.success,
    moduleCount: value.moduleCount,
    semanticByteLength: value.semanticByteLength,
    maximums: maximums.success,
    required: required.success,
    linkerMaximums: linkerMaximums.success,
    linkerRequired: linkerRequired.success,
    hostMaximums: hostMaximums.success,
    hostRequired: hostRequired.success,
    verifier: verifier.success,
  }));
}

function captureModuleHeader(
  value: Record<string, unknown>,
): Result.Result<
  PrivateAnalyzerVerificationModuleHeaderV1,
  PrivateAnalyzerVerificationV1Error
> {
  const maximums = captureBudget(value.maximums, "command_budget");
  const required = captureBudget(value.required, "attempt_usage");
  if (
    value.kind !== "private_analyzer_verification_module_v1" ||
    !isNonNegativeSafeInteger(value.ordinal) ||
    !isNonNegativeSafeInteger(value.roles) ||
    typeof value.modulePath !== "string" ||
    !isNonNegativeSafeInteger(value.sourceByteLength) ||
    !isHexSha256(value.sourceSha256) ||
    !isHexSha256(value.frameSha256) ||
    Result.isFailure(maximums) ||
    Result.isFailure(required)
  ) return Result.fail(issue("capture", "malformed"));
  return Result.succeed(Object.freeze({
    kind: "private_analyzer_verification_module_v1",
    ordinal: value.ordinal,
    roles: value.roles,
    modulePath: value.modulePath,
    sourceByteLength: value.sourceByteLength,
    sourceSha256: value.sourceSha256,
    frameSha256: value.frameSha256,
    maximums: maximums.success,
    required: required.success,
  }));
}

function captureResponseHeader(
  value: Record<string, unknown>,
): Result.Result<
  PrivateAnalyzerVerificationResponseHeaderV1,
  PrivateAnalyzerVerificationV1Error
> {
  if (
    value.kind !== "private_analyzer_verification_response_v1" ||
    value.protocolIdentity !== PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1 ||
    value.protocolVersion !== PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1 ||
    !isHexSha256(value.requestIdentitySha256) ||
    !isHexSha256(value.resultIdentitySha256) ||
    !isHexSha256(value.evidenceSha256) ||
    typeof value.verified !== "boolean" ||
    !isNonNegativeSafeInteger(value.moduleCount) ||
    !isNonNegativeSafeInteger(value.evidenceCount) ||
    !isNonNegativeSafeInteger(value.diagnosticCount)
  ) return Result.fail(issue("capture", "malformed"));
  return Result.succeed(Object.freeze({
    kind: "private_analyzer_verification_response_v1",
    protocolIdentity: PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_IDENTITY_V1,
    protocolVersion: PRIVATE_ANALYZER_VERIFICATION_PROTOCOL_VERSION_V1,
    requestIdentitySha256: value.requestIdentitySha256,
    resultIdentitySha256: value.resultIdentitySha256,
    evidenceSha256: value.evidenceSha256,
    verified: value.verified,
    moduleCount: value.moduleCount,
    evidenceCount: value.evidenceCount,
    diagnosticCount: value.diagnosticCount,
  }));
}

function capturePins(
  value: unknown,
): Result.Result<
  PrivateAnalyzerVerificationAuthorityPinsV1,
  PrivateAnalyzerVerificationV1Error
> {
  if (!isNonArrayRecord(value)) return Result.fail(issue("capture", "malformed"));
  const textKeys = [
    "projectId",
    "deploymentId",
    "deploymentCreatedAt",
    "sourceUploadId",
    "semanticUploadId",
  ] as const;
  const numberKeys = [
    "sourceGeneration",
    "sourceMutationFence",
    "semanticGeneration",
    "semanticMutationFence",
  ] as const;
  const digestKeys = [
    "sourceRootSha256",
    "sourceSelectorSha256",
    "semanticRootSha256",
    "semanticSelectorSha256",
    "semanticAttemptIdentitySha256",
  ] as const;
  if (
    textKeys.some(key => typeof value[key] !== "string" || value[key].length === 0) ||
    numberKeys.some(key => !isNonNegativeSafeInteger(value[key])) ||
    digestKeys.some(key => !isHexSha256(value[key]))
  ) return Result.fail(issue("capture", "malformed"));
  return Result.succeed(Object.freeze({
    projectId: value.projectId as string,
    deploymentId: value.deploymentId as string,
    deploymentCreatedAt: value.deploymentCreatedAt as string,
    sourceUploadId: value.sourceUploadId as string,
    sourceGeneration: value.sourceGeneration as number,
    sourceMutationFence: value.sourceMutationFence as number,
    sourceRootSha256: value.sourceRootSha256 as string,
    sourceSelectorSha256: value.sourceSelectorSha256 as string,
    semanticUploadId: value.semanticUploadId as string,
    semanticGeneration: value.semanticGeneration as number,
    semanticMutationFence: value.semanticMutationFence as number,
    semanticRootSha256: value.semanticRootSha256 as string,
    semanticSelectorSha256: value.semanticSelectorSha256 as string,
    semanticAttemptIdentitySha256: value.semanticAttemptIdentitySha256 as string,
  }));
}

function captureVerifier(value: unknown) {
  const expected = installedPrivateAnalyzerVerifierIdentitiesV1();
  if (!isNonArrayRecord(value)) return Result.fail(issue("capture", "malformed"));
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (typeof value[key] !== "string") {
      return Result.fail(issue("capture", "malformed"));
    }
  }
  return Result.succeed(Object.freeze({
    specificationIdentity: value.specificationIdentity as string,
    unicodeIdentity: value.unicodeIdentity as string,
    arenaIdentity: value.arenaIdentity as string,
    diagnosticIdentity: value.diagnosticIdentity as string,
    executableCoreIdentity: value.executableCoreIdentity as string,
    grammarAssetIdentity: value.grammarAssetIdentity as string,
    executableAssetIdentity: value.executableAssetIdentity as string,
  }));
}

function sameVerifierIdentities(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return Object.keys(right).every(key => left[key] === right[key]);
}

function captureBudget(
  value: unknown,
  kind: "attempt_usage" | "command_budget",
): Result.Result<DeclarativeV2VerifierBudgetFrameV2, PrivateAnalyzerVerificationV1Error> {
  if (!isNonArrayRecord(value) || value.kind !== kind) {
    return Result.fail(issue("capture", "invalidBudget"));
  }
  const captured: Record<string, bigint | string> = { kind };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const encoded = value[dimension];
    if (
      typeof encoded !== "string" ||
      !/^(0|[1-9][0-9]*)$/u.test(encoded)
    ) return Result.fail(issue("capture", "invalidBudget", dimension));
    const amount = BigInt(encoded);
    if (amount > MAX_SIGNED_INT64) {
      return Result.fail(issue("capture", "invalidBudget", dimension));
    }
    captured[dimension] = amount;
  }
  return Result.succeed(
    Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2,
  );
}

function budgetJson(
  budget: DeclarativeV2VerifierBudgetFrameV2,
): Json {
  return Object.fromEntries([
    ["kind", budget.kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
      dimension => [dimension, budget[dimension].toString()] as const,
    ),
  ]) as Json;
}

function requestHeaderJson(
  value: PrivateAnalyzerVerificationRequestHeaderV1,
): Json {
  return {
    kind: value.kind,
    protocolIdentity: value.protocolIdentity,
    protocolVersion: value.protocolVersion,
    release: value.release as unknown as Json,
    requestIdentitySha256: value.requestIdentitySha256,
    moduleManifestSha256: value.moduleManifestSha256,
    semanticContentSha256: value.semanticContentSha256,
    pins: value.pins as unknown as Json,
    moduleCount: value.moduleCount,
    semanticByteLength: value.semanticByteLength,
    maximums: budgetJson(value.maximums),
    required: budgetJson(value.required),
    linkerMaximums: budgetJson(value.linkerMaximums),
    linkerRequired: budgetJson(value.linkerRequired),
    hostMaximums: budgetJson(value.hostMaximums),
    hostRequired: budgetJson(value.hostRequired),
    verifier: value.verifier as unknown as Json,
  };
}

export function sha256HexFromBytesV1(bytes: unknown): Result.Result<string, PrivateAnalyzerVerificationV1Error> {
  if (!isUint8ArrayWithByteLength(bytes, 32)) {
    return Result.fail(issue("capture", "invalidInput"));
  }
  let output = "";
  for (let index = 0; index < 32; index += 1) {
    const byte = bytes[index]!;
    output += "0123456789abcdef"[byte >>> 4]!;
    output += "0123456789abcdef"[byte & 0x0f]!;
  }
  return Result.succeed(output);
}

export function sha256BytesFromHexV1(value: unknown): Result.Result<Uint8Array, PrivateAnalyzerVerificationV1Error> {
  if (!isHexSha256(value)) return Result.fail(issue("capture", "invalidInput"));
  const output = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(output);
}

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function canonicalInvariant(): never {
  throw new Error("Private analyzer verification frame lost canonical form.");
}

export {
  appendDeclarativeV2VerifierLinkerModuleV1,
  createDeclarativeV2VerifierEngineV1,
  createDeclarativeV2VerifierLinkerV1,
  finishDeclarativeV2VerifierLinkerV1,
  makeDeclarativeV2VerifierResultAccessFactoryV1,
  stepDeclarativeV2VerifierLinkerV1,
} from "./declarativeV2VerifierExecutableV1";
export type {
  DeclarativeV2VerifierModuleResultV1,
} from "./declarativeV2VerifierExecutableV1";
export {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
} from "./declarativeV2ArtifactModulePathV1";
export type {
  DeclarativeV2ArtifactModulePathHandleV1,
} from "./declarativeV2ArtifactModulePathV1";
export {
  createDeclarativeV2VerificationEvidenceSinkEncoderV2,
  makeDeclarativeV2VerificationEvidenceBudgetV2,
} from "./declarativeV2VerificationEvidenceV2";
export type {
  DeclarativeV2VerificationEvidenceCursorV2,
} from "./declarativeV2VerificationEvidenceV2";
export {
  createIncrementalCanonicalJsonDecoderV1,
  makeIncrementalCanonicalJsonEventSinkV1,
  makeIncrementalCanonicalJsonByteSinkV1,
  makeIncrementalCanonicalJsonLimitsV1,
} from "./declarativeV2IncrementalCanonicalJsonV1";
export type {
  IncrementalCanonicalJsonDecoderV1,
  IncrementalCanonicalJsonDecodeStepV1,
  IncrementalCanonicalJsonReceiptV1,
  IncrementalCanonicalJsonSinkEventV1,
} from "./declarativeV2IncrementalCanonicalJsonV1";

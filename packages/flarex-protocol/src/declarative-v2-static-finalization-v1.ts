import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  compareUtf16Strings,
  isNonBlankString,
} from "@flarex/utils/strings";
import { Data, Result, Schema } from "effect";

import {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
} from "./deployment";
import {
  hasOnlyPairedSurrogates,
  utf8ByteLength,
} from "./canonical-utf8";
import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DECLARATIVE_V2_SHA256_BYTES_V1,
} from "./declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
} from "./declarative-v2-verifier-progress-v2";
import {
  encodeCanonicalJson,
  isJson,
  jsonEqual,
  measureCanonicalJsonUtf8Bytes,
  type Json,
} from "./json";
import { freezeOwnedProtocolProjection } from "./owned-protocol-projection";
import { selectorNameForPartitionField } from "./partition-selector";
import { StrictParseOptions } from "./strict-schema-options";

export const DECLARATIVE_V2_DEPLOYMENT_ANALYSIS_CODEC_IDENTITY_V1 =
  "flarex.protocol.deployment-analysis/v1" as const;
export const DECLARATIVE_V2_DEPLOYMENT_CODEGEN_ANALYSIS_CODEC_IDENTITY_V1 =
  "flarex.protocol.deployment-codegen-analysis/v1" as const;

export type DeclarativeV2StaticVerificationStatusV1 =
  | "verified"
  | "invalid";

export interface DeclarativeV2StaticVerificationCompletionFrameV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly semanticSelectorSha256: Uint8Array;
  readonly verifierProgressProtocolIdentity:
    typeof DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2;
  readonly verifierBudgetProtocolIdentity:
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2;
  readonly ceilingsSha256: Uint8Array;
  readonly usageSha256: Uint8Array;
  readonly sourceTailSha256: Uint8Array;
  readonly parseTailSha256: Uint8Array;
  readonly linkTailSha256: Uint8Array;
  readonly registrationTailSha256: Uint8Array;
  readonly lastReceiptSha256: Uint8Array;
  readonly moduleCount: bigint;
  readonly importEdgeCount: bigint;
  readonly registrationCount: bigint;
  readonly diagnosticCount: bigint;
  readonly diagnosticRootSha256: Uint8Array;
  readonly status: DeclarativeV2StaticVerificationStatusV1;
  readonly failureCode: string | null;
  readonly handlerSetSha256: Uint8Array | null;
  readonly registrationRootSha256: Uint8Array | null;
}

export interface DeclarativeV2StaticFinalizationFrameV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly completionSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly status: DeclarativeV2StaticVerificationStatusV1;
  readonly failureCode: string | null;
  readonly diagnosticRootSha256: Uint8Array;
  readonly handlerSetSha256: Uint8Array | null;
  readonly registrationRootSha256: Uint8Array | null;
  readonly deploymentAnalysisProjectionSha256: Uint8Array | null;
  readonly deploymentCodegenAnalysisProjectionSha256: Uint8Array | null;
}

export interface DeclarativeV2StaticFrameBudgetV1 {
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
}

export interface DeclarativeV2StaticFrameUsageV1 {
  readonly frameBytes: number;
  readonly canonicalBytes: number;
}

export interface DeclarativeV2EncodedStaticFrameV1<T> {
  readonly frame: T;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2StaticFrameUsageV1;
}

export interface DeclarativeV2ProjectionPairV1 {
  readonly deploymentAnalysis: DeploymentAnalysis;
  readonly deploymentCodegenAnalysis: DeploymentCodegenAnalysis;
  readonly deploymentAnalysisCanonicalBytes: Uint8Array;
  readonly deploymentCodegenAnalysisCanonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2StaticFrameUsageV1;
}

export class DeclarativeV2StaticFinalizationV1Error extends Data.TaggedError(
  "DeclarativeV2StaticFinalizationV1Error",
)<{
  readonly operation:
    | "encodeCompletion"
    | "decodeCompletion"
    | "encodeStaticFinalization"
    | "decodeStaticFinalization"
    | "encodeProjections"
    | "decodeProjections";
  readonly reason:
    | "invalidInput"
    | "invalidBudget"
    | "frameBytesExceeded"
    | "canonicalBytesExceeded"
    | "malformed"
    | "nonCanonical"
    | "projectionMismatch";
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class DeclarativeV2StaticFinalizationV1InvariantDefect
  extends Data.TaggedError(
    "DeclarativeV2StaticFinalizationV1InvariantDefect",
  )<{
    readonly reason: "canonicalEncodingFailed" | "reencodeFailed";
  }> {}

type CompletionOperation = "encodeCompletion" | "decodeCompletion";
type StaticOperation =
  | "encodeStaticFinalization"
  | "decodeStaticFinalization";
type ProjectionOperation = "encodeProjections" | "decodeProjections";

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
const U32_MAX = 0xffff_ffff;
const COMPLETION_DOMAIN = UTF8_ENCODER.encode(
  "flarex.declarative-v2/static_verification_completion/v1\0",
);
const STATIC_FINALIZATION_DOMAIN = UTF8_ENCODER.encode(
  "flarex.declarative-v2/static_finalization/v1\0",
);
const COMPLETION_FIELD_COUNT = 22;
const STATIC_FINALIZATION_FIELD_COUNT = 11;
const decodeDeploymentAnalysisResult = Schema.decodeUnknownResult(
  DeploymentAnalysis,
  StrictParseOptions,
);
const decodeDeploymentCodegenAnalysisResult = Schema.decodeUnknownResult(
  DeploymentCodegenAnalysis,
  StrictParseOptions,
);

export function encodeDeclarativeV2StaticVerificationCompletionV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2EncodedStaticFrameV1<
    DeclarativeV2StaticVerificationCompletionFrameV1
  >,
  DeclarativeV2StaticFinalizationV1Error
> {
  return encodeCompletion(input, rawBudget, "encodeCompletion");
}

export function decodeDeclarativeV2StaticVerificationCompletionV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2EncodedStaticFrameV1<
    DeclarativeV2StaticVerificationCompletionFrameV1
  >,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget(rawBudget, "decodeCompletion");
    const owned = yield* captureInputBytes(input, budget, "decodeCompletion");
    const frame = yield* parseCompletion(owned);
    const encoded = encodeCompletion(frame, budget, "decodeCompletion");
    const encodedFrame = Result.match(encoded, {
      onSuccess: (encodedFrameValue) => encodedFrameValue,
      onFailure: () => {
        throw new DeclarativeV2StaticFinalizationV1InvariantDefect({
          reason: "reencodeFailed",
        });
      },
    });
    if (!bytesEqualFullScan(owned, encodedFrame.canonicalBytes)) {
      return yield* Result.fail(
        staticError("decodeCompletion", "nonCanonical"),
      );
    }
    return Object.freeze({
      frame: encodedFrame.frame,
      canonicalBytes: owned,
      usage: encodedFrame.usage,
    });
  });
}

export function encodeDeclarativeV2StaticFinalizationV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2EncodedStaticFrameV1<DeclarativeV2StaticFinalizationFrameV1>,
  DeclarativeV2StaticFinalizationV1Error
> {
  return encodeStaticFinalization(
    input,
    rawBudget,
    "encodeStaticFinalization",
  );
}

export function decodeDeclarativeV2StaticFinalizationV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2EncodedStaticFrameV1<DeclarativeV2StaticFinalizationFrameV1>,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget(rawBudget, "decodeStaticFinalization");
    const owned = yield* captureInputBytes(
      input,
      budget,
      "decodeStaticFinalization",
    );
    const frame = yield* parseStaticFinalization(owned);
    const encoded = encodeStaticFinalization(
      frame,
      budget,
      "decodeStaticFinalization",
    );
    const encodedFrame = Result.match(encoded, {
      onSuccess: (encodedFrameValue) => encodedFrameValue,
      onFailure: () => {
        throw new DeclarativeV2StaticFinalizationV1InvariantDefect({
          reason: "reencodeFailed",
        });
      },
    });
    if (!bytesEqualFullScan(owned, encodedFrame.canonicalBytes)) {
      return yield* Result.fail(
        staticError("decodeStaticFinalization", "nonCanonical"),
      );
    }
    return Object.freeze({
      frame: encodedFrame.frame,
      canonicalBytes: owned,
      usage: encodedFrame.usage,
    });
  });
}

export function encodeDeclarativeV2ProjectionPairV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2ProjectionPairV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget(rawBudget, "encodeProjections");
    if (
      !isNonArrayRecord(input) ||
      !hasExactKeys(input, [
        "deploymentAnalysis",
        "deploymentCodegenAnalysis",
      ])
    ) {
      return yield* Result.fail(
        staticError("encodeProjections", "invalidInput"),
      );
    }
    const analysisInput = ownDataValue(input, "deploymentAnalysis");
    const codegenInput = ownDataValue(input, "deploymentCodegenAnalysis");
    const effectiveMaximum = Math.min(
      budget.maximumCanonicalBytes,
      budget.maximumFrameBytes,
    );
    const analysisLength = yield* measureProjectionCanonicalBytes(
      analysisInput,
      effectiveMaximum,
      budget,
      0,
    );
    const codegenLength = yield* measureProjectionCanonicalBytes(
      codegenInput,
      effectiveMaximum - analysisLength,
      budget,
      analysisLength,
    );
    const canonicalBytes = checkedAdd(analysisLength, codegenLength);
    const analysis = yield* captureProjection(
      analysisInput,
      "analysis",
      "encodeProjections",
    );
    const codegen = yield* captureProjection(
      codegenInput,
      "codegen",
      "encodeProjections",
    );
    if (
      analysis.bytes.byteLength !== analysisLength ||
      codegen.bytes.byteLength !== codegenLength
    ) {
      throw new DeclarativeV2StaticFinalizationV1InvariantDefect({
        reason: "canonicalEncodingFailed",
      });
    }
    yield* verifyProjectionPair(
      analysis.value,
      codegen.value,
      "encodeProjections",
    );
    if (canonicalBytes > budget.maximumCanonicalBytes) {
      return yield* Result.fail(limitError(
        "encodeProjections",
        "canonicalBytesExceeded",
        canonicalBytes,
        budget.maximumCanonicalBytes,
      ));
    }
    if (canonicalBytes > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        "encodeProjections",
        "frameBytesExceeded",
        canonicalBytes,
        budget.maximumFrameBytes,
      ));
    }
    return Object.freeze({
      deploymentAnalysis: analysis.value,
      deploymentCodegenAnalysis: codegen.value,
      deploymentAnalysisCanonicalBytes: analysis.bytes,
      deploymentCodegenAnalysisCanonicalBytes: codegen.bytes,
      usage: Object.freeze({
        frameBytes: canonicalBytes,
        canonicalBytes,
      }),
    });
  });
}

export function decodeDeclarativeV2ProjectionPairV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2ProjectionPairV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget(rawBudget, "decodeProjections");
    if (
      !isNonArrayRecord(input) ||
      !hasExactKeys(input, [
        "deploymentAnalysisCanonicalBytes",
        "deploymentCodegenAnalysisCanonicalBytes",
      ])
    ) {
      return yield* Result.fail(
        staticError("decodeProjections", "invalidInput"),
      );
    }
    const analysisInput = ownDataValue(
      input,
      "deploymentAnalysisCanonicalBytes",
    );
    const codegenInput = ownDataValue(
      input,
      "deploymentCodegenAnalysisCanonicalBytes",
    );
    const analysisLength = projectionByteLength(analysisInput);
    const codegenLength = projectionByteLength(codegenInput);
    if (
      analysisLength === undefined ||
      codegenLength === undefined ||
      analysisLength === 0 ||
      codegenLength === 0
    ) {
      return yield* Result.fail(
        staticError("decodeProjections", "invalidInput"),
      );
    }
    const canonicalBytes = checkedAdd(
      analysisLength,
      codegenLength,
    );
    if (canonicalBytes > budget.maximumCanonicalBytes) {
      return yield* Result.fail(limitError(
        "decodeProjections",
        "canonicalBytesExceeded",
        canonicalBytes,
        budget.maximumCanonicalBytes,
      ));
    }
    if (canonicalBytes > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        "decodeProjections",
        "frameBytesExceeded",
        canonicalBytes,
        budget.maximumFrameBytes,
      ));
    }
    const analysisBytes = yield* captureProjectionBytes(analysisInput);
    const codegenBytes = yield* captureProjectionBytes(codegenInput);
    const analysis = yield* parseProjectionBytes(
      analysisBytes,
      "analysis",
    );
    const codegen = yield* parseProjectionBytes(codegenBytes, "codegen");
    yield* verifyProjectionPair(
      analysis.value,
      codegen.value,
      "decodeProjections",
    );
    if (
      !bytesEqualFullScan(analysisBytes, analysis.bytes) ||
      !bytesEqualFullScan(codegenBytes, codegen.bytes)
    ) {
      return yield* Result.fail(
        staticError("decodeProjections", "nonCanonical"),
      );
    }
    return Object.freeze({
      deploymentAnalysis: analysis.value,
      deploymentCodegenAnalysis: codegen.value,
      deploymentAnalysisCanonicalBytes: analysisBytes,
      deploymentCodegenAnalysisCanonicalBytes: codegenBytes,
      usage: Object.freeze({
        frameBytes: canonicalBytes,
        canonicalBytes,
      }),
    });
  });
}

function encodeCompletion(
  input: unknown,
  rawBudget: unknown,
  operation: CompletionOperation,
): Result.Result<
  DeclarativeV2EncodedStaticFrameV1<
    DeclarativeV2StaticVerificationCompletionFrameV1
  >,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget(rawBudget, operation);
    const frame = yield* captureCompletion(input, operation);
    const length = completionByteLength(frame);
    if (length > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        operation,
        "frameBytesExceeded",
        length,
        budget.maximumFrameBytes,
      ));
    }
    const bytes = new Uint8Array(length);
    let offset = writeBytes(bytes, 0, COMPLETION_DOMAIN);
    writeU32(bytes, offset, COMPLETION_FIELD_COUNT);
    offset += 4;
    for (const digest of [
      frame.attemptSha256,
      frame.candidateSha256,
      frame.semanticAttemptIdentitySha256,
      frame.semanticSelectorSha256,
    ]) {
      offset = writeBytes(bytes, offset, digest);
    }
    offset = writeString(
      bytes,
      offset,
      frame.verifierProgressProtocolIdentity,
    );
    offset = writeString(
      bytes,
      offset,
      frame.verifierBudgetProtocolIdentity,
    );
    for (const digest of [
      frame.ceilingsSha256,
      frame.usageSha256,
      frame.sourceTailSha256,
      frame.parseTailSha256,
      frame.linkTailSha256,
      frame.registrationTailSha256,
      frame.lastReceiptSha256,
    ]) {
      offset = writeBytes(bytes, offset, digest);
    }
    for (const counter of [
      frame.moduleCount,
      frame.importEdgeCount,
      frame.registrationCount,
      frame.diagnosticCount,
    ]) {
      writeU64(bytes, offset, counter);
      offset += 8;
    }
    offset = writeBytes(bytes, offset, frame.diagnosticRootSha256);
    bytes[offset] = statusTag(frame.status);
    offset += 1;
    offset = writeNullableString(bytes, offset, frame.failureCode);
    offset = writeNullableDigest(bytes, offset, frame.handlerSetSha256);
    writeNullableDigest(bytes, offset, frame.registrationRootSha256);
    return Object.freeze({
      frame,
      canonicalBytes: bytes,
      usage: Object.freeze({ frameBytes: length, canonicalBytes: 0 }),
    });
  });
}

function encodeStaticFinalization(
  input: unknown,
  rawBudget: unknown,
  operation: StaticOperation,
): Result.Result<
  DeclarativeV2EncodedStaticFrameV1<DeclarativeV2StaticFinalizationFrameV1>,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeBudget(rawBudget, operation);
    const frame = yield* captureStaticFinalization(input, operation);
    const length = staticFinalizationByteLength(frame);
    if (length > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        operation,
        "frameBytesExceeded",
        length,
        budget.maximumFrameBytes,
      ));
    }
    const bytes = new Uint8Array(length);
    let offset = writeBytes(bytes, 0, STATIC_FINALIZATION_DOMAIN);
    writeU32(bytes, offset, STATIC_FINALIZATION_FIELD_COUNT);
    offset += 4;
    for (const digest of [
      frame.attemptSha256,
      frame.candidateSha256,
      frame.completionSha256,
      frame.semanticAttemptIdentitySha256,
    ]) {
      offset = writeBytes(bytes, offset, digest);
    }
    bytes[offset] = statusTag(frame.status);
    offset += 1;
    offset = writeNullableString(bytes, offset, frame.failureCode);
    offset = writeBytes(bytes, offset, frame.diagnosticRootSha256);
    for (const digest of [
      frame.handlerSetSha256,
      frame.registrationRootSha256,
      frame.deploymentAnalysisProjectionSha256,
      frame.deploymentCodegenAnalysisProjectionSha256,
    ]) {
      offset = writeNullableDigest(bytes, offset, digest);
    }
    return Object.freeze({
      frame,
      canonicalBytes: bytes,
      usage: Object.freeze({ frameBytes: length, canonicalBytes: 0 }),
    });
  });
}

function captureCompletion(
  input: unknown,
  operation: CompletionOperation,
): Result.Result<
  DeclarativeV2StaticVerificationCompletionFrameV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  const fields = [
    "attemptSha256",
    "candidateSha256",
    "semanticAttemptIdentitySha256",
    "semanticSelectorSha256",
    "verifierProgressProtocolIdentity",
    "verifierBudgetProtocolIdentity",
    "ceilingsSha256",
    "usageSha256",
    "sourceTailSha256",
    "parseTailSha256",
    "linkTailSha256",
    "registrationTailSha256",
    "lastReceiptSha256",
    "moduleCount",
    "importEdgeCount",
    "registrationCount",
    "diagnosticCount",
    "diagnosticRootSha256",
    "status",
    "failureCode",
    "handlerSetSha256",
    "registrationRootSha256",
  ] as const;
  if (!isNonArrayRecord(input) || !hasExactKeys(input, fields)) {
    return Result.fail(staticError(operation, "invalidInput"));
  }
  const digests: Record<string, Uint8Array> = {};
  for (const field of [
    "attemptSha256",
    "candidateSha256",
    "semanticAttemptIdentitySha256",
    "semanticSelectorSha256",
    "ceilingsSha256",
    "usageSha256",
    "sourceTailSha256",
    "parseTailSha256",
    "linkTailSha256",
    "registrationTailSha256",
    "lastReceiptSha256",
    "diagnosticRootSha256",
  ] as const) {
    const digest = ownDataValue(input, field);
    if (!isDigest(digest)) {
      return Result.fail(staticError(operation, "invalidInput", field));
    }
    digests[field] = new Uint8Array(digest);
  }
  const counters: Record<string, bigint> = {};
  for (const field of [
    "moduleCount",
    "importEdgeCount",
    "registrationCount",
    "diagnosticCount",
  ] as const) {
    const value = ownDataValue(input, field);
    if (!isU64(value)) {
      return Result.fail(staticError(operation, "invalidInput", field));
    }
    counters[field] = value;
  }
  const verifierProgressProtocolIdentity = ownDataValue(
    input,
    "verifierProgressProtocolIdentity",
  );
  const verifierBudgetProtocolIdentity = ownDataValue(
    input,
    "verifierBudgetProtocolIdentity",
  );
  const status = ownDataValue(input, "status");
  const failureCode = ownDataValue(input, "failureCode");
  const handlerSetSha256 = ownDataValue(input, "handlerSetSha256");
  const registrationRootSha256 = ownDataValue(
    input,
    "registrationRootSha256",
  );
  if (
    verifierProgressProtocolIdentity !==
      DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2 ||
    verifierBudgetProtocolIdentity !==
      DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2 ||
    !isStatus(status) ||
    !isNullableFailureCode(failureCode) ||
    !isNullableDigest(handlerSetSha256) ||
    !isNullableDigest(registrationRootSha256)
  ) {
    return Result.fail(staticError(operation, "invalidInput"));
  }
  if (
    status === "verified"
      ? failureCode !== null ||
        handlerSetSha256 === null ||
        registrationRootSha256 === null
      : !isNonBlankString(failureCode) ||
        handlerSetSha256 !== null ||
        registrationRootSha256 !== null
  ) {
    return Result.fail(staticError(operation, "invalidInput", "status"));
  }
  return Result.succeed(Object.freeze({
    attemptSha256: digests["attemptSha256"]!,
    candidateSha256: digests["candidateSha256"]!,
    semanticAttemptIdentitySha256:
      digests["semanticAttemptIdentitySha256"]!,
    semanticSelectorSha256: digests["semanticSelectorSha256"]!,
    verifierProgressProtocolIdentity,
    verifierBudgetProtocolIdentity,
    ceilingsSha256: digests["ceilingsSha256"]!,
    usageSha256: digests["usageSha256"]!,
    sourceTailSha256: digests["sourceTailSha256"]!,
    parseTailSha256: digests["parseTailSha256"]!,
    linkTailSha256: digests["linkTailSha256"]!,
    registrationTailSha256: digests["registrationTailSha256"]!,
    lastReceiptSha256: digests["lastReceiptSha256"]!,
    moduleCount: counters["moduleCount"]!,
    importEdgeCount: counters["importEdgeCount"]!,
    registrationCount: counters["registrationCount"]!,
    diagnosticCount: counters["diagnosticCount"]!,
    diagnosticRootSha256: digests["diagnosticRootSha256"]!,
    status,
    failureCode,
    handlerSetSha256: handlerSetSha256 === null
      ? null
      : new Uint8Array(handlerSetSha256),
    registrationRootSha256: registrationRootSha256 === null
      ? null
      : new Uint8Array(registrationRootSha256),
  }));
}

function captureStaticFinalization(
  input: unknown,
  operation: StaticOperation,
): Result.Result<
  DeclarativeV2StaticFinalizationFrameV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  const fields = [
    "attemptSha256",
    "candidateSha256",
    "completionSha256",
    "semanticAttemptIdentitySha256",
    "status",
    "failureCode",
    "diagnosticRootSha256",
    "handlerSetSha256",
    "registrationRootSha256",
    "deploymentAnalysisProjectionSha256",
    "deploymentCodegenAnalysisProjectionSha256",
  ] as const;
  if (!isNonArrayRecord(input) || !hasExactKeys(input, fields)) {
    return Result.fail(staticError(operation, "invalidInput"));
  }
  const requiredDigests: Record<string, Uint8Array> = {};
  for (const field of [
    "attemptSha256",
    "candidateSha256",
    "completionSha256",
    "semanticAttemptIdentitySha256",
    "diagnosticRootSha256",
  ] as const) {
    const value = ownDataValue(input, field);
    if (!isDigest(value)) {
      return Result.fail(staticError(operation, "invalidInput", field));
    }
    requiredDigests[field] = new Uint8Array(value);
  }
  const status = ownDataValue(input, "status");
  const failureCode = ownDataValue(input, "failureCode");
  const optional = [
    ownDataValue(input, "handlerSetSha256"),
    ownDataValue(input, "registrationRootSha256"),
    ownDataValue(input, "deploymentAnalysisProjectionSha256"),
    ownDataValue(input, "deploymentCodegenAnalysisProjectionSha256"),
  ] as const;
  if (
    !isStatus(status) ||
    !isNullableFailureCode(failureCode) ||
    optional.some((value) => !isNullableDigest(value))
  ) {
    return Result.fail(staticError(operation, "invalidInput"));
  }
  if (
    status === "verified"
      ? failureCode !== null || optional.some((value) => value === null)
      : !isNonBlankString(failureCode) ||
        optional.some((value) => value !== null)
  ) {
    return Result.fail(staticError(operation, "invalidInput", "status"));
  }
  const copiedOptional = optional.map(copyValidatedNullableDigest);
  return Result.succeed(Object.freeze({
    attemptSha256: requiredDigests["attemptSha256"]!,
    candidateSha256: requiredDigests["candidateSha256"]!,
    completionSha256: requiredDigests["completionSha256"]!,
    semanticAttemptIdentitySha256:
      requiredDigests["semanticAttemptIdentitySha256"]!,
    status,
    failureCode,
    diagnosticRootSha256: requiredDigests["diagnosticRootSha256"]!,
    handlerSetSha256: copiedOptional[0]!,
    registrationRootSha256: copiedOptional[1]!,
    deploymentAnalysisProjectionSha256: copiedOptional[2]!,
    deploymentCodegenAnalysisProjectionSha256: copiedOptional[3]!,
  }));
}

function completionByteLength(
  frame: DeclarativeV2StaticVerificationCompletionFrameV1,
): number {
  return checkedAdd(
    COMPLETION_DOMAIN.byteLength,
    4,
    12 * DECLARATIVE_V2_SHA256_BYTES_V1,
    stringFrameLength(frame.verifierProgressProtocolIdentity),
    stringFrameLength(frame.verifierBudgetProtocolIdentity),
    4 * 8,
    1,
    nullableStringFrameLength(frame.failureCode),
    nullableDigestFrameLength(frame.handlerSetSha256),
    nullableDigestFrameLength(frame.registrationRootSha256),
  );
}

function staticFinalizationByteLength(
  frame: DeclarativeV2StaticFinalizationFrameV1,
): number {
  return checkedAdd(
    STATIC_FINALIZATION_DOMAIN.byteLength,
    4,
    5 * DECLARATIVE_V2_SHA256_BYTES_V1,
    1,
    nullableStringFrameLength(frame.failureCode),
    nullableDigestFrameLength(frame.handlerSetSha256),
    nullableDigestFrameLength(frame.registrationRootSha256),
    nullableDigestFrameLength(frame.deploymentAnalysisProjectionSha256),
    nullableDigestFrameLength(frame.deploymentCodegenAnalysisProjectionSha256),
  );
}

function parseCompletion(
  input: Uint8Array,
): Result.Result<
  DeclarativeV2StaticVerificationCompletionFrameV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    let offset = yield* requireDomain(
      input,
      COMPLETION_DOMAIN,
      "decodeCompletion",
    );
    offset = yield* requireFieldCount(
      input,
      offset,
      COMPLETION_FIELD_COUNT,
      "decodeCompletion",
    );
    const requiredDigests: Uint8Array[] = [];
    for (let index = 0; index < 4; index += 1) {
      const value = yield* readDigest(input, offset, "decodeCompletion");
      requiredDigests.push(value);
      offset += 32;
    }
    const progress = yield* readString(input, offset, "decodeCompletion");
    offset = progress.offset;
    const budget = yield* readString(input, offset, "decodeCompletion");
    offset = budget.offset;
    for (let index = 0; index < 7; index += 1) {
      const value = yield* readDigest(input, offset, "decodeCompletion");
      requiredDigests.push(value);
      offset += 32;
    }
    const counters: bigint[] = [];
    for (let index = 0; index < 4; index += 1) {
      const value = readU64(input, offset);
      if (value === undefined) {
        return yield* Result.fail(
          staticError("decodeCompletion", "malformed"),
        );
      }
      counters.push(value);
      offset += 8;
    }
    const diagnosticRoot = yield* readDigest(
      input,
      offset,
      "decodeCompletion",
    );
    offset += 32;
    const status = yield* readStatus(input, offset, "decodeCompletion");
    offset += 1;
    const failureCode = yield* readNullableString(
      input,
      offset,
      "decodeCompletion",
    );
    offset = failureCode.offset;
    const handlerSet = yield* readNullableDigest(
      input,
      offset,
      "decodeCompletion",
    );
    offset = handlerSet.offset;
    const registrationRoot = yield* readNullableDigest(
      input,
      offset,
      "decodeCompletion",
    );
    offset = registrationRoot.offset;
    if (offset !== input.byteLength) {
      return yield* Result.fail(
        staticError("decodeCompletion", "malformed", "trailing"),
      );
    }
    return yield* captureCompletion({
      attemptSha256: requiredDigests[0],
      candidateSha256: requiredDigests[1],
      semanticAttemptIdentitySha256: requiredDigests[2],
      semanticSelectorSha256: requiredDigests[3],
      verifierProgressProtocolIdentity: progress.value,
      verifierBudgetProtocolIdentity: budget.value,
      ceilingsSha256: requiredDigests[4],
      usageSha256: requiredDigests[5],
      sourceTailSha256: requiredDigests[6],
      parseTailSha256: requiredDigests[7],
      linkTailSha256: requiredDigests[8],
      registrationTailSha256: requiredDigests[9],
      lastReceiptSha256: requiredDigests[10],
      moduleCount: counters[0],
      importEdgeCount: counters[1],
      registrationCount: counters[2],
      diagnosticCount: counters[3],
      diagnosticRootSha256: diagnosticRoot,
      status,
      failureCode: failureCode.value,
      handlerSetSha256: handlerSet.value,
      registrationRootSha256: registrationRoot.value,
    }, "decodeCompletion");
  });
}

function parseStaticFinalization(
  input: Uint8Array,
): Result.Result<
  DeclarativeV2StaticFinalizationFrameV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  return Result.gen(function* () {
    let offset = yield* requireDomain(
      input,
      STATIC_FINALIZATION_DOMAIN,
      "decodeStaticFinalization",
    );
    offset = yield* requireFieldCount(
      input,
      offset,
      STATIC_FINALIZATION_FIELD_COUNT,
      "decodeStaticFinalization",
    );
    const requiredDigests: Uint8Array[] = [];
    for (let index = 0; index < 4; index += 1) {
      const value = yield* readDigest(
        input,
        offset,
        "decodeStaticFinalization",
      );
      requiredDigests.push(value);
      offset += 32;
    }
    const status = yield* readStatus(
      input,
      offset,
      "decodeStaticFinalization",
    );
    offset += 1;
    const failureCode = yield* readNullableString(
      input,
      offset,
      "decodeStaticFinalization",
    );
    offset = failureCode.offset;
    const diagnosticRoot = yield* readDigest(
      input,
      offset,
      "decodeStaticFinalization",
    );
    offset += 32;
    const optional: Array<Uint8Array | null> = [];
    for (let index = 0; index < 4; index += 1) {
      const value = yield* readNullableDigest(
        input,
        offset,
        "decodeStaticFinalization",
      );
      optional.push(value.value);
      offset = value.offset;
    }
    if (offset !== input.byteLength) {
      return yield* Result.fail(
        staticError("decodeStaticFinalization", "malformed", "trailing"),
      );
    }
    return yield* captureStaticFinalization({
      attemptSha256: requiredDigests[0],
      candidateSha256: requiredDigests[1],
      completionSha256: requiredDigests[2],
      semanticAttemptIdentitySha256: requiredDigests[3],
      status,
      failureCode: failureCode.value,
      diagnosticRootSha256: diagnosticRoot,
      handlerSetSha256: optional[0],
      registrationRootSha256: optional[1],
      deploymentAnalysisProjectionSha256: optional[2],
      deploymentCodegenAnalysisProjectionSha256: optional[3],
    }, "decodeStaticFinalization");
  });
}

function captureProjection(
  input: unknown,
  kind: "analysis",
  operation: ProjectionOperation,
): Result.Result<
  Readonly<{
    readonly value: DeploymentAnalysis;
    readonly bytes: Uint8Array;
  }>,
  DeclarativeV2StaticFinalizationV1Error
>;
function captureProjection(
  input: unknown,
  kind: "codegen",
  operation: ProjectionOperation,
): Result.Result<
  Readonly<{
    readonly value: DeploymentCodegenAnalysis;
    readonly bytes: Uint8Array;
  }>,
  DeclarativeV2StaticFinalizationV1Error
>;
function captureProjection(
  input: unknown,
  kind: "analysis" | "codegen",
  operation: ProjectionOperation,
): Result.Result<
  Readonly<{
    readonly value: DeploymentAnalysis | DeploymentCodegenAnalysis;
    readonly bytes: Uint8Array;
  }>,
  DeclarativeV2StaticFinalizationV1Error
> {
  const json = captureOwnedJson(input);
  if (json === undefined) {
    return Result.fail(staticError(operation, "invalidInput", kind));
  }
  let value: DeploymentAnalysis | DeploymentCodegenAnalysis;
  let policy: boolean;
  if (kind === "analysis") {
    const decodedOutcome = Result.match(decodeDeploymentAnalysisResult(json), {
      onSuccess: (decoded) => ({ ok: true as const, decoded }),
      onFailure: () => ({ ok: false as const }),
    });
    if (!decodedOutcome.ok) {
      return Result.fail(staticError(operation, "invalidInput", kind));
    }
    value = freezeOwnedProtocolProjection(decodedOutcome.decoded);
    policy = validateDeploymentAnalysisV2(value);
  } else {
    const decodedOutcome = Result.match(
      decodeDeploymentCodegenAnalysisResult(json),
      {
        onSuccess: (decoded) => ({ ok: true as const, decoded }),
        onFailure: () => ({ ok: false as const }),
      },
    );
    if (!decodedOutcome.ok) {
      return Result.fail(staticError(operation, "invalidInput", kind));
    }
    value = freezeOwnedProtocolProjection(decodedOutcome.decoded);
    policy = validateDeploymentCodegenAnalysisV2(value);
  }
  if (!policy) {
    return Result.fail(staticError(operation, "invalidInput", kind));
  }
  const canonical = encodeCanonicalJson(json, () => {
    throw new DeclarativeV2StaticFinalizationV1InvariantDefect({
      reason: "canonicalEncodingFailed",
    });
  });
  return Result.succeed(Object.freeze({
    value,
    bytes: UTF8_ENCODER.encode(canonical),
  }));
}

function parseProjectionBytes(
  input: Uint8Array,
  kind: "analysis",
): Result.Result<
  Readonly<{
    readonly value: DeploymentAnalysis;
    readonly bytes: Uint8Array;
  }>,
  DeclarativeV2StaticFinalizationV1Error
>;
function parseProjectionBytes(
  input: Uint8Array,
  kind: "codegen",
): Result.Result<
  Readonly<{
    readonly value: DeploymentCodegenAnalysis;
    readonly bytes: Uint8Array;
  }>,
  DeclarativeV2StaticFinalizationV1Error
>;
function parseProjectionBytes(
  input: Uint8Array,
  kind: "analysis" | "codegen",
): Result.Result<
  Readonly<{
    readonly value: DeploymentAnalysis | DeploymentCodegenAnalysis;
    readonly bytes: Uint8Array;
  }>,
  DeclarativeV2StaticFinalizationV1Error
> {
  let text: string;
  try {
    text = FATAL_UTF8_DECODER.decode(input);
  } catch {
    return Result.fail(staticError("decodeProjections", "malformed", kind));
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return Result.fail(staticError("decodeProjections", "malformed", kind));
  }
  return kind === "analysis"
    ? captureProjection(value, "analysis", "decodeProjections")
    : captureProjection(value, "codegen", "decodeProjections");
}

function captureProjectionBytes(
  input: unknown,
): Result.Result<Uint8Array, DeclarativeV2StaticFinalizationV1Error> {
  if (!isUint8Array(input)) {
    return Result.fail(
      staticError("decodeProjections", "invalidInput"),
    );
  }
  const length = intrinsicByteLength(input);
  if (length === undefined || length === 0) {
    return Result.fail(
      staticError("decodeProjections", "invalidInput"),
    );
  }
  try {
    return Result.succeed(new Uint8Array(input));
  } catch {
    return Result.fail(
      staticError("decodeProjections", "invalidInput"),
    );
  }
}

function verifyProjectionPair(
  analysis: DeploymentAnalysis,
  codegen: DeploymentCodegenAnalysis,
  operation: ProjectionOperation,
): Result.Result<void, DeclarativeV2StaticFinalizationV1Error> {
  if (!jsonEqual(
    captureTrustedJson(analysis.schema) ?? null,
    captureTrustedJson(codegen.schema) ?? null,
  )) {
    return Result.fail(
      staticError(operation, "projectionMismatch", "schema"),
    );
  }
  const analysisFunctions = analysis.functions.functions;
  const codegenFunctions = codegen.functions.flatMap((module) =>
    module.functions.map((fn) => ({
      path: fn.exportName === "default"
        ? module.moduleName
        : `${module.moduleName}:${fn.exportName}`,
      fn,
    }))
  );
  codegenFunctions.sort((left, right) =>
    compareUtf16Strings(left.path, right.path)
  );
  if (analysisFunctions.length !== codegenFunctions.length) {
    return Result.fail(
      staticError(operation, "projectionMismatch", "functions"),
    );
  }
  for (let index = 0; index < analysisFunctions.length; index += 1) {
    const left = analysisFunctions[index]!;
    const right = codegenFunctions[index]!;
    if (
      left.path !== right.path ||
      left.kind !== right.fn.kind ||
      left.visibility !== right.fn.visibility ||
      !jsonEqual(
        captureTrustedJson(left.args) ?? null,
        captureTrustedJson(right.fn.args) ?? null,
      ) ||
      !jsonEqual(
        captureTrustedJson(left.returns) ?? null,
        captureTrustedJson(right.fn.returns) ?? null,
      ) ||
      !jsonEqual(
        captureTrustedJson(left.partition) ?? null,
        captureTrustedJson(right.fn.partition) ?? null,
      )
    ) {
      return Result.fail(
        staticError(operation, "projectionMismatch", "functions"),
      );
    }
  }
  return Result.succeed(undefined);
}

function validateDeploymentAnalysisV2(value: DeploymentAnalysis): boolean {
  if (
    value.schema.version !== 1 ||
    !validateDeploymentSchemaV2(value.schema) ||
    !isStrictlyIncreasing(value.schema.tables, (item) => item.tableId) ||
    !isStrictlyIncreasing(value.schema.indexes, (item) => item.indexId) ||
    !isStrictlyIncreasing(
      value.functions.functions,
      (item) => item.path,
      compareUtf16Strings,
    )
  ) return false;
  for (const fn of value.functions.functions) {
    if (
      fn.path.length === 0 ||
      fn.visibility === undefined ||
      fn.args === undefined ||
      fn.returns === undefined ||
      fn.route !== null ||
      fn.partition === undefined ||
      fn.position !== undefined
    ) return false;
  }
  return validateFunctionPartitionsV2(value);
}

function validateDeploymentCodegenAnalysisV2(
  value: DeploymentCodegenAnalysis,
): boolean {
  if (
    value.schema.version !== 1 ||
    !validateDeploymentSchemaV2(value.schema) ||
    !isStrictlyIncreasing(value.schema.tables, (item) => item.tableId) ||
    !isStrictlyIncreasing(value.schema.indexes, (item) => item.indexId) ||
    !isStrictlyIncreasing(
      value.functions,
      (item) => item.moduleName,
      compareUtf16Strings,
    )
  ) return false;
  for (const module of value.functions) {
    if (
      module.moduleName.length === 0 ||
      module.functions.length === 0 ||
      !isStrictlyIncreasing(
        module.functions,
        (item) => item.exportName === "default"
          ? module.moduleName
          : `${module.moduleName}:${item.exportName}`,
        compareUtf16Strings,
      )
    ) return false;
    for (const fn of module.functions) {
      if (
        fn.moduleName !== module.moduleName ||
        fn.exportName.length === 0 ||
        fn.partition === undefined ||
        fn.position !== undefined
      ) return false;
    }
  }
  return true;
}

function validateDeploymentSchemaV2(
  schema: DeploymentAnalysis["schema"],
): boolean {
  const tableIds = new Set<number>();
  for (const table of schema.tables) {
    if (
      !Number.isInteger(table.tableId) ||
      table.tableId <= 0 ||
      tableIds.has(table.tableId) ||
      table.name.length === 0 ||
      table.state !== undefined ||
      table.validator === undefined ||
      table.validator === null
    ) {
      return false;
    }
    tableIds.add(table.tableId);
  }
  const indexIds = new Set<number>();
  for (const index of schema.indexes) {
    if (
      !Number.isInteger(index.indexId) ||
      index.indexId <= 0 ||
      indexIds.has(index.indexId) ||
      !tableIds.has(index.tableId) ||
      index.name.length === 0 ||
      index.state !== undefined
    ) {
      return false;
    }
    indexIds.add(index.indexId);
  }
  return true;
}

function validateFunctionPartitionsV2(
  analysis: DeploymentAnalysis,
): boolean {
  const tables = new Map(
    analysis.schema.tables.map((table) => [table.name, table]),
  );
  for (const fn of analysis.functions.functions) {
    const partition = fn.partition;
    if (partition === undefined) return false;
    if (partition === null) continue;
    const table = tables.get(partition.table);
    if (
      partition.table.length === 0 ||
      table === undefined ||
      table.placement.kind !== "partitionBy"
    ) {
      return false;
    }
    if (partition.type === "partitionCreateRoot") {
      if (
        table.placement.field !== "_id" ||
        partition.partitionField !== "_id"
      ) {
        return false;
      }
      continue;
    }
    if (
      partition.selector.length === 0 ||
      partition.partitionField.length === 0 ||
      partition.argField.length === 0 ||
      table.placement.field !== partition.partitionField ||
      partition.selector !==
        selectorNameForPartitionField(table.placement.field) ||
      !validatorHasRequiredField(fn.args, partition.argField)
    ) {
      return false;
    }
  }
  return true;
}

function validatorHasRequiredField(
  validator: DeploymentAnalysis["functions"]["functions"][number]["args"],
  field: string,
): boolean {
  return validator !== undefined &&
    validator !== null &&
    validator.type === "object" &&
    Object.hasOwn(validator.value, field) &&
    validator.value[field]?.optional === false;
}

function isStrictlyIncreasing<T, Key extends number | string>(
  values: readonly T[],
  key: (value: T) => Key,
  compare: (left: Key, right: Key) => number = defaultCompare,
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(key(values[index - 1]!), key(values[index]!)) >= 0) {
      return false;
    }
  }
  return true;
}

function defaultCompare<Key extends number | string>(
  left: Key,
  right: Key,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function measureProjectionCanonicalBytes(
  input: unknown,
  remainingMaximum: number,
  budget: DeclarativeV2StaticFrameBudgetV1,
  previousBytes: number,
): Result.Result<number, DeclarativeV2StaticFinalizationV1Error> {
  const measured = measureCanonicalJsonUtf8Bytes(input, remainingMaximum);
  if (measured.kind === "invalid") {
    return Result.fail(
      staticError("encodeProjections", "invalidInput"),
    );
  }
  if (measured.kind === "exceeded") {
    const observed = checkedAdd(previousBytes, measured.observed);
    return observed > budget.maximumCanonicalBytes
      ? Result.fail(limitError(
        "encodeProjections",
        "canonicalBytesExceeded",
        observed,
        budget.maximumCanonicalBytes,
      ))
      : Result.fail(limitError(
        "encodeProjections",
        "frameBytesExceeded",
        observed,
        budget.maximumFrameBytes,
      ));
  }
  return Result.succeed(measured.bytes);
}

function captureOwnedJson(input: unknown): Json | undefined {
  const captured = capturePlainData(
    input,
    new WeakSet<object>(),
    false,
  );
  return captured !== undefined && isJson(captured) ? captured : undefined;
}

function captureTrustedJson(input: unknown): Json | undefined {
  const captured = capturePlainData(
    input,
    new WeakSet<object>(),
    true,
  );
  return captured !== undefined && isJson(captured) ? captured : undefined;
}

function capturePlainData(
  input: unknown,
  ancestors: WeakSet<object>,
  allowNonPlainPrototype: boolean,
): Json | undefined {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) return input;
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : undefined;
  }
  if (typeof input !== "object" || ancestors.has(input)) return undefined;
  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  let isArray: boolean;
  try {
    prototype = Object.getPrototypeOf(input);
    ownKeys = Reflect.ownKeys(input);
    isArray = Array.isArray(input);
  } catch {
    return undefined;
  }
  if (
    prototype !== Object.prototype &&
    prototype !== null &&
    !isArray &&
    !allowNonPlainPrototype
  ) return undefined;
  if (ownKeys.some((key) => typeof key !== "string")) return undefined;
  ancestors.add(input);
  if (isArray) {
    const lengthDescriptor = ownDescriptor(input, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !isNonNegativeSafeInteger(lengthDescriptor.value) ||
      ownKeys.length !== lengthDescriptor.value + 1
    ) {
      ancestors.delete(input);
      return undefined;
    }
    const output: Json[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = ownDescriptor(input, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        ancestors.delete(input);
        return undefined;
      }
      const value = capturePlainData(
        descriptor.value,
        ancestors,
        allowNonPlainPrototype,
      );
      if (value === undefined) {
        ancestors.delete(input);
        return undefined;
      }
      output.push(value);
    }
    ancestors.delete(input);
    return output;
  }
  // SAFETY: a freshly created null-prototype object is used as a mutable
  // string-keyed record; only validated JSON values are assigned into it.
  const output = Object.create(null) as Record<string, Json>;
  for (const key of ownKeys) {
    if (typeof key !== "string") {
      ancestors.delete(input);
      return undefined;
    }
    const descriptor = ownDescriptor(input, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      ancestors.delete(input);
      return undefined;
    }
    const value = capturePlainData(
      descriptor.value,
      ancestors,
      allowNonPlainPrototype,
    );
    if (value === undefined) {
      ancestors.delete(input);
      return undefined;
    }
    Object.defineProperty(output, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  ancestors.delete(input);
  return output;
}

function decodeBudget(
  input: unknown,
  operation:
    | CompletionOperation
    | StaticOperation
    | ProjectionOperation,
): Result.Result<
  Readonly<DeclarativeV2StaticFrameBudgetV1>,
  DeclarativeV2StaticFinalizationV1Error
> {
  if (
    !isNonArrayRecord(input) ||
    !hasExactKeys(input, ["maximumFrameBytes", "maximumCanonicalBytes"])
  ) {
    return Result.fail(staticError(operation, "invalidBudget"));
  }
  const maximumFrameBytes = ownDataValue(input, "maximumFrameBytes");
  const maximumCanonicalBytes = ownDataValue(input, "maximumCanonicalBytes");
  if (
    !isNonNegativeSafeInteger(maximumFrameBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes)
  ) {
    return Result.fail(staticError(operation, "invalidBudget"));
  }
  return Result.succeed(Object.freeze({
    maximumFrameBytes,
    maximumCanonicalBytes,
  }));
}

function captureInputBytes(
  input: unknown,
  budget: DeclarativeV2StaticFrameBudgetV1,
  operation: CompletionOperation | StaticOperation,
): Result.Result<Uint8Array, DeclarativeV2StaticFinalizationV1Error> {
  if (!isUint8Array(input)) {
    return Result.fail(staticError(operation, "invalidInput"));
  }
  const length = intrinsicByteLength(input);
  if (length === undefined || length === 0) {
    return Result.fail(staticError(operation, "invalidInput"));
  }
  if (length > budget.maximumFrameBytes) {
    return Result.fail(limitError(
      operation,
      "frameBytesExceeded",
      length,
      budget.maximumFrameBytes,
    ));
  }
  try {
    return Result.succeed(new Uint8Array(input));
  } catch {
    return Result.fail(staticError(operation, "invalidInput"));
  }
}

function requireDomain(
  input: Uint8Array,
  domain: Uint8Array,
  operation: CompletionOperation | StaticOperation,
): Result.Result<number, DeclarativeV2StaticFinalizationV1Error> {
  if (
    input.byteLength < domain.byteLength ||
    !bytesEqualFullScan(input.subarray(0, domain.byteLength), domain)
  ) {
    return Result.fail(staticError(operation, "malformed", "domain"));
  }
  return Result.succeed(domain.byteLength);
}

function requireFieldCount(
  input: Uint8Array,
  offset: number,
  expected: number,
  operation: CompletionOperation | StaticOperation,
): Result.Result<number, DeclarativeV2StaticFinalizationV1Error> {
  const count = readU32(input, offset);
  return count === expected
    ? Result.succeed(offset + 4)
    : Result.fail(staticError(operation, "malformed", "fieldCount"));
}

function readDigest(
  input: Uint8Array,
  offset: number,
  operation: CompletionOperation | StaticOperation,
): Result.Result<Uint8Array, DeclarativeV2StaticFinalizationV1Error> {
  return offset + 32 <= input.byteLength
    ? Result.succeed(new Uint8Array(input.subarray(offset, offset + 32)))
    : Result.fail(staticError(operation, "malformed", "digest"));
}

function readString(
  input: Uint8Array,
  offset: number,
  operation: CompletionOperation | StaticOperation,
): Result.Result<
  Readonly<{ readonly value: string; readonly offset: number }>,
  DeclarativeV2StaticFinalizationV1Error
> {
  const length = readU32(input, offset);
  if (
    length === undefined ||
    length === 0 ||
    offset + 4 + length > input.byteLength
  ) {
    return Result.fail(staticError(operation, "malformed", "string"));
  }
  let value: string;
  try {
    value = FATAL_UTF8_DECODER.decode(
      input.subarray(offset + 4, offset + 4 + length),
    );
  } catch {
    return Result.fail(staticError(operation, "malformed", "string"));
  }
  if (value.includes("\0")) {
    return Result.fail(staticError(operation, "malformed", "string"));
  }
  return Result.succeed(Object.freeze({
    value,
    offset: offset + 4 + length,
  }));
}

function readNullableString(
  input: Uint8Array,
  offset: number,
  operation: CompletionOperation | StaticOperation,
): Result.Result<
  Readonly<{ readonly value: string | null; readonly offset: number }>,
  DeclarativeV2StaticFinalizationV1Error
> {
  if (offset >= input.byteLength) {
    return Result.fail(staticError(operation, "malformed"));
  }
  if (input[offset] === 0) {
    return Result.succeed(Object.freeze({ value: null, offset: offset + 1 }));
  }
  if (input[offset] !== 1) {
    return Result.fail(staticError(operation, "malformed"));
  }
  return readString(input, offset + 1, operation).pipe(
    Result.map((result) => Object.freeze({
      value: result.value,
      offset: result.offset,
    })),
  );
}

function readNullableDigest(
  input: Uint8Array,
  offset: number,
  operation: CompletionOperation | StaticOperation,
): Result.Result<
  Readonly<{ readonly value: Uint8Array | null; readonly offset: number }>,
  DeclarativeV2StaticFinalizationV1Error
> {
  if (offset >= input.byteLength) {
    return Result.fail(staticError(operation, "malformed"));
  }
  if (input[offset] === 0) {
    return Result.succeed(Object.freeze({ value: null, offset: offset + 1 }));
  }
  if (input[offset] !== 1) {
    return Result.fail(staticError(operation, "malformed"));
  }
  return readDigest(input, offset + 1, operation).pipe(
    Result.map((value) => Object.freeze({
      value,
      offset: offset + 33,
    })),
  );
}

function readStatus(
  input: Uint8Array,
  offset: number,
  operation: CompletionOperation | StaticOperation,
): Result.Result<
  DeclarativeV2StaticVerificationStatusV1,
  DeclarativeV2StaticFinalizationV1Error
> {
  if (input[offset] === 1) return Result.succeed("verified");
  if (input[offset] === 2) return Result.succeed("invalid");
  return Result.fail(staticError(operation, "malformed", "status"));
}

function hasExactKeys(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
    return keys.length === fields.length &&
      keys.every((key) => {
        if (typeof key !== "string" || !fields.includes(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        return descriptor !== undefined &&
          descriptor.enumerable &&
          "value" in descriptor;
      });
  } catch {
    return false;
  }
}

function ownDataValue(
  input: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = ownDescriptor(input, key);
  return descriptor !== undefined &&
      descriptor.enumerable &&
      "value" in descriptor
    ? descriptor.value
    : undefined;
}

function ownDescriptor<T extends object>(
  input: T,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    return undefined;
  }
}

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(
    value,
    DECLARATIVE_V2_SHA256_BYTES_V1,
  );
}

function isNullableDigest(value: unknown): value is Uint8Array | null {
  return value === null || isDigest(value);
}

function copyValidatedNullableDigest(
  value: unknown,
): Uint8Array | null {
  if (value === null) return null;
  if (!isDigest(value)) {
    throw new DeclarativeV2StaticFinalizationV1InvariantDefect({
      reason: "canonicalEncodingFailed",
    });
  }
  return new Uint8Array(value);
}

function isNullableFailureCode(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      !value.includes("\0") &&
      hasOnlyPairedSurrogates(value));
}

function projectionByteLength(input: unknown): number | undefined {
  return isUint8Array(input) ? intrinsicByteLength(input) : undefined;
}

function isStatus(
  value: unknown,
): value is DeclarativeV2StaticVerificationStatusV1 {
  return value === "verified" || value === "invalid";
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1;
}

function stringFrameLength(value: string): number {
  return checkedAdd(4, utf8ByteLength(value));
}

function nullableStringFrameLength(value: string | null): number {
  return value === null ? 1 : checkedAdd(1, stringFrameLength(value));
}

function nullableDigestFrameLength(value: Uint8Array | null): number {
  return value === null ? 1 : 33;
}

function writeBytes(
  output: Uint8Array,
  offset: number,
  bytes: Uint8Array,
): number {
  output.set(bytes, offset);
  return offset + bytes.byteLength;
}

function writeString(
  output: Uint8Array,
  offset: number,
  value: string,
): number {
  const bytes = UTF8_ENCODER.encode(value);
  writeU32(output, offset, bytes.byteLength);
  return writeBytes(output, offset + 4, bytes);
}

function writeNullableString(
  output: Uint8Array,
  offset: number,
  value: string | null,
): number {
  if (value === null) {
    output[offset] = 0;
    return offset + 1;
  }
  output[offset] = 1;
  return writeString(output, offset + 1, value);
}

function writeNullableDigest(
  output: Uint8Array,
  offset: number,
  value: Uint8Array | null,
): number {
  if (value === null) {
    output[offset] = 0;
    return offset + 1;
  }
  output[offset] = 1;
  return writeBytes(output, offset + 1, value);
}

function statusTag(status: DeclarativeV2StaticVerificationStatusV1): number {
  return status === "verified" ? 1 : 2;
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function readU32(input: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > input.byteLength) return undefined;
  return (
    input[offset]! * 0x1_00_00_00 +
    input[offset + 1]! * 0x1_00_00 +
    input[offset + 2]! * 0x1_00 +
    input[offset + 3]!
  );
}

function writeU64(output: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function readU64(input: Uint8Array, offset: number): bigint | undefined {
  if (offset + 8 > input.byteLength) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(input[offset + index]!);
  }
  return value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ? value : undefined;
}

function checkedAdd(...values: readonly number[]): number {
  let result = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      result > U32_MAX - value
    ) {
      throw new DeclarativeV2StaticFinalizationV1InvariantDefect({
        reason: "canonicalEncodingFailed",
      });
    }
    result += value;
  }
  return result;
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    return Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch {
    return undefined;
  }
}

function staticError(
  operation:
    | CompletionOperation
    | StaticOperation
    | ProjectionOperation,
  reason: DeclarativeV2StaticFinalizationV1Error["reason"],
  path?: string,
): DeclarativeV2StaticFinalizationV1Error {
  return new DeclarativeV2StaticFinalizationV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}

function limitError(
  operation:
    | CompletionOperation
    | StaticOperation
    | ProjectionOperation,
  reason: "frameBytesExceeded" | "canonicalBytesExceeded",
  observed: number,
  maximum: number,
): DeclarativeV2StaticFinalizationV1Error {
  return new DeclarativeV2StaticFinalizationV1Error({
    operation,
    reason,
    observed,
    maximum,
  });
}

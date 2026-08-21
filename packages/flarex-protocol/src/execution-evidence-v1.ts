import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

export const APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1 =
  "flarex.system/application-action-invocation-request/v1" as const;
export const APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2 =
  "flarex.system/application-action-invocation-request/v2" as const;
export const APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1 =
  "flarex.system/application-action-invocation-outcome/v1" as const;
export const EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1 =
  "flarex.system/external-effect-execution-subject/v1" as const;
export const EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1 =
  "flarex.system/external-effect-attempt/v1" as const;

export const EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1 =
  "flarex.r2/execution-evidence-body/v1" as const;
export const CANONICAL_FLAREX_VALUE_CODEC_IDENTITY_V1 =
  "flarex.codec/canonical-flarex-value/v1" as const;
export const CANONICAL_HTTP_REQUEST_CODEC_IDENTITY_V1 =
  "flarex.codec/canonical-http-request/v1" as const;
export const CANONICAL_HTTP_RESPONSE_CODEC_IDENTITY_V1 =
  "flarex.codec/canonical-http-response/v1" as const;

export type ExecutionEvidenceBodyKindV1 =
  | "action_arguments"
  | "action_result"
  | "application_error_detail"
  | "outbound_http_request"
  | "outbound_http_response";

export type ExecutionEvidenceBodyCodecIdentityV1 =
  | typeof CANONICAL_FLAREX_VALUE_CODEC_IDENTITY_V1
  | typeof CANONICAL_HTTP_REQUEST_CODEC_IDENTITY_V1
  | typeof CANONICAL_HTTP_RESPONSE_CODEC_IDENTITY_V1;

export interface ExecutionEvidenceBodyReferenceV1 {
  readonly storeIdentity: typeof EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1;
  readonly kind: ExecutionEvidenceBodyKindV1;
  readonly codecIdentity: ExecutionEvidenceBodyCodecIdentityV1;
  readonly objectKey: string;
  readonly byteLength: bigint;
  readonly sha256: Uint8Array;
}

export type ExternalEffectExecutionSubjectFrameV1 =
  | Readonly<{
      readonly kind: "direct_action";
      readonly scopeId: string;
      readonly invocationId: string;
      readonly requestIdentitySha256: Uint8Array;
    }>
  | Readonly<{
      readonly kind: "durable_task_attempt";
      readonly scopeId: string;
      readonly runId: string;
      readonly attemptId: string;
      readonly taskDefinitionRevisionSha256: Uint8Array;
    }>;

export interface ApplicationActionInvocationRequestFrameV1 {
  readonly scopeId: string;
  readonly requestKey: string;
  readonly applicationRevisionId: string;
  readonly candidateSha256: Uint8Array;
  readonly actionFunctionPath: string;
  readonly actionBindingSha256: Uint8Array;
  readonly executionIdentitySha256: Uint8Array;
  readonly compatibilityDate: string;
  readonly hostPolicySha256: Uint8Array;
  readonly arguments: ExecutionEvidenceBodyReferenceV1;
}

export interface ApplicationActionInvocationRequestFrameV2 {
  readonly scopeId: string;
  readonly requestKey: string;
  readonly executionAuthoritySha256: Uint8Array;
  readonly actionFunctionPath: string;
  readonly executionIdentitySha256: Uint8Array;
  readonly compatibilityDate: string;
  readonly hostPolicySha256: Uint8Array;
  readonly arguments: ExecutionEvidenceBodyReferenceV1;
}

export type ApplicationActionInvocationOutcomeFrameV1 =
  | Readonly<{
      readonly status: "completed";
      readonly invocationId: string;
      readonly requestIdentitySha256: Uint8Array;
      readonly result: ExecutionEvidenceBodyReferenceV1;
    }>
  | Readonly<{
      readonly status: "failed" | "uncertain" | "cancelled";
      readonly invocationId: string;
      readonly requestIdentitySha256: Uint8Array;
      readonly code: string;
    }>;

export interface ExternalEffectAttemptFrameV1 {
  readonly subject: ExternalEffectExecutionSubjectFrameV1;
  readonly subjectFence: bigint;
  readonly effectOrdinal: bigint;
  readonly effectKind: "outbound_http" | "child_mutation";
  readonly stableEffectKey: string;
  readonly requestIdentitySha256: Uint8Array;
  readonly outboundHttpRequest: ExecutionEvidenceBodyReferenceV1 | null;
  readonly childMutationRequestKey: string | null;
  readonly childMutationFunctionPath: string | null;
  readonly childMutationArgumentsSha256: Uint8Array | null;
}

export interface CanonicalExecutionEvidenceFrameV1<Frame> {
  readonly frame: Frame;
  readonly canonicalBytes: Uint8Array;
}

export class ExecutionEvidenceProtocolV1Error extends Data.TaggedError(
  "ExecutionEvidenceProtocolV1Error",
)<{
  readonly identity:
    | typeof APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1
    | typeof APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2
    | typeof APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1
    | typeof EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1
    | typeof EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1
    | typeof EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1;
  readonly operation: "encode" | "decode" | "reference";
  readonly reason:
    | "invalidInput"
    | "boundsExceeded"
    | "malformed"
    | "nonCanonical";
  readonly path: string;
}> {}

const DIGEST_BYTES = 32;
const MAX_TEXT_BYTES = 2_048;
const MAX_FRAME_BYTES = 64 * 1_024;
const MAX_POSITIVE_INT64 = (1n << 63n) - 1n;
const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function executionEvidenceBodyCodecIdentityV1(
  kind: ExecutionEvidenceBodyKindV1,
): ExecutionEvidenceBodyCodecIdentityV1 {
  switch (kind) {
    case "action_arguments":
    case "action_result":
    case "application_error_detail":
      return CANONICAL_FLAREX_VALUE_CODEC_IDENTITY_V1;
    case "outbound_http_request":
      return CANONICAL_HTTP_REQUEST_CODEC_IDENTITY_V1;
    case "outbound_http_response":
      return CANONICAL_HTTP_RESPONSE_CODEC_IDENTITY_V1;
  }
}

export function executionEvidenceBodyObjectKeyV1(
  kind: unknown,
  digest: unknown,
): Result.Result<string, ExecutionEvidenceProtocolV1Error> {
  if (!isBodyKind(kind)) return failReference("kind");
  if (!isUint8ArrayWithByteLength(digest, DIGEST_BYTES)) {
    return failReference("sha256");
  }
  return Result.succeed(
    `execution-evidence-body/v1/${kind}/${
      encodeBytesToLowercaseHex(digest)
    }`,
  );
}

export function makeExecutionEvidenceBodyReferenceV1(
  kind: unknown,
  digest: unknown,
  byteLength: unknown,
): Result.Result<
  ExecutionEvidenceBodyReferenceV1,
  ExecutionEvidenceProtocolV1Error
> {
  return Result.gen(function* () {
    if (!isBodyKind(kind)) return yield* failReference("kind");
    if (!isUint8ArrayWithByteLength(digest, DIGEST_BYTES)) {
      return yield* failReference("sha256");
    }
    if (
      typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) ||
      byteLength < 1
    ) return yield* failReference("byteLength");
    return Object.freeze({
      storeIdentity: EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1,
      kind,
      codecIdentity: executionEvidenceBodyCodecIdentityV1(kind),
      objectKey: yield* executionEvidenceBodyObjectKeyV1(kind, digest),
      byteLength: BigInt(byteLength),
      sha256: copyBytes(digest),
    });
  });
}

export function decodeExecutionEvidenceBodyReferenceV1(
  input: unknown,
): Result.Result<
  ExecutionEvidenceBodyReferenceV1,
  ExecutionEvidenceProtocolV1Error
> {
  return Result.gen(function* () {
    const record = yield* exactRecord(input, [
      "storeIdentity",
      "kind",
      "codecIdentity",
      "objectKey",
      "byteLength",
      "sha256",
    ], EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1, "reference", "$reference");
    if (record.storeIdentity !== EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1) {
      return yield* failReference("storeIdentity");
    }
    if (!isBodyKind(record.kind)) return yield* failReference("kind");
    const codecIdentity = executionEvidenceBodyCodecIdentityV1(record.kind);
    if (record.codecIdentity !== codecIdentity) {
      return yield* failReference("codecIdentity");
    }
    if (
      typeof record.byteLength !== "bigint" || record.byteLength < 1n ||
      record.byteLength > MAX_POSITIVE_INT64
    ) return yield* failReference("byteLength");
    if (!isUint8ArrayWithByteLength(record.sha256, DIGEST_BYTES)) {
      return yield* failReference("sha256");
    }
    const objectKey = yield* executionEvidenceBodyObjectKeyV1(
      record.kind,
      record.sha256,
    );
    if (record.objectKey !== objectKey) return yield* failReference("objectKey");
    return Object.freeze({
      storeIdentity: EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1,
      kind: record.kind,
      codecIdentity,
      objectKey,
      byteLength: record.byteLength,
      sha256: copyBytes(record.sha256),
    });
  });
}

export const encodeApplicationActionInvocationRequestV1 = (
  input: unknown,
) => encodeFrame(
  APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1,
  captureInvocationRequest(input),
  invocationRequestProjection,
);

export const decodeApplicationActionInvocationRequestV1 = (
  input: unknown,
) => decodeFrame(
  APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1,
  input,
  invocationRequestFromProjection,
  invocationRequestProjection,
);

export const encodeApplicationActionInvocationRequestV2 = (
  input: unknown,
) => encodeFrame(
  APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2,
  captureInvocationRequestV2(input),
  invocationRequestProjectionV2,
);

export const decodeApplicationActionInvocationRequestV2 = (
  input: unknown,
) => decodeFrame(
  APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2,
  input,
  invocationRequestFromProjectionV2,
  invocationRequestProjectionV2,
);

export const encodeApplicationActionInvocationOutcomeV1 = (
  input: unknown,
) => encodeFrame(
  APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1,
  captureInvocationOutcome(input),
  invocationOutcomeProjection,
);

export const decodeApplicationActionInvocationOutcomeV1 = (
  input: unknown,
) => decodeFrame(
  APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1,
  input,
  invocationOutcomeFromProjection,
  invocationOutcomeProjection,
);

export const encodeExternalEffectExecutionSubjectV1 = (input: unknown) =>
  encodeFrame(
    EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1,
    captureSubject(input),
    subjectProjection,
  );

export const decodeExternalEffectExecutionSubjectV1 = (input: unknown) =>
  decodeFrame(
    EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1,
    input,
    subjectFromProjection,
    subjectProjection,
  );

export const encodeExternalEffectAttemptV1 = (input: unknown) => encodeFrame(
  EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1,
  captureEffectAttempt(input),
  effectAttemptProjection,
);

export const decodeExternalEffectAttemptV1 = (input: unknown) => decodeFrame(
  EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1,
  input,
  effectAttemptFromProjection,
  effectAttemptProjection,
);

type Identity =
  | typeof APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1
  | typeof APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2
  | typeof APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1
  | typeof EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1
  | typeof EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1;

type JsonProjection = null | string | ReadonlyArray<JsonProjection>;

function encodeFrame<Frame>(
  identity: Identity,
  captured: Result.Result<Frame, ExecutionEvidenceProtocolV1Error>,
  project: (frame: Frame) => JsonProjection,
): Result.Result<
  CanonicalExecutionEvidenceFrameV1<Frame>,
  ExecutionEvidenceProtocolV1Error
> {
  return captured.pipe(Result.flatMap(frame => {
    const bytes = UTF8.encode(`${identity}\0${JSON.stringify(project(frame))}`);
    return bytes.byteLength > MAX_FRAME_BYTES
      ? Result.fail(protocolError(identity, "encode", "boundsExceeded", "$bytes"))
      : Result.succeed(Object.freeze({ frame, canonicalBytes: bytes }));
  }));
}

function decodeFrame<Frame>(
  identity: Identity,
  input: unknown,
  fromProjection: (value: unknown) => Result.Result<Frame, ExecutionEvidenceProtocolV1Error>,
  project: (frame: Frame) => JsonProjection,
): Result.Result<
  CanonicalExecutionEvidenceFrameV1<Frame>,
  ExecutionEvidenceProtocolV1Error
> {
  if (!isUint8Array(input)) {
    return Result.fail(protocolError(identity, "decode", "invalidInput", "$bytes"));
  }
  if (input.byteLength > MAX_FRAME_BYTES) {
    return Result.fail(protocolError(identity, "decode", "boundsExceeded", "$bytes"));
  }
  let text: string;
  try {
    text = FATAL_UTF8.decode(input);
  } catch {
    return Result.fail(protocolError(identity, "decode", "malformed", "$utf8"));
  }
  const prefix = `${identity}\0`;
  if (!text.startsWith(prefix)) {
    return Result.fail(protocolError(identity, "decode", "malformed", "$domain"));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(prefix.length));
  } catch {
    return Result.fail(protocolError(identity, "decode", "malformed", "$json"));
  }
  return fromProjection(parsed).pipe(
    Result.mapError(error => protocolError(
      identity,
      "decode",
      "malformed",
      error.path,
    )),
    Result.flatMap(frame =>
    encodeFrame(identity, Result.succeed(frame), project).pipe(Result.flatMap(encoded =>
      bytesEqualFullScan(encoded.canonicalBytes, input)
        ? Result.succeed(encoded)
        : Result.fail(protocolError(
            identity,
            "decode",
            "nonCanonical",
            "$bytes",
          ))
    )),
  ));
}

function captureInvocationRequest(
  input: unknown,
): Result.Result<
  ApplicationActionInvocationRequestFrameV1,
  ExecutionEvidenceProtocolV1Error
> {
  const identity = APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "scopeId", "requestKey", "applicationRevisionId", "candidateSha256",
      "actionFunctionPath", "actionBindingSha256", "executionIdentitySha256",
      "compatibilityDate", "hostPolicySha256", "arguments",
    ], identity, "encode", "$");
    const argumentsReference = yield* decodeExecutionEvidenceBodyReferenceV1(
      value.arguments,
    ).pipe(Result.mapError(() =>
      protocolError(identity, "encode", "invalidInput", "arguments")
    ));
    if (argumentsReference.kind !== "action_arguments") {
      return yield* Result.fail(protocolError(
        identity,
        "encode",
        "invalidInput",
        "arguments.kind",
      ));
    }
    return Object.freeze({
      scopeId: yield* textField(value.scopeId, identity, "scopeId"),
      requestKey: yield* textField(value.requestKey, identity, "requestKey"),
      applicationRevisionId: yield* textField(
        value.applicationRevisionId,
        identity,
        "applicationRevisionId",
      ),
      candidateSha256: yield* digestField(value.candidateSha256, identity, "candidateSha256"),
      actionFunctionPath: yield* textField(value.actionFunctionPath, identity, "actionFunctionPath"),
      actionBindingSha256: yield* digestField(value.actionBindingSha256, identity, "actionBindingSha256"),
      executionIdentitySha256: yield* digestField(value.executionIdentitySha256, identity, "executionIdentitySha256"),
      compatibilityDate: yield* textField(value.compatibilityDate, identity, "compatibilityDate"),
      hostPolicySha256: yield* digestField(value.hostPolicySha256, identity, "hostPolicySha256"),
      arguments: argumentsReference,
    });
  });
}

function invocationRequestProjection(
  value: ApplicationActionInvocationRequestFrameV1,
): JsonProjection {
  return [
    value.scopeId,
    value.requestKey,
    value.applicationRevisionId,
    hex(value.candidateSha256),
    value.actionFunctionPath,
    hex(value.actionBindingSha256),
    hex(value.executionIdentitySha256),
    value.compatibilityDate,
    hex(value.hostPolicySha256),
    referenceProjection(value.arguments),
  ];
}

function invocationRequestFromProjection(value: unknown) {
  if (!isTuple(value, 10)) return malformedRequest("$projection");
  return captureInvocationRequest({
    scopeId: value[0], requestKey: value[1], applicationRevisionId: value[2],
    candidateSha256: unhex(value[3]), actionFunctionPath: value[4],
    actionBindingSha256: unhex(value[5]), executionIdentitySha256: unhex(value[6]),
    compatibilityDate: value[7], hostPolicySha256: unhex(value[8]),
    arguments: referenceFromProjection(value[9]),
  });
}

function captureInvocationRequestV2(
  input: unknown,
): Result.Result<
  ApplicationActionInvocationRequestFrameV2,
  ExecutionEvidenceProtocolV1Error
> {
  const identity = APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "scopeId", "requestKey", "executionAuthoritySha256",
      "actionFunctionPath", "executionIdentitySha256", "compatibilityDate",
      "hostPolicySha256", "arguments",
    ], identity, "encode", "$");
    const argumentsReference = yield* decodeExecutionEvidenceBodyReferenceV1(
      value.arguments,
    ).pipe(Result.mapError(() =>
      protocolError(identity, "encode", "invalidInput", "arguments")
    ));
    if (argumentsReference.kind !== "action_arguments") {
      return yield* Result.fail(protocolError(
        identity,
        "encode",
        "invalidInput",
        "arguments.kind",
      ));
    }
    return Object.freeze({
      scopeId: yield* textField(value.scopeId, identity, "scopeId"),
      requestKey: yield* textField(value.requestKey, identity, "requestKey"),
      executionAuthoritySha256: yield* digestField(
        value.executionAuthoritySha256,
        identity,
        "executionAuthoritySha256",
      ),
      actionFunctionPath: yield* textField(
        value.actionFunctionPath,
        identity,
        "actionFunctionPath",
      ),
      executionIdentitySha256: yield* digestField(
        value.executionIdentitySha256,
        identity,
        "executionIdentitySha256",
      ),
      compatibilityDate: yield* textField(
        value.compatibilityDate,
        identity,
        "compatibilityDate",
      ),
      hostPolicySha256: yield* digestField(
        value.hostPolicySha256,
        identity,
        "hostPolicySha256",
      ),
      arguments: argumentsReference,
    });
  });
}

function invocationRequestProjectionV2(
  value: ApplicationActionInvocationRequestFrameV2,
): JsonProjection {
  return [
    value.scopeId,
    value.requestKey,
    hex(value.executionAuthoritySha256),
    value.actionFunctionPath,
    hex(value.executionIdentitySha256),
    value.compatibilityDate,
    hex(value.hostPolicySha256),
    referenceProjection(value.arguments),
  ];
}

function invocationRequestFromProjectionV2(value: unknown) {
  if (!isTuple(value, 8)) {
    return Result.fail(protocolError(
      APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V2,
      "decode",
      "malformed",
      "$projection",
    ));
  }
  return captureInvocationRequestV2({
    scopeId: value[0],
    requestKey: value[1],
    executionAuthoritySha256: unhex(value[2]),
    actionFunctionPath: value[3],
    executionIdentitySha256: unhex(value[4]),
    compatibilityDate: value[5],
    hostPolicySha256: unhex(value[6]),
    arguments: referenceFromProjection(value[7]),
  });
}

function captureInvocationOutcome(input: unknown): Result.Result<
  ApplicationActionInvocationOutcomeFrameV1,
  ExecutionEvidenceProtocolV1Error
> {
  const identity = APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1;
  if (!isPlainRecord(input)) return invalid(identity, "$");
  if (input.status === "completed") {
    return Result.gen(function* () {
      const value = yield* exactRecord(input, [
        "status", "invocationId", "requestIdentitySha256", "result",
      ], identity, "encode", "$");
      const result = yield* decodeExecutionEvidenceBodyReferenceV1(value.result)
        .pipe(Result.mapError(() => invalidError(identity, "result")));
      if (result.kind !== "action_result") return yield* invalid(identity, "result.kind");
      return Object.freeze({
        status: "completed" as const,
        invocationId: yield* textField(value.invocationId, identity, "invocationId"),
        requestIdentitySha256: yield* digestField(value.requestIdentitySha256, identity, "requestIdentitySha256"),
        result,
      });
    });
  }
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "status", "invocationId", "requestIdentitySha256", "code",
    ], identity, "encode", "$");
    if (value.status !== "failed" && value.status !== "uncertain" && value.status !== "cancelled") {
      return yield* invalid(identity, "status");
    }
    return Object.freeze({
      status: value.status,
      invocationId: yield* textField(value.invocationId, identity, "invocationId"),
      requestIdentitySha256: yield* digestField(value.requestIdentitySha256, identity, "requestIdentitySha256"),
      code: yield* textField(value.code, identity, "code"),
    });
  });
}

function invocationOutcomeProjection(value: ApplicationActionInvocationOutcomeFrameV1): JsonProjection {
  return value.status === "completed"
    ? ["completed", value.invocationId, hex(value.requestIdentitySha256), referenceProjection(value.result)]
    : [value.status, value.invocationId, hex(value.requestIdentitySha256), value.code];
}

function invocationOutcomeFromProjection(value: unknown) {
  if (!isTuple(value, 4)) return malformedOutcome("$projection");
  return captureInvocationOutcome(value[0] === "completed"
    ? { status: value[0], invocationId: value[1], requestIdentitySha256: unhex(value[2]), result: referenceFromProjection(value[3]) }
    : { status: value[0], invocationId: value[1], requestIdentitySha256: unhex(value[2]), code: value[3] });
}

function captureSubject(input: unknown): Result.Result<
  ExternalEffectExecutionSubjectFrameV1,
  ExecutionEvidenceProtocolV1Error
> {
  const identity = EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1;
  if (!isPlainRecord(input)) return invalid(identity, "$");
  if (input.kind === "direct_action") {
    return Result.gen(function* () {
      const value = yield* exactRecord(input, [
        "kind", "scopeId", "invocationId", "requestIdentitySha256",
      ], identity, "encode", "$");
      return Object.freeze({
        kind: "direct_action" as const,
        scopeId: yield* textField(value.scopeId, identity, "scopeId"),
        invocationId: yield* textField(value.invocationId, identity, "invocationId"),
        requestIdentitySha256: yield* digestField(value.requestIdentitySha256, identity, "requestIdentitySha256"),
      });
    });
  }
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "kind", "scopeId", "runId", "attemptId", "taskDefinitionRevisionSha256",
    ], identity, "encode", "$");
    if (value.kind !== "durable_task_attempt") return yield* invalid(identity, "kind");
    return Object.freeze({
      kind: "durable_task_attempt" as const,
      scopeId: yield* textField(value.scopeId, identity, "scopeId"),
      runId: yield* textField(value.runId, identity, "runId"),
      attemptId: yield* textField(value.attemptId, identity, "attemptId"),
      taskDefinitionRevisionSha256: yield* digestField(value.taskDefinitionRevisionSha256, identity, "taskDefinitionRevisionSha256"),
    });
  });
}

function subjectProjection(value: ExternalEffectExecutionSubjectFrameV1): JsonProjection {
  return value.kind === "direct_action"
    ? [value.kind, value.scopeId, value.invocationId, hex(value.requestIdentitySha256)]
    : [value.kind, value.scopeId, value.runId, value.attemptId, hex(value.taskDefinitionRevisionSha256)];
}

function subjectFromProjection(value: unknown) {
  if (!Array.isArray(value)) return malformedSubject("$projection");
  return value[0] === "direct_action" && value.length === 4
    ? captureSubject({ kind: value[0], scopeId: value[1], invocationId: value[2], requestIdentitySha256: unhex(value[3]) })
    : value[0] === "durable_task_attempt" && value.length === 5
      ? captureSubject({ kind: value[0], scopeId: value[1], runId: value[2], attemptId: value[3], taskDefinitionRevisionSha256: unhex(value[4]) })
      : malformedSubject("$projection");
}

function captureEffectAttempt(input: unknown): Result.Result<
  ExternalEffectAttemptFrameV1,
  ExecutionEvidenceProtocolV1Error
> {
  const identity = EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1;
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "subject", "subjectFence", "effectOrdinal", "effectKind", "stableEffectKey",
      "requestIdentitySha256", "outboundHttpRequest", "childMutationRequestKey",
      "childMutationFunctionPath", "childMutationArgumentsSha256",
    ], identity, "encode", "$");
    const subject = yield* captureSubject(value.subject).pipe(
      Result.mapError(() => invalidError(identity, "subject")),
    );
    const subjectFence = yield* positiveInt64(value.subjectFence, identity, "subjectFence");
    const effectOrdinal = yield* positiveInt64(value.effectOrdinal, identity, "effectOrdinal");
    if (value.effectKind !== "outbound_http" && value.effectKind !== "child_mutation") {
      return yield* invalid(identity, "effectKind");
    }
    let outboundHttpRequest: ExecutionEvidenceBodyReferenceV1 | null = null;
    let childMutationRequestKey: string | null = null;
    let childMutationFunctionPath: string | null = null;
    let childMutationArgumentsSha256: Uint8Array | null = null;
    if (value.effectKind === "outbound_http") {
      outboundHttpRequest = yield* decodeExecutionEvidenceBodyReferenceV1(value.outboundHttpRequest)
        .pipe(Result.mapError(() => invalidError(identity, "outboundHttpRequest")));
      if (outboundHttpRequest.kind !== "outbound_http_request" || value.childMutationRequestKey !== null || value.childMutationFunctionPath !== null || value.childMutationArgumentsSha256 !== null) {
        return yield* invalid(identity, "$effectEvidence");
      }
    } else {
      if (value.outboundHttpRequest !== null) return yield* invalid(identity, "outboundHttpRequest");
      childMutationRequestKey = yield* textField(value.childMutationRequestKey, identity, "childMutationRequestKey");
      childMutationFunctionPath = yield* textField(value.childMutationFunctionPath, identity, "childMutationFunctionPath");
      childMutationArgumentsSha256 = yield* digestField(value.childMutationArgumentsSha256, identity, "childMutationArgumentsSha256");
    }
    return Object.freeze({
      subject,
      subjectFence,
      effectOrdinal,
      effectKind: value.effectKind,
      stableEffectKey: yield* textField(value.stableEffectKey, identity, "stableEffectKey"),
      requestIdentitySha256: yield* digestField(value.requestIdentitySha256, identity, "requestIdentitySha256"),
      outboundHttpRequest,
      childMutationRequestKey,
      childMutationFunctionPath,
      childMutationArgumentsSha256,
    });
  });
}

function effectAttemptProjection(value: ExternalEffectAttemptFrameV1): JsonProjection {
  return [
    subjectProjection(value.subject), value.subjectFence.toString(),
    value.effectOrdinal.toString(), value.effectKind, value.stableEffectKey,
    hex(value.requestIdentitySha256),
    value.outboundHttpRequest === null ? null : referenceProjection(value.outboundHttpRequest),
    value.childMutationRequestKey, value.childMutationFunctionPath,
    value.childMutationArgumentsSha256 === null ? null : hex(value.childMutationArgumentsSha256),
  ];
}

function effectAttemptFromProjection(value: unknown) {
  if (!isTuple(value, 10)) return malformedEffect("$projection");
  return captureEffectAttempt({
    subject: subjectProjectionToInput(value[0]),
    subjectFence: decimalBigInt(value[1]), effectOrdinal: decimalBigInt(value[2]),
    effectKind: value[3], stableEffectKey: value[4], requestIdentitySha256: unhex(value[5]),
    outboundHttpRequest: value[6] === null ? null : referenceFromProjection(value[6]),
    childMutationRequestKey: value[7], childMutationFunctionPath: value[8],
    childMutationArgumentsSha256: value[9] === null ? null : unhex(value[9]),
  });
}

function referenceProjection(value: ExecutionEvidenceBodyReferenceV1): JsonProjection {
  return [value.storeIdentity, value.kind, value.codecIdentity, value.objectKey, value.byteLength.toString(), hex(value.sha256)];
}

function referenceFromProjection(value: unknown): unknown {
  if (!isTuple(value, 6)) return null;
  return { storeIdentity: value[0], kind: value[1], codecIdentity: value[2], objectKey: value[3], byteLength: decimalBigInt(value[4]), sha256: unhex(value[5]) };
}

function subjectProjectionToInput(value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  return value[0] === "direct_action" && value.length === 4
    ? { kind: value[0], scopeId: value[1], invocationId: value[2], requestIdentitySha256: unhex(value[3]) }
    : value[0] === "durable_task_attempt" && value.length === 5
      ? { kind: value[0], scopeId: value[1], runId: value[2], attemptId: value[3], taskDefinitionRevisionSha256: unhex(value[4]) }
      : null;
}

function exactRecord<Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  identity: ExecutionEvidenceProtocolV1Error["identity"],
  operation: ExecutionEvidenceProtocolV1Error["operation"],
  path: string,
): Result.Result<Readonly<Record<Keys[number], unknown>>, ExecutionEvidenceProtocolV1Error> {
  if (!isPlainRecord(value)) return Result.fail(protocolError(identity, operation, "invalidInput", path));
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) {
    return Result.fail(protocolError(identity, operation, "invalidInput", path));
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return Result.fail(protocolError(identity, operation, "invalidInput", `${path}.${key}`));
    }
    output[key] = descriptor.value;
  }
  // SAFETY: the exact-key check above proved output carries exactly the
  // requested keys, each from a validated own enumerable value descriptor.
  return Result.succeed(output as Readonly<Record<Keys[number], unknown>>);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isTuple(value: unknown, length: number): value is ReadonlyArray<unknown> {
  return Array.isArray(value) && value.length === length;
}

function textField(value: unknown, identity: Identity, path: string) {
  return typeof value === "string" && isNonBlankString(value) && !value.includes("\0") && UTF8.encode(value).byteLength <= MAX_TEXT_BYTES
    ? Result.succeed(value)
    : invalid(identity, path);
}

function digestField(value: unknown, identity: Identity, path: string) {
  return isUint8ArrayWithByteLength(value, DIGEST_BYTES)
    ? Result.succeed(copyBytes(value))
    : invalid(identity, path);
}

function positiveInt64(value: unknown, identity: Identity, path: string) {
  return typeof value === "bigint" && value >= 1n && value <= MAX_POSITIVE_INT64
    ? Result.succeed(value)
    : invalid(identity, path);
}

function isBodyKind(value: unknown): value is ExecutionEvidenceBodyKindV1 {
  return value === "action_arguments" || value === "action_result" || value === "application_error_detail" || value === "outbound_http_request" || value === "outbound_http_response";
}

function hex(value: Uint8Array): string {
  return encodeBytesToLowercaseHex(value);
}

function unhex(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(DIGEST_BYTES);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decimalBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function invalid(identity: Identity, path: string): Result.Result<never, ExecutionEvidenceProtocolV1Error> {
  return Result.fail(invalidError(identity, path));
}

function invalidError(identity: Identity, path: string): ExecutionEvidenceProtocolV1Error {
  return protocolError(identity, "encode", "invalidInput", path);
}

function failReference(path: string): Result.Result<never, ExecutionEvidenceProtocolV1Error> {
  return Result.fail(protocolError(EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1, "reference", "invalidInput", path));
}

function malformedRequest(path: string) { return Result.fail(protocolError(APPLICATION_ACTION_INVOCATION_REQUEST_IDENTITY_V1, "decode", "malformed", path)); }
function malformedOutcome(path: string) { return Result.fail(protocolError(APPLICATION_ACTION_INVOCATION_OUTCOME_IDENTITY_V1, "decode", "malformed", path)); }
function malformedSubject(path: string) { return Result.fail(protocolError(EXTERNAL_EFFECT_EXECUTION_SUBJECT_IDENTITY_V1, "decode", "malformed", path)); }
function malformedEffect(path: string) { return Result.fail(protocolError(EXTERNAL_EFFECT_ATTEMPT_IDENTITY_V1, "decode", "malformed", path)); }

function protocolError(
  identity: ExecutionEvidenceProtocolV1Error["identity"],
  operation: ExecutionEvidenceProtocolV1Error["operation"],
  reason: ExecutionEvidenceProtocolV1Error["reason"],
  path: string,
): ExecutionEvidenceProtocolV1Error {
  return new ExecutionEvidenceProtocolV1Error({ identity, operation, reason, path });
}

import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  encodeCanonicalJson,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
} from "flarex-protocol/json";

import {
  InvalidTaskRunCreationRequestError,
  TaskRunCreationCanonicalEncodingDefect,
} from "./Errors.js";
import {
  APPLICATION_TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1,
  TASK_RUN_CREATION_REQUEST_KEY_PREIMAGE_CODEC_V1,
  TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1,
} from "./Model.js";
import {
  decodeApplicationTaskRunCreationRequestV1,
  decodeTaskRunCreationRequestKeyV1,
  decodeTaskRunCreationRequestV1,
} from "./Schema.js";

const UTF8 = new TextEncoder();

export function encodeTaskRunCreationRequestKeyPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidTaskRunCreationRequestError> {
  return decodeTaskRunCreationRequestKeyV1(input).pipe(
    Result.mapError(() => new InvalidTaskRunCreationRequestError({
      operation: "encode_request_key_preimage",
      reason: "invalid_request_key",
    })),
    Result.map((requestKey) => canonicalBytes({
      codec: TASK_RUN_CREATION_REQUEST_KEY_PREIMAGE_CODEC_V1,
      requestKey,
    }, "encode_request_key_preimage")),
  );
}

export function encodeApplicationTaskRunCreationRequestPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidTaskRunCreationRequestError> {
  return decodeApplicationTaskRunCreationRequestV1(input).pipe(
    Result.mapError(failure => new InvalidTaskRunCreationRequestError({
      operation: "encode_application_request_preimage",
      reason: failure.reason,
    })),
    Result.map(request => canonicalBytes({
      codec: APPLICATION_TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1,
      input: {
        byteLength: request.input.byteLength,
        codec: request.input.codec,
        objectKey: request.input.objectKey,
        retention: { kind: request.input.retention.kind },
        sha256: encodeBytesToLowercaseHex(request.input.sha256),
        store: request.input.store,
        valueCodec: request.input.valueCodec,
      },
      principal: {
        byteLength: request.principal.byteLength,
        codec: request.principal.codec,
        objectKey: request.principal.objectKey,
        principalKind: request.principal.principalKind,
        retention: { kind: request.principal.retention.kind },
        sha256: encodeBytesToLowercaseHex(request.principal.sha256),
        store: request.principal.store,
        valueCodec: request.principal.valueCodec,
      },
      applicationTaskRuntimeTargetSha256: encodeBytesToLowercaseHex(
        request.applicationTaskRuntimeTargetSha256,
      ),
    }, "encode_application_request_preimage")),
  );
}

export function encodeTaskRunCreationRequestPreimageV1(
  input: unknown,
): Result.Result<Uint8Array, InvalidTaskRunCreationRequestError> {
  return decodeTaskRunCreationRequestV1(input).pipe(
    Result.mapError((failure) => new InvalidTaskRunCreationRequestError({
      operation: "encode_request_preimage",
      reason: failure.reason,
    })),
    Result.map((request) => canonicalBytes({
      codec: TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1,
      input: {
        byteLength: request.input.byteLength,
        codec: request.input.codec,
        objectKey: request.input.objectKey,
        retention: { kind: request.input.retention.kind },
        sha256: encodeBytesToLowercaseHex(request.input.sha256),
        store: request.input.store,
        valueCodec: request.input.valueCodec,
      },
      taskDefinitionRevisionId: request.taskDefinitionRevisionId,
    }, "encode_request_preimage")),
  );
}

function canonicalBytes(
  value: Json,
  operation: TaskRunCreationCanonicalEncodingDefect["operation"],
): Uint8Array {
  return UTF8.encode(encodeCanonicalJson(value, (issue) => {
    throw canonicalEncodingDefect(operation, issue);
  }));
}

function canonicalEncodingDefect(
  operation: TaskRunCreationCanonicalEncodingDefect["operation"],
  issue: CanonicalJsonEncodingInvariantIssue,
): TaskRunCreationCanonicalEncodingDefect {
  return new TaskRunCreationCanonicalEncodingDefect({ operation, issue });
}

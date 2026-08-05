import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  encodeTaskRunCreationRequestKeyPreimageV1,
  encodeTaskRunCreationRequestPreimageV1,
} from "../src/runCreation/CanonicalRequest.js";
import {
  InvalidTaskRunCreationRequestError,
  InvalidTaskRunInitialAggregateError,
  TaskRunCreationIdempotencyConflictError,
} from "../src/runCreation/Errors.js";
import { makeTaskRunCreationInitialAggregateV1 } from
  "../src/runCreation/InitialAggregate.js";
import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  TASK_INPUT_OBJECT_KEY_PREFIX_V1,
  type TaskInputReferenceV1,
  type TaskRunCreationRequestKeyV1,
  type TaskRunCreationRequestV1,
} from "../src/runCreation/Model.js";
import {
  decodeTaskInputReferenceV1,
  decodeTaskRunCreationReceiptV1,
  decodeTaskRunCreationRequestKeyV1,
  decodeTaskRunCreationRequestV1,
  makeTaskInputReferenceV1,
} from "../src/runCreation/Schema.js";
import {
  COMPUTE_SMALL,
  DEFINITION_ID,
  LEASE_DURATION,
  NOW,
  POLICY,
  RUN_ID,
  duration,
} from "./support.js";

const UTF8 = new TextDecoder();

describe("durable task run creation V1", () => {
  it("validates request keys as exact bounded Unicode scalar text", () => {
    const accepted = success(decodeTaskRunCreationRequestKeyV1("請求/Invoice.Send"));
    expect(accepted).toBe("請求/Invoice.Send");
    expectTypeOf(accepted).toEqualTypeOf<TaskRunCreationRequestKeyV1>();

    for (const rejected of [
      "",
      " leading",
      "trailing ",
      "line\nbreak",
      "null\u0000byte",
      "\ud800",
      "é".repeat(128),
    ]) {
      expect(failure(decodeTaskRunCreationRequestKeyV1(rejected)))
        .toMatchObject({
          _tag: "InvalidTaskRunCreationRequestError",
          operation: "decode_request_key",
          reason: "invalid_request_key",
        });
    }

    expect(success(decodeTaskRunCreationRequestKeyV1("a".repeat(255))))
      .toHaveLength(255);
  });

  it("derives an immutable content-addressed input reference", () => {
    const callerDigest = digest(0x2a);
    const reference = success(makeTaskInputReferenceV1(callerDigest, 123));

    expect(reference).toEqual({
      codec: "flarex.task-input-reference.v1",
      store: "flarex.task-input-object-store.v1",
      valueCodec: "flarex-value/v1",
      objectKey: `${TASK_INPUT_OBJECT_KEY_PREFIX_V1}${"2a".repeat(32)}`,
      byteLength: 123,
      sha256: digest(0x2a),
      retention: { kind: "run_lifetime" },
    });
    expect(Object.isFrozen(reference)).toBe(true);
    expect(Object.isFrozen(reference.retention)).toBe(true);
    expect(reference.sha256).not.toBe(callerDigest);

    callerDigest.fill(0xff);
    expect(reference.sha256).toEqual(digest(0x2a));
  });

  it("rejects invalid sizes, digests, object keys, and excess properties", () => {
    expect(failure(makeTaskInputReferenceV1(digest(1), 0))).toMatchObject({
      operation: "make_input_reference",
      reason: "invalid_input_reference",
    });
    expect(failure(makeTaskInputReferenceV1(
      digest(1),
      MAX_TASK_INPUT_CANONICAL_BYTES_V1 + 1,
    ))).toMatchObject({ reason: "invalid_input_reference" });
    expect(failure(makeTaskInputReferenceV1(new Uint8Array(31), 1)))
      .toMatchObject({ reason: "invalid_digest" });

    const reference = success(makeTaskInputReferenceV1(digest(2), 1));
    expect(failure(decodeTaskInputReferenceV1({
      ...reference,
      objectKey: `${TASK_INPUT_OBJECT_KEY_PREFIX_V1}${"03".repeat(32)}`,
    }))).toMatchObject({ reason: "invalid_input_reference" });
    expect(failure(decodeTaskInputReferenceV1({
      ...reference,
      bucket: "caller-selected",
    }))).toMatchObject({ reason: "invalid_input_reference" });
  });

  it("ignores caller-dispatchable byte-copy and iteration overrides", () => {
    const callerDigest = digest(0x2a);
    Object.defineProperties(callerDigest, {
      slice: {
        value: () => digest(0xff),
      },
      [Symbol.iterator]: {
        value: function* () {
          yield* digest(0xff);
        },
      },
    });

    const reference = success(makeTaskInputReferenceV1(callerDigest, 3));
    expect(reference.objectKey).toBe(
      `${TASK_INPUT_OBJECT_KEY_PREFIX_V1}${"2a".repeat(32)}`,
    );
    expect(reference.sha256).toEqual(digest(0x2a));
  });

  it("maps hostile containers and digest proxies without invoking accessors", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile keys");
      },
    });
    const digestProxy = new Proxy(digest(1), {});
    let accessorRead = false;
    const accessorReference = {
      ...success(makeTaskInputReferenceV1(digest(2), 1)),
    };
    Object.defineProperty(accessorReference, "objectKey", {
      enumerable: true,
      get() {
        accessorRead = true;
        throw new Error("must not invoke input accessor");
      },
    });

    expect(() => decodeTaskRunCreationRequestV1(hostile)).not.toThrow();
    expect(failure(decodeTaskRunCreationRequestV1(hostile)))
      .toMatchObject({ reason: "invalid_shape" });
    expect(() => decodeTaskRunCreationReceiptV1(hostile)).not.toThrow();
    expect(failure(decodeTaskRunCreationReceiptV1(hostile)))
      .toMatchObject({ reason: "invalid_shape" });
    expect(() => decodeTaskInputReferenceV1(accessorReference)).not.toThrow();
    expect(failure(decodeTaskInputReferenceV1(accessorReference)))
      .toMatchObject({ reason: "invalid_input_reference" });
    expect(accessorRead).toBe(false);
    expect(failure(makeTaskInputReferenceV1(digestProxy, 1)))
      .toMatchObject({ reason: "invalid_digest" });
  });

  it("decodes an owned closed creation request", () => {
    const callerDigest = digest(7);
    const input = success(makeTaskInputReferenceV1(callerDigest, 19));
    const request = success(decodeTaskRunCreationRequestV1({
      version: 1,
      requestKey: "invoice/create/7",
      taskDefinitionRevisionId: DEFINITION_ID,
      input,
    }));

    expectTypeOf(request).toEqualTypeOf<TaskRunCreationRequestV1>();
    expect(request.input).not.toBe(input);
    expect(request.input.sha256).not.toBe(input.sha256);
    input.sha256.fill(9);
    expect(request.input.sha256).toEqual(digest(7));

    expect(failure(decodeTaskRunCreationRequestV1({
      ...request,
      taskDefinitionRevisionId: "taskdef_not-a-uuid",
    }))).toMatchObject({
      operation: "decode_request",
      reason: "invalid_definition_revision",
    });

    expect(failure(decodeTaskRunCreationRequestV1({
      ...request,
      requestKey: " bad",
      taskDefinitionRevisionId: "taskdef_not-a-uuid",
      input: new Proxy({}, { ownKeys: () => { throw new Error("late input"); } }),
    }))).toMatchObject({ reason: "invalid_request_key" });
    expect(failure(decodeTaskRunCreationRequestV1({
      ...request,
      taskDefinitionRevisionId: "taskdef_not-a-uuid",
      input: new Proxy({}, { ownKeys: () => { throw new Error("late input"); } }),
    }))).toMatchObject({ reason: "invalid_definition_revision" });
  });

  it("frames request-key identity separately from request semantics", () => {
    const first = request("request-a", digest(4));
    const secondKey = request("request-b", digest(4));
    const secondInput = request("request-a", digest(5));

    const firstKeyBytes = success(
      encodeTaskRunCreationRequestKeyPreimageV1(first.requestKey),
    );
    const secondKeyBytes = success(
      encodeTaskRunCreationRequestKeyPreimageV1(secondKey.requestKey),
    );
    const firstRequestBytes = success(
      encodeTaskRunCreationRequestPreimageV1(first),
    );

    expect(UTF8.decode(firstKeyBytes)).toBe(
      '{"codec":"flarex.task-run-creation-request-key-preimage.v1","requestKey":"request-a"}',
    );
    expect(firstKeyBytes).not.toEqual(secondKeyBytes);
    expect(success(encodeTaskRunCreationRequestPreimageV1(secondKey)))
      .toEqual(firstRequestBytes);
    expect(success(encodeTaskRunCreationRequestPreimageV1(secondInput)))
      .not.toEqual(firstRequestBytes);
    const digestHex = "04".repeat(32);
    expect(UTF8.decode(firstRequestBytes)).toBe(
      `{"codec":"flarex.task-run-creation-request-preimage.v1","input":{"byteLength":19,"codec":"flarex.task-input-reference.v1","objectKey":"durable-task-input/v1/sha256/${digestHex}","retention":{"kind":"run_lifetime"},"sha256":"${digestHex}","store":"flarex.task-input-object-store.v1","valueCodec":"flarex-value/v1"},"taskDefinitionRevisionId":"taskdef_00000000-0000-4000-8000-000000000001"}`,
    );
  });

  it("returns fresh canonical preimage bytes on every call", () => {
    const input = request("fresh", digest(8));
    const first = success(encodeTaskRunCreationRequestPreimageV1(input));
    const second = success(encodeTaskRunCreationRequestPreimageV1(input));

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    first.fill(0);
    expect(UTF8.decode(second)).toContain(
      "flarex.task-run-creation-request-preimage.v1",
    );
  });

  it("decodes a stable replay receipt with detached digest evidence", () => {
    const requestKeySha256 = digest(10);
    const requestSha256 = digest(11);
    const creationAuthoritySha256 = digest(12);
    const receipt = success(decodeTaskRunCreationReceiptV1({
      status: "created",
      version: 1,
      runId: RUN_ID,
      taskDefinitionRevisionId: DEFINITION_ID,
      createdAtMs: NOW,
      requestKeySha256,
      requestSha256,
      creationAuthoritySha256,
    }));

    requestKeySha256.fill(0);
    requestSha256.fill(0);
    creationAuthoritySha256.fill(0);
    expect(receipt.requestKeySha256).toEqual(digest(10));
    expect(receipt.requestSha256).toEqual(digest(11));
    expect(receipt.creationAuthoritySha256).toEqual(digest(12));
    expect(Object.isFrozen(receipt)).toBe(true);
    expect("disposition" in receipt).toBe(false);

    expect(failure(decodeTaskRunCreationReceiptV1({
      ...receipt,
      status: "replayed",
    }))).toMatchObject({ reason: "invalid_shape" });
    expect(failure(decodeTaskRunCreationReceiptV1({
      ...receipt,
      requestSha256: new Uint8Array(31),
    }))).toMatchObject({ reason: "invalid_digest" });
    expect(failure(decodeTaskRunCreationReceiptV1({
      ...receipt,
      unexpected: true,
    }))).toMatchObject({ reason: "invalid_shape" });
    expect(failure(decodeTaskRunCreationReceiptV1({
      ...receipt,
      status: "replayed",
      runId: "run_invalid",
      requestSha256: new Uint8Array(31),
    }))).toMatchObject({ reason: "invalid_shape" });
    expect(failure(decodeTaskRunCreationReceiptV1({
      ...receipt,
      runId: "run_invalid",
      requestSha256: new Uint8Array(31),
    }))).toMatchObject({ reason: "invalid_run_id" });
  });

  it("keeps idempotency conflict evidence non-disclosing", () => {
    const requestKey = success(decodeTaskRunCreationRequestKeyV1("same-key"));
    const conflict = new TaskRunCreationIdempotencyConflictError({
      requestKey,
      reason: "request_digest_mismatch",
    });

    expect(conflict).toMatchObject({
      _tag: "TaskRunCreationIdempotencyConflictError",
      requestKey: "same-key",
      reason: "request_digest_mismatch",
    });
    expect("runId" in conflict).toBe(false);
    expect("scopeId" in conflict).toBe(false);
    expect("existingDigest" in conflict).toBe(false);
  });

  it("constructs and owns the sole legal initial lifecycle aggregate", () => {
    const policy = {
      version: 1 as const,
      retry: { ...POLICY.retry },
      outOfMemory: { ...POLICY.outOfMemory },
    };
    const aggregate = success(makeTaskRunCreationInitialAggregateV1({
      runId: RUN_ID,
      taskDefinitionRevisionId: DEFINITION_ID,
      createdAtMs: NOW,
      runAttemptPolicy: policy,
      maximumDurationMs: duration(300_000),
      initialComputeProfile: COMPUTE_SMALL,
      leaseDurationMs: LEASE_DURATION,
      immediateRetryThresholdMs: duration(5_000),
    }));

    expect(aggregate).toMatchObject({
      runId: RUN_ID,
      taskDefinitionRevisionId: DEFINITION_ID,
      createdAtMs: NOW,
      runVersion: 1n,
      phase: "ready",
      ready: { kind: "initial", eligibleAtMs: NOW },
      attemptHistory: { kind: "none" },
      leaseHistory: { kind: "none" },
      requestedEffectCursor: { kind: "none" },
      cancellation: { kind: "not_requested", generation: 0n },
      lastLifecycleAcceptance: null,
      completionReplays: [],
    });
    expect(Object.isFrozen(aggregate)).toBe(true);
    expect(Object.isFrozen(aggregate.boundPolicy)).toBe(true);
    policy.retry.maxTimeoutInMs = duration(1_000);
    expect(aggregate.boundPolicy.runAttempt.retry.maxTimeoutInMs).toBe(60_000);

    expect(failure(makeTaskRunCreationInitialAggregateV1({
      runId: RUN_ID,
      taskDefinitionRevisionId: DEFINITION_ID,
      createdAtMs: NOW,
      runAttemptPolicy: POLICY,
      maximumDurationMs: duration(300_000),
      initialComputeProfile: COMPUTE_SMALL,
      leaseDurationMs: duration(0),
      immediateRetryThresholdMs: duration(5_000),
    }))).toMatchObject({
      _tag: "InvalidTaskRunInitialAggregateError",
      operation: "make_initial_aggregate",
      reason: "invalid_initial_aggregate",
    });
  });
});

function request(
  requestKey: string,
  inputDigest: Uint8Array,
): TaskRunCreationRequestV1 {
  return success(decodeTaskRunCreationRequestV1({
    version: 1,
    requestKey,
    taskDefinitionRevisionId: DEFINITION_ID,
    input: success(makeTaskInputReferenceV1(inputDigest, 19)),
  }));
}

function digest(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

function failure<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Failure {
  return Result.match(result, {
    onFailure: (value) => value,
    onSuccess: () => {
      throw new Error("Expected run-creation operation to fail.");
    },
  });
}

expectTypeOf<InvalidTaskRunCreationRequestError>()
  .not.toEqualTypeOf<TaskRunCreationIdempotencyConflictError>();
expectTypeOf<InvalidTaskRunInitialAggregateError>()
  .not.toEqualTypeOf<TaskRunCreationIdempotencyConflictError>();
expectTypeOf<TaskInputReferenceV1>()
  .not.toEqualTypeOf<TaskRunCreationRequestV1>();

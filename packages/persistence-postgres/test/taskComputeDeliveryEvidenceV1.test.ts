import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  decodeTaskComputeCancellationReceiptV1,
  decodeTaskComputeCancellationRequestV1,
  decodeTaskComputeDispatchAcceptanceV1,
  decodeTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1,
  TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1,
  TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
  TaskComputeDeliveryEvidenceV1Error,
  TaskComputeProfileStorageV1Error,
  type TaskComputeDeliveryEvidenceV1,
  decodeTaskComputeCancellationReceiptEvidenceV1,
  decodeTaskComputeCancellationRequestEvidenceV1,
  decodeTaskComputeDispatchAcceptanceEvidenceV1,
  decodeTaskComputeDispatchRequestEvidenceV1,
  decodeTaskComputePreparedExecutionV1,
  decodeTaskComputeProfileStorageBytesV1,
  encodeTaskComputeCancellationReceiptEvidenceV1,
  encodeTaskComputeCancellationRequestEvidenceV1,
  encodeTaskComputeDispatchAcceptanceEvidenceV1,
  encodeTaskComputeDispatchRequestEvidenceV1,
  encodeTaskComputeProfileStorageBytesV1,
} from "../src/taskComputeDeliveryEvidenceV1";
import {
  makeTaskSystemCreationRequestV1,
  makeTaskSystemCreationRuntimeBindingV1,
} from "./taskSystemRunCreationTestSupport";

describe("DTE06-C1 compute delivery evidence", () => {
  it("losslessly stores every domain-valid JavaScript string shape", () => {
    for (const profile of ["compute-small", "   ", "\u0000", "\ud800"]) {
      const bytes = success(encodeTaskComputeProfileStorageBytesV1(profile));
      expect(success(decodeTaskComputeProfileStorageBytesV1(bytes))).toBe(
        profile,
      );
    }
    expect(Result.isFailure(
      decodeTaskComputeProfileStorageBytesV1(new Uint8Array([0])),
    )).toBe(true);
  });

  it("retains the exact operation in each Effect error channel", () => {
    expectTypeOf(encodeTaskComputeDispatchRequestEvidenceV1({}))
      .toEqualTypeOf<Effect.Effect<
        TaskComputeDeliveryEvidenceV1,
        TaskComputeDeliveryEvidenceV1Error<"encode_dispatch_request">
      >>();
    expectTypeOf(decodeTaskComputeCancellationReceiptEvidenceV1({}))
      .toEqualTypeOf<Effect.Effect<
        ReturnType<typeof successCancellationReceipt>,
        TaskComputeDeliveryEvidenceV1Error<"decode_cancellation_receipt">
      >>();
    expectTypeOf(encodeTaskComputeProfileStorageBytesV1("profile"))
      .toEqualTypeOf<Result.Result<
        Uint8Array,
        TaskComputeProfileStorageV1Error<"encode_compute_profile">
      >>();
    expectTypeOf(decodeTaskComputeProfileStorageBytesV1(new Uint8Array([0, 1])))
      .toEqualTypeOf<Result.Result<
        TaskComputeProfileRefV1,
        TaskComputeProfileStorageV1Error<"decode_compute_profile">
      >>();
  });

  it("canonically round-trips all four provider values", async () => {
    const request = dispatchRequest();
    const acceptance = dispatchAcceptance();
    const cancellationRequest = success(decodeTaskComputeCancellationRequestV1({
      version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
      identity: wireIdentity(request),
      execution: acceptance.execution,
      cancellationGeneration: "1",
    }));
    const cancellationReceipt = success(decodeTaskComputeCancellationReceiptV1({
      version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
      kind: "interruption_requested",
      identity: wireIdentity(request),
      execution: acceptance.execution,
      cancellationGeneration: "1",
    }));

    const cases: ReadonlyArray<{
      readonly value: unknown;
      readonly encode: (
        input: unknown,
      ) => Effect.Effect<
        TaskComputeDeliveryEvidenceV1,
        TaskComputeDeliveryEvidenceV1Error
      >;
      readonly decode: (
        input: unknown,
      ) => Effect.Effect<unknown, TaskComputeDeliveryEvidenceV1Error>;
    }> = [
      {
        value: request,
        encode: encodeTaskComputeDispatchRequestEvidenceV1,
        decode: decodeTaskComputeDispatchRequestEvidenceV1,
      },
      {
        value: acceptance,
        encode: encodeTaskComputeDispatchAcceptanceEvidenceV1,
        decode: decodeTaskComputeDispatchAcceptanceEvidenceV1,
      },
      {
        value: cancellationRequest,
        encode: encodeTaskComputeCancellationRequestEvidenceV1,
        decode: decodeTaskComputeCancellationRequestEvidenceV1,
      },
      {
        value: cancellationReceipt,
        encode: encodeTaskComputeCancellationReceiptEvidenceV1,
        decode: decodeTaskComputeCancellationReceiptEvidenceV1,
      },
    ];

    for (const item of cases) {
      const first = await Effect.runPromise(item.encode(item.value));
      const second = await Effect.runPromise(item.encode(item.value));
      expect(first.codecVersion).toBe(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1);
      expect(first.byteLength).toBe(first.canonicalBytes.byteLength);
      expect(first.byteLength).toBeGreaterThan(0);
      expect(first.byteLength).toBeLessThanOrEqual(
        MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1,
      );
      expect(first.canonicalBytes).toEqual(second.canonicalBytes);
      expect(first.sha256).toEqual(second.sha256);
      expect(await Effect.runPromise(item.decode(first))).toEqual(item.value);
    }
  });

  it("owns byte evidence and rejects hostile evidence records without reading getters", async () => {
    const evidence = await Effect.runPromise(
      encodeTaskComputeDispatchRequestEvidenceV1(dispatchRequest()),
    );
    const bytes = evidence.canonicalBytes;
    const digest = evidence.sha256;
    bytes.fill(0);
    digest.fill(0);
    expect(await Effect.runPromise(
      decodeTaskComputeDispatchRequestEvidenceV1(evidence),
    )).toEqual(dispatchRequest());

    let getterReads = 0;
    const hostile = {
      codecVersion: 1,
      byteLength: evidence.byteLength,
      sha256: evidence.sha256,
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "canonicalBytes", {
      enumerable: true,
      get() {
        getterReads += 1;
        return evidence.canonicalBytes;
      },
    });
    const error = await Effect.runPromise(
      decodeTaskComputeDispatchRequestEvidenceV1(hostile).pipe(Effect.flip),
    );
    expect(error).toMatchObject({ reason: "invalid_evidence" });
    expect(getterReads).toBe(0);
  });

  it("rejects digest drift, noncanonical JSON, malformed UTF-8, and oversize evidence", async () => {
    const evidence = await Effect.runPromise(
      encodeTaskComputeDispatchRequestEvidenceV1(dispatchRequest()),
    );
    await expectEvidenceFailure({
      ...evidence,
      sha256: new Uint8Array(32),
    }, "invalid_digest");

    const spaced = new TextEncoder().encode(
      new TextDecoder().decode(evidence.canonicalBytes).replace("{", "{ "),
    );
    await expectEvidenceFailure({
      codecVersion: 1,
      byteLength: spaced.byteLength,
      canonicalBytes: spaced,
      sha256: await digest(spaced),
    }, "non_canonical");

    const malformed = new Uint8Array([0xff]);
    await expectEvidenceFailure({
      codecVersion: 1,
      byteLength: malformed.byteLength,
      canonicalBytes: malformed,
      sha256: await digest(malformed),
    }, "invalid_utf8");

    const oversized = new Uint8Array(
      MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1 + 1,
    );
    await expectEvidenceFailure({
      codecVersion: 1,
      byteLength: oversized.byteLength,
      canonicalBytes: oversized,
      sha256: new Uint8Array(32),
    }, "size_exceeded");
  });

  it("captures a frozen prepared subject without creating authority", async () => {
    const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1();
    const inputReference = makeTaskSystemCreationRequestV1(
      "delivery-evidence",
      0x71,
    ).input;
    const dispatch = dispatchRequest();
    const prepared = success(decodeTaskComputePreparedExecutionV1({
      version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
      dispatchRequest: dispatch,
      runtimeBinding,
      inputReference,
    }));

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(prepared.dispatchRequest).toEqual(dispatch);
    expect(prepared.runtimeBinding).toEqual(runtimeBinding);
    expect(prepared.inputReference).toEqual(inputReference);
    expect(prepared.runtimeBinding).not.toBe(runtimeBinding);
    expect(prepared.inputReference).not.toBe(inputReference);

    expect(Result.isFailure(decodeTaskComputePreparedExecutionV1({
      ...prepared,
      unexpected: true,
    }))).toBe(true);
  });
});

async function expectEvidenceFailure(
  evidence: unknown,
  reason: TaskComputeDeliveryEvidenceV1Error["reason"],
): Promise<void> {
  const error = await Effect.runPromise(
    decodeTaskComputeDispatchRequestEvidenceV1(evidence).pipe(Effect.flip),
  );
  expect(error).toBeInstanceOf(TaskComputeDeliveryEvidenceV1Error);
  expect(error.reason).toBe(reason);
}

function dispatchRequest() {
  return success(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_72000000-0000-4000-8000-000000000001",
      runId: "run_72000000-0000-4000-8000-000000000003",
      requestedEffectSequence: "1",
      attemptId: "attempt_72000000-0000-4000-8000-000000000005",
      executionFence: "1",
    },
    taskDefinitionRevisionId:
      "taskdef_72000000-0000-4000-8000-000000000002",
    attemptNumber: 1,
    leaseVersion: "1",
    computeProfile: "compute-small",
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 300_000,
  }));
}

function dispatchAcceptance() {
  const request = dispatchRequest();
  return success(decodeTaskComputeDispatchAcceptanceV1({
    version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
    kind: "accepted",
    identity: wireIdentity(request),
    execution: {
      provider: "memory",
      providerVersion: "in-memory-v1",
      executionId: "memory-execution-000000000001",
    },
  }));
}

function successCancellationReceipt() {
  const request = dispatchRequest();
  const acceptance = dispatchAcceptance();
  return success(decodeTaskComputeCancellationReceiptV1({
    version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
    kind: "interruption_requested",
    identity: wireIdentity(request),
    execution: acceptance.execution,
    cancellationGeneration: "1",
  }));
}

function wireIdentity(request: ReturnType<typeof dispatchRequest>) {
  return {
    ...request.identity,
    requestedEffectSequence:
      request.identity.requestedEffectSequence.toString(10),
    executionFence: request.identity.executionFence.toString(10),
  };
}

async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

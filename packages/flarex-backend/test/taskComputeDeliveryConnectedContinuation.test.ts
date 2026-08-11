import {
  decodeTaskComputeDeliveryContinuationV1,
  type TaskComputeDeliveryContinuationV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import { Effect, Result } from "effect";
import { replacementScopeIdV1FromUuid } from
  "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  TaskComputeDeliveryConnectedContinuationCodecV1Error,
  decodeTaskComputeDeliveryConnectedContinuationV1,
  encodeTaskComputeDeliveryConnectedContinuationV1,
  type TaskComputeDeliveryConnectedContinuationV1,
} from "../src/taskComputeDelivery/ConnectedContinuation";

const SCOPE_ID = replacementScopeIdV1FromUuid(
  "95000000-0000-4000-8000-000000000001",
);
const HIGH_WATER_SCOPE_ID = replacementScopeIdV1FromUuid(
  "95000000-0000-4000-8000-000000000002",
);

describe("DTE06-C3 connected delivery continuation codec", () => {
  it("keeps encode and decode failure channels operation-exact", () => {
    type Encode = ReturnType<
      typeof encodeTaskComputeDeliveryConnectedContinuationV1
    >;
    type Decode = ReturnType<
      typeof decodeTaskComputeDeliveryConnectedContinuationV1
    >;
    type EncodeError = Assert<IsExact<
      Effect.Error<Encode>,
      TaskComputeDeliveryConnectedContinuationCodecV1Error<"encode">
    >>;
    type DecodeError = Assert<IsExact<
      Effect.Error<Decode>,
      TaskComputeDeliveryConnectedContinuationCodecV1Error<"decode">
    >>;
    expectTypeOf<EncodeError>().toEqualTypeOf<true>();
    expectTypeOf<DecodeError>().toEqualTypeOf<true>();
  });

  it("round-trips one active scope with independent cursors and page charges", async () => {
    const value = continuingValue();
    const evidence = await Effect.runPromise(
      encodeTaskComputeDeliveryConnectedContinuationV1(value),
    );
    const decoded = await Effect.runPromise(
      decodeTaskComputeDeliveryConnectedContinuationV1(evidence),
    );

    expect(decoded).toEqual(value);
    expect(decoded).not.toBe(value);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.activeScope)).toBe(true);
    expect(decoded.activeScope).toMatchObject({
      nextOperation: "cancellation",
      dispatchPagesCharged: 1,
      cancellationPagesCharged: 0,
    });
    const first = evidence.canonicalBytes;
    first.fill(0);
    expect(evidence.canonicalBytes).not.toEqual(first);
  });

  it("rejects active scope identity outside the directory snapshot", async () => {
    const value = continuingValue();
    await expectEncodeFailure({
      ...value,
      directory: {
        kind: "continuing",
        continuation: {
          codecVersion: 1,
          highWaterScopeId: HIGH_WATER_SCOPE_ID,
          lastScopeId: SCOPE_ID,
        },
      },
    }, "invalid_correlation");
    await expectEncodeFailure({
      ...value,
      directory: {
        kind: "exhausted",
        highWaterScopeId: HIGH_WATER_SCOPE_ID,
      },
    }, "invalid_correlation");
  });

  it("rejects operation cursor and next-turn correlation drift", async () => {
    const value = continuingValue();
    const active = value.activeScope!;
    await expectEncodeFailure({
      ...value,
      activeScope: {
        ...active,
        dispatch: {
          kind: "continuing",
          continuation: cancellationCursor(),
        },
      },
    }, "invalid_correlation");
    await expectEncodeFailure({
      ...value,
      activeScope: {
        ...active,
        nextOperation: "dispatch",
        dispatch: { kind: "exhausted" },
      },
    }, "invalid_correlation");
  });

  it("distinguishes a reset cursor from conservatively charged unknown progress", async () => {
    const value = continuingValue();
    const active = value.activeScope!;
    await expectEncodeFailure({
      ...value,
      activeScope: {
        ...active,
        dispatchPagesCharged: 0,
      },
    }, "invalid_correlation");
    const unknownProgress = {
      ...value,
      activeScope: {
        ...active,
        cancellationPagesCharged: 1,
      },
    };
    const evidence = await Effect.runPromise(
      encodeTaskComputeDeliveryConnectedContinuationV1(unknownProgress),
    );
    await expect(
      Effect.runPromise(
        decodeTaskComputeDeliveryConnectedContinuationV1(evidence),
      ),
    ).resolves.toMatchObject({
      activeScope: {
        cancellation: { kind: "unstarted" },
        cancellationPagesCharged: 1,
      },
    });
  });

  it("rejects stale fairness charges and forbidden excess keys", async () => {
    const value = continuingValue();
    await expectEncodeFailure({
      ...value,
      activeScope: {
        ...value.activeScope!,
        dispatchPagesCharged: 101,
      },
    }, "invalid_input");
    const hostile = { ...value } as Record<string, unknown>;
    Object.defineProperty(hostile, "__proto__", {
      enumerable: true,
      value: { admitted: true },
    });
    await expectEncodeFailure(hostile, "invalid_input");
  });

  it("returns typed failure for revoked input without leaking a defect", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    await expectEncodeFailure(revoked.proxy, "invalid_input");

    let accessorReads = 0;
    const accessorEvidence = {
      codecVersion: 1,
      sha256: new Uint8Array(32),
    } as Record<string, unknown>;
    Object.defineProperty(accessorEvidence, "canonicalBytes", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return new Uint8Array([1]);
      },
    });
    await expectDecodeFailure(accessorEvidence, "invalid_input");
    expect(accessorReads).toBe(0);
  });

  it("uses intrinsic byte views and maps detached evidence to typed failure", async () => {
    const evidence = await Effect.runPromise(
      encodeTaskComputeDeliveryConnectedContinuationV1(continuingValue()),
    );
    const canonicalBytes = evidence.canonicalBytes;
    const sha256 = evidence.sha256;
    let byteLengthReads = 0;
    for (const bytes of [canonicalBytes, sha256]) {
      Object.defineProperty(bytes, "byteLength", {
        get() {
          byteLengthReads += 1;
          throw new Error("hostile byteLength");
        },
      });
    }
    await expect(
      Effect.runPromise(decodeTaskComputeDeliveryConnectedContinuationV1({
        codecVersion: 1,
        canonicalBytes,
        sha256,
      })),
    ).resolves.toEqual(continuingValue());
    expect(byteLengthReads).toBe(0);

    const detachedBytes = evidence.canonicalBytes;
    structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
    await expectDecodeFailure({
      codecVersion: 1,
      canonicalBytes: detachedBytes,
      sha256: evidence.sha256,
    }, "invalid_bytes");

    const detachedDigest = evidence.sha256;
    structuredClone(detachedDigest.buffer, { transfer: [detachedDigest.buffer] });
    await expectDecodeFailure({
      codecVersion: 1,
      canonicalBytes: evidence.canonicalBytes,
      sha256: detachedDigest,
    }, "invalid_digest");
  });

  it("rejects digest drift and matching-digest noncanonical bytes", async () => {
    const evidence = await Effect.runPromise(
      encodeTaskComputeDeliveryConnectedContinuationV1(continuingValue()),
    );
    const digestDrift = evidence.sha256;
    digestDrift[0] ^= 0xff;
    await expectDecodeFailure({
      codecVersion: 1,
      canonicalBytes: evidence.canonicalBytes,
      sha256: digestDrift,
    }, "invalid_digest");

    const noncanonical = new Uint8Array([
      ...evidence.canonicalBytes,
      ...new TextEncoder().encode(" "),
    ]);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", noncanonical),
    );
    await expectDecodeFailure({
      codecVersion: 1,
      canonicalBytes: noncanonical,
      sha256: digest,
    }, "non_canonical");
  });
});

function continuingValue(): TaskComputeDeliveryConnectedContinuationV1 {
  return Object.freeze({
    version: "flarex.task-compute-delivery-connected-continuation.v1",
    directory: Object.freeze({ kind: "unstarted" }),
    activeScope: Object.freeze({
      expectedDeploymentId: "deployment-connected-continuation",
      expectedScopeId: SCOPE_ID,
      directoryAfter: Object.freeze({
        kind: "continuing",
        continuation: Object.freeze({
          codecVersion: 1,
          highWaterScopeId: HIGH_WATER_SCOPE_ID,
          lastScopeId: SCOPE_ID,
        }),
      }),
      nextOperation: "cancellation",
      dispatch: Object.freeze({
        kind: "continuing",
        continuation: dispatchCursor(),
      }),
      cancellation: Object.freeze({ kind: "unstarted" }),
      dispatchPagesCharged: 1,
      cancellationPagesCharged: 0,
    }),
  });
}

function dispatchCursor(): TaskComputeDeliveryContinuationV1<"dispatch"> {
  const decoded = success(decodeTaskComputeDeliveryContinuationV1({
    codecVersion: 1,
    operation: "dispatch",
    databaseTimeBound: "2026-08-11T00:00:00.000Z",
    highWater: position("run_95000000-0000-4000-8000-000000000010", "2"),
    last: position("run_95000000-0000-4000-8000-000000000009", "1"),
  }));
  if (decoded.operation !== "dispatch") throw new Error("dispatch cursor drift");
  return Object.freeze({ ...decoded, operation: "dispatch" });
}

function cancellationCursor():
  TaskComputeDeliveryContinuationV1<"cancellation"> {
  const decoded = success(decodeTaskComputeDeliveryContinuationV1({
    codecVersion: 1,
    operation: "cancellation",
    databaseTimeBound: "2026-08-11T00:00:00.000Z",
    highWater: position("run_95000000-0000-4000-8000-000000000012", "4"),
    last: position("run_95000000-0000-4000-8000-000000000011", "3"),
  }));
  if (decoded.operation !== "cancellation") {
    throw new Error("cancellation cursor drift");
  }
  return Object.freeze({ ...decoded, operation: "cancellation" });
}

function position(runId: string, requestedEffectSequence: string) {
  return {
    eligibleAt: "2026-08-11T00:00:00.000Z",
    runId,
    requestedEffectSequence,
  };
}

async function expectEncodeFailure(
  input: unknown,
  reason: string,
): Promise<void> {
  const failure = await Effect.runPromise(
    encodeTaskComputeDeliveryConnectedContinuationV1(input).pipe(Effect.flip),
  );
  expect(failure).toBeInstanceOf(
    TaskComputeDeliveryConnectedContinuationCodecV1Error,
  );
  expect(failure).toMatchObject({ operation: "encode", reason });
}

async function expectDecodeFailure(
  input: unknown,
  reason: string,
): Promise<void> {
  const failure = await Effect.runPromise(
    decodeTaskComputeDeliveryConnectedContinuationV1(input).pipe(Effect.flip),
  );
  expect(failure).toBeInstanceOf(
    TaskComputeDeliveryConnectedContinuationCodecV1Error,
  );
  expect(failure).toMatchObject({ operation: "decode", reason });
}

function success<Success, Failure>(result: Result.Result<Success, Failure>) {
  return Result.getOrThrow(result);
}

type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Value extends true> = Value;

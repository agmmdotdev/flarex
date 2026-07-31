import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DeclarativeV2PhysicalFrameV1Error,
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  makeDeclarativeV2PhysicalFrameEncoderFactoryV1,
  type DeclarativeV2PhysicalFrameEncoderFactoryV1,
  type DeclarativeV2PhysicalFrameEncoderReceiptV1,
  type DeclarativeV2PhysicalFrameEncoderStepV1,
  type DeclarativeV2PhysicalFrameV1,
  type DeclarativeV2PhysicalFrameWorkV1,
} from "../src/declarative-v2-physical-v1";

const digest = (value: number): Uint8Array =>
  new Uint8Array(32).fill(value);

const budget = Object.freeze({
  maximumFrameBytes: 1_000_000,
  maximumCanonicalBytes: 1_000_000,
});

describe("Declarative V2 physical frames", () => {
  it("round-trips every frame family with detached owned bytes", () => {
    for (const frame of fixtures()) {
      const encoded = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(frame, budget),
      );
      const decoded = Result.getOrThrow(
        decodeDeclarativeV2PhysicalFrameV1(encoded.canonicalBytes, budget),
      );
      expect(decoded.frame).toEqual(frame);
      expect(decoded.canonicalBytes).not.toBe(encoded.canonicalBytes);
      for (const value of Object.values(decoded.frame)) {
        if (value instanceof Uint8Array) {
          expect(
            Object.values(frame).some((candidate) => candidate === value),
          ).toBe(false);
        }
      }
    }
  });

  it("pins exact and one-less frame and canonical-byte budgets", () => {
    const frame = fixtures().find((item) =>
      item.kind === "deployment_analysis_projection"
    );
    if (frame === undefined) throw new Error("Missing projection fixture.");
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(frame, budget),
    );
    expect(Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: encoded.usage.frameBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
    })).usage).toEqual(encoded.usage);

    const frameResult = encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: encoded.usage.frameBytes - 1,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
    });
    if (Result.isSuccess(frameResult)) {
      throw new Error("Expected frame budget failure.");
    }
    const frameFailure = frameResult.failure;
    expect(frameFailure).toBeInstanceOf(DeclarativeV2PhysicalFrameV1Error);
    expect(frameFailure.reason).toBe("frameBytesExceeded");

    const canonicalResult = decodeDeclarativeV2PhysicalFrameV1(
      encoded.canonicalBytes,
      {
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes - 1,
      },
    );
    if (Result.isSuccess(canonicalResult)) {
      throw new Error("Expected canonical budget failure.");
    }
    const canonicalFailure = canonicalResult.failure;
    expect(canonicalFailure.reason).toBe("canonicalBytesExceeded");
  });

  it("rejects trailing, truncated, malformed, and cross-field-invalid frames", () => {
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(fixtures()[0], budget),
    ).canonicalBytes;
    expect(Result.isFailure(decodeDeclarativeV2PhysicalFrameV1(
      encoded.slice(0, -1),
      budget,
    ))).toBe(true);
    expect(Result.isFailure(decodeDeclarativeV2PhysicalFrameV1(
      new Uint8Array([...encoded, 0]),
      budget,
    ))).toBe(true);
    const corrupted = new Uint8Array(encoded);
    corrupted[0] ^= 0xff;
    expect(Result.isFailure(
      decodeDeclarativeV2PhysicalFrameV1(corrupted, budget),
    )).toBe(true);
    const inheritedKindDomain = new TextEncoder().encode(
      "flarex.declarative-v2/toString/v1\0\0\0\0\0",
    );
    expect(Result.isFailure(
      decodeDeclarativeV2PhysicalFrameV1(inheritedKindDomain, budget),
    )).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PhysicalFrameV1({
      kind: "verdict",
      attemptSha256: digest(1),
      candidateSha256: digest(2),
      verdict: "ready",
      diagnosticRootSha256: digest(3),
      failureCode: "must-not-exist",
      handlerSetSha256: digest(4),
      registrationRootSha256: digest(5),
      indexReadinessRootSha256: digest(6),
    }, budget))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PhysicalFrameV1({
      kind: "phase_page_manifest",
      attemptSha256: digest(1),
      phase: "source",
      pageOrdinal: 0n,
      firstItemOrdinal: 0n,
      itemCount: 1n,
      previousPageSha256: digest(2),
      pageRootSha256: digest(3),
    }, budget))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PhysicalFrameV1({
      kind: "phase_page_manifest",
      attemptSha256: digest(1),
      phase: "source",
      pageOrdinal: 1n,
      firstItemOrdinal: 1n,
      itemCount: 1n,
      previousPageSha256: null,
      pageRootSha256: digest(3),
    }, budget))).toBe(true);
  });

  it("canonically permits empty runtime projection sets and function manifests", () => {
    for (const frame of [
      {
        kind: "runtime_projection_set" as const,
        groupCount: 0n,
        transactionProjectionSha256: null,
        edgeActionProjectionSha256: null,
      },
      {
        kind: "function_group_manifest" as const,
        runtimeProjectionSetSha256: digest(1),
        functionCount: 0n,
        functionRootSha256: digest(2),
        validatorRootSha256: digest(3),
        declaredHandlerSetSha256: digest(4),
      },
    ]) {
      const encoded = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(frame, budget),
      );
      expect(Result.getOrThrow(
        decodeDeclarativeV2PhysicalFrameV1(encoded.canonicalBytes, budget),
      ).frame).toEqual(frame);
    }
  });

  it("preserves signed-int64 boundaries and unusual UTF-16 text", () => {
    const frame: DeclarativeV2PhysicalFrameV1 = {
      kind: "activation_head",
      scopeId: "scope_￿_😀",
      revisionCounter: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
      currentRevision: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
      candidateSha256: digest(7),
      verdictSha256: digest(8),
    };
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(frame, budget),
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2PhysicalFrameV1(encoded.canonicalBytes, budget),
    ).frame).toEqual(frame);
  });

  it("rejects aliases, accessors, symbols, and malformed budgets", () => {
    const fixture = fixtures()[0];
    const inherited = Object.create(fixture);
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(inherited, budget),
    )).toBe(true);
    const accessor = {
      ...fixture,
      get projectId() {
        throw new Error("must not be invoked");
      },
    };
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(accessor, budget),
    )).toBe(true);
    const symbol = { ...fixture, [Symbol("extra")]: true };
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(symbol, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(fixture, {}),
    )).toBe(true);
  });

  it("preflights before byte capture and isolates accepted caller bytes", () => {
    const frame = fixtures().find((item) =>
      item.kind === "deployment_analysis_projection"
    );
    if (
      frame === undefined ||
      frame.kind !== "deployment_analysis_projection"
    ) {
      throw new Error("Missing projection fixture.");
    }
    Object.defineProperty(frame.canonicalBytes, Symbol.iterator, {
      configurable: true,
      get() {
        throw new Error("iterator must not be consulted");
      },
    });
    const exact = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(frame, budget),
    );
    const overBudget = encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: exact.usage.frameBytes - 1,
      maximumCanonicalBytes: exact.usage.canonicalBytes,
    });
    expect(Result.isFailure(overBudget)).toBe(true);

    const originalDigest = frame.candidateSha256[0];
    const originalCanonical = frame.canonicalBytes[0];
    frame.candidateSha256[0] ^= 0xff;
    frame.canonicalBytes[0] ^= 0xff;
    expect(exact.frame.kind).toBe("deployment_analysis_projection");
    if (exact.frame.kind !== "deployment_analysis_projection") {
      throw new Error("Expected projection evidence.");
    }
    expect(exact.frame.candidateSha256[0]).toBe(originalDigest);
    expect(exact.frame.canonicalBytes[0]).toBe(originalCanonical);
  });

  it("keeps the codec off the package root and on one internal subpath", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-physical-v1",
      "./src/declarative-v2-physical-v1.ts",
    );
    expect(root).not.toHaveProperty("encodeDeclarativeV2PhysicalFrameV1");
    expect(root).not.toHaveProperty(
      "makeDeclarativeV2PhysicalFrameEncoderFactoryV1",
    );
  });
});

describe("Declarative V2 resumable physical frame encoding", () => {
  it("matches every atomic frame byte-for-byte with exact one-byte receipts", () => {
    for (const frame of fixtures()) {
      const atomic = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(frame, budget),
      );
      const run = runPhysicalFrameCursor(frame, [0, ...new Array(
        atomic.canonicalBytes.byteLength,
      ).fill(1)]);

      expect(run.bytes, frame.kind).toEqual(atomic.canonicalBytes);
      expect(run.created.plan.frameByteLength).toBe(
        atomic.canonicalBytes.byteLength,
      );
      expect(run.created.plan.canonicalByteLength).toBe(
        atomic.usage.canonicalBytes,
      );
      expect(run.created.plan.successfulWork).toEqual(
        expectedPhysicalFrameWork(frame, atomic.canonicalBytes.byteLength),
      );
      expect(run.completed.receipt.aggregateWork).toEqual(
        run.created.plan.successfulWork,
      );
      expect(run.completed.written.work).toEqual(
        run.created.plan.successfulWork,
      );
      expect(run.completed.written.frame).toEqual(frame);
      for (const value of Object.values(run.completed.written.frame)) {
        if (value instanceof Uint8Array) {
          expect(Object.values(frame).includes(value)).toBe(false);
        }
      }
      expect(run.receipts[0]).toEqual({
        consumedAllowance: 0,
        deltaWork: zeroPhysicalFrameWork(),
        aggregateWork: run.admitted.aggregateWork,
      });
      for (const receipt of run.receipts.slice(1)) {
        expect(receipt.consumedAllowance).toBe(1);
        expect(receipt.deltaWork.byteWriteBytes).toBe(1);
        expect(receipt.deltaWork.primitiveTransitions).toBe(1);
        expect(receipt.deltaWork.byteStorageAllocationBytes).toBe(0);
        expect(receipt.deltaWork.byteScanBytes).toBe(0);
        expect(receipt.deltaWork.byteCopyBytes === 0 ||
          receipt.deltaWork.byteCopyBytes === 1).toBe(true);
      }
      expect(Result.isFailure(
        run.factory.step(run.created.cursor, 1),
      )).toBe(true);
      expect(Result.isFailure(
        run.factory.close(run.created.cursor),
      )).toBe(true);
    }
  });

  it("is deterministic at every split and across two cold factories", () => {
    for (const frame of fixtures()) {
      const expected = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(frame, budget),
      ).canonicalBytes;
      for (let split = 0; split <= expected.byteLength; split += 1) {
        const warm = runPhysicalFrameCursor(frame, [split, 1024]);
        const cold = runPhysicalFrameCursor(frame, [split, 1024]);
        expect(warm.bytes, `${frame.kind}:${split}:warm`).toEqual(expected);
        expect(cold.bytes, `${frame.kind}:${split}:cold`).toEqual(expected);
        expect(cold.completed.receipt.aggregateWork).toEqual(
          warm.completed.receipt.aggregateWork,
        );
      }
    }
  }, 30_000);

  it("enforces allowance zero, one, 1,024, and terminal rejection above 1,024", () => {
    const frame = largeProjectionFixture();
    const factory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const created = Result.getOrThrow(factory.create(frame, budget));
    const destination = new Uint8Array(created.plan.frameByteLength);
    Result.getOrThrow(factory.admit(
      created.cursor,
      () => Result.succeed(byteRange(destination, created.plan.frameByteLength)),
    ));

    const zero = Result.getOrThrow(factory.step(created.cursor, 0));
    expect(zero).toEqual({
      status: "pending",
      receipt: {
        consumedAllowance: 0,
        deltaWork: zeroPhysicalFrameWork(),
        aggregateWork: {
          byteStorageAllocationBytes:
            created.plan.successfulWork.byteStorageAllocationBytes,
          byteCopyBytes: created.receipt.aggregateWork.byteCopyBytes,
          byteWriteBytes: 0,
          byteScanBytes: 0,
          primitiveTransitions: 0,
        },
      },
    });

    const one = Result.getOrThrow(factory.step(created.cursor, 1));
    expect(one.status).toBe("pending");
    expect(one.receipt.consumedAllowance).toBe(1);
    const quantum = Result.getOrThrow(factory.step(created.cursor, 1024));
    expect(quantum.status).toBe("pending");
    expect(quantum.receipt.consumedAllowance).toBe(1024);

    const rejected = factory.step(created.cursor, 1025);
    expect(Result.isFailure(rejected)).toBe(true);
    if (Result.isSuccess(rejected)) throw new Error("Expected failure.");
    expect(rejected.failure.reason).toBe("invalidBudget");
    expect(Result.isFailure(factory.step(created.cursor, 1))).toBe(true);

    for (const allowance of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const nextFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
      const next = Result.getOrThrow(nextFactory.create(frame, budget));
      const bytes = new Uint8Array(next.plan.frameByteLength);
      Result.getOrThrow(nextFactory.admit(
        next.cursor,
        () => Result.succeed(byteRange(bytes, next.plan.frameByteLength)),
      ));
      expect(Result.isFailure(
        nextFactory.step(next.cursor, allowance),
      )).toBe(true);
    }
  });

  it("admits exact destination and work ceilings before output work", () => {
    const frame = registrationFixture();
    const dimensions = Object.keys(zeroPhysicalFrameWork()) as readonly (
      keyof DeclarativeV2PhysicalFrameWorkV1
    )[];

    for (const dimension of dimensions) {
      const exactFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
      const exact = Result.getOrThrow(exactFactory.create(frame, budget));
      const exactDestination = new Uint8Array(exact.plan.frameByteLength + 5)
        .fill(0xa5);
      let calls = 0;
      Result.getOrThrow(exactFactory.admit(exact.cursor, plan => {
        calls += 1;
        expect(plan.successfulWork[dimension]).toBe(
          exact.plan.successfulWork[dimension],
        );
        return Result.succeed(Object.freeze({
          bytes: exactDestination,
          byteOffset: 3,
          byteLength: plan.frameByteLength,
        }));
      }));
      expect(calls).toBe(1);
      expect(exactDestination.every((value) => value === 0xa5)).toBe(true);
      const complete = finishPhysicalFrameCursor(
        exactFactory,
        exact.cursor,
        [1024],
      );
      expect(complete.written.work[dimension]).toBe(
        exact.plan.successfulWork[dimension],
      );

      if (exact.plan.successfulWork[dimension] === 0) {
        expect(dimension).toBe("byteScanBytes");
        continue;
      }
      const marker = Object.freeze({ _tag: "WorkCeiling" as const, dimension });
      const shortFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
      const short = Result.getOrThrow(shortFactory.create(frame, budget));
      const failed = shortFactory.admit(short.cursor, plan =>
        plan.successfulWork[dimension] >
            plan.successfulWork[dimension] - 1
          ? Result.fail(marker)
          : Result.succeed(byteRange(
            new Uint8Array(plan.frameByteLength),
            plan.frameByteLength,
          ))
      );
      expect(Result.isFailure(failed)).toBe(true);
      if (Result.isSuccess(failed)) throw new Error("Expected failure.");
      expect(failed.failure).toBe(marker);
      expect(Result.isFailure(shortFactory.step(short.cursor, 1))).toBe(true);
    }

    for (const range of [
      (length: number) => byteRange(new Uint8Array(length - 1), length - 1),
      (length: number) => Object.freeze({
        bytes: new Uint8Array(length),
        byteOffset: 1,
        byteLength: length,
      }),
      (length: number) => Object.freeze({
        bytes: new Uint8Array(length + 1),
        byteOffset: 0,
        byteLength: length - 1,
      }),
    ]) {
      const factory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
      const created = Result.getOrThrow(factory.create(frame, budget));
      expect(Result.isFailure(factory.admit(
        created.cursor,
        () => Result.succeed(range(created.plan.frameByteLength)),
      ))).toBe(true);
      expect(Result.isFailure(factory.step(created.cursor, 1))).toBe(true);
    }
  });

  it("fails closed for callback, factory, forgery, close, and reuse violations", () => {
    const frame = diagnosticFixture();
    const typedMarker = Object.freeze({ _tag: "AdmissionDenied" as const });
    const typedFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const typed = Result.getOrThrow(typedFactory.create(frame, budget));
    const typedFailure = typedFactory.admit(
      typed.cursor,
      () => Result.fail(typedMarker),
    );
    expect(Result.isFailure(typedFailure)).toBe(true);
    if (Result.isSuccess(typedFailure)) throw new Error("Expected failure.");
    expect(typedFailure.failure).toBe(typedMarker);
    expect(Result.isFailure(typedFactory.close(typed.cursor))).toBe(true);

    const thrown = new Error("trusted admission defect");
    const throwFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const throwing = Result.getOrThrow(throwFactory.create(frame, budget));
    expect(() => throwFactory.admit(throwing.cursor, () => {
      throw thrown;
    })).toThrow(thrown);
    expect(Result.isFailure(throwFactory.step(throwing.cursor, 1))).toBe(true);

    const reentrantFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const reentrant = Result.getOrThrow(
      reentrantFactory.create(frame, budget),
    );
    const reentered = reentrantFactory.admit(reentrant.cursor, plan => {
      expect(Result.isFailure(reentrantFactory.admit(
        reentrant.cursor,
        () => Result.succeed(byteRange(
          new Uint8Array(plan.frameByteLength),
          plan.frameByteLength,
        )),
      ))).toBe(true);
      return Result.succeed(byteRange(
        new Uint8Array(plan.frameByteLength),
        plan.frameByteLength,
      ));
    });
    expect(Result.isFailure(reentered)).toBe(true);

    const inputFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const inputForeign = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const inputCreated = Result.getOrThrow(inputFactory.create(frame, budget));
    Result.getOrThrow(inputFactory.admit(inputCreated.cursor, plan => {
      const nested = inputForeign.create(frame, budget);
      expect(Result.isFailure(nested)).toBe(true);
      if (Result.isSuccess(nested)) throw new Error("Expected failure.");
      expect(nested.failure.path).toBe("admission.reentrantInput");
      return Result.succeed(byteRange(
        new Uint8Array(plan.frameByteLength),
        plan.frameByteLength,
      ));
    }));
    Result.getOrThrow(inputFactory.close(inputCreated.cursor));

    const siblingFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const outer = Result.getOrThrow(siblingFactory.create(frame, budget));
    const inner = Result.getOrThrow(siblingFactory.create(frame, budget));
    Result.getOrThrow(siblingFactory.admit(outer.cursor, plan => {
      const nested = siblingFactory.admit(inner.cursor, () =>
        Result.succeed(byteRange(
          new Uint8Array(plan.frameByteLength),
          plan.frameByteLength,
        ))
      );
      expect(Result.isFailure(nested)).toBe(true);
      if (Result.isSuccess(nested)) throw new Error("Expected failure.");
      expect(nested.failure.path).toBe("admission.reentrantInput");
      return Result.succeed(byteRange(
        new Uint8Array(plan.frameByteLength),
        plan.frameByteLength,
      ));
    }));
    expect(Result.isFailure(siblingFactory.close(inner.cursor))).toBe(true);
    Result.getOrThrow(siblingFactory.close(outer.cursor));

    const owner = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const foreign = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const created = Result.getOrThrow(owner.create(frame, budget));
    expect(Result.isFailure(foreign.step(created.cursor, 1))).toBe(true);
    expect(Result.isFailure(foreign.close(created.cursor))).toBe(true);
    expect(Result.isFailure(owner.step({ ...created.cursor }, 1))).toBe(true);
    expect(Result.getOrThrow(owner.close(created.cursor)).aggregateWork)
      .toEqual(created.receipt.aggregateWork);
    expect(Result.isFailure(owner.close(created.cursor))).toBe(true);

    const rawFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    expect(Result.isFailure(rawFactory.step({}, 1))).toBe(true);
    expect(Result.isFailure(rawFactory.close(null))).toBe(true);
  });

  it("captures hostile inputs once without invoking getters or property reads", () => {
    const frame = registrationFixture();
    let reads = 0;
    const proxy = new Proxy(frame, {
      get() {
        reads += 1;
        throw new Error("property reads are forbidden");
      },
    });
    const encoded = Result.getOrThrow(
      makeDeclarativeV2PhysicalFrameEncoderFactoryV1().create(proxy, budget),
    );
    expect(reads).toBe(0);
    expect(encoded.plan.frameByteLength).toBeGreaterThan(0);

    let accessorReads = 0;
    const accessor = {
      ...frame,
      get exportName() {
        accessorReads += 1;
        return "unsafe";
      },
    };
    expect(Result.isFailure(
      makeDeclarativeV2PhysicalFrameEncoderFactoryV1().create(
        accessor,
        budget,
      ),
    )).toBe(true);
    expect(accessorReads).toBe(0);

    const ownKeysFailure = new Proxy(frame, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(Result.isFailure(
      makeDeclarativeV2PhysicalFrameEncoderFactoryV1().create(
        ownKeysFailure,
        budget,
      ),
    )).toBe(true);

    const badBudget = new Proxy(budget, {
      ownKeys() {
        throw new Error("hostile budget");
      },
    });
    const budgetFirst = makeDeclarativeV2PhysicalFrameEncoderFactoryV1()
      .create(null, badBudget);
    expect(Result.isFailure(budgetFirst)).toBe(true);
    if (Result.isSuccess(budgetFirst)) throw new Error("Expected failure.");
    expect(budgetFirst.failure.reason).toBe("invalidBudget");
  });

  it("rejects detached, shared destination, aliased, and active ranges", () => {
    const frame = registrationFixture();
    const detachedInput = registrationFixture();
    structuredClone(
      detachedInput.attemptSha256.buffer,
      { transfer: [detachedInput.attemptSha256.buffer] },
    );
    const detachedInputResult =
      makeDeclarativeV2PhysicalFrameEncoderFactoryV1().create(
        detachedInput,
        budget,
      );
    expect(Result.isFailure(detachedInputResult)).toBe(true);
    if (Result.isSuccess(detachedInputResult)) {
      throw new Error("Expected detached input failure.");
    }
    expect(detachedInputResult.failure.reason).toBe("invalidInput");
    expect(detachedInputResult.failure.path).toBe(
      "registration.attemptSha256",
    );

    const detachedFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const detached = Result.getOrThrow(detachedFactory.create(frame, budget));
    const detachedBytes = new Uint8Array(detached.plan.frameByteLength);
    structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
    expect(Result.isFailure(detachedFactory.admit(
      detached.cursor,
      () => Result.succeed(
        byteRange(detachedBytes, detached.plan.frameByteLength),
      ),
    ))).toBe(true);

    if (typeof SharedArrayBuffer !== "undefined") {
      const sharedFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
      const shared = Result.getOrThrow(sharedFactory.create(frame, budget));
      const sharedBytes = new Uint8Array(
        new SharedArrayBuffer(shared.plan.frameByteLength),
      );
      expect(Result.isFailure(sharedFactory.admit(
        shared.cursor,
        () => Result.succeed(
          byteRange(sharedBytes, shared.plan.frameByteLength),
        ),
      ))).toBe(true);

      const sharedDigest = new Uint8Array(new SharedArrayBuffer(32));
      sharedDigest.fill(9);
      const sharedFrame = { ...frame, attemptSha256: sharedDigest };
      const expected = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(
          { ...frame, attemptSha256: new Uint8Array(sharedDigest) },
          budget,
        ),
      ).canonicalBytes;
      const sharedInputFactory =
        makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
      const captured = Result.getOrThrow(
        sharedInputFactory.create(sharedFrame, budget),
      );
      sharedDigest.fill(3);
      const destination = new Uint8Array(captured.plan.frameByteLength);
      Result.getOrThrow(sharedInputFactory.admit(
        captured.cursor,
        () => Result.succeed(
          byteRange(destination, captured.plan.frameByteLength),
        ),
      ));
      finishPhysicalFrameCursor(
        sharedInputFactory,
        captured.cursor,
        [1024],
      );
      expect(destination).toEqual(expected);
    }

    const overlapBacking = new ArrayBuffer(4096);
    const overlapFrame = {
      ...frame,
      attemptSha256: new Uint8Array(overlapBacking, 0, 32).fill(4),
    };
    const overlapFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const overlap = Result.getOrThrow(
      overlapFactory.create(overlapFrame, budget),
    );
    expect(Result.isFailure(overlapFactory.admit(
      overlap.cursor,
      () => Result.succeed(Object.freeze({
        bytes: new Uint8Array(overlapBacking),
        byteOffset: 0,
        byteLength: overlap.plan.frameByteLength,
      })),
    ))).toBe(true);

    const activeBacking = new Uint8Array(4096);
    const firstFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const secondFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const first = Result.getOrThrow(firstFactory.create(frame, budget));
    const second = Result.getOrThrow(secondFactory.create(frame, budget));
    Result.getOrThrow(firstFactory.admit(
      first.cursor,
      () => Result.succeed(Object.freeze({
        bytes: activeBacking,
        byteOffset: 0,
        byteLength: first.plan.frameByteLength,
      })),
    ));
    expect(Result.isFailure(secondFactory.admit(
      second.cursor,
      () => Result.succeed(Object.freeze({
        bytes: activeBacking,
        byteOffset: 0,
        byteLength: second.plan.frameByteLength,
      })),
    ))).toBe(true);
    Result.getOrThrow(firstFactory.close(first.cursor));

    const reuseFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const reuse = Result.getOrThrow(reuseFactory.create(frame, budget));
    Result.getOrThrow(reuseFactory.admit(
      reuse.cursor,
      () => Result.succeed(Object.freeze({
        bytes: activeBacking,
        byteOffset: 0,
        byteLength: reuse.plan.frameByteLength,
      })),
    ));
    Result.getOrThrow(reuseFactory.close(reuse.cursor));

    const lostFactory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
    const lost = Result.getOrThrow(lostFactory.create(frame, budget));
    const lostDestination = new Uint8Array(lost.plan.frameByteLength);
    Result.getOrThrow(lostFactory.admit(
      lost.cursor,
      () => Result.succeed(
        byteRange(lostDestination, lost.plan.frameByteLength),
      ),
    ));
    structuredClone(
      lostDestination.buffer,
      { transfer: [lostDestination.buffer] },
    );
    expect(Result.isFailure(lostFactory.step(lost.cursor, 1))).toBe(true);
  });

  it("preserves nullable predecessor layouts and atomic failure identity", () => {
    const variants: readonly DeclarativeV2PhysicalFrameV1[] = [
      {
        ...fixtures().find((frame) => frame.kind === "phase_page_manifest"),
        kind: "phase_page_manifest",
        attemptSha256: digest(41),
        phase: "link",
        pageOrdinal: 2n,
        firstItemOrdinal: 4n,
        itemCount: 2n,
        previousPageSha256: digest(42),
        pageRootSha256: digest(43),
      },
      {
        kind: "activation_revision",
        scopeId: "scope",
        revision: 2n,
        previousRevision: 1n,
        action: "rollback",
        candidateSha256: digest(44),
        verdictSha256: digest(45),
        activationRequestSha256: digest(46),
      },
      {
        kind: "activation_head",
        scopeId: "scope",
        revisionCounter: 2n,
        currentRevision: 2n,
        candidateSha256: digest(47),
        verdictSha256: digest(48),
      },
      {
        kind: "verdict",
        attemptSha256: digest(49),
        candidateSha256: digest(50),
        verdict: "rejected",
        diagnosticRootSha256: digest(51),
        failureCode: "E_REGISTRATION",
        handlerSetSha256: null,
        registrationRootSha256: null,
        indexReadinessRootSha256: null,
      },
    ];
    for (const frame of variants) {
      const atomic = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(frame, budget),
      );
      expect(runPhysicalFrameCursor(frame, [1, 1024]).bytes).toEqual(
        atomic.canonicalBytes,
      );
    }

    const invalid = {
      kind: "phase_page_manifest",
      attemptSha256: digest(1),
      phase: "source",
      pageOrdinal: 0n,
      firstItemOrdinal: 0n,
      itemCount: 1n,
      previousPageSha256: digest(2),
      pageRootSha256: digest(3),
    };
    const atomicFailure = encodeDeclarativeV2PhysicalFrameV1(invalid, budget);
    const cursorFailure =
      makeDeclarativeV2PhysicalFrameEncoderFactoryV1().create(invalid, budget);
    expect(Result.isFailure(atomicFailure)).toBe(true);
    expect(Result.isFailure(cursorFailure)).toBe(true);
    if (Result.isSuccess(atomicFailure) || Result.isSuccess(cursorFailure)) {
      throw new Error("Expected matching failures.");
    }
    expect(cursorFailure.failure).toEqual(atomicFailure.failure);
  });
});

function runPhysicalFrameCursor(
  frame: DeclarativeV2PhysicalFrameV1,
  allowances: readonly number[],
): Readonly<{
  readonly factory: DeclarativeV2PhysicalFrameEncoderFactoryV1;
  readonly created: ReturnType<
    DeclarativeV2PhysicalFrameEncoderFactoryV1["create"]
  > extends Result.Result<infer Success, unknown> ? Success : never;
  readonly admitted: DeclarativeV2PhysicalFrameEncoderReceiptV1;
  readonly completed: Extract<
    DeclarativeV2PhysicalFrameEncoderStepV1,
    { readonly status: "complete" }
  >;
  readonly receipts: readonly DeclarativeV2PhysicalFrameEncoderReceiptV1[];
  readonly bytes: Uint8Array;
}> {
  const factory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
  const created = Result.getOrThrow(factory.create(frame, budget));
  const storage = new Uint8Array(created.plan.frameByteLength + 7).fill(0xa5);
  const admitted = Result.getOrThrow(factory.admit(
    created.cursor,
    () => Result.succeed(Object.freeze({
      bytes: storage,
      byteOffset: 3,
      byteLength: created.plan.frameByteLength,
    })),
  ));
  const receipts: DeclarativeV2PhysicalFrameEncoderReceiptV1[] = [];
  let completed:
    | Extract<
      DeclarativeV2PhysicalFrameEncoderStepV1,
      { readonly status: "complete" }
    >
    | undefined;
  for (const allowance of allowances) {
    if (completed !== undefined) break;
    const step = Result.getOrThrow(factory.step(created.cursor, allowance));
    receipts.push(step.receipt);
    if (step.status === "complete") completed = step;
  }
  while (completed === undefined) {
    const step = Result.getOrThrow(factory.step(created.cursor, 1024));
    receipts.push(step.receipt);
    if (step.status === "complete") completed = step;
  }
  expect(storage.slice(0, 3)).toEqual(new Uint8Array(3).fill(0xa5));
  expect(storage.slice(3 + created.plan.frameByteLength)).toEqual(
    new Uint8Array(4).fill(0xa5),
  );
  return Object.freeze({
    factory,
    created,
    admitted,
    completed,
    receipts: Object.freeze(receipts),
    bytes: storage.slice(3, 3 + created.plan.frameByteLength),
  });
}

function finishPhysicalFrameCursor(
  factory: DeclarativeV2PhysicalFrameEncoderFactoryV1,
  cursor: Parameters<DeclarativeV2PhysicalFrameEncoderFactoryV1["step"]>[0],
  allowances: readonly number[],
): Extract<
  DeclarativeV2PhysicalFrameEncoderStepV1,
  { readonly status: "complete" }
> {
  let completed:
    | Extract<
      DeclarativeV2PhysicalFrameEncoderStepV1,
      { readonly status: "complete" }
    >
    | undefined;
  let allowanceIndex = 0;
  while (completed === undefined) {
    const allowance = allowances[allowanceIndex] ?? 1024;
    allowanceIndex += 1;
    const step = Result.getOrThrow(factory.step(cursor, allowance));
    if (step.status === "complete") completed = step;
  }
  return completed;
}

function byteRange(
  bytes: Uint8Array,
  byteLength: number,
): Readonly<{
  readonly bytes: Uint8Array;
  readonly byteOffset: number;
  readonly byteLength: number;
}> {
  return Object.freeze({ bytes, byteOffset: 0, byteLength });
}

function zeroPhysicalFrameWork(): DeclarativeV2PhysicalFrameWorkV1 {
  return Object.freeze({
    byteStorageAllocationBytes: 0,
    byteCopyBytes: 0,
    byteWriteBytes: 0,
    byteScanBytes: 0,
    primitiveTransitions: 0,
  });
}

function expectedPhysicalFrameWork(
  frame: DeclarativeV2PhysicalFrameV1,
  frameByteLength: number,
): DeclarativeV2PhysicalFrameWorkV1 {
  let capturedBytes = 0;
  for (const value of Object.values(frame)) {
    if (value instanceof Uint8Array) capturedBytes += value.byteLength;
  }
  const domainBytes = new TextEncoder().encode(
    `flarex.declarative-v2/${frame.kind}/v1\0`,
  ).byteLength;
  return Object.freeze({
    byteStorageAllocationBytes: capturedBytes + frameByteLength,
    byteCopyBytes: capturedBytes + domainBytes + capturedBytes,
    byteWriteBytes: frameByteLength,
    byteScanBytes: 0,
    primitiveTransitions: frameByteLength,
  });
}

function largeProjectionFixture(): DeclarativeV2PhysicalFrameV1 {
  return {
    kind: "deployment_analysis_projection",
    candidateSha256: digest(80),
    codecIdentity: "analysis-v1",
    canonicalBytes: new Uint8Array(2048).fill(81),
  };
}

function registrationFixture(): Extract<
  DeclarativeV2PhysicalFrameV1,
  { readonly kind: "registration" }
> {
  const frame = fixtures().find((item) => item.kind === "registration");
  if (frame?.kind !== "registration") {
    throw new Error("Missing registration fixture.");
  }
  return frame;
}

function diagnosticFixture(): Extract<
  DeclarativeV2PhysicalFrameV1,
  { readonly kind: "diagnostic" }
> {
  const frame = fixtures().find((item) => item.kind === "diagnostic");
  if (frame?.kind !== "diagnostic") {
    throw new Error("Missing diagnostic fixture.");
  }
  return frame;
}

function fixtures(): readonly DeclarativeV2PhysicalFrameV1[] {
  const budgetFields = {
    calls: 1n,
    sourceBytes: 2n,
    modules: 3n,
    importEdges: 4n,
    tokens: 5n,
    tokenBytes: 6n,
    nestingDepth: 7n,
    functions: 8n,
    schemaNodes: 9n,
    validatorNodes: 10n,
    graphNodes: 11n,
    frontierEntries: 12n,
    canonicalBytes: 13n,
    frameBytes: 14n,
    hashBytes: 15n,
    diagnosticBytes: 16n,
    outputBytes: 17n,
    elapsedMilliseconds: 18n,
  } as const;
  return [
    {
      kind: "candidate",
      projectId: "project",
      deploymentId: "deployment",
      deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
      scopeId: "scope",
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      scopeEpoch: "epoch",
      sourceRootSha256: digest(1),
      sourceSelectorSha256: digest(2),
      sourceCodecIdentity: "source-v2",
      semanticRootSha256: digest(3),
      semanticSelectorSha256: digest(4),
      semanticModelIdentity: "declarative-v2",
      semanticCodecIdentity: "ndjson-v1",
      semanticPolicyIdentity: "policy-v1",
      packageSha256: digest(5),
      artifactSha256: digest(6),
      artifactRuntimeIdentity: "runtime-v1",
      schemaArtifactSha256: digest(7),
      schemaBindingSha256: digest(8),
      validatorRootSha256: digest(9),
      coreLanguageIdentity: "core-v1",
      abiIdentity: "abi-v1",
      grammarIdentity: "grammar-v1",
      unicodeIdentity: "unicode-14",
      parserTableIdentity: "parser-v1",
      analyzerIdentity: "analyzer-v2",
      verifierIdentity: "verifier-v1",
      declaredHandlerSetSha256: digest(10),
      deploymentAnalysisCodecIdentity: "analysis-v1",
      deploymentAnalysisByteLength: 20n,
      deploymentAnalysisSha256: digest(11),
      deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
      deploymentCodegenAnalysisByteLength: 21n,
      deploymentCodegenAnalysisSha256: digest(12),
      runtimeProjectionSetSha256: digest(13),
      functionGroupManifestSha256: digest(14),
      readinessPolicyIdentity:
        "flarex.readiness/runtime-projection-cold-materialization/v1",
    },
    {
      kind: "deployment_analysis_projection",
      candidateSha256: digest(13),
      codecIdentity: "analysis-v1",
      canonicalBytes: new Uint8Array([0, 1, 2]),
    },
    {
      kind: "deployment_codegen_analysis_projection",
      candidateSha256: digest(13),
      codecIdentity: "codegen-v1",
      canonicalBytes: new Uint8Array([3, 4]),
    },
    {
      kind: "runtime_projection_module",
      group: "transaction",
      moduleOrdinal: 0n,
      modulePath: "functions.js",
      roles: 1n,
      sourceSha256: digest(15),
      sourceBytes: new Uint8Array([1, 2, 3]),
    },
    {
      kind: "runtime_projection",
      group: "transaction",
      executionModule: "execution.js",
      moduleCount: 1n,
      rawByteLength: 3n,
      moduleRootSha256: digest(16),
    },
    {
      kind: "runtime_projection_set",
      groupCount: 1n,
      transactionProjectionSha256: digest(17),
      edgeActionProjectionSha256: null,
    },
    {
      kind: "function_group_entry",
      functionOrdinal: 0n,
      functionPath: "places:create",
      executionModule: "functions.js",
      exportName: "create",
      handlerKind: "mutation",
      visibility: "public",
      group: "transaction",
      projectionSha256: digest(17),
    },
    {
      kind: "function_group_manifest",
      runtimeProjectionSetSha256: digest(18),
      functionCount: 1n,
      functionRootSha256: digest(19),
      validatorRootSha256: digest(9),
      declaredHandlerSetSha256: digest(10),
    },
    {
      kind: "cold_materialization_receipt",
      candidateSha256: digest(20),
      group: "transaction",
      projectionSha256: digest(17),
      functionGroupManifestSha256: digest(21),
      materializerIdentity: "test-loader-v1",
      moduleCount: 1n,
      rawByteLength: 3n,
      compressedByteLength: 2n,
      startupMilliseconds: 2n,
    },
    {
      kind: "attempt_identity",
      candidateSha256: digest(13),
      verifierProgressProtocolIdentity: "progress-v1",
      ceilingsSha256: digest(14),
    },
    { kind: "attempt_ceilings", ...budgetFields },
    { kind: "attempt_usage", ...budgetFields },
    { kind: "command_budget", ...budgetFields },
    {
      kind: "progress_cursor",
      phase: "parse",
      settledSequence: 1n,
      moduleOrdinal: 2n,
      edgeOrdinal: 3n,
      pageOrdinal: 4n,
      previousReceiptSha256: digest(15),
    },
    {
      kind: "command_reservation",
      commandKind: "parse_module",
      sequence: 2n,
      previousReceiptSha256: digest(15),
      budgetSha256: digest(16),
      inputSha256: digest(17),
    },
    {
      kind: "command_receipt",
      commandKind: "parse_module",
      sequence: 2n,
      reservationSha256: digest(18),
      usageSha256: digest(19),
      outputSha256: digest(20),
      progressCursorSha256: digest(21),
    },
    {
      kind: "module_summary",
      attemptSha256: digest(22),
      moduleOrdinal: 0n,
      modulePath: "a/😀.mjs",
      moduleSha256: digest(23),
      sourceMapSha256: null,
      importCount: 1n,
      declaredFunctionCount: 2n,
    },
    {
      kind: "import_edge",
      attemptSha256: digest(22),
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      specifier: "./b.mjs",
      importKind: "named",
      importedName: "run",
      localName: "run",
      targetModulePath: "b.mjs",
    },
    {
      kind: "phase_page_manifest",
      attemptSha256: digest(22),
      phase: "parse",
      pageOrdinal: 0n,
      firstItemOrdinal: 0n,
      itemCount: 1n,
      previousPageSha256: null,
      pageRootSha256: digest(24),
    },
    {
      kind: "link_node",
      attemptSha256: digest(22),
      moduleOrdinal: 0n,
      remainingIndegree: 0n,
      nextEdgeOrdinal: 1n,
      state: "linked",
      rowVersion: 1n,
      previousRowSha256: digest(25),
    },
    {
      kind: "frontier_entry",
      attemptSha256: digest(22),
      frontierSequence: 0n,
      moduleOrdinal: 0n,
      state: "consumed",
      rowVersion: 1n,
      previousRowSha256: digest(26),
    },
    {
      kind: "registration",
      attemptSha256: digest(22),
      registrationOrdinal: 0n,
      handlerIdentitySha256: digest(27),
      moduleOrdinal: 0n,
      exportName: "run",
      functionPath: "a:run",
      handlerKind: "mutation",
      visibility: "public",
    },
    {
      kind: "diagnostic",
      attemptSha256: digest(22),
      diagnosticOrdinal: 0n,
      severity: "warning",
      code: "W_TEST",
      path: null,
      message: "deterministic",
    },
    {
      kind: "verdict",
      attemptSha256: digest(22),
      candidateSha256: digest(13),
      verdict: "ready",
      diagnosticRootSha256: digest(28),
      failureCode: null,
      handlerSetSha256: digest(29),
      registrationRootSha256: digest(30),
      indexReadinessRootSha256: digest(31),
    },
    {
      kind: "activation_revision",
      scopeId: "scope",
      revision: 1n,
      previousRevision: null,
      action: "activate",
      candidateSha256: digest(13),
      verdictSha256: digest(32),
      activationRequestSha256: digest(33),
    },
    {
      kind: "activation_head",
      scopeId: "scope",
      revisionCounter: 0n,
      currentRevision: null,
      candidateSha256: null,
      verdictSha256: null,
    },
  ];
}

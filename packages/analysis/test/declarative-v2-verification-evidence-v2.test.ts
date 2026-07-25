import { Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObject,
  type Json,
} from "flarex-protocol/json";
import { describe, expect, test } from "vitest";

import {
  makeIncrementalCanonicalJsonByteSinkV1,
} from "../src/declarativeV2IncrementalCanonicalJsonV1";
import {
  DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2,
  createDeclarativeV2VerificationEvidenceDecoderV2,
  createDeclarativeV2VerificationEvidenceEncoderV2,
  createDeclarativeV2VerificationEvidenceSinkEncoderV2,
  makeDeclarativeV2DiagnosticEvidenceCursorV2,
  makeDeclarativeV2ImportCallEvidenceCursorV2,
  makeDeclarativeV2ModuleSummaryEvidenceCursorV2,
  makeDeclarativeV2ValueFlowEvidenceCursorV2,
  makeDeclarativeV2VerificationEvidenceBudgetV2,
  makeDeclarativeV2VerificationEvidenceFrameV2,
  makeDeclarativeV2VerificationEvidenceTextCursorV2,
  type DeclarativeV2VerificationEvidenceDecodeStepV2,
  type DeclarativeV2VerificationEvidenceEncodeStepV2,
  type DeclarativeV2VerificationEvidenceBudgetV2,
  type DeclarativeV2VerificationEvidenceFrameV2,
  type DeclarativeV2VerificationEvidenceCursorV2,
} from "../src/declarativeV2VerificationEvidenceV2";

const UTF8 = new TextEncoder();
const ITERATION_LIMIT = 1_000_000;
const LARGE_BUDGET = ownedBudget({
  maximumFrameBytes: 10_000,
  maximumCanonicalBytes: 10_000,
});

function ownedBudget(
  value: DeclarativeV2VerificationEvidenceBudgetV2,
): DeclarativeV2VerificationEvidenceBudgetV2 {
  const result = makeDeclarativeV2VerificationEvidenceBudgetV2(
    value.maximumFrameBytes,
    value.maximumCanonicalBytes,
  );
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function ownedFrame(
  value: DeclarativeV2VerificationEvidenceFrameV2,
): DeclarativeV2VerificationEvidenceFrameV2 {
  const result = value.kind === "module_summary_v2"
    ? makeDeclarativeV2VerificationEvidenceFrameV2(
      value.kind,
      value.moduleOrdinal,
      value.modulePath,
      value.sourceSha256,
      value.sourceByteLength,
      value.importCount,
      value.exportCount,
      value.functionCount,
      value.callCount,
      value.valueFlowCount,
    )
    : value.kind === "import_call_v2"
    ? makeDeclarativeV2VerificationEvidenceFrameV2(
      value.kind,
      value.moduleOrdinal,
      value.edgeOrdinal,
      value.callerFunction,
      value.targetKind,
      value.targetModulePath,
      value.targetName,
    )
    : value.kind === "value_flow_v2"
    ? makeDeclarativeV2VerificationEvidenceFrameV2(
      value.kind,
      value.moduleOrdinal,
      value.functionName,
      value.operationOrdinal,
      value.operationName,
      value.capability,
      value.catchability,
    )
    : makeDeclarativeV2VerificationEvidenceFrameV2(
      value.kind,
      value.phase,
      value.moduleOrdinal,
      value.byteOffset,
      value.diagnosticId,
      value.code,
      value.message,
    );
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

const frames: ReadonlyArray<DeclarativeV2VerificationEvidenceFrameV2> = [
  ownedFrame({
    kind: "module_summary_v2",
    moduleOrdinal: 0n,
    modulePath: "functions/example.js",
    sourceSha256: new Uint8Array(32).fill(0x11),
    sourceByteLength: 125n,
    importCount: 2n,
    exportCount: 1n,
    functionCount: 2n,
    callCount: 3n,
    valueFlowCount: 2n,
  }),
  ownedFrame({
    kind: "import_call_v2",
    moduleOrdinal: 0n,
    edgeOrdinal: 1n,
    callerFunction: "getThing",
    targetKind: "abi",
    targetModulePath: null,
    targetName: "databaseGet",
  }),
  ownedFrame({
    kind: "value_flow_v2",
    moduleOrdinal: 0n,
    functionName: "getThing",
    operationOrdinal: 0n,
    operationName: "databaseGet",
    capability: "databaseRead",
    catchability: "mixed",
  }),
  ownedFrame({
    kind: "diagnostic_v2",
    phase: "parse",
    moduleOrdinal: 0n,
    byteOffset: 17n,
    diagnosticId: 4n,
    code: "CORE_SYNTAX",
    message: "grammar production is invalid",
  }),
];

function driveEncode(
  frame: DeclarativeV2VerificationEvidenceFrameV2,
  budget: DeclarativeV2VerificationEvidenceBudgetV2 = LARGE_BUDGET,
  allowance = 17,
): Extract<
  DeclarativeV2VerificationEvidenceEncodeStepV2,
  { readonly status: "complete" }
> {
  const created = createDeclarativeV2VerificationEvidenceEncoderV2(
    frame,
    ownedBudget(budget),
  );
  if (Result.isFailure(created)) throw created.failure;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const result = created.success.step(allowance);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.mechanical.delta.transitions)
      .toBeLessThanOrEqual(allowance);
    if (result.success.status === "complete") return result.success;
  }
  throw new Error("evidence encoder stalled");
}

function textCursor(value: string) {
  let index = 0;
  const cursor = makeDeclarativeV2VerificationEvidenceTextCursorV2(
    UTF8.encode(value).byteLength,
    () => {
      if (index >= value.length) return undefined;
      const codePoint = value.codePointAt(index)!;
      index += codePoint > 0xffff ? 2 : 1;
      return codePoint;
    },
  );
  if (Result.isFailure(cursor)) throw cursor.failure;
  return cursor.success;
}

function evidenceCursor(
  frame: DeclarativeV2VerificationEvidenceFrameV2,
): DeclarativeV2VerificationEvidenceCursorV2 {
  const created = frame.kind === "module_summary_v2"
    ? makeDeclarativeV2ModuleSummaryEvidenceCursorV2(
      frame.moduleOrdinal,
      textCursor(frame.modulePath),
      frame.sourceSha256,
      frame.sourceByteLength,
      frame.importCount,
      frame.exportCount,
      frame.functionCount,
      frame.callCount,
      frame.valueFlowCount,
    )
    : frame.kind === "import_call_v2"
    ? makeDeclarativeV2ImportCallEvidenceCursorV2(
      frame.moduleOrdinal,
      frame.edgeOrdinal,
      textCursor(frame.callerFunction),
      frame.targetKind,
      frame.targetModulePath === null
        ? null
        : textCursor(frame.targetModulePath),
      textCursor(frame.targetName),
    )
    : frame.kind === "value_flow_v2"
    ? makeDeclarativeV2ValueFlowEvidenceCursorV2(
      frame.moduleOrdinal,
      textCursor(frame.functionName),
      frame.operationOrdinal,
      frame.operationName,
      frame.capability,
      frame.catchability,
    )
    : makeDeclarativeV2DiagnosticEvidenceCursorV2(
      frame.phase,
      frame.moduleOrdinal,
      frame.byteOffset,
      frame.diagnosticId,
      frame.code,
      frame.message,
    );
  if (Result.isFailure(created)) throw created.failure;
  return created.success;
}

function driveSinkEncode(
  frame: DeclarativeV2VerificationEvidenceFrameV2,
  budget: DeclarativeV2VerificationEvidenceBudgetV2 = LARGE_BUDGET,
  allowance = 17,
): Readonly<{
  readonly bytes: Uint8Array;
  readonly canonicalByteLength: number;
}> {
  const bytes: number[] = [];
  const created = createDeclarativeV2VerificationEvidenceSinkEncoderV2(
    evidenceCursor(frame),
    ownedBudget(budget),
    makeIncrementalCanonicalJsonByteSinkV1((byte, offset) => {
      expect(offset).toBe(bytes.length);
      bytes.push(byte);
    }),
  );
  if (Result.isFailure(created)) throw created.failure;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const result = created.success.step(allowance);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.mechanical.delta.transitions)
      .toBeLessThanOrEqual(allowance);
    if (result.success.status === "complete") {
      return {
        bytes: Uint8Array.from(bytes),
        canonicalByteLength: result.success.canonicalByteLength,
      };
    }
  }
  throw new Error("evidence sink encoder stalled");
}

function driveDecode(
  chunks: ReadonlyArray<Uint8Array>,
  budget: DeclarativeV2VerificationEvidenceBudgetV2 = LARGE_BUDGET,
  allowance = 17,
): Extract<
  DeclarativeV2VerificationEvidenceDecodeStepV2,
  { readonly status: "complete" }
> {
  const created = createDeclarativeV2VerificationEvidenceDecoderV2(
    ownedBudget(budget),
  );
  if (Result.isFailure(created)) throw created.failure;
  for (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const result = created.success.step(
        chunk.subarray(offset),
        allowance,
      );
      if (Result.isFailure(result)) throw result.failure;
      expect(result.success.mechanical.delta.transitions)
        .toBeLessThanOrEqual(allowance);
      offset += result.success.consumedInputBytes;
      if (
        result.success.consumedInputBytes === 0 &&
        result.success.mechanical.delta.transitions === 0
      ) {
        throw new Error("evidence decoder stalled");
      }
    }
  }
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const result = created.success.finish(allowance);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.mechanical.delta.transitions)
      .toBeLessThanOrEqual(allowance);
    if (result.success.status === "complete") return result.success;
  }
  throw new Error("evidence decoder finish stalled");
}

function decodeFailure(
  bytes: Uint8Array,
  budget: DeclarativeV2VerificationEvidenceBudgetV2 = LARGE_BUDGET,
): string {
  const created = createDeclarativeV2VerificationEvidenceDecoderV2(
    ownedBudget(budget),
  );
  if (Result.isFailure(created)) return created.failure.reason;
  let offset = 0;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const result = offset < bytes.byteLength
      ? created.success.step(bytes.subarray(offset), 19)
      : created.success.finish(19);
    if (Result.isFailure(result)) return result.failure.reason;
    offset += result.success.consumedInputBytes;
  }
  throw new Error("evidence failure case stalled");
}

describe("Declarative V2 verification evidence V2", () => {
  test("streams cursor-backed evidence with byte-exact contiguous compatibility", () => {
    for (const frame of frames) {
      const contiguous = driveEncode(frame);
      for (const allowance of [1, 19, 1_024]) {
        const streamed = driveSinkEncode(frame, LARGE_BUDGET, allowance);
        expect(streamed.bytes).toEqual(contiguous.bytes);
        expect(streamed.canonicalByteLength).toBe(contiguous.bytes.byteLength);
      }
    }
  });

  test("owns cursor authority and terminalizes identical sink defects", () => {
    const cursor = evidenceCursor(frames[1]!);
    const observed: number[] = [];
    const sink = makeIncrementalCanonicalJsonByteSinkV1((byte) => {
      observed.push(byte);
    });
    const first = createDeclarativeV2VerificationEvidenceSinkEncoderV2(
      cursor,
      LARGE_BUDGET,
      sink,
    );
    expect(Result.isSuccess(first)).toBe(true);
    expect(Result.isFailure(
      createDeclarativeV2VerificationEvidenceSinkEncoderV2(
        cursor,
        LARGE_BUDGET,
        sink,
      ),
    )).toBe(true);

    const recoverableCursor = evidenceCursor(frames[1]!);
    const rejectedSink =
      createDeclarativeV2VerificationEvidenceSinkEncoderV2(
        recoverableCursor,
        LARGE_BUDGET,
        { _tag: "IncrementalCanonicalJsonByteSinkV1" },
      );
    expect(Result.isFailure(rejectedSink)).toBe(true);
    expect(Result.isSuccess(
      createDeclarativeV2VerificationEvidenceSinkEncoderV2(
        recoverableCursor,
        LARGE_BUDGET,
        sink,
      ),
    )).toBe(true);

    const defect = new Error("evidence byte sink defect");
    const defective = createDeclarativeV2VerificationEvidenceSinkEncoderV2(
      evidenceCursor(frames[2]!),
      LARGE_BUDGET,
      makeIncrementalCanonicalJsonByteSinkV1(() => {
        throw defect;
      }),
    );
    if (Result.isFailure(defective)) throw defective.failure;
    let observedDefect: unknown;
    for (let index = 0; index < 64 && observedDefect === undefined; index += 1) {
      try {
        const stepped = defective.success.step(1);
        if (Result.isFailure(stepped)) throw stepped.failure;
      } catch (cause) {
        observedDefect = cause;
      }
    }
    expect(observedDefect).toBe(defect);
    expect(Result.isFailure(defective.success.finish(1))).toBe(true);

    const copiedCursor = { ...evidenceCursor(frames[1]!) };
    expect(Result.isFailure(
      createDeclarativeV2VerificationEvidenceSinkEncoderV2(
        copiedCursor,
        LARGE_BUDGET,
        sink,
      ),
    )).toBe(true);
    const revocable = Proxy.revocable(evidenceCursor(frames[1]!), {});
    revocable.revoke();
    expect(Result.isFailure(
      createDeclarativeV2VerificationEvidenceSinkEncoderV2(
        revocable.proxy,
        LARGE_BUDGET,
        sink,
      ),
    )).toBe(true);
  });

  test("checks cursor-backed exact and one-less frame ceilings", () => {
    const contiguous = driveEncode(frames[0]!);
    expect(driveSinkEncode(frames[0]!, {
      maximumFrameBytes: contiguous.bytes.byteLength,
      maximumCanonicalBytes: contiguous.bytes.byteLength,
    }).bytes).toEqual(contiguous.bytes);
    const output: number[] = [];
    const limited = createDeclarativeV2VerificationEvidenceSinkEncoderV2(
      evidenceCursor(frames[0]!),
      ownedBudget({
        maximumFrameBytes: contiguous.bytes.byteLength - 1,
        maximumCanonicalBytes: contiguous.bytes.byteLength,
      }),
      makeIncrementalCanonicalJsonByteSinkV1((byte) => output.push(byte)),
    );
    if (Result.isFailure(limited)) throw limited.failure;
    let failure:
      | { readonly reason: string; readonly path?: string }
      | undefined;
    for (let index = 0; index < ITERATION_LIMIT; index += 1) {
      const stepped = limited.success.step(1);
      if (Result.isFailure(stepped)) {
        failure = stepped.failure;
        break;
      }
    }
    expect(failure).toMatchObject({
      reason: "budgetExceeded",
      path: "frameBytes",
    });
    expect(output).toEqual(
      Array.from(contiguous.bytes.subarray(0, -1)),
    );
  });

  test("round-trips all frame families with owned bytes and one-step quanta", () => {
    for (const frame of frames) {
      const encoded = driveEncode(frame, LARGE_BUDGET, 1);
      const decoded = driveDecode([encoded.bytes], {
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
      }, 1);
      expect(decoded.frame).toEqual(frame);
      expect(decoded.usage).toEqual(encoded.usage);
      expect(Object.isFrozen(decoded)).toBe(true);
      if (
        decoded.frame.kind === "module_summary_v2" &&
        frame.kind === "module_summary_v2"
      ) {
        const first = decoded.frame.sourceSha256[0];
        encoded.bytes.fill(0);
        expect(decoded.frame.sourceSha256[0]).toBe(first);
      }
    }
  });

  test("is invariant across every byte split and transition allowance", () => {
    const encoded = driveEncode(frames[2]!);
    const baseline = driveDecode([encoded.bytes], LARGE_BUDGET, 1);
    for (let split = 0; split <= encoded.bytes.byteLength; split += 1) {
      for (const allowance of [1, 2, 31, 1_024]) {
        const decoded = driveDecode([
          encoded.bytes.slice(0, split),
          encoded.bytes.slice(split),
        ], LARGE_BUDGET, allowance);
        expect(decoded.frame, `${split}@${allowance}`).toEqual(baseline.frame);
        expect(decoded.usage, `${split}@${allowance}`).toEqual(baseline.usage);
        expect(decoded.mechanical.aggregate, `${split}@${allowance}`)
          .toEqual(baseline.mechanical.aggregate);
      }
    }
  });

  test("preserves unsupported-version and malformed before canonicality", () => {
    const encoded = driveEncode(frames[3]!);
    const text = new TextDecoder().decode(encoded.bytes);
    expect(decodeFailure(UTF8.encode(` ${text}`))).toBe("nonCanonical");
    expect(decodeFailure(UTF8.encode(
      text.replace(
        `"domain":"${DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2}"`,
        `"domain":"${DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2}","domain":"${DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2}"`,
      ),
    ))).toBe("nonCanonical");
    expect(decodeFailure(UTF8.encode(
      text.replace("\"version\":2", "\"version\":2,\"version\":3"),
    ))).toBe("unsupportedVersion");
    expect(decodeFailure(
      UTF8.encode(` ${text.replace("\"version\":2", "\"version\":3")}`),
    )).toBe("unsupportedVersion");
    expect(decodeFailure(UTF8.encode(" {\"future\":true}"))).toBe("malformed");
    expect(decodeFailure(UTF8.encode("[]"))).toBe("malformed");
    expect(decodeFailure(UTF8.encode("{\"nested\":{}}"))).toBe("malformed");
    expect(decodeFailure(UTF8.encode(`${text}x`))).toBe("malformed");
    expect(decodeFailure(UTF8.encode("{"))).toBe("malformed");
    expect(decodeFailure(new Uint8Array([0xc0]))).toBe("invalidUtf8");
    expect(decodeFailure(UTF8.encode(
      text.replace("\"diagnosticId\":\"4\"", "\"diagnosticId\":\"12345678901234567890\""),
    ))).toBe("malformed");
    expect(decodeFailure(UTF8.encode(
      ` ${text.replace("\"version\":2", "\"version\":3").replace(
        "grammar production is invalid",
        "\\ud800",
      )}`,
    ))).toBe("malformed");
  });

  test("rejects invalid counters, digests, kinds, fields, and aliases", () => {
    const module = frames[0]!;
    for (const invalid of [
      { ...module, moduleOrdinal: -1n },
      { ...module, sourceSha256: new Uint8Array(31) },
      { ...module, extra: true },
      { kind: "future_v3" },
    ]) {
      expect(Result.isFailure(
        createDeclarativeV2VerificationEvidenceEncoderV2(
          invalid,
          LARGE_BUDGET,
        ),
      )).toBe(true);
    }

    const digest = new Uint8Array(32).fill(3);
    Object.defineProperty(digest, Symbol.iterator, {
      value: () => {
        throw new Error("iterator must not be observed");
      },
    });
    const moduleFrame = frames[0]!;
    if (moduleFrame.kind !== "module_summary_v2") {
      throw new Error("expected module summary fixture");
    }
    const owned = ownedFrame({
      ...moduleFrame,
      sourceSha256: digest,
    });
    expect(Result.isSuccess(
      createDeclarativeV2VerificationEvidenceEncoderV2(
        owned,
        LARGE_BUDGET,
      ),
    )).toBe(true);
  });

  test("rejects canonical unknown wire fields for every frame family", () => {
    for (const frame of frames) {
      const encoded = driveEncode(frame);
      const parsed = JSON.parse(
        new TextDecoder().decode(encoded.bytes),
      ) as Json;
      if (!isJsonObject(parsed)) throw new Error("expected object frame");
      const bytes = UTF8.encode(encodeCanonicalJson({
        ...parsed,
        extra: true,
      }, () => {
        throw new Error("frame oracle received non-JSON");
      }));
      expect(decodeFailure(bytes)).toBe("malformed");
    }
  });

  test("returns exact receipts and rejects one-less ceilings", () => {
    const encoded = driveEncode(frames[1]!);
    expect(encoded.usage.frameBytes).toBe(encoded.bytes.byteLength);
    expect(encoded.usage.canonicalBytes).toBe(encoded.bytes.byteLength);
    const exact = driveDecode([encoded.bytes], {
      maximumFrameBytes: encoded.bytes.byteLength,
      maximumCanonicalBytes: encoded.bytes.byteLength,
    });
    expect(exact.usage).toEqual(encoded.usage);
    for (const key of ["maximumFrameBytes", "maximumCanonicalBytes"] as const) {
      expect(decodeFailure(encoded.bytes, {
        maximumFrameBytes: encoded.bytes.byteLength,
        maximumCanonicalBytes: encoded.bytes.byteLength,
        [key]: encoded.bytes.byteLength - 1,
      })).toBe("budgetExceeded");
    }

    const frameLimited =
      createDeclarativeV2VerificationEvidenceEncoderV2(
        frames[1]!,
        ownedBudget({
          maximumFrameBytes: encoded.bytes.byteLength - 1,
          maximumCanonicalBytes: encoded.bytes.byteLength,
        }),
      );
    if (Result.isFailure(frameLimited)) throw frameLimited.failure;
    let frameFailure:
      | { readonly reason: string; readonly path?: string }
      | undefined;
    for (let index = 0; index < ITERATION_LIMIT; index += 1) {
      const result = frameLimited.success.step(17);
      if (Result.isFailure(result)) {
        frameFailure = result.failure;
        break;
      }
    }
    expect(frameFailure).toMatchObject({
      reason: "budgetExceeded",
      path: "frameBytes",
    });
  });

  test("rejects hostile, revoked, detached, and terminal reuse", () => {
    const encoded = driveEncode(frames[1]!);
    const hostile = createDeclarativeV2VerificationEvidenceDecoderV2(
      LARGE_BUDGET,
    );
    if (Result.isFailure(hostile)) throw hostile.failure;
    expect(Result.isFailure(
      hostile.success.step(new Proxy(encoded.bytes, {}), 100),
    )).toBe(true);

    const revoked = Proxy.revocable(encoded.bytes, {});
    revoked.revoke();
    const revokedDecoder = createDeclarativeV2VerificationEvidenceDecoderV2(
      LARGE_BUDGET,
    );
    if (Result.isFailure(revokedDecoder)) throw revokedDecoder.failure;
    expect(Result.isFailure(
      revokedDecoder.success.step(revoked.proxy, 100),
    )).toBe(true);

    const reusable = createDeclarativeV2VerificationEvidenceDecoderV2(
      LARGE_BUDGET,
    );
    if (Result.isFailure(reusable)) throw reusable.failure;
    let offset = 0;
    let complete = false;
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      const result = offset < encoded.bytes.byteLength
        ? reusable.success.step(encoded.bytes.subarray(offset), 100)
        : reusable.success.finish(100);
      if (Result.isFailure(result)) throw result.failure;
      offset += result.success.consumedInputBytes;
      if (result.success.status === "complete") {
        complete = true;
        break;
      }
    }
    expect(complete).toBe(true);
    expect(Result.isFailure(reusable.success.finish(100))).toBe(true);
  });

  test("rejects an allowance above the fixed shared quantum", () => {
    const encoded = createDeclarativeV2VerificationEvidenceEncoderV2(
      frames[1]!,
      LARGE_BUDGET,
    );
    if (Result.isFailure(encoded)) throw encoded.failure;
    const encodeResult = encoded.success.step(1_025);
    expect(Result.isFailure(encodeResult)).toBe(true);

    const decoded = createDeclarativeV2VerificationEvidenceDecoderV2(
      LARGE_BUDGET,
    );
    if (Result.isFailure(decoded)) throw decoded.failure;
    const decodeResult = decoded.success.step(new Uint8Array(), 1_025);
    expect(Result.isFailure(decodeResult)).toBe(true);
  });

  test("closes step when finish begins while allowing finish to drain", () => {
    const encoded = driveEncode(frames[1]!);
    const created = createDeclarativeV2VerificationEvidenceDecoderV2(
      LARGE_BUDGET,
    );
    if (Result.isFailure(created)) throw created.failure;
    let offset = 0;
    while (offset < encoded.bytes.byteLength) {
      const result = created.success.step(
        encoded.bytes.subarray(offset),
        1_000,
      );
      if (Result.isFailure(result)) throw result.failure;
      offset += result.success.consumedInputBytes;
    }
    const begun = created.success.finish(0);
    if (Result.isFailure(begun)) throw begun.failure;
    expect(begun.success.status).toBe("pending");
    expect(Result.isFailure(
      created.success.step(new Uint8Array(), 1),
    )).toBe(true);
    let complete = false;
    for (let index = 0; index < ITERATION_LIMIT; index += 1) {
      const result = created.success.finish(1);
      if (Result.isFailure(result)) throw result.failure;
      if (result.success.status === "complete") {
        complete = true;
        break;
      }
    }
    expect(complete).toBe(true);
  });

  test("requires owned budgets and frames without enumerating hostile keys", () => {
    let ownKeysCalls = 0;
    const hostile = new Proxy({}, {
      ownKeys: () => {
        ownKeysCalls += 1;
        throw new Error("must not enumerate");
      },
    });
    expect(Result.isFailure(
      createDeclarativeV2VerificationEvidenceDecoderV2(hostile),
    )).toBe(true);
    expect(Result.isFailure(
      createDeclarativeV2VerificationEvidenceEncoderV2(
        hostile,
        LARGE_BUDGET,
      ),
    )).toBe(true);
    expect(ownKeysCalls).toBe(0);
  });

  test("snapshots caller aliases before the resumable encoder retains state", () => {
    const digest = new Uint8Array(32).fill(0x44);
    const moduleFrame = frames[0]!;
    if (moduleFrame.kind !== "module_summary_v2") {
      throw new Error("expected module summary fixture");
    }
    const owned = ownedFrame({
      ...moduleFrame,
      modulePath: "functions/original.js",
      sourceSha256: digest,
    });
    const created = createDeclarativeV2VerificationEvidenceEncoderV2(
      owned,
      LARGE_BUDGET,
    );
    if (Result.isFailure(created)) throw created.failure;
    digest.fill(0xff);
    if (owned.kind === "module_summary_v2") {
      owned.sourceSha256.fill(0xee);
    }
    let completed:
      | Extract<
        DeclarativeV2VerificationEvidenceEncodeStepV2,
        { readonly status: "complete" }
      >
      | undefined;
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      const result = created.success.step(3);
      if (Result.isFailure(result)) throw result.failure;
      if (result.success.status === "complete") {
        completed = result.success;
        break;
      }
    }
    expect(completed).toBeDefined();
    const decoded = driveDecode([completed!.bytes]);
    expect(decoded.frame.kind).toBe("module_summary_v2");
    if (decoded.frame.kind === "module_summary_v2") {
      expect(decoded.frame.modulePath).toBe("functions/original.js");
      expect(decoded.frame.sourceSha256).toEqual(
        new Uint8Array(32).fill(0x44),
      );
    }
  });
});

import { createHash } from "node:crypto";

import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1,
  DeclarativeV2VerifierRestartEvidenceV1Error,
  createDeclarativeV2VerifierRestartRecordDecoderV1,
  createDeclarativeV2VerifierRestartRecordEncoderV1,
  deriveDeclarativeV2VerifierRestartFunctionBodySha256V1,
  deriveDeclarativeV2VerifierRestartModuleOrderRootV1,
  deriveDeclarativeV2VerifierRestartRecordRootV1,
  initialDeclarativeV2VerifierRestartSequenceStateV1,
  type DeclarativeV2VerifierRestartDecodeStepV1,
  type DeclarativeV2VerifierRestartEncodeStepV1,
  type DeclarativeV2VerifierRestartRecordV1,
  type DeclarativeV2VerifierRestartSequenceStateV1,
  validateDeclarativeV2VerifierRestartRecordSequenceV1,
} from "../src/declarativeV2VerifierRestartEvidenceV1";

const generousBudget = makeBudget();

describe("Declarative V2 verifier restart evidence V1", () => {
  it("pins the token-body digest domain and iterable ownership", () => {
    const tokens = [
      { terminalId: 11, canonicalBytes: new TextEncoder().encode("return") },
      { terminalId: 7, canonicalBytes: new TextEncoder().encode("value") },
      { terminalId: 31, canonicalBytes: new TextEncoder().encode(";") },
    ];
    const first = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartFunctionBodySha256V1(
        3n,
        2n,
        3n,
        tokens,
      ),
    );
    const second = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartFunctionBodySha256V1(
        3n,
        2n,
        3n,
        {
          *[Symbol.iterator]() {
            yield* tokens;
          },
        },
      ),
    );
    expect(first).toEqual(second);
    expect(Buffer.from(first).toString("hex")).toBe(
      "7fccded9a2e92731f750120606aa14df135af274dcc769e1c403b8e00ea62ff1",
    );
    expect(Result.isFailure(
      deriveDeclarativeV2VerifierRestartFunctionBodySha256V1(
        3n,
        2n,
        2n,
        tokens,
      ),
    )).toBe(true);
    const aliased = tokens[0]!.canonicalBytes;
    const digest = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartFunctionBodySha256V1(
        3n,
        2n,
        3n,
        tokens,
      ),
    );
    aliased[0] ^= 0xff;
    expect(digest).toEqual(first);
  });
  it("pins length-framed canonical bytes and two-cold equality", () => {
    const record = records()[0]!;
    const first = encode(record, generousBudget, 1);
    const second = encode(record, generousBudget, 1_024);
    expect(first.canonicalBytes).toEqual(second.canonicalBytes);
    expect(first.canonicalBytes.byteLength).toBe(
      new DataView(
        first.canonicalBytes.buffer,
        first.canonicalBytes.byteOffset,
        4,
      ).getUint32(0, false) + 4,
    );
    expect(first.canonicalBytes.buffer.byteLength).toBe(
      first.canonicalBytes.byteLength,
    );
    expect(
      createHash("sha256").update(first.canonicalBytes).digest("hex"),
    ).toBe("6d877ee317886524c557292e7b32b1697b2dda26cc8572b26173275415faa714");
    expect(first.record).toEqual(record);
    expect(DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1).toBe(
      "flarex.declarative-v2/verifier-restart-evidence/v1",
    );
  });

  it("round-trips every restart record and every byte split", () => {
    for (const record of records()) {
      const encoded = encode(record, generousBudget, 1_024);
      expect(decode(encoded.canonicalBytes, generousBudget, 1_024).record).toEqual(
        record,
      );
    }
    const encoded = encode(records()[0]!, generousBudget, 1_024);
    const oracle = decode(
      encoded.canonicalBytes,
      generousBudget,
      1_024,
    );
    for (
      let boundary = 0;
      boundary <= encoded.canonicalBytes.byteLength;
      boundary += 1
    ) {
      const decoded = decodeChunks(
        [
          encoded.canonicalBytes.subarray(0, boundary),
          encoded.canonicalBytes.subarray(boundary),
        ],
        generousBudget,
        1,
      );
      expect(decoded.record).toEqual(records()[0]);
      expect(decoded.receipt.aggregate).toEqual(oracle.receipt.aggregate);
    }
  }, 30_000);

  it("enforces allowance, terminal reuse, hostile capture, and owned bytes", () => {
    const record = records()[0]!;
    const encoder = Result.getOrThrow(
      createDeclarativeV2VerifierRestartRecordEncoderV1(
        record,
        generousBudget,
      ),
    );
    expect(Result.getOrThrow(encoder.step(0)).status).toBe("pending");
    expect(Result.isFailure(encoder.step(1_025))).toBe(true);
    expect(Result.isFailure(encoder.finish(1))).toBe(true);

    const encoded = encode(record, generousBudget, 1_024).canonicalBytes;
    const zeroDecoder = Result.getOrThrow(
      createDeclarativeV2VerifierRestartRecordDecoderV1(generousBudget),
    );
    expect(Result.getOrThrow(zeroDecoder.push(encoded, 0))).toMatchObject({
      status: "pending",
      consumedInputBytes: 0,
    });
    expect(Result.isFailure(zeroDecoder.push(encoded, 1_025))).toBe(true);
    expect(Result.isFailure(zeroDecoder.finish(1))).toBe(true);
    const hostileDecoder = Result.getOrThrow(
      createDeclarativeV2VerifierRestartRecordDecoderV1(generousBudget),
    );
    expect(Result.isFailure(
      hostileDecoder.push(new Proxy(encoded, {}), 1),
    )).toBe(true);
    const completedDecoder = Result.getOrThrow(
      createDeclarativeV2VerifierRestartRecordDecoderV1(generousBudget),
    );
    let offset = 0;
    while (offset < encoded.byteLength) {
      const pushed = Result.getOrThrow(
        completedDecoder.push(encoded.subarray(offset), 1_024),
      );
      offset += pushed.consumedInputBytes;
    }
    let complete = Result.getOrThrow(completedDecoder.finish(1_024));
    while (complete.status === "pending") {
      complete = Result.getOrThrow(completedDecoder.finish(1_024));
    }
    expect(Result.isFailure(completedDecoder.finish(1))).toBe(true);

    const hostile = {
      ...record,
      get modulePath() {
        throw new Error("must not run");
      },
    };
    expect(Result.isFailure(
      createDeclarativeV2VerifierRestartRecordEncoderV1(
        hostile,
        generousBudget,
      ),
    )).toBe(true);
    const proxy = new Proxy(record, {
      ownKeys() {
        throw new Error("hostile");
      },
    });
    expect(Result.isFailure(
      createDeclarativeV2VerifierRestartRecordEncoderV1(proxy, generousBudget),
    )).toBe(true);
    const digest = bytes(1);
    const ownedRecord = moduleRecord({ sourceSha256: digest });
    const result = encode(ownedRecord, generousBudget, 1_024);
    digest[0] = 99;
    expect(result.record.kind).toBe("module_identity_v1");
    if (result.record.kind !== "module_identity_v1") {
      throw new Error("Expected module identity.");
    }
    expect(result.record.sourceSha256[0]).toBe(1);

    const detached = bytes(2);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(
      createDeclarativeV2VerifierRestartRecordEncoderV1(
        moduleRecord({ sourceSha256: detached }),
        generousBudget,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      createDeclarativeV2VerifierRestartRecordEncoderV1(
        record,
        makeBudget({ frameBytes: 9_223_372_036_854_775_807n }),
      ),
    )).toBe(true);
  });

  it("rejects malformed, truncated, trailing, noncanonical, and invalid UTF-8 bytes", () => {
    const encoded = encode(records()[0]!, generousBudget, 1_024).canonicalBytes;
    for (let boundary = 0; boundary < encoded.byteLength; boundary += 1) {
      expect(() =>
        decode(encoded.subarray(0, boundary), generousBudget, 1)
      ).toThrow();
    }
    expect(() =>
      decode(concat(encoded, new Uint8Array([0])), generousBudget, 1)
    ).toThrow();

    const noncanonicalPayload = new TextEncoder().encode(
      `{"version":1,"kind":"module_identity_v1","domain":"${DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1}"}`,
    );
    expect(() =>
      decode(frame(noncanonicalPayload), generousBudget, 1)
    ).toThrow();

    const invalidUtf8 = new Uint8Array(encoded);
    invalidUtf8[4] = 0xff;
    expect(() => decode(invalidUtf8, generousBudget, 1)).toThrow();
    for (
      const payload of [
        "[]",
        "null",
        `{"domain":"${DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1}","kind":{"nested":true},"version":1}`,
      ]
    ) {
      expect(() => decode(
        frame(new TextEncoder().encode(payload)),
        generousBudget,
        1,
      )).toThrow(DeclarativeV2VerifierRestartEvidenceV1Error);
    }
  });

  it("charges every touched dimension exactly and rejects one-less ceilings", () => {
    const encoded = encode(records()[0]!, generousBudget, 1);
    const encodeTouched = touched(encoded.receipt.aggregate);
    for (const dimension of encodeTouched) {
      const exact = makeBudget({
        [dimension]: encoded.receipt.aggregate[dimension],
      });
      expect(() => encode(records()[0]!, exact, 1)).not.toThrow();
      if (encoded.receipt.aggregate[dimension] > 0n) {
        const oneLess = makeBudget({
          [dimension]: encoded.receipt.aggregate[dimension] - 1n,
        });
        expect(() => encode(records()[0]!, oneLess, 1)).toThrow();
      }
    }

    const decoded = decode(encoded.canonicalBytes, generousBudget, 1);
    for (const dimension of touched(decoded.receipt.aggregate)) {
      const exact = makeBudget({
        [dimension]: decoded.receipt.aggregate[dimension],
      });
      expect(() => decode(encoded.canonicalBytes, exact, 1)).not.toThrow();
      if (decoded.receipt.aggregate[dimension] > 0n) {
        const oneLess = makeBudget({
          [dimension]: decoded.receipt.aggregate[dimension] - 1n,
        });
        expect(() => decode(encoded.canonicalBytes, oneLess, 1)).toThrow();
      }
    }
  });

  it("pre-admits semantic counters and pins domain-separated restart roots", () => {
    expect(Result.isFailure(
      createDeclarativeV2VerifierRestartRecordEncoderV1(
        records()[0]!,
        makeBudget({ modules: 0n }),
      ),
    )).toBe(true);
    const encoded = encode(records()[0]!, generousBudget, 1);
    expect(() =>
      decode(encoded.canonicalBytes, makeBudget({ modules: 0n }), 1)
    ).toThrow(DeclarativeV2VerifierRestartEvidenceV1Error);

    const diagnostic = records()[6]!;
    const diagnosticEncoded = encode(
      diagnostic,
      makeBudget({ objectBodyBytes: 0n }),
      1,
    );
    expect(diagnosticEncoded.receipt.aggregate.objectBodyBytes).toBe(0n);
    expect(diagnosticEncoded.receipt.aggregate.diagnosticBytes).toBe(
      BigInt(diagnosticEncoded.canonicalBytes.byteLength),
    );
    expect(() =>
      encode(
        diagnostic,
        makeBudget({
          objectBodyBytes: 0n,
          diagnosticBytes:
            diagnosticEncoded.receipt.aggregate.diagnosticBytes,
        }),
        1,
      )
    ).not.toThrow();
    expect(() =>
      encode(
        diagnostic,
        makeBudget({
          objectBodyBytes: 0n,
          diagnosticBytes:
            diagnosticEncoded.receipt.aggregate.diagnosticBytes - 1n,
        }),
        1,
      )
    ).toThrow(DeclarativeV2VerifierRestartEvidenceV1Error);
    const diagnosticDecoded = decode(
      diagnosticEncoded.canonicalBytes,
      generousBudget,
      1,
    );
    expect(diagnosticDecoded.receipt.aggregate.diagnosticBytes).toBe(
      BigInt(diagnosticEncoded.canonicalBytes.byteLength),
    );
    expect(() =>
      decode(
        diagnosticEncoded.canonicalBytes,
        makeBudget({
          diagnosticBytes:
            diagnosticDecoded.receipt.aggregate.diagnosticBytes - 1n,
        }),
        1,
      )
    ).toThrow(DeclarativeV2VerifierRestartEvidenceV1Error);

    const initial = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1("parse_module"),
    );
    const recordDigest = recordSha256(records()[0]!);
    const derived = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartRecordRootV1(
        "parse_module",
        0n,
        initial.precedingRecordsRootSha256,
        recordDigest,
      ),
    );
    const preimage = concatMany([
      new TextEncoder().encode(
        "flarex.declarative-v2/verifier-restart-root/step/v1\0",
      ),
      new Uint8Array([1]),
      u64(0n),
      initial.precedingRecordsRootSha256,
      recordDigest,
    ]);
    expect(derived).toEqual(
      new Uint8Array(createHash("sha256").update(preimage).digest()),
    );
    expect(
      advanceSequence(initial, records()[0]!).precedingRecordsRootSha256,
    ).toEqual(derived);

    const linkInitial = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1(
        "link_page",
        bytes(6),
      ),
    );
    const order = { ...records()[8]!, recordOrdinal: 0n };
    const orderDigest = recordSha256(order);
    const orderRoot = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartModuleOrderRootV1(
        0n,
        linkInitial.moduleOrderRootSha256,
        orderDigest,
      ),
    );
    const linkAfterOrder = advanceSequence(linkInitial, order);
    expect(linkAfterOrder.moduleOrderRootSha256).toEqual(orderRoot);
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        linkAfterOrder,
        { ...records()[9]!, recordOrdinal: 1n },
        recordSha256({ ...records()[9]!, recordOrdinal: 1n }),
      ),
    )).toBe(true);
  });

  it("fails closed before every signed-int64 sequence counter wraps", () => {
    const parseInitial = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1("parse_module"),
    );
    const afterModule = advanceSequence(parseInitial, records()[0]!);
    const maximum = 9_223_372_036_854_775_807n;
    const parseCases: readonly [
      keyof typeof afterModule,
      DeclarativeV2VerifierRestartRecordV1,
    ][] = [
      [
        "importCount",
        { ...records()[1]!, recordOrdinal: 1n, importOrdinal: maximum },
      ],
      [
        "exportCount",
        { ...records()[2]!, recordOrdinal: 1n, exportOrdinal: maximum },
      ],
      [
        "functionCount",
        { ...records()[3]!, recordOrdinal: 1n, functionOrdinal: maximum },
      ],
      [
        "callCount",
        { ...records()[4]!, recordOrdinal: 1n, callOrdinal: maximum },
      ],
      [
        "valueFlowCount",
        { ...records()[5]!, recordOrdinal: 1n, flowOrdinal: maximum },
      ],
      [
        "diagnosticCount",
        {
          ...records()[6]!,
          recordOrdinal: 1n,
          diagnosticOrdinal: maximum,
        },
      ],
    ];
    for (const [counter, record] of parseCases) {
      const state = { ...afterModule, [counter]: maximum };
      const result = validateDeclarativeV2VerifierRestartRecordSequenceV1(
        state,
        record,
        recordSha256(record),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.path).toBe(counter);
    }

    const linkInitial = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1(
        "link_page",
        bytes(6),
      ),
    );
    const linkCases: readonly [
      "edgeCount" | "orderCount" | "moduleCount",
      DeclarativeV2VerifierRestartRecordV1,
    ][] = [
      [
        "edgeCount",
        { ...records()[7]!, recordOrdinal: 0n, edgeOrdinal: maximum },
      ],
      [
        "orderCount",
        { ...records()[8]!, recordOrdinal: 0n, orderOrdinal: maximum },
      ],
      [
        "moduleCount",
        { ...records()[8]!, recordOrdinal: 0n, orderOrdinal: 0n },
      ],
    ];
    for (const [counter, record] of linkCases) {
      const state = { ...linkInitial, [counter]: maximum };
      const result = validateDeclarativeV2VerifierRestartRecordSequenceV1(
        state,
        record,
        recordSha256(record),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.path).toBe(counter);
    }
  });

  it("fails parse record gaps, duplicates, phase drift, and terminal count drift", () => {
    let state = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1("parse_module"),
    );
    const ordered = [
      records()[0]!,
      records()[1]!,
      records()[2]!,
      records()[3]!,
      records()[4]!,
      records()[5]!,
      records()[6]!,
    ];
    for (const record of ordered) {
      state = advanceSequence(state, record);
    }
    const terminal = {
      ...records()[10]!,
      precedingRecordsRootSha256: state.precedingRecordsRootSha256,
    };
    state = advanceSequence(state, terminal);
    expect(state.terminal).toBe(true);
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        state,
        ordered[0],
        recordSha256(ordered[0]!),
      ),
    )).toBe(true);

    const initial = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1("parse_module"),
    );
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        initial,
        { ...records()[0]!, recordOrdinal: 1n },
        recordSha256({ ...records()[0]!, recordOrdinal: 1n }),
      ),
    )).toBe(true);
    const afterModule = advanceSequence(initial, records()[0]!);
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        afterModule,
        records()[2]!,
        recordSha256(records()[2]!),
      ),
    )).toBe(true);
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        afterModule,
        { ...records()[6]!, recordOrdinal: 1n, phase: "link" },
        recordSha256({ ...records()[6]!, recordOrdinal: 1n, phase: "link" }),
      ),
    )).toBe(true);
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        afterModule,
        { ...records()[10]!, recordOrdinal: 1n },
        recordSha256({ ...records()[10]!, recordOrdinal: 1n }),
      ),
    )).toBe(true);
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        afterModule,
        {
          ...records()[10]!,
          recordOrdinal: 1n,
          importCount: 0n,
          exportCount: 0n,
          functionCount: 0n,
          callCount: 0n,
          valueFlowCount: 0n,
          diagnosticCount: 0n,
          sourceSha256: bytes(99),
        },
        recordSha256({
          ...records()[10]!,
          recordOrdinal: 1n,
          importCount: 0n,
          exportCount: 0n,
          functionCount: 0n,
          callCount: 0n,
          valueFlowCount: 0n,
          diagnosticCount: 0n,
          sourceSha256: bytes(99),
        }),
      ),
    )).toBe(true);
    const wrongAuthenticatedInput = {
      ...records()[10]!,
      recordOrdinal: 1n,
      importCount: 0n,
      exportCount: 0n,
      functionCount: 0n,
      callCount: 0n,
      valueFlowCount: 0n,
      diagnosticCount: 0n,
      authenticatedInputSha256: bytes(98),
      precedingRecordsRootSha256: afterModule.precedingRecordsRootSha256,
    };
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        afterModule,
        wrongAuthenticatedInput,
        recordSha256(wrongAuthenticatedInput),
      ),
    )).toBe(true);
  });

  it("fails link ordering and proves deterministic cycle/order terminal counts", () => {
    let state = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1(
        "link_page",
        bytes(6),
      ),
    );
    state = advanceSequence(state, records()[7]!);
    state = advanceSequence(state, records()[8]!);
    state = advanceSequence(state, {
      ...records()[9]!,
      membersRootSha256: state.moduleOrderRootSha256,
    });
    state = advanceSequence(state, {
      ...records()[11]!,
      precedingRecordsRootSha256: state.precedingRecordsRootSha256,
    });
    expect(state.terminal).toBe(true);
    const initial = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1(
        "link_page",
        bytes(6),
      ),
    );
    const firstOrder = { ...records()[8]!, recordOrdinal: 0n };
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        initial,
        firstOrder,
        recordSha256(firstOrder),
      ),
    )).toBe(false);
    const afterOrder = advanceSequence(initial, firstOrder);
    const lateEdge = { ...records()[7]!, recordOrdinal: 1n };
    expect(Result.isFailure(
      validateDeclarativeV2VerifierRestartRecordSequenceV1(
        afterOrder,
        lateEdge,
        recordSha256(lateEdge),
      ),
    )).toBe(true);
  });

  it("exposes restart contracts only through the intentional private verifier owner", async () => {
    const root = await import("../src/index");
    const privateVerifier = await import("../src/declarativeV2VerifierV1");
    expect(root).not.toHaveProperty(
      "createDeclarativeV2VerifierRestartRecordEncoderV1",
    );
    expect(privateVerifier).toHaveProperty(
      "createDeclarativeV2VerifierRestartRecordEncoderV1",
    );
  });
});

function moduleRecord(
  overrides: Partial<Extract<
    DeclarativeV2VerifierRestartRecordV1,
    { readonly kind: "module_identity_v1" }
  >> = {},
): Extract<
  DeclarativeV2VerifierRestartRecordV1,
  { readonly kind: "module_identity_v1" }
> {
  return {
    kind: "module_identity_v1",
    recordOrdinal: 0n,
    moduleOrdinal: 0n,
    modulePath: "functions/example.js",
    sourceSha256: bytes(1),
    sourceByteLength: 123n,
    authenticatedInputSha256: bytes(2),
    ...overrides,
  };
}

function records() {
  return [
    moduleRecord(),
    {
      kind: "static_import_v1",
      recordOrdinal: 1n,
      moduleOrdinal: 0n,
      importOrdinal: 0n,
      sourceModulePath: "shared/value.js",
      importedName: "value",
      localName: "value",
    },
    {
      kind: "export_binding_v1",
      recordOrdinal: 2n,
      moduleOrdinal: 0n,
      exportOrdinal: 0n,
      exportName: "run",
      localFunctionName: "run",
    },
    {
      kind: "function_v1",
      recordOrdinal: 3n,
      moduleOrdinal: 0n,
      functionOrdinal: 0n,
      functionName: "run",
      async: true,
      parameterCount: 1n,
      bodySha256: bytes(3),
    },
    {
      kind: "direct_call_v1",
      recordOrdinal: 4n,
      moduleOrdinal: 0n,
      callOrdinal: 0n,
      callerFunctionOrdinal: 0n,
      targetKind: "artifactImport",
      targetModulePath: "shared/value.js",
      targetName: "value",
    },
    {
      kind: "value_flow_v1",
      recordOrdinal: 5n,
      moduleOrdinal: 0n,
      flowOrdinal: 0n,
      functionOrdinal: 0n,
      operationName: "db.get",
      capability: "databaseRead",
      catchability: "application",
    },
    {
      kind: "diagnostic_v1",
      recordOrdinal: 6n,
      phase: "parse",
      moduleOrdinal: 0n,
      diagnosticOrdinal: 0n,
      byteOffset: 7n,
      diagnosticId: 11n,
      code: "FXV2001",
      message: "accepted diagnostic",
    },
    {
      kind: "resolved_edge_v1",
      recordOrdinal: 0n,
      edgeOrdinal: 0n,
      sourceModuleOrdinal: 0n,
      importOrdinal: 0n,
      targetKind: "module",
      targetModuleOrdinal: 1n,
      targetFunctionOrdinal: 0n,
      targetName: "value",
    },
    {
      kind: "module_order_v1",
      recordOrdinal: 1n,
      orderOrdinal: 0n,
      moduleOrdinal: 0n,
    },
    {
      kind: "cycle_result_v1",
      recordOrdinal: 2n,
      cycleOrdinal: 0n,
      moduleCount: 1n,
      membersRootSha256: bytes(4),
      accepted: true,
    },
    {
      kind: "parse_terminal_v1",
      recordOrdinal: 7n,
      moduleOrdinal: 0n,
      importCount: 1n,
      exportCount: 1n,
      functionCount: 1n,
      callCount: 1n,
      valueFlowCount: 1n,
      diagnosticCount: 1n,
      sourceSha256: bytes(1),
      authenticatedInputSha256: bytes(2),
      precedingRecordsRootSha256: bytes(5),
    },
    {
      kind: "link_terminal_v1",
      recordOrdinal: 3n,
      moduleCount: 1n,
      edgeCount: 1n,
      orderCount: 1n,
      cycleCount: 1n,
      diagnosticCount: 0n,
      parsePagesRootSha256: bytes(6),
      precedingRecordsRootSha256: bytes(7),
    },
  ] as const satisfies readonly DeclarativeV2VerifierRestartRecordV1[];
}

function recordSha256(
  record: DeclarativeV2VerifierRestartRecordV1,
): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update(encode(record, generousBudget, 1_024).canonicalBytes)
      .digest(),
  );
}

function advanceSequence(
  state: DeclarativeV2VerifierRestartSequenceStateV1,
  record: DeclarativeV2VerifierRestartRecordV1,
): DeclarativeV2VerifierRestartSequenceStateV1 {
  return Result.getOrThrow(
    validateDeclarativeV2VerifierRestartRecordSequenceV1(
      state,
      record,
      recordSha256(record),
    ),
  );
}

function u64(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return output;
}

function concatMany(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function makeBudget(
  overrides: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>> = {},
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
        dimension,
        100_000n,
      ]),
    ),
    ...overrides,
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function encode(
  record: DeclarativeV2VerifierRestartRecordV1,
  budget: DeclarativeV2VerifierBudgetFrameV2,
  allowance: number,
): Extract<DeclarativeV2VerifierRestartEncodeStepV1, { status: "complete" }> {
  const encoder = Result.getOrThrow(
    createDeclarativeV2VerifierRestartRecordEncoderV1(record, budget),
  );
  for (let index = 0; index < 1_000_000; index += 1) {
    const result = Result.getOrThrow(encoder.finish(allowance));
    if (result.status === "complete") return result;
  }
  throw new Error("encoder iteration ceiling");
}

function decode(
  bytes: Uint8Array,
  budget: DeclarativeV2VerifierBudgetFrameV2,
  allowance: number,
): Extract<DeclarativeV2VerifierRestartDecodeStepV1, { status: "complete" }> & {
  readonly record: DeclarativeV2VerifierRestartRecordV1;
} {
  return decodeChunks([bytes], budget, allowance);
}

function decodeChunks(
  chunks: readonly Uint8Array[],
  budget: DeclarativeV2VerifierBudgetFrameV2,
  allowance: number,
): Extract<DeclarativeV2VerifierRestartDecodeStepV1, { status: "complete" }> & {
  readonly record: DeclarativeV2VerifierRestartRecordV1;
} {
  const decoder = Result.getOrThrow(
    createDeclarativeV2VerifierRestartRecordDecoderV1(budget),
  );
  for (const chunk of chunks) {
    let offset = 0;
    let idle = 0;
    while (offset < chunk.byteLength) {
      const result = Result.getOrThrow(
        decoder.push(chunk.subarray(offset), allowance),
      );
      offset += result.consumedInputBytes;
      idle = result.consumedInputBytes === 0 ? idle + 1 : 0;
      if (idle > 1_000_000) throw new Error("decoder push iteration ceiling");
    }
  }
  for (let index = 0; index < 1_000_000; index += 1) {
    const result = Result.getOrThrow(decoder.finish(allowance));
    if (result.status === "complete" && result.record !== undefined) {
      return result as Extract<
        DeclarativeV2VerifierRestartDecodeStepV1,
        { status: "complete" }
      > & { readonly record: DeclarativeV2VerifierRestartRecordV1 };
    }
  }
  throw new Error("decoder finish iteration ceiling");
}

function touched(
  usage: DeclarativeV2VerifierBudgetFrameV2,
): readonly DeclarativeV2VerifierBudgetDimensionV2[] {
  return DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.filter(
    (dimension) => usage[dimension] > 0n,
  );
}

function bytes(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function frame(payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(4 + payload.byteLength);
  new DataView(output.buffer).setUint32(0, payload.byteLength, false);
  output.set(payload, 4);
  return output;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

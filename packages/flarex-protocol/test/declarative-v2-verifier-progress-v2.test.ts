import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
} from "../src/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_EVIDENCE_PAGE_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  requireDeclarativeV2VerifierProtocolIdentitiesV2,
  validateDeclarativeV2VerifierEvidencePageTransitionV2,
  validateDeclarativeV2VerifierFinalEvidencePageV2,
} from "../src/declarative-v2-verifier-progress-v2";

const budget = Object.freeze({
  maximumFrameBytes: 10_000,
  maximumCanonicalBytes: 0,
});
const PERSISTABLE_U64_MAX = DECLARATIVE_V2_MAX_SIGNED_INT64_V1;

describe("Declarative V2 verifier Budget/Progress V2", () => {
  it("pins the 26-dimension budget frame with an independent oracle", async () => {
    const values = Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
        (dimension, index) => [dimension, BigInt(index + 1)],
      ),
    );
    const frame = { kind: "attempt_ceilings", ...values };
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(frame, budget),
    );
    const expected = concat(
      utf8("flarex.declarative-v2/attempt_ceilings/v2\0"),
      u32(26),
      ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
        (dimension) => u64(values[dimension]!),
      ),
    );
    expect(encoded.canonicalBytes).toEqual(expected);
    expect(hex(await sha256(expected))).toBe(
      "a2cad26e067b7c7df1175ba16aef3f5c58b03799f4766629ac976db4ad0b2898",
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2VerifierProgressFrameV2(expected, {
        maximumFrameBytes: expected.byteLength,
        maximumCanonicalBytes: 0,
      }),
    ).frame).toEqual(frame);
    expect(Result.isFailure(
      encodeDeclarativeV2VerifierProgressFrameV2(frame, {
        maximumFrameBytes: expected.byteLength - 1,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
  });

  it("preserves every pre-existing V2 frame byte layout", () => {
    const values = Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
        (dimension, index) => [dimension, BigInt(index + 1)],
      ),
    );
    for (const kind of [
      "attempt_ceilings",
      "attempt_usage",
      "command_budget",
    ] as const) {
      expect(Result.getOrThrow(
        encodeDeclarativeV2VerifierProgressFrameV2(
          { kind, ...values },
          budget,
        ),
      ).canonicalBytes).toEqual(concat(
        utf8(`flarex.declarative-v2/${kind}/v2\0`),
        u32(26),
        ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
          (dimension) => u64(values[dimension]!),
        ),
      ));
    }

    expect(Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "attempt_identity",
        candidateSha256: digest(1),
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        ceilingsSha256: digest(2),
      }, budget),
    ).canonicalBytes).toEqual(concat(
      utf8("flarex.declarative-v2/attempt_identity/v2\0"),
      u32(4),
      digest(1),
      sizedUtf8(DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2),
      sizedUtf8(DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2),
      digest(2),
    ));

    expect(Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "registration",
        settledSequence: 1n,
        moduleOrdinal: 2n,
        edgeOrdinal: 3n,
        pageOrdinal: 4n,
        previousReceiptSha256: digest(5),
      }, budget),
    ).canonicalBytes).toEqual(concat(
      utf8("flarex.declarative-v2/progress_cursor/v2\0"),
      u32(6),
      new Uint8Array([4]),
      u64(1n),
      u64(2n),
      u64(3n),
      u64(4n),
      new Uint8Array([1]),
      digest(5),
    ));
  });

  it("pins portable durable-command reservation, output, and receipt frames", async () => {
    const reservationFrame = makeReservation();
    const reservation = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(reservationFrame, budget),
    );
    const expectedReservation = concat(
      utf8("flarex.declarative-v2/command_reservation/v2\0"),
      u32(12),
      digest(1),
      digest(2),
      new Uint8Array([1]),
      u64(1n),
      digest(3),
      new Uint8Array([1]),
      digest(4),
      digest(5),
      digest(6),
      digest(7),
      digest(8),
      digest(9),
      digest(10),
    );
    expect(reservation.canonicalBytes).toEqual(expectedReservation);
    expect(hex(await sha256(expectedReservation))).toBe(
      "3e88ee2756098c3e498b6755dd038a2f18408a1e2de490e4dc68557fd2d05ca3",
    );

    const outputFrame = makeOutputManifest();
    const output = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(outputFrame, budget),
    );
    const expectedOutput = concat(
      utf8("flarex.declarative-v2/command_output_manifest/v2\0"),
      u32(8),
      digest(11),
      new Uint8Array([2]),
      u64(2n),
      digest(12),
      u64(3n),
      digest(13),
      u64(4n),
      digest(14),
    );
    expect(output.canonicalBytes).toEqual(expectedOutput);
    expect(hex(await sha256(expectedOutput))).toBe(
      "5c18284515047ee22da29b8309b367483482eb477e849a6f9fd56dca2eebddf6",
    );

    const receiptFrame = makeReceipt();
    const receipt = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(receiptFrame, budget),
    );
    const expectedReceipt = concat(
      utf8("flarex.declarative-v2/command_receipt/v2\0"),
      u32(5),
      digest(15),
      digest(16),
      digest(17),
      digest(18),
      digest(19),
    );
    expect(receipt.canonicalBytes).toEqual(expectedReceipt);
    expect(hex(await sha256(expectedReceipt))).toBe(
      "342e9053db2a4e7b9fa63a6e587c0092ca0b61612946ee682572982d46973e92",
    );

    for (const encoded of [reservation, output, receipt]) {
      const first = Result.getOrThrow(
        decodeDeclarativeV2VerifierProgressFrameV2(
          encoded.canonicalBytes,
          budget,
        ),
      );
      const second = Result.getOrThrow(
        decodeDeclarativeV2VerifierProgressFrameV2(
          encoded.canonicalBytes,
          budget,
        ),
      );
      expect(first.frame).toEqual(encoded.frame);
      expect(second.frame).toEqual(first.frame);
      expect(second.canonicalBytes).toEqual(first.canonicalBytes);
      expect(second.canonicalBytes).not.toBe(first.canonicalBytes);
    }
    expect(Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(
        makeReservation({ predecessorReceiptSha256: null }),
        budget,
      ),
    ).frame).toEqual(makeReservation({ predecessorReceiptSha256: null }));

    const reverseOrder = Object.fromEntries(
      Object.entries(reservationFrame).reverse(),
    );
    expect(Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(reverseOrder, budget),
    ).canonicalBytes).toEqual(reservation.canonicalBytes);
  });

  it("pins the separate portable restart evidence-page manifest domain", async () => {
    expect(DECLARATIVE_V2_VERIFIER_EVIDENCE_PAGE_PROTOCOL_IDENTITY_V2).toBe(
      "flarex.declarative-v2/verifier-evidence-page/v2",
    );
    const frame = makeEvidencePage();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(frame, budget),
    );
    const expected = concat(
      utf8("flarex.declarative-v2/evidence_page_manifest/v2\0"),
      u32(12),
      digest(21),
      new Uint8Array([1]),
      u64(3n),
      u64(0n),
      u64(0n),
      u64(2n),
      u64(0n),
      u64(1n),
      new Uint8Array([0]),
      u64(37n),
      digest(22),
      digest(23),
    );
    expect(encoded.canonicalBytes).toEqual(expected);
    expect(hex(await sha256(expected))).toBe(
      "209a63640c5bf05b9f31112d955b9d06c395d63e0b67c7001c2404d84c4043e8",
    );
    const first = Result.getOrThrow(
      decodeDeclarativeV2VerifierProgressFrameV2(expected, {
        maximumFrameBytes: expected.byteLength,
        maximumCanonicalBytes: 0,
      }),
    );
    const second = Result.getOrThrow(
      decodeDeclarativeV2VerifierProgressFrameV2(expected, budget),
    );
    expect(first.frame).toEqual(frame);
    expect(second.frame).toEqual(first.frame);
    expect(second.canonicalBytes).toEqual(first.canonicalBytes);
    expect(second.canonicalBytes).not.toBe(first.canonicalBytes);
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(expected, {
        maximumFrameBytes: expected.byteLength - 1,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
  });

  it("rejects restart page gaps, overlaps, predecessor drift, and final-root drift", async () => {
    const first = makeEvidencePage();
    const firstBytes = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(first, budget),
    ).canonicalBytes;
    const firstSha256 = await sha256(firstBytes);
    const second = makeEvidencePage({
      pageOrdinal: 1n,
      firstEvidenceOrdinal: 2n,
      evidenceCount: 3n,
      firstDiagnosticOrdinal: 1n,
      diagnosticCount: 2n,
      predecessorPageSha256: firstSha256,
      payloadByteLength: 51n,
      payloadSha256: digest(24),
      cumulativeDiagnosticsRootSha256: digest(25),
    });
    expect(Result.isSuccess(
      validateDeclarativeV2VerifierEvidencePageTransitionV2(
        first,
        firstSha256,
        second,
      ),
    )).toBe(true);
    for (const malformed of [
      makeEvidencePage({ ...second, pageOrdinal: 2n }),
      makeEvidencePage({ ...second, firstEvidenceOrdinal: 1n }),
      makeEvidencePage({ ...second, firstEvidenceOrdinal: 3n }),
      makeEvidencePage({ ...second, firstDiagnosticOrdinal: 0n }),
      makeEvidencePage({ ...second, firstDiagnosticOrdinal: 2n }),
      makeEvidencePage({ ...second, predecessorPageSha256: digest(99) }),
      makeEvidencePage({ ...second, reservationSha256: digest(98) }),
      makeEvidencePage({ ...second, sequence: 4n }),
      makeEvidencePage({ ...second, commandKind: "link_page" }),
    ]) {
      expect(Result.isFailure(
        validateDeclarativeV2VerifierEvidencePageTransitionV2(
          first,
          firstSha256,
          malformed,
        ),
      )).toBe(true);
    }

    const secondSha256 = await sha256(
      Result.getOrThrow(
        encodeDeclarativeV2VerifierProgressFrameV2(second, budget),
      ).canonicalBytes,
    );
    const output = makeOutputManifest({
      reservationSha256: digest(21),
      commandKind: "parse_module",
      sequence: 3n,
      evidenceRootSha256: secondSha256,
      evidenceCount: 5n,
      diagnosticsRootSha256: digest(25),
      diagnosticCount: 3n,
    });
    expect(Result.isSuccess(
      validateDeclarativeV2VerifierFinalEvidencePageV2(
        second,
        secondSha256,
        output,
      ),
    )).toBe(true);
    for (const malformed of [
      makeOutputManifest({ ...output, evidenceRootSha256: digest(88) }),
      makeOutputManifest({ ...output, evidenceCount: 4n }),
      makeOutputManifest({ ...output, diagnosticCount: 2n }),
      makeOutputManifest({ ...output, diagnosticsRootSha256: digest(87) }),
    ]) {
      expect(Result.isFailure(
        validateDeclarativeV2VerifierFinalEvidencePageV2(
          second,
          secondSha256,
          malformed,
        ),
      )).toBe(true);
    }
  });

  it("rejects empty, noncontiguous, overflowing, or non-restart evidence pages", () => {
    expectEncodeInvalid(makeEvidencePage({ commandKind: "source_page" as "parse_module" }));
    expectEncodeInvalid(makeEvidencePage({ commandKind: "registration_page" as "parse_module" }));
    expectEncodeInvalid(makeEvidencePage({ commandKind: "finalize" as "parse_module" }));
    expectEncodeInvalid(makeEvidencePage({ sequence: 0n }));
    expectEncodeInvalid(makeEvidencePage({ evidenceCount: 0n }));
    expectEncodeInvalid(makeEvidencePage({ evidenceCount: 1n, diagnosticCount: 2n }));
    expectEncodeInvalid(makeEvidencePage({ payloadByteLength: 0n }));
    expectEncodeInvalid(makeEvidencePage({ pageOrdinal: 0n, predecessorPageSha256: digest(1) }));
    expectEncodeInvalid(makeEvidencePage({ pageOrdinal: 1n, predecessorPageSha256: null }));
    expectEncodeInvalid(makeEvidencePage({ firstEvidenceOrdinal: 1n }));
    expectEncodeInvalid(makeEvidencePage({ firstDiagnosticOrdinal: 1n }));
    expectEncodeInvalid(makeEvidencePage({
      firstEvidenceOrdinal: PERSISTABLE_U64_MAX,
      evidenceCount: 1n,
    }));
    expectEncodeInvalid(makeEvidencePage({
      firstDiagnosticOrdinal: PERSISTABLE_U64_MAX,
      diagnosticCount: 1n,
    }));
    expect(Result.isSuccess(
      encodeDeclarativeV2VerifierProgressFrameV2(
        makeEvidencePage({
          pageOrdinal: 1n,
          firstEvidenceOrdinal: PERSISTABLE_U64_MAX - 1n,
          evidenceCount: 1n,
          firstDiagnosticOrdinal: PERSISTABLE_U64_MAX,
          diagnosticCount: 0n,
          predecessorPageSha256: digest(31),
          payloadByteLength: PERSISTABLE_U64_MAX,
        }),
        budget,
      ),
    )).toBe(true);

    const owned = makeEvidencePage();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(owned, budget),
    );
    owned.reservationSha256[0] = 99;
    owned.payloadSha256[0] = 99;
    expect(encoded.frame.kind).toBe("evidence_page_manifest");
    if (encoded.frame.kind !== "evidence_page_manifest") {
      throw new Error("Expected evidence page.");
    }
    expect(encoded.frame.reservationSha256[0]).toBe(21);
    expect(encoded.frame.payloadSha256[0]).toBe(22);
  });

  it("binds all 26 command-budget dimensions into deterministic reservation bytes", async () => {
    const baselineValues = Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
        (dimension, index) => [dimension, BigInt(index + 1)],
      ),
    );
    const baselineBudget = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "command_budget",
        ...baselineValues,
      }, budget),
    ).canonicalBytes;
    const baselineBudgetSha256 = await sha256(baselineBudget);
    const baselineReservation = makeReservation({
      commandBudgetSha256: baselineBudgetSha256,
    });
    const firstReplay = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(
        baselineReservation,
        budget,
      ),
    ).canonicalBytes;
    const secondReplay = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(
        baselineReservation,
        budget,
      ),
    ).canonicalBytes;
    expect(secondReplay).toEqual(firstReplay);

    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const changedValues = {
        ...baselineValues,
        [dimension]: baselineValues[dimension]! + 1n,
      };
      const changedBudget = Result.getOrThrow(
        encodeDeclarativeV2VerifierProgressFrameV2({
          kind: "command_budget",
          ...changedValues,
        }, budget),
      ).canonicalBytes;
      const changedBudgetSha256 = await sha256(changedBudget);
      expect(changedBudgetSha256).not.toEqual(baselineBudgetSha256);
      expect(Result.getOrThrow(
        encodeDeclarativeV2VerifierProgressFrameV2(
          makeReservation({ commandBudgetSha256: changedBudgetSha256 }),
          budget,
        ),
      ).canonicalBytes).not.toEqual(firstReplay);
    }
  });

  it("enforces durable command kinds, exact digests, u64 bounds, and owned bytes", () => {
    for (const commandKind of [
      "source_page",
      "parse_module",
      "link_page",
      "registration_page",
    ] as const) {
      expect(Result.isSuccess(
        encodeDeclarativeV2VerifierProgressFrameV2(
          makeReservation({ commandKind }),
          budget,
        ),
      )).toBe(true);
    }
    expectEncodeInvalid(makeReservation({
      commandKind: "finalize" as "source_page",
    }));
    expectEncodeInvalid(makeOutputManifest({
      commandKind: "finalize" as "parse_module",
    }));
    expectEncodeInvalid(makeReservation({ sequence: 0n }));
    expectEncodeInvalid(makeReservation({ sequence: PERSISTABLE_U64_MAX + 1n }));
    expect(Result.isSuccess(
      encodeDeclarativeV2VerifierProgressFrameV2(
        makeReservation({ sequence: PERSISTABLE_U64_MAX }),
        budget,
      ),
    )).toBe(true);
    expect(Result.isSuccess(
      encodeDeclarativeV2VerifierProgressFrameV2(
        makeOutputManifest({
          sequence: PERSISTABLE_U64_MAX,
          evidenceCount: PERSISTABLE_U64_MAX,
          diagnosticCount: PERSISTABLE_U64_MAX,
        }),
        budget,
      ),
    )).toBe(true);
    expectEncodeInvalid(makeOutputManifest({
      evidenceCount: PERSISTABLE_U64_MAX + 1n,
    }));
    expectEncodeInvalid(makeOutputManifest({ diagnosticCount: -1n }));
    for (const [field, value] of [
      ["ownerId", "caller-owned"],
      ["fence", 1n],
      ["leaseExpiresAt", "2026-01-01T00:00:00.000Z"],
      ["timestamp", "2026-01-01T00:00:00.000Z"],
      ["requestId", "caller-owned"],
      ["deploymentId", "caller-owned"],
      ["opaqueHandle", "caller-owned"],
    ] as const) {
      expectEncodeInvalid({ ...makeReservation(), [field]: value });
    }
    expectEncodeInvalid({
      ...makeReservation(),
      attemptSha256: new Uint8Array(31),
    });

    const aliased = makeReservation();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(aliased, budget),
    );
    aliased.attemptSha256[0] = 99;
    aliased.predecessorReceiptSha256![0] = 99;
    expect(encoded.frame.kind).toBe("command_reservation");
    if (encoded.frame.kind !== "command_reservation") {
      throw new Error("Expected reservation.");
    }
    expect(encoded.frame.attemptSha256[0]).toBe(1);
    expect(encoded.frame.predecessorReceiptSha256?.[0]).toBe(4);

    const detached = digest(20);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expectEncodeInvalid(makeReceipt({ reservationSha256: detached }));
    expectEncodeInvalid(makeReceipt({
      reservationSha256: Object.create(Uint8Array.prototype) as Uint8Array,
    }));
    expectEncodeInvalid(makeReceipt({
      reservationSha256: new Proxy(digest(21), {}),
    }));
  });

  it("fails hostile records without invoking accessors or accepting forged structure", () => {
    let getterReads = 0;
    const accessor = {
      ...makeReservation(),
      get commandInputSha256() {
        getterReads += 1;
        throw new Error("must not run");
      },
    };
    expectEncodeInvalid(accessor);
    expect(getterReads).toBe(0);

    const proxy = new Proxy(makeReservation(), {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expectEncodeInvalid(proxy);
    const descriptorProxy = new Proxy(makeReservation(), {
      getOwnPropertyDescriptor() {
        throw new Error("hostile descriptor");
      },
    });
    expectEncodeInvalid(descriptorProxy);
    const revoked = Proxy.revocable(makeReservation(), {});
    revoked.revoke();
    expectEncodeInvalid(revoked.proxy);

    const symbol = {
      ...makeReceipt(),
      [Symbol("extra")]: true,
    };
    expectEncodeInvalid(symbol);
    const missing = { ...makeReceipt() } as Record<string, unknown>;
    delete missing.outputManifestSha256;
    expectEncodeInvalid(missing);

    let ownKeyReads = 0;
    const descriptorReads = new Map<PropertyKey, number>();
    const counted = new Proxy(makeReservation(), {
      ownKeys(target) {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        descriptorReads.set(property, (descriptorReads.get(property) ?? 0) + 1);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expect(Result.isSuccess(
      encodeDeclarativeV2VerifierProgressFrameV2(counted, budget),
    )).toBe(true);
    expect(ownKeyReads).toBe(1);
    expect([...descriptorReads.values()].every((reads) => reads === 1)).toBe(
      true,
    );

    let oversizedDescriptorReads = 0;
    const oversized = new Proxy(
      Object.fromEntries(
        Array.from({ length: 28 }, (_, index) => [`field${index}`, index]),
      ),
      {
        getOwnPropertyDescriptor(target, property) {
          oversizedDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    expectEncodeInvalid(oversized);
    expect(oversizedDescriptorReads).toBe(0);
  });

  it("rejects malformed durable bytes and admits exact frame ceilings only", () => {
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(makeReservation(), budget),
    ).canonicalBytes;
    expect(Result.isSuccess(
      decodeDeclarativeV2VerifierProgressFrameV2(encoded, {
        maximumFrameBytes: encoded.byteLength,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(encoded, {
        maximumFrameBytes: encoded.byteLength - 1,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
    for (let boundary = 0; boundary < encoded.byteLength; boundary += 1) {
      expect(Result.isFailure(
        decodeDeclarativeV2VerifierProgressFrameV2(
          encoded.subarray(0, boundary),
          budget,
        ),
      )).toBe(true);
    }
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(
        concat(encoded, new Uint8Array([0])),
        budget,
      ),
    )).toBe(true);

    const wrongKind = new Uint8Array(encoded);
    const reservationName = utf8("command_reservation");
    const receiptName = utf8("command_receipt");
    const kindOffset = findBytes(wrongKind, reservationName);
    wrongKind.set(receiptName, kindOffset);
    wrongKind.fill(0x78, kindOffset + receiptName.length, kindOffset + reservationName.length);
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(wrongKind, budget),
    )).toBe(true);

    const wrongCommand = new Uint8Array(encoded);
    const commandTagOffset = utf8(
      "flarex.declarative-v2/command_reservation/v2\0",
    ).byteLength + 4 + 32 + 32;
    wrongCommand[commandTagOffset] = 5;
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(wrongCommand, budget),
    )).toBe(true);

    const wrongFieldCount = new Uint8Array(encoded);
    const domainLength = utf8(
      "flarex.declarative-v2/command_reservation/v2\0",
    ).byteLength;
    wrongFieldCount[domainLength + 3] = 11;
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(wrongFieldCount, budget),
    )).toBe(true);
  });

  it("round-trips owned attempt and progress evidence at signed-int64 maximum", () => {
    const candidate = digest(1);
    const ceilings = digest(2);
    const attempt = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "attempt_identity",
        candidateSha256: candidate,
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        ceilingsSha256: ceilings,
      }, budget),
    );
    candidate[0] = 99;
    ceilings[0] = 99;
    expect(attempt.frame.kind).toBe("attempt_identity");
    if (attempt.frame.kind !== "attempt_identity") {
      throw new Error("Expected attempt identity.");
    }
    expect(attempt.frame.candidateSha256[0]).toBe(1);
    expect(attempt.frame.ceilingsSha256[0]).toBe(2);

    const receipt = digest(3);
    const cursor = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "verdict",
        settledSequence: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        moduleOrdinal: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        edgeOrdinal: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        pageOrdinal: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
        previousReceiptSha256: receipt,
      }, budget),
    );
    receipt[0] = 44;
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2VerifierProgressFrameV2(
        cursor.canonicalBytes,
        budget,
      ),
    );
    expect(decoded.frame).toEqual(cursor.frame);
    expect(decoded.canonicalBytes).not.toBe(cursor.canonicalBytes);
    expect(Result.isFailure(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "verdict",
        settledSequence: DECLARATIVE_V2_MAX_SIGNED_INT64_V1 + 1n,
        moduleOrdinal: 0n,
        edgeOrdinal: 0n,
        pageOrdinal: 0n,
        previousReceiptSha256: null,
      }, budget),
    )).toBe(true);
  });

  it("fails pre-V2 identities and malformed or noncanonical bytes closed", () => {
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2({
        budgetProtocolIdentity: "flarex.declarative-v2/verifier-budget/v1",
        progressProtocolIdentity:
          "flarex.declarative-v2/verifier-progress-page-evidence/v1",
      }),
    )).toBe(true);
    expect(Result.isSuccess(
      requireDeclarativeV2VerifierProtocolIdentitiesV2({
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
      }),
    )).toBe(true);
    const valid = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "progress_cursor",
        phase: "source",
        settledSequence: 0n,
        moduleOrdinal: 0n,
        edgeOrdinal: 0n,
        pageOrdinal: 0n,
        previousReceiptSha256: null,
      }, budget),
    ).canonicalBytes;
    for (let boundary = 0; boundary < valid.byteLength; boundary += 1) {
      expect(Result.isFailure(
        decodeDeclarativeV2VerifierProgressFrameV2(
          valid.subarray(0, boundary),
          budget,
        ),
      )).toBe(true);
    }
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(
        concat(valid, new Uint8Array([0])),
        budget,
      ),
    )).toBe(true);
    const v1 = new Uint8Array(valid);
    const version = utf8("/v2\0");
    const at = findBytes(v1, version);
    v1[at + 2] = 0x31;
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(v1, budget),
    )).toBe(true);

    const attemptBytes = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2({
        kind: "attempt_identity",
        candidateSha256: digest(8),
        progressProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
        budgetProtocolIdentity:
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
        ceilingsSha256: digest(9),
      }, budget),
    ).canonicalBytes;
    for (const malformed of [
      attemptBytes.subarray(0, attemptBytes.byteLength - 1),
      concat(attemptBytes, new Uint8Array([0])),
    ]) {
      const decoded = decodeDeclarativeV2VerifierProgressFrameV2(
        malformed,
        budget,
      );
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        expect(decoded.failure.reason).toBe("malformed");
      }
    }

    const detached = new Uint8Array(valid);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(Result.isFailure(
      decodeDeclarativeV2VerifierProgressFrameV2(detached, budget),
    )).toBe(true);

    const withSymbol = {
      budgetProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
      [Symbol("extra")]: true,
    };
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2(withSymbol),
    )).toBe(true);

    const nonEnumerable = {
      budgetProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
    };
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2(nonEnumerable),
    )).toBe(true);

    let getterReads = 0;
    const accessor = {
      get budgetProtocolIdentity() {
        getterReads += 1;
        throw new Error("must not be invoked");
      },
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
    };
    expect(Result.isFailure(
      requireDeclarativeV2VerifierProtocolIdentitiesV2(accessor),
    )).toBe(true);
    expect(getterReads).toBe(0);
  });

  it("keeps the package root unchanged and exposes only the intentional subpath", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-verifier-progress-v2",
      "./src/declarative-v2-verifier-progress-v2.ts",
    );
    expect(root).not.toHaveProperty(
      "encodeDeclarativeV2VerifierProgressFrameV2",
    );
  });
});

function makeReservation(
  overrides: Partial<DeclarativeV2VerifierCommandReservationFrameV2> = {},
): DeclarativeV2VerifierCommandReservationFrameV2 {
  return {
    kind: "command_reservation",
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    commandKind: "source_page",
    sequence: 1n,
    currentProgressSha256: digest(3),
    predecessorReceiptSha256: digest(4),
    commandBudgetSha256: digest(5),
    commandInputSha256: digest(6),
    freshAuthenticatedInputSha256: digest(7),
    analyzerIdentitySha256: digest(8),
    verifierIdentitySha256: digest(9),
    rangeAndPredecessorTailsSha256: digest(10),
    ...overrides,
  };
}

function makeOutputManifest(
  overrides: Partial<DeclarativeV2VerifierCommandOutputManifestFrameV2> = {},
): DeclarativeV2VerifierCommandOutputManifestFrameV2 {
  return {
    kind: "command_output_manifest",
    reservationSha256: digest(11),
    commandKind: "parse_module",
    sequence: 2n,
    evidenceRootSha256: digest(12),
    evidenceCount: 3n,
    diagnosticsRootSha256: digest(13),
    diagnosticCount: 4n,
    nextProgressSha256: digest(14),
    ...overrides,
  };
}

function makeReceipt(
  overrides: Partial<DeclarativeV2VerifierCommandReceiptFrameV2> = {},
): DeclarativeV2VerifierCommandReceiptFrameV2 {
  return {
    kind: "command_receipt",
    reservationSha256: digest(15),
    commandUsageSha256: digest(16),
    resultingAttemptUsageSha256: digest(17),
    outputManifestSha256: digest(18),
    nextProgressSha256: digest(19),
    ...overrides,
  };
}

function makeEvidencePage(
  overrides: Partial<DeclarativeV2VerifierEvidencePageManifestFrameV2> = {},
): DeclarativeV2VerifierEvidencePageManifestFrameV2 {
  return {
    kind: "evidence_page_manifest",
    reservationSha256: digest(21),
    commandKind: "parse_module",
    sequence: 3n,
    pageOrdinal: 0n,
    firstEvidenceOrdinal: 0n,
    evidenceCount: 2n,
    firstDiagnosticOrdinal: 0n,
    diagnosticCount: 1n,
    predecessorPageSha256: null,
    payloadByteLength: 37n,
    payloadSha256: digest(22),
    cumulativeDiagnosticsRootSha256: digest(23),
    ...overrides,
  };
}

function expectEncodeInvalid(input: unknown): void {
  const result = encodeDeclarativeV2VerifierProgressFrameV2(input, budget);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure.reason).toBe("invalidInput");
  }
}

function digest(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function sizedUtf8(value: string): Uint8Array {
  const bytes = utf8(value);
  return concat(u32(bytes.byteLength), bytes);
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
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

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    if (
      needle.every((value, offset) => haystack[index + offset] === value)
    ) return index;
  }
  throw new Error("Needle not found.");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await webcrypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

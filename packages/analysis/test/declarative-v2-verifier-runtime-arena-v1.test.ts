import { Encoding, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, test } from "vitest";

import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
} from "../src/declarativeV2VerifierExecutableV1.generated";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
  planDeclarativeV2VerifierArenaV1,
} from "../src/declarativeV2VerifierV1";
import {
  appendDeclarativeV2VerifierRuntimeOrderTextV1,
  beginDeclarativeV2VerifierRuntimeTextV1,
  createDeclarativeV2VerifierRuntimeArenaV1,
  createDeclarativeV2VerifierRuntimeComparisonV1,
  createDeclarativeV2VerifierRuntimeCursorV1,
  createDeclarativeV2VerifierRuntimeOrderV1,
  createDeclarativeV2VerifierRuntimeSearchV1,
  createDeclarativeV2VerifierRuntimeSha256V1,
  DECLARATIVE_V2_VERIFIER_RUNTIME_ARENA_V1_TEST_ONLY,
  finishDeclarativeV2VerifierRuntimeSha256V1,
  finishDeclarativeV2VerifierRuntimeTextV1,
  revokeDeclarativeV2VerifierRuntimeArenaV1,
  stepDeclarativeV2VerifierRuntimeComparisonV1,
  stepDeclarativeV2VerifierRuntimeCursorV1,
  stepDeclarativeV2VerifierRuntimeOrderV1,
  stepDeclarativeV2VerifierRuntimeSearchV1,
  stepDeclarativeV2VerifierRuntimeSha256V1,
  stepDeclarativeV2VerifierRuntimeTextV1,
  type DeclarativeV2VerifierRuntimeArenaHandleV1,
  type DeclarativeV2VerifierRuntimeComparisonV1,
  type DeclarativeV2VerifierRuntimeOrderV1,
  type DeclarativeV2VerifierRuntimeSearchV1,
  type DeclarativeV2VerifierRuntimeSha256V1,
  type DeclarativeV2VerifierRuntimeTextHandleV1,
} from "../src/declarativeV2VerifierRuntimeArenaV1";

function budgets(
  mutate?: Readonly<Record<string, bigint>>,
): Readonly<{
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
}> {
  const tableBytes = BigInt(
    GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength +
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
  );
  const values = Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
      dimension,
      mutate?.[dimension] ??
        (dimension === "tableBytes"
          ? tableBytes
          : dimension === "sourceMapBytes" ||
              dimension === "semanticBytes"
          ? 0n
          : dimension.endsWith("Bytes")
          ? 16_384n
          : 16_384n),
    ]),
  );
  const required = Object.freeze({
    kind: "attempt_usage",
    ...values,
  }) as DeclarativeV2VerifierBudgetFrameV2;
  return Object.freeze({
    required,
    maximums: Object.freeze({
      ...required,
      kind: "command_budget",
    }) as DeclarativeV2VerifierBudgetFrameV2,
  });
}

function arena(
  mutate?: Readonly<Record<string, bigint>>,
): DeclarativeV2VerifierRuntimeArenaHandleV1 {
  const admitted = budgets(mutate);
  const plan = planDeclarativeV2VerifierArenaV1(admitted);
  if (Result.isFailure(plan)) throw plan.failure;
  const created = createDeclarativeV2VerifierRuntimeArenaV1(
    plan.success,
  );
  if (Result.isFailure(created)) throw created.failure;
  return created.success;
}

function text(
  owner: DeclarativeV2VerifierRuntimeArenaHandleV1,
  bytes: Uint8Array,
  allowance: 1 | 1_024 = 1,
): DeclarativeV2VerifierRuntimeTextHandleV1 {
  const created = beginDeclarativeV2VerifierRuntimeTextV1(
    owner,
    bytes.byteLength,
  );
  if (Result.isFailure(created)) throw created.failure;
  let offset = 0;
  for (
    let iterations = 0;
    offset < bytes.byteLength && iterations < bytes.byteLength + 1;
    iterations += 1
  ) {
    const stepped = stepDeclarativeV2VerifierRuntimeTextV1(
      created.success,
      bytes.subarray(offset),
      allowance,
    );
    if (Result.isFailure(stepped)) throw stepped.failure;
    offset += Number(stepped.success.receipt.delta.consumedBytes);
  }
  const finished = finishDeclarativeV2VerifierRuntimeTextV1(
    created.success,
    allowance,
  );
  if (Result.isFailure(finished)) throw finished.failure;
  if (finished.success.status !== "complete") {
    throw new Error("text did not complete within the explicit test ceiling");
  }
  return finished.success.text;
}

function finishComparison(
  comparison: DeclarativeV2VerifierRuntimeComparisonV1,
  allowance: 1 | 1_024,
): -1 | 0 | 1 {
  for (let iteration = 0; iteration < 100_000; iteration += 1) {
    const stepped = stepDeclarativeV2VerifierRuntimeComparisonV1(
      comparison,
      allowance,
    );
    if (Result.isFailure(stepped)) throw stepped.failure;
    if (stepped.success.status === "complete") return stepped.success.order;
  }
  throw new Error("comparison exceeded the explicit test iteration ceiling");
}

function finishSearch(
  search: DeclarativeV2VerifierRuntimeSearchV1,
  allowance: 1 | 1_024,
): number | null {
  for (let iteration = 0; iteration < 100_000; iteration += 1) {
    const stepped = stepDeclarativeV2VerifierRuntimeSearchV1(
      search,
      allowance,
    );
    if (Result.isFailure(stepped)) throw stepped.failure;
    if (stepped.success.status === "complete") {
      return stepped.success.byteOffset;
    }
  }
  throw new Error("search exceeded the explicit test iteration ceiling");
}

function finishOrder(
  order: DeclarativeV2VerifierRuntimeOrderV1,
  allowance: 1 | 1_024,
): Uint32Array {
  for (let iteration = 0; iteration < 100_000; iteration += 1) {
    const stepped = stepDeclarativeV2VerifierRuntimeOrderV1(
      order,
      allowance,
    );
    if (Result.isFailure(stepped)) throw stepped.failure;
    if (stepped.success.status === "complete") {
      const indexes =
        DECLARATIVE_V2_VERIFIER_RUNTIME_ARENA_V1_TEST_ONLY.orderedIndexes(
          order,
          stepped.success.count,
        );
      if (Result.isFailure(indexes)) throw indexes.failure;
      return indexes.success;
    }
  }
  throw new Error("order exceeded the explicit test iteration ceiling");
}

function finishHash(
  owner: DeclarativeV2VerifierRuntimeArenaHandleV1,
  bytes: Uint8Array,
  allowance: 1 | 1_024,
): Uint8Array {
  const created = createDeclarativeV2VerifierRuntimeSha256V1(owner);
  if (Result.isFailure(created)) throw created.failure;
  let offset = 0;
  for (let iteration = 0; offset < bytes.byteLength; iteration += 1) {
    if (iteration > bytes.byteLength * 100 + 10_000) {
      throw new Error("hash input exceeded the explicit iteration ceiling");
    }
    const stepped = stepDeclarativeV2VerifierRuntimeSha256V1(
      created.success,
      bytes.subarray(offset),
      allowance,
    );
    if (Result.isFailure(stepped)) throw stepped.failure;
    offset += Number(stepped.success.receipt.delta.consumedBytes);
  }
  for (let iteration = 0; iteration < 100_000; iteration += 1) {
    const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
      created.success,
      allowance,
    );
    if (Result.isFailure(finished)) throw finished.failure;
    if (finished.success.status === "complete") return finished.success.digest;
  }
  throw new Error("hash finish exceeded the explicit iteration ceiling");
}

describe("Declarative V2 verifier runtime arena", () => {
  test("owns fatal UTF-8 text and reproduces allowance/chunk variants", () => {
    const bytes = new TextEncoder().encode("a😀z");
    for (const allowance of [1, 1_024] as const) {
      const owner = arena();
      const captured = text(owner, bytes, allowance);
      const copy =
        DECLARATIVE_V2_VERIFIER_RUNTIME_ARENA_V1_TEST_ONLY.copyText(
          captured,
          bytes.byteLength + 1,
        );
      expect(Result.isSuccess(copy)).toBe(true);
      if (Result.isSuccess(copy)) expect(copy.success).toEqual(bytes);
    }

    for (const invalid of [
      Uint8Array.of(0xc0, 0x80),
      Uint8Array.of(0xed, 0xa0, 0x80),
      Uint8Array.of(0xf4, 0x90, 0x80, 0x80),
    ]) {
      const owner = arena();
      const writer = beginDeclarativeV2VerifierRuntimeTextV1(
        owner,
        invalid.byteLength,
      );
      if (Result.isFailure(writer)) throw writer.failure;
      const result = stepDeclarativeV2VerifierRuntimeTextV1(
        writer.success,
        invalid,
        1_024,
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("invalidUtf8");
      }
    }
  });

  test("compares UTF-16 order and searches one byte per transition", () => {
    const owner = arena();
    const encoder = new TextEncoder();
    const bmp = text(owner, encoder.encode("\uffff"), 1);
    const supplementary = text(owner, encoder.encode("😀"), 1);
    const compared = createDeclarativeV2VerifierRuntimeComparisonV1(
      supplementary,
      bmp,
    );
    if (Result.isFailure(compared)) throw compared.failure;
    expect(finishComparison(compared.success, 1)).toBe(-1);

    const haystack = text(owner, encoder.encode("alpha/beta"), 1_024);
    const needle = text(owner, encoder.encode("/b"), 1_024);
    const searched = createDeclarativeV2VerifierRuntimeSearchV1(
      haystack,
      needle,
    );
    if (Result.isFailure(searched)) throw searched.failure;
    expect(finishSearch(searched.success, 1)).toBe(5);
  });

  test("orders stably without native sort and exposes only opaque indexes", () => {
    const owner = arena();
    const encoder = new TextEncoder();
    const values = ["z", "a", "a", "😀", "\uffff"].map((value) =>
      text(owner, encoder.encode(value), 1)
    );
    const ordered = createDeclarativeV2VerifierRuntimeOrderV1(
      owner,
      values.length,
    );
    if (Result.isFailure(ordered)) throw ordered.failure;
    const aliased = createDeclarativeV2VerifierRuntimeOrderV1(
      owner,
      values.length,
    );
    expect(Result.isFailure(aliased)).toBe(true);
    if (Result.isFailure(aliased)) {
      expect(aliased.failure.reason).toBe("closed");
    }
    for (const value of values) {
      const appended = appendDeclarativeV2VerifierRuntimeOrderTextV1(
        ordered.success,
        value,
      );
      if (Result.isFailure(appended)) throw appended.failure;
    }
    expect([...finishOrder(ordered.success, 1)]).toEqual([1, 2, 0, 3, 4]);
  });

  test.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "a".repeat(1_000),
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    ],
    [
      "a".repeat(63),
      "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34",
    ],
  ])("hashes %s incrementally", (value, expected) => {
    const bytes = new TextEncoder().encode(value);
    expect(Encoding.encodeHex(finishHash(arena(), bytes, 1))).toBe(expected);
    expect(Encoding.encodeHex(finishHash(arena(), bytes, 1_024))).toBe(expected);
  });

  test("meters SHA block compression when the input cursor cannot advance", () => {
    const owner = arena();
    const created = createDeclarativeV2VerifierRuntimeSha256V1(owner);
    if (Result.isFailure(created)) throw created.failure;
    const block = new Uint8Array(64).fill(0x61);
    const admitted = stepDeclarativeV2VerifierRuntimeSha256V1(
      created.success,
      block,
      64,
    );
    if (Result.isFailure(admitted)) throw admitted.failure;
    expect(admitted.success.receipt.delta.consumedBytes).toBe(64n);
    expect(admitted.success.receipt.delta.transitions).toBe(64n);

    const compression = stepDeclarativeV2VerifierRuntimeSha256V1(
      created.success,
      Uint8Array.of(0x62),
      1,
    );
    if (Result.isFailure(compression)) throw compression.failure;
    expect(compression.success.receipt.delta.consumedBytes).toBe(0n);
    expect(compression.success.receipt.delta.transitions).toBe(1n);
  });

  test("keeps completed order handles terminal and rejects hostile hash views", () => {
    const owner = arena();
    const singletonText = text(owner, Uint8Array.of(0x61), 1);
    const order = createDeclarativeV2VerifierRuntimeOrderV1(owner, 1);
    if (Result.isFailure(order)) throw order.failure;
    const appended = appendDeclarativeV2VerifierRuntimeOrderTextV1(
      order.success,
      singletonText,
    );
    if (Result.isFailure(appended)) throw appended.failure;
    const completed = stepDeclarativeV2VerifierRuntimeOrderV1(
      order.success,
      1,
    );
    expect(Result.isSuccess(completed) && completed.success.status).toBe(
      "complete",
    );
    expect(Result.isFailure(
      stepDeclarativeV2VerifierRuntimeOrderV1(order.success, 1),
    )).toBe(true);
    expect(Result.isFailure(
      appendDeclarativeV2VerifierRuntimeOrderTextV1(
        order.success,
        singletonText,
      ),
    )).toBe(true);

    const hash = createDeclarativeV2VerifierRuntimeSha256V1(owner);
    if (Result.isFailure(hash)) throw hash.failure;
    const revoked = Proxy.revocable(new Uint8Array([0x61]), {});
    revoked.revoke();
    const hostile = stepDeclarativeV2VerifierRuntimeSha256V1(
      hash.success,
      revoked.proxy,
      1,
    );
    expect(Result.isFailure(hostile)).toBe(true);
    if (Result.isFailure(hostile)) {
      expect(hostile.failure.reason).toBe("invalidInput");
    }
    expect(Result.isFailure(
      stepDeclarativeV2VerifierRuntimeSha256V1(
        hash.success,
        Uint8Array.of(0x61),
        1,
      ),
    )).toBe(true);

    const textOwner = arena();
    const writer = beginDeclarativeV2VerifierRuntimeTextV1(textOwner, 1);
    if (Result.isFailure(writer)) throw writer.failure;
    const subclass = new (class extends Uint8Array {}) ([0x61]);
    Object.defineProperty(subclass, "buffer", {
      get() {
        throw new Error("caller buffer getter must not run");
      },
    });
    const intrinsic = stepDeclarativeV2VerifierRuntimeTextV1(
      writer.success,
      subclass,
      1,
    );
    expect(Result.isSuccess(intrinsic)).toBe(true);

    const hostileWriter = beginDeclarativeV2VerifierRuntimeTextV1(
      arena(),
      1,
    );
    if (Result.isFailure(hostileWriter)) throw hostileWriter.failure;
    const revokedText = Proxy.revocable(new Uint8Array([0x61]), {});
    revokedText.revoke();
    const hostileText = stepDeclarativeV2VerifierRuntimeTextV1(
      hostileWriter.success,
      revokedText.proxy,
      1,
    );
    expect(Result.isFailure(hostileText)).toBe(true);
    if (Result.isFailure(hostileText)) {
      expect(hostileText.failure.reason).toBe("invalidInput");
    }
  });

  test("enforces allowance, exact byte ceilings, terminal reuse, and revocation", () => {
    const owner = arena({
      stringBytes: 1n,
      sourceBytes: 0n,
      objectBodyBytes: 0n,
    });
    const writer = beginDeclarativeV2VerifierRuntimeTextV1(owner, 1);
    if (Result.isFailure(writer)) throw writer.failure;
    const zero = stepDeclarativeV2VerifierRuntimeTextV1(
      writer.success,
      Uint8Array.of(0x61),
      0,
    );
    expect(Result.isSuccess(zero) && zero.success.status).toBe("pending");
    if (Result.isSuccess(zero)) {
      expect(zero.success.receipt.delta.consumedBytes).toBe(0n);
    }
    const tooLarge = stepDeclarativeV2VerifierRuntimeTextV1(
      writer.success,
      Uint8Array.of(0x61),
      1_025,
    );
    expect(Result.isFailure(tooLarge)).toBe(true);

    const terminalOwner = arena();
    const captured = text(
      terminalOwner,
      Uint8Array.of(0x61),
      1,
    );
    const cursor = createDeclarativeV2VerifierRuntimeCursorV1(captured);
    if (Result.isFailure(cursor)) throw cursor.failure;
    const first = stepDeclarativeV2VerifierRuntimeCursorV1(
      cursor.success,
      1,
    );
    expect(Result.isSuccess(first)).toBe(true);
    const eof = stepDeclarativeV2VerifierRuntimeCursorV1(cursor.success, 1);
    expect(Result.isSuccess(eof)).toBe(true);
    const repeated = stepDeclarativeV2VerifierRuntimeCursorV1(
      cursor.success,
      1,
    );
    expect(Result.isFailure(repeated)).toBe(true);

    expect(Result.isSuccess(
      revokeDeclarativeV2VerifierRuntimeArenaV1(terminalOwner),
    )).toBe(true);
    expect(Result.isFailure(
      createDeclarativeV2VerifierRuntimeCursorV1(captured),
    )).toBe(true);
    expect(Result.isFailure(
      createDeclarativeV2VerifierRuntimeCursorV1({
        _tag: "DeclarativeV2VerifierRuntimeTextHandleV1",
      }),
    )).toBe(true);
  });

  test("does not consult platform whole-text, sort, map, set, or crypto helpers", () => {
    const originalDecoder = globalThis.TextDecoder;
    const originalEncoder = globalThis.TextEncoder;
    const originalSort = Array.prototype.sort;
    const originalMap = globalThis.Map;
    const originalSet = globalThis.Set;
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );
    try {
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("TextDecoder authority trap");
          }
        },
      });
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("TextEncoder authority trap");
          }
        },
      });
      Object.defineProperty(Array.prototype, "sort", {
        configurable: true,
        value() {
          throw new Error("sort authority trap");
        },
      });
      Object.defineProperty(globalThis, "Map", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("Map authority trap");
          }
        },
      });
      Object.defineProperty(globalThis, "Set", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("Set authority trap");
          }
        },
      });
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        get() {
          throw new Error("crypto authority trap");
        },
      });

      const owner = arena();
      const a = text(owner, Uint8Array.of(0x61), 1);
      const b = text(owner, Uint8Array.of(0x62), 1);
      const order = createDeclarativeV2VerifierRuntimeOrderV1(owner, 2);
      if (Result.isFailure(order)) throw order.failure;
      for (const value of [b, a]) {
        const appended = appendDeclarativeV2VerifierRuntimeOrderTextV1(
          order.success,
          value,
        );
        if (Result.isFailure(appended)) throw appended.failure;
      }
      expect([...finishOrder(order.success, 1)]).toEqual([1, 0]);
      expect(Encoding.encodeHex(
        finishHash(owner, Uint8Array.of(0x61), 1),
      )).toBe(
        "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      );
    } finally {
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: originalDecoder,
      });
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: originalEncoder,
      });
      Object.defineProperty(Array.prototype, "sort", {
        configurable: true,
        value: originalSort,
      });
      Object.defineProperty(globalThis, "Map", {
        configurable: true,
        value: originalMap,
      });
      Object.defineProperty(globalThis, "Set", {
        configurable: true,
        value: originalSet,
      });
      if (cryptoDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      }
    }
  });
});

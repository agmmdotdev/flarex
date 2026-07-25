import { Result } from "effect";
import { readFileSync } from "node:fs";
import {
  encodeCanonicalJson,
  isJsonObject,
  type Json,
} from "flarex-protocol/json";
import { describe, expect, test } from "vitest";

import {
  createIncrementalCanonicalJsonDecoderV1,
  createIncrementalCanonicalJsonByteSinkEncoderV1,
  createIncrementalCanonicalJsonEncoderV1,
  makeIncrementalCanonicalJsonByteSinkV1,
  makeIncrementalCanonicalJsonEventSinkV1,
  makeIncrementalCanonicalJsonEventSourceV1,
  makeIncrementalCanonicalJsonLimitsV1,
  type IncrementalCanonicalJsonDecodeStepV1,
  type IncrementalCanonicalJsonByteSinkEncodeStepV1,
  type IncrementalCanonicalJsonEncodeStepV1,
  type IncrementalCanonicalJsonEventV1,
  type IncrementalCanonicalJsonSinkEventV1,
  type IncrementalCanonicalJsonLimitsV1,
} from "../src/declarativeV2IncrementalCanonicalJsonV1";

const UTF8 = new TextEncoder();
const ITERATION_LIMIT = 1_000_000;
const LARGE_LIMITS = ownedLimits({
  maximumInputBytes: 100_000,
  maximumCanonicalBytes: 100_000,
  maximumStringBytes: 100_000,
  maximumMembers: 100_000,
  maximumDepth: 100_000,
});

function ownedLimits(
  value: IncrementalCanonicalJsonLimitsV1,
): IncrementalCanonicalJsonLimitsV1 {
  const result = makeIncrementalCanonicalJsonLimitsV1(
    value.maximumInputBytes,
    value.maximumCanonicalBytes,
    value.maximumStringBytes,
    value.maximumMembers,
    value.maximumDepth,
  );
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function oracle(value: Json): Uint8Array {
  return UTF8.encode(encodeCanonicalJson(value, () => {
    throw new Error("oracle received non-JSON");
  }));
}

function appendEvents(
  output: IncrementalCanonicalJsonEventV1[],
  value: Json,
  role: "key" | "value" = "value",
): void {
  if (value === null) {
    output.push({ kind: "null" });
    return;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    output.push({ kind: typeof value, value } as
      | { readonly kind: "boolean"; readonly value: boolean }
      | { readonly kind: "number"; readonly value: number });
    return;
  }
  if (typeof value === "string") {
    output.push({ kind: "stringStart", role });
    for (const scalar of value) {
      output.push({
        kind: "stringScalar",
        role,
        value: scalar,
        codePoint: scalar.codePointAt(0)!,
      });
    }
    output.push({ kind: "stringEnd", role });
    return;
  }
  if (Array.isArray(value)) {
    output.push({ kind: "arrayStart" });
    for (const member of value) appendEvents(output, member);
    output.push({ kind: "arrayEnd" });
    return;
  }
  if (!isJsonObject(value)) throw new Error("unreachable JSON member");
  output.push({ kind: "objectStart" });
  for (const key of Object.keys(value).sort()) {
    appendEvents(output, key, "key");
    appendEvents(output, value[key]!);
  }
  output.push({ kind: "objectEnd" });
}

function source(value: Json) {
  const events: IncrementalCanonicalJsonEventV1[] = [];
  appendEvents(events, value);
  events.push({ kind: "end" });
  let index = 0;
  return makeIncrementalCanonicalJsonEventSourceV1(() => {
    const event = events[index];
    if (event === undefined) throw new Error("test source exhausted");
    index += 1;
    return event;
  });
}

function materializer() {
  const frames: Array<
    | { readonly kind: "array"; readonly value: Json[] }
    | {
        readonly kind: "object";
        readonly value: Record<string, Json>;
        key: string | undefined;
      }
  > = [];
  let root: Json | undefined;
  let role: "key" | "value" | undefined;
  let text = "";
  const attach = (value: Json): void => {
    const frame = frames[frames.length - 1];
    if (frame === undefined) {
      root = value;
    } else if (frame.kind === "array") {
      frame.value.push(value);
    } else {
      if (frame.key === undefined) throw new Error("missing key");
      frame.value[frame.key] = value;
      frame.key = undefined;
    }
  };
  const sink = makeIncrementalCanonicalJsonEventSinkV1((event) => {
    switch (event.kind) {
      case "null":
        attach(null);
        break;
      case "boolean":
      case "number":
        attach(event.value);
        break;
      case "stringStart":
        role = event.role;
        text = "";
        break;
      case "stringScalar":
        text += event.value;
        break;
      case "stringEnd": {
        const captured = text;
        role = undefined;
        text = "";
        if (event.role === "value") attach(captured);
        else {
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "object") throw new Error("key outside object");
          frame.key = captured;
        }
        break;
      }
      case "arrayStart": {
        const value: Json[] = [];
        attach(value);
        frames.push({ kind: "array", value });
        break;
      }
      case "objectStart": {
        const value: Record<string, Json> = {};
        attach(value);
        frames.push({ kind: "object", value, key: undefined });
        break;
      }
      case "arrayEnd":
      case "objectEnd":
        frames.pop();
        break;
    }
  });
  return { sink, value: () => root };
}

function driveDecode(
  chunks: ReadonlyArray<Uint8Array>,
  limits: IncrementalCanonicalJsonLimitsV1 = LARGE_LIMITS,
  allowance = 7,
): Extract<
  IncrementalCanonicalJsonDecodeStepV1,
  { readonly status: "complete" }
> & { readonly value: Json } {
  const output = materializer();
  const created = createIncrementalCanonicalJsonDecoderV1(
    ownedLimits(limits),
    output.sink,
  );
  if (Result.isFailure(created)) throw created.failure;
  let iterations = 0;
  for (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (iterations++ >= ITERATION_LIMIT) throw new Error("decode stalled");
      const stepped = created.success.step(chunk.subarray(offset), allowance);
      if (Result.isFailure(stepped)) throw stepped.failure;
      offset += stepped.success.consumedInputBytes;
      if (
        stepped.success.consumedInputBytes === 0 &&
        stepped.success.receipt.delta.transitions === 0
      ) {
        throw new Error("decode made no progress");
      }
    }
  }
  while (true) {
    if (iterations++ >= ITERATION_LIMIT) throw new Error("finish stalled");
    const finished = created.success.finish(allowance);
    if (Result.isFailure(finished)) throw finished.failure;
    if (finished.success.status === "complete") {
      const value = output.value();
      if (value === undefined) throw new Error("decoder produced no value");
      return { ...finished.success, value };
    }
    if (finished.success.receipt.delta.transitions === 0 && allowance !== 0) {
      throw new Error("finish made no progress");
    }
  }
}

function driveEncode(
  value: Json,
  limits: IncrementalCanonicalJsonLimitsV1 = LARGE_LIMITS,
  allowance = 7,
): Extract<
  IncrementalCanonicalJsonEncodeStepV1,
  { readonly status: "complete" }
> {
  const created = createIncrementalCanonicalJsonEncoderV1(
    source(value),
    ownedLimits(limits),
  );
  if (Result.isFailure(created)) throw created.failure;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const stepped = created.success.step(allowance);
    if (Result.isFailure(stepped)) throw stepped.failure;
    if (stepped.success.status === "complete") return stepped.success;
    if (stepped.success.receipt.delta.transitions === 0 && allowance !== 0) {
      throw new Error("encode made no progress");
    }
  }
  throw new Error("encode stalled");
}

function driveSinkEncode(
  value: Json,
  limits: IncrementalCanonicalJsonLimitsV1 = LARGE_LIMITS,
  allowance = 7,
): Readonly<{
  readonly bytes: Uint8Array;
  readonly complete: Extract<
    IncrementalCanonicalJsonByteSinkEncodeStepV1,
    { readonly status: "complete" }
  >;
}> {
  const output: number[] = [];
  const created = createIncrementalCanonicalJsonByteSinkEncoderV1(
    source(value),
    makeIncrementalCanonicalJsonByteSinkV1((byte, offset) => {
      expect(offset).toBe(output.length);
      output.push(byte);
    }),
    ownedLimits(limits),
  );
  if (Result.isFailure(created)) throw created.failure;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const stepped = created.success.step(allowance);
    if (Result.isFailure(stepped)) throw stepped.failure;
    if (stepped.success.status === "complete") {
      return {
        bytes: Uint8Array.from(output),
        complete: stepped.success,
      };
    }
    if (stepped.success.receipt.delta.transitions === 0 && allowance !== 0) {
      throw new Error("sink encode made no progress");
    }
  }
  throw new Error("sink encode stalled");
}

function decodeFailure(bytes: Uint8Array): string {
  const created = createIncrementalCanonicalJsonDecoderV1(
    LARGE_LIMITS,
    materializer().sink,
  );
  if (Result.isFailure(created)) throw created.failure;
  let offset = 0;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const result = offset < bytes.byteLength
      ? created.success.step(bytes.subarray(offset), 11)
      : created.success.finish(11);
    if (Result.isFailure(result)) return result.failure.reason;
    offset += result.success.consumedInputBytes;
    if (result.success.status === "complete") return "success";
  }
  throw new Error("failure case stalled");
}

const values: ReadonlyArray<Json> = [
  null,
  true,
  false,
  0,
  -0,
  1.5,
  1e30,
  "",
  "\"\\\b\f\n\r\t/\u0000",
  "က😀",
  [],
  {},
  [1, "two", null, { a: true }],
  {
    a: 1,
    nested: {
      array: [false, "က"],
      text: "value",
    },
    z: null,
  },
];

describe("Declarative V2 incremental canonical JSON mechanics", () => {
  test("matches the protocol oracle across values and transition quanta", () => {
    for (const [valueIndex, value] of values.entries()) {
      const expected = oracle(value);
      for (const allowance of [1, 2, 7, 1_024]) {
        let encoded: ReturnType<typeof driveEncode>;
        try {
          encoded = driveEncode(value, LARGE_LIMITS, allowance);
        } catch (cause) {
          throw new Error(`encode value ${valueIndex} @${allowance}`, {
            cause,
          });
        }
        expect(encoded.bytes, `${JSON.stringify(value)} @${allowance}`)
          .toEqual(expected);
        const decoded = driveDecode([expected], LARGE_LIMITS, allowance);
        expect(decoded.value).toEqual(Object.is(value, -0) ? 0 : value);
        expect(decoded.canonical).toBe(true);
        expect(decoded.receipt.aggregate.inputBytes).toBe(expected.byteLength);
        expect(decoded.receipt.aggregate.canonicalBytes).toBe(
          expected.byteLength,
        );
      }
    }
  });

  test("is identical across every byte and UTF-8 split", () => {
    const bytes = oracle({
      a: "က😀\\\"\n",
      b: [{ c: 1.25e-10 }],
    });
    const baseline = driveDecode([bytes], LARGE_LIMITS, 3);
    for (let split = 0; split <= bytes.byteLength; split += 1) {
      const decoded = driveDecode(
        [bytes.slice(0, split), bytes.slice(split)],
        LARGE_LIMITS,
        3,
      );
      expect(decoded.value, `split ${split}`).toEqual(baseline.value);
      expect(decoded.canonical, `split ${split}`).toBe(true);
      expect(decoded.receipt.aggregate).toEqual(baseline.receipt.aggregate);
    }
  });

  test.each([
    ["whitespace", " {\"a\":1}", true],
    ["key order", "{\"b\":1,\"a\":2}", true],
    ["duplicate key", "{\"a\":1,\"a\":2}", true],
    ["escaped slash", "{\"a\":\"\\/\"}", true],
    ["uppercase unicode escape", "{\"a\":\"\\u000A\"}", true],
    ["decimal spelling", "{\"a\":1.0}", true],
    ["exponent spelling", "{\"a\":1e0}", true],
  ])("accepts valid %s spelling but records noncanonicality", (_name, text) => {
    const decoded = driveDecode([UTF8.encode(text)]);
    expect(decoded.canonical).toBe(false);
  });

  test.each([
    ["truncated object", "{"],
    ["trailing value", "{}{}"],
    ["trailing comma", "{\"a\":1,}"],
    ["leading zero", "01"],
    ["bad exponent", "1e+"],
    ["bad escape", "\"\\x\""],
    ["unquoted key", "{a:1}"],
  ])("rejects malformed %s", (_name, text) => {
    expect(decodeFailure(UTF8.encode(text))).toBe("malformed");
  });

  test("rejects malformed and truncated UTF-8 without throwing", () => {
    for (const bytes of [
      new Uint8Array([0xc0]),
      new Uint8Array([0xe0, 0x80, 0x80]),
      new Uint8Array([0xed, 0xa0, 0x80]),
      new Uint8Array([0xf4, 0x90, 0x80, 0x80]),
      new Uint8Array([0xf0, 0x9f]),
    ]) {
      expect(decodeFailure(bytes)).toBe("invalidUtf8");
    }
  });

  test("enforces exact and one-less ceilings before use", () => {
    const bytes = oracle({ a: ["one", "two"], b: { c: true } });
    const baseline = driveDecode([bytes]);
    const exact = {
      maximumInputBytes: baseline.receipt.aggregate.inputBytes,
      maximumCanonicalBytes: baseline.receipt.aggregate.canonicalBytes,
      maximumStringBytes: baseline.receipt.aggregate.stringBytes,
      maximumMembers: baseline.receipt.aggregate.members,
      maximumDepth: baseline.receipt.aggregate.depth,
    };
    expect(driveDecode([bytes], exact).value).toEqual({
      a: ["one", "two"],
      b: { c: true },
    });
    for (const key of Object.keys(exact) as ReadonlyArray<keyof typeof exact>) {
      const maximum = exact[key];
      if (maximum === 0) continue;
      const created = createIncrementalCanonicalJsonDecoderV1(ownedLimits({
        ...exact,
        [key]: maximum - 1,
      }), materializer().sink);
      if (Result.isFailure(created)) {
        expect(created.failure.reason).toBe("invalidBudget");
        continue;
      }
      let offset = 0;
      let failure: string | undefined;
      for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
        const result = offset < bytes.byteLength
          ? created.success.step(bytes.subarray(offset), 5)
          : created.success.finish(5);
        if (Result.isFailure(result)) {
          failure = result.failure.reason;
          break;
        }
        offset += result.success.consumedInputBytes;
      }
      expect(failure, key).toBe("budgetExceeded");
    }
  });

  test("enforces encoder output/string/member/depth ceilings exactly", () => {
    const value = { a: ["one", { b: "two" }] } satisfies Json;
    const baseline = driveEncode(value);
    const exact = {
      maximumInputBytes: 0,
      maximumCanonicalBytes: baseline.receipt.aggregate.canonicalBytes,
      maximumStringBytes: baseline.receipt.aggregate.stringBytes,
      maximumMembers: baseline.receipt.aggregate.members,
      maximumDepth: baseline.receipt.aggregate.depth,
    };
    expect(driveEncode(value, exact).bytes).toEqual(oracle(value));
    for (
      const key of [
        "maximumCanonicalBytes",
        "maximumStringBytes",
        "maximumMembers",
        "maximumDepth",
      ] as const
    ) {
      const created = createIncrementalCanonicalJsonEncoderV1(
        source(value),
        ownedLimits({
        ...exact,
        [key]: exact[key] - 1,
        }),
      );
      if (Result.isFailure(created)) {
        expect(created.failure.reason, key).toBe("invalidBudget");
        continue;
      }
      let failure: string | undefined;
      for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
        const result = created.success.step(3);
        if (Result.isFailure(result)) {
          failure = result.failure.reason;
          break;
        }
      }
      expect(failure, key).toBe("budgetExceeded");
    }
  });

  test("rejects unordered and duplicate ordered-source entries incrementally", () => {
    for (const entries of [
      [["b", 1], ["a", 2]],
      [["a", 1], ["a", 2]],
    ] as const) {
      const events: IncrementalCanonicalJsonEventV1[] = [
        { kind: "objectStart" },
      ];
      for (const [key, value] of entries) {
        appendEvents(events, key, "key");
        appendEvents(events, value);
      }
      events.push({ kind: "objectEnd" }, { kind: "end" });
      let eventIndex = 0;
      const created = createIncrementalCanonicalJsonEncoderV1(
        makeIncrementalCanonicalJsonEventSourceV1(() => {
          const event = events[eventIndex];
          if (event === undefined) throw new Error("source exhausted");
          eventIndex += 1;
          return event;
        }),
        LARGE_LIMITS,
      );
      if (Result.isFailure(created)) throw created.failure;
      let failure: string | undefined;
      for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
        const result = created.success.step(1);
        if (Result.isFailure(result)) {
          failure = result.failure.reason;
          break;
        }
      }
      expect(failure).toBe("invalidInput");
    }
  });

  test("pins the 32-byte finite-number scratch against boundary/property vectors", () => {
    const boundaryNumbers = [
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      0.000001,
      0.0000001,
      999999999999999900000,
      Math.PI,
      -Math.E,
    ];
    const bits = new ArrayBuffer(8);
    const view = new DataView(bits);
    for (let index = 0; index < 1_000; index += 1) {
      view.setUint32(0, Math.imul(index + 1, 0x9e3779b1), false);
      view.setUint32(4, Math.imul(index + 17, 0x85ebca6b), false);
      const value = view.getFloat64(0, false);
      if (Number.isFinite(value)) boundaryNumbers.push(value);
    }
    for (const value of boundaryNumbers) {
      const spelling = JSON.stringify(value);
      expect(UTF8.encode(spelling).byteLength).toBeLessThanOrEqual(32);
      expect(driveEncode(value).bytes).toEqual(UTF8.encode(spelling));
      expect(driveDecode([UTF8.encode(spelling)]).value).toBe(value);
    }
  });

  test("tracks JSON membership and Unicode validity without changing syntax order", () => {
    const overflow = driveDecode([UTF8.encode("1e999")]);
    expect(overflow.jsonMembership).toBe(false);
    expect(overflow.canonical).toBe(false);

    const pair = driveDecode([UTF8.encode("\"\\ud83d\\ude00\"")]);
    expect(pair.value).toBe("😀");
    expect(pair.wellFormedUnicode).toBe(true);
    expect(pair.canonical).toBe(false);
    expect(pair.receipt.aggregate.stringBytes).toBe(4);
    expect(pair.receipt.aggregate.canonicalBytes).toBe(6);

    const unpaired = driveDecode([UTF8.encode("\"\\ud800\"")]);
    expect(unpaired.wellFormedUnicode).toBe(false);
  });

  test("preserves valid long-number values through bounded conversion scratch", () => {
    const one = `1.${"0".repeat(40)}`;
    const decodedOne = driveDecode([UTF8.encode(one)], LARGE_LIMITS, 1);
    expect(decodedOne.value).toBe(1);
    expect(decodedOne.canonical).toBe(false);
    expect(decodedOne.jsonMembership).toBe(true);

    const tiny = `0.${"0".repeat(330)}1`;
    const decodedTiny = driveDecode([UTF8.encode(tiny)], LARGE_LIMITS, 3);
    expect(decodedTiny.value).toBe(0);
    expect(decodedTiny.jsonMembership).toBe(true);

    let state = 0x1357_9bdf;
    for (let index = 0; index < 100; index += 1) {
      const digits: string[] = ["1"];
      const length = 33 + (index * 37) % 900;
      for (let digit = 1; digit < length; digit += 1) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        digits.push(String(state % 10));
      }
      const text = `${digits[0]}.${digits.slice(1).join("")}e${
        (index % 601) - 300
      }`;
      const expected = Number(text);
      const decoded = driveDecode([UTF8.encode(text)], LARGE_LIMITS, 7);
      if (Number.isFinite(expected)) {
        expect(decoded.value, `vector ${index}`).toBe(expected);
        expect(decoded.jsonMembership, `vector ${index}`).toBe(true);
      } else {
        expect(decoded.jsonMembership, `vector ${index}`).toBe(false);
      }
    }

    const cancellationLimits = ownedLimits({
      maximumInputBytes: 100_100,
      maximumCanonicalBytes: 100_100,
      maximumStringBytes: 0,
      maximumMembers: 0,
      maximumDepth: 0,
    });
    for (const text of [
      `1${"0".repeat(100_001)}e-100001`,
      `0.${"0".repeat(100_000)}1e100001`,
    ]) {
      const decoded = driveDecode(
        [UTF8.encode(text)],
        cancellationLimits,
        1_024,
      );
      expect(decoded.value, text.slice(-16)).toBe(1);
      expect(decoded.jsonMembership).toBe(true);
      expect(decoded.canonical).toBe(false);
    }
  });

  test("preserves an escaped high surrogate before following text", () => {
    for (const [text, expected] of [
      ["\"\\ud800A\"", "\ud800A"],
      ["\"\\ud800\\n\"", "\ud800\n"],
    ] as const) {
      const decoded = driveDecode([UTF8.encode(text)], LARGE_LIMITS, 1);
      expect(decoded.value).toBe(expected);
      expect(decoded.wellFormedUnicode).toBe(false);
    }
  });

  test("enforces escaped-pair canonical and string ceilings exactly", () => {
    const bytes = UTF8.encode("\"\\ud83d\\ude00\"");
    const exact = {
      maximumInputBytes: bytes.byteLength,
      maximumCanonicalBytes: 6,
      maximumStringBytes: 4,
      maximumMembers: 0,
      maximumDepth: 0,
    };
    expect(driveDecode([bytes], exact, 1).value).toBe("😀");
    for (const key of [
      "maximumCanonicalBytes",
      "maximumStringBytes",
    ] as const) {
      const created = createIncrementalCanonicalJsonDecoderV1(ownedLimits({
        ...exact,
        [key]: exact[key] - 1,
      }), materializer().sink);
      if (Result.isFailure(created)) throw created.failure;
      let failed: string | undefined;
      let offset = 0;
      for (let index = 0; index < ITERATION_LIMIT; index += 1) {
        const result = offset < bytes.byteLength
          ? created.success.step(bytes.subarray(offset), 1)
          : created.success.finish(1);
        if (Result.isFailure(result)) {
          failed = result.failure.reason;
          break;
        }
        offset += result.success.consumedInputBytes;
      }
      expect(failed, key).toBe("budgetExceeded");
    }
  });

  test("zero allowance is pending and terminal states refuse reuse", () => {
    const bytes = oracle({ a: 1 });
    const created = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      materializer().sink,
    );
    if (Result.isFailure(created)) throw created.failure;
    const zero = created.success.step(bytes, 0);
    expect(Result.isSuccess(zero)).toBe(true);
    if (Result.isSuccess(zero)) {
      expect(zero.success.status).toBe("pending");
      expect(zero.success.consumedInputBytes).toBe(0);
      expect(zero.success.receipt.delta.transitions).toBe(0);
    }
    let offset = 0;
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      const result = offset < bytes.byteLength
        ? created.success.step(bytes.subarray(offset), 1)
        : created.success.finish(1);
      if (Result.isFailure(result)) throw result.failure;
      offset += result.success.consumedInputBytes;
      if (result.success.status === "complete") break;
    }
    const reused = created.success.finish(1);
    expect(Result.isFailure(reused)).toBe(true);
    if (Result.isFailure(reused)) expect(reused.failure.reason).toBe("closed");
  });

  test("rejects allowances above 1,024 before source or sink work", () => {
    let sourcePulls = 0;
    const encoder = createIncrementalCanonicalJsonEncoderV1(
      makeIncrementalCanonicalJsonEventSourceV1(() => {
        sourcePulls += 1;
        return { kind: "null" };
      }),
      LARGE_LIMITS,
    );
    if (Result.isFailure(encoder)) throw encoder.failure;
    const encoded = encoder.success.step(1_025);
    expect(Result.isFailure(encoded)).toBe(true);
    expect(sourcePulls).toBe(0);

    let sinkPushes = 0;
    const decoder = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      makeIncrementalCanonicalJsonEventSinkV1(() => {
        sinkPushes += 1;
      }),
    );
    if (Result.isFailure(decoder)) throw decoder.failure;
    const decoded = decoder.success.step(UTF8.encode("null"), 1_025);
    expect(Result.isFailure(decoded)).toBe(true);
    expect(sinkPushes).toBe(0);

    let byteSinkPushes = 0;
    const byteSinkEncoder = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source(null),
      makeIncrementalCanonicalJsonByteSinkV1(() => {
        byteSinkPushes += 1;
      }),
      LARGE_LIMITS,
    );
    if (Result.isFailure(byteSinkEncoder)) throw byteSinkEncoder.failure;
    const byteSinkResult = byteSinkEncoder.success.step(1_025);
    expect(Result.isFailure(byteSinkResult)).toBe(true);
    expect(byteSinkPushes).toBe(0);
  });

  test("rejects copied structural cursor handles as invalid input", () => {
    const sourceResult = createIncrementalCanonicalJsonEncoderV1(
      { _tag: "IncrementalCanonicalJsonEventSourceV1" },
      LARGE_LIMITS,
    );
    expect(Result.isFailure(sourceResult)).toBe(true);
    if (Result.isFailure(sourceResult)) {
      expect(sourceResult.failure.reason).toBe("invalidInput");
    }

    const sinkResult = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      { _tag: "IncrementalCanonicalJsonEventSinkV1" },
    );
    expect(Result.isFailure(sinkResult)).toBe(true);
    if (Result.isFailure(sinkResult)) {
      expect(sinkResult.failure.reason).toBe("invalidInput");
    }

    const byteSinkResult = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source(null),
      { _tag: "IncrementalCanonicalJsonByteSinkV1" },
      LARGE_LIMITS,
    );
    expect(Result.isFailure(byteSinkResult)).toBe(true);
    if (Result.isFailure(byteSinkResult)) {
      expect(byteSinkResult.failure.reason).toBe("invalidInput");
    }
  });

  test("terminalizes before rethrowing identical source and sink defects", () => {
    const sourceDefect = new Error("source defect");
    const encoder = createIncrementalCanonicalJsonEncoderV1(
      makeIncrementalCanonicalJsonEventSourceV1(() => {
        throw sourceDefect;
      }),
      LARGE_LIMITS,
    );
    if (Result.isFailure(encoder)) throw encoder.failure;
    let observedSource: unknown;
    try {
      encoder.success.step(1);
    } catch (cause) {
      observedSource = cause;
    }
    expect(observedSource).toBe(sourceDefect);
    const sourceReuse = encoder.success.finish(1);
    expect(Result.isFailure(sourceReuse)).toBe(true);
    if (Result.isFailure(sourceReuse)) {
      expect(sourceReuse.failure.reason).toBe("closed");
    }

    const sinkDefect = new Error("sink defect");
    const decoder = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      makeIncrementalCanonicalJsonEventSinkV1(() => {
        throw sinkDefect;
      }),
    );
    if (Result.isFailure(decoder)) throw decoder.failure;
    let observedSink: unknown;
    const nullBytes = UTF8.encode("null");
    let nullOffset = 0;
    for (let index = 0; index < 16 && observedSink === undefined; index += 1) {
      try {
        const result = nullOffset < nullBytes.byteLength
          ? decoder.success.step(nullBytes.subarray(nullOffset), 1)
          : decoder.success.finish(1);
        if (Result.isFailure(result)) throw result.failure;
        nullOffset += result.success.consumedInputBytes;
      } catch (cause) {
        observedSink = cause;
      }
    }
    expect(observedSink).toBe(sinkDefect);
    const sinkReuse = decoder.success.finish(1);
    expect(Result.isFailure(sinkReuse)).toBe(true);
    if (Result.isFailure(sinkReuse)) {
      expect(sinkReuse.failure.reason).toBe("closed");
    }

    const byteSinkDefect = new Error("byte sink defect");
    const byteSinkEncoder = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source(null),
      makeIncrementalCanonicalJsonByteSinkV1(() => {
        throw byteSinkDefect;
      }),
      LARGE_LIMITS,
    );
    if (Result.isFailure(byteSinkEncoder)) throw byteSinkEncoder.failure;
    let observedByteSink: unknown;
    for (let index = 0; index < 16 && observedByteSink === undefined; index += 1) {
      try {
        const result = byteSinkEncoder.success.step(1);
        if (Result.isFailure(result)) throw result.failure;
      } catch (cause) {
        observedByteSink = cause;
      }
    }
    expect(observedByteSink).toBe(byteSinkDefect);
    const byteSinkReuse = byteSinkEncoder.success.finish(1);
    expect(Result.isFailure(byteSinkReuse)).toBe(true);
    if (Result.isFailure(byteSinkReuse)) {
      expect(byteSinkReuse.failure.reason).toBe("closed");
    }
  });

  test("streams canonical bytes in exact offset order without contiguous output", () => {
    const value = {
      a: "split \u{1f642}",
      b: [null, true, -12.5e-7],
    } satisfies Json;
    const expected = oracle(value);
    for (const allowance of [1, 7, 1_024]) {
      const streamed = driveSinkEncode(value, LARGE_LIMITS, allowance);
      expect(streamed.bytes).toEqual(expected);
      expect(streamed.complete.canonicalByteLength).toBe(expected.byteLength);
      expect(streamed.complete.receipt.aggregate.canonicalBytes).toBe(
        expected.byteLength,
      );
      expect("bytes" in streamed.complete).toBe(false);
    }
    const zeroOutput: number[] = [];
    const zero = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source(value),
      makeIncrementalCanonicalJsonByteSinkV1((byte) => {
        zeroOutput.push(byte);
      }),
      LARGE_LIMITS,
    );
    if (Result.isFailure(zero)) throw zero.failure;
    const pending = zero.success.step(0);
    expect(Result.isSuccess(pending)).toBe(true);
    if (Result.isSuccess(pending)) {
      expect(pending.success.status).toBe("pending");
      expect(pending.success.receipt.delta.transitions).toBe(0);
    }
    expect(zeroOutput).toEqual([]);
  });

  test("checks the canonical ceiling before byte-sink observation", () => {
    const expected = oracle({ a: 1 });
    const observed: number[] = [];
    const created = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source({ a: 1 }),
      makeIncrementalCanonicalJsonByteSinkV1((byte) => {
        observed.push(byte);
      }),
      ownedLimits({
        ...LARGE_LIMITS,
        maximumCanonicalBytes: expected.byteLength - 1,
      }),
    );
    if (Result.isFailure(created)) throw created.failure;
    let failure: string | undefined;
    for (let index = 0; index < 100 && failure === undefined; index += 1) {
      const stepped = created.success.step(1);
      if (Result.isFailure(stepped)) {
        failure = stepped.failure.reason;
        expect(stepped.failure.dimension).toBe("canonicalBytes");
        expect(stepped.failure.observed).toBe(expected.byteLength);
        expect(stepped.failure.maximum).toBe(expected.byteLength - 1);
      }
    }
    expect(failure).toBe("budgetExceeded");
    expect(observed).toEqual(Array.from(expected.subarray(0, -1)));
  });

  test("refuses copied and revoked byte-sink handles without invoking traps", () => {
    const owned = makeIncrementalCanonicalJsonByteSinkV1(() => {
      throw new Error("must not be reached");
    });
    const copied = { ...owned };
    const copiedResult = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source(null),
      copied,
      LARGE_LIMITS,
    );
    expect(Result.isFailure(copiedResult)).toBe(true);

    const revocable = Proxy.revocable(owned, {});
    revocable.revoke();
    const revokedResult = createIncrementalCanonicalJsonByteSinkEncoderV1(
      source(null),
      revocable.proxy,
      LARGE_LIMITS,
    );
    expect(Result.isFailure(revokedResult)).toBe(true);
    if (Result.isFailure(revokedResult)) {
      expect(revokedResult.failure.reason).toBe("invalidInput");
    }
  });

  test("detaches source events and emits owned frozen sink events", () => {
    const mutable = { kind: "number", value: 1 } as {
      kind: "number";
      value: number;
    };
    let sourcePhase = 0;
    const encoder = createIncrementalCanonicalJsonEncoderV1(
      makeIncrementalCanonicalJsonEventSourceV1(() => {
        sourcePhase += 1;
        return sourcePhase === 1 ? mutable : { kind: "end" };
      }),
      LARGE_LIMITS,
    );
    if (Result.isFailure(encoder)) throw encoder.failure;
    const captured = encoder.success.step(1);
    if (Result.isFailure(captured)) throw captured.failure;
    mutable.value = 2;
    let encoded = captured.success;
    for (let index = 0; index < 100 && encoded.status === "pending"; index += 1) {
      const next = encoder.success.step(1);
      if (Result.isFailure(next)) throw next.failure;
      encoded = next.success;
    }
    expect(encoded.status).toBe("complete");
    if (encoded.status === "complete") {
      expect(new TextDecoder().decode(encoded.bytes)).toBe("1");
    }

    const observed: IncrementalCanonicalJsonSinkEventV1[] = [];
    const decoder = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      makeIncrementalCanonicalJsonEventSinkV1((event) => {
        expect(Object.isFrozen(event)).toBe(true);
        observed.push(event);
      }),
    );
    if (Result.isFailure(decoder)) throw decoder.failure;
    let offset = 0;
    const bytes = UTF8.encode("null");
    for (let index = 0; index < 100; index += 1) {
      const next = offset < bytes.byteLength
        ? decoder.success.step(bytes.subarray(offset), 1)
        : decoder.success.finish(1);
      if (Result.isFailure(next)) throw next.failure;
      offset += next.success.consumedInputBytes;
      if (next.success.status === "complete") break;
    }
    expect(observed).toEqual([{ kind: "null" }]);
  });

  test("rejects hostile proxies and does not retain consumed aliases", () => {
    const bytes = oracle({ a: "owned" });
    const hostile = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      materializer().sink,
    );
    if (Result.isFailure(hostile)) throw hostile.failure;
    expect(Result.isFailure(
      hostile.success.step(new Proxy(bytes, {}), 100),
    )).toBe(true);

    const alias = new Uint8Array(bytes);
    const owned = materializer();
    const created = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      owned.sink,
    );
    if (Result.isFailure(created)) throw created.failure;
    const first = created.success.step(alias, 1_000);
    if (Result.isFailure(first)) throw first.failure;
    const consumed = first.success.consumedInputBytes;
    alias.fill(0, 0, consumed);
    let offset = consumed;
    let final: IncrementalCanonicalJsonDecodeStepV1 = first.success;
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      if (final.status === "complete") break;
      const next = offset < bytes.byteLength
        ? created.success.step(bytes.subarray(offset), 1_000)
        : created.success.finish(1_000);
      if (Result.isFailure(next)) throw next.failure;
      offset += next.success.consumedInputBytes;
      final = next.success;
    }
    expect(final.status).toBe("complete");
    if (final.status === "complete") {
      expect(owned.value()).toEqual({ a: "owned" });
      expect(Object.getPrototypeOf(owned.value())).toBe(Object.prototype);
    }
  });

  test("requires owned limits without enumerating hostile keys", () => {
    let ownKeysCalls = 0;
    const hostile = new Proxy({
      maximumInputBytes: 10,
      maximumCanonicalBytes: 10,
      maximumStringBytes: 10,
      maximumMembers: 10,
      maximumDepth: 10,
    }, {
      ownKeys: () => {
        ownKeysCalls += 1;
        throw new Error("must not enumerate");
      },
    });
    const created = createIncrementalCanonicalJsonDecoderV1(
      hostile,
      materializer().sink,
    );
    expect(Result.isFailure(created)).toBe(true);
    expect(ownKeysCalls).toBe(0);
  });

  test("uses the intrinsic visible byte range despite shadowed properties", () => {
    const supplied = UTF8.encode("null");
    const substituted = UTF8.encode("true");
    Object.defineProperty(supplied, "buffer", {
      value: substituted.buffer,
    });
    Object.defineProperty(supplied, "byteOffset", {
      value: substituted.byteOffset,
    });
    expect(driveDecode([supplied], LARGE_LIMITS, 1).value).toBeNull();
  });

  test("enforces empty-container depth before writing an opener", () => {
    for (const bytes of [UTF8.encode("{}"), UTF8.encode("[]")]) {
      const created = createIncrementalCanonicalJsonDecoderV1(ownedLimits({
        ...LARGE_LIMITS,
        maximumDepth: 0,
      }), materializer().sink);
      if (Result.isFailure(created)) throw created.failure;
      const failed = created.success.step(bytes, 100);
      expect(Result.isFailure(failed)).toBe(true);
      if (Result.isFailure(failed)) {
        expect(failed.failure.reason).toBe("budgetExceeded");
        expect(failed.failure.dimension).toBe("depth");
      }
    }
    for (const value of [{} as Json, [] as Json]) {
      const created = createIncrementalCanonicalJsonEncoderV1(
        source(value),
        ownedLimits({
          ...LARGE_LIMITS,
          maximumDepth: 0,
        }),
      );
      if (Result.isFailure(created)) throw created.failure;
      const failed = created.success.step(100);
      expect(Result.isFailure(failed)).toBe(true);
      if (Result.isFailure(failed)) {
        expect(failed.failure.reason).toBe("budgetExceeded");
        expect(failed.failure.dimension).toBe("depth");
      }
    }
  });

  test("rejects invalid allowances and detached input without leaking native errors", () => {
    const bytes = oracle({ a: 1 });
    const invalid = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      materializer().sink,
    );
    if (Result.isFailure(invalid)) throw invalid.failure;
    const failed = invalid.success.step(bytes, -1);
    expect(Result.isFailure(failed)).toBe(true);
    if (Result.isFailure(failed)) {
      expect(failed.failure.reason).toBe("invalidInput");
    }

    const buffer = new ArrayBuffer(bytes.byteLength);
    const detached = new Uint8Array(buffer);
    detached.set(bytes);
    structuredClone(buffer, { transfer: [buffer] });
    const created = createIncrementalCanonicalJsonDecoderV1(
      LARGE_LIMITS,
      materializer().sink,
    );
    if (Result.isFailure(created)) throw created.failure;
    const detachedResult = created.success.step(detached, 10);
    expect(Result.isFailure(detachedResult)).toBe(true);
    if (Result.isFailure(detachedResult)) {
      expect(detachedResult.failure.reason).toBe("invalidInput");
    }
  });

  test("keeps whole-call JSON, native sorting, and caller-sized maps off the source path", () => {
    for (const source of [
      "../src/declarativeV2IncrementalCanonicalJsonV1.ts",
      "../src/declarativeV2SemanticRecordsV1.ts",
      "../src/declarativeV2VerificationEvidenceV2.ts",
    ]) {
      const text = readFileSync(new URL(source, import.meta.url), "utf8");
      expect(text).not.toContain("JSON.parse");
      expect(text).not.toContain("encodeCanonicalJson");
      expect(text).not.toContain(".sort(");
      expect(text).not.toContain("new Map");
      expect(text).not.toContain("new Set");
      expect(text).not.toContain("Reflect.ownKeys");
      expect(text).not.toContain("Object.keys");
      expect(text).not.toContain("IncrementalCanonicalJsonSourceV1");
    }
  });
});

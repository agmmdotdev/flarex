import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeIndexKey, encodeIndexValue } from "../src/index-key";
import { encodeDocumentId } from "../src/document-id";
import {
  captureIndexRangeExpressions, captureLogicalQuery, compileIndexRange, fingerprintQuery, incrementIndexKeyPrefix,
  indexRangeIsEmpty, queryFingerprintJson, splitIndexRangeAfter, type IndexRangeExpression, type IndexRangeInterval,
} from "../src/index-range";

const hex = (bytes: Uint8Array | null) => bytes === null ? null : Buffer.from(bytes).toString("hex");
const compile = (expressions: readonly IndexRangeExpression[], fields: readonly string[] = ["a", "_creationTime"]) =>
  Result.getOrThrow(compileIndexRange(Result.getOrThrow(captureIndexRangeExpressions(expressions)), fields));
const bounds = (interval: IndexRangeInterval) => [hex(interval.start), hex(interval.end)];

describe("source IndexRange split/compile", () => {
  it("matches source prefix increment and all operators without tuple padding", () => {
    expect(bounds(compile([]))).toEqual(["", null]);
    expect(bounds(compile([{ op: "eq", field: "a", value: "a" }]))).toEqual(["106100", "106101"]);
    expect(bounds(compile([{ op: "gt", field: "a", value: "a" }]))).toEqual(["106101", null]);
    expect(bounds(compile([{ op: "gte", field: "a", value: "a" }]))).toEqual(["106100", null]);
    expect(bounds(compile([{ op: "lt", field: "a", value: "a" }]))).toEqual(["", "106100"]);
    expect(bounds(compile([{ op: "lte", field: "a", value: "a" }]))).toEqual(["", "106101"]);
    expect(hex(incrementIndexKeyPrefix(Uint8Array.of(1, 255, 255)))).toBe("02");
    expect(incrementIndexKeyPrefix(Uint8Array.of(255))).toBeNull();
    expect(incrementIndexKeyPrefix(new Uint8Array())).toBeNull();
  });

  it("rank-sorts equality expressions and uses tight full-key ends only including implicit _id", () => {
    const id = Result.getOrThrow(encodeDocumentId(1, new Uint8Array(16)));
    const fullKey = Result.getOrThrow(encodeIndexKey(["a", 1], id));
    const equality = compile([
      { op: "eq", field: "_id", value: id }, { op: "eq", field: "_creationTime", value: 1 }, { op: "eq", field: "a", value: "a" },
    ]);
    expect(equality.start).toEqual(fullKey);
    expect(equality.end).toEqual(Uint8Array.of(...fullKey, 0));
    const inclusive = compile([
      { op: "eq", field: "a", value: "a" }, { op: "eq", field: "_creationTime", value: 1 }, { op: "lte", field: "_id", value: id },
    ]);
    expect(inclusive.end).toEqual(equality.end);
    expect(bounds(compile([{ op: "eq", field: "_id", value: id }], []))).toEqual([hex(Result.getOrThrow(encodeIndexValue(id))), hex(Uint8Array.of(...Result.getOrThrow(encodeIndexValue(id)), 0))]);
    expect(bounds(compile([{ op: "eq", field: "_creationTime", value: 1 }], ["_creationTime"]))).toEqual(["0dbff0000000000000", "0dbff0000000000001"]);
    const reordered = compile([{ op: "lt", field: "b", value: 3 }, { op: "eq", field: "a", value: 1 }, { op: "gt", field: "b", value: 2 }], ["a", "b"]);
    expect(bounds(reordered)).toEqual(bounds(compile([{ op: "eq", field: "a", value: 1 }, { op: "gt", field: "b", value: 2 }, { op: "lt", field: "b", value: 3 }], ["a", "b"])));
  });

  it("preserves literal escaped-prefix behavior for string, bytes and object values", () => {
    const id = Result.getOrThrow(encodeDocumentId(1, new Uint8Array(16)));
    const cases = [
      ["a", "a\0"],
      [Uint8Array.of(1).buffer, Uint8Array.of(1, 0).buffer],
      [{}, { "": null }],
    ] as const;
    for (const [value, continued] of cases) {
      const interval = compile([{ op: "eq", field: "a", value }], ["a"]);
      const key = Result.getOrThrow(encodeIndexKey([continued], id));
      const encodedValue = Result.getOrThrow(encodeIndexValue(value));
      // String/bytes source escaping permits a zero-continued value inside this prefix interval.
      // Empty object field names escape its final 00 terminator in the same way.
      expect(Buffer.compare(Buffer.from(key), Buffer.from(interval.start))).toBeGreaterThanOrEqual(0);
      expect(interval.end !== null && Buffer.compare(Buffer.from(key), Buffer.from(interval.end)) < 0).toBe(true);
      expect(interval.start).toEqual(encodedValue);
    }
  });

  it("keeps missing/null, nested paths, long keys and empty/inverted ranges", () => {
    expect(bounds(compile([{ op: "eq", field: "a", value: undefined }]))).toEqual(["01", "02"]);
    expect(bounds(compile([{ op: "eq", field: "a", value: null }]))).toEqual(["03", "04"]);
    expect(bounds(compile([{ op: "eq", field: "a.b", value: true }], ["a.b"]))).toEqual(["0f", "10"]);
    const deepPath = Array.from({ length: 40 }, () => "a").join(".");
    expect(bounds(compile([{ op: "eq", field: deepPath, value: true }], [deepPath]))).toEqual(["0f", "10"]);
    const long = compile([{ op: "eq", field: "a", value: "x".repeat(4000) }]);
    expect(long.start.byteLength).toBe(4002);
    expect(indexRangeIsEmpty(compile([{ op: "gt", field: "a", value: 2 }, { op: "lt", field: "a", value: 1 }]))).toBe(true);
    expect(indexRangeIsEmpty(compile([{ op: "gte", field: "a", value: 1 }, { op: "lt", field: "a", value: 1 }]))).toBe(true);
    expect(indexRangeIsEmpty(compile([]))).toBe(false);
  });

  it("retains source split, bound-conflict and lexical missing-field failure order", () => {
    const failure = (expressions: readonly IndexRangeExpression[], fields: readonly string[] = ["a"]) => {
      const result = compileIndexRange(Result.getOrThrow(captureIndexRangeExpressions(expressions)), fields);
      if (Result.isSuccess(result)) throw new Error("Expected failure");
      return result.failure;
    };
    expect(failure([{ op: "eq", field: "z", value: 1 }, { op: "eq", field: "z", value: 2 }])).toMatchObject({ reason: "alreadyDefinedBound", bound: "equality", field: "z" });
    expect(failure([{ op: "gt", field: "a", value: 1 }, { op: "gte", field: "z", value: 2 }])).toMatchObject({ reason: "alreadyDefinedBound", bound: "lower", field: "z" });
    expect(failure([{ op: "gt", field: "a", value: 1 }, { op: "lt", field: "z", value: 2 }])).toMatchObject({ reason: "boundsOnMultipleFields", field: "z" });
    expect(failure([{ op: "eq", field: "z", value: 1 }, { op: "gt", field: "z", value: 2 }])).toMatchObject({ reason: "alreadyDefinedBound", bound: "inequality" });
    expect(failure([{ op: "eq", field: "z", value: 1 }, { op: "eq", field: "b", value: 1 }])).toMatchObject({ reason: "fieldNotInIndex", field: "b" });
    expect(failure([{ op: "eq", field: "b", value: 1 }], ["a", "b"])).toMatchObject({ reason: "invalidIndexRange", field: "b" });
  });

  it("captures data once without getters and detaches operands before established-value compilation", () => {
    let invoked = false;
    const getter = { get op() { invoked = true; return "eq"; }, field: "a", value: 1 };
    expect(Result.isFailure(captureIndexRangeExpressions([getter]))).toBe(true);
    expect(invoked).toBe(false);
    expect(Result.isFailure(captureLogicalQuery({ get source() { invoked = true; return {}; }, operators: [] }))).toBe(true);
    expect(invoked).toBe(false);
    const bytes = Uint8Array.of(1, 2);
    const expressions = Result.getOrThrow(captureIndexRangeExpressions([{ op: "eq", field: ".a.", value: { bytes: bytes.buffer } }]));
    const before = bounds(Result.getOrThrow(compileIndexRange(expressions, ["a"])));
    bytes.fill(255);
    expect(bounds(Result.getOrThrow(compileIndexRange(expressions, ["a"])))).toEqual(before);
    expect(expressions[0]?.field).toBe("a");
    expect(Result.isFailure(captureIndexRangeExpressions([{ op: "eq", field: "a", value: () => 1 }]))).toBe(true);
    expect(Result.isFailure(captureIndexRangeExpressions([{ op: "eq", field: "a", value: null, extra: 1 }]))).toBe(true);
  });

  it("splits consumed frontiers in both orders and clips a singleton ascending end", () => {
    const interval = { start: Uint8Array.of(1), end: Uint8Array.of(8) };
    const ascending = splitIndexRangeAfter(interval, Uint8Array.of(3, 255), "asc");
    expect(bounds(ascending.observed)).toEqual(["01", "04"]);
    expect(bounds(ascending.remaining)).toEqual(["04", "08"]);
    const descending = splitIndexRangeAfter(interval, Uint8Array.of(3, 255), "desc");
    expect(bounds(descending.observed)).toEqual(["03ff", "08"]);
    expect(bounds(descending.remaining)).toEqual(["01", "03ff"]);
    const singleton = { start: Uint8Array.of(1), end: Uint8Array.of(1, 0) };
    const split = splitIndexRangeAfter(singleton, Uint8Array.of(1), "asc");
    expect(bounds(split.observed)).toEqual(bounds(singleton));
    expect(indexRangeIsEmpty(split.remaining)).toBe(true);
  });
});

describe("query identity", () => {
  it("matches the pinned serde_json 1.0.151 / zmij 1.0.23 floating-point and integer-limit golden", () => {
    // Rust source probe preserves serde_json's f64 Number variant through to_value.
    const query = Result.getOrThrow(captureLogicalQuery({ source: {
      type: "IndexRange", indexName: "users.by_number", range: [{ op: "eq", field: "number", value: 1 }], order: "asc",
    }, operators: [{ limit: 1 }] }));
    expect(queryFingerprintJson(query, ["number", "_creationTime"])).toBe('{"query":{"source":{"type":"IndexRange","indexName":"users.by_number","range":[{"type":"Eq","fieldPath":"number","value":1.0}],"order":"asc"},"operators":[{"limit":1}]},"indexed_fields":["number","_creationTime"]}');
    expect(Buffer.from(fingerprintQuery(query, ["number", "_creationTime"])).toString("hex")).toBe("af2e4db3e2846d14fa186d844b2f69fb990cf2cdc6d935de58aa19a36bb61d5f");
  });

  it("retains verified source float exponent boundaries, subnormal/extreme values and f64 .0", () => {
    // Selected from the 5016-vector Rust probe. The standalone probe was compared
    // in full; retain meaningful witnesses here rather than random fixture bulk.
    const vectors: readonly [string, string][] = [
      ["0000000000000000", "0.0"], ["3ff0000000000000", "1.0"], ["3ff8000000000000", "1.5"],
      ["3e7ad7f29abcaf48", "1e-7"], ["3eb0c6f7a0b5ed8d", "1e-6"], ["3ee4f8b588e368f1", "0.00001"],
      ["430c6bf526340000", "1000000000000000.0"], ["4341c37937e08000", "1e+16"],
      ["4415af1d78b58c40", "1e+20"], ["0010000000000000", "2.2250738585072014e-308"],
      ["7fefffffffffffff", "1.7976931348623157e+308"], ["0000000000000001", "5e-324"],
      ["41d26580b487e6b7", "1234567890.1234567"], ["6c576fac43fd007c", "7.889773721040559e+213"],
      ["826886b3864a1b1b", "-4.687746771783661e-297"], ["cba276b4b881a9f0", "-2.2636424301763047e+56"],
    ];
    for (const [bits, expected] of vectors) {
      const value = Buffer.from(bits, "hex").readDoubleBE();
      const query = Result.getOrThrow(captureLogicalQuery({ source: {
        type: "IndexRange", indexName: "users.by_number", range: [{ op: "eq", field: "number", value }], order: "asc",
      }, operators: [] }));
      expect(queryFingerprintJson(query, ["number"]), bits).toContain(`"value":${expected}}`);
    }
    const special = Result.getOrThrow(captureLogicalQuery({ source: {
      type: "IndexRange", indexName: "users.by_number", range: [{ op: "eq", field: "number", value: -0 }], order: "asc",
    }, operators: [] }));
    expect(queryFingerprintJson(special, ["number"])).toContain('"value":{"$float":"AAAAAAAAAIA="}');
  });

  it("uses source ordered JSON including source kind, original expression order, operators and selected fields", () => {
    const query = Result.getOrThrow(captureLogicalQuery({ source: { type: "FullTableScan", tableName: "items", order: "asc" }, operators: [] }));
    const json = '{"query":{"source":{"type":"FullTableScan","tableName":"items","order":"asc"},"operators":[]},"indexed_fields":["_creationTime"]}';
    expect(queryFingerprintJson(query, ["_creationTime"])).toBe(json);
    expect(Buffer.from(fingerprintQuery(query, ["_creationTime"]))).toEqual(createHash("sha256").update(json).digest());
    const defaultOrder = Result.getOrThrow(captureLogicalQuery({ source: { type: "FullTableScan", tableName: "items" }, operators: [] }));
    const nullOrder = Result.getOrThrow(captureLogicalQuery({ source: { type: "FullTableScan", tableName: "items", order: null }, operators: [] }));
    expect(fingerprintQuery(defaultOrder, ["_creationTime"])).toEqual(fingerprintQuery(query, ["_creationTime"]));
    expect(fingerprintQuery(nullOrder, ["_creationTime"])).toEqual(fingerprintQuery(query, ["_creationTime"]));
    const indexQuery = (range: readonly IndexRangeExpression[], order = "asc", operators: readonly { limit: number }[] = []) => Result.getOrThrow(captureLogicalQuery({
      source: { type: "IndexRange", indexName: "items.by_a", range, order }, operators,
    }));
    const original = [{ op: "eq", field: "a", value: true }, { op: "gte", field: "b", value: undefined }] as const;
    const base = fingerprintQuery(indexQuery(original), ["a", "b"]);
    expect(fingerprintQuery(indexQuery([...original].reverse()), ["a", "b"])).not.toEqual(base);
    expect(fingerprintQuery(indexQuery(original, "desc"), ["a", "b"])).not.toEqual(base);
    expect(fingerprintQuery(indexQuery(original, "asc", [{ limit: 1 }]), ["a", "b"])).not.toEqual(base);
    expect(fingerprintQuery(indexQuery(original), ["b", "a"])).not.toEqual(base);
    expect(queryFingerprintJson(indexQuery(original), ["a", "b"])).toContain('{"type":"Gte","fieldPath":"b","value":{"$undefined":null}}');
    expect(Result.isFailure(captureLogicalQuery({ source: { type: "FullTableScan", tableName: "items", order: "asc" }, operators: [{ limit: -1 }] }))).toBe(true);
  });
});

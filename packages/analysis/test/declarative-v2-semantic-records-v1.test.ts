import { Result } from "effect";
import {
  encodeCanonicalJson,
  type Json,
} from "flarex-protocol/json";
import { describe, expect, test } from "vitest";

import {
  createDeclarativeV2SemanticStreamDecoderV1,
  makeDeclarativeV2SemanticStreamBudgetV1,
  type DeclarativeV2SemanticRecordV1,
  type DeclarativeV2SemanticStreamBudgetV1,
} from "../src/declarativeV2SemanticRecordsV1";

const UTF8 = new TextEncoder();
const ITERATION_LIMIT = 1_000_000;

const records: ReadonlyArray<DeclarativeV2SemanticRecordV1> = [
  { kind: "header", version: 1 },
  { kind: "module", modulePath: "functions/example.js" },
  {
    kind: "function",
    path: "example:getThing",
    modulePath: "functions/example.js",
    exportName: "getThing",
    functionKind: "query",
    visibility: "public",
    argsValidatorId: "validator:args",
    returnsValidatorId: "validator:returns",
    partition: null,
  },
  { kind: "schema", schemaVersion: "1" },
  {
    kind: "table",
    name: "documents",
    documentValidatorId: "validator:document",
  },
  {
    kind: "index",
    tableName: "documents",
    name: "by_owner",
    fields: ["owner", "_creationTime"],
  },
  {
    kind: "validator",
    id: "validator:args",
    value: { fields: {}, type: "object" },
  },
  {
    kind: "validator",
    id: "validator:document",
    value: { fields: { owner: { type: "string" } }, type: "object" },
  },
  {
    kind: "validator",
    id: "validator:returns",
    value: { type: "string" },
  },
  {
    kind: "handler",
    functionPath: "example:getThing",
    modulePath: "functions/example.js",
    exportName: "getThing",
  },
];

function recordJson(value: DeclarativeV2SemanticRecordV1): Json {
  switch (value.kind) {
    case "header":
      return { kind: value.kind, version: value.version };
    case "module":
      return { kind: value.kind, modulePath: value.modulePath };
    case "function":
      return {
        argsValidatorId: value.argsValidatorId,
        exportName: value.exportName,
        functionKind: value.functionKind,
        kind: value.kind,
        modulePath: value.modulePath,
        partition: value.partition,
        path: value.path,
        returnsValidatorId: value.returnsValidatorId,
        visibility: value.visibility,
      };
    case "schema":
      return { kind: value.kind, schemaVersion: value.schemaVersion };
    case "table":
      return {
        documentValidatorId: value.documentValidatorId,
        kind: value.kind,
        name: value.name,
      };
    case "index":
      return {
        fields: value.fields,
        kind: value.kind,
        name: value.name,
        tableName: value.tableName,
      };
    case "validator":
      return { id: value.id, kind: value.kind, value: value.value };
    case "handler":
      return {
        exportName: value.exportName,
        functionPath: value.functionPath,
        kind: value.kind,
        modulePath: value.modulePath,
      };
  }
}

function encodeRecord(value: DeclarativeV2SemanticRecordV1): Uint8Array {
  return UTF8.encode(encodeCanonicalJson(recordJson(value), () => {
    throw new Error("semantic oracle received non-JSON");
  }));
}

function streamBytes(
  subset: ReadonlyArray<DeclarativeV2SemanticRecordV1> = records,
): Uint8Array {
  const lines = subset.map((record) =>
    new TextDecoder().decode(encodeRecord(record))
  );
  return UTF8.encode(`${lines.join("\n")}\n`);
}

function budget(
  bytes: Uint8Array,
  subset: ReadonlyArray<DeclarativeV2SemanticRecordV1> = records,
  mutate?: Partial<DeclarativeV2SemanticStreamBudgetV1>,
): DeclarativeV2SemanticStreamBudgetV1 {
  const encoded = subset.map(encodeRecord);
  return ownedBudget({
    maximumInputBytes: mutate?.maximumInputBytes ?? bytes.byteLength,
    maximumRecordBytes: mutate?.maximumRecordBytes ??
      Math.max(...encoded.map((value) => value.byteLength)),
    maximumRecords: mutate?.maximumRecords ?? subset.length,
    maximumCanonicalBytes: mutate?.maximumCanonicalBytes ??
      encoded.reduce((sum, value) => sum + value.byteLength, 0),
  });
}

function ownedBudget(
  value: DeclarativeV2SemanticStreamBudgetV1,
): DeclarativeV2SemanticStreamBudgetV1 {
  const result = makeDeclarativeV2SemanticStreamBudgetV1(
    value.maximumInputBytes,
    value.maximumRecordBytes,
    value.maximumRecords,
    value.maximumCanonicalBytes,
  );
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function drive(
  chunks: ReadonlyArray<Uint8Array>,
  streamBudget: DeclarativeV2SemanticStreamBudgetV1,
  allowance = 23,
): Readonly<{
  readonly records: ReadonlyArray<DeclarativeV2SemanticRecordV1>;
  readonly usage: Readonly<{
    readonly inputBytes: number;
    readonly records: number;
    readonly canonicalBytes: number;
  }>;
  readonly mechanical: Readonly<{
    readonly inputBytes: number;
    readonly canonicalBytes: number;
    readonly stringBytes: number;
    readonly members: number;
    readonly depth: number;
    readonly transitions: number;
  }>;
}> {
  const created = createDeclarativeV2SemanticStreamDecoderV1(
    ownedBudget(streamBudget),
  );
  if (Result.isFailure(created)) throw created.failure;
  const output: DeclarativeV2SemanticRecordV1[] = [];
  let lastUsage = {
    inputBytes: 0,
    records: 0,
    canonicalBytes: 0,
  };
  let lastMechanical = {
    inputBytes: 0,
    canonicalBytes: 0,
    stringBytes: 0,
    members: 0,
    depth: 0,
    transitions: 0,
  };
  let iterations = 0;
  for (const chunk of chunks) {
    let offset = 0;
    while (true) {
      if (iterations++ >= ITERATION_LIMIT) throw new Error("semantic stalled");
      const result = created.success.push(
        chunk.subarray(offset),
        allowance,
      );
      if (Result.isFailure(result)) throw result.failure;
      expect(result.success.mechanical.delta.transitions)
        .toBeLessThanOrEqual(allowance);
      offset += result.success.consumedInputBytes;
      output.push(...result.success.records);
      lastUsage = result.success.usage;
      lastMechanical = result.success.mechanical.aggregate;
      if (
        offset >= chunk.byteLength &&
        result.success.mechanical.delta.transitions === 0
      ) {
        break;
      }
      if (
        offset >= chunk.byteLength &&
        result.success.records.length === 0 &&
        result.success.mechanical.delta.canonicalBytes === 0 &&
        result.success.mechanical.delta.stringBytes === 0 &&
        result.success.mechanical.delta.members === 0 &&
        result.success.mechanical.delta.transitions <= 1
      ) {
        const drained = created.success.push(new Uint8Array(), allowance);
        if (Result.isFailure(drained)) throw drained.failure;
        output.push(...drained.success.records);
        lastUsage = drained.success.usage;
        lastMechanical = drained.success.mechanical.aggregate;
        if (drained.success.mechanical.delta.transitions === 0) break;
      }
      if (offset < chunk.byteLength) continue;
      const drained = created.success.push(new Uint8Array(), allowance);
      if (Result.isFailure(drained)) throw drained.failure;
      output.push(...drained.success.records);
      lastUsage = drained.success.usage;
      lastMechanical = drained.success.mechanical.aggregate;
      if (drained.success.mechanical.delta.transitions === 0) break;
    }
  }
  for (; iterations < ITERATION_LIMIT; iterations += 1) {
    const finished = created.success.finish(allowance);
    if (Result.isFailure(finished)) throw finished.failure;
    expect(finished.success.mechanical.delta.transitions)
      .toBeLessThanOrEqual(allowance);
    output.push(...finished.success.records);
    lastUsage = finished.success.usage;
    lastMechanical = finished.success.mechanical.aggregate;
    if (finished.success.status === "complete") {
      return Object.freeze({
        records: Object.freeze(output),
        usage: Object.freeze(lastUsage),
        mechanical: Object.freeze(lastMechanical),
      });
    }
  }
  throw new Error("semantic finish stalled");
}

function failure(
  bytes: Uint8Array,
  streamBudget: DeclarativeV2SemanticStreamBudgetV1,
): string {
  const created = createDeclarativeV2SemanticStreamDecoderV1(
    ownedBudget(streamBudget),
  );
  if (Result.isFailure(created)) return created.failure.reason;
  let offset = 0;
  for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
    const result = offset < bytes.byteLength
      ? created.success.push(bytes.subarray(offset), 19)
      : created.success.push(new Uint8Array(), 19);
    if (Result.isFailure(result)) return result.failure.reason;
    offset += result.success.consumedInputBytes;
    if (
      offset >= bytes.byteLength &&
      result.success.mechanical.delta.transitions === 0
    ) {
      for (
        let finishIterations = 0;
        finishIterations < ITERATION_LIMIT;
        finishIterations += 1
      ) {
        const finished = created.success.finish(19);
        if (Result.isFailure(finished)) return finished.failure.reason;
        if (finished.success.status === "complete") return "success";
      }
      throw new Error("semantic failure finish stalled");
    }
  }
  throw new Error("semantic failure case stalled");
}

describe("Declarative V2 Semantic Artifact V1 records", () => {
  test("decodes strict canonical records with owned frozen projections", () => {
    const bytes = streamBytes();
    const decoded = drive([bytes], budget(bytes), 1);
    expect(decoded.records).toEqual(records);
    for (const record of decoded.records) {
      expect(Object.isFrozen(record)).toBe(true);
      if (record.kind === "validator") {
        expect(Object.isFrozen(record.value)).toBe(true);
      }
    }
  });

  test("is identical across every byte and UTF-8 split", () => {
    const unicodeRecords = [
      records[0]!,
      { kind: "module", modulePath: "functions/က😀.js" },
      records[3]!,
    ] satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    const bytes = streamBytes(unicodeRecords);
    const limits = budget(bytes, unicodeRecords);
    const baseline = drive([bytes], limits, 3);
    for (let split = 0; split <= bytes.byteLength; split += 1) {
      const decoded = drive([
        bytes.slice(0, split),
        bytes.slice(split),
      ], limits, 3);
      expect(decoded.records, `split ${split}`).toEqual(baseline.records);
      expect(decoded.usage, `split ${split}`).toEqual(baseline.usage);
      expect(decoded.mechanical, `split ${split}`).toEqual(
        baseline.mechanical,
      );
    }
  });

  test("finish drains pending record work and owns deferred failures", () => {
    const subset = [records[0]!, records[3]!] as const;
    const bytes = streamBytes(subset);
    const created = createDeclarativeV2SemanticStreamDecoderV1(
      budget(bytes, subset),
    );
    if (Result.isFailure(created)) throw created.failure;
    const emitted: DeclarativeV2SemanticRecordV1[] = [];
    let offset = 0;
    const prefix = bytes.subarray(0, bytes.byteLength - 1);
    while (offset < prefix.byteLength) {
      const result = created.success.push(prefix.subarray(offset), 100);
      if (Result.isFailure(result)) throw result.failure;
      offset += result.success.consumedInputBytes;
      emitted.push(...result.success.records);
    }
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      const drained = created.success.push(new Uint8Array(), 100);
      if (Result.isFailure(drained)) throw drained.failure;
      emitted.push(...drained.success.records);
      if (drained.success.mechanical.delta.transitions === 0) break;
    }
    const admitted = created.success.push(bytes.subarray(bytes.byteLength - 1), 1);
    if (Result.isFailure(admitted)) throw admitted.failure;
    expect(admitted.success.consumedInputBytes).toBe(1);
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      const result = created.success.finish(1);
      if (Result.isFailure(result)) throw result.failure;
      emitted.push(...result.success.records);
      if (result.success.status === "complete") break;
    }
    expect(emitted).toEqual(subset);

    const malformed = UTF8.encode("{\n");
    const invalid = createDeclarativeV2SemanticStreamDecoderV1(ownedBudget({
      maximumInputBytes: malformed.byteLength,
      maximumRecordBytes: malformed.byteLength,
      maximumRecords: 1,
      maximumCanonicalBytes: malformed.byteLength,
    }));
    if (Result.isFailure(invalid)) throw invalid.failure;
    const pending = invalid.success.push(malformed, malformed.byteLength);
    if (Result.isFailure(pending)) throw pending.failure;
    const failed = invalid.success.finish(100);
    expect(Result.isFailure(failed)).toBe(true);
    if (Result.isFailure(failed)) {
      expect(failed.failure.operation).toBe("finish");
      expect(failed.failure.reason).toBe("malformedJson");
    }
  });

  test("returns exact receipts and rejects each one-less domain ceiling", () => {
    const bytes = streamBytes();
    const exact = budget(bytes);
    const decoded = drive([bytes], exact, 17);
    expect(decoded.usage).toEqual({
      inputBytes: exact.maximumInputBytes,
      records: exact.maximumRecords,
      canonicalBytes: exact.maximumCanonicalBytes,
    });
    for (const key of Object.keys(exact) as ReadonlyArray<keyof typeof exact>) {
      const value = exact[key];
      expect(failure(bytes, { ...exact, [key]: value - 1 }), key)
        .toBe("budgetExceeded");
    }
  });

  test("rejects an allowance above the fixed shared quantum before input", () => {
    const bytes = streamBytes();
    const created = createDeclarativeV2SemanticStreamDecoderV1(budget(bytes));
    if (Result.isFailure(created)) throw created.failure;
    const result = created.success.push(bytes, 1_025);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("invalidInput");
    }
  });

  test("keeps input admission and malformed first failure chunk-invariant", () => {
    const bytes = UTF8.encode("{\nignored");
    const limits = {
      maximumInputBytes: 2,
      maximumRecordBytes: 2,
      maximumRecords: 1,
      maximumCanonicalBytes: 2,
    };
    expect(failure(bytes, limits)).toBe("malformedJson");
    expect(failure(bytes.slice(0, 2), limits)).toBe("malformedJson");
  });

  test("orders composite index keys structurally without sentinels", () => {
    const subset = [
      records[0]!,
      records[3]!,
      {
        kind: "table",
        name: "a",
        documentValidatorId: "validator:a",
      },
      {
        kind: "table",
        name: "a\u0000",
        documentValidatorId: "validator:b",
      },
      {
        kind: "index",
        tableName: "a",
        name: "\u0000b",
        fields: ["field"],
      },
      {
        kind: "index",
        tableName: "a\u0000",
        name: "b",
        fields: ["field"],
      },
      {
        kind: "validator",
        id: "validator:a",
        value: { type: "string" },
      },
      {
        kind: "validator",
        id: "validator:b",
        value: { type: "string" },
      },
    ] satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    const bytes = streamBytes(subset);
    expect(drive([bytes], budget(bytes, subset), 1).records).toEqual(subset);
  });

  test("uses intrinsic bytes when view properties are shadowed", () => {
    const subset = [records[0]!, records[3]!] as const;
    const supplied = streamBytes(subset);
    const substituted = UTF8.encode("{\n");
    Object.defineProperty(supplied, "buffer", {
      value: substituted.buffer,
    });
    Object.defineProperty(supplied, "byteOffset", {
      value: substituted.byteOffset,
    });
    expect(drive([supplied], budget(supplied, subset), 1).records)
      .toEqual(subset);
  });

  test.each([
    ["unknown", "{\"kind\":\"future\"}\n", "unknownRecord"],
    ["missing header", "{\"kind\":\"module\",\"modulePath\":\"a.js\"}\n", "missingHeader"],
    [
      "duplicate",
      "{\"kind\":\"header\",\"version\":1}\n{\"kind\":\"module\",\"modulePath\":\"a.js\"}\n{\"kind\":\"module\",\"modulePath\":\"a.js\"}\n",
      "duplicateRecord",
    ],
    [
      "out of order",
      "{\"kind\":\"header\",\"version\":1}\n{\"kind\":\"schema\",\"schemaVersion\":\"1\"}\n{\"kind\":\"module\",\"modulePath\":\"a.js\"}\n",
      "recordOrder",
    ],
  ])("preserves deterministic %s failure order", (_name, text, reason) => {
    const bytes = UTF8.encode(text);
    expect(failure(bytes, {
      maximumInputBytes: bytes.byteLength,
      maximumRecordBytes: bytes.byteLength,
      maximumRecords: 10,
      maximumCanonicalBytes: bytes.byteLength,
    })).toBe(reason);
  });

  test("rejects noncanonical, malformed, invalid UTF-8, and missing final LF", () => {
    for (const [bytes, reason] of [
      [UTF8.encode("{\"version\":1,\"kind\":\"header\"}\n"), "nonCanonical"],
      [
        UTF8.encode(
          "{\"kind\":\"header\",\"kind\":\"future\",\"version\":1}\n",
        ),
        "unknownRecord",
      ],
      [UTF8.encode("{\n"), "malformedJson"],
      [new Uint8Array([0xc0, 0x0a]), "invalidUtf8"],
      [encodeRecord(records[0]!), "trailingBytes"],
    ] as const) {
      expect(failure(bytes, {
        maximumInputBytes: bytes.byteLength,
        maximumRecordBytes: bytes.byteLength,
        maximumRecords: 2,
        maximumCanonicalBytes: bytes.byteLength,
      })).toBe(reason);
    }
  });

  test("preserves domain validation before Unicode/canonical diagnostics", () => {
    const unknownNonCanonical = UTF8.encode(
      " {\"extra\":\"\\ud800\",\"kind\":\"future\"}\n",
    );
    expect(failure(unknownNonCanonical, {
      maximumInputBytes: unknownNonCanonical.byteLength,
      maximumRecordBytes: unknownNonCanonical.byteLength,
      maximumRecords: 1,
      maximumCanonicalBytes: unknownNonCanonical.byteLength,
    })).toBe("unknownRecord");

    const invalidHeader = UTF8.encode(
      "{\"kind\":\"header\",\"version\":2 }\n",
    );
    expect(failure(invalidHeader, {
      maximumInputBytes: invalidHeader.byteLength,
      maximumRecordBytes: invalidHeader.byteLength,
      maximumRecords: 1,
      maximumCanonicalBytes: invalidHeader.byteLength,
    })).toBe("invalidInput");

    const escapedPair = UTF8.encode(
      "{\"kind\":\"module\",\"modulePath\":\"functions/\\ud83d\\ude00.js\"}\n",
    );
    const pairStream = new Uint8Array(
      encodeRecord(records[0]!).byteLength + 1 + escapedPair.byteLength,
    );
    pairStream.set(encodeRecord(records[0]!));
    pairStream[encodeRecord(records[0]!).byteLength] = 0x0a;
    pairStream.set(
      escapedPair,
      encodeRecord(records[0]!).byteLength + 1,
    );
    expect(failure(pairStream, {
      maximumInputBytes: pairStream.byteLength,
      maximumRecordBytes: pairStream.byteLength,
      maximumRecords: 2,
      maximumCanonicalBytes: pairStream.byteLength,
    })).toBe("nonCanonical");
  });

  test.each([
    ["missing schema", [records[0]!, records[1]!]],
    [
      "missing referenced validator and handler",
      [records[0]!, records[1]!, records[2]!, records[3]!],
    ],
    [
      "index with no declared table",
      [records[0]!, records[1]!, records[3]!, records[5]!],
    ],
  ])("rejects %s at the resumable completeness boundary", (_name, subset) => {
    const bytes = streamBytes(subset);
    expect(failure(bytes, budget(bytes, subset))).toBe("missingRecord");
  });

  test("rejects hostile/revoked input and terminalizes a mixed failure", () => {
    let ownKeysCalls = 0;
    const hostileBudget = new Proxy({}, {
      ownKeys: () => {
        ownKeysCalls += 1;
        throw new Error("must not enumerate");
      },
    });
    expect(Result.isFailure(
      createDeclarativeV2SemanticStreamDecoderV1(hostileBudget),
    )).toBe(true);
    expect(ownKeysCalls).toBe(0);

    const bytes = streamBytes([records[0]!, records[3]!]);
    const created = createDeclarativeV2SemanticStreamDecoderV1(
      budget(bytes, [records[0]!, records[3]!]),
    );
    if (Result.isFailure(created)) throw created.failure;
    expect(Result.isFailure(
      created.success.push(new Proxy(bytes, {}), 100),
    )).toBe(true);
    expect(Result.isFailure(created.success.finish(100))).toBe(true);

    const mixed = UTF8.encode(
      "{\"kind\":\"header\",\"version\":1}\n{\"kind\":\"future\"}\n",
    );
    const terminal = createDeclarativeV2SemanticStreamDecoderV1(ownedBudget({
      maximumInputBytes: mixed.byteLength,
      maximumRecordBytes: mixed.byteLength,
      maximumRecords: 4,
      maximumCanonicalBytes: mixed.byteLength,
    }));
    if (Result.isFailure(terminal)) throw terminal.failure;
    let offset = 0;
    let observed: string | undefined;
    for (let iterations = 0; iterations < ITERATION_LIMIT; iterations += 1) {
      const result = terminal.success.push(mixed.subarray(offset), 11);
      if (Result.isFailure(result)) {
        observed = result.failure.reason;
        break;
      }
      offset += result.success.consumedInputBytes;
    }
    expect(observed).toBe("unknownRecord");
    const reused = terminal.success.push(mixed, 11);
    expect(Result.isFailure(reused)).toBe(true);
    if (Result.isFailure(reused)) expect(reused.failure.reason).toBe("closed");
  });
});

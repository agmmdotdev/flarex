import { describe, expect, test } from "vitest";

import {
  DECLARATIVE_V2_SEMANTIC_RECORD_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1,
  DECLARATIVE_V2_SEMANTIC_RECORD_KIND_ORDER_V1,
  encodeDeclarativeV2SemanticRecordPayloadV1,
  encodeDeclarativeV2SemanticRecordV1,
  measureDeclarativeV2SemanticRecordBytesV1,
  type DeclarativeV2SemanticRecordV1,
} from "../src/declarative-v2-semantic-record-v1";

const UTF8_DECODER = new TextDecoder();

describe("Declarative V2 semantic record V1 protocol", () => {
  test("pins the codec identity, key sets, and record order", () => {
    expect(DECLARATIVE_V2_SEMANTIC_RECORD_CODEC_IDENTITY_V1).toBe(
      "flarex.declarative-v2/semantic-record-ndjson/v1",
    );
    expect(DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1.function).toEqual([
      "kind",
      "path",
      "modulePath",
      "exportName",
      "functionKind",
      "visibility",
      "argsValidatorId",
      "returnsValidatorId",
      "partition",
    ]);
    expect(DECLARATIVE_V2_SEMANTIC_RECORD_KIND_ORDER_V1).toEqual({
      header: 0,
      module: 1,
      function: 2,
      schema: 3,
      table: 4,
      index: 5,
      validator: 6,
      handler: 7,
    });
    expect(Object.isFrozen(DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1)).toBe(true);
    expect(Object.isFrozen(
      DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1.function,
    )).toBe(true);
    expect(Object.isFrozen(
      DECLARATIVE_V2_SEMANTIC_RECORD_KIND_ORDER_V1,
    )).toBe(true);
  });

  test("encodes every record variant as a canonical NDJSON line", () => {
    const records = [
      { kind: "header", version: 1 },
      { kind: "module", modulePath: "orders.js" },
      {
        kind: "function",
        path: "orders:place",
        modulePath: "orders.js",
        exportName: "place",
        functionKind: "mutation",
        visibility: "public",
        argsValidatorId: "validator:0001",
        returnsValidatorId: null,
        partition: null,
      },
      { kind: "schema", schemaVersion: "declarative-program-v1" },
      {
        kind: "table",
        name: "orders",
        documentValidatorId: "validator:0002",
      },
      {
        kind: "index",
        tableName: "orders",
        name: "by_status",
        fields: ["status"],
      },
      {
        kind: "validator",
        id: "validator:0001",
        value: { fields: {}, type: "object" },
      },
      {
        kind: "handler",
        functionPath: "orders:place",
        modulePath: "orders.js",
        exportName: "place",
      },
    ] satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>;

    const encodedRecords = records.map((record) =>
      encodeDeclarativeV2SemanticRecordV1(record)
    );
    expect(encodedRecords.map((record) => UTF8_DECODER.decode(record))).toEqual([
      '{"kind":"header","version":1}\n',
      '{"kind":"module","modulePath":"orders.js"}\n',
      '{"argsValidatorId":"validator:0001","exportName":"place","functionKind":"mutation","kind":"function","modulePath":"orders.js","partition":null,"path":"orders:place","returnsValidatorId":null,"visibility":"public"}\n',
      '{"kind":"schema","schemaVersion":"declarative-program-v1"}\n',
      '{"documentValidatorId":"validator:0002","kind":"table","name":"orders"}\n',
      '{"fields":["status"],"kind":"index","name":"by_status","tableName":"orders"}\n',
      '{"id":"validator:0001","kind":"validator","value":{"fields":{},"type":"object"}}\n',
      '{"exportName":"place","functionPath":"orders:place","kind":"handler","modulePath":"orders.js"}\n',
    ]);
    for (let index = 0; index < records.length; index += 1) {
      const encoded = encodedRecords[index]!;
      expect(measureDeclarativeV2SemanticRecordBytesV1(
        records[index]!,
        encoded.byteLength,
      )).toEqual({ kind: "success", bytes: encoded.byteLength });
      expect(measureDeclarativeV2SemanticRecordBytesV1(
        records[index]!,
        encoded.byteLength - 1,
      )).toMatchObject({ kind: "exceeded" });
    }
    expect(UTF8_DECODER.decode(
      encodeDeclarativeV2SemanticRecordPayloadV1(records[0]!),
    )).toBe('{"kind":"header","version":1}');
  });
});

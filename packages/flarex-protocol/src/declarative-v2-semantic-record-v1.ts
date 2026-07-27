import type { Json } from "./json";
import {
  encodeCanonicalJson,
  measureCanonicalJsonUtf8Bytes,
} from "./json";

const UTF8_ENCODER = new TextEncoder();

export const DECLARATIVE_V2_SEMANTIC_RECORD_CODEC_IDENTITY_V1 =
  "flarex.declarative-v2/semantic-record-ndjson/v1" as const;

export type DeclarativeV2SemanticFunctionKindV1 =
  | "query"
  | "mutation"
  | "workflowMutation"
  | "action";
export type DeclarativeV2SemanticVisibilityV1 = "public" | "internal";

export interface DeclarativeV2SemanticHeaderRecordV1 {
  readonly kind: "header";
  readonly version: 1;
}

export interface DeclarativeV2SemanticModuleRecordV1 {
  readonly kind: "module";
  readonly modulePath: string;
}

export interface DeclarativeV2SemanticFunctionRecordV1 {
  readonly kind: "function";
  readonly path: string;
  readonly modulePath: string;
  readonly exportName: string;
  readonly functionKind: DeclarativeV2SemanticFunctionKindV1;
  readonly visibility: DeclarativeV2SemanticVisibilityV1;
  readonly argsValidatorId: string;
  readonly returnsValidatorId: string | null;
  readonly partition: string | null;
}

export interface DeclarativeV2SemanticSchemaRecordV1 {
  readonly kind: "schema";
  readonly schemaVersion: string;
}

export interface DeclarativeV2SemanticTableRecordV1 {
  readonly kind: "table";
  readonly name: string;
  readonly documentValidatorId: string;
}

export interface DeclarativeV2SemanticIndexRecordV1 {
  readonly kind: "index";
  readonly tableName: string;
  readonly name: string;
  readonly fields: ReadonlyArray<string>;
}

export interface DeclarativeV2SemanticValidatorRecordV1 {
  readonly kind: "validator";
  readonly id: string;
  readonly value: Json;
}

export interface DeclarativeV2SemanticHandlerRecordV1 {
  readonly kind: "handler";
  readonly functionPath: string;
  readonly modulePath: string;
  readonly exportName: string;
}

export type DeclarativeV2SemanticRecordV1 =
  | DeclarativeV2SemanticHeaderRecordV1
  | DeclarativeV2SemanticModuleRecordV1
  | DeclarativeV2SemanticFunctionRecordV1
  | DeclarativeV2SemanticSchemaRecordV1
  | DeclarativeV2SemanticTableRecordV1
  | DeclarativeV2SemanticIndexRecordV1
  | DeclarativeV2SemanticValidatorRecordV1
  | DeclarativeV2SemanticHandlerRecordV1;

export type DeclarativeV2SemanticRecordByteMeasurementV1 =
  | Readonly<{ readonly kind: "success"; readonly bytes: number }>
  | Readonly<{ readonly kind: "exceeded"; readonly observed: number }>;

export const DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1 = Object.freeze({
  header: Object.freeze(["kind", "version"]),
  module: Object.freeze(["kind", "modulePath"]),
  function: Object.freeze([
    "kind",
    "path",
    "modulePath",
    "exportName",
    "functionKind",
    "visibility",
    "argsValidatorId",
    "returnsValidatorId",
    "partition",
  ]),
  schema: Object.freeze(["kind", "schemaVersion"]),
  table: Object.freeze(["kind", "name", "documentValidatorId"]),
  index: Object.freeze(["kind", "tableName", "name", "fields"]),
  validator: Object.freeze(["kind", "id", "value"]),
  handler: Object.freeze(["kind", "functionPath", "modulePath", "exportName"]),
} as const satisfies Readonly<
  Record<DeclarativeV2SemanticRecordV1["kind"], ReadonlyArray<string>>
>);

export const DECLARATIVE_V2_SEMANTIC_RECORD_KIND_ORDER_V1 = Object.freeze({
  header: 0,
  module: 1,
  function: 2,
  schema: 3,
  table: 4,
  index: 5,
  validator: 6,
  handler: 7,
} as const satisfies Readonly<
  Record<DeclarativeV2SemanticRecordV1["kind"], number>
>);

function semanticRecordEncodingInvariantViolation(): never {
  throw new Error(
    "Typed Declarative V2 semantic record lost its JSON representation.",
  );
}

export function declarativeV2SemanticRecordV1ToJson(
  value: DeclarativeV2SemanticRecordV1,
): Json {
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

export function encodeDeclarativeV2SemanticRecordV1(
  value: DeclarativeV2SemanticRecordV1,
): Uint8Array {
  const payload = encodeDeclarativeV2SemanticRecordPayloadV1(value);
  const line = new Uint8Array(payload.byteLength + 1);
  line.set(payload);
  line[payload.byteLength] = 0x0a;
  return line;
}

/**
 * Measures the complete LF-terminated semantic record without allocating its
 * canonical JSON string or encoded byte arrays.
 */
export function measureDeclarativeV2SemanticRecordBytesV1(
  value: DeclarativeV2SemanticRecordV1,
  maximumBytes: number,
): DeclarativeV2SemanticRecordByteMeasurementV1 {
  if (maximumBytes < 1) return { kind: "exceeded", observed: 1 };
  const payload = measureCanonicalJsonUtf8Bytes(
    declarativeV2SemanticRecordV1ToJson(value),
    maximumBytes - 1,
  );
  if (payload.kind === "invalid") {
    return semanticRecordEncodingInvariantViolation();
  }
  return payload.kind === "success"
    ? { kind: "success", bytes: payload.bytes + 1 }
    : { kind: "exceeded", observed: payload.observed + 1 };
}

export function encodeDeclarativeV2SemanticRecordPayloadV1(
  value: DeclarativeV2SemanticRecordV1,
): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson(
    declarativeV2SemanticRecordV1ToJson(value),
    semanticRecordEncodingInvariantViolation,
  ));
}

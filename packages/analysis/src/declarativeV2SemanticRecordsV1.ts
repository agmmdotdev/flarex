import { isUint8Array } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import {
  isNonEmptyString,
} from "@flarex/utils/strings";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1 as RECORD_KEYS,
  DECLARATIVE_V2_SEMANTIC_RECORD_KIND_ORDER_V1 as KIND_ORDER,
  type DeclarativeV2SemanticFunctionRecordV1,
  type DeclarativeV2SemanticHandlerRecordV1,
  type DeclarativeV2SemanticIndexRecordV1,
  type DeclarativeV2SemanticModuleRecordV1,
  type DeclarativeV2SemanticRecordV1,
  type DeclarativeV2SemanticTableRecordV1,
  type DeclarativeV2SemanticValidatorRecordV1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";
import type { Json } from "flarex-protocol/json";

export {
  DECLARATIVE_V2_SEMANTIC_RECORD_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_SEMANTIC_RECORD_KEYS_V1,
  DECLARATIVE_V2_SEMANTIC_RECORD_KIND_ORDER_V1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";
export type {
  DeclarativeV2SemanticFunctionKindV1,
  DeclarativeV2SemanticFunctionRecordV1,
  DeclarativeV2SemanticHandlerRecordV1,
  DeclarativeV2SemanticHeaderRecordV1,
  DeclarativeV2SemanticIndexRecordV1,
  DeclarativeV2SemanticModuleRecordV1,
  DeclarativeV2SemanticRecordV1,
  DeclarativeV2SemanticSchemaRecordV1,
  DeclarativeV2SemanticTableRecordV1,
  DeclarativeV2SemanticValidatorRecordV1,
  DeclarativeV2SemanticVisibilityV1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";

import {
  createIncrementalCanonicalJsonDecoderV1,
  makeIncrementalCanonicalJsonEventSinkV1,
  makeIncrementalCanonicalJsonLimitsV1,
  type IncrementalCanonicalJsonDecodeStepV1,
  type IncrementalCanonicalJsonDecoderV1,
  type IncrementalCanonicalJsonIssueV1,
  type IncrementalCanonicalJsonEventSinkV1,
  type IncrementalCanonicalJsonSinkEventV1,
  type IncrementalCanonicalJsonReceiptV1,
  type IncrementalCanonicalJsonUsageV1,
} from "./declarativeV2IncrementalCanonicalJsonV1";

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;
const RECORD_CHUNK_BYTES = 4_096;

export type DeclarativeV2SemanticRecordV1ErrorReason =
  | "invalidInput"
  | "invalidBudget"
  | "budgetExceeded"
  | "invalidUtf8"
  | "malformedJson"
  | "nonCanonical"
  | "unknownRecord"
  | "duplicateRecord"
  | "recordOrder"
  | "missingHeader"
  | "missingRecord"
  | "trailingBytes"
  | "closed";

export class DeclarativeV2SemanticRecordV1Error extends Data.TaggedError(
  "DeclarativeV2SemanticRecordV1Error",
)<{
  readonly operation: "decodeRecord" | "createDecoder" | "push" | "finish";
  readonly reason: DeclarativeV2SemanticRecordV1ErrorReason;
  readonly recordOrdinal?: number;
  readonly byteOffset?: number;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export interface DeclarativeV2SemanticStreamBudgetV1 {
  readonly maximumInputBytes: number;
  readonly maximumRecordBytes: number;
  readonly maximumRecords: number;
  readonly maximumCanonicalBytes: number;
}

const OWNED_SEMANTIC_STREAM_BUDGETS = new WeakMap<
  object,
  DeclarativeV2SemanticStreamBudgetV1
>();

export interface DeclarativeV2SemanticStreamUsageV1 {
  readonly inputBytes: number;
  readonly records: number;
  readonly canonicalBytes: number;
}

export interface DeclarativeV2SemanticStreamDetailedUsageV1 {
  readonly tokens: bigint;
  readonly jsonNodes: bigint;
  readonly validatorNodes: bigint;
  readonly modules: bigint;
  readonly functions: bigint;
  readonly handlers: bigint;
  readonly frontierEntries: bigint;
  readonly comparisonStringBytes: bigint;
}

export interface DeclarativeV2SemanticStreamDetailedReceiptV1 {
  readonly delta: DeclarativeV2SemanticStreamDetailedUsageV1;
  readonly aggregate: DeclarativeV2SemanticStreamDetailedUsageV1;
}

export interface DeclarativeV2SemanticStreamPushV1 {
  readonly status: "pending" | "complete";
  readonly consumedInputBytes: number;
  readonly records: ReadonlyArray<DeclarativeV2SemanticRecordV1>;
  readonly usage: DeclarativeV2SemanticStreamUsageV1;
  readonly mechanical: IncrementalCanonicalJsonReceiptV1;
  readonly detailed: DeclarativeV2SemanticStreamDetailedReceiptV1;
}

export interface DeclarativeV2SemanticStreamDecoderV1 {
  readonly push: (
    bytes: unknown,
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2SemanticStreamPushV1,
    DeclarativeV2SemanticRecordV1Error
  >;
  readonly finish: (maximumTransitions: unknown) => Result.Result<
    DeclarativeV2SemanticStreamPushV1,
    DeclarativeV2SemanticRecordV1Error
  >;
}

function semanticError(
  operation: DeclarativeV2SemanticRecordV1Error["operation"],
  reason: DeclarativeV2SemanticRecordV1ErrorReason,
  evidence?: Readonly<{
    readonly recordOrdinal?: number;
    readonly byteOffset?: number;
    readonly observed?: number;
    readonly maximum?: number;
  }>,
): DeclarativeV2SemanticRecordV1Error {
  return new DeclarativeV2SemanticRecordV1Error({
    operation,
    reason,
    ...(evidence?.recordOrdinal === undefined
      ? {}
      : { recordOrdinal: evidence.recordOrdinal }),
    ...(evidence?.byteOffset === undefined
      ? {}
      : { byteOffset: evidence.byteOffset }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });
}

function comparedUtf8BytesAt(value: string, index: number): number {
  const code = value.charCodeAt(index);
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code >= 0xd800 && code <= 0xdbff) {
    const low = value.charCodeAt(index + 1);
    return low >= 0xdc00 && low <= 0xdfff ? 4 : 3;
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const high = value.charCodeAt(index - 1);
    return high >= 0xd800 && high <= 0xdbff ? 0 : 3;
  }
  return 3;
}

export function makeDeclarativeV2SemanticStreamBudgetV1(
  maximumInputBytes: unknown,
  maximumRecordBytes: unknown,
  maximumRecords: unknown,
  maximumCanonicalBytes: unknown,
): Result.Result<
  DeclarativeV2SemanticStreamBudgetV1,
  DeclarativeV2SemanticRecordV1Error
> {
  if (
    !isNonNegativeSafeInteger(maximumInputBytes) ||
    !isNonNegativeSafeInteger(maximumRecordBytes) ||
    maximumRecordBytes === 0 ||
    !isNonNegativeSafeInteger(maximumRecords) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes)
  ) {
    return Result.fail(semanticError("createDecoder", "invalidBudget"));
  }
  const budget = Object.freeze({
    maximumInputBytes,
    maximumRecordBytes,
    maximumRecords,
    maximumCanonicalBytes,
  } satisfies DeclarativeV2SemanticStreamBudgetV1);
  OWNED_SEMANTIC_STREAM_BUDGETS.set(budget, budget);
  return Result.succeed(budget);
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  try {
    const observed = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value) as unknown;
    return typeof observed === "number" ? observed : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicVisibleBytes(
  value: Uint8Array,
  visibleLength: number,
): Uint8Array | undefined {
  try {
    return Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      value,
      [0, visibleLength],
    ) as Uint8Array;
  } catch {
    return undefined;
  }
}

function isOwnJsonDataRecord(
  value: Json,
  expected: ReadonlyArray<string>,
  rootObjectMemberCount: number | undefined,
): value is Readonly<Record<string, Json>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    rootObjectMemberCount !== expected.length
  ) {
    return false;
  }
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function isCanonicalName(value: unknown): value is string {
  return isNonEmptyString(value);
}

function freezeRecord(
  value: DeclarativeV2SemanticRecordV1,
): DeclarativeV2SemanticRecordV1 {
  return Object.freeze(value);
}

type DecodedSemanticRecordCandidateV1 =
  | Exclude<DeclarativeV2SemanticRecordV1, DeclarativeV2SemanticIndexRecordV1>
  | {
      readonly kind: "index";
      readonly tableName: string;
      readonly name: string;
      readonly fields: ReadonlyArray<Json>;
    };

function decodeRecordValue(
  value: Json,
  rootObjectMemberCount: number | undefined,
): DecodedSemanticRecordCandidateV1 | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (
    kindDescriptor === undefined ||
    !("value" in kindDescriptor) ||
    typeof kindDescriptor.value !== "string"
  ) {
    return undefined;
  }
  switch (kindDescriptor.value) {
    case "header":
      return isOwnJsonDataRecord(
          value,
          RECORD_KEYS.header,
          rootObjectMemberCount,
        ) && value.version === 1
        ? freezeRecord({ kind: "header", version: 1 })
        : undefined;
    case "module":
      return isOwnJsonDataRecord(
          value,
          RECORD_KEYS.module,
          rootObjectMemberCount,
        ) &&
          isCanonicalName(value.modulePath)
        ? freezeRecord({ kind: "module", modulePath: value.modulePath })
        : undefined;
    case "function": {
      if (
        !isOwnJsonDataRecord(
          value,
          RECORD_KEYS.function,
          rootObjectMemberCount,
        ) ||
        !isCanonicalName(value.path) ||
        !isCanonicalName(value.modulePath) ||
        !isCanonicalName(value.exportName) ||
        !isCanonicalName(value.argsValidatorId) ||
        !(value.returnsValidatorId === null ||
          isCanonicalName(value.returnsValidatorId)) ||
        !(value.partition === null || isCanonicalName(value.partition)) ||
        !(
          value.functionKind === "query" ||
          value.functionKind === "mutation" ||
          value.functionKind === "workflowMutation" ||
          value.functionKind === "action"
        ) ||
        !(value.visibility === "public" || value.visibility === "internal")
      ) {
        return undefined;
      }
      return freezeRecord({
        kind: "function",
        path: value.path,
        modulePath: value.modulePath,
        exportName: value.exportName,
        functionKind: value.functionKind,
        visibility: value.visibility,
        argsValidatorId: value.argsValidatorId,
        returnsValidatorId: value.returnsValidatorId,
        partition: value.partition,
      });
    }
    case "schema":
      return isOwnJsonDataRecord(
          value,
          RECORD_KEYS.schema,
          rootObjectMemberCount,
        ) &&
          isCanonicalName(value.schemaVersion)
        ? freezeRecord({ kind: "schema", schemaVersion: value.schemaVersion })
        : undefined;
    case "table":
      return isOwnJsonDataRecord(
          value,
          RECORD_KEYS.table,
          rootObjectMemberCount,
        ) &&
          isCanonicalName(value.name) &&
          isCanonicalName(value.documentValidatorId)
        ? freezeRecord({
          kind: "table",
          name: value.name,
          documentValidatorId: value.documentValidatorId,
        })
        : undefined;
    case "index": {
      if (
        !isOwnJsonDataRecord(
          value,
          RECORD_KEYS.index,
          rootObjectMemberCount,
        ) ||
        !isCanonicalName(value.tableName) ||
        !isCanonicalName(value.name) ||
        !Array.isArray(value.fields) ||
        value.fields.length === 0
      ) {
        return undefined;
      }
      return Object.freeze({
        kind: "index",
        tableName: value.tableName,
        name: value.name,
        fields: value.fields,
      });
    }
    case "validator": {
      if (
        !isOwnJsonDataRecord(
          value,
          RECORD_KEYS.validator,
          rootObjectMemberCount,
        )
      ) {
        return undefined;
      }
      const validatorValue = value.value;
      if (!isCanonicalName(value.id) || validatorValue === undefined) {
        return undefined;
      }
      return freezeRecord({
        kind: "validator",
        id: value.id,
        value: validatorValue,
      });
    }
    case "handler":
      return isOwnJsonDataRecord(
          value,
          RECORD_KEYS.handler,
          rootObjectMemberCount,
        ) &&
          isCanonicalName(value.functionPath) &&
          isCanonicalName(value.modulePath) &&
          isCanonicalName(value.exportName)
        ? freezeRecord({
          kind: "handler",
          functionPath: value.functionPath,
          modulePath: value.modulePath,
          exportName: value.exportName,
        })
        : undefined;
    default:
      return undefined;
  }
}

function recordKeyParts(
  value: DecodedSemanticRecordCandidateV1,
): ReadonlyArray<string> {
  switch (value.kind) {
    case "header":
      return [];
    case "module":
      return [value.modulePath];
    case "function":
      return [value.path];
    case "schema":
      return [];
    case "table":
      return [value.name];
    case "index":
      return [value.tableName, value.name];
    case "validator":
      return [value.id];
    case "handler":
      return [value.functionPath];
  }
}

function captureBudget(
  value: unknown,
): DeclarativeV2SemanticStreamBudgetV1 | undefined {
  return value !== null && typeof value === "object"
    ? OWNED_SEMANTIC_STREAM_BUDGETS.get(value)
    : undefined;
}

function createSemanticJsonEventSink(): Readonly<{
  readonly sink: IncrementalCanonicalJsonEventSinkV1;
  readonly value: () => Json | undefined;
  readonly metrics: () => Readonly<{
    readonly tokens: number;
    readonly jsonNodes: number;
    readonly validatorValueNodes: number;
  }>;
}> {
  type Frame =
    | {
        readonly kind: "array";
        readonly value: Json[];
        readonly rootKey: string | undefined;
      }
    | {
        readonly kind: "object";
        readonly value: Record<string, Json>;
        readonly rootKey: string | undefined;
        currentKey: string | undefined;
      };
  const frames: Frame[] = [];
  let root: Json | undefined;
  let stringRole: "key" | "value" | undefined;
  let stringValue = "";
  let tokens = 0;
  let jsonNodes = 0;
  let validatorValueNodes = 0;

  const attach = (value: Json): string | undefined => {
    const frame = frames[frames.length - 1];
    if (frame === undefined) {
      root = value;
      return undefined;
    }
    const rootKey = frames.length === 1 && frame.kind === "object"
      ? frame.currentKey
      : frame.rootKey;
    jsonNodes += 1;
    if (rootKey === "value") validatorValueNodes += 1;
    if (frame.kind === "array") {
      const index = frame.value.length;
      Object.defineProperty(frame.value, String(index), {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      return rootKey;
    }
    if (frame.currentKey === undefined) {
      throw new Error("semantic JSON sink received a value without a key");
    }
    Object.defineProperty(frame.value, frame.currentKey, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    frame.currentKey = undefined;
    return rootKey;
  };

  const push = (event: IncrementalCanonicalJsonSinkEventV1): void => {
    switch (event.kind) {
      case "null":
        tokens += 1;
        attach(null);
        return;
      case "boolean":
      case "number":
        tokens += 1;
        attach(event.value);
        return;
      case "stringStart":
        if (stringRole !== undefined) {
          throw new Error("semantic JSON sink received nested string starts");
        }
        stringRole = event.role;
        stringValue = "";
        return;
      case "stringScalar":
        if (stringRole !== event.role) {
          throw new Error("semantic JSON sink received a mismatched scalar");
        }
        stringValue += event.value;
        return;
      case "stringEnd": {
        if (stringRole !== event.role) {
          throw new Error("semantic JSON sink received a mismatched string end");
        }
        const value = stringValue;
        tokens += 1;
        stringRole = undefined;
        stringValue = "";
        if (event.role === "value") {
          attach(value);
          return;
        }
        const frame = frames[frames.length - 1];
        if (frame?.kind !== "object") {
          throw new Error("semantic JSON sink received a key outside an object");
        }
        frame.currentKey = value;
        return;
      }
      case "arrayStart": {
        const value: Json[] = [];
        tokens += 1;
        const rootKey = attach(value);
        frames.push({ kind: "array", value, rootKey });
        return;
      }
      case "objectStart": {
        const value: Record<string, Json> = {};
        tokens += 1;
        const rootKey = attach(value);
        frames.push({ kind: "object", value, rootKey, currentKey: undefined });
        return;
      }
      case "arrayEnd":
      case "objectEnd": {
        tokens += 1;
        const frame = frames.pop();
        if (
          frame === undefined ||
          (event.kind === "arrayEnd" && frame.kind !== "array") ||
          (event.kind === "objectEnd" && frame.kind !== "object") ||
          (frame.kind === "object" && frame.currentKey !== undefined)
        ) {
          throw new Error("semantic JSON sink received a mismatched container end");
        }
        return;
      }
      case "memberFinalize": {
        const frame = frames[frames.length - 1];
        if (frame === undefined || frame.kind !== event.container) {
          throw new Error("semantic JSON sink received invalid finalization");
        }
        const descriptor = Object.getOwnPropertyDescriptor(
          frame.value,
          event.key,
        );
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new Error("semantic JSON sink received missing member");
        }
        Object.defineProperty(frame.value, event.key, {
          configurable: false,
          enumerable: true,
          value: descriptor.value,
          writable: false,
        });
        return;
      }
      case "arrayLengthFinalize": {
        const frame = frames[frames.length - 1];
        if (frame?.kind !== "array") {
          throw new Error("semantic JSON sink received invalid array length");
        }
        Object.defineProperty(frame.value, "length", { writable: false });
        return;
      }
      case "containerSeal": {
        const frame = frames[frames.length - 1];
        if (frame === undefined || frame.kind !== event.container) {
          throw new Error("semantic JSON sink received invalid container seal");
        }
        Object.preventExtensions(frame.value);
        return;
      }
    }
  };

  return Object.freeze({
    sink: makeIncrementalCanonicalJsonEventSinkV1(push),
    value: () => root,
    metrics: () => Object.freeze({ tokens, jsonNodes, validatorValueNodes }),
  });
}

export function createDeclarativeV2SemanticStreamDecoderV1(
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2SemanticStreamDecoderV1,
  DeclarativeV2SemanticRecordV1Error
> {
  let budget: DeclarativeV2SemanticStreamBudgetV1 | undefined;
  try {
    budget = captureBudget(rawBudget);
  } catch {
    budget = undefined;
  }
  if (budget === undefined) {
    return Result.fail(semanticError("createDecoder", "invalidBudget"));
  }
  let recordChunks: Array<Uint8Array | undefined> = [];
  let recordLength = 0;
  let totalInputBytes = 0;
  let totalCanonicalBytes = 0;
  let totalRecords = 0;
  let closed = false;
  let finishRequested = false;
  let complete = false;
  let lastKindOrder = -1;
  let lastKeyParts: ReadonlyArray<string> = [];
  const modules: DeclarativeV2SemanticModuleRecordV1[] = [];
  const functions: DeclarativeV2SemanticFunctionRecordV1[] = [];
  const tables: DeclarativeV2SemanticTableRecordV1[] = [];
  const indexes: Array<DeclarativeV2SemanticIndexRecordV1> = [];
  const validators: DeclarativeV2SemanticValidatorRecordV1[] = [];
  const handlers: DeclarativeV2SemanticHandlerRecordV1[] = [];
  let schemaCount = 0;
  let currentDecoder: IncrementalCanonicalJsonDecoderV1 | undefined;
  let currentDecoderOffset = 0;
  let currentRecordByteOffset = 0;
  let completedRecordDecode:
    | Extract<
      IncrementalCanonicalJsonDecodeStepV1,
      { readonly status: "complete" }
    >
    | undefined;
  let completedRecordValue: Json | undefined;
  let currentRecordValue: (() => Json | undefined) | undefined;
  let completedRecordMetrics:
    | Readonly<{
        readonly tokens: number;
        readonly jsonNodes: number;
        readonly validatorValueNodes: number;
      }>
    | undefined;
  let currentRecordMetrics:
    | (() => Readonly<{
        readonly tokens: number;
        readonly jsonNodes: number;
        readonly validatorValueNodes: number;
      }>)
    | undefined;
  type PendingRecordPhase =
    | "fields"
    | "membership"
    | "canonical"
    | "header"
    | "order"
    | "commit";
  type PendingRecordCapture = {
    readonly decoded: Extract<
      IncrementalCanonicalJsonDecodeStepV1,
      { readonly status: "complete" }
    >;
    readonly candidate: DecodedSemanticRecordCandidateV1;
    readonly metrics: Readonly<{
      readonly tokens: number;
      readonly jsonNodes: number;
      readonly validatorValueNodes: number;
    }>;
    readonly order: number;
    readonly keyParts: ReadonlyArray<string>;
    phase: PendingRecordPhase;
    fieldIndex: number;
    comparePart: number;
    compareIndex: number;
  };
  let currentRecordCapture: PendingRecordCapture | undefined;
  const mechanicalUsage: {
    inputBytes: number;
    canonicalBytes: number;
    stringBytes: number;
    members: number;
    depth: number;
    transitions: number;
  } = {
    inputBytes: 0,
    canonicalBytes: 0,
    stringBytes: 0,
    members: 0,
    depth: 0,
    transitions: 0,
  };
  const detailedUsage: {
    tokens: bigint;
    jsonNodes: bigint;
    validatorNodes: bigint;
    modules: bigint;
    functions: bigint;
    handlers: bigint;
    frontierEntries: bigint;
    comparisonStringBytes: bigint;
  } = {
    tokens: 0n,
    jsonNodes: 0n,
    validatorNodes: 0n,
    modules: 0n,
    functions: 0n,
    handlers: 0n,
    frontierEntries: 0n,
    comparisonStringBytes: 0n,
  };
  type CompletenessPhase =
    | "start"
    | "functionModule"
    | "functionArgs"
    | "functionReturns"
    | "functionHandler"
    | "functionHandlerModule"
    | "functionHandlerExport"
    | "tableValidator"
    | "indexTable"
    | "handlerFunction"
    | "complete";
  let completenessPhase: CompletenessPhase = "start";
  let completenessItem = 0;
  let completenessSearch = 0;
  let completenessCompareIndex = 0;
  let completenessFound = -1;
  let completenessDirectCompareIndex = 0;

  const usage = (): DeclarativeV2SemanticStreamUsageV1 => Object.freeze({
    inputBytes: totalInputBytes,
    records: totalRecords,
    canonicalBytes: totalCanonicalBytes,
  });

  const mechanical = (
    before: IncrementalCanonicalJsonUsageV1,
  ): IncrementalCanonicalJsonReceiptV1 => {
    const aggregate = Object.freeze({ ...mechanicalUsage });
    return Object.freeze({
      delta: Object.freeze({
        inputBytes: mechanicalUsage.inputBytes - before.inputBytes,
        canonicalBytes:
          mechanicalUsage.canonicalBytes - before.canonicalBytes,
        stringBytes: mechanicalUsage.stringBytes - before.stringBytes,
        members: mechanicalUsage.members - before.members,
        depth: Math.max(0, mechanicalUsage.depth - before.depth),
        transitions: mechanicalUsage.transitions - before.transitions,
      }),
      aggregate,
    });
  };

  const detailed = (
    before: DeclarativeV2SemanticStreamDetailedUsageV1,
  ): DeclarativeV2SemanticStreamDetailedReceiptV1 => {
    const aggregate = Object.freeze({ ...detailedUsage });
    return Object.freeze({
      delta: Object.freeze({
        tokens: aggregate.tokens - before.tokens,
        jsonNodes: aggregate.jsonNodes - before.jsonNodes,
        validatorNodes: aggregate.validatorNodes - before.validatorNodes,
        modules: aggregate.modules - before.modules,
        functions: aggregate.functions - before.functions,
        handlers: aggregate.handlers - before.handlers,
        frontierEntries: aggregate.frontierEntries - before.frontierEntries,
        comparisonStringBytes:
          aggregate.comparisonStringBytes - before.comparisonStringBytes,
      }),
      aggregate,
    });
  };

  const mergeMechanical = (value: IncrementalCanonicalJsonReceiptV1): void => {
    mechanicalUsage.canonicalBytes += value.delta.canonicalBytes;
    mechanicalUsage.stringBytes += value.delta.stringBytes;
    mechanicalUsage.members += value.delta.members;
    mechanicalUsage.depth = Math.max(
      mechanicalUsage.depth,
      value.aggregate.depth,
    );
    mechanicalUsage.transitions += value.delta.transitions;
  };

  const mapJsonIssue = (
    value: IncrementalCanonicalJsonIssueV1,
    operation: "push" | "finish" = "push",
  ): DeclarativeV2SemanticRecordV1Error =>
    semanticError(
      operation,
      value.reason === "invalidUtf8"
        ? "invalidUtf8"
        : value.reason === "budgetExceeded"
        ? "budgetExceeded"
        : value.reason === "closed"
        ? "closed"
        : value.reason === "invalidInput" || value.reason === "invalidBudget"
        ? "invalidInput"
        : "malformedJson",
      {
        recordOrdinal: totalRecords,
        byteOffset: currentRecordByteOffset,
        ...(value.observed === undefined ? {} : { observed: value.observed }),
        ...(value.maximum === undefined ? {} : { maximum: value.maximum }),
      },
    );

  const beginDecodedRecordCapture = (
    decoded: Extract<
      IncrementalCanonicalJsonDecodeStepV1,
      { readonly status: "complete" }
    >,
    operation: "push" | "finish",
  ): DeclarativeV2SemanticRecordV1Error | undefined => {
    const ordinal = totalRecords;
    const parsed = completedRecordValue;
    const metrics = completedRecordMetrics;
    completedRecordValue = undefined;
    completedRecordMetrics = undefined;
    if (parsed === undefined || metrics === undefined) {
      return semanticError(operation, "invalidInput", {
        recordOrdinal: ordinal,
        byteOffset: currentRecordByteOffset,
      });
    }
    const candidate = decodeRecordValue(
      parsed,
      decoded.rootObjectMemberCount,
    );
    if (candidate === undefined) {
      const kind = parsed !== null && typeof parsed === "object"
        ? Object.getOwnPropertyDescriptor(parsed, "kind")?.value
        : undefined;
      return semanticError(
        operation,
        typeof kind === "string" && !(kind in RECORD_KEYS)
          ? "unknownRecord"
          : "invalidInput",
        { recordOrdinal: ordinal, byteOffset: currentRecordByteOffset },
      );
    }
    currentRecordCapture = {
      decoded,
      candidate,
      metrics,
      order: KIND_ORDER[candidate.kind],
      keyParts: recordKeyParts(candidate),
      phase: candidate.kind === "index" ? "fields" : "membership",
      fieldIndex: 0,
      comparePart: 0,
      compareIndex: 0,
    };
    return undefined;
  };

  const failCurrentRecord = (
    reason: DeclarativeV2SemanticRecordV1ErrorReason,
    operation: "push" | "finish",
  ): DeclarativeV2SemanticRecordV1Error =>
    semanticError(operation, reason, {
      recordOrdinal: totalRecords,
      byteOffset: currentRecordByteOffset,
    });

  const commitCurrentRecord = (
    capture: PendingRecordCapture,
  ): DeclarativeV2SemanticRecordV1 => {
    const candidate = capture.candidate;
    const record: DeclarativeV2SemanticRecordV1 = candidate.kind === "index"
      ? freezeRecord({
        kind: "index",
        tableName: candidate.tableName,
        name: candidate.name,
        fields: candidate.fields as ReadonlyArray<string>,
      })
      : candidate;
    switch (record.kind) {
      case "header":
        break;
      case "module":
        modules.push(record);
        detailedUsage.modules += 1n;
        break;
      case "function":
        functions.push(record);
        detailedUsage.functions += 1n;
        break;
      case "schema":
        schemaCount += 1;
        break;
      case "table":
        tables.push(record);
        break;
      case "index":
        indexes.push(record);
        break;
      case "validator":
        validators.push(record);
        detailedUsage.validatorNodes += BigInt(
          capture.metrics.validatorValueNodes,
        );
        break;
      case "handler":
        handlers.push(record);
        detailedUsage.handlers += 1n;
        break;
    }
    detailedUsage.tokens += BigInt(capture.metrics.tokens + 1);
    detailedUsage.jsonNodes += BigInt(capture.metrics.jsonNodes);
    lastKindOrder = capture.order;
    lastKeyParts = capture.keyParts;
    totalRecords += 1;
    totalCanonicalBytes += capture.decoded.receipt.aggregate.inputBytes;
    currentRecordCapture = undefined;
    return record;
  };

  const advanceCurrentRecord = (
    operation: "push" | "finish",
  ):
    | DeclarativeV2SemanticRecordV1
    | DeclarativeV2SemanticRecordV1Error
    | undefined => {
    const capture = currentRecordCapture;
    if (capture === undefined) return undefined;
    switch (capture.phase) {
      case "fields":
        if (capture.candidate.kind !== "index") {
          capture.phase = "membership";
          return undefined;
        }
        if (capture.fieldIndex >= capture.candidate.fields.length) {
          capture.phase = "membership";
          return undefined;
        }
        if (!isCanonicalName(capture.candidate.fields[capture.fieldIndex])) {
          return failCurrentRecord("invalidInput", operation);
        }
        capture.fieldIndex += 1;
        return undefined;
      case "membership":
        if (
          !capture.decoded.jsonMembership ||
          !capture.decoded.wellFormedUnicode
        ) {
          return failCurrentRecord("invalidInput", operation);
        }
        capture.phase = "canonical";
        return undefined;
      case "canonical":
        if (!capture.decoded.canonical) {
          return failCurrentRecord("nonCanonical", operation);
        }
        capture.phase = "header";
        return undefined;
      case "header":
        if (
          (totalRecords === 0 && capture.candidate.kind !== "header") ||
          (totalRecords > 0 && capture.candidate.kind === "header")
        ) {
          return failCurrentRecord(
            totalRecords === 0 ? "missingHeader" : "recordOrder",
            operation,
          );
        }
        if (capture.order < lastKindOrder) {
          return failCurrentRecord("recordOrder", operation);
        }
        capture.phase = capture.order === lastKindOrder ? "order" : "commit";
        return undefined;
      case "order": {
        if (
          capture.comparePart >= lastKeyParts.length ||
          capture.comparePart >= capture.keyParts.length
        ) {
          if (lastKeyParts.length === capture.keyParts.length) {
            return failCurrentRecord("duplicateRecord", operation);
          }
          if (lastKeyParts.length > capture.keyParts.length) {
            return failCurrentRecord("recordOrder", operation);
          }
          capture.phase = "commit";
          return undefined;
        }
        const previousPart = lastKeyParts[capture.comparePart]!;
        const currentPart = capture.keyParts[capture.comparePart]!;
        if (
          capture.compareIndex >= previousPart.length ||
          capture.compareIndex >= currentPart.length
        ) {
          if (previousPart.length > currentPart.length) {
            return failCurrentRecord("recordOrder", operation);
          }
          if (previousPart.length < currentPart.length) {
            capture.phase = "commit";
            return undefined;
          }
          capture.comparePart += 1;
          capture.compareIndex = 0;
          return undefined;
        }
        const previous = previousPart.charCodeAt(capture.compareIndex);
        const current = currentPart.charCodeAt(capture.compareIndex);
        detailedUsage.comparisonStringBytes += BigInt(
          comparedUtf8BytesAt(previousPart, capture.compareIndex) +
            comparedUtf8BytesAt(currentPart, capture.compareIndex),
        );
        if (previous > current) {
          return failCurrentRecord("recordOrder", operation);
        }
        if (previous < current) {
          capture.phase = "commit";
          return undefined;
        }
        capture.compareIndex += 1;
        return undefined;
      }
      case "commit":
        return commitCurrentRecord(capture);
    }
  };

  const beginRecordDecode = (): Result.Result<
    void,
    DeclarativeV2SemanticRecordV1Error
  > => Result.gen(function*() {
    const ordinal = totalRecords;
    if (
      totalRecords + 1 > budget.maximumRecords ||
      totalCanonicalBytes + recordLength > budget.maximumCanonicalBytes
    ) {
      return yield* Result.fail(semanticError("push", "budgetExceeded", {
        recordOrdinal: ordinal,
        byteOffset: currentRecordByteOffset,
        observed: totalRecords + 1 > budget.maximumRecords
          ? totalRecords + 1
          : totalCanonicalBytes + recordLength,
        maximum: totalRecords + 1 > budget.maximumRecords
          ? budget.maximumRecords
          : budget.maximumCanonicalBytes,
      }));
    }
    const jsonLimits = yield* makeIncrementalCanonicalJsonLimitsV1(
      recordLength,
      Math.max(recordLength, budget.maximumRecordBytes),
      recordLength,
      recordLength,
      recordLength,
    ).pipe(Result.mapError((failure) => mapJsonIssue(failure)));
    const materializer = createSemanticJsonEventSink();
    const created = yield* createIncrementalCanonicalJsonDecoderV1(
      jsonLimits,
      materializer.sink,
    ).pipe(Result.mapError((failure) => mapJsonIssue(failure)));
    currentDecoder = created;
    currentRecordValue = materializer.value;
    currentRecordMetrics = materializer.metrics;
    currentDecoderOffset = 0;
  });

  const driveRecordDecoder = (
    maximumTransitions: number,
    operation: "push" | "finish",
  ): Readonly<{
    readonly usedTransitions: number;
    readonly failure?: DeclarativeV2SemanticRecordV1Error;
    readonly record?: DeclarativeV2SemanticRecordV1;
  }> => {
    if (currentDecoder === undefined || maximumTransitions === 0) {
      return { usedTransitions: 0 };
    }
    let result: Result.Result<
      IncrementalCanonicalJsonDecodeStepV1,
      IncrementalCanonicalJsonIssueV1
    >;
    if (currentDecoderOffset < recordLength) {
      const chunkIndex = Math.floor(
        currentDecoderOffset / RECORD_CHUNK_BYTES,
      );
      const chunkOffset = currentDecoderOffset % RECORD_CHUNK_BYTES;
      const chunk = recordChunks[chunkIndex];
      if (chunk === undefined) {
        return {
          usedTransitions: 0,
          failure: semanticError(operation, "invalidInput"),
        };
      }
      const available = Math.min(
        chunk.byteLength - chunkOffset,
        recordLength - currentDecoderOffset,
      );
      result = currentDecoder.step(
        chunk.subarray(chunkOffset, chunkOffset + available),
        maximumTransitions,
      );
    } else {
      result = currentDecoder.finish(maximumTransitions);
    }
    if (Result.isFailure(result)) {
      return {
        usedTransitions: 0,
        failure: mapJsonIssue(result.failure, operation),
      };
    }
    mergeMechanical(result.success.receipt);
    const usedTransitions = result.success.receipt.delta.transitions;
    currentDecoderOffset += result.success.consumedInputBytes;
    if (result.success.status === "pending") return { usedTransitions };
    completedRecordDecode = result.success;
    completedRecordValue = currentRecordValue?.();
    completedRecordMetrics = currentRecordMetrics?.();
    currentRecordValue = undefined;
    currentRecordMetrics = undefined;
    currentDecoder = undefined;
    currentDecoderOffset = 0;
    recordLength = 0;
    recordChunks = [];
    return { usedTransitions };
  };

  const findByKey = (
    values: ReadonlyArray<DeclarativeV2SemanticRecordV1>,
    target: string,
    key: (value: DeclarativeV2SemanticRecordV1) => string,
  ): "pending" | "found" | "missing" => {
    if (completenessSearch >= values.length) return "missing";
    const candidate = key(values[completenessSearch]!);
    if (completenessCompareIndex === 0) {
      detailedUsage.frontierEntries += 1n;
    }
    if (
      completenessCompareIndex >= candidate.length ||
      completenessCompareIndex >= target.length
    ) {
      if (candidate.length === target.length) {
        completenessFound = completenessSearch;
        completenessSearch = 0;
        completenessCompareIndex = 0;
        return "found";
      }
      if (candidate.length > target.length) {
        completenessSearch = 0;
        completenessCompareIndex = 0;
        return "missing";
      }
      completenessSearch += 1;
      completenessCompareIndex = 0;
      return "pending";
    }
    const candidateCode = candidate.charCodeAt(completenessCompareIndex);
    const targetCode = target.charCodeAt(completenessCompareIndex);
    detailedUsage.comparisonStringBytes += BigInt(
      comparedUtf8BytesAt(candidate, completenessCompareIndex) +
        comparedUtf8BytesAt(target, completenessCompareIndex),
    );
    if (candidateCode === targetCode) {
      completenessCompareIndex += 1;
      return "pending";
    }
    if (candidateCode > targetCode) {
      completenessSearch = 0;
      completenessCompareIndex = 0;
      return "missing";
    }
    completenessSearch += 1;
    completenessCompareIndex = 0;
    return "pending";
  };

  const missingCompleteness = (): DeclarativeV2SemanticRecordV1Error =>
    semanticError("finish", "missingRecord", {
      recordOrdinal: totalRecords,
    });

  const compareExact = (
    left: string,
    right: string,
  ): "pending" | "equal" | "different" => {
    if (
      completenessDirectCompareIndex >= left.length ||
      completenessDirectCompareIndex >= right.length
    ) {
      completenessDirectCompareIndex = 0;
      return left.length === right.length ? "equal" : "different";
    }
    if (
      left.charCodeAt(completenessDirectCompareIndex) !==
        right.charCodeAt(completenessDirectCompareIndex)
    ) {
      detailedUsage.comparisonStringBytes += BigInt(
        comparedUtf8BytesAt(left, completenessDirectCompareIndex) +
          comparedUtf8BytesAt(right, completenessDirectCompareIndex),
      );
      completenessDirectCompareIndex = 0;
      return "different";
    }
    detailedUsage.comparisonStringBytes += BigInt(
      comparedUtf8BytesAt(left, completenessDirectCompareIndex) +
        comparedUtf8BytesAt(right, completenessDirectCompareIndex),
    );
    completenessDirectCompareIndex += 1;
    return "pending";
  };

  const advanceCompleteness = ():
    | "pending"
    | "complete"
    | DeclarativeV2SemanticRecordV1Error => {
    switch (completenessPhase) {
      case "start":
        if (totalRecords === 0) {
          return semanticError("finish", "missingHeader");
        }
        if (schemaCount !== 1) return missingCompleteness();
        completenessPhase = "functionModule";
        return "pending";
      case "functionModule": {
        if (completenessItem >= functions.length) {
          completenessItem = 0;
          completenessPhase = "tableValidator";
          return "pending";
        }
        const fn = functions[completenessItem]!;
        const result = findByKey(modules, fn.modulePath, (value) =>
          (value as DeclarativeV2SemanticModuleRecordV1).modulePath);
        if (result === "missing") return missingCompleteness();
        if (result === "found") completenessPhase = "functionArgs";
        return "pending";
      }
      case "functionArgs": {
        const fn = functions[completenessItem]!;
        const result = findByKey(validators, fn.argsValidatorId, (value) =>
          (value as DeclarativeV2SemanticValidatorRecordV1).id);
        if (result === "missing") return missingCompleteness();
        if (result === "found") completenessPhase = "functionReturns";
        return "pending";
      }
      case "functionReturns": {
        const fn = functions[completenessItem]!;
        if (fn.returnsValidatorId === null) {
          completenessPhase = "functionHandler";
          return "pending";
        }
        const result = findByKey(validators, fn.returnsValidatorId, (value) =>
          (value as DeclarativeV2SemanticValidatorRecordV1).id);
        if (result === "missing") return missingCompleteness();
        if (result === "found") completenessPhase = "functionHandler";
        return "pending";
      }
      case "functionHandler": {
        const fn = functions[completenessItem]!;
        const result = findByKey(handlers, fn.path, (value) =>
          (value as DeclarativeV2SemanticHandlerRecordV1).functionPath);
        if (result === "missing") return missingCompleteness();
        if (result === "found") {
          completenessPhase = "functionHandlerModule";
        }
        return "pending";
      }
      case "functionHandlerModule": {
        const fn = functions[completenessItem]!;
        const handler = handlers[completenessFound];
        if (handler === undefined) return missingCompleteness();
        const comparison = compareExact(handler.modulePath, fn.modulePath);
        if (comparison === "different") return missingCompleteness();
        if (comparison === "equal") {
          completenessPhase = "functionHandlerExport";
        }
        return "pending";
      }
      case "functionHandlerExport": {
        const fn = functions[completenessItem]!;
        const handler = handlers[completenessFound];
        if (handler === undefined) return missingCompleteness();
        const comparison = compareExact(handler.exportName, fn.exportName);
        if (comparison === "different") return missingCompleteness();
        if (comparison === "equal") {
          completenessFound = -1;
          completenessItem += 1;
          completenessPhase = "functionModule";
        }
        return "pending";
      }
      case "tableValidator": {
        if (completenessItem >= tables.length) {
          completenessItem = 0;
          completenessPhase = "indexTable";
          return "pending";
        }
        const table = tables[completenessItem]!;
        const result = findByKey(
          validators,
          table.documentValidatorId,
          (value) => (value as DeclarativeV2SemanticValidatorRecordV1).id,
        );
        if (result === "missing") return missingCompleteness();
        if (result === "found") completenessItem += 1;
        return "pending";
      }
      case "indexTable": {
        if (completenessItem >= indexes.length) {
          completenessItem = 0;
          completenessPhase = "handlerFunction";
          return "pending";
        }
        const index = indexes[completenessItem]!;
        const result = findByKey(tables, index.tableName, (value) =>
          (value as DeclarativeV2SemanticTableRecordV1).name);
        if (result === "missing") return missingCompleteness();
        if (result === "found") completenessItem += 1;
        return "pending";
      }
      case "handlerFunction": {
        if (completenessItem >= handlers.length) {
          completenessPhase = "complete";
          return "pending";
        }
        const handler = handlers[completenessItem]!;
        const result = findByKey(functions, handler.functionPath, (value) =>
          (value as DeclarativeV2SemanticFunctionRecordV1).path);
        if (result === "missing") return missingCompleteness();
        if (result === "found") completenessItem += 1;
        return "pending";
      }
      case "complete":
        complete = true;
        return "complete";
    }
  };

  const push = (
    input: unknown,
    rawMaximumTransitions: unknown,
  ): Result.Result<
    DeclarativeV2SemanticStreamPushV1,
    DeclarativeV2SemanticRecordV1Error
  > => {
    if (closed || finishRequested) {
      return Result.fail(semanticError("push", "closed"));
    }
    const failTerminal = (
      error: DeclarativeV2SemanticRecordV1Error,
    ): Result.Result<
      DeclarativeV2SemanticStreamPushV1,
      DeclarativeV2SemanticRecordV1Error
    > => {
      closed = true;
      return Result.fail(error);
    };
    if (!isUint8Array(input)) {
      return failTerminal(semanticError("push", "invalidInput"));
    }
    if (
      !isNonNegativeSafeInteger(rawMaximumTransitions) ||
      rawMaximumTransitions > 1_024
    ) {
      return failTerminal(semanticError("push", "invalidInput"));
    }
    const visibleLength = intrinsicByteLength(input);
    if (visibleLength === undefined) {
      return failTerminal(semanticError("push", "invalidInput"));
    }
    const bytes = intrinsicVisibleBytes(input, visibleLength);
    if (bytes === undefined) {
      return failTerminal(semanticError("push", "invalidInput"));
    }
    const before = Object.freeze({ ...mechanicalUsage });
    const detailedBefore = Object.freeze({ ...detailedUsage });
    const emitted: DeclarativeV2SemanticRecordV1[] = [];
    let index = 0;
    let remaining = rawMaximumTransitions;
    while (remaining > 0) {
      if (completedRecordDecode !== undefined) {
        mechanicalUsage.transitions += 1;
        remaining -= 1;
        const decoded = completedRecordDecode;
        completedRecordDecode = undefined;
        const captureFailure = beginDecodedRecordCapture(decoded, "push");
        if (captureFailure !== undefined) {
          return failTerminal(captureFailure);
        }
        continue;
      }
      if (currentRecordCapture !== undefined) {
        mechanicalUsage.transitions += 1;
        remaining -= 1;
        const advanced = advanceCurrentRecord("push");
        if (advanced instanceof DeclarativeV2SemanticRecordV1Error) {
          return failTerminal(advanced);
        }
        if (advanced !== undefined) emitted.push(advanced);
        continue;
      }
      if (currentDecoder !== undefined) {
        const driven = driveRecordDecoder(remaining, "push");
        remaining -= driven.usedTransitions;
        if (driven.failure !== undefined) {
          return failTerminal(driven.failure);
        }
        if (driven.record !== undefined) emitted.push(driven.record);
        if (driven.usedTransitions === 0) break;
        continue;
      }
      if (index >= bytes.byteLength) break;
      const observedInputBytes = totalInputBytes + 1;
      if (observedInputBytes > budget.maximumInputBytes) {
        return failTerminal(semanticError("push", "budgetExceeded", {
          observed: observedInputBytes,
          maximum: budget.maximumInputBytes,
        }));
      }
      const byte = bytes[index]!;
      index += 1;
      remaining -= 1;
      mechanicalUsage.transitions += 1;
      mechanicalUsage.inputBytes += 1;
      totalInputBytes = observedInputBytes;
      if (byte === 0x0a) {
        if (recordLength === 0) {
          return failTerminal(semanticError("push", "trailingBytes", {
            recordOrdinal: totalRecords,
            byteOffset: totalInputBytes - 1,
          }));
        }
        currentRecordByteOffset = totalInputBytes - recordLength - 1;
        const begun = beginRecordDecode();
        if (Result.isFailure(begun)) return failTerminal(begun.failure);
        continue;
      }
      if (recordLength >= budget.maximumRecordBytes) {
        return failTerminal(semanticError("push", "budgetExceeded", {
          recordOrdinal: totalRecords,
          byteOffset: totalInputBytes - 1,
          observed: recordLength + 1,
          maximum: budget.maximumRecordBytes,
        }));
      }
      const chunkIndex = Math.floor(recordLength / RECORD_CHUNK_BYTES);
      const chunkOffset = recordLength % RECORD_CHUNK_BYTES;
      let chunk = recordChunks[chunkIndex];
      if (chunk === undefined) {
        const chunkStart = chunkIndex * RECORD_CHUNK_BYTES;
        const chunkLength = Math.min(
          RECORD_CHUNK_BYTES,
          budget.maximumRecordBytes - chunkStart,
        );
        try {
          chunk = new Uint8Array(chunkLength);
        } catch {
          return failTerminal(semanticError("push", "invalidBudget", {
            recordOrdinal: totalRecords,
            byteOffset: totalInputBytes - 1,
          }));
        }
        recordChunks[chunkIndex] = chunk;
      }
      chunk[chunkOffset] = byte;
      recordLength += 1;
    }
    return Result.succeed(Object.freeze({
      status: "pending",
      consumedInputBytes: index,
      records: Object.freeze(emitted),
      usage: usage(),
      mechanical: mechanical(before),
      detailed: detailed(detailedBefore),
    }));
  };

  const finish = (rawMaximumTransitions: unknown): Result.Result<
    DeclarativeV2SemanticStreamPushV1,
    DeclarativeV2SemanticRecordV1Error
  > => {
    if (closed) return Result.fail(semanticError("finish", "closed"));
    if (
      !isNonNegativeSafeInteger(rawMaximumTransitions) ||
      rawMaximumTransitions > 1_024
    ) {
      closed = true;
      return Result.fail(semanticError("finish", "invalidInput"));
    }
    finishRequested = true;
    const before = Object.freeze({ ...mechanicalUsage });
    const detailedBefore = Object.freeze({ ...detailedUsage });
    if (currentDecoder === undefined && recordLength !== 0) {
      closed = true;
      return Result.fail(semanticError("finish", "trailingBytes", {
        recordOrdinal: totalRecords,
        byteOffset: totalInputBytes - recordLength,
      }));
    }
    let remaining = rawMaximumTransitions;
    const emitted: DeclarativeV2SemanticRecordV1[] = [];
    while (remaining > 0 && !complete) {
      if (completedRecordDecode !== undefined) {
        mechanicalUsage.transitions += 1;
        remaining -= 1;
        const decoded = completedRecordDecode;
        completedRecordDecode = undefined;
        const captureFailure = beginDecodedRecordCapture(decoded, "finish");
        if (captureFailure !== undefined) {
          closed = true;
          return Result.fail(captureFailure);
        }
        continue;
      }
      if (currentDecoder !== undefined) {
        const driven = driveRecordDecoder(remaining, "finish");
        remaining -= driven.usedTransitions;
        if (driven.failure !== undefined) {
          closed = true;
          return Result.fail(driven.failure);
        }
        if (driven.usedTransitions === 0) break;
        continue;
      }
      mechanicalUsage.transitions += 1;
      remaining -= 1;
      if (currentRecordCapture !== undefined) {
        const advancedRecord = advanceCurrentRecord("finish");
        if (advancedRecord instanceof DeclarativeV2SemanticRecordV1Error) {
          closed = true;
          return Result.fail(advancedRecord);
        }
        if (advancedRecord !== undefined) emitted.push(advancedRecord);
        continue;
      }
      const advanced = advanceCompleteness();
      if (advanced instanceof DeclarativeV2SemanticRecordV1Error) {
        closed = true;
        return Result.fail(advanced);
      }
    }
    if (complete) closed = true;
    return Result.succeed(Object.freeze({
      status: complete ? "complete" : "pending",
      consumedInputBytes: 0,
      records: Object.freeze(emitted),
      usage: usage(),
      mechanical: mechanical(before),
      detailed: detailed(detailedBefore),
    }));
  };

  return Result.succeed(Object.freeze({ push, finish }));
}

import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

export interface NormalizedRuntimeValue {
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly semanticBytes: number;
  readonly nestingDepth: number;
}

export interface ValidatorIssue {
  readonly path: string;
  readonly reason:
    | "typeMismatch"
    | "literalMismatch"
    | "missingRequiredField"
    | "unexpectedField"
    | "unionMismatch"
    | "idMismatch"
    | "idAuthorityUnavailable";
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const MAX_VALUE_BYTES = 1 << 25;
const MAX_VALUE_NESTING = 64;
const MAX_ARRAY_ITEMS = 8_192;
const MAX_OBJECT_FIELDS = 1_024;
const MAX_OBJECT_FIELD_BYTES = 1_024;
const MAX_VALIDATOR_JSON_NODES_V1:
  typeof import("flarex-protocol/validator-json")
    .MAX_VALIDATOR_JSON_NODES_V1 = 65_536;
const MAX_VALIDATOR_JSON_DEPTH_V1:
  typeof import("flarex-protocol/validator-json")
    .MAX_VALIDATOR_JSON_DEPTH_V1 = 128;
const MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1:
  typeof import("flarex-protocol/validator-json")
    .MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1 = 1_024;
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;
const TEXT_ENCODER = new TextEncoder();
const FLOAT64_COMPARISON_VIEW = new DataView(new ArrayBuffer(16));

export function validateValue(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  tableIdsByName: ReadonlyMap<string, number>,
): ValidatorIssue | undefined {
  switch (validator.type) {
    case "any":
      return undefined;
    case "null":
      return value === null ? undefined : issue(path, "typeMismatch");
    case "number":
      return typeof value === "number"
        ? undefined
        : issue(path, "typeMismatch");
    case "bigint":
      return typeof value === "bigint"
        ? undefined
        : issue(path, "typeMismatch");
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : issue(path, "typeMismatch");
    case "string":
      return typeof value === "string"
        ? undefined
        : issue(path, "typeMismatch");
    case "bytes":
      return value instanceof ArrayBuffer
        ? undefined
        : issue(path, "typeMismatch");
    case "id": {
      if (typeof value !== "string") return issue(path, "typeMismatch");
      const tableId = tableIdsByName.get(validator.tableName);
      if (tableId === undefined) {
        return issue(path, "idAuthorityUnavailable");
      }
      return isAppDocumentIdForTable(value, tableId)
        ? undefined
        : issue(path, "idMismatch");
    }
    case "literal":
      return literalValuesMatch(value, validator.value)
        ? undefined
        : issue(path, "literalMismatch");
    case "array": {
      if (!Array.isArray(value)) return issue(path, "typeMismatch");
      for (let index = 0; index < value.length; index += 1) {
        const member = value[index];
        if (member === undefined) return issue(path, "typeMismatch");
        const memberIssue = validateValue(
          validator.value,
          member,
          `${path}[${index}]`,
          tableIdsByName,
        );
        if (memberIssue !== undefined) return memberIssue;
      }
      return undefined;
    }
    case "object": {
      if (!isRuntimeObject(value)) return issue(path, "typeMismatch");
      for (const [fieldName, field] of Object.entries(validator.value)) {
        const fieldPath = appendFieldPath(path, fieldName);
        if (!Object.hasOwn(value, fieldName)) {
          if (!field.optional) {
            return issue(fieldPath, "missingRequiredField");
          }
          continue;
        }
        const fieldValue = value[fieldName];
        if (fieldValue === undefined) {
          return issue(fieldPath, "typeMismatch");
        }
        const fieldIssue = validateValue(
          field.fieldType,
          fieldValue,
          fieldPath,
          tableIdsByName,
        );
        if (fieldIssue !== undefined) return fieldIssue;
      }
      for (const fieldName of Object.keys(value)) {
        if (!Object.hasOwn(validator.value, fieldName)) {
          return issue(
            appendFieldPath(path, fieldName),
            "unexpectedField",
          );
        }
      }
      return undefined;
    }
    case "record": {
      if (!isRuntimeObject(value)) return issue(path, "typeMismatch");
      for (const [fieldName, fieldValue] of Object.entries(value)) {
        const fieldPath = appendFieldPath(path, fieldName);
        const keyIssue = validateValue(
          validator.keys,
          fieldName,
          `${fieldPath} (key)`,
          tableIdsByName,
        );
        if (keyIssue !== undefined) return keyIssue;
        const valueIssue = validateValue(
          validator.values,
          fieldValue,
          fieldPath,
          tableIdsByName,
        );
        if (valueIssue !== undefined) return valueIssue;
      }
      return undefined;
    }
    case "union": {
      for (const member of validator.value) {
        if (
          validateValue(member, value, path, tableIdsByName) === undefined
        ) {
          return undefined;
        }
      }
      return issue(path, "unionMismatch");
    }
  }
}

export function requireValidatorAdmission(root: ValidatorJsonV1): void {
  const pending: Array<Readonly<{
    readonly validator: ValidatorJsonV1;
    readonly depth: number;
  }>> = [{ validator: root, depth: 1 }];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    nodes += 1;
    if (nodes > MAX_VALIDATOR_JSON_NODES_V1) {
      throw new Error("Exact-runtime validator has too many nodes.");
    }
    if (entry.depth > MAX_VALIDATOR_JSON_DEPTH_V1) {
      throw new Error("Exact-runtime validator is too deeply nested.");
    }
    const childDepth = entry.depth + 1;
    switch (entry.validator.type) {
      case "array":
        pending.push({
          validator: entry.validator.value,
          depth: childDepth,
        });
        break;
      case "object": {
        const fields = Object.values(entry.validator.value);
        if (fields.length > MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1) {
          throw new Error(
            "Exact-runtime object validator has too many fields.",
          );
        }
        for (const field of fields) {
          pending.push({
            validator: field.fieldType,
            depth: childDepth,
          });
        }
        break;
      }
      case "record":
        pending.push(
          { validator: entry.validator.values, depth: childDepth },
          { validator: entry.validator.keys, depth: childDepth },
        );
        break;
      case "union":
        for (const member of entry.validator.value) {
          pending.push({ validator: member, depth: childDepth });
        }
        break;
      default:
        break;
    }
  }
}

function isAppDocumentIdForTable(value: string, tableId: number): boolean {
  const separator = value.indexOf(":");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf(":") ||
    value.slice(0, separator) !== String(tableId)
  ) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    .test(value.slice(separator + 1));
}

function issue(
  path: string,
  reason: ValidatorIssue["reason"],
): ValidatorIssue {
  return Object.freeze({ path, reason });
}

function appendFieldPath(path: string, fieldName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(fieldName)
    ? `${path}.${fieldName}`
    : `${path}[${JSON.stringify(fieldName)}]`;
}

function literalValuesMatch(
  value: CanonicalFlarexRuntimeValueV1,
  literal: string | number | boolean,
): boolean {
  if (typeof literal !== "number") return value === literal;
  if (typeof value !== "number") return false;
  FLOAT64_COMPARISON_VIEW.setFloat64(0, value, false);
  FLOAT64_COMPARISON_VIEW.setFloat64(8, literal, false);
  return FLOAT64_COMPARISON_VIEW.getBigUint64(0, false) ===
    FLOAT64_COMPARISON_VIEW.getBigUint64(8, false);
}

export function normalizeRuntimeValue(
  value: unknown,
  path: string,
  parentNesting: number,
  ancestors: WeakSet<object>,
): NormalizedRuntimeValue {
  if (value === null || typeof value === "boolean") {
    return { value, semanticBytes: 1, nestingDepth: 0 };
  }
  if (typeof value === "number") {
    return { value, semanticBytes: 9, nestingDepth: 0 };
  }
  if (typeof value === "bigint") {
    if (value < MIN_INT64 || value > MAX_INT64) {
      throw new Error(`${path} bigint must fit signed int64.`);
    }
    return { value, semanticBytes: 9, nestingDepth: 0 };
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    const semanticBytes = 2 + TEXT_ENCODER.encode(value).byteLength;
    assertValueSize(semanticBytes, path);
    return { value, semanticBytes, nestingDepth: 0 };
  }
  if (value instanceof ArrayBuffer) {
    const semanticBytes = 2 + value.byteLength;
    assertValueSize(semanticBytes, path);
    return {
      value: value.slice(0),
      semanticBytes,
      nestingDepth: 0,
    };
  }
  if (Array.isArray(value)) {
    validateArrayShape(value, path);
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new Error(`${path} has too many array items.`);
    }
    const nesting = parentNesting + 1;
    assertNesting(nesting, path);
    return withAncestor(value, path, ancestors, () => {
      let semanticBytes = 2;
      let childNestingDepth = 0;
      const normalized: CanonicalFlarexRuntimeValueV1[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new Error(`${path} must be a dense data-property array.`);
        }
        const child = normalizeRuntimeValue(
          descriptor.value,
          `${path}[${index}]`,
          nesting,
          ancestors,
        );
        semanticBytes += child.semanticBytes;
        assertValueSize(semanticBytes, path);
        childNestingDepth = Math.max(
          childNestingDepth,
          child.nestingDepth,
        );
        normalized.push(child.value);
      }
      return {
        value: Object.freeze(normalized),
        semanticBytes,
        nestingDepth: 1 + childNestingDepth,
      };
    });
  }
  if (typeof value === "object" && value !== null) {
    if (!isPlainRecord(value)) {
      throw new Error(`${path} must be a plain data object.`);
    }
    const entries = ownEnumerableDataEntries(value, path)
      .filter((entry) => entry[1] !== undefined);
    if (entries.length > MAX_OBJECT_FIELDS) {
      throw new Error(`${path} has too many object fields.`);
    }
    const nesting = parentNesting + 1;
    assertNesting(nesting, path);
    return withAncestor(value, path, ancestors, () => {
      let semanticBytes = 2;
      let childNestingDepth = 0;
      const normalized: Record<string, CanonicalFlarexRuntimeValueV1> = {};
      for (const [key, item] of entries.sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )) {
        if (!isValidObjectField(key)) {
          throw new Error(`${path} has an invalid object field.`);
        }
        const child = normalizeRuntimeValue(
          item,
          `${path}.${key}`,
          nesting,
          ancestors,
        );
        semanticBytes += key.length + 1 + child.semanticBytes;
        assertValueSize(semanticBytes, path);
        childNestingDepth = Math.max(
          childNestingDepth,
          child.nestingDepth,
        );
        Object.defineProperty(normalized, key, {
          value: child.value,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      return {
        value: Object.freeze(normalized),
        semanticBytes,
        nestingDepth: 1 + childNestingDepth,
      };
    });
  }
  throw new Error(`${path} is not a Flarex runtime value.`);
}

export function isRuntimeObject(
  value: CanonicalFlarexRuntimeValueV1,
): value is CanonicalFlarexRuntimeObjectV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer)
  );
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function ownEnumerableDataEntries(
  value: object,
  label: string,
): ReadonlyArray<readonly [string, unknown]> {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      throw new Error(`${label} must not contain symbol properties.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(
        `${label} must contain only enumerable data properties.`,
      );
    }
    return [key, descriptor.value];
  });
}

function validateArrayShape(
  value: ReadonlyArray<unknown>,
  label: string,
): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    throw new Error(`${label} must be dense and have no extra properties.`);
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= value.length
    ) {
      throw new Error(`${label} contains a non-index array property.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(
        `${label} must contain enumerable data array items.`,
      );
    }
  }
}

function withAncestor<T>(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
  operation: () => T,
): T {
  if (ancestors.has(value)) {
    throw new Error(`${path} must be acyclic.`);
  }
  ancestors.add(value);
  try {
    return operation();
  } finally {
    ancestors.delete(value);
  }
}

function isValidObjectField(field: string): boolean {
  if (
    field.length > MAX_OBJECT_FIELD_BYTES ||
    field.startsWith("$")
  ) {
    return false;
  }
  for (let index = 0; index < field.length; index += 1) {
    const codeUnit = field.charCodeAt(index);
    if (codeUnit < 0x20 || codeUnit >= 0x7f) return false;
  }
  return true;
}

function assertWellFormedUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${path} must be well-formed Unicode.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${path} must be well-formed Unicode.`);
    }
  }
}

function assertValueSize(size: number, path: string): void {
  if (size > MAX_VALUE_BYTES) {
    throw new Error(`${path} exceeds the exact-runtime value byte limit.`);
  }
}

function assertNesting(nesting: number, path: string): void {
  if (nesting > MAX_VALUE_NESTING) {
    throw new Error(`${path} exceeds the exact-runtime nesting limit.`);
  }
}

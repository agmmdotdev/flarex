import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

const NUMBER_IS_FINITE = Number.isFinite;
const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_ENTRIES = Object.entries;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_HAS_OWN = Object.hasOwn;
const OBJECT_IS = Object.is;
const RANGE_ERROR = RangeError;

export type ApplicationValidatorScalarType = Extract<
  ValidatorJsonV1,
  Readonly<{
    readonly type:
      | "null"
      | "number"
      | "bigint"
      | "boolean"
      | "string"
      | "bytes"
      | "any";
  }>
>["type"];

export interface ApplicationValidatorObjectFieldInput {
  readonly fieldType: ValidatorJsonV1;
  readonly optional: boolean;
}

export function applicationScalarValidatorJson<
  Type extends ApplicationValidatorScalarType,
>(type: Type): Readonly<{ readonly type: Type }> {
  return OBJECT_FREEZE({ type });
}

export function applicationIdValidatorJson(
  tableName: string,
): ValidatorJsonV1 {
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new RANGE_ERROR(
      "Application ID validator table names must be non-empty.",
    );
  }
  return OBJECT_FREEZE({ type: "id", tableName });
}

export function applicationLiteralValidatorJson<
  Literal extends string | number | boolean,
>(value: Literal): Readonly<{ readonly type: "literal"; readonly value: Literal }> {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new RANGE_ERROR(
      "Application validator literals must be strings, numbers, or booleans.",
    );
  }
  if (
    typeof value === "number" &&
    (!NUMBER_IS_FINITE(value) || OBJECT_IS(value, -0))
  ) {
    throw new RANGE_ERROR(
      "Application numeric validator literals must be finite and not negative zero.",
    );
  }
  return OBJECT_FREEZE({ type: "literal", value });
}

export function applicationArrayValidatorJson(
  value: ValidatorJsonV1,
): ValidatorJsonV1 {
  return OBJECT_FREEZE({
    type: "array",
    value: snapshotApplicationValidatorJson(value),
  });
}

export function applicationObjectValidatorJson(
  fields: Readonly<Record<string, ApplicationValidatorObjectFieldInput>>,
): ObjectValidatorJsonV1 {
  const value: Record<
    string,
    Readonly<{
      readonly fieldType: ValidatorJsonV1;
      readonly optional: boolean;
    }>
  > = OBJECT_CREATE(null);
  const entries = OBJECT_ENTRIES(fields);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const fieldName = entry[0];
    const field = entry[1];
    OBJECT_DEFINE_PROPERTY(value, fieldName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: OBJECT_FREEZE({
        fieldType: snapshotApplicationValidatorJson(field.fieldType),
        optional: field.optional,
      }),
    });
  }
  OBJECT_FREEZE(value);
  return OBJECT_FREEZE({ type: "object", value });
}

export function applicationRecordValidatorJson(
  keys: ValidatorJsonV1,
  values: ValidatorJsonV1,
): ValidatorJsonV1 {
  return OBJECT_FREEZE({
    type: "record",
    keys: snapshotApplicationValidatorJson(keys),
    values: snapshotApplicationValidatorJson(values),
  });
}

export function applicationUnionValidatorJson(
  members: readonly [ValidatorJsonV1, ...ReadonlyArray<ValidatorJsonV1>],
): ValidatorJsonV1 {
  return OBJECT_FREEZE({
    type: "union",
    value: snapshotApplicationValidatorJsonArray(members),
  });
}

export function snapshotApplicationValidatorJson(
  json: ValidatorJsonV1,
): ValidatorJsonV1 {
  switch (json.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return applicationScalarValidatorJson(json.type);
    case "id":
      return applicationIdValidatorJson(json.tableName);
    case "literal":
      return applicationLiteralValidatorJson(json.value);
    case "array":
      return applicationArrayValidatorJson(json.value);
    case "object":
      return applicationObjectValidatorJson(json.value);
    case "record":
      return applicationRecordValidatorJson(json.keys, json.values);
    case "union":
      return OBJECT_FREEZE({
        type: "union",
        value: snapshotApplicationValidatorJsonArray(json.value),
      });
  }
}

function snapshotApplicationValidatorJsonArray(
  values: ReadonlyArray<ValidatorJsonV1>,
): ReadonlyArray<ValidatorJsonV1> {
  const snapshot: ValidatorJsonV1[] = [];
  const length = values.length;
  OBJECT_DEFINE_PROPERTY(snapshot, "length", { value: length });
  for (let index = 0; index < length; index += 1) {
    if (!OBJECT_HAS_OWN(values, index)) continue;
    OBJECT_DEFINE_PROPERTY(snapshot, index, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: snapshotApplicationValidatorJson(values[index]!),
    });
  }
  return OBJECT_FREEZE(snapshot);
}

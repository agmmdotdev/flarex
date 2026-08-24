import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

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
  return Object.freeze({ type });
}

export function applicationIdValidatorJson(
  tableName: string,
): ValidatorJsonV1 {
  if (tableName.length === 0) {
    throw new RangeError("Application ID validator table names must be non-empty.");
  }
  return Object.freeze({ type: "id", tableName });
}

export function applicationLiteralValidatorJson<
  Literal extends string | number | boolean,
>(value: Literal): Readonly<{ readonly type: "literal"; readonly value: Literal }> {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Object.is(value, -0))
  ) {
    throw new RangeError(
      "Application numeric validator literals must be finite and not negative zero.",
    );
  }
  return Object.freeze({ type: "literal", value });
}

export function applicationArrayValidatorJson(
  value: ValidatorJsonV1,
): ValidatorJsonV1 {
  return Object.freeze({
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
  > = Object.create(null);
  for (const [fieldName, field] of Object.entries(fields)) {
    Object.defineProperty(value, fieldName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: Object.freeze({
        fieldType: snapshotApplicationValidatorJson(field.fieldType),
        optional: field.optional,
      }),
    });
  }
  Object.freeze(value);
  return Object.freeze({ type: "object", value });
}

export function applicationRecordValidatorJson(
  keys: ValidatorJsonV1,
  values: ValidatorJsonV1,
): ValidatorJsonV1 {
  return Object.freeze({
    type: "record",
    keys: snapshotApplicationValidatorJson(keys),
    values: snapshotApplicationValidatorJson(values),
  });
}

export function applicationUnionValidatorJson(
  members: readonly [ValidatorJsonV1, ...ReadonlyArray<ValidatorJsonV1>],
): ValidatorJsonV1 {
  return Object.freeze({
    type: "union",
    value: Object.freeze(members.map(snapshotApplicationValidatorJson)),
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
      return Object.freeze({
        type: "union",
        value: Object.freeze(json.value.map(snapshotApplicationValidatorJson)),
      });
  }
}

import { Schema } from "effect";

export const MAX_VALIDATOR_JSON_NODES_V1 = 65_536;
export const MAX_VALIDATOR_JSON_DEPTH_V1 = 128;
export const MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1 = 1_024;

const ValidatorIdTableName = Schema.String.check(
  Schema.makeFilter(value => value.length > 0
    ? undefined
    : "tableName must be a Convex-compatible table identifier"),
);

const ValidatorNumberLiteralV1 = Schema.Finite.check(
  Schema.makeFilter(value =>
    Object.is(value, -0)
      ? "numeric validator literals must not be negative zero"
      : undefined
  ),
);

export type ObjectValidatorJsonV1 = {
  readonly type: "object";
  readonly value: Readonly<
    Record<
      string,
      {
        readonly fieldType: ValidatorJsonV1;
        readonly optional: boolean;
      }
    >
  >;
};

export type ValidatorJsonV1 =
  | {
      readonly type:
        | "null"
        | "number"
        | "bigint"
        | "boolean"
        | "string"
        | "bytes"
        | "any";
    }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: string | number | boolean }
  | { readonly type: "array"; readonly value: ValidatorJsonV1 }
  | ObjectValidatorJsonV1
  | {
      readonly type: "record";
      readonly keys: ValidatorJsonV1;
      readonly values: ValidatorJsonV1;
    }
  | {
      readonly type: "union";
      readonly value: ReadonlyArray<ValidatorJsonV1>;
    };

export const ValidatorJsonV1: Schema.Codec<ValidatorJsonV1> =
  Schema.suspend(() =>
    Schema.Union([
      Schema.Struct({
        type: Schema.Union([
          Schema.Literal("null"),
          Schema.Literal("number"),
          Schema.Literal("bigint"),
          Schema.Literal("boolean"),
          Schema.Literal("string"),
          Schema.Literal("bytes"),
          Schema.Literal("any"),
        ]),
      }),
      Schema.Struct({
        type: Schema.Literal("id"),
        tableName: ValidatorIdTableName,
      }),
      Schema.Struct({
        type: Schema.Literal("literal"),
        value: Schema.Union([
          Schema.String,
          ValidatorNumberLiteralV1,
          Schema.Boolean,
        ]),
      }),
      Schema.Struct({
        type: Schema.Literal("array"),
        value: ValidatorJsonV1,
      }),
      objectValidatorJsonV1Schema(),
      Schema.Struct({
        type: Schema.Literal("record"),
        keys: ValidatorJsonV1,
        values: ValidatorJsonV1,
      }),
      Schema.Struct({
        type: Schema.Literal("union"),
        value: Schema.Array(ValidatorJsonV1),
      }),
    ]),
  );

export const ObjectValidatorJsonV1: Schema.Codec<ObjectValidatorJsonV1> =
  Schema.suspend(objectValidatorJsonV1Schema);

export type ValidatorJson = ValidatorJsonV1;
export const ValidatorJson = ValidatorJsonV1;
export type ObjectValidatorJson = ObjectValidatorJsonV1;
export const ObjectValidatorJson = ObjectValidatorJsonV1;

export type ValidatorJsonAdmissionIssueV1 = Readonly<{
  readonly reason:
    | "tooManyNodes"
    | "tooDeep"
    | "tooManyObjectFields"
    | "malformedContainer";
}>;

const MISSING_VALIDATOR_PROPERTY = Symbol("missingValidatorProperty");
const MALFORMED_VALIDATOR_PROPERTY = Symbol("malformedValidatorProperty");

export function validatorJsonAdmissionIssueV1(
  root: unknown,
): ValidatorJsonAdmissionIssueV1 | undefined {
  const pending: Array<Readonly<{
    readonly value: unknown;
    readonly depth: number;
  }>> = [{ value: root, depth: 1 }];
  let nodes = 0;
  try {
    while (pending.length > 0) {
      const entry = pending.pop();
      if (entry === undefined) break;
      nodes += 1;
      if (nodes > MAX_VALIDATOR_JSON_NODES_V1) {
        return admissionIssue("tooManyNodes");
      }
      if (entry.depth > MAX_VALIDATOR_JSON_DEPTH_V1) {
        return admissionIssue("tooDeep");
      }
      if (!isObjectContainer(entry.value)) continue;
      const type = ownValidatorDataProperty(entry.value, "type");
      if (type === MALFORMED_VALIDATOR_PROPERTY) {
        return admissionIssue("malformedContainer");
      }
      if (
        type === MISSING_VALIDATOR_PROPERTY ||
        typeof type !== "string"
      ) {
        continue;
      }
      const childDepth = entry.depth + 1;
      switch (type) {
        case "array": {
          const child = ownValidatorDataProperty(entry.value, "value");
          if (child === MALFORMED_VALIDATOR_PROPERTY) {
            return admissionIssue("malformedContainer");
          }
          if (child !== MISSING_VALIDATOR_PROPERTY) {
            pending.push({ value: child, depth: childDepth });
          }
          break;
        }
        case "object": {
          const fields = ownValidatorDataProperty(entry.value, "value");
          if (fields === MALFORMED_VALIDATOR_PROPERTY) {
            return admissionIssue("malformedContainer");
          }
          if (
            fields === MISSING_VALIDATOR_PROPERTY ||
            !isObjectContainer(fields) ||
            Array.isArray(fields)
          ) {
            break;
          }
          const keys = Reflect.ownKeys(fields);
          if (keys.some((key) => typeof key !== "string")) {
            return admissionIssue("malformedContainer");
          }
          if (keys.length > MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1) {
            return admissionIssue("tooManyObjectFields");
          }
          for (const key of keys) {
            if (typeof key !== "string") continue;
            const field = ownValidatorDataProperty(fields, key);
            if (field === MALFORMED_VALIDATOR_PROPERTY) {
              return admissionIssue("malformedContainer");
            }
            if (
              field === MISSING_VALIDATOR_PROPERTY ||
              !isObjectContainer(field)
            ) {
              continue;
            }
            const fieldType = ownValidatorDataProperty(field, "fieldType");
            if (fieldType === MALFORMED_VALIDATOR_PROPERTY) {
              return admissionIssue("malformedContainer");
            }
            if (fieldType !== MISSING_VALIDATOR_PROPERTY) {
              pending.push({ value: fieldType, depth: childDepth });
            }
          }
          break;
        }
        case "record": {
          for (const key of ["values", "keys"] as const) {
            const child = ownValidatorDataProperty(entry.value, key);
            if (child === MALFORMED_VALIDATOR_PROPERTY) {
              return admissionIssue("malformedContainer");
            }
            if (child !== MISSING_VALIDATOR_PROPERTY) {
              pending.push({ value: child, depth: childDepth });
            }
          }
          break;
        }
        case "union": {
          const members = ownValidatorDataProperty(entry.value, "value");
          if (members === MALFORMED_VALIDATOR_PROPERTY) {
            return admissionIssue("malformedContainer");
          }
          if (
            members === MISSING_VALIDATOR_PROPERTY ||
            !Array.isArray(members)
          ) {
            break;
          }
          const length = ownValidatorDataProperty(members, "length");
          if (
            length === MALFORMED_VALIDATOR_PROPERTY ||
            typeof length !== "number" ||
            !Number.isSafeInteger(length) ||
            length < 0
          ) {
            return admissionIssue("malformedContainer");
          }
          if (length > MAX_VALIDATOR_JSON_NODES_V1 - nodes) {
            return admissionIssue("tooManyNodes");
          }
          for (let index = length - 1; index >= 0; index -= 1) {
            const member = ownValidatorDataProperty(
              members,
              String(index),
            );
            if (
              member === MALFORMED_VALIDATOR_PROPERTY ||
              member === MISSING_VALIDATOR_PROPERTY
            ) {
              return admissionIssue("malformedContainer");
            }
            pending.push({ value: member, depth: childDepth });
          }
          break;
        }
        default:
          break;
      }
    }
    return undefined;
  } catch {
    return admissionIssue("malformedContainer");
  }
}

function objectValidatorJsonV1Schema(): Schema.Codec<ObjectValidatorJsonV1> {
  return Schema.Struct({
    type: Schema.Literal("object"),
    value: Schema.Record(
      Schema.String,
      Schema.Struct({
        fieldType: ValidatorJsonV1,
        optional: Schema.Boolean,
      }),
    ),
  });
}

function isObjectContainer(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function ownValidatorDataProperty(
  value: object,
  key: PropertyKey,
): unknown | typeof MISSING_VALIDATOR_PROPERTY |
  typeof MALFORMED_VALIDATOR_PROPERTY {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return MISSING_VALIDATOR_PROPERTY;
  return "value" in descriptor
    ? descriptor.value
    : MALFORMED_VALIDATOR_PROPERTY;
}

function admissionIssue(
  reason: ValidatorJsonAdmissionIssueV1["reason"],
): ValidatorJsonAdmissionIssueV1 {
  return Object.freeze({ reason });
}

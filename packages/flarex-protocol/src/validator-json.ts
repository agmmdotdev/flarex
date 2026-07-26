import { Schema } from "effect";

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

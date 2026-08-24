import { Schema } from "effect";

import type {
  ObjectValidatorJsonV1 as ObjectValidatorJsonV1Type,
  ValidatorJsonV1 as ValidatorJsonV1Type,
} from "./validator-json-core";
import { validatorJsonAdmissionIssueV1 } from "./validator-json-core";

export {
  MAX_VALIDATOR_JSON_DEPTH_V1,
  MAX_VALIDATOR_JSON_NODES_V1,
  MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1,
  validatorJsonAdmissionIssueV1,
  type ValidatorJsonAdmissionIssueV1,
} from "./validator-json-core";

export type ObjectValidatorJsonV1 = ObjectValidatorJsonV1Type;
export type ValidatorJsonV1 = ValidatorJsonV1Type;

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

const decodeValidatorJsonV1Sync = Schema.decodeUnknownSync(ValidatorJsonV1);

/**
 * Bounded unknown-input decoder for the protocol validator contract.
 * Authoring helpers construct exact values directly; trust boundaries use
 * this operation before analysis, persistence, or runtime interpretation.
 */
export function decodeValidatorJsonV1(value: unknown): ValidatorJsonV1 {
  const admissionIssue = validatorJsonAdmissionIssueV1(value);
  if (admissionIssue !== undefined) {
    throw new TypeError(
      `Validator JSON admission failed: ${admissionIssue.reason}.`,
    );
  }
  return decodeValidatorJsonV1Sync(value);
}

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

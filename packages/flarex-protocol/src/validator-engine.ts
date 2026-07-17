import { Data, Result } from "effect";

import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value";
import type { ValidatorJsonV1 } from "./validator-json";

export type ValidatorValueExpectedV1 =
  | "null"
  | "number"
  | "bigint"
  | "boolean"
  | "string"
  | "bytes"
  | "id"
  | "array"
  | "object";

export type ValidatorValueIssueV1 =
  | {
      readonly reason: "typeMismatch";
      readonly path: string;
      readonly expected: ValidatorValueExpectedV1;
    }
  | {
      readonly reason: "literalMismatch";
      readonly path: string;
      readonly literalType: "string" | "number" | "boolean";
    }
  | {
      readonly reason: "missingRequiredField";
      readonly path: string;
      readonly field: string;
    }
  | {
      readonly reason: "unexpectedField";
      readonly path: string;
      readonly field: string;
    }
  | {
      readonly reason: "unionMismatch";
      readonly path: string;
      readonly memberCount: number;
    }
  | {
      readonly reason: "idMismatch";
      readonly path: string;
      readonly tableName: string;
    }
  | {
      readonly reason: "idAuthorityUnavailable";
      readonly path: string;
      readonly tableName: string;
    };

export class ValidatorValueErrorV1 extends Data.TaggedError(
  "ValidatorValueErrorV1",
)<{
  readonly issue: ValidatorValueIssueV1;
}> {}

export type ValidatorIdPolicyV1 =
  | { readonly mode: "shapeOnly" }
  | {
      readonly mode: "tableAware";
      readonly check: (
        tableName: string,
        value: string,
      ) => "valid" | "invalid" | "unavailable";
    };

export interface ValidateValidatorValueV1Options {
  readonly path?: string;
  readonly idPolicy: ValidatorIdPolicyV1;
}

const FLOAT64_COMPARISON_VIEW = new DataView(new ArrayBuffer(16));

/**
 * Executes an already-decoded validator against an already-normalized Flarex
 * value. Unknown-input decoding and resource limits belong to Value Codec V1.
 */
export function validateValidatorValueV1(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  options: ValidateValidatorValueV1Options,
): Result.Result<void, ValidatorValueErrorV1> {
  return validateValidatorValueAtPathV1(
    validator,
    value,
    options.path ?? "$",
    options.idPolicy,
  );
}

function validateValidatorValueAtPathV1(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  idPolicy: ValidatorIdPolicyV1,
): Result.Result<void, ValidatorValueErrorV1> {
  switch (validator.type) {
    case "any":
      return Result.succeed(undefined);
    case "null":
      return value === null
        ? Result.succeed(undefined)
        : typeMismatch(path, "null");
    case "number":
      return typeof value === "number"
        ? Result.succeed(undefined)
        : typeMismatch(path, "number");
    case "bigint":
      return typeof value === "bigint"
        ? Result.succeed(undefined)
        : typeMismatch(path, "bigint");
    case "boolean":
      return typeof value === "boolean"
        ? Result.succeed(undefined)
        : typeMismatch(path, "boolean");
    case "string":
      return typeof value === "string"
        ? Result.succeed(undefined)
        : typeMismatch(path, "string");
    case "bytes":
      return value instanceof ArrayBuffer
        ? Result.succeed(undefined)
        : typeMismatch(path, "bytes");
    case "id":
      return validateId(validator.tableName, value, path, idPolicy);
    case "literal":
      return literalValuesMatch(value, validator.value)
        ? Result.succeed(undefined)
        : validationFailure({
            reason: "literalMismatch",
            path,
            literalType: validatorLiteralType(validator.value),
          });
    case "array": {
      if (!Array.isArray(value)) return typeMismatch(path, "array");
      for (let index = 0; index < value.length; index += 1) {
        const result = validateValidatorValueAtPathV1(
          validator.value,
          value[index],
          `${path}[${index}]`,
          idPolicy,
        );
        if (Result.isFailure(result)) return result;
      }
      return Result.succeed(undefined);
    }
    case "object": {
      if (!isCanonicalFlarexRuntimeObjectV1(value)) {
        return typeMismatch(path, "object");
      }
      for (const [fieldName, field] of Object.entries(validator.value)) {
        const fieldPath = appendFieldPath(path, fieldName);
        if (!Object.hasOwn(value, fieldName)) {
          if (!field.optional) {
            return validationFailure({
              reason: "missingRequiredField",
              path: fieldPath,
              field: fieldName,
            });
          }
          continue;
        }
        const result = validateValidatorValueAtPathV1(
          field.fieldType,
          value[fieldName],
          fieldPath,
          idPolicy,
        );
        if (Result.isFailure(result)) return result;
      }
      for (const fieldName of Object.keys(value)) {
        if (!Object.hasOwn(validator.value, fieldName)) {
          return validationFailure({
            reason: "unexpectedField",
            path: appendFieldPath(path, fieldName),
            field: fieldName,
          });
        }
      }
      return Result.succeed(undefined);
    }
    case "record": {
      if (!isCanonicalFlarexRuntimeObjectV1(value)) {
        return typeMismatch(path, "object");
      }
      for (const [fieldName, fieldValue] of Object.entries(value)) {
        const fieldPath = appendFieldPath(path, fieldName);
        const keyResult = validateValidatorValueAtPathV1(
          validator.keys,
          fieldName,
          `${fieldPath} (key)`,
          idPolicy,
        );
        if (Result.isFailure(keyResult)) return keyResult;
        const valueResult = validateValidatorValueAtPathV1(
          validator.values,
          fieldValue,
          fieldPath,
          idPolicy,
        );
        if (Result.isFailure(valueResult)) return valueResult;
      }
      return Result.succeed(undefined);
    }
    case "union": {
      if (validator.value.length === 1) {
        return validateValidatorValueAtPathV1(
          validator.value[0],
          value,
          path,
          idPolicy,
        );
      }
      for (const member of validator.value) {
        const result = validateValidatorValueAtPathV1(
          member,
          value,
          path,
          idPolicy,
        );
        if (Result.isSuccess(result)) return result;
      }
      return validationFailure({
        reason: "unionMismatch",
        path,
        memberCount: validator.value.length,
      });
    }
  }
}

/** Matches Convex's `TotalOrdF64` equality, including NaN payload bits. */
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

function validateId(
  tableName: string,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  idPolicy: ValidatorIdPolicyV1,
): Result.Result<void, ValidatorValueErrorV1> {
  if (typeof value !== "string") return typeMismatch(path, "id");
  if (idPolicy.mode === "shapeOnly") return Result.succeed(undefined);
  const verdict = idPolicy.check(tableName, value);
  if (verdict === "valid") return Result.succeed(undefined);
  return validationFailure(
    verdict === "unavailable"
      ? { reason: "idAuthorityUnavailable", path, tableName }
      : { reason: "idMismatch", path, tableName },
  );
}

function typeMismatch(
  path: string,
  expected: ValidatorValueExpectedV1,
): Result.Result<void, ValidatorValueErrorV1> {
  return validationFailure({ reason: "typeMismatch", path, expected });
}

function validationFailure(
  issue: ValidatorValueIssueV1,
): Result.Result<void, ValidatorValueErrorV1> {
  return Result.fail(new ValidatorValueErrorV1({ issue }));
}

function appendFieldPath(path: string, fieldName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(fieldName)
    ? `${path}.${fieldName}`
    : `${path}[${JSON.stringify(fieldName)}]`;
}

function validatorLiteralType(
  value: unknown,
): "string" | "number" | "boolean" {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  throw new TypeError("Decoded ValidatorJsonV1 contained an invalid literal.");
}

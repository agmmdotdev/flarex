import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value-runtime-core";
import type { ValidatorJsonV1 } from "./validator-json-core";

export type ValidatorValueExpectedV1 =
  | "null" | "number" | "bigint" | "boolean" | "string"
  | "bytes" | "id" | "array" | "object";

export type ValidatorValueIssueV1 =
  | { readonly reason: "typeMismatch"; readonly path: string;
      readonly expected: ValidatorValueExpectedV1 }
  | { readonly reason: "literalMismatch"; readonly path: string;
      readonly literalType: "string" | "number" | "boolean" }
  | { readonly reason: "missingRequiredField"; readonly path: string;
      readonly field: string }
  | { readonly reason: "unexpectedField"; readonly path: string;
      readonly field: string }
  | { readonly reason: "unionMismatch"; readonly path: string;
      readonly memberCount: number }
  | { readonly reason: "idMismatch"; readonly path: string;
      readonly tableName: string }
  | { readonly reason: "idAuthorityUnavailable"; readonly path: string;
      readonly tableName: string };

export type ValidatorIdPolicyV1 =
  | { readonly mode: "shapeOnly" }
  | { readonly mode: "tableAware"; readonly check: (
      tableName: string,
      value: string,
      path: string,
    ) => "valid" | "invalid" | "unavailable" };

export interface ValidateValidatorValueV1Options {
  readonly path?: string;
  readonly idPolicy: ValidatorIdPolicyV1;
}

const FLOAT64_COMPARISON_VIEW = new DataView(new ArrayBuffer(16));

/** Effect-free core for exact runtime kernels and the typed Result adapter. */
export function validateValidatorValueIssueV1(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  options: ValidateValidatorValueV1Options,
): ValidatorValueIssueV1 | undefined {
  return validateAtPath(validator, value, options.path ?? "$", options.idPolicy);
}

function validateAtPath(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  idPolicy: ValidatorIdPolicyV1,
): ValidatorValueIssueV1 | undefined {
  switch (validator.type) {
    case "any": return undefined;
    case "null": return value === null ? undefined : mismatch(path, "null");
    case "number": return typeof value === "number" ? undefined : mismatch(path, "number");
    case "bigint": return typeof value === "bigint" ? undefined : mismatch(path, "bigint");
    case "boolean": return typeof value === "boolean" ? undefined : mismatch(path, "boolean");
    case "string": return typeof value === "string" ? undefined : mismatch(path, "string");
    case "bytes": return value instanceof ArrayBuffer ? undefined : mismatch(path, "bytes");
    case "id": return validateId(validator.tableName, value, path, idPolicy);
    case "literal":
      return literalEqual(value, validator.value) ? undefined : {
        reason: "literalMismatch", path,
        literalType: literalType(validator.value),
      };
    case "array": {
      if (!Array.isArray(value)) return mismatch(path, "array");
      for (let index = 0; index < value.length; index += 1) {
        const issue = validateAtPath(
          validator.value, value[index]!, `${path}[${index}]`, idPolicy,
        );
        if (issue !== undefined) return issue;
      }
      return undefined;
    }
    case "object": {
      if (!isCanonicalFlarexRuntimeObjectV1(value)) return mismatch(path, "object");
      for (const [fieldName, field] of Object.entries(validator.value)) {
        const fieldPath = appendFieldPath(path, fieldName);
        if (!Object.hasOwn(value, fieldName)) {
          if (!field.optional) return {
            reason: "missingRequiredField", path: fieldPath, field: fieldName,
          };
          continue;
        }
        const issue = validateAtPath(
          field.fieldType, value[fieldName]!, fieldPath, idPolicy,
        );
        if (issue !== undefined) return issue;
      }
      for (const fieldName of Object.keys(value)) {
        if (!Object.hasOwn(validator.value, fieldName)) return {
          reason: "unexpectedField", path: appendFieldPath(path, fieldName),
          field: fieldName,
        };
      }
      return undefined;
    }
    case "record": {
      if (!isCanonicalFlarexRuntimeObjectV1(value)) return mismatch(path, "object");
      for (const [fieldName, fieldValue] of Object.entries(value)) {
        const fieldPath = appendFieldPath(path, fieldName);
        const keyIssue = validateAtPath(
          validator.keys, fieldName, `${fieldPath} (key)`, idPolicy,
        );
        if (keyIssue !== undefined) return keyIssue;
        const valueIssue = validateAtPath(
          validator.values, fieldValue, fieldPath, idPolicy,
        );
        if (valueIssue !== undefined) return valueIssue;
      }
      return undefined;
    }
    case "union": {
      if (validator.value.length === 1) {
        return validateAtPath(validator.value[0]!, value, path, idPolicy);
      }
      for (const member of validator.value) {
        if (validateAtPath(member, value, path, idPolicy) === undefined) {
          return undefined;
        }
      }
      return { reason: "unionMismatch", path,
        memberCount: validator.value.length };
    }
  }
}

function validateId(
  tableName: string,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  policy: ValidatorIdPolicyV1,
): ValidatorValueIssueV1 | undefined {
  if (typeof value !== "string") return mismatch(path, "id");
  if (policy.mode === "shapeOnly") return undefined;
  const verdict = policy.check(tableName, value, path);
  if (verdict === "valid") return undefined;
  return verdict === "unavailable"
    ? { reason: "idAuthorityUnavailable", path, tableName }
    : { reason: "idMismatch", path, tableName };
}

function mismatch(path: string, expected: ValidatorValueExpectedV1): ValidatorValueIssueV1 {
  return { reason: "typeMismatch", path, expected };
}

function literalEqual(
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

function appendFieldPath(path: string, fieldName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(fieldName)
    ? `${path}.${fieldName}`
    : `${path}[${JSON.stringify(fieldName)}]`;
}

function literalType(value: unknown): "string" | "number" | "boolean" {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  throw new TypeError("Decoded ValidatorJsonV1 contained an invalid literal.");
}

/** Convex common/schemas/validator.rs::is_subset, db914cf06. FSL-1.1-Apache-2.0. */
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { validatorIsSubsetOfStringV1, validatorLiteralEqualV1 } from "flarex-protocol/internal/validator-json-core";

/** False negatives are safe; this is a proof rule, never a sample-based guess. */
export function coreValidatorIsSubset(left: ValidatorJsonV1, right: ValidatorJsonV1): boolean {
  if (right.type === "string") return validatorIsSubsetOfStringV1(left);
  if (left.type === "array" && right.type === "array") return coreValidatorIsSubset(left.value, right.value);
  if (left.type === "object" && right.type === "object") {
    return Object.keys(left.value).every(key => Object.hasOwn(right.value, key))
      && Object.entries(right.value).every(([key, field]) => {
        const previous = left.value[key];
        return previous === undefined ? field.optional
          : (!previous.optional || field.optional) && coreValidatorIsSubset(previous.fieldType, field.fieldType);
      });
  }
  if (coreValidatorsEqual(left, right) || right.type === "any") return true;
  if (left.type === "literal" && ((typeof left.value === "number" && right.type === "number")
    || (typeof left.value === "bigint" && right.type === "bigint")
    || (typeof left.value === "boolean" && right.type === "boolean"))) return true;
  if (left.type === "union") return left.value.every(member => coreValidatorIsSubset(member, right));
  if (right.type === "union") return right.value.some(member => coreValidatorIsSubset(left, member))
    || (left.type === "boolean" && coreValidatorIsSubset({ type: "literal", value: true }, right)
      && coreValidatorIsSubset({ type: "literal", value: false }, right));
  return false;
}

export function coreValidatorsEqual(left: ValidatorJsonV1, right: ValidatorJsonV1): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "literal": return right.type === "literal" && validatorLiteralEqualV1(left.value, right.value);
    case "id": return right.type === "id" && left.tableName === right.tableName;
    case "array": return right.type === "array" && coreValidatorsEqual(left.value, right.value);
    case "union": return right.type === "union" && left.value.length === right.value.length
      && left.value.every((member, index) => {
        const other = right.value[index];
        return other !== undefined && coreValidatorsEqual(member, other);
      });
    case "record": return right.type === "record" && coreValidatorsEqual(left.keys, right.keys)
      && coreValidatorsEqual(left.values, right.values);
    case "object": return right.type === "object" && Object.keys(left.value).length === Object.keys(right.value).length
      && Object.entries(left.value).every(([key, field]) => {
        const other = right.value[key];
        return other !== undefined && field.optional === other.optional && coreValidatorsEqual(field.fieldType, other.fieldType);
      });
    case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any": return true;
  }
}

export function coreValidatorReferences(validator: ValidatorJsonV1, tableName: string): boolean {
  switch (validator.type) {
    case "id": return validator.tableName === tableName;
    case "array": return coreValidatorReferences(validator.value, tableName);
    case "object": return Object.values(validator.value).some(field => coreValidatorReferences(field.fieldType, tableName));
    case "record": return coreValidatorReferences(validator.keys, tableName) || coreValidatorReferences(validator.values, tableName);
    case "union": return validator.value.some(member => coreValidatorReferences(member, tableName));
    case "literal": case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any": return false;
  }
}

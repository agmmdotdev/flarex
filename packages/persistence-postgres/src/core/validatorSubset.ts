/** Convex common/schemas/validator.rs::is_subset, db914cf06. FSL-1.1-Apache-2.0. */
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { validatorIsSubsetOfStringV1, validatorLiteralEqualV1 } from "flarex-protocol/internal/validator-json-core";

/** False negatives are safe; this is a proof rule, never a sample-based guess. */
export function coreValidatorIsSubset(left: ValidatorJsonV1, right: ValidatorJsonV1): boolean {
  return isSubset(left, right, new WeakMap(), new WeakMap());
}

type PairMemo = WeakMap<ValidatorJsonV1, WeakMap<ValidatorJsonV1, boolean>>;
function remember(memo: PairMemo, left: ValidatorJsonV1, right: ValidatorJsonV1, verdict: boolean): boolean {
  let rights = memo.get(left);
  if (rights === undefined) { rights = new WeakMap(); memo.set(left, rights); }
  rights.set(right, verdict);
  return verdict;
}
function isSubset(left: ValidatorJsonV1, right: ValidatorJsonV1, memo: PairMemo, equalMemo: PairMemo): boolean {
  const known = memo.get(left)?.get(right);
  if (known !== undefined) return known;
  return remember(memo, left, right, subsetVerdict(left, right, memo, equalMemo));
}
function subsetVerdict(left: ValidatorJsonV1, right: ValidatorJsonV1, memo: PairMemo, equalMemo: PairMemo): boolean {
  if (right.type === "string") return validatorIsSubsetOfStringV1(left);
  if (left.type === "array" && right.type === "array") return isSubset(left.value, right.value, memo, equalMemo);
  if (left.type === "object" && right.type === "object") {
    return Object.keys(left.value).every(key => Object.hasOwn(right.value, key))
      && Object.entries(right.value).every(([key, field]) => {
        const previous = Object.hasOwn(left.value, key) ? left.value[key] : undefined;
        return previous === undefined ? field.optional
          : (!previous.optional || field.optional) && isSubset(previous.fieldType, field.fieldType, memo, equalMemo);
      });
  }
  if (validatorsEqual(left, right, equalMemo) || right.type === "any") return true;
  if (left.type === "function" && right.type === "function") return true;
  if ((left.type === "commitTs" && right.type === "bigint") || (left.type === "bigint" && right.type === "commitTs")) return true;
  if (left.type === "literal" && ((typeof left.value === "number" && right.type === "number")
    || (typeof left.value === "bigint" && (right.type === "bigint" || right.type === "commitTs"))
    || (typeof left.value === "boolean" && right.type === "boolean"))) return true;
  if (left.type === "union") return left.value.every(member => isSubset(member, right, memo, equalMemo));
  if (right.type === "union") return right.value.some(member => isSubset(left, member, memo, equalMemo))
    || (left.type === "boolean" && isSubset({ type: "literal", value: true }, right, memo, equalMemo)
      && isSubset({ type: "literal", value: false }, right, memo, equalMemo));
  return false;
}

export function coreValidatorsEqual(left: ValidatorJsonV1, right: ValidatorJsonV1): boolean {
  return validatorsEqual(left, right, new WeakMap());
}
function validatorsEqual(left: ValidatorJsonV1, right: ValidatorJsonV1, memo: PairMemo): boolean {
  if (left === right) return true;
  const known = memo.get(left)?.get(right);
  if (known !== undefined) return known;
  return remember(memo, left, right, equalityVerdict(left, right, memo));
}
function equalityVerdict(left: ValidatorJsonV1, right: ValidatorJsonV1, memo: PairMemo): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "literal": return right.type === "literal" && validatorLiteralEqualV1(left.value, right.value);
    case "id": return right.type === "id" && left.tableName === right.tableName;
    case "function": return right.type === "function" && left.fnType === right.fnType
      && optionalValidatorsEqual(left.args, right.args, memo) && optionalValidatorsEqual(left.returns, right.returns, memo);
    case "array": return right.type === "array" && validatorsEqual(left.value, right.value, memo);
    case "union": return right.type === "union" && left.value.length === right.value.length
      && left.value.every((member, index) => {
        const other = right.value[index];
        return other !== undefined && validatorsEqual(member, other, memo);
      });
    case "record": return right.type === "record" && validatorsEqual(left.keys, right.keys, memo)
      && validatorsEqual(left.values, right.values, memo);
    case "object": return right.type === "object" && Object.keys(left.value).length === Object.keys(right.value).length
      && Object.entries(left.value).every(([key, field]) => {
        const other = Object.hasOwn(right.value, key) ? right.value[key] : undefined;
        return other !== undefined && field.optional === other.optional && validatorsEqual(field.fieldType, other.fieldType, memo);
      });
    case "null": case "number": case "bigint": case "commitTs": case "boolean": case "string": case "bytes": case "any": return true;
  }
}

function optionalValidatorsEqual(left: ValidatorJsonV1 | undefined, right: ValidatorJsonV1 | undefined, memo: PairMemo): boolean {
  return left === undefined ? right === undefined : right !== undefined && validatorsEqual(left, right, memo);
}

export function coreValidatorReferences(validator: ValidatorJsonV1, tableName: string): boolean {
  return references(validator, tableName, new WeakSet());
}
function references(validator: ValidatorJsonV1, tableName: string, visited: WeakSet<ValidatorJsonV1>): boolean {
  if (visited.has(validator)) return false;
  visited.add(validator);
  switch (validator.type) {
    case "id": return validator.tableName === tableName;
    case "array": return references(validator.value, tableName, visited);
    case "object": return Object.values(validator.value).some(field => references(field.fieldType, tableName, visited));
    case "record": return references(validator.keys, tableName, visited) || references(validator.values, tableName, visited);
    case "union": return validator.value.some(member => references(member, tableName, visited));
    // Signature metadata is descriptive and does not create document foreign keys.
    case "function": case "literal": case "null": case "number": case "bigint": case "commitTs": case "boolean": case "string": case "bytes": case "any": return false;
  }
}

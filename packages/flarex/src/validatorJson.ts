import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import type { ValidatorJSON } from "./values.ts";

export function assertValidatorJson(
  value: unknown,
  path = "$validator",
): ValidatorJSON | null {
  if (value === null) return null;
  assertObject(value, "Expected validator object.", path);
  const type = value.type;
  if (typeof type !== "string") {
    throw new Error(`${path}.type: Validator type must be a string.`);
  }
  switch (type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type };
    case "id": {
      const tableName = value.tableName;
      if (typeof tableName !== "string" || tableName.length === 0) {
        throw new Error(`${path}.tableName: ID validator tableName must be a non-empty string.`);
      }
      return { type, tableName };
    }
    case "literal": {
      const literal = value.value;
      if (
        typeof literal !== "string" &&
        typeof literal !== "number" &&
        typeof literal !== "boolean"
      ) {
        throw new Error(`${path}.value: Literal validator value must be string, number, or boolean.`);
      }
      return { type, value: literal };
    }
    case "array":
      return { type, value: requiredValidator(value.value, `${path}.value`) };
    case "object": {
      assertObject(value.value, "Object validator value must be an object.", `${path}.value`);
      const fields: Array<readonly [
        string,
        { readonly fieldType: ValidatorJSON; readonly optional: boolean },
      ]> = [];
      for (const [name, rawField] of Object.entries(value.value)) {
        assertObject(rawField, "Object validator field must be an object.", `${path}.value.${name}`);
        if (typeof rawField.optional !== "boolean") {
          throw new Error(
            `${path}.value.${name}.optional: Object validator optional flag must be a boolean.`,
          );
        }
        fields.push([name, {
          fieldType: requiredValidator(rawField.fieldType, `${path}.value.${name}.fieldType`),
          optional: rawField.optional,
        }]);
      }
      return { type, value: Object.fromEntries(fields) };
    }
    case "record":
      return {
        type,
        keys: requiredValidator(value.keys, `${path}.keys`),
        values: requiredValidator(value.values, `${path}.values`),
      };
    case "union": {
      if (!Array.isArray(value.value)) {
        throw new Error(`${path}.value: Union validator value must be an array.`);
      }
      return {
        type,
        value: value.value.map((member, index) =>
          requiredValidator(member, `${path}.value[${index}]`),
        ),
      };
    }
    default:
      throw new Error(`${path}.type: Unknown validator type ${type}.`);
  }
}

function assertObject(
  value: unknown,
  message: string,
  path: string,
): asserts value is UnknownRecord {
  if (!isNonArrayRecord(value)) {
    throw new Error(`${path}: ${message}`);
  }
}

function requiredValidator(value: unknown, path: string): ValidatorJSON {
  const validator = assertValidatorJson(value, path);
  if (validator === null) throw new Error(`${path}: Validator is required.`);
  return validator;
}

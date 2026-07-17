import { isNonArrayRecord } from "@flarex/utils/records";
import type {
  GenericValidator,
  PropertyValidators,
  ValidatorJSON,
} from "./values";

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "ValidationError";
  }
}

export type ValidationOptions = {
  validateId?: (tableName: string, value: string, path: string) => void;
};

export function validateValue(
  validator: GenericValidator | PropertyValidators | ValidatorJSON,
  value: unknown,
  path = "$",
  options: ValidationOptions = {},
): void {
  validateJson(validatorToJson(validator), value, path, options);
}

export function validateFunctionArgs(
  args: GenericValidator | PropertyValidators,
  value: unknown,
  options: ValidationOptions = {},
): void {
  validateJson(validatorToJson(args), value, "$args", options);
}

export function validatorToJson(
  validator: GenericValidator | PropertyValidators | ValidatorJSON,
): ValidatorJSON {
  if ("isFlarexValidator" in validator) return validator.json;
  if (typeof (validator as { type?: unknown }).type === "string") {
    return validator as ValidatorJSON;
  }
  return functionArgsToValidatorJson(validator as PropertyValidators);
}

export function functionArgsToValidatorJson(
  args: GenericValidator | PropertyValidators,
): ValidatorJSON {
  if ("isFlarexValidator" in args) return args.json;
  return {
    type: "object",
    value: Object.fromEntries(
      Object.entries(args).map(([name, validator]) => [
        name,
        {
          fieldType: validator?.json,
          optional: validator?.isOptional === "optional",
        },
      ]),
    ),
  };
}

function validateJson(
  validator: ValidatorJSON,
  value: unknown,
  path: string,
  options: ValidationOptions,
): void {
  switch (validator.type) {
    case "any":
      return;
    case "null":
      return expect(value === null, "Expected null.", path);
    case "number":
      return expect(typeof value === "number" && Number.isFinite(value), "Expected a finite number.", path);
    case "bigint":
      return expect(typeof value === "bigint", "Expected a bigint.", path);
    case "boolean":
      return expect(typeof value === "boolean", "Expected a boolean.", path);
    case "string":
      return expect(typeof value === "string", "Expected a string.", path);
    case "bytes":
      return expect(value instanceof ArrayBuffer, "Expected an ArrayBuffer.", path);
    case "id":
      expect(typeof value === "string", `Expected an ID for table ${validator.tableName}.`, path);
      options.validateId?.(validator.tableName, value, path);
      return;
    case "literal":
      return expect(value === validator.value, `Expected literal ${String(validator.value)}.`, path);
    case "array":
      expect(Array.isArray(value), "Expected an array.", path);
      value.forEach((element, index) =>
        validateJson(validator.value, element, `${path}[${index}]`, options),
      );
      return;
    case "object":
      validateObject(validator.value, value, path, options);
      return;
    case "record":
      expect(isNonArrayRecord(value), "Expected an object.", path);
      for (const [key, entry] of Object.entries(value)) {
        validateJson(validator.keys, key, `${path}.${key} (key)`, options);
        validateJson(validator.values, entry, `${path}.${key}`, options);
      }
      return;
    case "union": {
      for (const member of validator.value) {
        try {
          validateJson(member, value, path, options);
          return;
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
        }
      }
      throw new ValidationError("Value does not match any union member.", path);
    }
  }
}

function validateObject(
  fields: Record<string, { fieldType: ValidatorJSON; optional: boolean }>,
  value: unknown,
  path: string,
  options: ValidationOptions,
): void {
  expect(isNonArrayRecord(value), "Expected an object.", path);
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, name)) {
      if (!field.optional) throw new ValidationError("Required field is missing.", `${path}.${name}`);
      continue;
    }
    validateJson(field.fieldType, value[name], `${path}.${name}`, options);
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(fields, name)) {
      throw new ValidationError("Field is not allowed.", `${path}.${name}`);
    }
  }
}

function expect(condition: boolean, message: string, path: string): asserts condition {
  if (!condition) throw new ValidationError(message, path);
}

export { assertValidatorJson } from "./validatorJson.ts";

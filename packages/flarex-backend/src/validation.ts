import type { Json, ValidatorJson } from "./types";

export type BackendValidationOptions = {
  validateId?: (tableName: string, value: string, path: string) => void;
};

export class BackendValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "BackendValidationError";
  }
}

export function validateJsonValue(
  validator: ValidatorJson,
  value: Json,
  path = "$",
  options: BackendValidationOptions = {},
): void {
  switch (validator.type) {
    case "any":
      return;
    case "null":
      return expect(value === null, "Expected null.", path);
    case "number":
      return expect(typeof value === "number" && Number.isFinite(value), "Expected a finite number.", path);
    case "bigint":
      throw new BackendValidationError("Bigint transport is not implemented.", path);
    case "boolean":
      return expect(typeof value === "boolean", "Expected a boolean.", path);
    case "string":
      return expect(typeof value === "string", "Expected a string.", path);
    case "bytes":
      throw new BackendValidationError("Bytes transport is not implemented.", path);
    case "id":
      expect(typeof value === "string", `Expected an ID for table ${validator.tableName}.`, path);
      options.validateId?.(validator.tableName, value, path);
      return;
    case "literal":
      return expect(value === validator.value, `Expected literal ${String(validator.value)}.`, path);
    case "array":
      expect(Array.isArray(value), "Expected an array.", path);
      value.forEach((element, index) =>
        validateJsonValue(validator.value, element, `${path}[${index}]`, options),
      );
      return;
    case "object":
      validateObject(validator.value, value, path, options);
      return;
    case "record":
      expect(isJsonObject(value), "Expected an object.", path);
      for (const [key, entry] of Object.entries(value)) {
        validateJsonValue(validator.keys, key, `${path}.${key} (key)`, options);
        validateJsonValue(validator.values, entry, `${path}.${key}`, options);
      }
      return;
    case "union":
      for (const member of validator.value) {
        try {
          validateJsonValue(member, value, path, options);
          return;
        } catch (error) {
          if (!(error instanceof BackendValidationError)) throw error;
        }
      }
      throw new BackendValidationError("Value does not match any union member.", path);
  }
}

export function assertValidatorJson(value: Json | undefined | null, path: string): ValidatorJson | null {
  if (value === undefined || value === null) return null;
  assertJsonObject(value, "Expected validator object.", path);
  const type = value.type;
  if (typeof type !== "string") throw new BackendValidationError("Validator type must be a string.", `${path}.type`);
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
        throw new BackendValidationError("ID validator tableName must be a non-empty string.", `${path}.tableName`);
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
        throw new BackendValidationError("Literal validator value must be string, number, or boolean.", `${path}.value`);
      }
      return { type, value: literal };
    }
    case "array":
      return { type, value: assertValidatorJson(value.value, `${path}.value`) ?? missingValidator(`${path}.value`) };
    case "object": {
      const rawFields = value.value;
      assertJsonObject(rawFields, "Object validator value must be an object.", `${path}.value`);
      const fields: Record<string, { fieldType: ValidatorJson; optional: boolean }> = {};
      for (const [name, rawField] of Object.entries(rawFields)) {
        assertJsonObject(rawField, "Object validator field must be an object.", `${path}.value.${name}`);
        if (typeof rawField.optional !== "boolean") {
          throw new BackendValidationError("Object validator optional flag must be a boolean.", `${path}.value.${name}.optional`);
        }
        fields[name] = {
          fieldType: assertValidatorJson(rawField.fieldType, `${path}.value.${name}.fieldType`) ??
            missingValidator(`${path}.value.${name}.fieldType`),
          optional: rawField.optional,
        };
      }
      return { type, value: fields };
    }
    case "record":
      return {
        type,
        keys: assertValidatorJson(value.keys, `${path}.keys`) ?? missingValidator(`${path}.keys`),
        values: assertValidatorJson(value.values, `${path}.values`) ?? missingValidator(`${path}.values`),
      };
    case "union": {
      if (!Array.isArray(value.value)) {
        throw new BackendValidationError("Union validator value must be an array.", `${path}.value`);
      }
      return {
        type,
        value: value.value.map((member, index) =>
          assertValidatorJson(member, `${path}.value[${index}]`) ??
            missingValidator(`${path}.value[${index}]`),
        ),
      };
    }
    default:
      throw new BackendValidationError(`Unknown validator type ${type}.`, `${path}.type`);
  }
}

function validateObject(
  fields: Record<string, { fieldType: ValidatorJson; optional: boolean }>,
  value: Json,
  path: string,
  options: BackendValidationOptions,
): void {
  expect(isJsonObject(value), "Expected an object.", path);
  for (const [name, field] of Object.entries(fields)) {
    if (!(name in value)) {
      if (!field.optional) throw new BackendValidationError("Required field is missing.", `${path}.${name}`);
      continue;
    }
    validateJsonValue(field.fieldType, value[name]!, `${path}.${name}`, options);
  }
  for (const name of Object.keys(value)) {
    if (!(name in fields)) throw new BackendValidationError("Field is not allowed.", `${path}.${name}`);
  }
}

function expect(condition: boolean, message: string, path: string): asserts condition {
  if (!condition) throw new BackendValidationError(message, path);
}

function isJsonObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonObject(
  value: unknown,
  message: string,
  path: string,
): asserts value is Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackendValidationError(message, path);
  }
}

function missingValidator(path: string): never {
  throw new BackendValidationError("Validator is required.", path);
}

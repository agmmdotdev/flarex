import { isWritableJsonObject } from "flarex-protocol/json";
import { Effect } from "effect";
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

export type BackendValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: BackendValidationError;
    };

function backendValidationSuccess<A>(value: A): BackendValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function backendValidationFailure<A = never>(
  message: string,
  path: string,
): BackendValidationResult<A> {
  return {
    success: false,
    error: new BackendValidationError(message, path),
  };
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
      expect(isWritableJsonObject(value), "Expected an object.", path);
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

export const validateJsonValueEffect = Effect.fn("Validation.validateJsonValue")(
  function* (
    validator: ValidatorJson,
    value: Json,
    path = "$",
    options: BackendValidationOptions = {},
  ): Effect.fn.Return<void, BackendValidationError> {
    return yield* Effect.suspend(() => {
      try {
        validateJsonValue(validator, value, path, options);
        return Effect.void;
      } catch (error) {
        if (error instanceof BackendValidationError) {
          return Effect.fail(error);
        }
        return Effect.die(error);
      }
    });
  },
);

export function assertValidatorJson(value: Json | undefined | null, path: string): ValidatorJson | null {
  const result = parseValidatorJson(value, path);
  if (result.success) return result.value;
  throw result.error;
}

export function parseValidatorJson(
  value: Json | undefined | null,
  path: string,
): BackendValidationResult<ValidatorJson | null> {
  if (value === undefined || value === null) return backendValidationSuccess(null);
  if (!isWritableJsonObject(value)) {
    return backendValidationFailure("Expected validator object.", path);
  }
  const type = value.type;
  if (typeof type !== "string") {
    return backendValidationFailure("Validator type must be a string.", `${path}.type`);
  }
  switch (type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return backendValidationSuccess({ type });
    case "id": {
      const tableName = value.tableName;
      if (typeof tableName !== "string" || tableName.length === 0) {
        return backendValidationFailure(
          "ID validator tableName must be a non-empty string.",
          `${path}.tableName`,
        );
      }
      return backendValidationSuccess({ type, tableName });
    }
    case "literal": {
      const literal = value.value;
      if (
        typeof literal !== "string" &&
        typeof literal !== "number" &&
        typeof literal !== "boolean"
      ) {
        return backendValidationFailure(
          "Literal validator value must be string, number, or boolean.",
          `${path}.value`,
        );
      }
      return backendValidationSuccess({ type, value: literal });
    }
    case "array": {
      const item = parseRequiredValidatorJson(value.value, `${path}.value`);
      if (!item.success) return item;
      return backendValidationSuccess({ type, value: item.value });
    }
    case "object": {
      const rawFields = value.value;
      if (!isWritableJsonObject(rawFields)) {
        return backendValidationFailure("Object validator value must be an object.", `${path}.value`);
      }
      const fields: Record<string, { fieldType: ValidatorJson; optional: boolean }> = {};
      for (const [name, rawField] of Object.entries(rawFields)) {
        if (!isWritableJsonObject(rawField)) {
          return backendValidationFailure("Object validator field must be an object.", `${path}.value.${name}`);
        }
        if (typeof rawField.optional !== "boolean") {
          return backendValidationFailure(
            "Object validator optional flag must be a boolean.",
            `${path}.value.${name}.optional`,
          );
        }
        const fieldType = parseRequiredValidatorJson(
          rawField.fieldType,
          `${path}.value.${name}.fieldType`,
        );
        if (!fieldType.success) return fieldType;
        fields[name] = {
          fieldType: fieldType.value,
          optional: rawField.optional,
        };
      }
      return backendValidationSuccess({ type, value: fields });
    }
    case "record": {
      const keys = parseRequiredValidatorJson(value.keys, `${path}.keys`);
      if (!keys.success) return keys;
      const values = parseRequiredValidatorJson(value.values, `${path}.values`);
      if (!values.success) return values;
      return backendValidationSuccess({
        type,
        keys: keys.value,
        values: values.value,
      });
    }
    case "union": {
      if (!Array.isArray(value.value)) {
        return backendValidationFailure("Union validator value must be an array.", `${path}.value`);
      }
      const members: ValidatorJson[] = [];
      for (const [index, member] of value.value.entries()) {
        const parsed = parseRequiredValidatorJson(member, `${path}.value[${index}]`);
        if (!parsed.success) return parsed;
        members.push(parsed.value);
      }
      return backendValidationSuccess({
        type,
        value: members,
      });
    }
    default:
      return backendValidationFailure(`Unknown validator type ${type}.`, `${path}.type`);
  }
}

function parseRequiredValidatorJson(
  value: Json | undefined,
  path: string,
): BackendValidationResult<ValidatorJson> {
  const parsed = parseValidatorJson(value, path);
  if (!parsed.success) return parsed;
  return parsed.value === null
    ? backendValidationFailure("Validator is required.", path)
    : backendValidationSuccess(parsed.value);
}

function validateObject(
  fields: Record<string, { fieldType: ValidatorJson; optional: boolean }>,
  value: Json,
  path: string,
  options: BackendValidationOptions,
): void {
  expect(isWritableJsonObject(value), "Expected an object.", path);
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

import { isWritableJsonObject } from "flarex-protocol/json";
import { Effect, Result } from "effect";
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

export type BackendValidationResult<A> = Result.Result<A, BackendValidationError>;

function backendValidationFailure<A = never>(
  message: string,
  path: string,
): BackendValidationResult<A> {
  return Result.fail(new BackendValidationError(message, path));
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
  (
    validator: ValidatorJson,
    value: Json,
    path = "$",
    options: BackendValidationOptions = {},
  ): Effect.Effect<void, BackendValidationError> =>
    Effect.suspend(() => {
      try {
        validateJsonValue(validator, value, path, options);
        return Effect.void;
      } catch (error) {
        if (error instanceof BackendValidationError) {
          return Effect.fail(error);
        }
        return Effect.die(error);
      }
    }),
);

export function assertValidatorJson(value: Json | undefined | null, path: string): ValidatorJson | null {
  return Result.getOrThrow(parseValidatorJson(value, path));
}

export function parseValidatorJson(
  value: Json | undefined | null,
  path: string,
): BackendValidationResult<ValidatorJson | null> {
  if (value === undefined || value === null) return Result.succeed(null);
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
      return Result.succeed({ type });
    case "id": {
      const tableName = value.tableName;
      if (typeof tableName !== "string" || tableName.length === 0) {
        return backendValidationFailure(
          "ID validator tableName must be a non-empty string.",
          `${path}.tableName`,
        );
      }
      return Result.succeed({ type, tableName });
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
      return Result.succeed({ type, value: literal });
    }
    case "array": {
      return parseRequiredValidatorJson(value.value, `${path}.value`).pipe(
        Result.map(item => ({ type, value: item })),
      );
    }
    case "object": {
      const rawFields = value.value;
      if (!isWritableJsonObject(rawFields)) {
        return backendValidationFailure("Object validator value must be an object.", `${path}.value`);
      }
      return Result.gen(function* () {
        const fields: Array<readonly [
          string,
          { readonly fieldType: ValidatorJson; readonly optional: boolean },
        ]> = [];
        for (const [name, rawField] of Object.entries(rawFields)) {
          if (!isWritableJsonObject(rawField)) {
            return yield* backendValidationFailure(
              "Object validator field must be an object.",
              `${path}.value.${name}`,
            );
          }
          if (typeof rawField.optional !== "boolean") {
            return yield* backendValidationFailure(
              "Object validator optional flag must be a boolean.",
              `${path}.value.${name}.optional`,
            );
          }
          const fieldType = yield* parseRequiredValidatorJson(
            rawField.fieldType,
            `${path}.value.${name}.fieldType`,
          );
          fields.push([name, {
            fieldType,
            optional: rawField.optional,
          }]);
        }
        return { type, value: Object.fromEntries(fields) };
      });
    }
    case "record": {
      return Result.gen(function* () {
        const keys = yield* parseRequiredValidatorJson(value.keys, `${path}.keys`);
        const values = yield* parseRequiredValidatorJson(value.values, `${path}.values`);
        return { type, keys, values };
      });
    }
    case "union": {
      if (!Array.isArray(value.value)) {
        return backendValidationFailure("Union validator value must be an array.", `${path}.value`);
      }
      const rawMembers = value.value;
      return Result.gen(function* () {
        const members: ValidatorJson[] = [];
        for (const [index, member] of rawMembers.entries()) {
          members.push(yield* parseRequiredValidatorJson(member, `${path}.value[${index}]`));
        }
        return { type, value: members };
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
  return parseValidatorJson(value, path).pipe(
    Result.flatMap(parsed => parsed === null
      ? backendValidationFailure("Validator is required.", path)
      : Result.succeed(parsed)),
  );
}

function validateObject(
  fields: Extract<ValidatorJson, { readonly type: "object" }>["value"],
  value: Json,
  path: string,
  options: BackendValidationOptions,
): void {
  expect(isWritableJsonObject(value), "Expected an object.", path);
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, name)) {
      if (!field.optional) throw new BackendValidationError("Required field is missing.", `${path}.${name}`);
      continue;
    }
    validateJsonValue(field.fieldType, value[name]!, `${path}.${name}`, options);
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(fields, name)) {
      throw new BackendValidationError("Field is not allowed.", `${path}.${name}`);
    }
  }
}

function expect(condition: boolean, message: string, path: string): asserts condition {
  if (!condition) throw new BackendValidationError(message, path);
}

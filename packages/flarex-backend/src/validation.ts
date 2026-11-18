import { isWritableJsonObject } from "flarex-protocol/json";
import { Effect, Result } from "effect";
import { decodeValidatorJsonWireResultCoreV1, validatorLiteralEqualV1 } from "flarex-protocol/internal/validator-json-core";
import { validateValidatorValueIssueV1 } from "flarex-protocol/internal/validator-engine-core";
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
    case "commitTs":
      throw new BackendValidationError("Bigint transport is not implemented.", path);
    case "function":
      return expect(validateValidatorValueIssueV1(validator, value, { path, idPolicy: { mode: "shapeOnly" } }) === undefined,
        "Expected a function handle.", path);
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
      if (typeof validator.value === "bigint") {
        throw new BackendValidationError("Bigint transport is not implemented.", path);
      }
      return expect(validatorLiteralEqualV1(value, validator.value), `Expected literal ${String(validator.value)}.`, path);
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
  value: unknown,
  path: string,
): BackendValidationResult<ValidatorJson | null> {
  if (value === undefined || value === null) return Result.succeed(null);
  const decoded = decodeValidatorJsonWireResultCoreV1(value);
  return decoded.ok
    ? Result.succeed(decoded.value)
    : Result.fail(new BackendValidationError(
      `Invalid validator JSON (${decoded.issue.reason}).`,
      `${path}${decoded.issue.path.slice(1)}`,
    ));
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

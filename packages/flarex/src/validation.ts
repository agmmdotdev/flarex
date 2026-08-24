import { applicationObjectValidatorJson } from "@flarex/application-schema-definition/validator-json";
import {
  validateValidatorValueIssueV1,
  type ValidatorValueExpectedV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/internal/validator-engine-core";
import {
  FlarexValueCodecV1Error,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";

import { assertValidatorJson } from "./validatorJson.ts";
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
  const validatorJson = validatorToJson(validator);
  let normalized;
  try {
    normalized = normalizeFlarexValueV1(value);
  } catch (cause) {
    if (!(cause instanceof FlarexValueCodecV1Error)) throw cause;
    throw new ValidationError(
      `Expected a valid Flarex value. ${cause.message}`,
      path,
    );
  }
  const issue = validateValidatorValueIssueV1(
    validatorJson,
    normalized.value,
    options.validateId === undefined
      ? { path, idPolicy: { mode: "shapeOnly" } }
      : {
          path,
          idPolicy: {
            mode: "tableAware",
            check: (tableName, id, issuePath) => {
              options.validateId?.(tableName, id, issuePath);
              return "valid";
            },
          },
        },
  );
  if (issue !== undefined) throw validationErrorFromIssue(issue);
}

export function validateFunctionArgs(
  args: GenericValidator | PropertyValidators,
  value: unknown,
  options: ValidationOptions = {},
): void {
  validateValue(args, value, "$args", options);
}

export function validatorToJson(
  validator: GenericValidator | PropertyValidators | ValidatorJSON,
): ValidatorJSON {
  if (isGenericValidator(validator)) {
    return requiredValidatorJson(validator.json, "$validator.json");
  }
  if (Object.hasOwn(validator, "type") && typeof validator.type === "string") {
    const decoded = assertValidatorJson(validator);
    if (decoded === null) {
      throw new Error("$validator: Validator is required.");
    }
    return decoded;
  }
  if (isPropertyValidators(validator)) {
    return functionArgsToValidatorJson(validator);
  }
  throw new Error("$validator: Expected a validator or validator field map.");
}

export function functionArgsToValidatorJson(
  args: GenericValidator | PropertyValidators,
): ValidatorJSON {
  if (isGenericValidator(args)) {
    return requiredValidatorJson(args.json, "$validator.json");
  }
  const fields: Record<
    string,
    Readonly<{ readonly fieldType: ValidatorJSON; readonly optional: boolean }>
  > = Object.create(null);
  for (const [name, validator] of Object.entries(args)) {
    Object.defineProperty(fields, name, {
      enumerable: true,
      value: {
        fieldType: requiredValidatorJson(
          validator.json,
          `$validator.${name}.json`,
        ),
        optional: validator.isOptional === "optional",
      },
    });
  }
  return applicationObjectValidatorJson(fields);
}

function validationErrorFromIssue(issue: ValidatorValueIssueV1): ValidationError {
  switch (issue.reason) {
    case "typeMismatch":
      return new ValidationError(typeMismatchMessage(issue.expected), issue.path);
    case "literalMismatch":
      return new ValidationError(
        `Expected a ${issue.literalType} literal.`,
        issue.path,
      );
    case "missingRequiredField":
      return new ValidationError("Required field is missing.", issue.path);
    case "unexpectedField":
      return new ValidationError("Field is not allowed.", issue.path);
    case "unionMismatch":
      return new ValidationError("Value does not match any union member.", issue.path);
    case "idMismatch":
      return new ValidationError(
        `Expected an ID for table ${issue.tableName}.`,
        issue.path,
      );
    case "idAuthorityUnavailable":
      return new ValidationError(
        `ID authority is unavailable for table ${issue.tableName}.`,
        issue.path,
      );
  }
}

function typeMismatchMessage(expected: ValidatorValueExpectedV1): string {
  switch (expected) {
    case "null": return "Expected null.";
    case "number": return "Expected a number.";
    case "bigint": return "Expected a bigint.";
    case "boolean": return "Expected a boolean.";
    case "string": return "Expected a string.";
    case "bytes": return "Expected an ArrayBuffer.";
    case "id": return "Expected an ID.";
    case "array": return "Expected an array.";
    case "object": return "Expected an object.";
  }
}

function isPropertyValidators(value: unknown): value is PropertyValidators {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((field) =>
    isGenericValidator(field)
  );
}

function isGenericValidator(value: unknown): value is GenericValidator {
  return typeof value === "object"
    && value !== null
    && "isFlarexValidator" in value
    && value.isFlarexValidator === true
    && "json" in value
    && typeof value.json === "object"
    && value.json !== null;
}

function requiredValidatorJson(value: unknown, path: string): ValidatorJSON {
  const decoded = assertValidatorJson(value, path);
  if (decoded === null) throw new Error(`${path}: Validator is required.`);
  return decoded;
}

export { assertValidatorJson } from "./validatorJson.ts";

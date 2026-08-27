import {
  applicationObjectValidatorJson,
  snapshotApplicationValidatorJson,
} from "@flarex/application-schema-definition/validator-json";
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
import { isOwnedValidator } from "./validatorOwnership";
import type {
  GenericValidator,
  PropertyValidators,
  ValidatorJSON,
} from "./values";

const ARRAY_IS_ARRAY = Array.isArray;
const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_ENTRIES = Object.entries;
const OBJECT_HAS_OWN = Object.hasOwn;
const OBJECT_VALUES = Object.values;

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
    return isOwnedValidator(validator)
      ? snapshotApplicationValidatorJson(validator.json)
      : requiredValidatorJson(validator.json, "$validator.json");
  }
  if (OBJECT_HAS_OWN(validator, "type") && typeof validator.type === "string") {
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
    return isOwnedValidator(args)
      ? snapshotApplicationValidatorJson(args.json)
      : requiredValidatorJson(args.json, "$validator.json");
  }
  const fields: Record<
    string,
    Readonly<{ readonly fieldType: ValidatorJSON; readonly optional: boolean }>
  > = OBJECT_CREATE(null);
  const entries = OBJECT_ENTRIES(args);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const name = entry[0];
    const validator = entry[1];
    OBJECT_DEFINE_PROPERTY(fields, name, {
      enumerable: true,
      value: {
        fieldType: isOwnedValidator(validator)
          ? validator.json
          : requiredValidatorJson(
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
  if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) {
    return false;
  }
  const fields = OBJECT_VALUES(value);
  for (let index = 0; index < fields.length; index += 1) {
    if (!isGenericValidator(fields[index])) return false;
  }
  return true;
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

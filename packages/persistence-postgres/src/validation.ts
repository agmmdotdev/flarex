import { asNonArrayRecord } from "@flarex/utils/records";
import { isWritableJsonObject } from "flarex-protocol/json";

import { parseFlarexDocumentId, type PersistenceJson } from "./documents";

export type ValidatorJson =
  | { type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { type: "id"; tableName: string }
  | { type: "literal"; value: string | number | boolean }
  | { type: "array"; value: ValidatorJson }
  | {
      type: "object";
      value: Record<string, { fieldType: ValidatorJson; optional: boolean }>;
    }
  | { type: "record"; keys: ValidatorJson; values: ValidatorJson }
  | { type: "union"; value: ValidatorJson[] };

export interface SchemaTableValidatorMetadata {
  tableId: number;
  name: string;
  validator: ValidatorJson | null;
}

export class InvokeSessionDocumentValidationError extends Error {
  constructor(
    readonly tableName: string,
    readonly documentId: string,
    message: string,
    readonly path: string,
  ) {
    super(`Document ${documentId} in table ${tableName} failed validation at ${path}: ${message}`);
    this.name = "InvokeSessionDocumentValidationError";
  }
}

export class DeploymentValidatorMetadataError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${path}: ${message}`);
    this.name = "DeploymentValidatorMetadataError";
  }
}

export function schemaTableValidatorsFromAnalysis(
  analysisJson: unknown,
): SchemaTableValidatorMetadata[] {
  const analysis = asNonArrayRecord(analysisJson);
  if (analysis === null) return [];
  const schema = asNonArrayRecord(analysis.schema);
  if (schema === null || !Array.isArray(schema.tables)) return [];

  return schema.tables.flatMap((rawTable, index) => {
    const table = asNonArrayRecord(rawTable);
    if (table === null) {
      throw new DeploymentValidatorMetadataError(
        "Schema table must be an object.",
        `$.schema.tables[${index}]`,
      );
    }
    if (typeof table.tableId !== "number" || !Number.isInteger(table.tableId)) {
      throw new DeploymentValidatorMetadataError(
        "Schema table tableId must be an integer.",
        `$.schema.tables[${index}].tableId`,
      );
    }
    if (typeof table.name !== "string" || table.name.length === 0) {
      throw new DeploymentValidatorMetadataError(
        "Schema table name must be a non-empty string.",
        `$.schema.tables[${index}].name`,
      );
    }
    if (table.state === "deleted") return [];
    return [
      {
        tableId: table.tableId,
        name: table.name,
        validator: assertValidatorJson(
          table.validator,
          `$.schema.tables[${index}].validator`,
        ),
      },
    ];
  });
}

export function validateDocumentValue(
  tables: SchemaTableValidatorMetadata[],
  tableId: number,
  documentId: string,
  value: PersistenceJson,
): void {
  const table = tables.find((candidate) => candidate.tableId === tableId);
  if (table?.validator === undefined || table.validator === null) return;

  try {
    validateJsonValue(table.validator, value, "$", {
      validateId: (tableName, id, path) => {
        const expectedTable = tables.find((candidate) => candidate.name === tableName);
        if (expectedTable === undefined) return;
        const parsed = parseFlarexDocumentId(id);
        if (parsed.tableId !== expectedTable.tableId) {
          throw new DeploymentValidatorMetadataError(
            `Expected an ID for table ${tableName}.`,
            path,
          );
        }
      },
    });
  } catch (error) {
    if (error instanceof DeploymentValidatorMetadataError) {
      throw new InvokeSessionDocumentValidationError(
        table.name,
        documentId,
        error.message.slice(`${error.path}: `.length),
        error.path,
      );
    }
    throw error;
  }
}

function validateJsonValue(
  validator: ValidatorJson,
  value: PersistenceJson,
  path: string,
  options: { validateId?: (tableName: string, value: string, path: string) => void },
): void {
  switch (validator.type) {
    case "any":
      return;
    case "null":
      return expect(value === null, "Expected null.", path);
    case "number":
      return expect(
        typeof value === "number" && Number.isFinite(value),
        "Expected a finite number.",
        path,
      );
    case "bigint":
      throw new DeploymentValidatorMetadataError(
        "Bigint transport is not implemented.",
        path,
      );
    case "boolean":
      return expect(typeof value === "boolean", "Expected a boolean.", path);
    case "string":
      return expect(typeof value === "string", "Expected a string.", path);
    case "bytes":
      throw new DeploymentValidatorMetadataError(
        "Bytes transport is not implemented.",
        path,
      );
    case "id":
      expect(
        typeof value === "string",
        `Expected an ID for table ${validator.tableName}.`,
        path,
      );
      options.validateId?.(validator.tableName, value, path);
      return;
    case "literal":
      return expect(
        value === validator.value,
        `Expected literal ${String(validator.value)}.`,
        path,
      );
    case "array":
      expect(Array.isArray(value), "Expected an array.", path);
      value.forEach((element, index) =>
        validateJsonValue(validator.value, element, `${path}[${index}]`, options),
      );
      return;
    case "object":
      return validateObject(validator.value, value, path, options);
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
          if (!(error instanceof DeploymentValidatorMetadataError)) throw error;
        }
      }
      throw new DeploymentValidatorMetadataError(
        "Value does not match any union member.",
        path,
      );
  }
}

function assertValidatorJson(value: unknown, path: string): ValidatorJson | null {
  if (value === undefined || value === null) return null;
  const validator = asNonArrayRecord(value);
  if (validator === null || typeof validator.type !== "string") {
    throw new DeploymentValidatorMetadataError(
      "Validator must be an object with a string type.",
      path,
    );
  }

  switch (validator.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type: validator.type };
    case "id":
      if (typeof validator.tableName !== "string" || validator.tableName.length === 0) {
        throw new DeploymentValidatorMetadataError(
          "ID validator tableName must be a non-empty string.",
          `${path}.tableName`,
        );
      }
      return { type: "id", tableName: validator.tableName };
    case "literal":
      if (
        typeof validator.value !== "string" &&
        typeof validator.value !== "number" &&
        typeof validator.value !== "boolean"
      ) {
        throw new DeploymentValidatorMetadataError(
          "Literal validator value must be string, number, or boolean.",
          `${path}.value`,
        );
      }
      return { type: "literal", value: validator.value };
    case "array":
      return {
        type: "array",
        value: requiredValidator(validator.value, `${path}.value`),
      };
    case "object":
      return {
        type: "object",
        value: objectValidatorFields(validator.value, `${path}.value`),
      };
    case "record":
      return {
        type: "record",
        keys: requiredValidator(validator.keys, `${path}.keys`),
        values: requiredValidator(validator.values, `${path}.values`),
      };
    case "union":
      if (!Array.isArray(validator.value)) {
        throw new DeploymentValidatorMetadataError(
          "Union validator value must be an array.",
          `${path}.value`,
        );
      }
      return {
        type: "union",
        value: validator.value.map((member, index) =>
          requiredValidator(member, `${path}.value[${index}]`),
        ),
      };
    default:
      throw new DeploymentValidatorMetadataError(
        `Unknown validator type ${validator.type}.`,
        `${path}.type`,
      );
  }
}

function objectValidatorFields(
  value: unknown,
  path: string,
): Record<string, { fieldType: ValidatorJson; optional: boolean }> {
  const fields = asNonArrayRecord(value);
  if (fields === null) {
    throw new DeploymentValidatorMetadataError(
      "Object validator value must be an object.",
      path,
    );
  }
  return Object.fromEntries(
    Object.entries(fields).map(([name, rawField]) => {
      const field = asNonArrayRecord(rawField);
      if (field === null || typeof field.optional !== "boolean") {
        throw new DeploymentValidatorMetadataError(
          "Object validator field must have an optional boolean.",
          `${path}.${name}`,
        );
      }
      return [
        name,
        {
          fieldType: requiredValidator(field.fieldType, `${path}.${name}.fieldType`),
          optional: field.optional,
        },
      ];
    }),
  );
}

function requiredValidator(value: unknown, path: string): ValidatorJson {
  const validator = assertValidatorJson(value, path);
  if (validator === null) {
    throw new DeploymentValidatorMetadataError("Validator is required.", path);
  }
  return validator;
}

function validateObject(
  fields: Record<string, { fieldType: ValidatorJson; optional: boolean }>,
  value: PersistenceJson,
  path: string,
  options: { validateId?: (tableName: string, value: string, path: string) => void },
): void {
  expect(isWritableJsonObject(value), "Expected an object.", path);
  for (const [name, field] of Object.entries(fields)) {
    if (!(name in value)) {
      if (!field.optional) {
        throw new DeploymentValidatorMetadataError(
          "Required field is missing.",
          `${path}.${name}`,
        );
      }
      continue;
    }
    validateJsonValue(field.fieldType, value[name]!, `${path}.${name}`, options);
  }
  for (const name of Object.keys(value)) {
    if (!(name in fields)) {
      throw new DeploymentValidatorMetadataError(
        "Field is not allowed.",
        `${path}.${name}`,
      );
    }
  }
}

function expect(
  condition: boolean,
  message: string,
  path: string,
): asserts condition {
  if (!condition) throw new DeploymentValidatorMetadataError(message, path);
}

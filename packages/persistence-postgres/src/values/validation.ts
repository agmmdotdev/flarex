import { asNonArrayRecord } from "@flarex/utils/records";
import { isWritableJsonObject } from "flarex-protocol/json";
import { Result, Schema } from "effect";
import { ValidatorJsonWireCodecV1, type ValidatorJson as ProtocolValidatorJson } from "flarex-protocol/validator-json";
import { validatorLiteralEqualV1 } from "flarex-protocol/internal/validator-json-core";
import { isFunctionHandleString } from "flarex-protocol/internal/validator-engine-core";

import { parseFlarexDocumentId, type PersistenceJson } from "../storage/documents/documents";

export type ValidatorJson = ProtocolValidatorJson;

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
    case "commitTs":
      throw new DeploymentValidatorMetadataError(
        "Bigint transport is not implemented.",
        path,
      );
    case "boolean":
      return expect(typeof value === "boolean", "Expected a boolean.", path);
    case "string":
      return expect(typeof value === "string", "Expected a string.", path);
    case "function":
      return expect(typeof value === "string" && isFunctionHandleString(value), "Expected a function handle.", path);
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
      if (typeof validator.value === "bigint") {
        throw new DeploymentValidatorMetadataError("Bigint transport is not implemented.", path);
      }
      return expect(
        validatorLiteralEqualV1(value, validator.value),
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

const decodeValidatorWire = Schema.decodeUnknownResult(ValidatorJsonWireCodecV1);

function assertValidatorJson(value: unknown, path: string): ValidatorJson | null {
  if (value === undefined || value === null) return null;
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - retained JSON-only deployment metadata API throws DeploymentValidatorMetadataError; convert the protocol Result once at this synchronous boundary.
  return Result.getOrThrow(Result.mapError(decodeValidatorWire(value), cause =>
    new DeploymentValidatorMetadataError(`Invalid validator JSON. ${cause.message}`, path)));
}

function validateObject(
  fields: Extract<ValidatorJson, { readonly type: "object" }>["value"],
  value: PersistenceJson,
  path: string,
  options: { validateId?: (tableName: string, value: string, path: string) => void },
): void {
  expect(isWritableJsonObject(value), "Expected an object.", path);
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, name)) {
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
    if (!Object.hasOwn(fields, name)) {
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

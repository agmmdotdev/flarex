import {
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { Result } from "effect";

export const MAX_APP_SCHEMA_PUBLICATION_V1_TABLES =
  MAX_SCHEMA_MANIFEST_APP_TABLES;
export const MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES =
  MAX_SCHEMA_MANIFEST_APP_INDEXES;
export const MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES =
  16 * 1024 * 1024;
export const MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS = 256;

export type AppSchemaPublicationV1QuotaIssue =
  | {
      readonly reason: "tableCountExceeded";
      readonly actualCount: number;
      readonly maximumCount: number;
    }
  | {
      readonly reason: "developerIndexCountExceeded";
      readonly actualCount: number;
      readonly maximumCount: number;
    }
  | {
      readonly reason: "definitionWorkItemCountExceeded";
      readonly tableCount: number;
      readonly developerIndexCount: number;
      readonly actualCount: number;
      readonly maximumCount: number;
    }
  | {
      readonly reason: "canonicalByteLowerBoundExceeded";
      readonly observedLowerBoundBytes: number;
      readonly maximumBytes: number;
    }
  | {
      readonly reason: "canonicalBytesExceeded";
      readonly actualBytes: number;
      readonly maximumBytes: number;
    };

export class AppSchemaPublicationV1QuotaExceededError extends Error {
  readonly _tag = "AppSchemaPublicationV1QuotaExceededError" as const;

  constructor(readonly issue: AppSchemaPublicationV1QuotaIssue) {
    super(quotaIssueMessage(issue));
    this.name = "AppSchemaPublicationV1QuotaExceededError";
  }
}

/** Enforce fixed publication declaration limits before catalog planning. */
export function enforceAppSchemaPublicationV1DeclarationQuotas(
  tables: unknown,
  indexes: unknown,
): void {
  Result.getOrThrow(
    enforceAppSchemaPublicationV1DeclarationQuotasResult(tables, indexes),
  );
}

export function enforceAppSchemaPublicationV1DeclarationQuotasResult(
  tables: unknown,
  indexes: unknown,
): Result.Result<void, AppSchemaPublicationV1QuotaExceededError> {
  if (
    Array.isArray(tables) &&
    tables.length > MAX_APP_SCHEMA_PUBLICATION_V1_TABLES
  ) {
    return Result.fail(new AppSchemaPublicationV1QuotaExceededError({
      reason: "tableCountExceeded",
      actualCount: tables.length,
      maximumCount: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES,
    }));
  }
  if (
    Array.isArray(indexes) &&
    indexes.length > MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES
  ) {
    return Result.fail(new AppSchemaPublicationV1QuotaExceededError({
      reason: "developerIndexCountExceeded",
      actualCount: indexes.length,
      maximumCount: MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES,
    }));
  }
  if (Array.isArray(tables) && Array.isArray(indexes)) {
    const definitionWorkItemCount = tables.length + indexes.length;
    if (
      definitionWorkItemCount >
      MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS
    ) {
      return Result.fail(new AppSchemaPublicationV1QuotaExceededError({
        reason: "definitionWorkItemCountExceeded",
        tableCount: tables.length,
        developerIndexCount: indexes.length,
        actualCount: definitionWorkItemCount,
        maximumCount:
          MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
      }));
    }
  }
  return Result.succeed(undefined);
}

/**
 * Reject decoded declarations whose guaranteed canonical payload already
 * exceeds the exact byte ceiling, before cloning or reading the catalog.
 *
 * This is deliberately a lower bound: the authoritative exact canonical-byte
 * check still runs after every fresh preparation.
 */
export function enforceAppSchemaPublicationV1CanonicalByteLowerBound(
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): void {
  Result.getOrThrow(
    enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult(tables, indexes),
  );
}

export function enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult(
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): Result.Result<void, AppSchemaPublicationV1QuotaExceededError> {
  let lowerBoundBytes = 0;
  let failure: AppSchemaPublicationV1QuotaExceededError | undefined;
  const addGuaranteedBytes = (bytes: number): boolean => {
    if (failure !== undefined) return false;
    lowerBoundBytes += bytes;
    if (
      lowerBoundBytes >
      MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES
    ) {
      failure = new AppSchemaPublicationV1QuotaExceededError({
        reason: "canonicalByteLowerBoundExceeded",
        observedLowerBoundBytes: lowerBoundBytes,
        maximumBytes: MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
      });
      return false;
    }
    return true;
  };
  const addGuaranteedString = (value: string): boolean =>
    addGuaranteedBytes(canonicalJsonStringContentByteLength(value));

  for (const table of tables) {
    if (!addGuaranteedString(table.logicalName)) break;
    if (!addValidatorLowerBound(
      table.definition.documentType,
      addGuaranteedBytes,
      addGuaranteedString,
    )) break;
  }
  if (failure === undefined) {
    for (const index of indexes) {
      if (!addGuaranteedString(index.descriptor)) break;
      for (const field of index.fields) {
        if (!addGuaranteedString(field)) break;
      }
      if (failure !== undefined) break;
    }
  }
  return failure === undefined
    ? Result.succeed(undefined)
    : Result.fail(failure);
}

/** Enforce the exact byte ceiling after fresh preparation, before writes. */
export function enforceAppSchemaPublicationV1CanonicalByteQuota(
  canonicalByteLength: number,
): void {
  Result.getOrThrow(
    enforceAppSchemaPublicationV1CanonicalByteQuotaResult(canonicalByteLength),
  );
}

export function enforceAppSchemaPublicationV1CanonicalByteQuotaResult(
  canonicalByteLength: number,
): Result.Result<void, AppSchemaPublicationV1QuotaExceededError> {
  if (
    canonicalByteLength >
    MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES
  ) {
    return Result.fail(new AppSchemaPublicationV1QuotaExceededError({
      reason: "canonicalBytesExceeded",
      actualBytes: canonicalByteLength,
      maximumBytes: MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
    }));
  }
  return Result.succeed(undefined);
}

function quotaIssueMessage(
  issue: AppSchemaPublicationV1QuotaIssue,
): string {
  switch (issue.reason) {
    case "tableCountExceeded":
      return `App-schema V1 publication contains ${issue.actualCount} app tables; the fixed limit is ${issue.maximumCount}.`;
    case "developerIndexCountExceeded":
      return `App-schema V1 publication contains ${issue.actualCount} developer indexes; the fixed limit is ${issue.maximumCount}.`;
    case "definitionWorkItemCountExceeded":
      return `App-schema V1 publication requires ${issue.actualCount} serial definition work items (${issue.tableCount} tables plus ${issue.developerIndexCount} developer indexes); the fixed operational limit is ${issue.maximumCount}.`;
    case "canonicalByteLowerBoundExceeded":
      return `App-schema V1 declarations already guarantee more than ${issue.maximumBytes} canonical bytes (observed lower bound ${issue.observedLowerBoundBytes}).`;
    case "canonicalBytesExceeded":
      return `App-schema V1 canonical manifest is ${issue.actualBytes} bytes; the fixed limit is ${issue.maximumBytes} bytes.`;
  }
}

function addValidatorLowerBound(
  validator: ValidatorJsonV1,
  addBytes: (bytes: number) => boolean,
  addString: (value: string) => boolean,
): boolean {
  // Every validator contains at least {"type":"<tag>"}.
  if (!addBytes(11) || !addString(validator.type)) return false;

  switch (validator.type) {
    case "id":
      return addString(validator.tableName);
    case "literal":
      return typeof validator.value !== "string" || addString(validator.value);
    case "array":
      return addValidatorLowerBound(validator.value, addBytes, addString);
    case "object":
      for (const [fieldName, field] of Object.entries(validator.value)) {
        if (
          !addString(fieldName) ||
          !addValidatorLowerBound(field.fieldType, addBytes, addString)
        ) return false;
      }
      return true;
    case "record":
      return addValidatorLowerBound(validator.keys, addBytes, addString) &&
        addValidatorLowerBound(validator.values, addBytes, addString);
    case "union":
      for (const member of validator.value) {
        if (!addValidatorLowerBound(member, addBytes, addString)) return false;
      }
      return true;
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return true;
  }
}

/** Count JSON-string content bytes without allocating the escaped string. */
function canonicalJsonStringContentByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      bytes += 2;
    } else if (codeUnit <= 0x1f) {
      bytes +=
        codeUnit === 0x08 ||
          codeUnit === 0x09 ||
          codeUnit === 0x0a ||
          codeUnit === 0x0c ||
          codeUnit === 0x0d
          ? 2
          : 6;
    } else if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

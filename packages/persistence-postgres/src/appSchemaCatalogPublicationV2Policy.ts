import {
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

export const MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES =
  MAX_SCHEMA_MANIFEST_APP_TABLES;
export const MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES =
  MAX_SCHEMA_MANIFEST_APP_INDEXES;
export const MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES =
  16 * 1024 * 1024;
export const MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS = 256;

export type AppSchemaCatalogPublicationV2QuotaIssue =
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

export class AppSchemaCatalogPublicationV2QuotaExceededError extends Error {
  constructor(readonly issue: AppSchemaCatalogPublicationV2QuotaIssue) {
    super(quotaIssueMessage(issue));
    this.name = "AppSchemaCatalogPublicationV2QuotaExceededError";
  }
}

/** Enforce fixed V2 declaration limits before catalog planning starts. */
export function enforceAppSchemaCatalogPublicationV2DeclarationQuotas(
  tables: unknown,
  indexes: unknown,
): void {
  if (
    Array.isArray(tables) &&
    tables.length > MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES
  ) {
    throw new AppSchemaCatalogPublicationV2QuotaExceededError({
      reason: "tableCountExceeded",
      actualCount: tables.length,
      maximumCount: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES,
    });
  }
  if (
    Array.isArray(indexes) &&
    indexes.length > MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES
  ) {
    throw new AppSchemaCatalogPublicationV2QuotaExceededError({
      reason: "developerIndexCountExceeded",
      actualCount: indexes.length,
      maximumCount: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES,
    });
  }
  if (Array.isArray(tables) && Array.isArray(indexes)) {
    const definitionWorkItemCount = tables.length + indexes.length;
    if (
      definitionWorkItemCount >
      MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS
    ) {
      throw new AppSchemaCatalogPublicationV2QuotaExceededError({
        reason: "definitionWorkItemCountExceeded",
        tableCount: tables.length,
        developerIndexCount: indexes.length,
        actualCount: definitionWorkItemCount,
        maximumCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS,
      });
    }
  }
}

/**
 * Reject decoded declarations whose guaranteed canonical payload already
 * exceeds the exact byte ceiling, before cloning or reading the catalog.
 *
 * This is deliberately a lower bound: the authoritative exact canonical-byte
 * check still runs after every fresh preparation.
 */
export function enforceAppSchemaCatalogPublicationV2CanonicalByteLowerBound(
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): void {
  let lowerBoundBytes = 0;
  const addGuaranteedBytes = (bytes: number): void => {
    lowerBoundBytes += bytes;
    if (
      lowerBoundBytes >
      MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES
    ) {
      throw new AppSchemaCatalogPublicationV2QuotaExceededError({
        reason: "canonicalByteLowerBoundExceeded",
        observedLowerBoundBytes: lowerBoundBytes,
        maximumBytes: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
      });
    }
  };
  const addGuaranteedString = (value: string): void => {
    addGuaranteedBytes(canonicalJsonStringContentByteLength(value));
  };

  for (const table of tables) {
    addGuaranteedString(table.logicalName);
    addValidatorLowerBound(
      table.definition.documentType,
      addGuaranteedBytes,
      addGuaranteedString,
    );
  }
  for (const index of indexes) {
    addGuaranteedString(index.descriptor);
    for (const field of index.fields) addGuaranteedString(field);
  }
}

/** Enforce the fixed V2 byte ceiling after fresh preparation, before writes. */
export function enforceAppSchemaCatalogPublicationV2CanonicalByteQuota(
  canonicalByteLength: number,
): void {
  if (
    canonicalByteLength >
    MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES
  ) {
    throw new AppSchemaCatalogPublicationV2QuotaExceededError({
      reason: "canonicalBytesExceeded",
      actualBytes: canonicalByteLength,
      maximumBytes: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
    });
  }
}

function quotaIssueMessage(
  issue: AppSchemaCatalogPublicationV2QuotaIssue,
): string {
  switch (issue.reason) {
    case "tableCountExceeded":
      return `App-schema catalog V2 publication contains ${issue.actualCount} app tables; the fixed limit is ${issue.maximumCount}.`;
    case "developerIndexCountExceeded":
      return `App-schema catalog V2 publication contains ${issue.actualCount} developer indexes; the fixed limit is ${issue.maximumCount}.`;
    case "definitionWorkItemCountExceeded":
      return `App-schema catalog V2 publication requires ${issue.actualCount} serial definition work items (${issue.tableCount} tables plus ${issue.developerIndexCount} developer indexes); the fixed operational limit is ${issue.maximumCount}.`;
    case "canonicalByteLowerBoundExceeded":
      return `App-schema catalog V2 declarations already guarantee more than ${issue.maximumBytes} canonical bytes (observed lower bound ${issue.observedLowerBoundBytes}).`;
    case "canonicalBytesExceeded":
      return `App-schema catalog V2 canonical manifest is ${issue.actualBytes} bytes; the fixed limit is ${issue.maximumBytes} bytes.`;
  }
}

function addValidatorLowerBound(
  validator: ValidatorJsonV1,
  addBytes: (bytes: number) => void,
  addString: (value: string) => void,
): void {
  // Every validator contains at least {"type":"<tag>"}.
  addBytes(11);
  addString(validator.type);

  switch (validator.type) {
    case "id":
      addString(validator.tableName);
      return;
    case "literal":
      if (typeof validator.value === "string") addString(validator.value);
      return;
    case "array":
      addValidatorLowerBound(validator.value, addBytes, addString);
      return;
    case "object":
      for (const [fieldName, field] of Object.entries(validator.value)) {
        addString(fieldName);
        addValidatorLowerBound(field.fieldType, addBytes, addString);
      }
      return;
    case "record":
      addValidatorLowerBound(validator.keys, addBytes, addString);
      addValidatorLowerBound(validator.values, addBytes, addString);
      return;
    case "union":
      for (const member of validator.value) {
        addValidatorLowerBound(member, addBytes, addString);
      }
      return;
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return;
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

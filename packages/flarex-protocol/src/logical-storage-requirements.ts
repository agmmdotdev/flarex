import { Data, Result, Schema } from "effect";
import { CatalogDefinitionNameSchema, type CatalogDefinitionName } from "./catalog";
import type { LogicalSchemaSource } from "./logical-schema-candidate";
import { SchemaManifestAppDeveloperOrderedIndexSpecV1Schema } from "./schema-manifest";
import { decodeAppOrderedIndexPhysicalSpecV1Result, lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  type AppOrderedIndexPhysicalSpecV1 } from "./ordered-index";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1Result, lowerLogicalDocumentUniqueConstraint,
  type AppUniqueConstraintPhysicalSpecV1 } from "./app-unique-constraint-definition";

export class LogicalStorageRequirementError extends Data.TaggedError("LogicalStorageRequirementError")<{
  readonly reason: "unsupportedDefinition";
  readonly sourceKey: string;
  readonly cause?: unknown;
}> {}
export interface LogicalSourceIndexRequirement {
  readonly localName: string;
  readonly descriptor: CatalogDefinitionName;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
}
export interface LogicalSourceUniqueRequirement {
  readonly localName: string;
  readonly descriptor: CatalogDefinitionName;
  readonly physicalSpec: AppUniqueConstraintPhysicalSpecV1;
}
const decodeName = Schema.decodeUnknownResult(CatalogDefinitionNameSchema);
const decodeIndex = Schema.decodeUnknownResult(SchemaManifestAppDeveloperOrderedIndexSpecV1Schema, { onExcessProperty: "error" });
const failure = (source: LogicalSchemaSource, cause?: unknown) => new LogicalStorageRequirementError({
  reason: "unsupportedDefinition", sourceKey: source.key, ...(cause === undefined ? {} : { cause }),
});

/** Pure semantic lowering from a verified source. No allocation, lifecycle or
 * serving capability. The caller must compile the complete configured source set. */
export function compileLogicalSourceIndexes(source: LogicalSchemaSource) {
  return Result.gen(function* () {
    const requirements: LogicalSourceIndexRequirement[] = [];
    if (source.definition.kind === "documents") {
      for (const declaration of source.definition.indexes) {
        const logical = yield* decodeIndex({ kind: "developerOrdered", specVersion: 1,
          fields: declaration.fields, ...(declaration.decimalFields === undefined ? {} : { decimalFields: declaration.decimalFields }),
        }).pipe(Result.mapError(cause => failure(source, cause)));
        requirements.push({ localName: declaration.tableLogicalName, descriptor: declaration.descriptor,
          physicalSpec: lowerAppDeveloperOrderedIndexPhysicalSpecV1(logical) });
      }
      return Object.freeze(requirements);
    }
    for (const table of source.definition.schema.tables) {
      const declarations = [
        ...table.keys.map(key => ({ name: `key/${key.identity.keyId}`, columns: key.columns, predicate: null })),
        ...table.indexes.map(index => ({ name: `index/${index.identity.indexId}`, columns: index.columns, predicate: index.predicate })),
      ];
      for (const declaration of declarations) {
        const predicate = declaration.predicate;
        // Relational integers are bounded to int32, stored with canonical zero,
        // and use exact float64 ordered components. Timestamps are canonical UTC millisecond
        // instants, whose fixed-width ISO text has the same chronological order.
        // Null-only membership has no representation ambiguity.
        if (declaration.columns.some(column => {
          const type = table.columns.find(field => field.identity.columnId === column.columnId)?.type;
          const nullOnly = predicate?.kind === "isNull" && predicate.column.columnId === column.columnId;
          return column.columnId.includes(".") || (!nullOnly && type !== "text" && type !== "boolean" &&
            type !== "integer" && type !== "timestamptz" && type !== "numeric");
        }) || (predicate !== null && (predicate.kind !== "isNull" || predicate.column.columnId.includes(".")))) {
          return yield* Result.fail(failure(source));
        }
        const decimalFields = declaration.columns.filter(column =>
          table.columns.find(field => field.identity.columnId === column.columnId)?.type === "numeric").map(column => column.columnId);
        const logical = yield* decodeIndex({ kind: "developerOrdered", specVersion: 1,
          fields: declaration.columns.map(column => column.columnId), ...(decimalFields.length === 0 ? {} : { decimalFields }),
        }).pipe(Result.mapError(cause => failure(source, cause)));
        const physicalSpec = yield* decodeAppOrderedIndexPhysicalSpecV1Result({
          ...lowerAppDeveloperOrderedIndexPhysicalSpecV1(logical),
          ...(predicate === null ? {} : { predicate: { kind: "fieldIsNull", field: predicate.column.columnId } }),
        }).pipe(Result.mapError(cause => failure(source, cause)));
        const descriptor = yield* decodeName(declaration.name).pipe(Result.mapError(cause => failure(source, cause)));
        requirements.push({ localName: table.identity.tableId, descriptor, physicalSpec });
      }
    }
    return Object.freeze(requirements);
  });
}

export function compileLogicalSourceUniqueConstraints(source: LogicalSchemaSource) {
  return Result.gen(function* () {
    const requirements: LogicalSourceUniqueRequirement[] = [];
    if (source.definition.kind === "documents") {
      return Object.freeze(source.definition.uniqueConstraints.map(declaration => ({
        localName: declaration.tableLogicalName, descriptor: declaration.descriptor,
        physicalSpec: lowerLogicalDocumentUniqueConstraint(declaration),
      })));
    }
    for (const table of source.definition.schema.tables) {
      const declarations = [
        ...table.keys.map(key => ({ name: `key/${key.identity.keyId}`, columns: key.columns,
          nullsDistinct: key.kind !== "primary", predicate: null })),
        ...table.indexes.filter(index => index.kind === "uniqueBtree").map(index => ({ name: `index/${index.identity.indexId}`,
          columns: index.columns, nullsDistinct: true, predicate: index.predicate })),
      ];
      for (const declaration of declarations) {
        const predicate = declaration.predicate;
        // Native decimal equality still needs a canonical value contract.
        // Bounded int32 values are stored with canonical zero; canonical UTC
        // instants have unambiguous equality in the shared key codec.
        if (declaration.columns.some(column => {
          const type = table.columns.find(field => field.identity.columnId === column.columnId)?.type;
          return column.columnId.includes(".") || (type !== "text" && type !== "boolean" &&
            type !== "integer" && type !== "timestamptz");
        }) || (predicate !== null && (predicate.kind !== "isNull" || predicate.column.columnId.includes(".")))) {
          return yield* Result.fail(failure(source));
        }
        const descriptor = yield* decodeName(declaration.name).pipe(Result.mapError(cause => failure(source, cause)));
        const physicalSpec = yield* decodeAppUniqueConstraintPhysicalSpecV1Result({ kind: "appUniqueConstraint", specVersion: 1,
          orderedFields: declaration.columns.map(column => column.columnId), sparse: false,
          ...(declaration.nullsDistinct ? { nullsDistinct: true } : {}),
          ...(predicate === null ? {} : { predicate: { kind: "fieldIsNull", field: predicate.column.columnId } }),
          localePolicy: { kind: "none" }, keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }).pipe(Result.mapError(cause => failure(source, cause)));
        requirements.push({ localName: table.identity.tableId, descriptor, physicalSpec });
      }
    }
    return Object.freeze(requirements);
  });
}

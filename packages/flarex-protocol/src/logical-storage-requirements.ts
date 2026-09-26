import { Data, Result, Schema } from "effect";
import { CatalogDefinitionNameSchema, type CatalogDefinitionName } from "./catalog";
import type { LogicalSchemaSource } from "./logical-schema-candidate";
import { SchemaManifestAppDeveloperOrderedIndexSpecV1Schema } from "./schema-manifest";
import { decodeAppOrderedIndexPhysicalSpecV1Result, lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  type AppOrderedIndexPhysicalSpecV1 } from "./ordered-index";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1Result, lowerLogicalDocumentUniqueConstraint,
  type AppUniqueConstraintPhysicalSpecV1 } from "./app-unique-constraint-definition";
import { relationalForeignKeyReverseColumns } from "./relational-schema/access";

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
export interface LogicalSourceSearchRequirement {
  readonly localName: string;
  readonly descriptor: CatalogDefinitionName;
  readonly columns: readonly string[];
  readonly kind: "text" | "jsonContainment";
  readonly nullPredicateField: string | null;
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
        ...table.keys.map(key => ({ name: `key/${key.identity.keyId}`, columns: key.columns, predicate: null,
          kind: "btree" as const })),
        ...table.indexes.filter(index => index.kind !== "jsonContainment").map(index => ({
          name: `index/${index.identity.indexId}`, columns: index.columns, predicate: index.predicate,
          kind: index.kind })),
        ...relationalForeignKeyReverseColumns(table).map(column => ({ name: `fk-reverse/${column.columnId}`,
          columns: [column], predicate: null, kind: "btree" as const })),
      ];
      for (const declaration of declarations) {
        const predicate = declaration.predicate;
        // Relational integers are bounded to int32, stored with canonical zero,
        // and use exact float64 ordered components. Timestamps are canonical UTC millisecond
        // instants, whose fixed-width ISO text has the same chronological order.
        // Predicate membership uses the same canonical null and text values
        // that relational validation admits for these columns.
        if (declaration.columns.some(column => {
          const type = table.columns.find(field => field.identity.columnId === column.columnId)?.type;
          const nullOnly = predicate?.kind === "isNull" && predicate.column.columnId === column.columnId;
          return column.columnId.includes(".") || (!nullOnly && type !== "text" && type !== "boolean" &&
            type !== "integer" && type !== "timestamptz" && type !== "numeric");
        }) || (predicate !== null && (predicate.kind === "isNull"
          ? predicate.column.columnId.includes(".")
          : predicate.kind === "isNullAndTextEquals"
            ? predicate.nullColumn.columnId.includes(".") || predicate.textColumn.columnId.includes(".") ||
              table.columns.find(column => column.identity.columnId === predicate.nullColumn.columnId)?.nullable !== true ||
              table.columns.find(column => column.identity.columnId === predicate.textColumn.columnId)?.type !== "text"
            : true))) {
          return yield* Result.fail(failure(source));
        }
        const decimalFields = declaration.columns.filter(column =>
          table.columns.find(field => field.identity.columnId === column.columnId)?.type === "numeric").map(column => column.columnId);
        const logical = yield* decodeIndex({ kind: "developerOrdered", specVersion: 1,
          fields: declaration.columns.map(column => column.columnId), ...(decimalFields.length === 0 ? {} : { decimalFields }),
        }).pipe(Result.mapError(cause => failure(source, cause)));
        const lowered = lowerAppDeveloperOrderedIndexPhysicalSpecV1(logical);
        const physicalSpec = yield* decodeAppOrderedIndexPhysicalSpecV1Result({
          ...lowered,
          ...(declaration.kind === "textEquality" ? { orderedFields: lowered.orderedFields.map(field =>
            field.kind === "documentPath" ? { ...field, valueFormat: "sha256TextV1" as const } : field) } : {}),
          ...(predicate === null ? {} : predicate.kind === "isNull"
            ? { predicate: { kind: "fieldIsNull" as const, field: predicate.column.columnId } }
            : { predicate: { kind: "fieldIsNullAndTextEquals" as const,
              nullField: predicate.nullColumn.columnId, textField: predicate.textColumn.columnId, value: predicate.value } }),
        }).pipe(Result.mapError(cause => failure(source, cause)));
        const descriptor = yield* decodeName(declaration.name).pipe(Result.mapError(cause => failure(source, cause)));
        requirements.push({ localName: table.identity.tableId, descriptor, physicalSpec });
      }
    }
    return Object.freeze(requirements);
  });
}

/** A searchableText capability is already part of the verified relational
 * source. Keep its field order and stable capability identity when deriving
 * a physical search requirement; the search index is not an ordered index. */
export function compileLogicalSourceSearches(source: LogicalSchemaSource) {
  return Result.gen(function* () {
    const requirements: LogicalSourceSearchRequirement[] = [];
    if (source.definition.kind === "documents") return Object.freeze(requirements);
    for (const table of source.definition.schema.tables) for (const index of table.indexes) {
      if (index.kind !== "jsonContainment") continue;
      const column = index.columns[0];
      if (column === undefined || index.columns.length !== 1 ||
        table.columns.find(member => member.identity.columnId === column.columnId)?.type !== "jsonb" ||
        (index.predicate !== null && (index.predicate.kind !== "isNull" ||
          index.predicate.column.columnId !== "deleted_at"))) return yield* Result.fail(failure(source));
      const descriptor = yield* decodeName(`index/${index.identity.indexId}`)
        .pipe(Result.mapError(cause => failure(source, cause)));
      requirements.push({ localName: table.identity.tableId, descriptor,
        kind: "jsonContainment", columns: Object.freeze([column.columnId]),
        nullPredicateField: index.predicate?.kind === "isNull" ? index.predicate.column.columnId : null });
    }
    for (const capability of source.definition.schema.capabilities) {
      if (capability.kind !== "searchableText") continue;
      const first = capability.columns[0];
      if (first === undefined || capability.columns.some(column => column.tableId !== first.tableId) ||
        new Set(capability.columns.map(column => column.columnId)).size !== capability.columns.length)
        return yield* Result.fail(failure(source));
      const table = source.definition.schema.tables.find(candidate => candidate.identity.tableId === first.tableId);
      if (table === undefined || capability.columns.some(reference =>
        table.columns.find(column => column.identity.columnId === reference.columnId)?.type !== "text"))
        return yield* Result.fail(failure(source));
      const descriptor = yield* decodeName(`search/${capability.identity.capabilityId}`)
        .pipe(Result.mapError(cause => failure(source, cause)));
      requirements.push({ localName: first.tableId, descriptor, kind: "text",
        columns: Object.freeze(capability.columns.map(column => column.columnId)), nullPredicateField: null });
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

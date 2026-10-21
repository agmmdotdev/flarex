import { Data, Result, Schema } from "effect";
import { CatalogDefinitionNameSchema, type CatalogDefinitionName } from "./catalog";
import { logicalTableKey, type LogicalSchemaCandidate, type LogicalSchemaSource, type LogicalSchemaExtension,
  type QualifiedLogicalTable } from "./logical-schema-candidate";
import { SchemaManifestAppDeveloperOrderedIndexSpecV1Schema } from "./schema-manifest";
import { decodeAppOrderedIndexPhysicalSpecV1Result, lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  type AppOrderedIndexPhysicalSpecV1 } from "./ordered-index";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1Result, lowerLogicalDocumentUniqueConstraint,
  type AppUniqueConstraintPhysicalSpecV1 } from "./app-unique-constraint-definition";
import { relationalReverseIndexes } from "./relational-schema/access";

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
export interface LogicalExtensionIndexRequirement extends LogicalSourceIndexRequirement {
  readonly sourceKey: string;
  readonly table: QualifiedLogicalTable;
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
        ...relationalReverseIndexes(table).map(index => ({ name: index.descriptor,
          columns: [index.column], predicate: null, kind: "btree" as const })),
      ];
      for (const declaration of declarations) {
        const predicate = declaration.predicate;
        // Relational integers remain int32. Finite binary64 scalars and integers
        // use float64 ordered components after canonical zero normalization.
        // Timestamps are canonical UTC millisecond instants, whose fixed-width
        // ISO text has the same chronological order.
        // Predicate membership uses the same canonical null and text values
        // that relational validation admits for these columns.
        if (declaration.columns.some(column => {
          const type = table.columns.find(field => field.identity.columnId === column.columnId)?.type;
          const nullOnly = predicate?.kind === "isNull" && predicate.column.columnId === column.columnId;
          return column.columnId.includes(".") || (!nullOnly && type !== "text" && type !== "boolean" &&
            type !== "integer" && type !== "doublePrecision" && type !== "timestamptz" && type !== "numeric");
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

/** Native declarations remain authoritative; this is their derived publication
 * policy, not a second schema declaration or a cross-source extension. */
export function compileLogicalDocumentReferences(source: LogicalSchemaSource) {
  return Result.gen(function* () {
    const references: LogicalSchemaExtension[] = [];
    if (source.owner !== "payload" || source.writeProfile !== "payload.content-relations" ||
      source.definition.kind !== "documents" || source.definition.relations.length !== 1) return references;
    const relation = source.definition.relations[0];
    if (relation === undefined || relation.value.cardinality !== "one" || relation.value.required ||
      relation.localized || relation.onTargetDelete !== "restrict" || relation.inverse.name !== null ||
      relation.source.path.length !== 1 || relation.source.path[0]?.kind !== "field")
      return yield* Result.fail(failure(source));
    const from = source.bindings.find(binding => binding.kind === "definition" && binding.localName === relation.source.table);
    const to = source.bindings.find(binding => binding.kind === "definition" && binding.localName === relation.target.table);
    if (from === undefined || to === undefined) return yield* Result.fail(failure(source));
    references.push({ name: `document-relation/${source.key}/${relation.source.table}/${relation.source.forwardName}`,
      sourceKey: source.key, source: { table: from.table, field: relation.source.path[0].name },
      target: { table: to.table, field: "_id" }, policy: "strongReference",
      liveness: { source: { kind: "current" }, target: { kind: "current" } }, onTargetDelete: "restrict" });
    return Object.freeze(references);
  });
}

export function compileLogicalStrongReferences(candidate: LogicalSchemaCandidate) {
  return Result.gen(function* () {
    const references = [...candidate.extensions];
    for (const source of candidate.sources) references.push(...yield* compileLogicalDocumentReferences(source));
    if (references.length > 1024 || new Set(references.map(reference => reference.name)).size !== references.length)
      return yield* Result.fail(new LogicalStorageRequirementError({ reason: "unsupportedDefinition", sourceKey: "references" }));
    return Object.freeze(references);
  });
}

/** Strong references need complete reverse membership at target deletion.
 * Reuse an unconditional leading-field index when the producer already has
 * one; otherwise derive one stable index per source table and field. */
export function compileLogicalReferenceIndexes(candidate: LogicalSchemaCandidate) {
  return Result.gen(function* () {
    const derived: LogicalExtensionIndexRequirement[] = [];
    const sourceIndexes = new Map<string, readonly LogicalSourceIndexRequirement[]>();
    for (const extension of yield* compileLogicalStrongReferences(candidate)) {
      const source = candidate.sources.find(member => member.key === extension.sourceKey);
      if (source === undefined) return yield* Result.fail(new LogicalStorageRequirementError({
        reason: "unsupportedDefinition", sourceKey: extension.sourceKey,
      }));
      const binding = source.bindings.find(member => member.kind === "definition" &&
        logicalTableKey(member.table) === logicalTableKey(extension.source.table));
      if (binding === undefined) return yield* Result.fail(failure(source));
      let indexes = sourceIndexes.get(source.key);
      if (indexes === undefined) {
        indexes = yield* compileLogicalSourceIndexes(source);
        sourceIndexes.set(source.key, indexes);
      }
      const covers = (index: LogicalSourceIndexRequirement) => index.localName === binding.localName &&
        index.physicalSpec.predicate === undefined &&
        index.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
        index.physicalSpec.orderedFields[0].path === extension.source.field &&
        index.physicalSpec.orderedFields[0].valueFormat !== "exactDecimal";
      if (indexes.some(covers) || derived.some(index =>
        logicalTableKey(index.table) === logicalTableKey(extension.source.table) && covers(index))) continue;
      const descriptor = yield* decodeName(`strong-reference/${extension.source.field}`)
        .pipe(Result.mapError(cause => failure(source, cause)));
      if (indexes.some(index => index.localName === binding.localName && index.descriptor === descriptor))
        return yield* Result.fail(failure(source));
      const logical = yield* decodeIndex({ kind: "developerOrdered", specVersion: 1,
        fields: [extension.source.field] }).pipe(Result.mapError(cause => failure(source, cause)));
      derived.push(Object.freeze({ sourceKey: source.key, table: extension.source.table,
        localName: binding.localName, descriptor,
        physicalSpec: lowerAppDeveloperOrderedIndexPhysicalSpecV1(logical) }));
    }
    return Object.freeze(derived);
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
        // Int32 and finite binary64 values use canonical zero; canonical UTC
        // instants have unambiguous equality in the shared key codec.
        if (declaration.columns.some(column => {
          const type = table.columns.find(field => field.identity.columnId === column.columnId)?.type;
          return column.columnId.includes(".") || (type !== "text" && type !== "boolean" &&
            type !== "integer" && type !== "doublePrecision" && type !== "timestamptz");
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

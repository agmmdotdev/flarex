import { Effect } from "effect";
import type { LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { relationalReverseIndexes, type RelationalSchema, type RelationalTableDefinition, type RelationalIndexPredicate } from "flarex-protocol/internal/relational-schema";
import { type ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { relationalTextIdentity } from "../values/relationalRows";
import { CoreSchemaError, type CoreSchemaInputSchema } from "./schemaTypes";
import { coreNativeIndexName, coreNativeTableName } from "./schemaTableName";
import type { CoreNativeRelationalIndex, CoreNativeTableDeclaration } from "./nativePolicy";
import { coreNativeEligibilityTerms, type CoreNativeEligibility, type CoreNativeForeignKey,
  type CoreNativeUniqueConstraintSchema } from "./nativePolicyTypes";

const unsupported = (message: string) => new CoreSchemaError({ reason: "unsupportedCapability", message });
const sameFields = (left: readonly string[], right: readonly string[]) => left.length === right.length
  && left.every((field, position) => field === right[position]);
const ordered = (table: RelationalTableDefinition, fields: readonly string[]) => fields.length > 0 && fields.every(field => {
  const column = table.columns.find(candidate => candidate.identity.columnId === field);
  return column !== undefined && column.type !== "numeric" && column.type !== "jsonb";
});
function lowerEligibility(predicate: RelationalIndexPredicate): CoreNativeEligibility | undefined | false {
  if (predicate === null) return undefined;
  if (predicate.kind === "isNull") return Object.freeze({ field: predicate.column.columnId, value: null });
  if (predicate.kind === "allNull") return Object.freeze({ all: Object.freeze(predicate.columns.map(column =>
    Object.freeze({ field: column.columnId, value: null }))) });
  if (predicate.kind === "isNullAndBooleanEquals") return Object.freeze({ all: Object.freeze([
    Object.freeze({ field: predicate.nullColumn.columnId, value: null }),
    Object.freeze({ field: predicate.booleanColumn.columnId, value: predicate.value }),
  ]) });
  if (predicate.kind === "isNullAndTextEquals") return Object.freeze({ all: Object.freeze([
    Object.freeze({ field: predicate.nullColumn.columnId, value: null }),
    Object.freeze({ field: predicate.textColumn.columnId, value: predicate.value }),
  ]) });
  return false;
}

/** Lower native business records to ordinary documents and indexes. Neither
 * endpoint FK semantics nor tuple identity creates a hidden membership table. */
export const lowerCoreNativeRelationalSchema = Effect.fn("CoreNativeDefinition.lowerRelationalSchema")(function* (
  relational: RelationalSchema, bindings: LogicalSchemaSource["bindings"],
) {
  const records: { table: RelationalTableDefinition; declaration: CoreNativeTableDeclaration;
    indexes: CoreNativeRelationalIndex[] }[] = [];
  const graph = relational.tables.some(table => table.constraints.some(constraint => constraint.kind === "foreignKey")
    || table.keys.some(key => key.columns.length > 1) || table.indexes.some(index => index.kind === "uniqueBtree"));
  for (const table of relational.tables) {
    const binding = bindings.find(candidate => candidate.localName === table.identity.tableId);
    if (binding === undefined) return yield* unsupported("Relational table has no authenticated binding");
    if (table.columns.some(column => column.default.kind === "serialNext"))
      return yield* unsupported("Relational serial allocation is not admitted");
    const name = yield* coreNativeTableName(binding.table);
    const indexes: CoreNativeRelationalIndex[] = [];
    const uniqueConstraints: (typeof CoreNativeUniqueConstraintSchema.Type)[] = [];
    for (const key of table.keys) {
      const fields = key.columns.map(column => column.columnId);
      if (!ordered(table, fields)) return yield* unsupported("Relational key requires admitted ordered scalar columns");
      const indexName = indexes.find(candidate => sameFields(candidate.fields, fields))?.indexName
        ?? (yield* coreNativeIndexName(binding.table, "key", key.identity.keyId));
      indexes.push(Object.freeze({ nativeId: key.identity.keyId, kind: "key", indexName, fields: Object.freeze(fields) }));
      uniqueConstraints.push(Object.freeze({ descriptor: key.identity.keyId, fields: Object.freeze(fields),
        indexName, nullsDistinct: key.kind !== "primary" }));
    }
    for (const index of table.indexes) {
      // Declared equality follows existing paths below to preserve their identities.
      // JSON declarations remain metadata rather than ordered Core access paths.
      if (index.kind === "textEquality" || index.kind === "jsonContainment") continue;
      if (index.predicate?.kind === "isNotNull" || index.predicate?.kind === "isNullAndNotNull") continue;
      const eligibility = lowerEligibility(index.predicate);
      if (eligibility === false)
        return yield* unsupported("Relational index requires an ordinary or admitted equality-predicate B-tree lowering");
      const prefix = eligibility === undefined ? [] : coreNativeEligibilityTerms(eligibility).map(term => term.field);
      const keyFields = index.columns.map(column => column.columnId);
      const fields = [...prefix, ...keyFields.filter(field => !prefix.includes(field))];
      if (!ordered(table, fields)) return yield* unsupported("Relational index requires admitted ordered scalar columns");
      const indexName = indexes.find(candidate => sameFields(candidate.fields, fields))?.indexName
        ?? (yield* coreNativeIndexName(binding.table, "index", index.identity.indexId));
      indexes.push(Object.freeze({ nativeId: index.identity.indexId, kind: "index", indexName, fields: Object.freeze(fields),
        ...(eligibility === undefined ? {} : { requiredPrefix: eligibility }) }));
      if (index.kind === "uniqueBtree") uniqueConstraints.push(Object.freeze({ descriptor: index.identity.indexId,
        fields: Object.freeze(keyFields), indexName, nullsDistinct: true,
        ...(eligibility === undefined ? {} : { eligibility }) }));
    }
    const identityFields = graph ? yield* Effect.fromResult(relationalTextIdentity(table,
      () => unsupported("Relational row identity requires a non-null native text key"))) : undefined;
    const identityIndex = identityFields === undefined ? undefined : indexes.find(index => index.kind === "key"
      && sameFields(index.fields, identityFields));
    if (identityFields !== undefined && identityIndex === undefined)
      return yield* unsupported("Relational row identity has no ordinary key index");
    const declaration: CoreNativeTableDeclaration = { name, localName: binding.localName, table: binding.table,
      uniqueConstraints: Object.freeze(uniqueConstraints), indexes,
      ...(identityFields === undefined || identityIndex === undefined ? {} : {
        rowKey: Object.freeze({ fields: identityFields, indexName: identityIndex.indexName }),
      }) };
    records.push({ table, declaration, indexes });
  }
  const foreignKeys: CoreNativeForeignKey[] = [];
  for (const record of records) for (const constraint of record.table.constraints) {
    if (constraint.kind !== "foreignKey") continue;
    const firstTargetColumn = constraint.targetColumns[0];
    const target = records.find(candidate => candidate.table.identity.tableId === firstTargetColumn?.tableId);
    const sourceFields = constraint.sourceColumns.map(column => column.columnId);
    const targetFields = constraint.targetColumns.map(column => column.columnId);
    if (target === undefined || sourceFields.length !== targetFields.length || !ordered(record.table, sourceFields)
      || !ordered(target.table, targetFields) || !target.table.keys.some(key => sameFields(key.columns.map(column => column.columnId), targetFields)))
      return yield* unsupported("Relational foreign key requires an authenticated unique target tuple");
    for (const [position, sourceColumn] of constraint.sourceColumns.entries()) {
      const targetColumn = constraint.targetColumns[position];
      if (sourceColumn.tableId !== record.table.identity.tableId || targetColumn?.tableId !== target.table.identity.tableId
        || record.table.columns.find(column => column.identity.columnId === sourceColumn.columnId)?.type
          !== target.table.columns.find(column => column.identity.columnId === targetColumn?.columnId)?.type)
        return yield* unsupported("Relational foreign key column types or endpoints differ");
    }
    const targetIndex = target.indexes.find(index => index.kind === "key" && sameFields(index.fields, targetFields));
    if (targetIndex === undefined) return yield* unsupported("Relational foreign key target has no unique access path");
    let sourceIndex = record.indexes.find(index => index.requiredPrefix === undefined
      && sourceFields.every((field, position) => index.fields[position] === field));
    if (sourceIndex === undefined) {
      const nativeId = `foreign-key/${constraint.identity.constraintId}`;
      const table = record.declaration.table;
      if (table === undefined || record.indexes.some(index => index.kind === "index" && index.nativeId === nativeId))
        return yield* unsupported("Relational foreign key access path collides with a native declaration");
      sourceIndex = Object.freeze({ nativeId, kind: "index", indexName: yield* coreNativeIndexName(table, "index", nativeId),
        fields: Object.freeze(sourceFields) });
      record.indexes.push(sourceIndex);
    }
    foreignKeys.push(Object.freeze({ descriptor: constraint.identity.constraintId,
      sourceTable: record.declaration.name, targetTable: target.declaration.name,
      sourceFields: Object.freeze(sourceFields), targetFields: Object.freeze(targetFields),
      sourceIndexName: sourceIndex.indexName, targetIndexName: targetIndex.indexName,
      onDelete: constraint.onDelete, onUpdate: constraint.onUpdate }));
  }
  // Keep existing FK path identities before deriving membership-only access
  // for native composite-key suffixes omitted from declared indexes.
  for (const record of records) for (const reverse of relationalReverseIndexes(record.table)) {
    const field = reverse.column.columnId;
    if (record.indexes.some(index => index.requiredPrefix === undefined && index.fields[0] === field)) continue;
    const table = record.declaration.table;
    if (table === undefined || record.indexes.some(index => index.kind === "index" && index.nativeId === reverse.descriptor))
      return yield* unsupported("Relational reverse access path collides with a native declaration");
    record.indexes.push(Object.freeze({ nativeId: reverse.descriptor, kind: "index",
      indexName: yield* coreNativeIndexName(table, "index", reverse.descriptor), fields: Object.freeze([field]) }));
  }
  // Preserve existing key, B-tree, FK and reverse descriptors before adding
  // authenticated unconditional text equality, with exact-field aliases only.
  for (const record of records) for (const index of record.table.indexes) {
    if (index.kind !== "textEquality") continue;
    const fields = Object.freeze(index.columns.map(column => column.columnId));
    const existing = record.indexes.find(candidate => candidate.kind === "index" && candidate.nativeId === index.identity.indexId);
    const table = record.declaration.table;
    if (table === undefined || existing !== undefined && !sameFields(existing.fields, fields))
      return yield* unsupported("Relational equality access path collides with a native declaration");
    if (existing !== undefined) continue;
    const indexName = record.indexes.find(candidate => sameFields(candidate.fields, fields))?.indexName
      ?? (yield* coreNativeIndexName(table, "index", index.identity.indexId));
    record.indexes.push(Object.freeze({ nativeId: index.identity.indexId, kind: "index", indexName, fields }));
  }
  // Existing bindings own equal-field backings and their access policy. New
  // non-null aliases come last so FK, reverse and equality access stay stable.
  for (const record of records) for (const index of record.table.indexes) {
    const predicate = index.predicate;
    if (predicate?.kind !== "isNotNull" && predicate?.kind !== "isNullAndNotNull") continue;
    const requiredNonNull = (predicate.kind === "isNotNull" ? predicate.column : predicate.notNullColumn).columnId;
    if (index.kind !== "btree" || index.columns.length !== 1 || index.columns[0]?.columnId !== requiredNonNull)
      return yield* unsupported("Relational non-null predicate requires a nonunique B-tree on its single tested key");
    const requiredPrefix = predicate.kind === "isNullAndNotNull"
      ? Object.freeze({ field: predicate.nullColumn.columnId, value: null }) : undefined;
    const fields = Object.freeze(requiredPrefix === undefined ? [requiredNonNull] : [requiredPrefix.field, requiredNonNull]);
    if (!ordered(record.table, fields)) return yield* unsupported("Relational index requires admitted ordered scalar columns");
    const table = record.declaration.table;
    if (table === undefined) return yield* unsupported("Relational table has no authenticated binding");
    if (record.indexes.some(candidate => candidate.kind === "index" && candidate.nativeId === index.identity.indexId))
      return yield* unsupported("Relational non-null access path collides with an existing binding");
    const indexName = record.indexes.find(candidate => sameFields(candidate.fields, fields))?.indexName
      ?? (yield* coreNativeIndexName(table, "index", index.identity.indexId));
    record.indexes.push(Object.freeze({ nativeId: index.identity.indexId, kind: "index", indexName, fields, requiredNonNull,
      ...(requiredPrefix === undefined ? {} : { requiredPrefix }) }));
  }
  const declarations = records.map(({ declaration, indexes }) => {
    const incident = foreignKeys.filter(foreignKey => foreignKey.sourceTable === declaration.name || foreignKey.targetTable === declaration.name);
    return Object.freeze({ ...declaration, indexes: Object.freeze(indexes),
      ...(incident.length === 0 ? {} : { foreignKeys: Object.freeze(incident) }) });
  });
  const schemaTables: (typeof CoreSchemaInputSchema.Type)["tables"][number][] = records.map(({ table, declaration, indexes }) => {
    const value: Record<string, { fieldType: ValidatorJsonV1; optional: false }> = {};
    for (const column of table.columns) {
      const fieldType: ValidatorJsonV1 = column.type === "text" || column.type === "timestamptz" ? { type: "string" }
        : column.type === "boolean" ? { type: "boolean" }
        : column.type === "integer" || column.type === "real" || column.type === "doublePrecision" ? { type: "number" }
        : column.type === "numeric" ? { type: "union", value: [{ type: "number" }, { type: "string" }] } : { type: "any" };
      value[column.identity.columnId] = { fieldType: column.nullable ? { type: "union", value: [fieldType, { type: "null" }] } : fieldType,
        optional: false };
    }
    return { tableName: declaration.name, documentType: { type: "object", value },
      indexes: indexes.filter((index, position) => indexes.findIndex(candidate => candidate.indexName === index.indexName) === position)
        .map(index => ({ indexDescriptor: index.indexName, fields: index.fields })), stagedDbIndexes: [] };
  });
  return { declarations: Object.freeze(declarations), schemaTables, foreignKeys: Object.freeze(foreignKeys) };
});

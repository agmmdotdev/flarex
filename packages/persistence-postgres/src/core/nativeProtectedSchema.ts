import { Effect } from "effect";
import { readPreparedLogicalSchemaCandidate, type PreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalTableKey, encodeLogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import type { CoreSchemaDefinition, CoreSchemaInputSchema } from "./schemaTypes";
import { CoreSchemaError } from "./schemaTypes";
import type { CoreSchemaSource, CoreSchemaTableBinding } from "./schemaBundle";
import type { CoreNativeProtectedReference } from "./nativePolicyTypes";
import { coreNativeIndexName } from "./schemaTableName";

const unsupported = (message: string, cause?: unknown) => new CoreSchemaError({ reason: "unsupportedCapability", message,
  ...(cause === undefined ? {} : { cause }) });
const canonical = (value: Json) => encodeCanonicalJson(value, issue => { throw new Error(`Protected source lost JSON: ${issue.reason}`); });

/** The opaque candidate supplies the trusted composition's selected extension;
 * its endpoint source wires must also match the actual compiler-issued sources. */
export const lowerCoreProtectedReferences = Effect.fn("CoreSchemaBundle.lowerProtectedReferences")(function* (
  prepared: PreparedLogicalSchemaCandidate, sources: readonly CoreSchemaSource[],
  bindings: readonly CoreSchemaTableBinding[], originalTables: CoreSchemaDefinition["tables"],
) {
  const candidate = yield* readPreparedLogicalSchemaCandidate(prepared)
    .pipe(Effect.mapError(cause => unsupported("Protected references require a prepared source candidate", cause)));
  for (const source of candidate.sources) {
    const issued = sources.find(selected => selected.definition.source.key === source.key)?.definition.source;
    if (issued === undefined || canonical(encodeLogicalSchemaSource(issued)) !== canonical(encodeLogicalSchemaSource(source)))
      return yield* unsupported("Protected candidate source differs from its compiler-issued schema source");
  }
  const references: CoreNativeProtectedReference[] = [];
  const tables: (typeof CoreSchemaInputSchema.Type)["tables"][number][] = [...originalTables];
  for (const reference of candidate.extensions) {
    const sourceBinding = bindings.find(binding => logicalTableKey(binding.table) === logicalTableKey(reference.source.table));
    const targetBinding = bindings.find(binding => logicalTableKey(binding.table) === logicalTableKey(reference.target.table));
    const source = sources.find(selected => selected.definition.source.key === sourceBinding?.sourceKey);
    const target = sources.find(selected => selected.definition.source.key === targetBinding?.sourceKey);
    if (sourceBinding === undefined || targetBinding === undefined || source === undefined || target?.kind !== "native"
      || !candidate.sources.some(item => item.key === sourceBinding.sourceKey) || !candidate.sources.some(item => item.key === targetBinding.sourceKey)
      || sourceBinding.sourceKey !== reference.sourceKey)
      return yield* unsupported("Protected reference endpoint has no matching issued native source");
    const targetDeclaration = target.definition.tables.find(table => table.name === targetBinding.coreTableName);
    const sourceDeclaration = source.kind === "native"
      ? source.definition.tables.find(table => table.name === sourceBinding.coreTableName) : undefined;
    if (targetDeclaration?.privateEvent !== undefined || targetDeclaration?.privateReference !== undefined
      || sourceDeclaration?.privateEvent !== undefined || sourceDeclaration?.privateReference !== undefined)
      return yield* unsupported("Protected references cannot expose private native records");
    const targetKey = targetDeclaration?.uniqueConstraints.find(constraint => constraint.fields.length === 1
      && constraint.fields[0] === reference.target.field && constraint.eligibility === undefined && !constraint.nullsDistinct);
    if (targetKey === undefined) return yield* unsupported("Protected reference target requires a native primary key access path");
    const sourcePosition = tables.findIndex(table => table.tableName === sourceBinding.coreTableName);
    const sourceTable = tables[sourcePosition];
    if (sourceTable === undefined) return yield* unsupported("Protected source has no ordinary schema table");
    const existing = sourceTable.indexes.find(index => index.fields.length === 1 && index.fields[0] === reference.source.field);
    const indexName = existing?.indexDescriptor
      ?? (yield* coreNativeIndexName(sourceBinding.table, "index", `protected-reference/${reference.name}`));
    if (existing === undefined) tables[sourcePosition] = { ...sourceTable,
      indexes: [...sourceTable.indexes, { indexDescriptor: indexName, fields: [reference.source.field] }] };
    references.push(snapshotDecodedProtocolPlainData({ reference,
      sourceTable: sourceBinding.coreTableName, targetTable: targetBinding.coreTableName, field: reference.source.field,
      indexName, targetField: reference.target.field, targetIndexName: targetKey.indexName,
      sourceIdentity: { sourceKey: sourceBinding.sourceKey, sourceSha256: source.definition.source.sourceSha256 },
      targetIdentity: { sourceKey: targetBinding.sourceKey, sourceSha256: target.definition.source.sourceSha256 } }));
  }
  for (const binding of bindings) if (references.filter(reference => reference.sourceTable === binding.coreTableName
    || reference.targetTable === binding.coreTableName).length > 64)
    return yield* unsupported("Protected reference table policy limit exceeded");
  return { references: Object.freeze(references), tables };
});

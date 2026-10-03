import { Effect } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, LogicalSchemaCandidateError } from
  "../../analysis/src/logicalSchemaCandidate";
import type { LogicalSchemaCandidate, LogicalSchemaSource, LogicalSchemaExtension } from "flarex-protocol/internal/logical-schema-candidate";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from
  "flarex-protocol/internal/relational-schema";

export type LogicalReadMetadataScale = Readonly<{
  axis: "tables" | "indexes" | "relations" | "otherSourceDefinitions";
  count: 1 | 100;
  /** The selected finite graph scales actual native access/source closures. */
  profile?: "finite";
}>;

const origin = { kind: "synthetic", sourceId: "standalone-read-metadata-scaling" };
const prefix = "benchmark_unrelated_";
const column = (columnId: string) => ({ columnId, type: "text", nullable: false,
  default: { kind: "none" }, origin });
function sideTable(tableId: string, width = 0) {
  return { tableId, origin, columns: [column("id"), ...Array.from({ length: width }, (_, index) => column(`value_${index}`))],
    keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }],
    indexes: [], constraints: [], relationships: [] };
}

/** Provision real canonical parents through the normal capture/admission path.
 * Standalone defaults stay outside native definitions. The explicit finite
 * variant adds only unused native title indexes or one fixed source edge. */
export const prepareLogicalReadMetadataScalingCandidate = Effect.fn("LogicalReadMetadataScaling.prepare")(
  function* (candidate: LogicalSchemaCandidate, scale: LogicalReadMetadataScale) {
    const product = candidate.sources.find(source => source.key === "medusa.product");
    if (product?.definition.kind !== "relational")
      return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "invalidInput", cause: "Missing native Product source" }));
    const original = product.definition.schema;
    const raw = relationalSchemaSourceFromDefinition(original);
    if (!isNonArrayRecord(raw) || !Array.isArray(raw.tables))
      return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "invalidInput", cause: "Missing normalized source projection" }));
    const unused = `${prefix}side`;
    const target = `${prefix}target`;
    const finiteIndexes = scale.profile === "finite" && scale.axis === "indexes";
    const productIndexes = finiteIndexes ? Array.from({ length: scale.count }, (_, index) => ({
      indexId: `${prefix}product_title_${index}`, kind: "btree", columns: ["title"], predicate: null, origin,
    })) : [];
    const nativeProduct = raw.tables.find(table => isNonArrayRecord(table) && table.tableId === "product");
    if (finiteIndexes && (!isNonArrayRecord(nativeProduct) || !Array.isArray(nativeProduct.indexes) ||
      !Array.isArray(nativeProduct.columns) || !nativeProduct.columns.some(value => isNonArrayRecord(value) && value.columnId === "title")))
      return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "invalidInput", cause: "Missing native Product title index parent" }));
    const nativeTables = raw.tables.map(table => finiteIndexes && table === nativeProduct &&
      isNonArrayRecord(table) && Array.isArray(table.indexes) ? { ...table, indexes: [...table.indexes, ...productIndexes] } : table);
    const sideTables = scale.axis === "tables" || scale.axis === "otherSourceDefinitions"
      ? Array.from({ length: scale.count }, (_, index) => sideTable(`${prefix}${index}`))
      : scale.axis === "indexes"
        ? finiteIndexes ? [] : [{ ...sideTable(unused, 100), indexes: Array.from({ length: scale.count }, (_, index) => ({
          indexId: `${unused}.value_${index}`, kind: "btree", columns: [`value_${index}`], predicate: null, origin,
        })) }]
        : [sideTable(target), { ...sideTable(unused, 100),
          constraints: Array.from({ length: scale.count }, (_, index) => ({
            constraintId: `${unused}.reference_${index}`, kind: "foreignKey", sourceColumns: [`value_${index}`],
            targetColumns: [{ tableId: target, columnId: "id" }], onDelete: "restrict", onUpdate: "noAction", origin,
          })),
          relationships: Array.from({ length: scale.count }, (_, index) => ({
            relationshipId: `${unused}.reference_${index}`, kind: "manyToOne",
            foreignKeyConstraintId: `${unused}.reference_${index}`, origin,
          })),
        }];
    const otherSource = scale.axis === "otherSourceDefinitions";
    const schema = yield* Effect.fromResult(normalizeRelationalSchema(otherSource
      ? { owner: "medusa", lineageId: "benchmark.unrelated", tables: sideTables, capabilities: [] }
      : { ...raw, tables: [...nativeTables, ...sideTables] }));
    const key = otherSource ? "benchmark.unrelated" : product.key;
    const source = yield* captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: otherSource ? key : product.writeProfile,
      evidence: { kind: "benchmarkMetadataExtension", axis: scale.axis, count: scale.count, nativeEvidence: product.evidence },
      definition: { kind: "relational", schema },
      bindings: otherSource
        ? schema.tables.map(table => ({ kind: "definition" as const, localName: table.identity.tableId,
          table: { namespace: "medusa" as const, logicalName: `benchmark/${table.identity.tableId}` } }))
        : [...product.bindings, ...schema.tables.filter(table => table.identity.tableId.startsWith(prefix))
          .map(table => ({ kind: "definition" as const, localName: table.identity.tableId,
            table: { namespace: "medusa" as const, logicalName: `product/${table.identity.tableId}` } }))],
    });
    if (!otherSource && original.tables.some(table => {
      const current = schema.tables.find(value => value.identity.tableId === table.identity.tableId);
      if (current === undefined) return true;
      if (!finiteIndexes || table.identity.tableId !== "product") return JSON.stringify(table) !== JSON.stringify(current);
      const addedIds = new Set(productIndexes.map(index => index.indexId));
      const added = current.indexes.filter(index => addedIds.has(index.identity.indexId));
      return added.length !== scale.count || added.some(index => index.kind !== "btree" ||
        index.columns.length !== 1 || index.columns[0]?.columnId !== "title" || index.predicate !== null) ||
        JSON.stringify(table) !== JSON.stringify({ ...current, indexes: current.indexes.filter(index => !addedIds.has(index.identity.indexId)) });
    }))
      return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "invalidInput", cause: "Scaling changed native Product definitions" }));
    const sources = otherSource ? [...candidate.sources, source]
      : candidate.sources.map(current => current === product ? source : current);
    const finiteSourceEdge: LogicalSchemaExtension[] = [];
    if (otherSource && scale.profile === "finite") {
      const productBinding = product.bindings.find(binding => binding.kind === "definition" && binding.localName === "product");
      const sourceBinding = source.bindings.find(binding => binding.kind === "definition" && binding.localName === `${prefix}0`);
      if (productBinding === undefined || sourceBinding === undefined)
        return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "invalidInput", cause: "Missing connected finite metadata endpoints" }));
      finiteSourceEdge.push({ name: "benchmark_unrelated_product", sourceKey: source.key,
        source: { table: sourceBinding.table, field: "id" }, target: { table: productBinding.table, field: "id" },
        policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
        onTargetDelete: "restrict" });
    }
    const prepared = yield* prepareLogicalSchemaCandidate({ ...candidate, sources,
      extensions: [...candidate.extensions, ...finiteSourceEdge] });
    return { prepared, scale, counts: logicalReadMetadataCounts(sources), added: {
      tables: sideTables.length,
      indexes: productIndexes.length + sideTables.reduce((count, table) => count + table.indexes.length, 0),
      relations: sideTables.reduce((count, table) => count + table.relationships.length, 0),
      otherSourceDefinitions: otherSource ? schema.tables.length : 0,
      extensions: finiteSourceEdge.length,
    } };
  },
);

export function logicalReadMetadataCounts(sources: readonly LogicalSchemaSource[]) {
  return { sources: sources.length, tables: sources.reduce((count, source) => count + source.bindings.length, 0),
    indexes: sources.reduce((count, source) => count + (source.definition.kind === "relational"
      ? source.definition.schema.tables.reduce((total, table) => total + table.indexes.length, 0)
      : source.definition.indexes.length), 0),
    relations: sources.reduce((count, source) => count + (source.definition.kind === "relational"
      ? source.definition.schema.tables.reduce((total, table) => total + table.relationships.length, 0)
      : source.definition.relations.length), 0) };
}

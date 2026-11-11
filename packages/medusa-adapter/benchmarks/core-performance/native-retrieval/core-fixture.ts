import { Effect } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { compileProductDefinition } from "../../../src/modules/product/definition";
import { makeMedusaCoreDefinition } from "../../../src/schema/core-definition";
import { coreProductFixtureTarget, type CoreProductFixtureOptions } from "../../../test/support/core-product-fixture";
import type { CoreSchemaBundle } from "../../../../persistence-postgres/src/core/schemaBundle";

export interface RetrievalMetadataScale {
  readonly axis: "tables" | "indexes" | "relations" | "otherSourceDefinitions";
  readonly count: 1 | 100;
}

const origin = { kind: "synthetic", sourceId: "core-native-retrieval-metadata" };
const column = (columnId: string) => ({ columnId, type: "text", nullable: false,
  default: { kind: "none" }, origin });
const table = (tableId: string, width = 0) => ({ tableId, origin,
  columns: [column("id"), ...Array.from({ length: width }, (_, index) => column(`value_${index}`))],
  keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }],
  indexes: [], constraints: [], relationships: [] });

/** Install real unused declarations through the executing native producer and
 * shared Core bundle. Product's own DML tables and command behavior stay intact. */
export const prepareRetrievalCoreFixture = Effect.fn("NativeRetrieval.prepareCoreFixture")(function* (
  scale?: RetrievalMetadataScale,
) {
  if (scale === undefined) return {};
  const product = yield* compileProductDefinition();
  const prefix = "benchmark_unrelated_";
  // Partition relation declarations so each real table stays inside Core's
  // bounded incident-foreign-key contract, including the referenced endpoint.
  const added = scale.axis === "tables" || scale.axis === "otherSourceDefinitions"
    ? Array.from({ length: scale.count }, (_, index) => table(`${prefix}${index}`))
    : scale.axis === "indexes"
      ? Array.from({ length: Math.ceil(scale.count / 50) }, (_, group) => {
        const count = Math.min(50, scale.count - group * 50);
        return { ...table(`${prefix}indexes_${group}`, count), indexes: Array.from({ length: count }, (_, index) => ({
          indexId: `${prefix}index_${group}_${index}`, kind: "btree", columns: [`value_${index}`], predicate: null, origin,
        })) };
      })
      : Array.from({ length: Math.ceil(scale.count / 50) }, (_, group) => {
        const count = Math.min(50, scale.count - group * 50);
        const source = `${prefix}source_${group}`, target = `${prefix}target_${group}`;
        return [table(target), { ...table(source, count),
          constraints: Array.from({ length: count }, (_, index) => ({
            constraintId: `${source}.reference_${index}`, kind: "foreignKey", sourceColumns: [`value_${index}`],
            targetColumns: [{ tableId: target, columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin,
          })),
          relationships: Array.from({ length: count }, (_, index) => ({
            relationshipId: `${source}.reference_${index}`, kind: "manyToOne",
            foreignKeyConstraintId: `${source}.reference_${index}`, origin,
          })),
        }];
      }).flat();
  const original = relationalSchemaSourceFromDefinition(product.schema);
  if (!isNonArrayRecord(original) || !Array.isArray(original.tables))
    return yield* Effect.die(new Error("Missing normalized Product schema source projection"));
  const otherSource = scale.axis === "otherSourceDefinitions";
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(otherSource
    ? { owner: "medusa", lineageId: "benchmark.unrelated", tables: added, capabilities: [] }
    : { ...original, tables: [...original.tables, ...added] }));
  const provenance = product.provenance;
  const key = otherSource ? "benchmark.unrelated" : "medusa.product";
  const definition = yield* makeMedusaCoreDefinition(coreProductFixtureTarget, { schema, provenance }, {
    key, writeProfile: otherSource ? key : "medusa.product",
    evidence: { provenance, profile: "medusa.product", metadataScale: { axis: scale.axis, count: scale.count } },
  });
  return (otherSource ? { sources: [{ kind: "native", definition }] } : { definition }) satisfies CoreProductFixtureOptions;
});

export function retrievalCoreMetadataEvidence(bundle: CoreSchemaBundle, scale?: RetrievalMetadataScale) {
  const sources = bundle.sources.map(source => source.definition.source);
  return { scale, counts: {
    sources: sources.length,
    tables: sources.reduce((count, source) => count + source.bindings.length, 0),
    indexes: sources.reduce((count, source) => count + (source.definition.kind === "relational"
      ? source.definition.schema.tables.reduce((total, table) => total + table.indexes.length, 0) : source.definition.indexes.length), 0),
    relations: sources.reduce((count, source) => count + (source.definition.kind === "relational"
      ? source.definition.schema.tables.reduce((total, table) => total + table.relationships.length, 0) : source.definition.relations.length), 0),
  } };
}

import type { Schema } from "effect";
import { CoreIndexMetadataSchema } from "../../src/core/indexState";
import { CoreTableIteratorBudgetSchema } from "../../src/core/iteratorBudget";
import { CoreNativeForeignKeySchema } from "../../src/core/nativePolicyTypes";

const budget = { documentBytes: 1048576, documentCount: 1000, logPageSize: 100,
  maxLogPagesPerStep: 10, maxMetadataEntries: 1000, pageSize: 100 };
const index = { table_id: "ab".repeat(16), descriptor: "by_name", config: {
  type: "database", fields: ["name", "_creationTime"], onDiskState: { type: "Enabled" },
} };
const foreignKey = { descriptor: "child_parent", sourceTable: "children", targetTable: "parents",
  sourceFields: ["parent_id"], targetFields: ["id"], sourceIndexName: "by_parent", targetIndexName: "by_id",
  onDelete: "cascade", onUpdate: "restrict" };

/** These are the executing core's schemas, not benchmark copies of validation. */
export const suites: readonly {
  readonly name: string;
  readonly schema: Schema.ConstraintDecoder<unknown>;
  readonly valid: readonly unknown[];
  readonly invalid: readonly unknown[];
}[] = [
  { name: "iterator-budget", schema: CoreTableIteratorBudgetSchema, valid: [budget, { ...budget, pageSize: 1 }],
    invalid: [null, {}, { ...budget, pageSize: 0 }, { ...budget, documentCount: -1 },
      { ...budget, documentBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...budget, logPageSize: Number.NaN }] },
  { name: "index-metadata", schema: CoreIndexMetadataSchema, valid: [index,
    { ...index, config: { ...index.config, persistenceIndexId: 0x7fff_ffff_ffff_ffffn,
      onDiskState: { type: "Backfilled2", staged: false } } },
    { ...index, config: { ...index.config, onDiskState: { type: "Backfilling",
      backfillState: { indexCreatedLowerBound: 10n, retentionStarted: true, staged: false } } } }],
    invalid: [null, {}, { ...index, table_id: "AB".repeat(16) },
      { ...index, config: { ...index.config, fields: ["name", "name"] } },
      { ...index, config: { ...index.config, fields: ["_id"] } },
      { ...index, config: { ...index.config, persistenceIndexId: 1n << 63n } },
      { ...index, config: { ...index.config, onDiskState: { type: "Backfilled2" } } }] },
  { name: "native-foreign-key", schema: CoreNativeForeignKeySchema,
    valid: [foreignKey, { ...foreignKey, sourceFields: ["parent_id", "tenant"], targetFields: ["id", "tenant"] }],
    invalid: [null, {}, { ...foreignKey, targetFields: ["id", "tenant"] },
      { ...foreignKey, sourceFields: ["parent_id", "parent_id"], targetFields: ["id", "tenant"] },
      { ...foreignKey, onDelete: "ignore" }, { ...foreignKey, sourceFields: [] }] },
];

import { install as installSchemaAot } from "./iteratorBudget.schema-aot.generated.mjs";
import { Schema } from "effect";
export const CoreIteratorPositiveBudgetSchema = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value > 0
  ? undefined : "Expected a positive safe iterator resource budget"));
export const CoreTableIteratorResourceBudgetSchema = Schema.Struct({
  documentBytes: CoreIteratorPositiveBudgetSchema, documentCount: CoreIteratorPositiveBudgetSchema,
  logPageSize: CoreIteratorPositiveBudgetSchema, maxLogPagesPerStep: CoreIteratorPositiveBudgetSchema,
  maxMetadataEntries: CoreIteratorPositiveBudgetSchema,
});
export const CoreTableIteratorBudgetSchema = Schema.Struct({ ...CoreTableIteratorResourceBudgetSchema.fields, pageSize: CoreIteratorPositiveBudgetSchema });
export type CoreTableIteratorBudget = typeof CoreTableIteratorBudgetSchema.Type;

/** Exact ordered build targets; install before any parser captures these ASTs. */
// Borrowed iterator budget objects stay interpreted; only already-read scalar
// values are safe to specialize without replaying caller-owned getters.
export const schemaAotTargets = [CoreIteratorPositiveBudgetSchema] as const;
installSchemaAot(schemaAotTargets.map(schema => schema.ast));

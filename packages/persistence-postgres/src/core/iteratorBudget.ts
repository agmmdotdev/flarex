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

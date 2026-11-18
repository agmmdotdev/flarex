import { Effect, Result, Schema } from "effect";
import type { PromotionPrefilterPersistence, PromotionScalarPredicate } from "@medusajs/promotion/prefilter";
import { commerceError, type CommerceResources, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { commerceRepositoryContext } from "../../repository/context";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { readCommerceRelationRows } from "../../query/relations";
import type { capturePromotionMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof capturePromotionMetadata>>["frame"];
export interface PromotionPrefilterReads {
  readonly resources: Pick<CommerceResources, "commandBytes" | "valueNodes">;
  readonly rows: (table: string, predicate: Json, order: string) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
  readonly related: (table: string, query: Json) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
}
export type PromotionPrefilterExecutor = <Value>(shared: Parameters<PromotionPrefilterPersistence["promotions"]>[1], input: unknown,
  work: (reads: PromotionPrefilterReads, captured: Json) => Effect.Effect<Value, CommerceTransactionError>) => Promise<Value>;
const id = Schema.String.check(Schema.isMinLength(1));
const rootProjection = commerceDecoder(Schema.Struct({ id }), "storedCorruption");
const ruleProjection = commerceDecoder(Schema.Struct({ id, attribute: Schema.String }), "storedCorruption");
const methodProjection = commerceDecoder(Schema.Struct({ id, promotion_id: id }), "storedCorruption");
const globalProjection = commerceDecoder(Schema.Struct({ promotion_id: id, promotion_rule_id: id }), "storedCorruption");
const methodRuleProjection = commerceDecoder(Schema.Struct({ application_method_id: id, promotion_rule_id: id }), "storedCorruption");

/** This port translates native-owned predicate data to the existing storage
 * owner. It has no SQL, candidate policy, cast evaluator or transaction runner. */
export function preparePromotionPrefilterPort(metadata: Metadata) {
  return Result.gen(function* () {
    const entities = yield* Result.all(metadata.tables.map(table => Result.gen(function* () {
      const declared = table.columns.filter(column => column.primaryKey).map(column => column.name);
      // Genuine implicit pivots use the one unconditional native composite
      // unique key already retained by DML lowering. It is a read identity,
      // never a fabricated model id or a new uniqueness enforcement path.
      const unique = table.indexes.filter(index => index.unique && index.where === undefined &&
        (index.type === undefined || index.type === "btree"));
      const primary = declared.length ? declared : unique.length === 1 ? unique[0]?.columns ?? [] : [];
      if (!primary.length) return yield* Result.fail(commerceError("unsupportedProfile"));
      return { table, primary, complete: yield* compileCompleteRow(table) };
    })));
    const byName = new Map(entities.map(entity => [entity.table.name, entity]));
    const rule = byName.get("promotion_rule"), value = byName.get("promotion_rule_value");
    const keys = value?.table.foreignKeys.filter(key => key.referencedTable === rule?.table.name);
    const foreign = keys?.[0];
    if (rule?.primary.length !== 1 || rule.primary[0] !== "id" || value?.primary.length !== 1 ||
      value.primary[0] !== "id" || keys?.length !== 1 || foreign?.columns.length !== 1 || foreign.columns[0] !== "promotion_rule_id" ||
      foreign.referencedColumns.length !== 1 || foreign.referencedColumns[0] !== "id" ||
      value.table.columns.find(column => column.name === "promotion_rule_id")?.nullable !== false)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      return yield* Result.all(rows.map(row => entity.complete(projectNativeRow(row))));
    });
    const project = <Value>(rows: readonly JsonObject[], fields: readonly string[], decode: (input: unknown) => Result.Result<Value, CommerceTransactionError>) =>
      Result.all(rows.map(row => decode(Object.fromEntries(fields.map(field => [field, row[field]])))));
    const make = (execute: PromotionPrefilterExecutor): PromotionPrefilterPersistence => {
      const read = <Value>(table: string, fields: readonly string[], decode: (input: unknown) => Result.Result<Value, CommerceTransactionError>) =>
        (predicate: PromotionScalarPredicate, shared: Parameters<PromotionPrefilterPersistence["promotions"]>[1]): Promise<readonly Value[]> =>
          execute(shared, predicate, (reads, captured) => Effect.gen(function* () {
            const entity = byName.get(table), order = entity?.primary[0];
            if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
            const rows = yield* reads.rows(table, captured, order);
            return yield* Effect.fromResult(project(yield* Effect.fromResult(complete(table, rows)), fields, decode));
          }));
      return {
        promotions: read("promotion", ["id"], rootProjection),
        rules: read("promotion_rule", ["id", "attribute"], ruleProjection),
        applicationMethods: read("promotion_application_method", ["id", "promotion_id"], methodProjection),
        globalRules: read("promotion_promotion_rule", ["promotion_id", "promotion_rule_id"], globalProjection),
        targetRules: read("application_method_target_rules", ["application_method_id", "promotion_rule_id"], methodRuleProjection),
        buyRules: read("application_method_buy_rules", ["application_method_id", "promotion_rule_id"], methodRuleProjection),
        evaluateRules: (predicate, shared) => execute(shared, predicate, (reads, captured) =>
          Effect.gen(function* () {
            const query = yield* Effect.fromResult(captureCommerceInput({ childTable: value.table.name, foreignKey: foreign.name, predicate: captured }, reads.resources));
            const rows = yield* reads.related(rule.table.name, query);
            return yield* Effect.fromResult(project(yield* Effect.fromResult(complete(rule.table.name, rows)), ["id"], rootProjection));
          })),
      };
    };
    const bind = (bridge: ReturnType<typeof commerceRepositoryContext>) => make((shared, input, work) =>
      bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
        const data = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources));
        return yield* work({ resources: ctx.resources, rows: (table, predicate, order) => readCommerceRelationRows(ctx, table, predicate, order, { includeIdentities: true }),
          related: (name, query) => Effect.gen(function* () {
            const table = yield* ctx.table(name);
            if (table.related === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            return yield* table.related(ctx.manager, query);
          }) }, data);
      }))));
    return { bind, make, complete, entities, foreignKey: foreign.name };
  });
}

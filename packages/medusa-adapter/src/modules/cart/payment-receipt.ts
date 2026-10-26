import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { toPopulateTree, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { includeCartTotals } from "@medusajs/cart/utils/totals-selection";
import { createRawPropertiesFromBigNumber, decorateCartTotals } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeCartPaymentRead, type prepareCartPaymentRead } from "./payment-read";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartPaymentRead>>;
const mismatch = () => commerceError("receiptMismatch");
export function cartPaymentReadPolicy(prepared: Prepared) {
  const capture = Effect.fn("CartPayment.captureEvent")((_input: unknown) => Effect.fail(commerceError("unadmittedEvent")));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CartPayment.validateRead")(function* (call, activity) {
    if (call.commandName !== "cartCountForPaymentCollection" || call.mode !== "read" || call.events.length || activity.mutations.length ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeCartPaymentRead(call.input)), config = structuredClone(input.config ?? {});
    const includeTotals = includeCartTotals(config);
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, config)).pipe(Result.flatMap(prepared.query)));
    type Row = JsonObject & { readonly id: string };
    const state = new Map<string, Row[]>();
    for (const observation of activity.observedRows) {
      const entity = prepared.byName.get(observation.table);
      if (entity === undefined) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(entity.complete(projectNativeRow(observation.row)));
      if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
      const group = state.get(observation.table) ?? [], previous = group.find(value => value.id === row.id);
      if (previous !== undefined && !jsonEqual(previous, row)) return yield* Effect.fail(mismatch());
      if (previous === undefined) group.push({ ...row, id: row.id });
      state.set(observation.table, group);
    }
    const ids = typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id;
    const roots = orderNativeIdRows((state.get("cart") ?? []).filter(row => row.deleted_at === null && typeof row.id === "string" && ids.includes(row.id)), {});
    const selected = new Map<string, readonly JsonObject[]>([["cart", roots]]);
    const reads = [{ table: "cart", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: roots.length, returned: roots.length }];
    const populate = (source: string, parents: readonly JsonObject[], tree: PopulateTree): Result.Result<void, ReturnType<typeof commerceError>> => Result.gen(function* () {
      for (const [name, nested] of tree) {
        const relation = prepared.relations.get(source)?.get(name);
        if (relation === undefined || relation.join.type !== "hasMany") return yield* Result.fail(mismatch());
        const population = yield* prepareCommerceRelationPopulation(relation.join.foreignKeys, parents, relation.sourcePrimaryKeys, true, false);
        let rows: readonly JsonObject[] = [];
        if (Option.isSome(population)) {
          const { column, values, predicate } = population.value;
          rows = orderNativeIdRows((state.get(relation.targetTable) ?? []).filter(row => row.deleted_at === null &&
            typeof row[column] === "string" && values.includes(row[column])), {});
          if (rows.length > 4) return yield* Result.fail(mismatch());
          reads.push({ table: relation.targetTable, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: rows.length, returned: rows.length });
        }
        if (selected.has(relation.targetTable)) return yield* Result.fail(mismatch());
        selected.set(relation.targetTable, rows);
        yield* populate(relation.targetTable, rows, nested);
      }
    });
    yield* Effect.fromResult(populate("cart", roots, toPopulateTree(plan.paths)));
    if (roots.length > 4 || !jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
    const assembled = yield* Effect.fromResult(assembleCommerceRelations("cart", selected, plan.paths, prepared.relations));
    const projected = yield* Effect.fromResult(projectRows(assembled, plan.projection.node));
    const output = yield* prepared.present(projected, "cart");
    if (!Array.isArray(output)) return yield* Effect.fail(mismatch());
    if (includeTotals) for (const cart of output) {
      // Native arithmetic mutates its detached DTO. This is the same owner
      // invoked by CartModuleService, never a second totals implementation.
      Reflect.apply(createRawPropertiesFromBigNumber, undefined, [Reflect.apply(decorateCartTotals, undefined, [cart])]);
    }
    const result = yield* Effect.fromResult(captureNativeNumericDto(output));
    if (!jsonEqual(call.result, [result, roots.length])) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}

import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { toPopulateTree, fillEmptyToManyRelations, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { presentCartCreation } from "@medusajs/cart/creation";
import { includeCartTotals } from "@medusajs/cart/utils/totals-selection";
import { createRawPropertiesFromBigNumber, decorateCartTotals } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation, reusePrimaryRelationRows } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeCartPaymentRead, type prepareCartPaymentRead } from "./payment-read";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartPaymentRead>>;
const mismatch = () => commerceError("receiptMismatch");
export function cartPaymentReadPolicy(prepared: Prepared, profile: "payment" | "completion" | "creation" = "payment") {
  const capture = Effect.fn("CartPayment.captureEvent")((_input: unknown) => Effect.fail(commerceError("unadmittedEvent")));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CartPayment.validateRead")(function* (call, activity) {
    const creation = profile === "creation";
    const lineItems = prepared.profile === "checkout" && call.commandName === "cartLineItemsCountForCheckout";
    const rootTable = lineItems ? "cart_line_item" : "cart";
    const count = lineItems || call.commandName === (profile === "payment" ? "cartCountForPaymentCollection" : "cartCountForCheckout");
    if ((!count && (creation ? call.commandName !== "cartListForCreation" : profile !== "completion" || call.commandName !== "cartListForCheckout")) || call.mode !== "read" || call.events.length || activity.mutations.length ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeCartPaymentRead(call.input)), config = structuredClone(input.config ?? {});
    const includeTotals = !creation && !lineItems && includeCartTotals(config);
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, config)).pipe(Result.flatMap(value => prepared.queryTable(rootTable, value))));
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
    const roots = orderNativeIdRows((state.get(rootTable) ?? []).filter(row => row.deleted_at === null && typeof row.id === "string" && ids.includes(row.id)), {});
    const selected = new Map<string, readonly JsonObject[]>([[rootTable, roots]]);
    const reads = [{ table: rootTable, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: roots.length, returned: roots.length }];
    const populate = (source: string, parents: readonly JsonObject[], tree: PopulateTree): Result.Result<void, ReturnType<typeof commerceError>> => Result.gen(function* () {
      for (const [name, nested] of tree) {
        const relation = prepared.relations.get(source)?.get(name);
        if (relation === undefined || relation.join.type === "manyToMany" || relation.join.type === "hasOne") return yield* Result.fail(mismatch());
        const owning = relation.join.type === "belongsTo";
        const population = yield* prepareCommerceRelationPopulation(owning ? relation.targetPrimaryKeys : relation.join.foreignKeys,
          parents, owning ? relation.join.foreignKeys : relation.sourcePrimaryKeys, true, false);
        let rows: readonly JsonObject[] = [];
        if (Option.isSome(population)) {
          const { column, values, predicate } = population.value;
          const reused = owning && relation.targetTable === "cart_address"
            ? reusePrimaryRelationRows(selected.get(relation.targetTable), column, values) : undefined;
          rows = reused ?? orderNativeIdRows((state.get(relation.targetTable) ?? []).filter(row => row.deleted_at === null &&
            typeof row[column] === "string" && values.includes(row[column])), {});
          if (rows.length > (creation && relation.targetTable === "cart_address" ? 8 : 4)) return yield* Result.fail(mismatch());
          if (reused === undefined) reads.push({ table: relation.targetTable, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: rows.length, returned: rows.length });
        }
        const previous = selected.get(relation.targetTable);
        // Each owning Address slot retains its real cached read transcript. Assembly
        // needs their union; observation decoding already rejects changed IDs.
        if (previous !== undefined && relation.targetTable !== "cart_address" && !jsonEqual(previous, rows))
          return yield* Result.fail(mismatch());
        const cohort = previous === undefined ? rows : [...previous, ...rows.filter(row => !previous.some(prior => prior.id === row.id))];
        if (cohort.length > (creation && relation.targetTable === "cart_address" ? 8 : 4)) return yield* Result.fail(mismatch());
        selected.set(relation.targetTable, cohort);
        yield* populate(relation.targetTable, rows, nested);
      }
    });
    yield* Effect.fromResult(populate(rootTable, roots, toPopulateTree(plan.paths)));
    if (roots.length > 4 || !jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
    const assembled = yield* Effect.fromResult(assembleCommerceRelations(rootTable, selected, plan.paths, prepared.relations));
    const projected = yield* Effect.fromResult(projectRows(assembled, plan.projection.node));
    const output = yield* prepared.present(projected, rootTable);
    if (!Array.isArray(output)) return yield* Effect.fail(mismatch());
    if (includeTotals) for (const cart of output) {
      // Native arithmetic mutates its detached DTO. This is the same owner
      // invoked by CartModuleService, never a second totals implementation.
      Reflect.apply(createRawPropertiesFromBigNumber, undefined, [Reflect.apply(decorateCartTotals, undefined, [cart])]);
    }
    if (creation) {
      fillEmptyToManyRelations(output, new Map(prepared.cart.table.relationships.map(relationship => [relationship.name, { relationship }])));
    }
    const result = yield* Effect.fromResult(captureNativeNumericDto(creation ? Reflect.apply(presentCartCreation, undefined, [output]) : output));
    if (!jsonEqual(call.result, count ? [result, roots.length] : result)) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}

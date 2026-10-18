import { Effect, Option, Result, Schema } from "effect";
import { normalizePrices } from "@medusajs/pricing/normalization";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import type { ReadPlan } from "../../query/read";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { decodeExactNumeric } from "../../value/exact-numeric";
import type { compileShippingPricingMutationContracts } from "./shipping-input";
import type { preparePricingRepository } from "./repository";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingPricingMutationContracts>>;
type Prepared = Result.Result.Success<ReturnType<typeof preparePricingRepository>>;
type Row = JsonObject & { readonly id: string };
const normalizedRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "receiptMismatch");
const normalizedRules = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(24)), "receiptMismatch");

/** Native normalization determines replacement identity and omission. This
 * proof then binds those decisions to actual scalar/rule attempts and the
 * existing repository's exact indexed read plans. */
export function pricingShippingUpdateReceipt(contracts: Contracts, prepared: Prepared): LogicalCallReceiptValidation {
  return Effect.fn("PricingEvents.validateShippingUpdate")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch"), input = yield* Effect.fromResult(contracts.decodeUpdate(call.input));
    const mutationQuery = prepared.mutationQuery, query = prepared.query;
    if (call.mode !== "write" || call.commandName !== "pricingUpdate" || !isJsonObject(call.result) || mutationQuery === undefined || query === undefined)
      return yield* Effect.fail(mismatch());
    const normalized = yield* Effect.try({
      // The pinned DTO understates valid partial updates; the same native
      // helper executes these checked values in the service and this proof.
      try: () => Reflect.apply(normalizePrices, undefined, [input.update.prices.map(price => ({ ...structuredClone(price), price_set_id: input.selector })), []]),
      catch: cause => commerceError("receiptMismatch", cause),
    }).pipe(Effect.flatMap(value => Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(normalizedRows)))));
    const state = new Map<string, Map<string, Row>>([["price_set", new Map()], ["price", new Map()], ["price_rule", new Map()]]);
    const decodeRow = (table: string, value: JsonObject) => Result.gen(function* () {
      const row = projectNativeRow(value), id = row.id;
      if (typeof id !== "string" || !state.has(table)) return yield* Result.fail(mismatch());
      const identified: Row = { ...row, id }; return identified;
    });
    for (const observation of activity.observedRows) {
      const row = yield* Effect.fromResult(decodeRow(observation.table, observation.row));
      state.get(observation.table)?.set(row.id, row);
    }
    for (const mutation of [...activity.mutations].reverse()) {
      const value = mutation.before ?? mutation.after;
      if (!value) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decodeRow(mutation.table, value));
      if (mutation.before === null) state.get(mutation.table)?.delete(row.id);
      else state.get(mutation.table)?.set(row.id, yield* Effect.fromResult(decodeRow(mutation.table, mutation.before)));
    }
    const rows = (table: string) => [...state.get(table)?.values() ?? []];
    const oldPrices = orderNativeIdRows(rows("price").filter(row => row.price_set_id === input.selector && row.price_list_id === null && row.deleted_at === null), {});
    const oldPriceIds = new Set(oldPrices.map(row => row.id));
    const oldRules = orderNativeIdRows(rows("price_rule").filter(row => typeof row.price_id === "string" && oldPriceIds.has(row.price_id) && row.deleted_at === null), {});
    if (oldPrices.length > 2 || oldRules.length > 24) return yield* Effect.fail(mismatch());
    const reads: JsonObject[] = [], seen = new Set<string>(), pending = new Set(activity.mutations.map(change => change.ordinal));
    const readRows = (table: string, predicate: JsonObject, selected: readonly Row[]) => {
      reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: selected.length, returned: selected.length });
      for (const row of selected) seen.add(table + ":" + row.id);
    };
    const read = (table: string, filters: JsonObject, config: JsonObject = {}) => Result.gen(function* () {
      const captured = yield* captureCommerceInput(buildQuery(filters, config));
      const plan: ReadPlan = table === "price_set" ? yield* query(captured) : yield* mutationQuery(table, captured);
      const ids = filters.id, priceSetIds = filters.price_set_id, selectedIds = typeof ids === "string" ? [ids] : Array.isArray(ids) ? ids
        : Array.isArray(filters.$or) ? filters.$or.flatMap(value => isJsonObject(value) && typeof value.id === "string" ? [value.id] : []) : undefined;
      const candidates = rows(table).filter(row => (selectedIds === undefined || selectedIds.includes(row.id)) &&
        (priceSetIds === undefined || Array.isArray(priceSetIds) && priceSetIds.includes(row.price_set_id)) &&
        (filters.price_list_id !== null || row.price_list_id === null));
      for (const row of candidates) seen.add(table + ":" + row.id);
      const active = orderNativeIdRows(candidates.filter(row => row.deleted_at === null), {});
      readRows(table, plan.query.predicate, active);
      if (plan.window.kind !== "catalog") return yield* Result.fail(mismatch());
      const selected = plan.window.select(active), catalog = new Map<string, readonly JsonObject[]>([[table, selected.rows]]);
      for (const path of plan.paths) {
        const parent = path === "price_rules" ? table : path === "prices" ? "price_set" : "price";
        const target = path === "prices" ? "price" : "price_rule", foreignKey = target === "price" ? "price_set_id" : "price_id";
        const parents = catalog.get(parent) ?? [];
        const populationFilter = plan.populationFilters?.find(filter => filter.path === path)?.predicate;
        const population = yield* prepareCommerceRelationPopulation([foreignKey], parents, ["id"], true, false, populationFilter);
        if (Option.isNone(population)) { catalog.set(target, []); continue; }
        const candidates = rows(target).filter(row => typeof row[foreignKey] === "string" && population.value.values.includes(row[foreignKey]));
        for (const row of candidates) seen.add(target + ":" + row.id);
        const active = orderNativeIdRows(candidates.filter(row => row.deleted_at === null && (target !== "price" || !populationFilter || row.price_list_id === null)), {});
        readRows(target, population.value.predicate, active); catalog.set(target, active);
      }
      return selected.rows;
    });
    yield* Effect.fromResult(read("price_set", { id: input.selector }));
    yield* Effect.fromResult(read("price", { price_set_id: [input.selector], price_list_id: null }, { relations: ["price_rules"], take: null }));
    const scalar = Effect.fn("PricingEvents.shippingScalar")(function* (table: typeof contracts.tables.price, supplied: JsonObject, previous: Row | undefined, actual: Row) {
      const defaults: Record<string, Json> = {};
      if (!previous) for (const column of table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
        if (column.defaultValue !== undefined) defaults[column.name] = column.defaultValue;
        else if (column.nullable) defaults[column.name] = null;
      }
      const expected: Record<string, Json | undefined> = { ...defaults, deleted_at: null, ...previous,
        ...Object.fromEntries(Object.entries(supplied).filter(([key]) => table.columns.some(column => column.name === key))) };
      for (const column of table.columns) {
        const name = column.name;
        if (name === "updated_at" || name === "id") continue;
        if (name === "created_at") {
          if (expected.created_at === undefined ? actual.created_at !== actual.updated_at : expected.created_at !== actual.created_at)
            return yield* Effect.fail(mismatch());
          continue;
        }
        if (table === contracts.tables.price && name.startsWith("raw_")) continue;
        const expectedValue = expected[name], actualValue = actual[name];
        if (column.type === "bigNumber") {
          const suppliedRaw = supplied["raw_" + name], actualRaw = actual["raw_" + name];
          if (expectedValue === null && actualValue === null && actualRaw === null && column.nullable) continue;
          if (actualRaw === undefined) return yield* Effect.fail(mismatch());
          const value = suppliedRaw !== undefined && isJsonObject(suppliedRaw) ? suppliedRaw.value : expectedValue;
          yield* decodeExactNumeric(value, actualRaw, column.nullable);
          if (suppliedRaw !== undefined && !jsonEqual(suppliedRaw, actualRaw)) return yield* Effect.fail(mismatch());
        } else if (expectedValue === undefined || actualValue === undefined || !jsonEqual(expectedValue, actualValue)) return yield* Effect.fail(mismatch());
      }
    });
    const change = (table: string, id: string | undefined, operation: "insert" | "patch" | "delete", parent?: string) => Result.gen(function* () {
      const mutation = activity.mutations.find(value => pending.has(value.ordinal) && value.table === table && value.operation === operation &&
        (id === undefined || (value.after?.id ?? value.before?.id) === id) &&
        (parent === undefined || (value.after?.price_id ?? value.before?.price_id) === parent));
      if (!mutation) return yield* Result.fail(mismatch());
      const value = mutation.after ?? mutation.before;
      if (!value) return yield* Result.fail(mismatch());
      const row = yield* decodeRow(table, value), previous = state.get(table)?.get(row.id);
      if (operation === "insert" ? previous !== undefined || mutation.before !== null : previous === undefined || mutation.before === null || !jsonEqual(projectNativeRow(mutation.before), previous))
        return yield* Result.fail(mismatch());
      pending.delete(mutation.ordinal);
      if (operation === "delete") state.get(table)?.delete(row.id); else state.get(table)?.set(row.id, row);
      return row;
    });
    const byId = new Map(oldPrices.map(row => [row.id, row])), created = normalized.filter(row => typeof row.id !== "string" || !byId.has(row.id)),
      updated = normalized.filter((row): row is Row => typeof row.id === "string" && byId.has(row.id)), wantedIds = new Set(normalized.flatMap(row => typeof row.id === "string" ? [row.id] : []));
    const createdIds: string[] = [], updatedIds: string[] = [];
    for (const request of created) {
      const row = yield* Effect.fromResult(change("price", typeof request.id === "string" ? request.id : undefined, "insert"));
      yield* scalar(contracts.tables.price, { ...request, price_set_id: input.selector, price_list_id: null }, undefined, row);
      createdIds.push(row.id);
      for (const child of yield* Effect.fromResult(normalizedRules(request.price_rules ?? []))) {
        const inserted = yield* Effect.fromResult(change("price_rule", typeof child.id === "string" ? child.id : undefined, "insert", row.id));
        yield* scalar(contracts.tables.rule, { ...child, price_id: row.id }, undefined, inserted);
      }
    }
    for (const request of updated) {
      if (typeof request.id !== "string") return yield* Effect.fail(mismatch());
      const previous = byId.get(request.id);
      if (!previous) return yield* Effect.fail(mismatch());
      const selectedRules = request.price_rules === undefined ? undefined : yield* Effect.fromResult(normalizedRules(request.price_rules));
      if (selectedRules !== undefined) {
        const retained = new Set(selectedRules.flatMap(row => typeof row.id === "string" ? [row.id] : []));
        for (const child of selectedRules.filter(row => typeof row.id !== "string")) {
          const inserted = yield* Effect.fromResult(change("price_rule", undefined, "insert", previous.id));
          yield* scalar(contracts.tables.rule, { ...child, price_id: previous.id }, undefined, inserted);
        }
        const updates = selectedRules.filter((row): row is Row => typeof row.id === "string");
        if (updates.length) {
          yield* Effect.fromResult(read("price_rule", { $or: updates.map(row => ({ id: row.id })) }));
          for (const child of orderNativeIdRows(updates, {})) {
            const old = state.get("price_rule")?.get(child.id);
            if (!old || old.price_id !== previous.id) return yield* Effect.fail(mismatch());
            const patched = yield* Effect.fromResult(change("price_rule", child.id, "patch"));
            yield* scalar(contracts.tables.rule, child, old, patched);
          }
        }
        for (const old of oldRules.filter(row => row.price_id === previous.id && !retained.has(row.id)))
          yield* Effect.fromResult(change("price_rule", old.id, "delete"));
      }
    }
    if (updated.length) {
      const selected = yield* Effect.fromResult(read("price", { $or: updated.map(row => ({ id: row.id })) }));
      for (const previous of selected) {
        const request = updated.find(row => row.id === previous.id);
        if (!request || typeof previous.id !== "string") return yield* Effect.fail(mismatch());
        const old = byId.get(previous.id), rules = request.price_rules === undefined ? undefined : yield* Effect.fromResult(normalizedRules(request.price_rules));
        if (!old) return yield* Effect.fail(mismatch());
        const wanted = { ...request, ...(rules === undefined ? { rules_count: old.rules_count } : { rules_count: rules.length }) };
        const after = yield* Effect.fromResult(change("price", previous.id, "patch"));
        yield* scalar(contracts.tables.price, yield* Effect.fromResult(captureCommerceInput(wanted)).pipe(Effect.flatMap(value => isJsonObject(value) ? Effect.succeed(value) : Effect.fail(mismatch()))), old, after);
        updatedIds.push(after.id);
      }
    }
    const deleted = oldPrices.filter(row => !wantedIds.has(row.id));
    if (deleted.length) {
      const children = rows("price_rule").filter(row => deleted.some(price => price.id === row.price_id));
      readRows("price_rule", { kind: "in", column: "price_id", values: deleted.map(row => row.id) }, orderNativeIdRows(children, {}));
      for (const row of children) yield* Effect.fromResult(change("price_rule", row.id, "delete"));
      for (const row of deleted) yield* Effect.fromResult(change("price", row.id, "delete"));
    }
    yield* Effect.fromResult(read("price_set", { id: [input.selector] }, { relations: ["prices", "prices.price_rules"] }));
    const returned = yield* Effect.fromResult(normalizedRows(call.result.prices));
    const returnedIds: string[] = [];
    for (const row of returned) {
      if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
      returnedIds.push(row.id);
    }
    if (!jsonEqual(returnedIds, [...createdIds, ...updatedIds]) || pending.size || !jsonEqual(reads, activity.relationalReads))
      return yield* Effect.fail(commerceError("receiptMismatch", { phase: "shipping-pricing-final-correlation",
        expected: { priceIds: [...createdIds, ...updatedIds], reads },
        actual: { priceIds: returnedIds, reads: activity.relationalReads }, pending: pending.size,
      }));
    for (const [table, group] of state) for (const row of group.values()) if (!seen.has(table + ":" + row.id) &&
      !activity.mutations.some(change => change.table === table && change.after?.id === row.id)) return yield* Effect.fail(mismatch());
    // The generic mutation owner separately authenticates complete final rows,
    // required native events and physical cascade event asymmetry.
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
}

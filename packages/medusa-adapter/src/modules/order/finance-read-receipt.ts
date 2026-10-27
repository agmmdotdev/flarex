import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { toPopulateTree, type PopulateTree } from "@medusajs/drizzle/relation-query";
import { Order } from "@medusajs/order/models";
import { formatOrder } from "@medusajs/order/utils";
import { includeOrderTotals } from "@medusajs/order/utils/totals-selection";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation, reusePrimaryRelationRows } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { decodeOrderFinanceRead } from "./finance-input";
import { orderFinanceVersionFilters } from "./finance-query";
import type { prepareOrderFinanceRepository } from "./finance-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>;
type Row = JsonObject & { readonly id: string };
export type OrderFinanceRows = ReadonlyMap<string, readonly Row[]>;
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });

/** These are the selected native DAL equality/OR selectors, after ordinary
 * query compilation authenticates fields and bounds. No storage predicate,
 * SQL evaluator, manager or alternate read lifetime is introduced here. */
function matchesSelectors(row: Row, selectors: JsonObject): boolean {
  return Object.entries(selectors).every(([name, value]) => name === "$or"
    ? Array.isArray(value) && value.some(branch => isJsonObject(branch) && matchesSelectors(row, branch))
    : name === "$and" ? Array.isArray(value) && value.every(branch => isJsonObject(branch) && matchesSelectors(row, branch))
      : Array.isArray(value) ? value.some(member => row[name] !== undefined && jsonEqual(row[name], member))
        : row[name] !== undefined && value !== undefined && jsonEqual(row[name], value));
}

/** Decode actual storage observations before selecting active native cohorts.
 * Valid deleted or unrelated support rows remain observations, not candidates. */
export function captureOrderFinanceReadRows(prepared: Prepared, observations: Parameters<LogicalCallReceiptValidation>[1]["observedRows"]) {
  return Result.gen(function* () {
    const groups = new Map<string, Map<string, Row>>();
    for (const observation of observations) {
      const contract = yield* prepared.contracts.entity(observation.table);
      const row = yield* contract.complete(projectNativeRow(observation.row));
      if (typeof row.id !== "string") return yield* Result.fail(mismatch("identity"));
      const group = groups.get(observation.table) ?? new Map<string, Row>(), prior = group.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Result.fail(mismatch("inconsistent-read"));
      group.set(row.id, { ...row, id: row.id }); groups.set(observation.table, group);
    }
    return new Map([...groups].map(([table, group]) => [table, [...group.values()]]));
  });
}

/** Derive the exact DAL read closure over already authenticated row bodies.
 * Shared Medusa projection/grouping and the native version-selection owner are
 * reused. The call owner still authenticates the actual core read receipts. */
export function selectOrderFinanceReceiptRows(prepared: Prepared, state: OrderFinanceRows, table: string,
  selectors: JsonObject, config: Parameters<typeof buildQuery>[1] = {}) {
  return Result.gen(function* () {
    const contract = yield* prepared.contracts.entity(table);
    const plan = yield* captureCommerceInput(buildQuery(selectors, config)).pipe(Result.flatMap(input => prepared.query(contract.table, input)));
    const reads: JsonObject[] = [], selected = new Map<string, readonly Row[]>();
    const roots = orderNativeIdRows((state.get(table) ?? []).filter(row => row.deleted_at === null && matchesSelectors(row, selectors)), {});
    if (roots.length > 4) return yield* Result.fail(mismatch("root-bound"));
    const record = (name: string, predicate: Json, rows: readonly Row[], order = "id") => {
      reads.push({ table: name, query: commerceRelationReadQuery(defaultCommerceResources, predicate, order), total: rows.length, returned: rows.length });
    };
    record(table, plan.query.predicate, roots); selected.set(table, roots);
    const filters = new Map((yield* orderFinanceVersionFilters(table, plan.paths, roots)).map(filter => [filter.path, filter.predicate]));
    const populate = (source: string, parents: readonly Row[], tree: PopulateTree, prefix = ""): Result.Result<void, ReturnType<typeof commerceError>> => Result.gen(function* () {
      for (const [name, nested] of tree) {
        const path = prefix === "" ? name : prefix + "." + name, relation = prepared.contracts.relations.get(source)?.get(name);
        if (relation === undefined || relation.join.type !== "belongsTo" && relation.join.type !== "hasMany") return yield* Result.fail(mismatch("relation"));
        const owning = relation.join.type === "belongsTo", versioned = filters.has(path);
        const population = yield* prepareCommerceRelationPopulation(owning ? relation.targetPrimaryKeys : relation.join.foreignKeys,
          parents, owning ? relation.join.foreignKeys : relation.sourcePrimaryKeys, true, false, filters.get(path));
        let children: Row[] = [];
        if (Option.isSome(population)) {
          const { column, values, predicate } = population.value;
          const reused = owning && relation.targetTable === "order_address"
            ? reusePrimaryRelationRows(selected.get(relation.targetTable), column, values) : undefined;
          children = reused ?? [...state.get(relation.targetTable) ?? []].filter(row => row.deleted_at === null && typeof row[column] === "string" &&
            values.includes(row[column]) && (!versioned || parents.some(parent => parent.id === row.order_id && parent.version === row.version)));
          if (children.length > 4) return yield* Result.fail(mismatch("relation-bound"));
          const order = plan.ordering.get(relation.targetTable) ?? "id";
          if (order === "id") children = orderNativeIdRows(children, {});
          else {
            if (order !== "ordering" || children.some(row => typeof row.ordering !== "number")) return yield* Result.fail(mismatch("relation-order"));
            children.sort((left, right) => Number(left.ordering) - Number(right.ordering));
          }
          if (reused === undefined) record(relation.targetTable, predicate, children, order);
        }
        // Native creation selects two independently authenticated Address slots.
        // Keep both read transcripts and assemble their bounded identity union.
        const previous = selected.get(relation.targetTable);
        if (previous !== undefined && relation.targetTable !== "order_address" && (previous.length !== 0 || children.length !== 0))
          return yield* Result.fail(mismatch("repeated-family"));
        const cohort = previous === undefined ? children : [...previous, ...children.filter(row => !previous.some(prior => prior.id === row.id))];
        if (cohort.length > 4) return yield* Result.fail(mismatch("relation-bound"));
        selected.set(relation.targetTable, cohort);
        yield* populate(relation.targetTable, children, nested, path);
      }
    });
    yield* populate(table, roots, toPopulateTree(plan.paths));
    const assembled = yield* assembleCommerceRelations(table, selected, plan.paths, prepared.contracts.relations);
    const rows = yield* projectRows(assembled, plan.projection.node);
    // Match the production DAL's detached native return, including JSON fields
    // subsequently mutated by genuine native financial helpers.
    return { roots, rows: structuredClone(rows), reads };
  });
}

export const validateOrderFinanceRead = (prepared: Prepared): LogicalCallReceiptValidation => Effect.fn("OrderFinance.validateRead")(function* (call, activity) {
  if (call.mode !== "read" || activity.mutations.length || activity.lifecycle.length || activity.setNull.length ||
    activity.referenceReplacements.length || call.events.length) return yield* Effect.fail(mismatch("read-effects"));
  const table = call.commandName === "orderPaymentFinanceOrders" ? "order" : call.commandName === "orderPaymentFinanceChanges" ? "order_change"
    : call.commandName === "orderPaymentFinanceTransactionsRead" ? "order_transaction" : undefined;
  if (table === undefined) return yield* Effect.fail(mismatch("read-command"));
  const input = yield* Effect.fromResult(decodeOrderFinanceRead(call.input));
  const state = yield* Effect.fromResult(captureOrderFinanceReadRows(prepared, activity.observedRows));
  const config = structuredClone(input.config ?? {}), includeTotals = table === "order" && includeOrderTotals(config);
  const selected = yield* Effect.fromResult(selectOrderFinanceReceiptRows(prepared, state, table, input.filters, config));
  const presented = yield* prepared.contracts.present(selected.rows, table);
  const native = table === "order" ? yield* Effect.try({ try: () => formatOrder(presented, { entity: Order, includeTotals }),
    catch: cause => commerceError("receiptMismatch", cause) }) : presented;
  const output = yield* Effect.fromResult(captureNativeNumericDto(native));
  const expected = table === "order_transaction" ? output : [output, selected.roots.length];
  if (!jsonEqual(activity.relationalReads, selected.reads) || !jsonEqual(call.result, expected)) return yield* Effect.fail(mismatch("read-result"));
}, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));

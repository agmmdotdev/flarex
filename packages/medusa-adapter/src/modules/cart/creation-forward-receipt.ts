import { Effect, Result } from "effect";
import { MedusaError } from "@medusajs/utils/common/errors";
import { cartCreationSnapshot, prepareCartCreationAddresses } from "@medusajs/cart/creation";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { captureGraph } from "../../write/create";
import { captureCommerceInput } from "../../value/input";
import { decodeCartCreates, decodeCartCreationResult } from "./creation-input";
import type { prepareCartCreationRepository } from "./creation-repository";
import { cartPaymentReadPolicy } from "./payment-receipt";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartCreationRepository>>;
const mismatch = () => commerceError("receiptMismatch");

/** Correlate native creation with the existing graph capture owner, checked
 * DML defaults, native ownership snapshot and the original Cart read policy.
 * Generated identities come only from the actual complete insertion cohort. */
export const validateCartCreated = Effect.fn("CartCreation.validateCreated")(function* (prepared: Prepared,
  call: Parameters<LogicalCallReceiptValidation>[0], activity: Parameters<LogicalCallReceiptValidation>[1]) {
  const input = yield* Effect.fromResult(decodeCartCreates(call.input)), result = yield* Effect.fromResult(decodeCartCreationResult(call.result));
  const inserted = new Map<string, JsonObject[]>();
  for (const [ordinal, mutation] of activity.mutations.entries()) {
    const entity = prepared.byName.get(mutation.table);
    if (entity === undefined || mutation.ordinal !== ordinal || mutation.operation !== "insert" || mutation.before !== null || mutation.after === null ||
      mutation.deletedReference !== undefined) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(entity.complete(projectNativeRow(mutation.after))), rows = inserted.get(mutation.table) ?? [];
    if (typeof row.id !== "string" || rows.some(before => before.id === row.id)) return yield* Effect.fail(mismatch());
    rows.push(row); inserted.set(mutation.table, rows);
  }
  const cartRows = inserted.get("cart") ?? [], addressRows = inserted.get("cart_address") ?? [], lineRows = inserted.get("cart_line_item") ?? [];
  if (input.length !== cartRows.length || result.carts.length !== input.length || input.length === 0 !== (result.receipt === undefined))
    return yield* Effect.fail(mismatch());
  const addressIds = new Set<string>(), cursors = new Map<string, number>();
  const nextId = (table: string) => {
    const position = cursors.get(table) ?? 0, row = inserted.get(table)?.[position]; cursors.set(table, position + 1);
    return typeof row?.id === "string" ? Result.succeed(row.id) : Result.fail(mismatch());
  };
  const cartInput: JsonObject[] = [], lineInput: JsonObject[] = [];
  for (const [index, source] of input.entries()) {
    const stored = cartRows[index], output = result.carts[index];
    if (typeof stored?.id !== "string" || output?.id !== stored.id || source.id !== undefined && source.id !== stored.id)
      return yield* Effect.fail(mismatch());
    const { items = [], ...fields } = source;
    const cart: Record<string, Json> = { ...fields, id: stored.id };
    for (const name of ["shipping_address", "billing_address"]) {
      const value = cart[name];
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const id = yield* Effect.fromResult(nextId("cart_address")); addressIds.add(id); cart[name] = { ...value, id };
      }
    }
    cartInput.push(cart);
    for (const item of items) {
      const id = yield* Effect.fromResult(nextId("cart_line_item"));
      if (item.id !== undefined && item.id !== id) return yield* Effect.fail(mismatch());
      const line: Record<string, Json> = { ...item, id, cart_id: stored.id };
      for (const [name, table] of [["tax_lines", "cart_line_item_tax_line"], ["adjustments", "cart_line_item_adjustment"]] as const) {
        const children = line[name];
        if (children === undefined) continue;
        if (!Array.isArray(children)) return yield* Effect.fail(mismatch());
        const members: JsonObject[] = [];
        for (const child of children) {
          if (child === null || typeof child !== "object" || Array.isArray(child)) return yield* Effect.fail(mismatch());
          const id = yield* Effect.fromResult(nextId(table));
          if (child.id !== undefined && child.id !== id) return yield* Effect.fail(mismatch());
          members.push({ ...child, id });
        }
        line[name] = members;
      }
      lineInput.push(line);
    }
  }
  if ((cursors.get("cart_address") ?? 0) !== addressRows.length || (cursors.get("cart_line_item") ?? 0) !== lineRows.length)
    return yield* Effect.fail(mismatch());
  const cart = prepared.entities.find(entity => entity.table.name === "cart"), line = prepared.entities.find(entity => entity.table.name === "cart_line_item");
  if (cart === undefined || line === undefined) return yield* Effect.fail(mismatch());
  const profile = (root: typeof prepared.cartNode) => ({ catalog: prepared.creationCatalog, root,
    rowLimitDetail: (maximum: number, attempted: number, tables: Readonly<Record<string, number>>) => ({ maximum, attempted, tables }) });
  const first = yield* captureGraph(profile(prepared.cartNode), yield* prepared.normalize(cartInput, cart));
  const second = yield* captureGraph(profile(prepared.lineNode), yield* prepared.normalize(lineInput, line));
  const expected: Array<{ table: string; row: JsonObject }> = [];
  for (const graph of [first, second]) for (const entity of prepared.creationCatalog.entities) for (const row of graph.rows.get(entity.table.name) ?? [])
    expected.push({ table: entity.table.name, row });
  const receipt = result.receipt;
  if (receipt !== undefined) {
    const snapshot = yield* Effect.try({ try: () => cartCreationSnapshot(result.carts, prepareCartCreationAddresses(input)), catch: cause => cause })
      .pipe(Effect.catch(cause => cause instanceof MedusaError ? Effect.fail(commerceError("receiptMismatch", cause)) : Effect.die(cause)));
    if (!jsonEqual(snapshot.addresses, [...addressIds])) return yield* Effect.fail(mismatch());
    expected.push({ table: "cart_creation_operation", row: { id: receipt.operation_id, ...snapshot, state: "applied" } },
      ...snapshot.carts.map(cart => ({ table: "cart_creation_cart", row: { id: cart.id, operation_id: receipt.operation_id, cart_id: cart.id } })),
      ...snapshot.addresses.map(id => ({ table: "cart_creation_address", row: { id, operation_id: receipt.operation_id, address_id: id } })));
  }
  if (expected.length !== activity.mutations.length) return yield* Effect.fail(mismatch());
  const written = new Map<string, JsonObject>();
  for (const [index, next] of expected.entries()) {
    const mutation = activity.mutations[index], contract = prepared.byName.get(next.table);
    if (mutation?.table !== next.table || mutation.after === null || mutation.after === undefined || contract === undefined)
      return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(contract.complete(projectNativeRow(mutation.after)));
    if (row.created_at !== row.updated_at || row.deleted_at !== null) return yield* Effect.fail(mismatch());
    for (const column of contract.table.columns) {
      if (["created_at", "updated_at", "deleted_at"].includes(column.name)) continue;
      const value = next.row[column.name] ?? column.defaultValue ?? (column.nullable ? null : undefined);
      const actual = row[column.name];
      if (value === undefined || actual === undefined || !jsonEqual(actual, value)) return yield* Effect.fail(mismatch());
    }
    written.set(next.table + ":" + row.id, row);
  }
  for (const observation of activity.observedRows) {
    const contract = prepared.byName.get(observation.table);
    if (contract === undefined) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(contract.complete(projectNativeRow(observation.row))), persisted = written.get(observation.table + ":" + row.id);
    if (persisted === undefined ? observation.table !== "cart_address" || !cartRows.some(cart => cart.shipping_address_id === row.id || cart.billing_address_id === row.id) :
      !jsonEqual(persisted, row)) return yield* Effect.fail(mismatch());
  }
  const observedKeys = new Set(activity.observedRows.map(observation => observation.table + ":" + observation.row.id));
  if ([...written.keys()].some(key => !observedKeys.has(key))) return yield* Effect.fail(mismatch());
  const reads = [...activity.relationalReads];
  if (result.receipt !== undefined) {
    const operation = prepared.ownership.protocol.find(entity => entity.name === "cart_creation_operation");
    if (operation === undefined) return yield* Effect.fail(mismatch());
    const query = yield* Effect.fromResult(captureCommerceInput(buildQuery({ id: result.receipt.operation_id }, { take: 2, withDeleted: true }))
      .pipe(Result.flatMap(operation.scalar.query), Result.flatMap(plan => captureCommerceInput(plan.query))));
    if (!jsonEqual(reads.pop() ?? null, { table: operation.name, query, total: 1, returned: 1 })) return yield* Effect.fail(mismatch());
  }
  const publicRows: Array<JsonObject & { readonly id: string }> = [];
  for (const row of result.carts) { if (typeof row.id !== "string") return yield* Effect.fail(mismatch()); publicRows.push({ ...row, id: row.id }); }
  yield* cartPaymentReadPolicy(prepared, "creation").validateLogicalCall({ ...call, commandName: "cartListForCreation", mode: "read", events: [],
    input: { filters: { id: cartRows.map(row => row.id!) }, config: { relations: ["shipping_address", "billing_address"] } }, result: orderNativeIdRows(publicRows, {}) },
    { ...activity, mutations: [], relationalReads: reads, observedRows: activity.observedRows.filter(row => row.table === "cart" || row.table === "cart_address") });
  return expected;
});

import { Effect, Result, Schema } from "effect";
import type { CartCreationCompensation } from "@medusajs/types/cart/creation";
import type { DAL } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/utils/common/errors";
import { CartCreationStore } from "@medusajs/cart/creation";
import { jsonEqual } from "flarex-protocol/json";
import { CommerceTransactionError, commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import type { prepareCartCreationRepository } from "./creation-repository";
import { decodeCartCreationReceipt } from "./creation-input";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartCreationRepository>>;
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const mismatch = () => commerceError("receiptMismatch");
// Native proof repositories have a Promise/throw contract. Convert exactly
// their checked receipt failures here; unexpected native exceptions stay defects.
const nativeProofValue = <Value>(result: Result.Result<Value, CommerceTransactionError>): Value => Result.match(result, {
  onSuccess: value => value, onFailure: error => { throw error; },
});
const selection = commerceDecoder(Schema.Struct({ where: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  options: Schema.JsonObject }), "receiptMismatch");
const update = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.Struct({ state: Schema.Literal("compensated") }) }))
  .check(Schema.isLengthBetween(1, 1)), "receiptMismatch");

/** Re-execute only the native ownership decision owner over already captured
 * immutable evidence. Proof ports hold no manager, storage or event authority.
 * Existing physical-graph correlation authenticates each real delete subtrace. */
export const validateCartCreationInverse = Effect.fn("CartCreation.validateNativeInverse")(function* (prepared: Prepared,
  call: Parameters<LogicalCallReceiptValidation>[0], activity: Activity): Effect.fn.Return<CartCreationCompensation, CommerceTransactionError> {
  const handle = yield* Effect.fromResult(decodeCartCreationReceipt(call.input));
  const state = new Map<string, Map<string, JsonObject>>(), accessed = new Set<string>();
  const decode = (table: string, value: JsonObject) => Result.gen(function* () {
    const entity = prepared.byName.get(table);
    if (entity === undefined) return yield* Result.fail(mismatch());
    const row = yield* entity.complete(projectNativeRow(value));
    if (typeof row.id !== "string") return yield* Result.fail(mismatch());
    const result: JsonObject & { readonly id: string } = { ...row, id: row.id };
    return result;
  });
  for (const observation of activity.observedRows) {
    const row = yield* Effect.fromResult(decode(observation.table, observation.row));
    const group = state.get(observation.table) ?? new Map<string, JsonObject>(), previous = group.get(row.id);
    if (previous !== undefined && !jsonEqual(previous, row)) return yield* Effect.fail(mismatch());
    group.set(row.id, row); state.set(observation.table, group);
  }
  for (const [ordinal, mutation] of activity.mutations.entries()) if (mutation.ordinal !== ordinal || mutation.deletedReference !== undefined ||
    mutation.operation !== "delete" && !(mutation.operation === "patch" && mutation.table === "cart_creation_operation"))
    return yield* Effect.fail(mismatch());
  for (const mutation of [...activity.mutations].reverse()) {
    if (mutation.before === null) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(decode(mutation.table, mutation.before)), group = state.get(mutation.table) ?? new Map<string, JsonObject>();
    group.set(row.id, row); state.set(mutation.table, group);
  }
  let readCursor = 0, mutationCursor = 0;
  const acceptRead = (table: string, query: JsonObject, rows: readonly JsonObject[]) => {
    const actual = activity.relationalReads[readCursor++];
    if (!jsonEqual(actual ?? null, { table, query, total: rows.length, returned: rows.length })) throw mismatch();
    for (const row of rows) if (typeof row.id === "string") accessed.add(table + ":" + row.id);
  };
  const selectRows = (table: string, key: string, ids: readonly string[]) => {
    const rows: Array<JsonObject & { readonly id: string }> = [];
    for (const row of state.get(table)?.values() ?? []) if (typeof row.id === "string" && typeof row[key] === "string" && ids.includes(row[key])) rows.push({ ...row, id: row.id });
    return orderNativeIdRows(rows, {});
  };
  const selected = (table: string, key: string, ids: readonly string[]) => {
    const rows = selectRows(table, key, ids);
    acceptRead(table, commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: key, values: ids }), rows);
    return rows;
  };
  const serialize: DAL.RepositoryService["serialize"] = async <Output extends object | object[]>(input: unknown): Promise<Output> => {
    const value = nativeProofValue(captureCommerceInput(input));
    // SAFETY: this proof-only generic serializes complete captured selections;
    // it never issues a row, manager, callback or runtime repository capability.
    return value as Output;
  };
  const repository = (table: typeof prepared.ownership.protocol[number]) => ({
    find: async (input: unknown) => {
      const native = nativeProofValue(captureCommerceInput(input)), envelope = nativeProofValue(selection(native));
      const plan = nativeProofValue(table.scalar.query(native));
      if (Object.keys(envelope.where).length !== 1 || !Object.hasOwn(envelope.where, table.key)) throw mismatch();
      const value = envelope.where[table.key], ids = typeof value === "string" ? [value] : value;
      if (ids === undefined) throw mismatch();
      const rows = selectRows(table.name, table.key, ids);
      const query = nativeProofValue(captureCommerceInput(plan.query));
      if (!isJsonObject(query)) throw mismatch();
      acceptRead(table.name, query, rows); return structuredClone(rows);
    }, serialize,
    create: async () => { throw mismatch(); },
    update: async (input: unknown) => {
      if (table.name !== "cart_creation_operation") throw mismatch();
      const [pair] = nativeProofValue(captureCommerceInput(input).pipe(Result.flatMap(update))), mutation = activity.mutations[mutationCursor++];
      if (pair === undefined || mutation === undefined || mutation.before === null || mutation.after === null ||
        mutation.operation !== "patch" || mutation.table !== table.name) throw mismatch();
      const before = nativeProofValue(decode(table.name, mutation.before)), after = nativeProofValue(decode(table.name, mutation.after));
      const previous = state.get(table.name)?.get(before.id);
      const { updated_at: _beforeUpdated, ...retained } = before, { updated_at: _afterUpdated, ...current } = after;
      if (previous === undefined || !jsonEqual(previous, before) || !jsonEqual(pair.entity, before) || before.state !== "applied" ||
        !jsonEqual(current, { ...retained, state: "compensated" })) throw mismatch();
      state.get(table.name)?.set(before.id, after); return [after];
    },
  });
  const getRepository = (name: string) => {
    const table = prepared.ownership.protocol.find(table => table.name === name);
    if (table === undefined) throw mismatch(); return repository(table);
  };
  const remove = async (rootName: "cart" | "cart_address", ids: string[]) => {
    const root = prepared.metadata.tables.find(table => table.name === rootName);
    if (root === undefined) throw mismatch();
    const closure = new Set<string>([rootName]);
    let previous = -1;
    while (previous !== closure.size) {
      previous = closure.size;
      for (const table of prepared.metadata.tables) if (table.foreignKeys.some(key => key.onDelete === "cascade" && closure.has(key.referencedTable))) closure.add(table.name);
    }
    let end = mutationCursor;
    while (activity.mutations[end]?.operation === "delete" && closure.has(activity.mutations[end]!.table)) end++;
    const mutations = activity.mutations.slice(mutationCursor, end).map((mutation, ordinal) => ({ ...mutation, ordinal }));
    const tokens = new Set(mutations.flatMap(mutation => typeof mutation.before?.id === "string" ? [mutation.table + ":" + mutation.before.id] : []));
    const observations = activity.observedRows.filter(observation => typeof observation.row.id === "string" && tokens.has(observation.table + ":" + observation.row.id));
    let consumed: number | undefined;
    for (let length = 0; length <= activity.relationalReads.length - readCursor; length++) {
      const result = correlatePhysicalGraphReceipt({ tables: prepared.metadata.tables, entities: [...prepared.byName.values()].map(entity => ({ table: entity.table,
        maximum: 8, decodeRow: entity.complete })), root, requestedIds: ids,
        activity: { ...activity, mutations, observedRows: observations, relationalReads: activity.relationalReads.slice(readCursor, readCursor + length),
          lifecycle: [], setNull: [], referenceReplacements: [] } });
      if (Result.isSuccess(result)) { if (!jsonEqual(result.success, ids)) throw mismatch(); consumed = length; break; }
    }
    if (consumed === undefined) throw mismatch();
    readCursor += consumed; mutationCursor = end;
    for (const mutation of mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string") throw mismatch();
      const before = nativeProofValue(decode(mutation.table, mutation.before)), current = state.get(mutation.table)?.get(before.id);
      if (current === undefined || !jsonEqual(current, before)) throw mismatch();
      state.get(mutation.table)?.delete(before.id); accessed.add(mutation.table + ":" + before.id);
    }
    return ids;
  };
  const store = new CartCreationStore({ operations: getRepository("cart_creation_operation"), carts: getRepository("cart_creation_cart"), addresses: getRepository("cart_creation_address"), reads: {
    require: async () => undefined,
    lockOperation: async id => { selected("cart_creation_operation", "id", [id]); },
    lockCarts: async ids => selected("cart", "id", ids).map(row => ({ id: row.id, shipping_address_id: row.shipping_address_id, billing_address_id: row.billing_address_id })),
    lockAddresses: async ids => selected("cart_address", "id", ids).map(row => ({ id: row.id })),
    references: async ids => {
      const selectedRows: Array<JsonObject & { readonly id: string }> = [];
      for (const row of state.get("cart")?.values() ?? []) if (typeof row.id === "string" &&
        (typeof row.shipping_address_id === "string" && ids.includes(row.shipping_address_id) || typeof row.billing_address_id === "string" && ids.includes(row.billing_address_id)))
        selectedRows.push({ ...row, id: row.id });
      const rows = orderNativeIdRows(selectedRows, {});
      acceptRead("cart", commerceRelationReadQuery(defaultCommerceResources, { kind: "or", children: [
        { kind: "in", column: "shipping_address_id", values: ids }, { kind: "in", column: "billing_address_id", values: ids },
      ] }), rows);
      return rows.map(row => ({ id: row.id, shipping_address_id: row.shipping_address_id, billing_address_id: row.billing_address_id }));
    },
  } });
  // The marker only satisfies the native pure proof precondition. It is never
  // an executable manager and no proof callback can cross into persistence.
  const outcome = yield* Effect.tryPromise({ try: () => store.compensate(handle, { transactionManager: Object.freeze({}) }, {
    carts: ids => remove("cart", ids), addresses: ids => remove("cart_address", ids),
  }), catch: cause => cause }).pipe(Effect.catch(cause => cause instanceof MedusaError || cause instanceof CommerceTransactionError && cause.reason === "receiptMismatch"
    ? Effect.fail(commerceError("receiptMismatch", cause)) : Effect.die(cause)));
  if (readCursor !== activity.relationalReads.length || mutationCursor !== activity.mutations.length || !jsonEqual(call.result, yield* Effect.fromResult(captureCommerceInput(outcome))))
    return yield* Effect.fail(mismatch());
  for (const observation of activity.observedRows) if (typeof observation.row.id !== "string" || !accessed.has(observation.table + ":" + observation.row.id))
    return yield* Effect.fail(mismatch());
  return outcome;
});

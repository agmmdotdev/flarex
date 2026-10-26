import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type Json, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { captureNativeRecord } from "../../value/native-record";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { medusaLifecycle } from "../../repository/lifecycle";
import { readCommerceRelationRows, populateCommerceRelations } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { compileOrderFinanceContracts } from "./finance-contracts";
import { prepareOrderFinanceQuery, orderFinanceVersionFilters } from "./finance-query";
import type { captureOrderMetadata } from "./schema";

const decodeBatch = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodeId = commerceDecoder(Schema.String.check(Schema.isLengthBetween(1, 256)), "unsupportedProfile");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Schema.String }))
  .check(Schema.isMaxLength(4)) }), "unsupportedProfile");
const decodeNormalized = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodePair = commerceDecoder(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }), "unsupportedProfile");
const decodeOutput = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]), "storedCorruption");
const bundleRows = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4));
const decodeChangeResult = commerceDecoder(Schema.Struct({ items: bundleRows, shipping_methods: bundleRows,
  credit_lines: bundleRows }), "storedCorruption");

// This finite closure grants only writes made by genuine transaction and
// CREDIT_LINE_ADD methods. Other selected families are read-only for totals.
const assignments = new Map<string, readonly string[]>([
  ["order", ["version"]], ["order_summary", ["totals"]],
  ["order_change", ["status", "confirmed_at", "confirmed_by"]], ["order_change_action", ["applied"]],
]);
const creations = new Map<string, readonly string[]>([
  ["order_transaction", ["order_id", "version", "amount", "currency_code", "reference", "reference_id"]],
  ["order_change", ["order_id", "version", "change_type", "created_by"]],
  ["order_change_action", ["order_change_id", "order_id", "version", "action", "amount", "reference", "reference_id", "details"]],
  ["order_line_item_adjustment", ["item_id", "version", "amount", "description", "promotion_id", "code", "is_tax_inclusive"]],
]);
const versioned = new Set(["order_summary", "order_item", "order_shipping", "order_credit_line"]);
const versionedInputs = new Map<string, readonly string[]>([
  ["order_summary", ["id", "order_id", "version", "totals"]],
  ["order_item", ["id", "item_id", "order_id", "version", "quantity", "unit_price", "compare_at_unit_price", "fulfilled_quantity",
    "delivered_quantity", "shipped_quantity", "return_requested_quantity", "return_received_quantity", "return_dismissed_quantity", "written_off_quantity", "metadata"]],
  ["order_shipping", ["id", "order_id", "version", "shipping_method_id", "return_id", "exchange_id", "claim_id", "created_at", "updated_at", "deleted_at"]],
  ["order_credit_line", ["id", "order_id", "version", "reference", "reference_id", "amount", "metadata"]],
]);

/** Financial DAL translation, sharing scalar creation, checked relation reads,
 * one borrowed manager and native event subscription. Native Order methods
 * retain arithmetic, action application, versioning and compensation. */
export function prepareOrderFinanceRepository(metadata: Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderFinanceContracts(metadata);
    const { query } = prepareOrderFinanceQuery(contracts.catalog, contracts.entities.map(entity => entity.table));
    const createDecoders = new Map([...creations].map(([table, names]) => [table, commerceRowDecoder(names, "unsupportedProfile")]));
    const patchDecoders = new Map([...assignments].map(([table, names]) => [table, commerceRowDecoder(["id", ...names], "unsupportedProfile")]));
    const upsertDecoders = new Map([...versionedInputs].map(([table, names]) => [table, commerceRowDecoder(names, "unsupportedProfile")]));
    type Entity = typeof contracts.entities[number];
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const first = contracts.entities[0];
      if (first === undefined) throw new Error("Missing compiled financial Order");
      const primary = first.scalar.bind(root, owner), { bridge, events } = primary;
      const denied = deniedCommerceRepository(primary.repository, primary.refuse);
      const originals = new Map<string, JsonObject>();
      const origins = new WeakMap<object, string>(), presented = new WeakSet<object>();
      const remember = (table: string, rows: readonly JsonObject[]) => {
        for (const row of rows) {
          if (typeof row.id === "string") originals.set(table + ":" + row.id, row);
        }
      };
      const checkedRows = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        const entity = yield* contracts.entity(table);
        if (rows.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
        for (const value of rows) yield* entity.complete(projectNativeRow(value));
      });
      const readContext = (ctx: CommerceCommandContext) => ({ ...ctx, admitSelection: checkedRows });
      const returned = (table: string, rows: readonly JsonObject[]) => {
        const values = structuredClone([...rows]); origins.set(values, table);
        for (const row of values) origins.set(row, table);
        return values;
      };
      const present = Effect.fn("OrderFinance.present")(function* (input: Json, table: string): Effect.fn.Return<Json, CommerceTransactionError> {
        const output = yield* contracts.present(input, table);
        // Native formatOrder retains its root row identities through its
        // second serialization. Nested DTOs receive no independent authority.
        for (const row of Array.isArray(output) ? output : [output]) {
          if (!isJsonObject(row)) return yield* root.refuse(commerceError("storedCorruption"));
          origins.set(row, table); presented.add(row);
        }
        if (output !== null && typeof output === "object") { origins.set(output, table); presented.add(output); }
        return output;
      });
      const find = Effect.fn("OrderFinance.find")(function* (ctx: CommerceCommandContext, entity: Entity, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const plan = yield* Effect.fromResult(query(entity.table, captured));
        const rows = yield* readCommerceRelationRows(readContext(ctx), entity.table.name, plan.query.predicate);
        remember(entity.table.name, rows);
        const versionFilters = yield* Effect.fromResult(orderFinanceVersionFilters(entity.table.name, plan.paths, rows));
        const populated = yield* populateCommerceRelations(readContext(ctx), entity.table.name, rows, plan.paths,
          contracts.relations, plan.ordering, false, versionFilters);
        return { rows: returned(entity.table.name, yield* Effect.fromResult(projectRows(populated, plan.projection.node))), count: rows.length };
      });
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          // Strict capture retains immutable JSON; native Order accounting mutates
          // nested Summary totals. Detach the validated DTO before presentation,
          // leaving stored observations and receipt preimages immutable.
          const value = structuredClone(yield* Effect.fromResult(captureNativeNumericDto(input, root.resources).pipe(Result.flatMap(decodeOutput))));
          const roots = Array.isArray(input) ? input : [input];
          const table = input !== null && typeof input === "object" ? origins.get(input) ??
            (roots[0] !== null && typeof roots[0] === "object" ? origins.get(roots[0]) : undefined) : undefined;
          if (table === undefined) {
            // Native confirmation serializes a named mutation bundle, rather
            // than one entity family. Its three fields each have a checked
            // model contract; this grants no arbitrary untracked DTO shape.
            const bundle = yield* Effect.fromResult(decodeChangeResult(value));
            const result = { items: yield* present(bundle.items, "order_item"),
              shipping_methods: yield* present(bundle.shipping_methods, "order_shipping"),
              credit_lines: yield* present(bundle.credit_lines, "order_credit_line") };
            // SAFETY: the exact native OrderChangeReturn fields are decoded
            // above and each family uses its checked metadata presentation.
            return result as Output;
          }
          const alreadyPresented = roots.every(row => row !== null && typeof row === "object" && presented.has(row));
          // Native formatOrder has already formatted and decorated its selected
          // DTO. Every persistence selection was checked before native code;
          // the command's result receipt authenticates its exact final shape.
          const result = alreadyPresented ? value : yield* present(value, table);
          // SAFETY: native DAL's DTO generic also represents selected partial
          // projections. Checked DML and numeric codecs validate fresh values;
          // the logical receipt binds the native formatted second serialization.
          return result as Output;
        })));
      const repositories = new Map<string, DAL.RepositoryService>();
      for (const entity of contracts.entities) {
        const name = entity.table.name, scalar = entity === first ? primary : entity.scalar.bind(root, owner, events, bridge);
        const normalize = (ctx: CommerceCommandContext, input: unknown, retainedRaw = false) =>
          contracts.normalize(input, name, ctx.resources, retainedRaw);
        const create = Effect.fn("OrderFinance.create")(function* (ctx: CommerceCommandContext, input: unknown,
          shared: Parameters<DAL.RepositoryService["create"]>[1]) {
          const decode = createDecoders.get(name);
          if (decode === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const rows: JsonObject[] = [];
          for (const value of yield* Effect.fromResult(decodeBatch(input))) {
            const normalized = yield* Effect.fromResult(decodeNormalized(value)), fields = { ...normalized };
            for (const number of entity.numbers) delete fields["raw_" + number.name];
            yield* Effect.fromResult(decode(fields)); rows.push(normalized);
          }
          const rowsCreated = yield* scalar.createRows(ctx, rows, shared);
          yield* Effect.fromResult(checkedRows(name, rowsCreated)); remember(name, rowsCreated);
          const nativeCreated = rowsCreated.map(row => ({ ...row }));
          fillEmptyToManyRelations(nativeCreated, entity.creationRelations);
          return returned(name, nativeCreated);
        });
        const update = Effect.fn("OrderFinance.update")(function* (ctx: CommerceCommandContext, input: unknown,
          shared: Parameters<DAL.RepositoryService["update"]>[1]) {
          const decode = patchDecoders.get(name);
          if (decode === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const patches: JsonObject[] = [];
          for (const value of yield* Effect.fromResult(decodeBatch(input))) {
            const pair = yield* Effect.fromResult(decodePair(value));
            const before = yield* Effect.fromResult(entity.complete(pair.entity));
            const id = yield* Effect.fromResult(decodeId(before.id)), observed = originals.get(name + ":" + id);
            if (observed === undefined || !jsonEqual(observed, before)) return yield* ctx.refuse(commerceError("storedCorruption"));
            let submitted = pair.update;
            if (name === "order_summary") {
              // The native accounting method submits its complete selected
              // Summary DTO. Stable fields must equal its fresh DAL preimage;
              // only totals are financial assignments, while storage owns time.
              yield* Effect.fromResult(entity.projection(submitted));
              for (const [key, value] of Object.entries(submitted)) if (key !== "totals" &&
                (before[key] === undefined || !jsonEqual(before[key], value)))
                return yield* ctx.refuse(commerceError("storedCorruption"));
              submitted = { id, ...(submitted.totals === undefined ? {} : { totals: submitted.totals }) };
            }
            const patch = yield* Effect.fromResult(decode(submitted));
            if (patch.id !== undefined && patch.id !== id) return yield* ctx.refuse(commerceError("storedCorruption"));
            patches.push({ ...patch, id });
          }
          const written = patches.length ? yield* (yield* ctx.table(name)).write(ctx.manager, "update", patches) : [];
          yield* Effect.fromResult(checkedRows(name, written));
          if (written.length !== patches.length) return yield* ctx.refuse(commerceError("storedCorruption"));
          if (written.length) {
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", entity.model, [...written], shared);
          }
          remember(name, written); return returned(name, written);
        });
        const upsert = Effect.fn("OrderFinance.upsertVersioned")(function* (ctx: CommerceCommandContext, input: unknown,
          shared: Parameters<DAL.RepositoryService["upsert"]>[1]) {
          const decode = upsertDecoders.get(name);
          if (decode === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const output: JsonObject[] = [];
          for (const value of yield* Effect.fromResult(decodeBatch(input))) {
            const normalized = yield* Effect.fromResult(decodeNormalized(value)), submitted = { ...normalized };
            for (const number of entity.numbers) delete submitted["raw_" + number.name];
            yield* Effect.fromResult(decode(submitted));
            const id = normalized.id === undefined ? generateEntityId(undefined, entity.table.columns.find(column => column.primaryKey)?.options?.prefix)
              : yield* Effect.fromResult(decodeId(normalized.id));
            const store = yield* ctx.table(name);
            const before = normalized.id === undefined ? [] : yield* readCommerceRelationRows(readContext(ctx), name,
              { kind: "in", column: "id", values: [id] });
            if (before.length > 1) return yield* ctx.refuse(commerceError("storedCorruption"));
            const previous = before[0];
            // Native version creation copies shipping timestamps into a fresh
            // identity. Existing rows instead retain the checked merge policy.
            // Insert's own identity/dependency checks reject concurrent occupancy.
            const written = yield* store.write(ctx.manager, previous === undefined ? "insert" : "upsertPreservingDeletion", [{ ...normalized, id }]);
            yield* Effect.fromResult(checkedRows(name, written));
            if (written.length !== 1 || shared === undefined || !events.isSubscribed(shared))
              return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows(previous === undefined ? "afterCreate" : "afterUpdate", entity.model, [...written], shared,
              previous === undefined ? undefined : row => ({ entity: row, originalEntity: previous }));
            output.push(...written);
          }
          remember(name, output); return returned(name, output);
        });
        const softDelete: DAL.RepositoryService["softDelete"] = (input, shared) => bridge.executeInput(shared, input, (ctx, captured) =>
          bridge.checked(ctx, Effect.gen(function* () {
            if (!versioned.has(name)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            const values = Array.isArray(captured) ? captured : [captured], ids: string[] = [];
            if (values.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const value of values) ids.push(yield* Effect.fromResult(decodeId(value)));
            const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "softDelete");
            const roots = yield* lifecycle.roots(entity.table, ids), plan = yield* lifecycle.plan(entity.table, roots);
            const changed = yield* plan.apply();
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.cascades(changed.cascades, shared, row => ({ entity: row, originalEntity: { deleted_at: null } }));
            return [changed.roots, changed.cascades] satisfies [JsonObject[], Record<string, unknown[]>];
          })));
        const remove: DAL.RepositoryService["delete"] = (input, shared) => bridge.executeInput(shared, input, (ctx, captured) =>
          bridge.checked(ctx, Effect.gen(function* () {
            if (!["order_transaction", "order_change", "order_change_action"].includes(name)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            const selection = yield* Effect.fromResult(decodeDelete(captured));
            const rows = yield* (yield* ctx.table(name)).delete(ctx.manager, selection.$or);
            yield* Effect.fromResult(checkedRows(name, rows));
            const ids: string[] = [];
            for (const row of rows) ids.push(yield* Effect.fromResult(decodeId(row.id)));
            return ids;
          })));
        // Capture native quantities and dates before the core charges and queues
        // each complete DAL call. All storage work stays inside its existing FIFO.
        const normalizeRows = Effect.fn("OrderFinance.captureRows")(function* (ctx: CommerceCommandContext, input: unknown, retainedRaw: boolean) {
          const rows: JsonObject[] = [];
          for (const value of yield* Effect.fromResult(decodeBatch(input))) rows.push(yield* normalize(ctx, value, retainedRaw));
          return rows;
        });
        const normalizeUpdates = Effect.fn("OrderFinance.captureUpdates")(function* (ctx: CommerceCommandContext, input: unknown) {
          const pairs: JsonObject[] = [];
          for (const value of yield* Effect.fromResult(decodeBatch(input))) {
            const captured = yield* captureNativeRecord(value), normalized = yield* normalize(ctx, captured.update);
            pairs.push(yield* Effect.fromResult(captureCommerceInput({ entity: captured.entity, update: normalized }, ctx.resources)
              .pipe(Result.flatMap(decodePair))));
          }
          return pairs;
        });
        const repository: DAL.RepositoryService = { ...denied, serialize,
          find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, entity, captured)).pipe(Effect.map(value => value.rows))),
          findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, entity, captured)).pipe(
            Effect.map(value => [value.rows, value.count] satisfies [JsonObject[], number]))),
          create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, create(ctx, captured, shared)),
            (ctx, value) => normalizeRows(ctx, value, false)),
          update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, update(ctx, captured, shared)), normalizeUpdates),
          delete: remove, softDelete,
          upsert: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, upsert(ctx, captured, shared)),
            (ctx, value) => normalizeRows(ctx, value, true)),
        };
        repositories.set(entity.model, repository);
      }
      return { bridge, mutationEvents: primary.mutationEvents, refuse: primary.refuse, denied, serialize,
        repository: (model: { readonly name: string }) => repositories.get(model.name) ?? denied };
    };
    return { bind, contracts, query, versioned };
  });
}

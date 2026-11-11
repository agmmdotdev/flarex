import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { projectNativeRow } from "../../repository/result";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { medusaLifecycle } from "../../repository/lifecycle";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { executeRead } from "../../query/read";
import { replaceGraphRows } from "../../write/replace";
import type { GraphCatalog, ReplacementProfile } from "../../write/graph-model";
import { CartMutationIds } from "./mutation-input";
import { CartMutationTaxLines } from "./mutation-input";
import { bindCommerceRelationRows } from "../../query/relations";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import type { prepareCartCreationRefreshRepository } from "./refresh-repository";

type Refresh = Result.Result.Success<ReturnType<typeof prepareCartCreationRefreshRepository>>;
const envelope = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.JsonObject }), "unsupportedProfile");
const pairs = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)));
const decodeId = commerceDecoder(ScalarId, "storedCorruption");
const decodeIds = commerceDecoder(CartMutationIds, "unsupportedProfile");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: ScalarId })).check(Schema.isMaxLength(4)) }), "unsupportedProfile");
const text = commerceDecoder(Schema.Union([ScalarId, CartMutationIds]), "unsupportedProfile");
const normalized = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const quantity = commerceDecoder(Schema.FiniteFromString, "invalidInput");
const taxInputs = commerceDecoder(CartMutationTaxLines, "unsupportedProfile");
const emptyTax = commerceDecoder(Schema.Array(Schema.Never).check(Schema.isMaxLength(0)), "unsupportedProfile");
const where: WherePolicy = { ...scalarIdWhere, fields: new Map([...scalarIdWhere.fields,
  ["cart_id", { column: "cart_id", decode: text }], ["variant_id", { column: "variant_id", decode: text }],
  ["is_custom_price", { column: "is_custom_price", decode: commerceDecoder(Schema.Boolean, "unsupportedProfile") }]]) };

/** The native arithmetic seam carries exact decimal strings between steps;
 * this declared DML number column uses its finite numeric storage contract. */
export const captureCartMutationLine = Effect.fn("CartMutation.captureLine")(function* (input: unknown,
  numbers: Parameters<typeof captureExactNumericRow>[1]) {
  const row = yield* captureNativeRecord(input);
  if (typeof row.quantity === "string") row.quantity = yield* Effect.fromResult(quantity(row.quantity));
  return yield* captureExactNumericRow(row, numbers, false, "nativeRaw");
});

/** Add selected native DAL mutation contracts to the existing genuine Cart
 * constructor, read serializer, creation and Tax/Adjustment repositories. */
export function prepareCartMutationRepository(refresh: Refresh) {
  return Result.gen(function* () {
    const cart = refresh.entities.find(entity => entity.table.name === "cart"),
      address = refresh.entities.find(entity => entity.table.name === "cart_address"),
      line = refresh.entities.find(entity => entity.table.name === "cart_line_item");
    if (cart === undefined || address === undefined || line === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const addressScalar = yield* prepareScalarRepository(address.table, address.model, scalarIdWhere);
    const query = (table: string, input: unknown) => Result.gen(function* () {
      if (table === address.table.name) return yield* addressScalar.query(input);
      if (table === cart.table.name) return yield* refresh.query(input);
      if (table !== line.table.name) return yield* Result.fail(commerceError("unsupportedProfile"));
      const captured = yield* envelope(input);
      const plan = yield* refresh.queryTable(table, { ...captured, where: {} });
      return { ...plan, query: { ...plan.query, predicate: { kind: "and" as const,
        children: [yield* compileWhere(captured.where, where), { kind: "isNull" as const, column: "deleted_at" }] } } };
    });
    const decoders = new Map(refresh.entities.map(entity => [entity.table.name,
      commerceRowDecoder([...entity.table.columns.filter(column => !["created_at", "updated_at", "deleted_at"].includes(column.name)).map(column => column.name),
        ...(entity === cart ? ["shipping_address", "billing_address"] : [])], "unsupportedProfile")]));
    const queryRelations = new Map(refresh.entities.map(entity => [entity.table.name, new Map(entity.table.relationships.flatMap(relation => {
      const declared = refresh.relations.get(entity.table.name)?.get(relation.name);
      return declared === undefined ? [] : [[relation.name, declared] as const];
    }))]));
    const catalog: GraphCatalog = { ...refresh.creationCatalog, queryRelations, decodeRow: (entity, input) => Result.gen(function* () {
      const decode = decoders.get(entity.table.name);
      if (decode === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const supplied = yield* normalized(yield* decode(input));
      return { supplied, key: supplied.id === undefined ? undefined : yield* decodeId(supplied.id) };
    }) };
    const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
      const entity = refresh.byName.get(table);
      if (entity === undefined || rows.length > (table === address.table.name ? 8 : 4)) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* entity.complete(projectNativeRow(row));
    });
    const profile: ReplacementProfile = { catalog, operation: "update", nativeUpdateStatements: true,
      ordering: new Map(), allowedRelations: entity => entity.table.name === cart.table.name ? ["shipping_address", "billing_address"] : [],
      ownedToOne: entity => entity.table.name === cart.table.name ? ["shipping_address", "billing_address"] : [],
      mutableForeignKeys: () => true, admitSelection: (table, rows) => admitSelection(table.name, rows),
      prepareProjection: () => Effect.void, toManyMode: () => Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: (_entity, paths) => paths,
      project: rows => Result.succeed(rows) };
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = refresh.bind(root, owner), { bridge, events } = bound;
      const originals = new Map<string, JsonObject>();
      const admitRead = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        yield* admitSelection(table, rows);
        for (const row of rows) {
          const entity = refresh.byName.get(table);
          if (entity === undefined) return yield* Result.fail(commerceError("storedCorruption"));
          const retained = yield* entity.complete(projectNativeRow(row));
          if (typeof retained.id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
          originals.set(table + ":" + retained.id, retained);
        }
      });
      const find = (table: string): DAL.RepositoryService["find"] => (input, shared) => bridge.executeInput(shared, input,
        (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const plan = yield* Effect.fromResult(query(table, captured));
          const result = yield* executeRead({ ...ctx, admitSelection: admitRead }, refresh.catalog, plan, false);
          return bound.remember(structuredClone(result.rows), table);
        })));
      const countLines: DAL.RepositoryService["findAndCount"] = (input, shared) => bridge.executeInput(shared, input,
        (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const plan = yield* Effect.fromResult(query(line.table.name, captured));
          const result = yield* executeRead({ ...ctx, admitSelection: admitRead }, refresh.catalog, plan, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [bound.remember(structuredClone(result.rows), line.table.name), result.count];
        })));
      const update = (entity: typeof cart): DAL.RepositoryService["update"] => (input, shared, options) => bridge.execute(shared,
        ctx => bridge.checked(ctx, Effect.gen(function* () {
          if (options !== undefined || shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const results: JsonObject[] = [];
          for (const value of yield* pairs(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
            const pair = yield* captureNativeRecord(value), capturedEntity = yield* captureNativeRecord(pair.entity);
            const id = yield* Effect.fromResult(decodeId(capturedEntity.id));
            const retained = Object.fromEntries(entity.table.columns.map(column => [column.name, capturedEntity[column.name]]));
            const before = yield* Effect.fromResult(entity.complete(yield* Effect.fromResult(captureCommerceInput(retained))));
            const nativePatch = entity === line ? yield* captureCartMutationLine(pair.update, entity.numbers)
              : yield* captureNativeDateRecord(pair.update, entity === cart ? ["completed_at"] : []);
            const patch = yield* Effect.fromResult(captureCommerceInput(nativePatch).pipe(Result.flatMap(normalized)));
            const original = entity === cart ? bound.originals.get(id) : originals.get(entity.table.name + ":" + id);
            if (original === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            const { metadata: originalMetadata, ...retainedFields } = original, { metadata: nativeMetadata, ...nativeFields } = before;
            if (!jsonEqual(retainedFields, nativeFields) || (nativeMetadata !== undefined && originalMetadata !== undefined &&
              !jsonEqual(nativeMetadata, originalMetadata) && (patch.metadata === undefined || !jsonEqual(nativeMetadata, patch.metadata))))
              return yield* ctx.refuse(commerceError("storedCorruption"));
            if (patch.id !== undefined && patch.id !== id) return yield* ctx.refuse(commerceError("invalidInput"));
            const target = catalog.entities.find(candidate => candidate.table.name === entity.table.name);
            if (target === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
            const paths = entity === cart ? ["shipping_address", "billing_address"].filter(name => patch[name] !== undefined) : [];
            const changed = yield* replaceGraphRows(ctx, profile, target, [{ ...patch, id }], { relations: paths });
            for (const row of changed.entities) results.push(row);
            for (const [action, event] of [["created", "afterCreate"], ["updated", "afterUpdate"]] as const)
              for (const model of [cart.model, address.model, line.model])
                yield* events.rows(event, model, (changed.performedActions[action][model] ?? []).map(row => ({ ...row })), shared);
          }
          return bound.remember(structuredClone(results), entity.table.name);
        })));
      const lifecycle = (operation: "delete" | "softDelete" | "restore", input: unknown, shared: Parameters<DAL.RepositoryService["softDelete"]>[1]) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const requested = operation === "delete" ? (yield* Effect.fromResult(decodeDelete(captured))).$or.map(row => row.id)
            : yield* Effect.fromResult(decodeIds(captured));
          const owner = medusaLifecycle(ctx, { tables: refresh.metadata.tables, entities: refresh.entities }, operation);
          const selected = yield* owner.roots(line.table, requested);
          const plan = yield* owner.plan(line.table, selected), changed = yield* plan.apply();
          for (const entity of refresh.entities) yield* Effect.fromResult(admitSelection(entity.table.name, plan.rows(entity.table)));
          const ids: string[] = [];
          for (const row of changed.roots) ids.push(yield* Effect.fromResult(decodeId(row.id)));
          if (operation === "delete") return { ids, rows: changed.roots, cascades: changed.cascades };
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          if (events.isSubscribed(shared)) {
            for (const entity of refresh.entities) {
              const rows = changed.cascades[entity.model];
              if (rows === undefined) continue;
              const before = new Map(plan.rows(entity.table).map(row => [row.id, row.deleted_at]));
              yield* events.cascades({ [entity.model]: rows }, shared, row => ({ entity: row,
                originalEntity: { deleted_at: typeof row.id === "string" ? before.get(row.id) : undefined } }));
            }
          }
          return { ids, rows: bound.remember(changed.roots, line.table.name), cascades: changed.cascades };
        })));
      const repository: DAL.RepositoryService = { ...bound.repository, update: update(cart) };
      const tax = refresh.refresh.tax;
      const upsertItemTax: DAL.RepositoryService["upsert"] = (input, shared) => bridge.executeInput(shared, input,
        (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const data = yield* Effect.fromResult(taxInputs(captured));
          const scalar = tax.scalar.bind(root, owner, events, bridge);
          const ids = data.flatMap(row => row.id === undefined ? [] : [row.id]);
          const existing = ids.length ? yield* bindCommerceRelationRows({ ...ctx, admitSelection }, { includeIdentities: true })(tax.table.name,
            { kind: "and", children: [{ kind: "in", column: "id", values: ids }, { kind: "isNull", column: "deleted_at" }] }) : [];
          const byId = new Map(existing.map(row => [row.id, row]));
          const creates = data.filter(row => row.id === undefined || !byId.has(row.id));
          const updates = data.filter(row => row.id !== undefined && byId.has(row.id));
          const inserted = creates.length ? yield* scalar.createRows(ctx, creates, shared) : [];
          const merged = new Map<string, JsonObject>();
          for (const row of updates) {
            if (row.id === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            merged.set(row.id, { ...merged.get(row.id), ...row });
          }
          const patches = [...merged.values()].filter(row => {
            const previous = byId.get(row.id);
            return previous !== undefined && hasChangedFields(previous, row, ["id"]);
          });
          const written = patches.length ? yield* (yield* ctx.table(tax.table.name)).write(ctx.manager, "update", patches) : [];
          yield* Effect.fromResult(admitSelection(tax.table.name, [...inserted, ...written]));
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", tax.model, [...written], shared);
          const latest = new Map([...existing, ...written].map(row => [row.id, row]));
          const retained: JsonObject[] = [];
          for (const row of updates) {
            const value = latest.get(row.id);
            if (value === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            retained.push(value);
          }
          return bound.remember([...inserted, ...retained], tax.table.name);
        })));
      const lineItemRepository: DAL.RepositoryService = { ...bound.lineItemRepository, find: find(line.table.name), findAndCount: countLines,
        update: update(line), delete: async (input, shared) => (await lifecycle("delete", input, shared)).ids,
        softDelete: async (input, shared) => { const changed = await lifecycle("softDelete", input, shared); return [changed.rows, changed.cascades]; },
        restore: async (input, shared) => { const changed = await lifecycle("restore", input, shared); return [changed.rows, changed.cascades]; } };
      const addressRepository: DAL.RepositoryService = { ...bound.addressRepository, find: find(address.table.name), update: update(address) };
      const lineItemTaxLineRepository: DAL.RepositoryService = { ...bound.lineItemTaxLineRepository, upsert: upsertItemTax };
      const shippingMethodTaxLineRepository: DAL.RepositoryService = { ...bound.shippingMethodTaxLineRepository, upsert: (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          yield* Effect.fromResult(emptyTax(captured));
          return bound.remember([], refresh.refresh.shippingTax.table.name);
        }))) };
      return { ...bound, repository, lineItemRepository, addressRepository, lineItemTaxLineRepository, shippingMethodTaxLineRepository };
    };
    return { ...refresh, bind, mutation: { cart, address, line, query, catalog, profile, admitSelection } };
  });
}

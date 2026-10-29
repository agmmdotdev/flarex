import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { makeReadCatalog } from "../../query/catalog";
import { projectRows } from "../../query/projection";
import { bindCommerceRelationRows, type CommerceRelation, type CommerceRelationReadContext, type CommerceRelationRows } from "../../query/relations";
import { resolveCommerceRelationFilter } from "../../query/relation-filter";
import type { Predicate, WherePolicy } from "../../query/predicate";
import { CartRefreshIds, CartEmptyShippingAdjustments } from "./refresh-input";
import type { prepareCartCreationRepository } from "./creation-repository";

type Creation = Result.Result.Success<ReturnType<typeof prepareCartCreationRepository>>;
type RefreshEntity = Pick<Creation["entities"][number], "table" | "complete" | "projection" | "numbers"> & {
  readonly model: string;
  readonly foreignKey: string;
  readonly scalar: Result.Result.Success<ReturnType<typeof prepareScalarRepository>>;
};
export type CartCreationRefreshRepository = Omit<Creation, "bind"> & {
  readonly bind: (root: CommerceCommandContext, owner: CommercePromiseOwner) => ReturnType<Creation["bind"]> & {
    readonly lineItemTaxLineRepository: DAL.RepositoryService;
    readonly shippingMethodTaxLineRepository: DAL.RepositoryService;
    readonly lineItemAdjustmentRepository: DAL.RepositoryService;
    readonly shippingMethodAdjustmentRepository: DAL.RepositoryService;
  };
  readonly refresh: {
    readonly entities: readonly RefreshEntity[];
    readonly tax: RefreshEntity;
    readonly shippingTax: RefreshEntity;
    readonly adjustment: RefreshEntity;
    readonly catalog: Creation["catalog"];
    readonly admitSelection: (table: string, rows: readonly JsonObject[]) => Result.Result<void, CommerceTransactionError>;
    readonly selectTaxRemoval: (readRows: CommerceRelationRows, input: unknown, shipping: boolean) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
    readonly selectAdjustmentLifecycle: (readRows: CommerceRelationRows, input: readonly string[], operation: "softDelete" | "restore") => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
  };
};
const ids = commerceDecoder(CartRefreshIds, "unsupportedProfile");
const rows = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "unsupportedProfile");
const normalizedRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "unsupportedProfile");
const emptyShippingAdjustments = commerceDecoder(CartEmptyShippingAdjustments, "unsupportedProfile");
const id = commerceDecoder(ScalarId, "storedCorruption");
const ParentFilter = Schema.Struct({ cart_id: ScalarId });
const taxFilter = commerceDecoder(Schema.Struct({ item: ParentFilter,
  id: Schema.optionalKey(Schema.Struct({ $nin: CartRefreshIds })) }), "unsupportedProfile");
const shippingTaxFilter = commerceDecoder(Schema.Struct({ shipping_method: ParentFilter }), "unsupportedProfile");
const active = (predicate: Predicate): Predicate => ({ kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] });
const definitions = [["cart_line_item_tax_line", "LineItemTaxLine", "item_id"],
  ["cart_shipping_method_tax_line", "ShippingMethodTaxLine", "shipping_method_id"],
  ["cart_line_item_adjustment", "LineItemAdjustment", "item_id"]] as const;

/** The complete creation profile borrows the original Cart constructor,
 * ownership store, issued-row serializer and twelve-model source. It admits
 * only the direct native creation children: new item Tax Lines, empty shipping
 * Tax replacement and item Adjustment creation/lifecycle. */
export function prepareCartCreationRefreshRepository(creation: Creation): Result.Result<CartCreationRefreshRepository, CommerceTransactionError> {
  return Result.gen(function* () {
    const entities = yield* Result.all(definitions.map(([name, model, foreignKey]) => Result.gen(function* () {
      const contract = creation.byName.get(name);
      if (contract === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const where: WherePolicy = { ...scalarIdWhere,
        decode: commerceDecoder(Schema.Union([Schema.Struct({ id: CartRefreshIds }), Schema.Struct({ [foreignKey]: CartRefreshIds })]), "unsupportedProfile"),
        fields: new Map([...scalarIdWhere.fields, [foreignKey, { column: foreignKey, decode: ids }]]) };
      return { ...contract, model, foreignKey, scalar: yield* prepareScalarRepository(contract.table, model, where) };
    })));
    const tax = entities[0], shippingTax = entities[1], adjustment = entities[2];
    if (tax === undefined || shippingTax === undefined || adjustment === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map<string, Map<string, CommerceRelation>>();
    for (const [entity, name, target] of [[tax, "item", "cart_line_item"], [shippingTax, "shipping_method", "cart_shipping_method"]] as const) {
      const declared = entity.table.relationships.find(relation => relation.name === name),
        key = entity.table.foreignKeys.find(key => key.columns.length === 1 && key.columns[0] === entity.foreignKey && key.referencedTable === target);
      if (declared?.type !== "belongsTo" || declared.targetTable !== target || key?.referencedColumns.length !== 1 || key.referencedColumns[0] !== "id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      relations.set(entity.table.name, new Map([[name, { name, sourcePrimaryKeys: ["id"], targetTable: target,
        targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: [entity.foreignKey] } }]]));
    }
    const catalog = yield* makeReadCatalog(creation.entities.map(entity => entity.table).concat(
      [shippingTax.table, creation.byName.get("cart_shipping_method")?.table].filter(value => value !== undefined))
      .map(table => ({ name: table.name, columns: table.columns.map(column => column.name), primaryKeys: ["id"],
        foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {} })), relations);
    const admitSelection = (table: string, selected: readonly JsonObject[]) => Result.gen(function* () {
      const contract = creation.byName.get(table);
      if (contract === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (selected.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of selected) yield* contract.complete(projectNativeRow(row));
    });
    const selectTaxRemoval = Effect.fn("CartCreation.selectTaxRemoval")(function* (readRows: CommerceRelationRows, input: unknown, shipping: boolean) {
      const selected = shipping ? yield* Effect.fromResult(shippingTaxFilter(input)) : yield* Effect.fromResult(taxFilter(input));
      const parent = "item" in selected ? selected.item : selected.shipping_method;
      const related = yield* resolveCommerceRelationFilter(readRows, shipping ? shippingTax.table.name : tax.table.name,
        shipping ? "shipping_method" : "item", active({ kind: "in", column: "cart_id", values: [parent.cart_id] }), catalog.relations);
      const children: Predicate[] = [related];
      if ("id" in selected && selected.id !== undefined) children.push({ kind: "postgresText", column: "id", operator: "notIn", values: selected.id.$nin });
      return yield* readRows(shipping ? shippingTax.table.name : tax.table.name, active({ kind: "and", children }));
    });
    const selectAdjustmentLifecycle = (readRows: CommerceRelationRows, input: readonly string[], operation: "softDelete" | "restore") =>
      readRows(adjustment.table.name, operation === "softDelete" ? active({ kind: "in", column: "id", values: input }) : { kind: "in", column: "id", values: input });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = creation.bind(root, owner), { bridge, events } = bound;
      const taxBound = tax.scalar.bind(root, owner, events, bridge), adjustmentBound = adjustment.scalar.bind(root, owner, events, bridge);
      const context = (ctx: CommerceCommandContext): CommerceRelationReadContext => ({ ...ctx, admitSelection });
      const readRows = (ctx: CommerceCommandContext) => bindCommerceRelationRows(context(ctx), { includeIdentities: true });
      const normalize = Effect.fn("CartCreation.captureRefreshRows")(function* (input: unknown, entity: typeof tax) {
        const normalized: JsonObject[] = [];
        for (const row of yield* Effect.fromResult(rows(input))) normalized.push(yield* captureExactNumericRow(row, entity.numbers, false, "nativeRaw"));
        return normalized;
      });
      const createRows = (entity: typeof tax, scalar: typeof taxBound, freshUpsert: boolean): DAL.RepositoryService["create"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const data = yield* Effect.fromResult(normalizedRows(captured));
          if (freshUpsert) {
            const supplied: string[] = [];
            for (const row of data) supplied.push(yield* Effect.fromResult(id(row.id)));
            const existing = yield* readRows(ctx)(entity.table.name, active({ kind: "in", column: "id", values: supplied }));
            if (existing.length) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          }
          const result = yield* scalar.createRows(ctx, data, shared);
          yield* Effect.fromResult(admitSelection(entity.table.name, result));
          return bound.remember(structuredClone(result), entity.table.name);
        })), (_ctx, input) => normalize(input, entity));
      const lifecycle = (entity: typeof tax, operation: "softDelete" | "restore", select: (readRows: CommerceRelationRows, input: unknown) => Effect.Effect<readonly JsonObject[], ReturnType<typeof commerceError>>): DAL.RepositoryService["softDelete"] =>
        (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* select(readRows(ctx), captured);
          const owner = medusaLifecycle(ctx, { tables: creation.metadata.tables, entities }, operation);
          const plan = yield* owner.plan(entity.table, selected), changed = yield* plan.apply();
          yield* Effect.fromResult(admitSelection(entity.table.name, changed.roots));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const before = new Map(selected.map(row => [row.id, row.deleted_at]));
          // Native restore does not register the module subscriber. Preserve that
          // actual lifecycle boundary rather than adding the Drizzle fallback
          // aggregator event when the genuine ORM emits no public event.
          if (events.isSubscribed(shared)) yield* events.cascades(changed.cascades, shared, row => ({ entity: row, originalEntity: { deleted_at: typeof row.id === "string" ? before.get(row.id) : undefined } }));
          return [bound.remember(changed.roots, entity.table.name), changed.cascades];
        })));
      const find = (entity: typeof tax): DAL.RepositoryService["find"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const plan = yield* Effect.fromResult(entity.scalar.query(captured));
          if (plan.query.skip !== 0 || plan.paths.length) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const selected = yield* readRows(ctx)(entity.table.name, plan.query.predicate);
          const projected = yield* Effect.fromResult(projectRows(selected, plan.projection.node));
          return bound.remember(structuredClone(projected), entity.table.name);
        })));
      const lineItemTaxLineRepository: DAL.RepositoryService = { ...bound.denied, serialize: bound.repository.serialize,
        find: find(tax), upsert: createRows(tax, taxBound, true),
        softDelete: lifecycle(tax, "softDelete", (rows, input) => selectTaxRemoval(rows, input, false)) };
      const shippingMethodTaxLineRepository: DAL.RepositoryService = { ...bound.denied, serialize: bound.repository.serialize,
        find: find(shippingTax), softDelete: lifecycle(shippingTax, "softDelete", (rows, input) => selectTaxRemoval(rows, input, true)) };
      const adjustmentSelection = (operation: "softDelete" | "restore") => (rows: CommerceRelationRows, input: unknown) =>
        Effect.fromResult(ids(input)).pipe(Effect.flatMap(input => input.length === 0 ? Effect.succeed([]) : selectAdjustmentLifecycle(rows, input, operation)));
      const lineItemAdjustmentRepository: DAL.RepositoryService = { ...bound.denied, serialize: bound.repository.serialize,
        create: createRows(adjustment, adjustmentBound, false),
        softDelete: lifecycle(adjustment, "softDelete", adjustmentSelection("softDelete")),
        restore: lifecycle(adjustment, "restore", adjustmentSelection("restore")) };
      // Native restore reaches the repository for [], where its genuine DAL
      // has an exact empty fast path. Populated shipping writes stay denied.
      const shippingMethodAdjustmentRepository: DAL.RepositoryService = { ...bound.denied, restore: (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          yield* Effect.fromResult(emptyShippingAdjustments(captured));
          return [[], {}];
        }))) };
      return { ...bound, lineItemTaxLineRepository, shippingMethodTaxLineRepository, lineItemAdjustmentRepository, shippingMethodAdjustmentRepository };
    };
    return { ...creation, bind, refresh: { entities, tax, shippingTax, adjustment, catalog, admitSelection, selectTaxRemoval, selectAdjustmentLifecycle } };
  });
}

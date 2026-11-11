import { Effect, Result, Schema } from "effect";
import { CustomerGroup } from "@medusajs/customer/models";
import { customerStaticResources } from "@medusajs/customer/static-manifest";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { moduleAliases } from "../../local-graph/module";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { decodeGraphCount } from "../../local-graph/query";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { makeReadCatalog } from "../../query/catalog";
import { QueryLimit } from "../../query/decoder";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere } from "../../query/predicate";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { defineCustomerPersistenceModule } from "./module";
import { captureCustomerMetadata } from "./schema";

const MembershipFilter = Schema.Struct({ customers: Schema.Struct({ id: ScalarId }) });
const Fields = Schema.Array(Schema.Literal("id")).check(Schema.isLengthBetween(1, 1));
const ReadConfig = Schema.Struct({ select: Fields,
  relations: Schema.optionalKey(Schema.Array(Schema.Never)), take: Schema.optionalKey(QueryLimit),
  skip: Schema.optionalKey(Schema.Literal(0)), order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) });
export const decodeCustomerStoreProductRead = commerceDecoder(Schema.Struct({ filters: MembershipFilter,
  config: ReadConfig }), "invalidInput");
const decodeQuery = commerceDecoder(Schema.Struct({ where: MembershipFilter, options: Schema.Struct({
  fields: Fields, populate: Schema.Array(Schema.Never), limit: Schema.optionalKey(QueryLimit),
  offset: Schema.optionalKey(Schema.Literal(0)), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
}) }), "unsupportedProfile");
const projection: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage",
  selectableRelations: [], nested: new Map() };

/** Reverse Group->Customer membership is a distinct native query from the
 * Customer->groups Cart profile. Shared relation filtering owns its traversal. */
export function prepareCustomerStoreProductRead(metadata: Effect.Success<ReturnType<typeof captureCustomerMetadata>>["frame"]) {
  return Result.gen(function* () {
    const customer = metadata.tables.find(table => table.name === "customer"),
      group = metadata.tables.find(table => table.name === "customer_group"),
      pivot = metadata.tables.find(table => table.name === "customer_group_customer");
    if (metadata.tables.length !== 4 || customer === undefined || group === undefined || pivot === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relation = describeToManyRelation(group, "customers", metadata.tables);
    if (relation?.join.type !== "manyToMany" || relation.targetTable !== customer.name || relation.join.pivotTable !== pivot.name ||
      relation.sourcePrimaryKeys.length !== 1 || relation.sourcePrimaryKeys[0] !== "id" ||
      relation.targetPrimaryKeys.length !== 1 || relation.targetPrimaryKeys[0] !== "id" ||
      relation.join.sourceColumns.length !== 1 || relation.join.sourceColumns[0] !== "customer_group_id" ||
      relation.join.targetColumns.length !== 1 || relation.join.targetColumns[0] !== "customer_id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const entities = yield* Result.all(([[customer, 1], [group, 4], [pivot, 8]] as const).map(([table, maximum]) =>
      compileCompleteRow(table).pipe(Result.map(complete => ({ table, maximum, complete })))));
    const byName = new Map(entities.map(entity => [entity.table.name, entity]));
    const catalog = yield* makeReadCatalog(entities.map(({ table }) => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"],
      foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name), companions: {} })),
    new Map([[group.name, new Map([[relation.name, relation]])]]));
    const query = (input: unknown) => Result.gen(function* () {
      const value = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeQuery));
      const selected = yield* compileProjection(catalog, group.name, value.options.fields, [], projection);
      return { table: group.name, projection: selected, paths: [], withDeleted: false,
        relationFilters: [{ path: relation.name, predicate: { kind: "and", children: [
          yield* compileWhere(value.where.customers, scalarIdWhere), { kind: "isNull", column: "deleted_at" }] } }],
        ordering: new Map(), query: { skip: 0, order: { column: "id", direction: "asc" },
          predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }] } },
        // Read the complete membership cohort before paging, so the native
        // listAndCount result never turns an overflow into a truncated count.
        window: { kind: "catalog", order: "id", select: rows => ({
          rows: orderedCatalog("asc")(rows).rows.slice(0, value.options.limit), count: rows.length,
        }) },
      } satisfies ReadPlan;
    });
    const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) {
        const complete = yield* entity.complete(projectNativeRow(row));
        if (typeof complete.id !== "string" || complete.id.length === 0 || table !== pivot.name && complete.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
      }
    });
    const scalar = yield* prepareScalarRepository(group, "CustomerGroup", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(ctx, owner), { bridge } = bound, issued = new WeakSet<object>();
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
          owner.run(bridge.checked(bridge.current(), Effect.gen(function* () {
            if (options !== undefined || input === null || typeof input !== "object" || !issued.has(input))
              return yield* ctx.refuse(commerceError("storedCorruption"));
            const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
            // SAFETY: only the complete DML checked native read below issues
            // this selected Group DTO; the native generic also permits arrays.
            // Native DTO hydration owns a mutable copy; captured evidence stays
            // frozen and cannot be changed through the serializer result.
            return structuredClone(captured) as Output;
          }))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (current, captured) =>
          bridge.checked(current, Effect.gen(function* () {
            const plan = yield* Effect.fromResult(query(captured));
            const result = yield* executeRead({ ...current, admitSelection }, catalog, plan, true);
            if (result.count === undefined) return yield* current.refuse(commerceError("storedCorruption"));
            const rows = structuredClone(result.rows); issued.add(rows); return [rows, result.count];
          }))),
      };
      return { ...bound, repository, denied };
    };
    return { group, customer, pivot, relation, catalog, query, admitSelection, bind, table: yield* catalog.table(group.name) };
  });
}

/** A read-only native Customer service capability; no mutation or workflow
 * facade is exposed to Store Product context construction. */
export const makeCustomerStoreProductReadCommands = Effect.fn("Customer.storeProductReadCommands")(function* () {
  const metadata = yield* captureCustomerMetadata();
  const prepared = yield* Effect.fromResult(prepareCustomerStoreProductRead(metadata.frame));
  const module = yield* Effect.fromResult(defineCustomerPersistenceModule({
    name: "flarex-customer-store-product-read", profile: "customer.store-product-read",
    bind: (ctx, owner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message),
        check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: bound.repository, repository: model => model === CustomerGroup ? bound.repository : bound.denied,
        events: bound.mutationEvents, eventBus };
    }, service: native => ({ listAndCountCustomerGroups: native.listAndCountCustomerGroups.bind(native) }),
  }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
  const count = commerceServiceCommands(module.use).read("customerGroupsCountForStoreProduct",
    commerceCommandPreparation("Customer.storeProductReadPrepare")(decodeCustomerStoreProductRead),
    ({ service, context }, input) => Reflect.apply(service.listAndCountCustomerGroups, service, [input.filters, input.config, context]));
  const joiner = customerStaticResources.joinerConfig;
  if (joiner === undefined) return yield* commerceError("unsupportedProfile");
  const aliases = (yield* Effect.fromResult(moduleAliases(joiner))).filter(alias => alias.model === "CustomerGroup");
  return { source: module.description, count, commands: [count], prepared,
    graph: { aliases, reads: [{ model: "CustomerGroup", command: count, table: prepared.table, paths: [],
      selectedFieldsOnly: true, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] } satisfies GraphModuleDefinition };
});

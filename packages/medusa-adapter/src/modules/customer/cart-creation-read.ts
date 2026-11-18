import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { QueryLimit } from "../../query/decoder";
import { makeReadCatalog } from "../../query/catalog";
import { compileWhere } from "../../query/predicate";
import { compileProjection, projectRows, type ProjectionPolicy } from "../../query/projection";
import { bindCommerceRelationRows, populateCommerceRelations, type CommerceRelationRows, type CommerceRelationOrder } from "../../query/relations";
import type { captureCustomerMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof captureCustomerMetadata>>["frame"];
const ids = Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isMaxLength(4))]);
const paths = Schema.Array(Schema.Literal("groups")).check(Schema.isMaxLength(1));
const fields = Schema.Array(Schema.String).check(Schema.isMaxLength(64));
export const CustomerCartCreationRead = Schema.Struct({
  filters: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(ids) })),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(fields), relations: Schema.optionalKey(paths),
    take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) })),
});
export const decodeCustomerCartCreationRead = commerceDecoder(CustomerCartCreationRead, "invalidInput");
const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.Struct({ id: Schema.optionalKey(ids) }), options: Schema.Struct({
  fields: Schema.optionalKey(fields), populate: paths, limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
}) }), "unsupportedProfile");

/** One bounded local read profile. The genuine Customer DML and native relation
 * descriptor own the membership; grouping/population remains with its existing
 * owner. Selection/mutation commands retain their separate native contract. */
export function prepareCustomerCartCreationRead(metadata: Metadata) {
  return Result.gen(function* () {
    const customer = metadata.tables.find(table => table.name === "customer"), group = metadata.tables.find(table => table.name === "customer_group"),
      pivot = metadata.tables.find(table => table.name === "customer_group_customer");
    if (metadata.tables.length !== 4 || customer === undefined || group === undefined || pivot === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relation = describeToManyRelation(customer, "groups", metadata.tables);
    if (relation?.join.type !== "manyToMany" || relation.targetTable !== group.name || relation.join.pivotTable !== pivot.name ||
      relation.sourcePrimaryKeys.length !== 1 || relation.sourcePrimaryKeys[0] !== "id" || relation.targetPrimaryKeys.length !== 1 || relation.targetPrimaryKeys[0] !== "id" ||
      relation.join.sourceColumns.length !== 1 || relation.join.sourceColumns[0] !== "customer_id" ||
      relation.join.targetColumns.length !== 1 || relation.join.targetColumns[0] !== "customer_group_id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const entities = yield* Result.all(([[customer, 4], [group, 4], [pivot, 8]] as const).map(([table, maximum]) =>
      compileCompleteRow(table).pipe(Result.map(complete => ({ table, maximum, complete })))));
    const byName = new Map(entities.map(entity => [entity.table.name, entity]));
    const catalog = yield* makeReadCatalog(entities.map(({ table }) => ({ name: table.name, columns: table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name), companions: {} })),
    new Map([[customer.name, new Map([[relation.name, relation]])]]));
    const leaf: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", allowWildcard: true, selectableRelations: [], nested: new Map() };
    const projection: ProjectionPolicy = { ...leaf, allowedPaths: ["groups"], selectableRelations: ["groups"], nested: new Map([["groups", leaf]]) };
    const query = (input: unknown) => Result.gen(function* () {
      const value = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeQuery));
      const projected = yield* compileProjection(catalog, customer.name, value.options.fields, value.options.populate, projection);
      const predicate = { kind: "and", children: [yield* compileWhere(value.where, scalarIdWhere), { kind: "isNull", column: "deleted_at" }] };
      return { value, projected, predicate };
    });
    // The bounded native ORM comparator retains membership insertion order.
    // Protected insertion evidence owns ordering, including pending writes.
    const ordering: ReadonlyMap<string, CommerceRelationOrder> = new Map([[pivot.name, { kind: "storageInsertion", direction: "asc" }]]);
    const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* entity.complete(projectNativeRow(row));
    });
    const read = Effect.fn("Customer.cartCreationRead")(function* (rows: CommerceRelationRows, input: unknown) {
      const plan = yield* Effect.fromResult(query(input));
      const roots = yield* rows(customer.name, plan.predicate, "id", { includeIdentities: true });
      const selected = roots.slice(0, plan.value.options.limit ?? roots.length);
      const populated = yield* populateCommerceRelations(rows, customer.name, selected, plan.value.options.populate, catalog.relations, ordering);
      return { rows: yield* Effect.fromResult(projectRows(populated, plan.projected.node)), count: roots.length };
    });
    const scalar = yield* prepareScalarRepository(customer, "Customer", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(ctx, owner), issued = new WeakSet<object>(), { bridge } = bound,
        denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(bridge.current(), Effect.gen(function* () {
          if (options !== undefined || input === null || typeof input !== "object" || !issued.has(input))
            return yield* ctx.refuse(commerceError("storedCorruption"));
          // SAFETY: the native module supplies this generic DTO ABI. Only rows
          // issued after complete DML validation and selected projection enter.
          return (yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))) as Output;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize, findAndCount: (input, shared) =>
        bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
          const result = yield* read(bindCommerceRelationRows({ ...current, admitSelection }, { includeIdentities: true }), captured);
          const rows = structuredClone(result.rows); issued.add(rows); return [rows, result.count];
        }))) };
      return { ...bound, repository, denied };
    };
    return { customer, group, pivot, catalog, relation, entities, byName, query, read, admitSelection, bind, table: yield* catalog.table(customer.name) };
  });
}

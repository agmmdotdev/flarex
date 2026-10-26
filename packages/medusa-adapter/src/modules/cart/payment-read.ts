import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { makeReadCatalog } from "../../query/catalog";
import { compileWhere } from "../../query/predicate";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import type { CommerceRelation } from "../../query/relations";
import type { captureCartMetadata } from "./schema";

export const CartPaymentRead = Schema.Struct({ filters: Schema.Struct({ id: Schema.Union([
  Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(4))]) }),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)), take: Schema.optionalKey(Schema.Literals([4, 15, 256])),
    skip: Schema.optionalKey(Schema.Literal(0)), order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) })) });
export const decodeCartPaymentRead = commerceDecoder(CartPaymentRead, "invalidInput");
const envelope = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.Array(Schema.String),
  limit: Schema.optionalKey(Schema.Literals([4, 15, 256])), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }) }), "unsupportedProfile");
export const cartPaymentPaths = ["items", "credit_lines", "items.tax_lines", "items.adjustments", "shipping_methods",
  "shipping_methods.tax_lines", "shipping_methods.adjustments"] as const;
const allowedPaths: ReadonlySet<string> = new Set(cartPaymentPaths);

/** Read-only native Cart totals input. All nine native models are compiled;
 * only the seven relation paths needed by the genuine total selector can read. */
export function prepareCartPaymentRead(metadata: Effect.Success<ReturnType<typeof captureCartMetadata>>["frame"]) {
  return Result.gen(function* () {
    const entities = yield* Result.all(metadata.tables.map(table => Result.gen(function* () {
      return { table, complete: yield* compileCompleteRow(table), projection: yield* compileRowProjection(table),
        numbers: table.columns.filter(column => column.type === "bigNumber") };
    })));
    const byName = new Map(entities.map(entity => [entity.table.name, entity]));
    const cart = byName.get("cart");
    if (cart === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map<string, Map<string, CommerceRelation>>();
    for (const entity of entities) {
      const members = new Map<string, CommerceRelation>();
      for (const declared of entity.table.relationships) {
        if (declared.type !== "hasMany") continue;
        const relation = describeToManyRelation(entity.table, declared.name, metadata.tables);
        if (relation === undefined || relation.join.type !== "hasMany") return yield* Result.fail(commerceError("unsupportedProfile"));
        members.set(declared.name, relation);
      }
      relations.set(entity.table.name, members);
    }
    const catalog = yield* makeReadCatalog(entities.map(({ table }) => ({ name: table.name, columns: table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])) })), relations);
    const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "retain", incomingKeys: true,
      allowWildcard: true, selectableRelations: [], nested: new Map() };
    const children = { ...leaf, selectableRelations: ["tax_lines", "adjustments"], nested: new Map([["tax_lines", leaf], ["adjustments", leaf]]) };
    const projection: ProjectionPolicy = { ...leaf, selectableRelations: ["items", "credit_lines", "shipping_methods"],
      nested: new Map([["items", children], ["credit_lines", leaf], ["shipping_methods", children]]) };
    const query = (input: unknown) => Result.gen(function* () {
      const value = yield* envelope(input), paths = value.options.populate;
      if (paths.some(path => !allowedPaths.has(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
      // raw_total is computed by the actual Cart service after serialization;
      // it is never a storage column or an independently accepted total.
      const fields = value.options.fields?.filter(field => field !== "raw_total");
      return { table: cart.table.name, projection: yield* compileProjection(catalog, cart.table.name, fields, paths, projection),
        paths, withDeleted: false, relationFilters: [], ordering: new Map(),
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
          yield* compileWhere(value.where, scalarIdWhere), { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: orderedCatalog("asc") } } satisfies ReadPlan;
    });
    const present = Effect.fn("CartPayment.present")(function* (input: Json, table: string): Effect.fn.Return<Json, CommerceTransactionError> {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      const output: JsonObject[] = [];
      for (const value of Array.isArray(input) ? input : [input]) {
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
        const scalar = { ...value }, nested: Record<string, Json> = {};
        for (const relation of relations.get(table)?.values() ?? []) if (Object.hasOwn(scalar, relation.name)) {
          const child = scalar[relation.name]; delete scalar[relation.name];
          if (child === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          nested[relation.name] = yield* present(child, relation.targetTable);
        }
        yield* Effect.fromResult(entity.projection(scalar));
        const projected = yield* projectExactNumericColumns(scalar, entity.numbers, "reserialize");
        if (!isJsonObject(projected)) return yield* Effect.fail(commerceError("storedCorruption"));
        output.push({ ...projected, ...nested });
      }
      return Array.isArray(input) ? output : output[0]!;
    });
    const scalar = yield* prepareScalarRepository(cart.table, "Cart", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const returned = new WeakSet<object>();
      const find = Effect.fn("CartPayment.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const plan = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(query)));
        const result = yield* executeRead({ ...ctx, admitSelection: (table, rows) => Result.gen(function* () {
          const entity = byName.get(table);
          if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          if (rows.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
          for (const row of rows) yield* entity.complete(projectNativeRow(row));
        }) }, catalog, plan, count);
        const rows = structuredClone(result.rows);
        returned.add(rows); for (const row of rows) returned.add(row);
        return { ...result, rows };
      });
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined || input === null || typeof input !== "object" || !returned.has(input))
            return yield* root.refuse(commerceError("storedCorruption"));
          const value = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          const result = yield* present(value, cart.table.name);
          // SAFETY: complete DML rows preceded native projection; this named
          // repository returns only its authenticated Cart selection identities.
          return result as Output;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value, false)).pipe(Effect.map(result => result.rows))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, value, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [result.rows, result.count];
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { cart, entities, byName, catalog, relations: catalog.relations, query, present, bind };
  });
}

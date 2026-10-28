import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { ScalarId, scalarIdWhere } from "../../repository/scalar-id-read";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { captureCommerceInput } from "../../value/input";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";
import type { WherePolicy } from "../../query/predicate";
import { AddressFilter, AddressIds, AddressCreate, AddressNativePatch } from "./address-input";
import type { captureCustomerMetadata } from "./schema";

const Where = Schema.Union([AddressFilter, Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: ScalarId })).check(Schema.isMaxLength(4)) })]);
const id = commerceDecoder(ScalarId, "storedCorruption");
const filter = commerceDecoder(Schema.Union([ScalarId, AddressIds]), "unsupportedProfile");
const where: WherePolicy = { ...scalarIdWhere, decode: commerceDecoder(Where, "unsupportedProfile"),
  fields: new Map([...scalarIdWhere.fields, ["customer_id", { column: "customer_id", decode: filter }],
    ...["is_default_billing", "is_default_shipping"].map(column => [column, { column, decode: commerceDecoder(Schema.Boolean, "unsupportedProfile") }] as const)]) };
const decodeCreates = commerceDecoder(Schema.Array(AddressCreate).check(Schema.isLengthBetween(1, 4)), "unsupportedProfile");
const decodePatch = commerceDecoder(Schema.Struct({ ...AddressNativePatch.fields, id: ScalarId }), "unsupportedProfile");
const decodeUpdateValues = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)));
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: ScalarId })).check(Schema.isMaxLength(4)) }), "unsupportedProfile");
const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.JsonObject }), "unsupportedProfile");
const decodePopulate = commerceDecoder(Schema.Struct({ populate: Schema.Literal(true) }), "unsupportedProfile");

/** Native Customer Address DAL, sharing scalar storage and the borrowed manager.
 * Native workflows retain ownership of default selection and compensation. */
export function prepareCustomerAddressRepository(metadata: Effect.Success<ReturnType<typeof captureCustomerMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = metadata.tables.find(value => value.name === "customer_address");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), projection = yield* compileRowProjection(table);
    const scalar = yield* prepareScalarRepository(table, "CustomerAddress", where, undefined, { managedTimestamps: true });
    const query = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeQuery(input), fields = value.options.fields;
      // Native entities always retain their primary key, including selected
      // compensation preimages. Shared scalar execution owns the actual query.
      return yield* scalar.query({ ...value, options: { ...value.options,
        ...(Array.isArray(fields) ? { fields: [...new Set(["id", ...fields])] } : {}) } });
    });
    const decodeRow = (value: unknown) => Result.gen(function* () { const row = yield* complete(value); const identified: JsonObject & { id: string } = { ...row, id: yield* id(row.id) }; return identified; });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const read = (input: unknown, shared: Parameters<DAL.RepositoryService["find"]>[1], count: boolean) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const value = yield* Effect.fromResult(decodeQuery(captured)), fields = value.options.fields;
          const result = yield* bound.find(ctx, { ...value, options: { ...value.options,
            ...(Array.isArray(fields) ? { fields: [...new Set(["id", ...fields])] } : {}) } }, count);
          if (result.rows.length > 4 || result.count !== undefined && result.count > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          const rows = [];
          for (const row of result.rows) { yield* Effect.fromResult(projection(row)); rows.push({ ...row, id: yield* Effect.fromResult(id(row.id)) }); }
          return { ...result, rows: structuredClone(orderNativeIdRows(rows, value.where)) };
        })));
      const repository: DAL.RepositoryService = { ...denied,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) yield* Effect.fromResult(captureCommerceInput(options).pipe(Result.flatMap(decodePopulate)));
          const value = yield* Effect.fromResult(captureCommerceInput(input));
          for (const row of Array.isArray(value) ? value : [value]) yield* Effect.fromResult(projection(row));
          // SAFETY: complete native DML projections authenticate the DTO generic.
          return structuredClone(value) as Output;
        }))),
        find: async (input, shared) => (await read(input, shared, false)).rows,
        findAndCount: async (input, shared) => { const result = await read(input, shared, true); return [result.rows, result.count ?? 0]; },
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const data = yield* Effect.fromResult(decodeCreates(captured)), rows = yield* bound.createRows(ctx, data, shared);
          for (const row of rows) yield* Effect.fromResult(decodeRow(projectNativeRow(row)));
          return structuredClone(rows);
        }))),
        update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const values = yield* decodeUpdateValues(input)
            .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
          const normalized = [];
          for (const value of values) {
            const pair = yield* captureNativeRecord(value);
            normalized.push({ entity: yield* Effect.fromResult(captureCommerceInput(pair.entity)),
              update: yield* captureNativeDateRecord(pair.update, ["created_at", "updated_at", "deleted_at"]) });
          }
          const pairs = yield* Effect.fromResult(captureCommerceInput(normalized).pipe(Result.flatMap(decodePairs))), patches = [];
          for (const pair of pairs) {
            const entity = yield* Effect.fromResult(decodeRow(pair.entity));
            const patch = yield* Effect.fromResult(decodePatch({ id: entity.id, ...pair.update }));
            if (entity.id !== patch.id || patch.customer_id !== undefined && patch.customer_id !== entity.customer_id) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            patches.push(patch);
          }
          const rows = yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", patches);
          for (const row of rows) yield* Effect.fromResult(decodeRow(projectNativeRow(row)));
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "CustomerAddress", [...rows], shared);
          return structuredClone([...rows]);
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(decodeDelete(captured));
          const rows = yield* (yield* ctx.table(table.name)).delete(ctx.manager, selected.$or);
          const ids = []; for (const row of rows) ids.push((yield* Effect.fromResult(decodeRow(projectNativeRow(row)))).id);
          return ids;
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { table, complete, projection, decodeRow, query, bind, readTable: scalar.table };
  });
}

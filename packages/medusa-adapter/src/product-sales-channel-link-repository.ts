import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { commerceRepositoryContext } from "./commerce-repository-context";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { makeReadCatalog } from "./query/catalog";
import { compileProjection } from "./query/projection";
import { compileWhere, type WherePolicy } from "./query/predicate";
import { executeRead, type ReadPlan } from "./query/read";
import type { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-link-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeCreate = commerceDecoder(Schema.Array(Schema.Struct({
  product_id: Id, sales_channel_id: Id, id: Schema.optionalKey(Id),
})).check(Schema.isMaxLength(commerceLimits.catalogRows)), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject), "storedCorruption");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const strings = commerceDecoder(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(commerceLimits.filterOperands))]), "unsupportedProfile");
const wherePolicy: WherePolicy = {
  decode: decodeWhere, fields: new Map(["id", "product_id", "sales_channel_id"].map(column => [column, { column, decode: strings }])),
  logical: { decodeBranches: commerceDecoder(Schema.Array(Schema.JsonObject), "unsupportedProfile"),
    nodes: commerceLimits.filterNodes, depth: commerceLimits.filterDepth, operands: commerceLimits.filterOperands,
    unwrapMembership: input => input !== null && typeof input === "object" && !Array.isArray(input)
      && Object.keys(input).length === 1 && "$in" in input ? input.$in : input },
};
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ product_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");

/** Only the selected non-DML Link repository. Query and manager mechanics stay
 * shared; native services retain tuple normalization and event construction. */
export function prepareProductSalesChannelLinkRepository(metadata: Effect.Success<ReturnType<typeof captureProductSalesChannelLinkMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = { name: metadata.name, columns: metadata.columns.map(column => column.name),
      primaryKeys: metadata.columns.filter(column => column.primaryKey).map(column => column.name), foreignKeys: [], companions: {} };
    const catalog = yield* makeReadCatalog([table], new Map());
    const query = (input: unknown, maximum: number) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input);
      const options = yield* decodeOptions(envelope.options ?? {});
      const predicate = yield* compileWhere(envelope.where ?? {}, wherePolicy);
      const projection = yield* compileProjection(catalog, table.name, options.fields, [], {
        keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map(),
      });
      const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
      return { table: table.name, projection, paths: [], relationFilters: [], ordering: new Map(), withDeleted,
        query: { fields: projection.storageFields, take: options.limit ?? maximum, skip: options.offset ?? 0,
          order: { column: "product_id", direction: options.orderBy?.product_id === "DESC" ? "desc" : "asc" },
          predicate: { kind: "and", children: [predicate, ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } },
        window: { kind: "database", countAt: "afterPopulation" },
      } satisfies ReadPlan;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bridge = commerceRepositoryContext(root, owner);
      const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
      const find = Effect.fn("LinkRepository.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        return yield* executeRead(ctx, catalog, yield* Effect.fromResult(query(captured, ctx.resources.queryRows)), count);
      });
      const lifecycle = (operation: "softDelete" | "restore", input: unknown, shared: unknown) =>
        bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* find(ctx, { where: input, options: { filters: { softDeletable: { withDeleted: operation === "restore" } } } }, false);
          const store = yield* ctx.table(table.name);
          const rows = [...yield* store.lifecycle(ctx.manager, operation, selected.rows.map(row => ({
            product_id: row.product_id, sales_channel_id: row.sales_channel_id,
          })))];
          return [rows, rows.length === 0 ? {} : { LinkModel: rows }] satisfies [JsonObject[], Record<string, unknown[]>];
        })));
      const repository: DAL.RepositoryService = {
        getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const captured = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          const rows = yield* Effect.fromResult(decodeRows(captured));
          // SAFETY: native DAL permits caller-selected output types; this Link
          // exposes only owned, core-decoded scalar rows and their projections.
          return rows as Output;
        }))),
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, false)).pipe(Effect.map(result => result.rows))),
        findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, input, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [result.rows, result.count] satisfies [JsonObject[], number];
        }))),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const decoded = yield* Effect.fromResult(decodeCreate(captured));
          const rows = decoded.map(row => ({ ...row, id: generateEntityId(row.id, "prodsc") }));
          const store = yield* ctx.table(table.name);
          const stored = yield* store.write(ctx.manager, "upsert", rows);
          // Native create builds its events from these service-owned objects.
          // Never mutate a caller command: command preparation captured it first,
          // and LinkModuleService built a fresh object for each endpoint tuple.
          for (const [index, row] of rows.entries()) Object.assign(input[index], { id: row.id, deleted_at: null });
          return [...stored];
        }))),
        softDelete: (input, shared) => lifecycle("softDelete", input, shared),
        restore: (input, shared) => lifecycle("restore", input, shared),
        update: refuse, delete: refuse, upsert: refuse, upsertWithReplace: refuse,
      };
      return { repository, bridge, refuse };
    };
    return { table, bind };
  });
}

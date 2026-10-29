import { Effect, Result, Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { CartCreationStore, type CartCreationOwnershipReads } from "@medusajs/cart/creation";
import { requireAtomicCommerceScopeExclusion, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import type { commerceRepositoryContext } from "../../repository/context";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import type { WherePolicy } from "../../query/predicate";
import { readCommerceRelationRows } from "../../query/relations";
import type { captureCartCreationMetadata } from "./creation-schema";

type Metadata = Effect.Success<ReturnType<typeof captureCartCreationMetadata>>["frame"];
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const id = commerceDecoder(Id, "unsupportedProfile");
const ids = commerceDecoder(Schema.Array(Id).check(Schema.isMaxLength(8)), "unsupportedProfile");
const rows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "unsupportedProfile");
const updates = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject,
  update: Schema.Struct({ state: Schema.Literal("compensated") }) })).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");

/** Translate the native receipt protocol to the already exclusive logical
 * scope. Native Cart retains generation, sharing, supersession and replay
 * decisions. This owner has no SQL, row-lock simulation or settlement path. */
export function prepareCartCreationOwnership(metadata: Metadata) {
  return Result.gen(function* () {
    const models = [["cart_creation_operation", "CartCreationOperation", "id"],
      ["cart_creation_cart", "CartCreationCart", "cart_id"], ["cart_creation_address", "CartCreationAddress", "address_id"]] as const;
    const prepared = yield* Result.all(models.map(([name, model, key]) => Result.gen(function* () {
      const table = metadata.tables.find(table => table.name === name);
      if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const where: WherePolicy = key === "id" ? scalarIdWhere : { ...scalarIdWhere, fields: new Map([
        ...scalarIdWhere.fields, [key, { column: key, decode: ids }],
      ]) };
      return { name, model, table, key, scalar: yield* prepareScalarRepository(table, model, where),
        complete: yield* compileCompleteRow(table),
        create: commerceRowDecoder(table.columns.map(column => column.name).filter(name => !["created_at", "updated_at", "deleted_at"].includes(name)), "unsupportedProfile") };
    })));
    const cart = metadata.tables.find(table => table.name === "cart"), address = metadata.tables.find(table => table.name === "cart_address");
    if (cart === undefined || address === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const completeCart = yield* compileCompleteRow(cart), completeAddress = yield* compileCompleteRow(address);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner, shared?: {
      readonly bridge: ReturnType<typeof commerceRepositoryContext>;
      readonly events: ReturnType<typeof commerceMutationEvents>;
    }) => {
      const first = prepared[0];
      if (first === undefined) return owner.reject(commerceError("unsupportedProfile"));
      const bridge = shared?.bridge ?? first.scalar.bind(root, owner).bridge;
      const run = <T>(context: Context, work: (ctx: CommerceCommandContext) => Effect.Effect<T, CommerceTransactionError>) =>
        bridge.execute(context, ctx => bridge.checked(ctx, Effect.gen(function* () {
          yield* requireAtomicCommerceScopeExclusion(ctx); return yield* work(ctx);
        })));
      const repositories = new Map(prepared.map(entity => {
        const bound = entity.scalar.bind(root, owner, shared?.events, bridge);
        const repository: DAL.RepositoryService = { ...bound.repository,
          create: (input, context) => bridge.executeInput(context, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
            yield* requireAtomicCommerceScopeExclusion(ctx);
            const inputRows = yield* Effect.fromResult(rows(captured));
            for (const row of inputRows) { yield* Effect.fromResult(entity.create(row)); yield* Effect.fromResult(id(row.id)); }
            const written = yield* (yield* ctx.table(entity.name)).write(ctx.manager, "insert", inputRows);
            const checked = []; for (const row of written) checked.push(yield* Effect.fromResult(entity.complete(projectNativeRow(row))));
            if (shared !== undefined) {
              if (context === undefined || !shared.events.isSubscribed(context)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
              yield* shared.events.created(checked.map(entityRow => ({ modelName: entity.model, entity: { ...entityRow } })), context);
            }
            return structuredClone(checked);
          }))),
          update: entity.key !== "id" ? bound.refuse : (input, context) => bridge.executeInput(context, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
            yield* requireAtomicCommerceScopeExclusion(ctx);
            const pairs = yield* Effect.fromResult(updates(captured)), patches: JsonObject[] = [];
            for (const pair of pairs) {
              const before = yield* Effect.fromResult(entity.complete(pair.entity));
              if (before.state !== "applied" || typeof before.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
              patches.push({ id: before.id, state: pair.update.state });
            }
            const written = yield* (yield* ctx.table(entity.name)).write(ctx.manager, "update", patches);
            const checked = []; for (const row of written) checked.push(yield* Effect.fromResult(entity.complete(projectNativeRow(row))));
            if (shared !== undefined) {
              if (context === undefined || !shared.events.isSubscribed(context)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
              yield* shared.events.rows("afterUpdate", entity.model, checked, context);
            }
            return structuredClone(checked);
          }))),
          delete: bound.refuse, softDelete: bound.refuse, restore: bound.refuse, upsert: bound.refuse, upsertWithReplace: bound.refuse,
        };
        return [entity.name, repository] as const;
      }));
      const reads: CartCreationOwnershipReads = {
        require: context => run(context, () => Effect.void),
        lockOperation: (id, context) => run(context, ctx => readCommerceRelationRows(ctx, "cart_creation_operation", { kind: "in", column: "id", values: [id] }, "id").pipe(Effect.asVoid)),
        lockCarts: (input, context) => run(context, ctx => Effect.gen(function* () {
          const values = yield* Effect.fromResult(ids(input)), selected = yield* readCommerceRelationRows(ctx, cart.name, { kind: "in", column: "id", values }, "id");
          const result = [];
          for (const row of selected) { const checked = yield* Effect.fromResult(completeCart(projectNativeRow(row)));
            result.push({ id: checked.id, shipping_address_id: checked.shipping_address_id, billing_address_id: checked.billing_address_id }); }
          return result;
        })),
        lockAddresses: (input, context) => run(context, ctx => Effect.gen(function* () {
          const values = yield* Effect.fromResult(ids(input)), selected = yield* readCommerceRelationRows(ctx, address.name, { kind: "in", column: "id", values }, "id");
          const result = []; for (const row of selected) result.push({ id: (yield* Effect.fromResult(completeAddress(projectNativeRow(row)))).id });
          return result;
        })),
        references: (input, context) => run(context, ctx => Effect.gen(function* () {
          const values = yield* Effect.fromResult(ids(input));
          const selected = yield* readCommerceRelationRows(ctx, cart.name, { kind: "or", children: [
            { kind: "in", column: "shipping_address_id", values }, { kind: "in", column: "billing_address_id", values },
          ] }, "id");
          const result = []; for (const row of selected) { const checked = yield* Effect.fromResult(completeCart(projectNativeRow(row)));
            result.push({ id: checked.id, shipping_address_id: checked.shipping_address_id, billing_address_id: checked.billing_address_id }); }
          return result;
        })),
      };
      const select = (name: typeof models[number][0]) => { const value = repositories.get(name); if (value === undefined) return owner.reject(commerceError("unsupportedProfile")); return value; };
      return { bridge, reads, repositories, store: new CartCreationStore({ operations: select("cart_creation_operation"), carts: select("cart_creation_cart"), addresses: select("cart_creation_address"), reads }) };
    };
    return { metadata, protocol: prepared, bind };
  });
}

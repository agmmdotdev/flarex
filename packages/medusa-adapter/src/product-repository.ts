import { productRelations, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import type { Context, DAL, ModulePersistenceAdapter } from "@medusajs/framework/types";
import { registerDrizzleEventSubscriber, dispatchCreatedMutations } from "@medusajs/drizzle/mutation-events";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductProjection, decodeProductCount } from "./product-value-profile";
import { commerceRepositoryContext } from "./commerce-repository-context";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureCommerceInput } from "./commerce-input";
import { assembleProducts, captureProductGraph, insertProductGraph } from "./product-graph";
import { findProducts } from "./product-query";

/** Request-owned DAL composition; all framework transaction methods borrow core. */
export function productRepository(root: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata) {
  const bridge = commerceRepositoryContext(root, owner);
  const subscribed = new WeakSet<object>();
  const unsupported = () => owner.reject(commerceError("unsupportedProfile"));
  const persistence: ModulePersistenceAdapter = {
    name: "flarex-product-local",
    prepareModels: unsupported, createConnectionLoader: unsupported,
    createBaseRepository: unsupported, createRepository: unsupported,
    registerEventSubscriber: (context, Subscriber) => { registerDrizzleEventSubscriber(context, Subscriber); subscribed.add(context); },
  };
  const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
  const repository: DAL.RepositoryService = {
    getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
    serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
      if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
      const value = yield* bridge.checked(root, Effect.fromResult(captureCommerceInput(input)));
      const decoded = yield* bridge.checked(root, Effect.fromResult(decodeProductProjection(value)));
      // SAFETY: repository results are core-decoded scalar rows and the bounded
      // acyclic projection. Medusa also promises complete DTOs for partial selects.
      return decoded as Output;
    })),
    find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findProducts(ctx, metadata, input, false)).pipe(Effect.map(value => value.rows))),
    findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findProducts(ctx, metadata, input, true)).pipe(Effect.flatMap(value =>
      bridge.checked(ctx, Effect.fromResult(decodeProductCount(value))).pipe(Effect.map(decoded =>
        [[...decoded.rows], decoded.count] satisfies [Array<typeof decoded.rows[number]>, number]))))),
    create: (input: unknown[], shared?: Context) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const graph = yield* captureProductGraph(metadata, input);
      const rows = yield* insertProductGraph(ctx, metadata, graph);
      if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      const mutations = metadata.entities.flatMap(entity => (rows.get(entity.table.name) ?? []).map(row => ({ modelName: entity.model, entity: { ...row } })));
      yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchCreatedMutations(mutations, shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return assembleProducts(metadata, rows, productRelations);
    }))),
    update: refuse, upsert: refuse, delete: refuse, softDelete: refuse, restore: refuse, upsertWithReplace: refuse,
  };
  return { repository, persistence, refuse,
    captureLocalEvent: (event: unknown) => Effect.suspend(() => bridge.current().captureLocalEvent(event)),
    rejectLocalEvent: (error: CommerceTransactionError) => Effect.suspend(() => bridge.current().refuse(error)),
  };
}

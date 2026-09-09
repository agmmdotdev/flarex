import { productRelations, type ProductRuntimeMetadata, type ProductEntityMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import type { Context, DAL, ModulePersistenceAdapter } from "@medusajs/framework/types";
import { createDrizzleEventSubscriber, registerDrizzleEventSubscriber, dispatchCreatedMutations, dispatchDrizzleMutationRows, dispatchDrizzleMutationEvent, dispatchCascadedUpdateMutations } from "@medusajs/drizzle/mutation-events";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductProjection, decodeProductCount } from "./product-value-profile";
import { commerceRepositoryContext } from "./commerce-repository-context";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureCommerceInput } from "./commerce-input";
import { assembleProducts, captureProductGraph, insertProductGraph } from "./product-graph";
import { findProducts } from "./product-query";
import { populateCommerceRelations } from "./commerce-relations";
import { findProductRelated, insertProductRelated, updateProductRelated } from "./product-related";
import { findCollectionMembershipProducts, updateCollectionMembershipProducts } from "./product-collection-membership";
import { replaceProductRows } from "./product-mutation";
import { captureCategoryProjection } from "./product-category-projection";
import { findCategoryRows, insertCategoryRows, updateCategoryRows } from "./product-category-repository";
import { changeProductLifecycle } from "./product-lifecycle";

export type ProductRepositoryProfile = "public" | "collectionMembership" | "categoryProjection" | "internalProduct";

/** Request-owned DAL composition; all framework transaction methods borrow core. */
export function productRepository(root: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata, profile: ProductRepositoryProfile = "public") {
  const collectionMembership = profile === "collectionMembership";
  const categoryProjection = profile === "categoryProjection";
  const internalProduct = profile === "internalProduct";
  const bridge = commerceRepositoryContext(root, owner);
  const subscribed = new WeakSet<object>();
  const ownedSubscribers = new WeakSet<object>();
  const unsupported = () => owner.reject(commerceError("unsupportedProfile"));
  const persistence: ModulePersistenceAdapter = {
    name: "flarex-product-local",
    createEventSubscriber: (keys, service) => { const subscriber = createDrizzleEventSubscriber(keys, service); ownedSubscribers.add(subscriber); return subscriber; },
    prepareModels: unsupported, createConnectionLoader: unsupported,
    createBaseRepository: unsupported, createRepository: unsupported,
    registerEventSubscriber: (context, Subscriber) => { registerDrizzleEventSubscriber(context, Subscriber); subscribed.add(context); },
    dispatchMutationEvent: (event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if ((!subscribed.has(shared) && (subscriber === undefined || !ownedSubscribers.has(subscriber))) || !["afterCreate", "afterUpdate", "afterDelete"].includes(event)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationEvent(event, args, shared, subscriber), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
    }))),
  };
  const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
  const deleteRows = (entity: ProductEntityMetadata): DAL.RepositoryService["delete"] => (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx,
    changeProductLifecycle(ctx, metadata, entity, "delete", input).pipe(Effect.flatMap(result => Effect.gen(function* () {
      const ids: string[] = [];
      for (const row of result.roots) {
        if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
        ids.push(row.id);
      }
      return ids;
    })))));
  const lifecycle = (entity: ProductEntityMetadata, operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
    const result = yield* changeProductLifecycle(ctx, metadata, entity, operation, input);
    if (shared === undefined || (operation === "softDelete" && !subscribed.has(shared))) return yield* ctx.refuse(commerceError("unadmittedEvent"));
    // Preserve the pinned Drizzle subscriber's lifecycle callback convention,
    // including restored events for selected already-active rows. Core records
    // the actual before/after state and authenticates the managed operation.
    // Pinned restore does not register a subscriber: the existing dispatcher
    // uses its conventional aggregator path on that framework-owned context.
    yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchCascadedUpdateMutations(result.cascades, shared,
      row => ({ entity: row, originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } })), signal),
      catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
    return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
  })));
  const repository: DAL.RepositoryService = {
    getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
    serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
      if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
      const value = yield* bridge.checked(root, Effect.fromResult(categoryProjection ? captureCategoryProjection(input, root.resources) : captureCommerceInput(input, root.resources)));
      const decoded = yield* bridge.checked(root, Effect.fromResult(decodeProductProjection(value)));
      // SAFETY: repository results are core-decoded scalar rows and the bounded
      // acyclic projection. Medusa also promises complete DTOs for partial selects.
      return decoded as Output;
    })),
    find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, collectionMembership
      ? findCollectionMembershipProducts(ctx, metadata, input) : findProducts(ctx, metadata, input, false, internalProduct).pipe(Effect.map(value => value.rows)))),
    findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findProducts(ctx, metadata, input, true, internalProduct)).pipe(Effect.flatMap(value =>
      bridge.checked(ctx, Effect.fromResult(decodeProductCount(value))).pipe(Effect.map(decoded =>
        [[...decoded.rows], decoded.count] satisfies [Array<typeof decoded.rows[number]>, number]))))),
    create: (input: unknown[], shared?: Context) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const graph = yield* captureProductGraph(metadata, input, ctx.resources);
      const rows = yield* insertProductGraph(ctx, metadata, graph);
      if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      const mutations = metadata.entities.flatMap(entity => (rows.get(entity.table.name) ?? []).map(row => ({ modelName: entity.model, entity: { ...row } })));
      yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchCreatedMutations(mutations, shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return yield* populateCommerceRelations(ctx, metadata.product.table.name, assembleProducts(metadata, rows,
        productRelations.filter(name => !["tags", "categories", "collection", "type"].includes(name))),
      ["tags", "categories", "collection", "type"], metadata.queryRelations, new Map());
    }))),
    update: collectionMembership || internalProduct ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const rows = collectionMembership ? yield* updateCollectionMembershipProducts(ctx, metadata, input)
        : yield* Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const updates = yield* Effect.fromResult(metadata.valueProfile.decodeRelatedUpdatePairs(metadata.product.table.name, captured));
          const store = yield* ctx.table(metadata.product.table.name);
          return yield* store.write(ctx.manager, "update", updates);
        });
      if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationRows("afterUpdate", metadata.product.model, rows.map(row => ({ ...row })), shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return [...rows];
    }))) : refuse, upsert: refuse, delete: deleteRows(metadata.product), softDelete: lifecycle(metadata.product, "softDelete"), restore: lifecycle(metadata.product, "restore"),
    upsertWithReplace: (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, replaceProductRows(ctx, metadata, metadata.product, input, config))),
  };
  /** Table-bound repositories share this request's bridge and subscriber set. */
  const relatedRepository = (entity: ProductEntityMetadata): DAL.RepositoryService => ({
    ...repository,
    delete: deleteRows(entity), softDelete: entity === metadata.variant ? lifecycle(entity, "softDelete") : refuse, restore: refuse,
    update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (![metadata.tag, metadata.type, metadata.collection, metadata.category, metadata.value].includes(entity)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const rows = yield* updateProductRelated(ctx, metadata, entity, input);
      if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      if (entity !== metadata.category) yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationRows("afterUpdate", entity.model, rows.map(row => ({ ...row })), shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return [...rows];
    }))),
    find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findProductRelated(ctx, metadata, entity, input, false)).pipe(Effect.map(value => [...value.rows]))),
    findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findProductRelated(ctx, metadata, entity, input, true)).pipe(Effect.flatMap(value =>
      bridge.checked(ctx, Effect.fromResult(decodeProductCount(value))).pipe(Effect.map(decoded =>
        [[...decoded.rows], decoded.count] satisfies [Array<typeof decoded.rows[number]>, number]))))),
    create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (entity === metadata.collection) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      if (entity === metadata.option || entity === metadata.variant) {
        const result = yield* replaceProductRows(ctx, metadata, entity, input, { relations: entity === metadata.option ? ["values"] : ["options"] }, true);
        if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        const mutations = Object.entries(result.performedActions.created).flatMap(([modelName, values]) => values.map(value => ({ modelName, entity: { ...value } })));
        yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchCreatedMutations(mutations, shared), signal),
          catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
        return result.entities;
      }
      const rows = yield* insertProductRelated(ctx, metadata, entity, input);
      if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      if (entity !== metadata.category && entity !== metadata.assignment) yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchCreatedMutations(rows.map(row => ({ modelName: entity.model, entity: { ...row } })), shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return [...rows];
    }))),
    upsertWithReplace: (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (entity === metadata.option || entity === metadata.variant) return yield* replaceProductRows(ctx, metadata, entity, input, config);
      if (entity !== metadata.collection) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return yield* replaceProductRows(ctx, metadata, entity, input, config, true);
    }))),
  });
  const categoryRepository: DAL.TreeRepositoryService & Pick<DAL.RepositoryService, "update"> = {
    ...repository,
    find: (input, transform, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (transform !== undefined && Object.keys(transform).length) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return (yield* findCategoryRows(ctx, metadata, input)).rows;
    }))),
    findAndCount: (input, transform, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (transform !== undefined && Object.keys(transform).length) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const result = yield* findCategoryRows(ctx, metadata, input);
      return [result.rows, result.count] satisfies [typeof result.rows, number];
    }))),
    create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const result = yield* insertCategoryRows(ctx, metadata, input);
      if (shared === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
      if (result.reranked.length) yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationRows("afterUpdate", metadata.category.model, result.reranked.map(row => ({ ...row })), shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return result.rows;
    }))),
    update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const rows = yield* updateCategoryRows(ctx, metadata, input);
      if (shared === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
      yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationRows("afterUpdate", metadata.category.model, rows.map(row => ({ ...row })), shared), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      return [...rows];
    }))),
    delete: (ids, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const result = yield* changeProductLifecycle(ctx, metadata, metadata.category, "delete", { $or: ids.map(id => ({ id })) });
      return result.roots.flatMap(row => typeof row.id === "string" ? [row.id] : []);
    }))),
  };
  return { repository, persistence, refuse, relatedRepository, categoryRepository,
    captureLocalEvent: (event: unknown) => Effect.suspend(() => bridge.current().captureLocalEvent(event)),
    rejectLocalEvent: (error: CommerceTransactionError) => Effect.suspend(() => bridge.current().refuse(error)),
  };
}

import { productRelations, type ProductRuntimeMetadata, type ProductEntityMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import type { Context, DAL, ModulePersistenceAdapter } from "@medusajs/framework/types";
import { registerDrizzleEventSubscriber, dispatchCreatedMutations, dispatchDrizzleMutationRows, dispatchDrizzleMutationEvent, dispatchCascadedUpdateMutations, emptyPerformedActions, addPerformedAction } from "@medusajs/drizzle/mutation-events";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductProjection, decodeProductCount } from "./product-value-profile";
import { commerceRepositoryContext } from "./commerce-repository-context";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureCommerceInput } from "./commerce-input";
import { assembleProducts, captureProductGraph, insertProductGraph } from "./product-graph";
import { findProducts } from "./product-query";
import { populateCommerceRelations } from "./commerce-relations";
import { findProductRelated, insertProductRelated, updateProductRelated, decodeCollectionReplacement } from "./product-related";
import { replaceProductRows } from "./product-mutation";
import { changeProductLifecycle } from "./product-lifecycle";

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
    dispatchMutationEvent: (event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (!subscribed.has(shared) || !["afterCreate", "afterUpdate", "afterDelete"].includes(event)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationEvent(event, args, shared, subscriber), signal),
        catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
    }))),
  };
  const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
  const deleteRows = (entity: ProductEntityMetadata): DAL.RepositoryService["delete"] => (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx,
    changeProductLifecycle(ctx, metadata, entity, "delete", input).pipe(Effect.flatMap(result => Effect.gen(function* () {
      if (result.reranked.length) {
        if (shared === undefined || !subscribed.has(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* Effect.tryPromise({ try: signal => owner.callback(() => dispatchDrizzleMutationRows("afterUpdate", metadata.category.model, result.reranked.map(row => ({ ...row })), shared), signal),
          catch: (cause): CommerceTransactionError => commerceError("adapterFailure", cause) });
      }
      const ids: string[] = [];
      for (const row of result.roots) {
        if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
        ids.push(row.id);
      }
      return ids;
    })))));
  const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
    const result = yield* changeProductLifecycle(ctx, metadata, metadata.product, operation, input);
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
      return yield* populateCommerceRelations(ctx, metadata.product.table.name, assembleProducts(metadata, rows,
        productRelations.filter(name => !["tags", "categories", "collection", "type"].includes(name))),
      ["tags", "categories", "collection", "type"], metadata.queryRelations, new Map());
    }))),
    update: refuse, upsert: refuse, delete: deleteRows(metadata.product), softDelete: lifecycle("softDelete"), restore: lifecycle("restore"),
    upsertWithReplace: (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, replaceProductRows(ctx, metadata, metadata.product, input, config))),
  };
  /** Table-bound repositories share this request's bridge and subscriber set. */
  const relatedRepository = (entity: ProductEntityMetadata): DAL.RepositoryService => ({
    ...repository,
    delete: deleteRows(entity), softDelete: refuse, restore: refuse,
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
      const captured = yield* Effect.fromResult(captureCommerceInput(config));
      yield* Effect.fromResult(decodeCollectionReplacement(captured));
      const rows = yield* insertProductRelated(ctx, metadata, entity, input);
      const performedActions = emptyPerformedActions();
      for (const row of rows) addPerformedAction(performedActions, "created", entity.model, { ...row }, ["id"]);
      return { entities: [...rows], performedActions };
    }))),
  });
  return { repository, persistence, refuse, relatedRepository,
    captureLocalEvent: (event: unknown) => Effect.suspend(() => bridge.current().captureLocalEvent(event)),
    rejectLocalEvent: (error: CommerceTransactionError) => Effect.suspend(() => bridge.current().refuse(error)),
  };
}

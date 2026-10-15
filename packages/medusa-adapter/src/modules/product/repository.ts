import { productRelations, type ProductRuntimeMetadata, type ProductEntityMetadata } from "./runtime-metadata";
import { Effect, Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import type { CommerceModuleEvents } from "../../module/persistence";
import { commerceMutationEvents } from "../../repository/mutation-events";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductProjection, decodeProductCount, ProductRelationshipId, ProductRelationshipIds } from "./value-profile";
import { commerceRepositoryContext } from "../../repository/context";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { captureCommerceInput } from "../../value/input";
import { assembleProducts, captureProductGraph, insertProductGraph } from "./graph";
import { findProducts } from "./query";
import { populateCommerceRelations } from "../../query/relations";
import { findProductRelated, insertProductRelated, updateProductRelated } from "./related";
import { findCollectionMembershipProducts, updateCollectionMembershipProducts } from "./collection-membership";
import { commerceDecoder } from "../../value/decoder";
import { replaceProductRows } from "./mutation";
import { captureCategoryProjection, decodeCategoryProjection } from "./category-projection";
import { findCategoryRows, insertCategoryRows, updateCategoryRows, softDeleteCategoryRows } from "./category-repository";
import { changeProductLifecycle } from "./lifecycle";
import { optionWorkflowReadProjection } from "./read-profile";
import { productImageVariantReadProfile } from "./image-variant-profile";

export type ProductRepositoryProfile = "public" | "collectionMembership" | "categoryProjection" | "internalProduct" | "deletion" | "typeWorkflow" | "collectionWorkflow" | "categoryWorkflow" | "optionWorkflow" | "imageVariantWorkflow";
const decodeCollectionReplacement = commerceDecoder(Schema.Array(Schema.Struct({
  id: ProductRelationshipId, productIds: ProductRelationshipIds,
})).check(Schema.isLengthBetween(1, 1)), "invalidInput");

/** Request-owned DAL composition; all framework transaction methods borrow core. */
export function productRepository(root: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata, profile: ProductRepositoryProfile = "public") {
  const collectionMembership = profile === "collectionMembership" || profile === "collectionWorkflow";
  const categoryProjection = profile === "categoryProjection";
  const internalProduct = profile === "internalProduct";
  const imageVariant = profile === "imageVariantWorkflow" ? productImageVariantReadProfile(metadata) : undefined;
  const bridge = commerceRepositoryContext(root, owner);
  const events = commerceMutationEvents(owner);
  const categoryIdentities = new Set<string>();
  const createdCategoryIdentities = new Set<string>();
  const observeCategoryRows = Effect.fn("ProductCategory.admitTreeClosure")(function* (rows: readonly JsonObject[]) {
    if (profile !== "categoryWorkflow") return;
    for (const row of rows) {
      if (typeof row.id !== "string") return yield* root.refuse(commerceError("storedCorruption"));
      categoryIdentities.add(row.id);
      if (typeof row.mpath === "string" && row.mpath.split(".").length > 4)
        return yield* root.refuse(commerceError("unsupportedProfile"));
    }
    if (categoryIdentities.size > 16 + createdCategoryIdentities.size)
      return yield* root.refuse(commerceError("unsupportedProfile"));
  });
  const mutationPersistence: CommerceModuleEvents = {
    createEventSubscriber: events.createSubscriber,
    registerEventSubscriber: events.registerSubscriber,
    dispatchMutationEvent: (event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) || !["afterCreate", "afterUpdate", "afterDelete"].includes(event)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      yield* events.dispatch(event, args, shared, subscriber);
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
    const result = yield* changeProductLifecycle(ctx, metadata, entity, operation, input,
      profile === "deletion" ? "product-deletions" : profile === "typeWorkflow" ? "type-workflows"
        : profile === "collectionWorkflow" ? "collection-workflows" : profile === "optionWorkflow" ? "option-workflows" : "standard");
    if (shared === undefined || (operation === "softDelete" && !events.isSubscribed(shared))) return yield* ctx.refuse(commerceError("unadmittedEvent"));
    // Retimestamped deleted Values are updates, so this named native path
    // needs the real operation preimage rather than a fabricated null value.
    const originalDeletion = new WeakMap<object, string | null>();
    if (profile === "optionWorkflow") for (const [model, rows] of Object.entries(result.cascades)) {
      const before = new Map((result.preimages.get(model) ?? []).map(row => [row.id, row]));
      for (const row of rows) {
        const prior = before.get(row.id)?.deleted_at;
        if (prior !== null && typeof prior !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
        originalDeletion.set(row, prior);
      }
    }
    // Preserve the pinned Drizzle subscriber's lifecycle callback convention,
    // including restored events for selected already-active rows. Core records
    // the actual before/after state and authenticates the managed operation.
    // Pinned restore does not register a subscriber: the existing dispatcher
    // uses its conventional aggregator path on that framework-owned context.
    yield* events.cascades(result.cascades, shared,
      row => ({ entity: row, originalEntity: { deleted_at: profile === "optionWorkflow" ? originalDeletion.get(row)
        : operation === "softDelete" ? null : row.updated_at } }));
    return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
  })));
  const repository: DAL.RepositoryService = {
    getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
    serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
      if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
      const value = yield* bridge.checked(root, Effect.fromResult(categoryProjection || profile === "categoryWorkflow"
        ? captureCategoryProjection(input, root.resources) : captureCommerceInput(input, root.resources)));
      yield* bridge.checked(root, Effect.fromResult(decodeProductProjection(value)));
      if (profile === "categoryWorkflow") {
        // The native public Category methods consume serialized arrays before
        // building their events. Restore the checked native representation here;
        // only the outer command carries the private JSON projection envelope.
        return (yield* bridge.checked(root, Effect.fromResult(decodeCategoryProjection(value)))) as Output;
      }
      // SAFETY: repository results are core-decoded scalar rows and the bounded
      // acyclic projection. Medusa also promises complete DTOs for partial selects.
      // This decoder checks JSON membership only: no stripping, defaults or
      // coercion. Keep the captured representation and its immutable children.
      return value as Output;
    })),
    find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, collectionMembership
      ? findCollectionMembershipProducts(ctx, metadata, input, profile === "collectionWorkflow") : findProducts(ctx, metadata, input, false, internalProduct).pipe(Effect.map(value => value.rows))).pipe(Effect.map(rows => structuredClone(rows)))),
    findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findProducts(ctx, metadata, input, true, internalProduct)).pipe(Effect.flatMap(value =>
      bridge.checked(ctx, Effect.fromResult(decodeProductCount(value))).pipe(Effect.map(decoded =>
        [structuredClone([...decoded.rows]), decoded.count] satisfies [Array<typeof decoded.rows[number]>, number]))))),
    create: (input: unknown[], shared?: Context) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const graph = yield* captureProductGraph(metadata, input, ctx.resources);
      const rows = yield* insertProductGraph(ctx, metadata, graph);
      if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      const mutations = metadata.entities.flatMap(entity => (rows.get(entity.table.name) ?? []).map(row => ({ modelName: entity.model, entity: { ...row } })));
      yield* events.created(mutations, shared);
      return yield* populateCommerceRelations(ctx, metadata.product.table.name, assembleProducts(metadata, rows,
        productRelations.filter(name => !["tags", "categories", "collection", "type"].includes(name))),
      ["tags", "categories", "collection", "type"], metadata.queryRelations, new Map());
    }))),
    update: collectionMembership || internalProduct ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const rows = collectionMembership ? yield* updateCollectionMembershipProducts(ctx, metadata, input, profile === "collectionWorkflow")
        : yield* Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const updates = yield* Effect.fromResult(metadata.valueProfile.decodeRelatedUpdatePairs(metadata.product.table.name, captured));
          const store = yield* ctx.table(metadata.product.table.name);
          return yield* store.write(ctx.manager, "update", updates);
        });
      if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      yield* events.rows("afterUpdate", metadata.product.model, rows.map(row => ({ ...row })), shared);
      return [...rows];
    }))) : refuse, upsert: refuse, delete: deleteRows(metadata.product), softDelete: lifecycle(metadata.product, "softDelete"), restore: lifecycle(metadata.product, "restore"),
    upsertWithReplace: (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, replaceProductRows(ctx, metadata, metadata.product, input, config))),
  };
  /** Table-bound repositories share this request's bridge and subscriber set. */
  const nativeRelatedWorkflow = (entity: ProductEntityMetadata) => profile === "collectionWorkflow" && entity === metadata.collection ||
    profile === "typeWorkflow" && entity === metadata.type || profile === "optionWorkflow" && entity === metadata.option;
  const findRelated = Effect.fn("ProductAdapter.findRelatedForProfile")((ctx: CommerceCommandContext, entity: ProductEntityMetadata, input: unknown, withCount: boolean) =>
    findProductRelated(imageVariant === undefined ? ctx : { ...ctx, admitSelection: imageVariant.admitSelection }, metadata, entity, input, withCount,
      { nativeFilterOrder: nativeRelatedWorkflow(entity),
        ...(imageVariant === undefined ? {} : { complete: true,
          ...(entity === metadata.variant ? { nativeFilterOrder: true, where: imageVariant.where } : {}),
          ...(entity === metadata.option ? { projection: optionWorkflowReadProjection } : {}),
          ...(entity === metadata.assignment ? { relationFilters: imageVariant.assignmentFilters } : {}),
        }),
        ...(profile === "optionWorkflow" && entity === metadata.option ? { projection: optionWorkflowReadProjection } : {}) }).pipe(Effect.flatMap(result => {
      // Native selector update performs its own full list before keyed
      // writes. Refuse a fifth selected root instead of updating a page prefix.
      if (nativeRelatedWorkflow(entity) &&
        (result.rows.length > 4 || result.count !== undefined && result.count > 4))
        return ctx.refuse(commerceError("unsupportedProfile"));
      if (profile === "optionWorkflow" && entity === metadata.option &&
        result.rows.some(row => Array.isArray(row.values) && row.values.length > 4))
        return ctx.refuse(commerceError("unsupportedProfile"));
      return Effect.succeed(result);
    })));
  const relatedRepository = (entity: ProductEntityMetadata): DAL.RepositoryService => ({
    ...repository,
    delete: deleteRows(entity), softDelete: [metadata.variant, metadata.tag].includes(entity) || nativeRelatedWorkflow(entity)
      ? lifecycle(entity, "softDelete") : refuse, restore: refuse,
    update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (![metadata.tag, metadata.type, metadata.collection, metadata.category, metadata.value].includes(entity)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const rows = yield* updateProductRelated(ctx, metadata, entity, input);
      if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      if (entity !== metadata.category) yield* events.rows("afterUpdate", entity.model, rows.map(row => ({ ...row })), shared);
      return [...rows];
    }))),
    // Native Product read overrides attach images to entity graphs. Copy the
    // complete validated graph at this DAL handoff, retaining immutable core
    // rows and call evidence; serialize captures the final native DTO.
    find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findRelated(ctx, entity, input, false)).pipe(Effect.map(value => structuredClone([...value.rows])))),
    findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findRelated(ctx, entity, input, true)).pipe(Effect.flatMap(value =>
      bridge.checked(ctx, Effect.fromResult(decodeProductCount(value))).pipe(Effect.map(decoded =>
        [structuredClone([...decoded.rows]), decoded.count] satisfies [Array<typeof decoded.rows[number]>, number]))))),
    create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (entity === metadata.collection) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      if (entity === metadata.option || entity === metadata.variant) {
        const result = yield* replaceProductRows(ctx, metadata, entity, input, { relations: entity === metadata.option ? ["values"] : ["options"] }, true,
          profile === "optionWorkflow" ? "option-workflows" : "standard");
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        const mutations = Object.entries(result.performedActions.created).flatMap(([modelName, values]) => values.map(value => ({ modelName, entity: { ...value } })));
        yield* events.created(mutations, shared);
        return result.entities;
      }
      const rows = yield* insertProductRelated(ctx, metadata, entity, input);
      if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      if (entity !== metadata.category && entity !== metadata.assignment) yield* events.created(rows.map(row => ({ modelName: entity.model, entity: { ...row } })), shared);
      return [...rows];
    }))),
    upsertWithReplace: (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (entity === metadata.option || entity === metadata.variant) return yield* replaceProductRows(ctx, metadata, entity, input, config, false,
        profile === "optionWorkflow" ? "option-workflows" : "standard");
      if (entity !== metadata.collection) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return yield* replaceProductRows(ctx, metadata, entity, input, config, true);
    }))),
  });
  const categoryRepository: DAL.TreeRepositoryService & Pick<DAL.RepositoryService, "update" | "softDelete"> = {
    ...repository,
    find: (input, transform, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (transform !== undefined && Object.keys(transform).length) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return structuredClone((yield* findCategoryRows(ctx, metadata, input, observeCategoryRows)).rows);
    }))),
    findAndCount: (input, transform, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (transform !== undefined && Object.keys(transform).length) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const result = yield* findCategoryRows(ctx, metadata, input, observeCategoryRows);
      return [structuredClone(result.rows), result.count] satisfies [typeof result.rows, number];
    }))),
    create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const result = yield* insertCategoryRows(ctx, metadata, input);
      for (const row of result.rows) {
        if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
        createdCategoryIdentities.add(row.id);
      }
      yield* observeCategoryRows([...result.rows, ...result.reranked]);
      if (shared === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
      if (result.reranked.length) yield* events.rows("afterUpdate", metadata.category.model, result.reranked.map(row => ({ ...row })), shared);
      return result.rows;
    }))),
    update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const rows = yield* updateCategoryRows(ctx, metadata, input);
      yield* observeCategoryRows(rows);
      if (shared === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
      yield* events.rows("afterUpdate", metadata.category.model, rows.map(row => ({ ...row })), shared);
      return [...rows];
    }))),
    softDelete: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      if (profile !== "categoryWorkflow" || shared === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const rows = yield* softDeleteCategoryRows(ctx, metadata, input);
      yield* observeCategoryRows(rows);
      const unique = [...new Map(rows.map(row => [row.id, row])).values()];
      yield* events.rows("afterUpdate", metadata.category.model, unique.map(row => ({ ...row })), shared,
        row => ({ entity: row, payload: { deleted_at: row.deleted_at }, originalEntity: { deleted_at: null } }));
      return [rows, {}] satisfies [JsonObject[], Record<string, unknown[]>];
    }))),
    delete: (ids, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
      const result = yield* changeProductLifecycle(ctx, metadata, metadata.category, "delete", { $or: ids.map(id => ({ id })) });
      const removed = new Set(result.roots.map(row => row.id));
      if (removed.size !== new Set(ids).size || ids.some(id => !removed.has(id)))
        return yield* ctx.refuse(commerceError("storedCorruption"));
      return [...ids];
    }))),
  };
  return { repository, mutationPersistence, refuse, relatedRepository, categoryRepository,
    replaceCollectionMembership: (selections: readonly Readonly<{ id: string; productIds: readonly string[] }>[], shared: unknown) =>
      bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
        if (profile !== "collectionMembership" ||
          shared === null || typeof shared !== "object" || !events.isSubscribed(shared))
          return yield* ctx.refuse(commerceError("invalidAuthority"));
        const captured = yield* Effect.fromResult(captureCommerceInput(selections, ctx.resources));
        if (ctx.planReferenceReplacement === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
        const selected = (yield* Effect.fromResult(decodeCollectionReplacement(captured)))[0];
        if (selected === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
        yield* ctx.planReferenceReplacement({ sourceTable: metadata.product.table.name,
          sourceColumn: "collection_id", targetTable: metadata.collection.table.name,
          targetColumn: "id", targetKey: selected.id, desiredKeys: selected.productIds });
      }))),
    captureLocalEvent: (event: unknown) => Effect.suspend(() => bridge.current().captureLocalEvent(event)),
    rejectLocalEvent: (error: CommerceTransactionError) => Effect.suspend(() => bridge.current().refuse(error)),
  };
}

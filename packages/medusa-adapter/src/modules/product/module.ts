import { Effect, Result } from "effect";
import { ProductModuleService, ProductCategoryService } from "@medusajs/product/services";
import { Product, ProductImage } from "@medusajs/product/models";
import { Modules } from "@medusajs/framework/utils/portable";
import type { DAL, ModulePersistenceAdapter, ModulePersistenceMutationService } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareCommerceInternalService } from "../../module/persistence";
import { defineCommerceModule, CommerceModuleDefinitionError, type CommerceModuleExtension } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { captureCommerceInput } from "../../value/input";
import { commerceModuleEventBus } from "../../module/events";
import { productModels } from "./definition";
import type { ProductRuntimeMetadata, ProductEntityMetadata } from "./runtime-metadata";
import { productRepository, type ProductRepositoryProfile } from "./repository";

/** This alias deliberately permits only the existing Product image-update path.
 * List every DAL member: new members must be classified instead of inherited. */
export function productImageAliasRepository(repository: DAL.RepositoryService, refuse: () => Promise<never>): DAL.RepositoryService {
  return {
    getFreshManager: repository.getFreshManager.bind(repository),
    getActiveManager: repository.getActiveManager.bind(repository),
    transaction: repository.transaction.bind(repository),
    serialize: repository.serialize.bind(repository),
    update: repository.update.bind(repository),
    upsert: repository.upsert.bind(repository),
    upsertWithReplace: repository.upsertWithReplace.bind(repository),
    find: refuse, findAndCount: refuse, create: refuse, delete: refuse, softDelete: refuse, restore: refuse,
  };
}

function bindProduct(ctx: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata,
  entities: ReadonlyMap<typeof productModels[number], ProductEntityMetadata>, profile: ProductRepositoryProfile) {
  const bound = productRepository(ctx, owner, metadata, profile);
  const { repository, refuse, categoryRepository, captureLocalEvent, rejectLocalEvent,
    replaceCollectionMembership } = bound;
  const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
    capture: captureLocalEvent, check: work => work.pipe(Effect.catchTag("CommerceTransactionError", rejectLocalEvent)), refuse,
  });
  // Category depends on the main service's mutation interceptor. Keep this
  // framework cycle local; no generic container, lazy resolver or service lookup.
  let mutationService: ModulePersistenceMutationService | undefined;
  const categoryMutations: ModulePersistenceMutationService = {
    interceptEntityMutationEvents: (event, args, context) => {
      if (mutationService === undefined) throw new Error("Product mutation service is not initialized");
      mutationService.interceptEntityMutationEvents(event, args, context);
    },
  };
  return {
    baseRepository: repository,
    events: bound.mutationPersistence,
    repository: (model: typeof productModels[number]) => {
      if (model === Product) return repository;
      const entity = entities.get(model);
      if (entity === undefined) return owner.reject(commerceError("unsupportedProfile"));
      return bound.relatedRepository(entity);
    },
    eventBus,
    createCategory: (persistence: ModulePersistenceAdapter) => new ProductCategoryService({
      productCategoryRepository: categoryRepository, modulePersistenceAdapter: persistence, productModuleService: categoryMutations,
    }),
    imageAlias: productImageAliasRepository(repository, refuse),
    connect: (service: ProductModuleService) => {
      // The pinned generated class omits this inherited runtime contract.
      if (!("interceptEntityMutationEvents" in service) || typeof service.interceptEntityMutationEvents !== "function") throw new Error("Missing Product mutation service");
      const intercept = service.interceptEntityMutationEvents.bind(service);
      mutationService = { interceptEntityMutationEvents: (event, args, context) => intercept(event, args, context) };
    },
    capture: (value: unknown) => owner.run(Effect.fromResult(captureCommerceInput(value, ctx.resources))),
    collectionMembershipReplacement: profile === "collectionMembership" && ctx.planReferenceReplacement !== undefined
      ? { replace: replaceCollectionMembership } : undefined,
  };
}

/** One integration-owned definition per supported entry profile. The application
 * never registers repositories or chooses these profiles from request input. */
export function defineProductModule(metadata: ProductRuntimeMetadata, profile: ProductRepositoryProfile = "public") {
  return Result.gen(function* () {
    const entities = new Map<typeof productModels[number], ProductEntityMetadata>();
    for (const model of productModels) {
      const entity = metadata.entities.find(entity => entity.model === model.name);
      if (entity === undefined) return yield* Result.fail(new CommerceModuleDefinitionError({
        module: "flarex-product-local", reason: "missingCapability", detail: `Missing checked metadata for ${model.name}`,
      }));
      entities.set(model, entity);
    }
    const bindImageService = prepareCommerceInternalService(ProductImage);
    const extensions = {
      productCategoryService: { mode: "replace", requires: ["categoryTree"],
        create: ({ binding, persistence }) => binding.createCategory(persistence) },
      productImageProductService: { mode: "add", requires: ["imageUpdateAlias"],
        create: ({ binding, persistence }) => bindImageService(binding.imageAlias, persistence) },
    } satisfies Record<string, CommerceModuleExtension<ReturnType<typeof bindProduct>>>;
    return yield* defineCommerceModule({
      name: "flarex-product-local", models: productModels,
      profile: { name: profile, capabilities: ["categoryTree", "imageUpdateAlias"],
        bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => bindProduct(ctx, owner, metadata, entities, profile),
      },
      extensions,
      service: ({ binding, dependencies, context }) => {
        const service = new ProductModuleService({
          ...dependencies,
          // SAFETY: the pinned type requires MikroORM deepUpdate; its runtime
          // guard selects portable internal services when that method is absent.
          productRepository: binding.baseRepository as ConstructorParameters<typeof ProductModuleService>[0]["productRepository"],
          [Modules.EVENT_BUS]: binding.eventBus,
          ...(binding.collectionMembershipReplacement === undefined ? {} :
            { collectionMembershipReplacement: binding.collectionMembershipReplacement }),
        }, { scope: "internal" });
        binding.connect(service);
        return { service, productService: dependencies.productService, categoryService: dependencies.productCategoryService,
          repository: binding.baseRepository, eventBus: binding.eventBus, context, capture: binding.capture };
      },
    });
  });
}

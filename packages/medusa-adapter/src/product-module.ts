import { Effect, Result } from "effect";
import { ProductModuleService, ProductCategoryService } from "@medusajs/product/services";
import { Product, ProductImage } from "@medusajs/product/models";
import { Modules } from "@medusajs/framework/utils/portable";
import type { DAL, IEventBusModuleService, ModulePersistenceAdapter, ModulePersistenceMutationService } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceInternalService } from "./commerce-module";
import { defineCommerceModule, CommerceModuleDefinitionError, type CommerceModuleExtension } from "./module-definition";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureCommerceInput } from "./commerce-input";
import { decodeLocalEventOptions, decodeLocalEventBatch } from "./product-local-events";
import { productModels } from "./product-schema";
import type { ProductRuntimeMetadata, ProductEntityMetadata } from "./product-runtime-metadata";
import { productRepository, type ProductRepositoryProfile } from "./product-repository";

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
  const { repository, refuse, categoryRepository, captureLocalEvent, rejectLocalEvent } = bound;
  const eventBus: IEventBusModuleService = {
    emit: (input, options) => owner.run(Effect.gen(function* () {
      const settings = yield* Effect.fromResult(captureCommerceInput(options));
      yield* Effect.fromResult(decodeLocalEventOptions(settings));
      const messages = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
      for (const message of yield* Effect.fromResult(decodeLocalEventBatch(messages))) yield* captureLocalEvent(message);
    }).pipe(Effect.catchTag("CommerceTransactionError", rejectLocalEvent))),
    subscribe: () => owner.reject(commerceError("unsupportedProfile")),
    unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
    releaseGroupedEvents: refuse, clearGroupedEvents: refuse,
  };
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
  };
}

const productExtensions = {
  productCategoryService: { mode: "replace", requires: ["categoryTree"], create: ({ binding, persistence }) => binding.createCategory(persistence) },
  productImageProductService: { mode: "add", requires: ["imageUpdateAlias"],
    create: ({ binding, persistence }) => commerceInternalService(ProductImage, binding.imageAlias, persistence),
  },
} satisfies Record<string, CommerceModuleExtension<ReturnType<typeof bindProduct>>>;

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
    return yield* defineCommerceModule({
      name: "flarex-product-local", models: productModels,
      profile: { name: profile, capabilities: ["categoryTree", "imageUpdateAlias"],
        bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => bindProduct(ctx, owner, metadata, entities, profile),
      },
      extensions: productExtensions,
      service: ({ binding, dependencies, context }) => {
        const service = new ProductModuleService({
          ...dependencies,
          // SAFETY: the pinned type requires MikroORM deepUpdate; its runtime
          // guard selects portable internal services when that method is absent.
          productRepository: binding.baseRepository as ConstructorParameters<typeof ProductModuleService>[0]["productRepository"],
          [Modules.EVENT_BUS]: binding.eventBus,
        }, { scope: "internal" });
        binding.connect(service);
        return { service, productService: dependencies.productService, categoryService: dependencies.productCategoryService,
          repository: binding.baseRepository, eventBus: binding.eventBus, context, capture: binding.capture };
      },
    });
  });
}

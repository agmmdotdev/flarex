import { decodeCategoryProjection } from "../../src/product-category-projection";
import { afterAll, beforeAll, beforeEach, afterEach, describe } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import type { IEventBusModuleService } from "@medusajs/framework/types";
import { makeLocalProductCommands } from "../../src/product-service";
import { prepareLocalProductProfile, prepareLocalProductScaleProfile } from "../../src/product-profile";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { captureCommerceInput } from "../../src/commerce-input";
import { prepareProductReadInput } from "../../src/product-service-input";
import { commerceError, type Json, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";
import type { ProductRunnerOptions, ProductTestService } from "./runner-contract";
import { productFixtureResetSql } from "./product-fixture-reset";

// One lifecycle for the two imported suites in one serial Vitest entry file.
// Per-case row cleanup leaves installed schema/readiness and authenticated history intact.
let registered = false;
let current = Option.none<{ fixture: CommerceHostTestFixture; runtime: Effect.Success<ReturnType<typeof makeLocalProductCommands>>; resetSql: string }>();
let destination = Option.none<IEventBusModuleService>();
const cleanup: Array<() => Promise<void>> = [];
export const getProductRunnerFixture = () => Option.getOrThrow(current);
const get = getProductRunnerFixture;
const observedEvents: Json[] = [];
export const takeProductRunnerEvents = () => observedEvents.splice(0);
export async function clearProductRunnerRows() {
  const { fixture, resetSql } = get();
  await fixture.persistence.exec(resetSql);
  fixture.takeDeliveries(); observedEvents.length = 0;
}

// Narrow the already authenticated local message without changing its bytes or fields.
function isCapturedMessage(event: Json): event is Json & { name: string; data: Json; metadata: { source: string; object: string; action: string } } {
  return isJsonObject(event) && typeof event.name === "string" && event.data !== undefined && event.metadata !== undefined && isJsonObject(event.metadata)
    && typeof event.metadata.source === "string" && typeof event.metadata.object === "string" && typeof event.metadata.action === "string";
}

function registerFixture() {
  if (registered) return;
  registered = true;
  beforeAll(async () => {
    const resourceProfile = process.env.FLAREX_PRODUCT_RESOURCES ?? "default";
    if (resourceProfile !== "default" && resourceProfile !== "scale") throw new Error("Invalid Product resource profile");
    const prepare = resourceProfile === "scale" ? prepareLocalProductScaleProfile : prepareLocalProductProfile;
    const runtime = await Effect.runPromise(makeLocalProductCommands());
    const metadata = await Effect.runPromise(captureProductSchema("product-upstream-tests").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
    const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
      const fixture = await createFileScopedPostgresFixture();
      registerCleanup(fixture.dispose);
      return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
    const fixture = await commerceHostFixture(resource.persistence, resource.session, prepare,
      Object.values(runtime.commands), control, descriptor => productLocalEventPolicy(descriptor, metadata,
        Effect.fn("ProductUpstream.deliver")(function* (events) {
          if (process.env.FLAREX_PRODUCT_RESOURCES === "scale") observedEvents.push(...events);
          if (Option.isSome(destination)) {
            const bus = destination.value;
            const messages = events.map(event => {
              if (!isCapturedMessage(event)) throw new Error("Invalid captured Product message");
              return event;
            });
            yield* Effect.tryPromise({ try: () => bus.emit(messages, { internal: true }), catch: cause => commerceError("adapterFailure", cause) });
          }
        })));
    current = Option.some({ fixture, runtime, resetSql: productFixtureResetSql(fixture.descriptor.layout.frame) });
  }, 120000);
  afterAll(async () => {
    current = Option.none(); destination = Option.none();
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length) throw new AggregateError(failures, "Product test fixture cleanup failed");
  });
}

const execute = Effect.fn("ProductUpstream.call")(function* (method: string, args: readonly unknown[]) {
  const { fixture, runtime } = get();
  const createCommands = { createProducts: runtime.commands.create, createProductTags: runtime.commands.createTags,
    createProductTypes: runtime.commands.createTypes, createProductCollections: runtime.commands.createCollections, createProductImages: runtime.commands.createImages,
    upsertProductTags: runtime.commands.upsertTags, upsertProductTypes: runtime.commands.upsertTypes,
    createProductOptions: runtime.commands.createOptions, createProductVariants: runtime.commands.createVariants, createProductCategories: runtime.commands.createCategories,
    upsertProductOptions: runtime.commands.upsertOptions, upsertProductCollections: runtime.commands.upsertCollections, upsertProductCategories: runtime.commands.upsertCategories,
    addImageToVariant: runtime.commands.addImageToVariant, removeImageFromVariant: runtime.commands.removeImageFromVariant, upsertProducts: runtime.commands.upsert, upsertProductVariants: runtime.commands.upsertVariants };
  const createCommand = Object.entries(createCommands).find(([name]) => name === method)?.[1];
  const updateCommands = { updateProductTags: runtime.commands.updateTags, updateProductTypes: runtime.commands.updateTypes,
    updateProductOptions: runtime.commands.updateOptions, updateProductVariants: runtime.commands.updateVariants, updateProductOptionValues: runtime.commands.updateValues,
    updateProductCollections: runtime.commands.updateCollections, updateProductCategories: runtime.commands.updateCategories, updateProducts: runtime.commands.update };
  const updateCommand = Object.entries(updateCommands).find(([name]) => name === method)?.[1];
  const lifecycleCommands = { deleteProducts: runtime.commands.delete, deleteProductTags: runtime.commands.deleteTags,
    deleteProductTypes: runtime.commands.deleteTypes, deleteProductCategories: runtime.commands.deleteCategories,
    deleteProductCollections: runtime.commands.deleteCollections, deleteProductOptions: runtime.commands.deleteOptions, softDeleteProducts: runtime.commands.softDelete, softDeleteProductVariants: runtime.commands.softDeleteVariants, restoreProducts: runtime.commands.restore };
  const lifecycleCommand = Object.entries(lifecycleCommands).find(([name]) => name === method)?.[1];
  const readCommands = { retrieveProduct: runtime.commands.retrieve, listProducts: runtime.commands.list, listAndCountProducts: runtime.commands.count,
    retrieveProductType: runtime.commands.retrieveType, listProductTypes: runtime.commands.listTypes, listAndCountProductTypes: runtime.commands.countTypes,
    retrieveProductTag: runtime.commands.retrieveTag, listProductTags: runtime.commands.listTags, listAndCountProductTags: runtime.commands.countTags,
    retrieveProductCategory: runtime.commands.retrieveCategory, listProductCategories: runtime.commands.listCategories, listAndCountProductCategories: runtime.commands.countCategories,
    retrieveProductVariant: runtime.commands.retrieveVariant, listProductVariants: runtime.commands.listVariants, listAndCountProductVariants: runtime.commands.countVariants,
    retrieveProductOption: runtime.commands.retrieveOption, listProductOptions: runtime.commands.listOptions, listAndCountProductOptions: runtime.commands.countOptions,
    retrieveProductCollection: runtime.commands.retrieveCollection, listProductCollections: runtime.commands.listCollections, listAndCountProductCollections: runtime.commands.countCollections };
  const readCommand = Object.entries(readCommands).find(([name]) => name === method)?.[1];
  if (lifecycleCommand !== undefined) {
    const isManaged = method === "softDeleteProductVariants" || method === "softDeleteProducts" || method === "restoreProducts";
    if (args.length > (isManaged ? 3 : 2) || args[isManaged ? 2 : 1] !== undefined || (isManaged && args[1] !== undefined)) return yield* Effect.fail(commerceError("invalidAuthority"));
    return yield* fixture.host.run(fixture.host.newRequestKey(), lifecycleCommand, yield* Effect.fromResult(captureCommerceInput(args[0])));
  }
  const contextIndex = createCommand === undefined ? 2 : 1;
  if (args.length > contextIndex + 1 || args[contextIndex] !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(createCommand !== undefined ? args[0]
    : updateCommand !== undefined ? { id: args[0], data: args[1] }
      : method === "retrieveProduct" || method === "retrieveProductType" || method === "retrieveProductTag" || method === "retrieveProductCollection" || method === "retrieveProductVariant" || method === "retrieveProductCategory" || method === "retrieveProductOption" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }));
  if (createCommand !== undefined) return yield* fixture.host.run(fixture.host.newRequestKey(), createCommand, input);
  if (updateCommand !== undefined) return yield* fixture.host.run(fixture.host.newRequestKey(), updateCommand, input);
  if (readCommand === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const result = yield* fixture.host.read(readCommand, method.endsWith("Types") || method.endsWith("Tags") || method.endsWith("Collections") || method.endsWith("Variants") || method.endsWith("Categories") || method.endsWith("Options") || method === "retrieveProductType" || method === "retrieveProductTag" || method === "retrieveProductCollection" || method === "retrieveProductVariant" || method === "retrieveProductCategory" || method === "retrieveProductOption"
    ? input : yield* Effect.fromResult(prepareProductReadInput(input)));
  return method === "retrieveProductCategory" || method === "listProductCategories" || method === "listAndCountProductCategories" ? yield* Effect.fromResult(decodeCategoryProjection(result)) : result;
});

const executeInternalCategory = Effect.fn("ProductUpstream.internalCategory")(function* (method: string, args: readonly unknown[]) {
  const { fixture, runtime } = get();
  const read = method === "list" || method === "listAndCount" || method === "retrieve";
  const contextIndex = read ? 2 : 1;
  if (args.length > contextIndex + 1 || args[contextIndex] !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(read
    ? method === "retrieve" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }
    : args[0]));
  const result = read ? yield* fixture.host.read(method === "retrieve" ? runtime.commands.internalCategoryRetrieve : method === "list" ? runtime.commands.internalCategoryList : runtime.commands.internalCategoryCount, input)
    : yield* fixture.host.run(fixture.host.newRequestKey(), method === "create" ? runtime.commands.internalCategoryCreate : method === "update" ? runtime.commands.internalCategoryUpdate : runtime.commands.internalCategoryDelete, input);
  return yield* Effect.fromResult(decodeCategoryProjection(result));
});
const executeInternalProduct = Effect.fn("ProductUpstream.internalProduct")(function* (method: string, args: readonly unknown[]) {
  const { fixture, runtime } = get();
  const read = method === "list" || method === "retrieve";
  if (args.length > (read ? 2 : 1)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(read
    ? method === "retrieve" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }
    : args[0]));
  return read ? yield* fixture.host.read(method === "retrieve" ? runtime.commands.internalProductRetrieve : runtime.commands.internalProductList, input)
    : yield* fixture.host.run(fixture.host.newRequestKey(), method === "create" ? runtime.commands.internalProductCreate : method === "update" ? runtime.commands.internalProductUpdate
      : method === "softDelete" ? runtime.commands.internalProductSoftDelete : runtime.commands.internalProductRestore, input);
});
const internalProductService = new Proxy<object>({}, {
  get(_target, property) {
    if (typeof property !== "string" || !["list", "retrieve", "create", "update", "softDelete", "restore"].includes(property)) throw new Error("Unadmitted internal Product method: " + String(property));
    return (...args: readonly unknown[]): Promise<unknown> => Effect.runPromise(executeInternalProduct(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    )).then(value => structuredClone(value));
  },
});
const internalCategoryService = new Proxy<object>({}, {
  get(_target, property) {
    if (typeof property !== "string" || !["list", "listAndCount", "retrieve", "create", "update", "delete"].includes(property)) throw new Error("Unadmitted internal Category method: " + String(property));
    return (...args: readonly unknown[]): Promise<unknown> => Effect.runPromise(executeInternalCategory(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    )).then(value => structuredClone(value));
  },
});

/** Original test callback contract, backed only by admitted host commands. The
 * proxy admits the checked mutation milestone methods and refuses every other property access.
 * Results are the unchanged service's host-captured DTOs, inspected by upstream
 * assertions. This test proxy is not a production DTO adapter or public service. */
const service = new Proxy<object>({}, {
  get(_target, property) {
    if (property === "productService_") return internalProductService;
    if (property === "productCategoryService_") return internalCategoryService;
    if (typeof property !== "string" || !["createProducts", "createProductTags", "createProductTypes", "createProductCollections", "createProductImages", "retrieveProduct", "listProducts", "listAndCountProducts", "updateProductTags", "updateProductTypes", "upsertProductTags", "upsertProductTypes",
      "createProductOptions", "createProductVariants", "createProductCategories", "upsertProductOptions", "upsertProductCollections", "upsertProductCategories", "addImageToVariant",
      "updateProductOptions", "updateProductVariants", "updateProductOptionValues", "updateProductCollections", "updateProductCategories", "updateProducts", "upsertProducts", "upsertProductVariants",
      "deleteProducts", "deleteProductTags", "deleteProductTypes", "deleteProductCategories", "deleteProductCollections", "softDeleteProducts", "restoreProducts",
      "listProductTypes", "listAndCountProductTypes", "retrieveProductType", "listProductTags", "listAndCountProductTags", "retrieveProductTag", "listProductCollections", "listAndCountProductCollections", "retrieveProductCollection", "listProductOptions", "listAndCountProductOptions", "retrieveProductOption", "deleteProductOptions", "removeImageFromVariant", "softDeleteProductVariants", "listProductVariants", "listAndCountProductVariants", "retrieveProductVariant", "retrieveProductCategory", "listProductCategories", "listAndCountProductCategories"].includes(property)) {
      throw new Error("Unadmitted Product test service method: " + String(property));
    }
    return (...args: readonly unknown[]): Promise<unknown> => Effect.runPromise(execute(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    )).then(value => structuredClone(value));
  },
}) as ProductTestService; // Test-only compatibility boundary for the original full-service callback.

export function productIntegrationTestRunner(options: ProductRunnerOptions) {
  registerFixture();
  describe(options.injectedDependencies ? "Product injected event bus" : "Product service", () => {
    beforeEach(async () => {
      destination = Option.fromUndefinedOr(options.injectedDependencies?.event_bus);
      await clearProductRunnerRows();
    });
    afterEach(() => {
      destination = Option.none();
      const deliveries = get().fixture.takeDeliveries();
      if (deliveries.some(delivery => Exit.isFailure(delivery.outcome))) throw new Error("Product local test delivery failed");
    });
    options.testSuite({ service });
  });
}

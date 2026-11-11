import { decodeCategoryProjection } from "../../src/modules/product/category-projection";
import { afterAll, afterEach, beforeAll, beforeEach, describe } from "vitest";
import { Cause, Effect, Option } from "effect";
import type { IEventBusModuleService } from "@medusajs/framework/types";
export { default as MockEventBusService } from "@medusajs/test-utils/mock-event-bus-service";
import { captureCommerceInput } from "../../src/value/input";
import { prepareProductReadInput } from "../../src/modules/product/service-input";
import { commerceError, type Json, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { ProductRunnerOptions, ProductTestService } from "./runner-contract";
import { createCoreProductFixture, type CoreProductFixture, type CoreProductFixtureOptions } from "./core-product-fixture";

type Fixture = { product: CoreProductFixture; reader: Pick<CoreProductFixture["host"], "read" | "close"> };
let current = Option.none<Fixture>();
let destination = Option.none<IEventBusModuleService>();
const get = () => Option.getOrThrow(current);
/** Test-only access to the complete translated Product fixture. */
export const getCoreProductRunnerFixture = get;
export const runCoreProductCommand = (command: CommerceCommand, input: Json, key?: string) => {
  const { product } = get();
  return product.host.run(key ?? product.host.newRequestKey(), command, input);
};

// Narrow the already authenticated local message without changing its bytes or fields.
function isCapturedMessage(event: Json): event is Json & { name: string; data: Json; metadata: { source: string; object: string; action: string } } {
  return isJsonObject(event) && typeof event.name === "string" && event.data !== undefined && event.metadata !== undefined && isJsonObject(event.metadata)
    && typeof event.metadata.source === "string" && typeof event.metadata.object === "string" && typeof event.metadata.action === "string";
}

const familyIds = Effect.fn("CoreProductRunner.eventFamilies")(function* (events: CoreProductFixture["events"]) {
  const ids = new Set<string>();
  let after: string | undefined;
  while (true) {
    const next = yield* events.nextFamily(after);
    if (Option.isNone(next)) return ids;
    if (ids.has(next.value)) return yield* commerceError("storedCorruption");
    ids.add(next.value);
    after = next.value;
  }
});

const write = Effect.fn("CoreProductRunner.write")(function* (command: CommerceCommand, input: Json) {
  const { product } = get();
  const before = Option.isSome(destination) ? yield* familyIds(product.events) : new Set<string>();
  const result = yield* product.host.run(product.host.newRequestKey(), command, input);
  if (Option.isSome(destination)) {
    const bus = destination.value;
    const after = yield* familyIds(product.events);
    for (const id of after) {
      if (before.has(id)) continue;
      const committed = yield* product.events.readFamily(id);
      const messages = committed.events.map(event => event.message).map(message => {
        if (!isCapturedMessage(message)) throw new Error("Invalid committed Product message");
        return message;
      });
      if (messages.length !== 0) yield* Effect.tryPromise({ try: () => bus.emit(messages, { internal: true }),
        catch: cause => commerceError("adapterFailure", cause) });
    }
  }
  return result;
});

const execute = Effect.fn("CoreProductUpstream.call")(function* (method: string, args: readonly unknown[]) {
  const { product: { runtime }, reader } = get();
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
    return yield* write(lifecycleCommand, yield* Effect.fromResult(captureCommerceInput(args[0])));
  }
  const contextIndex = createCommand === undefined ? 2 : 1;
  if (args.length > contextIndex + 1 || args[contextIndex] !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(createCommand !== undefined ? args[0]
    : updateCommand !== undefined ? { id: args[0], data: args[1] }
      : method === "retrieveProduct" || method === "retrieveProductType" || method === "retrieveProductTag" || method === "retrieveProductCollection" || method === "retrieveProductVariant" || method === "retrieveProductCategory" || method === "retrieveProductOption" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }));
  if (createCommand !== undefined) return yield* write(createCommand, input);
  if (updateCommand !== undefined) return yield* write(updateCommand, input);
  if (readCommand === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const result = yield* reader.read(readCommand, method.endsWith("Types") || method.endsWith("Tags") || method.endsWith("Collections") || method.endsWith("Variants") || method.endsWith("Categories") || method.endsWith("Options") || method === "retrieveProductType" || method === "retrieveProductTag" || method === "retrieveProductCollection" || method === "retrieveProductVariant" || method === "retrieveProductCategory" || method === "retrieveProductOption"
    ? input : yield* Effect.fromResult(prepareProductReadInput(input)));
  return method === "retrieveProductCategory" || method === "listProductCategories" || method === "listAndCountProductCategories" ? yield* Effect.fromResult(decodeCategoryProjection(result)) : result;
});

const executeInternalCategory = Effect.fn("CoreProductUpstream.internalCategory")(function* (method: string, args: readonly unknown[]) {
  const { product: { runtime }, reader } = get();
  const read = method === "list" || method === "listAndCount" || method === "retrieve";
  const contextIndex = read ? 2 : 1;
  if (args.length > contextIndex + 1 || args[contextIndex] !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(read
    ? method === "retrieve" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }
    : args[0]));
  const result = read ? yield* reader.read(method === "retrieve" ? runtime.commands.internalCategoryRetrieve : method === "list" ? runtime.commands.internalCategoryList : runtime.commands.internalCategoryCount, input)
    : yield* write(method === "create" ? runtime.commands.internalCategoryCreate : method === "update" ? runtime.commands.internalCategoryUpdate : runtime.commands.internalCategoryDelete, input);
  return yield* Effect.fromResult(decodeCategoryProjection(result));
});
const executeInternalProduct = Effect.fn("CoreProductUpstream.internalProduct")(function* (method: string, args: readonly unknown[]) {
  const { product: { runtime }, reader } = get();
  const read = method === "list" || method === "retrieve";
  if (args.length > (read ? 2 : 1)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(read
    ? method === "retrieve" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }
    : args[0]));
  return read ? yield* reader.read(method === "retrieve" ? runtime.commands.internalProductRetrieve : runtime.commands.internalProductList, input)
    : yield* write(method === "create" ? runtime.commands.internalProductCreate : method === "update" ? runtime.commands.internalProductUpdate
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

export function productIntegrationTestRunner(options: ProductRunnerOptions, fixtureOptions?: Readonly<{
  managedRead?: boolean;
  prepareFixture?: () => Promise<CoreProductFixtureOptions>;
}>): void {
  describe(options.injectedDependencies ? "Product injected event bus" : "Product service", () => {
    beforeAll(async () => {
      if (options.moduleName !== "product") throw new Error("Only Product is admitted");
      const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
      if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product driver");
      const product = await createCoreProductFixture(driver, await fixtureOptions?.prepareFixture?.());
      try {
        const reader = fixtureOptions?.managedRead === true ? await product.run(product.openReadHost()) : product.host;
        current = Option.some({ product, reader });
      } catch (cause) { await product.close(); throw cause; }
    }, 180_000);
    afterAll(async () => {
      const selected = current;
      current = Option.none(); destination = Option.none();
      if (Option.isSome(selected)) {
        const { product, reader } = selected.value;
        const failures: unknown[] = [];
        if (reader !== product.host) await product.run(reader.close).catch(cause => { failures.push(cause); });
        await product.close().catch(cause => { failures.push(cause); });
        if (failures.length !== 0) throw new AggregateError(failures, "Core Product runner cleanup failed");
      }
    }, 180_000);
    beforeEach(async () => {
      destination = Option.none();
      const { product, reader } = get();
      const removeRows = async (command: CommerceCommand, ids: readonly string[]) => {
        if (ids.length === 0) return;
        try { await Effect.runPromise(write(command, [...ids])); }
        catch (cause) { throw new Error("Core Product cleanup failed: " +
          (commerceCommandIdentity(command)?.name ?? "unregistered") + " (" +
          (cause !== null && typeof cause === "object" && "reason" in cause &&
            typeof cause.reason === "string" ? cause.reason : String(cause)) + ")", { cause }); }
      };
      const readRows = async (command: CommerceCommand, withDeleted = false) => {
        const result = await Effect.runPromise(reader.read(command,
          { filters: {}, config: withDeleted ? { withDeleted: true } : {} }));
        const rows = isJsonObject(result) && Array.isArray(result.payload) &&
          Array.isArray(result.omitted) && result.omitted.length === 0 ? result.payload : result;
        if (!Array.isArray(rows) || rows.length >= 128 ||
          rows.some(row => !isJsonObject(row) || typeof row.id !== "string"))
          throw new Error("Incomplete Core Product cleanup inventory");
        return rows.map(row => {
          if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Invalid cleanup ID");
          return row;
        });
      };
      const readIds = async (command: CommerceCommand, withDeleted = false) =>
        (await readRows(command, withDeleted)).map(row => {
          if (typeof row.id !== "string") throw new Error("Invalid cleanup ID");
          return row.id;
        });
      const productIds = await readIds(product.runtime.commands.internalProductList, true);
      await removeRows(product.runtime.commands.delete, productIds);
      const categories = await readRows(product.runtime.commands.listCategories);
      const remaining = new Map(categories.map(row => {
        if (typeof row.id !== "string") throw new Error("Invalid cleanup Category ID");
        return [row.id, row] as const;
      }));
      while (remaining.size !== 0) {
        const parentIds = new Set([...remaining.values()].flatMap(row =>
          typeof row.parent_category_id === "string" ? [row.parent_category_id] : []));
        const leaves = [...remaining.keys()].filter(id => !parentIds.has(id));
        if (leaves.length === 0) throw new Error("Cyclic logical Product category cleanup");
        await removeRows(product.runtime.commands.deleteCategories, leaves);
        for (const id of leaves) remaining.delete(id);
      }
      for (const [read, remove] of [
        [product.runtime.commands.listTags, product.runtime.commands.deleteTags],
        [product.runtime.commands.listTypes, product.runtime.commands.deleteTypes],
        [product.runtime.commands.listCollections, product.runtime.commands.deleteCollections],
        [product.runtime.commands.listOptions, product.runtime.commands.deleteOptions],
      ] as const) {
        const ids = await readIds(read);
        await removeRows(remove, ids);
      }
      destination = Option.fromUndefinedOr(options.injectedDependencies?.event_bus);
    }, 180_000);
    afterEach(() => { destination = Option.none(); });
    options.testSuite({ service });
  });
}
export const moduleIntegrationTestRunner = productIntegrationTestRunner;

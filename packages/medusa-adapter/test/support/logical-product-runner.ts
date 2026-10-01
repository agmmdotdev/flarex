import { createHash } from "node:crypto";
import { decodeCategoryProjection } from "../../src/product-category-projection";
import { afterAll, afterEach, beforeAll, beforeEach, describe } from "vitest";
import { Cause, Effect, Option, Result } from "effect";
import type { IEventBusModuleService } from "@medusajs/framework/types";
import { CommonEvents, Modules } from "@medusajs/framework/utils/portable";
export { default as MockEventBusService } from "@medusajs/test-utils/mock-event-bus-service";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { captureCommerceInput } from "../../src/commerce-input";
import { prepareProductReadInput } from "../../src/product-service-input";
import { commerceError, logicalCommerceBatchResources, type Json, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceCommand } from "../../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceDerivedIdEventContract, defineCommerceEventContract } from "../../../persistence-postgres/src/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { CommerceCommand } from "../../../persistence-postgres/src/commerceTransaction/commands";
import { fxSystemCommitEvents } from "../../../persistence-postgres/src/commitEvents/schema";
import type { ProductRunnerOptions, ProductTestService } from "./runner-contract";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";

type Fixture = {
  currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
  writer: Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>;
  root: ReturnType<typeof defineAtomicCommerceCommand>;
  participant: ReturnType<typeof defineAtomicCommerceParticipant>;
  prepareWriter: (command: AtomicCommerceCommand) => ReturnType<typeof makeAtomicCommerceHost>;
  commands: readonly CommerceCommand[];
  events: Awaited<ReturnType<typeof logicalCurrencyFixture>>["persistence"];
};
const participant = defineAtomicCommerceParticipant("product");
let current = Option.none<Fixture>();
let destination = Option.none<IEventBusModuleService>();
const get = () => Option.getOrThrow(current);
/** Test-only access to the selected logical Product host and its authoritative store. */
export const getLogicalProductRunnerFixture = get;

/** Invoke one admitted native command through the canonical logical fixture. */
export const runLogicalProductCommand = (command: CommerceCommand, input: Json, key?: string) => {
  const { writer, root, commands } = get();
  const slot = commands.indexOf(command);
  if (slot < 0) throw new Error("Missing admitted Product command");
  return writer.run(key ?? writer.newRequestKey(), root, { slot, input });
};

// Narrow the already authenticated local message without changing its bytes or fields.
function isCapturedMessage(event: Json): event is Json & { name: string; data: Json; metadata: { source: string; object: string; action: string } } {
  return isJsonObject(event) && typeof event.name === "string" && event.data !== undefined && event.metadata !== undefined && isJsonObject(event.metadata)
    && typeof event.metadata.source === "string" && typeof event.metadata.object === "string" && typeof event.metadata.action === "string";
}

const write = Effect.fn("NativeProductLogical.write")(function* (command: CommerceCommand, input: Json) {
  const { writer, root, commands, events } = get();
  const slot = commands.indexOf(command);
  if (slot < 0) return yield* Effect.fail(commerceError("invalidAuthority"));
  const before = Option.isSome(destination)
    ? (yield* Effect.tryPromise({ try: () => events.drizzle.select().from(fxSystemCommitEvents)
      .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
      catch: cause => commerceError("statementFailure", cause) })).length : 0;
  const result = yield* writer.run(writer.newRequestKey(), root, { slot, input });
  if (Option.isSome(destination)) {
    const bus = destination.value;
    const committed = yield* Effect.tryPromise({ try: () => events.drizzle.select().from(fxSystemCommitEvents)
      .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
      catch: cause => commerceError("statementFailure", cause) });
    const messages = committed.slice(before).map(event => event.envelope.message).map(message => {
      if (!isCapturedMessage(message)) throw new Error("Invalid committed Product message");
      return message;
    });
    if (messages.length) yield* Effect.tryPromise({ try: () => bus.emit(messages, { internal: true }),
      catch: cause => commerceError("adapterFailure", cause) });
  }
  return result;
});

const execute = Effect.fn("ProductUpstream.call")(function* (method: string, args: readonly unknown[]) {
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

const executeInternalCategory = Effect.fn("ProductUpstream.internalCategory")(function* (method: string, args: readonly unknown[]) {
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
const executeInternalProduct = Effect.fn("ProductUpstream.internalProduct")(function* (method: string, args: readonly unknown[]) {
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

export function productIntegrationTestRunner(options: ProductRunnerOptions,
  fixtureOptions?: Readonly<{ protectedRuntime?: boolean }>) {
  describe(options.injectedDependencies ? "Product injected event bus" : "Product service", () => {
    let cleanup: Array<() => Promise<void>> = [];
    beforeAll(async () => {
      if (options.moduleName !== "product") throw new Error("Only Product is admitted");
      const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
      if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product driver");
      if (fixtureOptions?.protectedRuntime === true && driver !== "postgres")
        throw new Error("Protected Product runtime requires PostgreSQL");
      cleanup = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true,
          ...(fixtureOptions?.protectedRuntime === true ? { protectedRuntime: true } : {}) });
        const product = await prepareLogicalProductHost(fixture);
        cleanup.push(() => Effect.runPromise(product.host.close));
        await Effect.runPromise(product.host.initialize([]));
        const commands = Object.values(product.runtime.commands);
        const reader = await Effect.runPromise(makeCommerceHost({ ...product.hostInput, commands,
          logicalResources: logicalCommerceBatchResources }));
        cleanup.push(() => Effect.runPromise(reader.close));
        const metadata = await Effect.runPromise(captureProductSchema("native-product-logical-suite")
          .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
        const revision = createHash("sha256").update("native-product-logical-suite").digest("hex");
        const names = [...new Set(metadata.entities.flatMap(entity => [entity.createdEvent,
          entity.updatedEvent, entity.deletedEvent, entity.restoredEvent]))];
        const contracts = names.map(name => name === metadata.product.updatedEvent
          ? Result.getOrThrow(defineCommerceDerivedIdEventContract({ name, revision, internal: true,
            metadata: { source: Modules.PRODUCT, object: metadata.product.eventObject,
              action: CommonEvents.UPDATED } }))
          : defineCommerceEventContract({ name, revision,
            internal: true, decode: product.runtime.logicalPolicy.capture }));
        const derivedContract = contracts[names.indexOf(metadata.product.updatedEvent)];
        if (derivedContract === undefined) throw new Error("Missing Product updated event contract");
        const byName = new Map(names.map((name, index) => [name, contracts[index]]));
        const root = defineAtomicCommerceCommand("nativeProductLogicalCall", (ctx, args) => {
          if (!isJsonObject(args) || typeof args.slot !== "number" ||
            !Number.isSafeInteger(args.slot) || args.slot < 0 || args.slot >= commands.length ||
            args.input === undefined) return Effect.fail(commerceError("invalidInput"));
          const selected = commands[args.slot];
          return selected === undefined ? Effect.fail(commerceError("invalidAuthority"))
            : ctx.call(participant, selected, args.input);
        });
        const prepareWriter = (command: AtomicCommerceCommand) => makeAtomicCommerceHost({ ...fixture.hostInput,
          identityAndAccessPolicy: { profile: "native-product-logical-suite" },
          participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
            logicalResources: logicalCommerceBatchResources,
            commands, validateLogicalCall: product.runtime.logicalPolicy.validateLogicalCall,
            allowSetNull: true, allowReferenceReplacement: true,
            derivedIdEvent: { contract: derivedContract },
            events: { contracts, select: message => {
              const contract = isJsonObject(message) && typeof message.name === "string"
                ? byName.get(message.name) : undefined;
              return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
            } } }],
          commands: [command], requestCallLimit: 2048, requestByteLimit: logicalCommerceBatchResources.commandBytes,
          requestEventLimit: 2048, requestCommandMs: 30_000,
          events: { producerRevision: revision, contracts, derivedIdValidation: "capturedOnly",
            subscribers: [{ id: "native-product-logical-suite", revision }],
            validate: events => events.some(event => !event.internal)
              ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
        });
        const writer = await Effect.runPromise(prepareWriter(root));
        cleanup.push(() => Effect.runPromise(writer.close));
        current = Option.some({ currency: fixture, product, reader, writer, root, participant, prepareWriter,
          commands, events: fixture.persistence });
      } catch (cause) {
        for (const close of cleanup.reverse()) await close();
        cleanup = [];
        throw cause;
      }
    }, 180_000);
    afterAll(async () => {
      current = Option.none(); destination = Option.none();
      const failures: unknown[] = [];
      for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
      cleanup = [];
      if (failures.length) throw new AggregateError(failures, "Logical Product fixture cleanup failed");
    }, 180_000);
    beforeEach(async () => {
      destination = Option.none();
      const { product, reader } = get();
      const removeRows = async (command: CommerceCommand, ids: readonly string[]) => {
        if (ids.length === 0) return;
        try { await Effect.runPromise(write(command, [...ids])); }
        catch (cause) { throw new Error("Logical Product cleanup failed: " +
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
          throw new Error("Incomplete logical Product cleanup inventory");
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

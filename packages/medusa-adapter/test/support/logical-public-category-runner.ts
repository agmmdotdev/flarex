import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { Cause, Effect, Option } from "effect";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";

import { captureCommerceInput } from "../../src/commerce-input";
import { decodeCategoryProjection } from "../../src/product-category-projection";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import type { ProductRunnerOptions, ProductTestService } from "./runner-contract";

type Operation = "createProduct" | "deleteProduct" | "createCategory" | "updateCategory" | "deleteCategory";
const participant = defineAtomicCommerceParticipant("product");
const run = Effect.runPromise;

/** The unchanged public Category service suite exercises one logical Product
 * source; all per-case cleanup goes through admitted native commands. */
export function moduleIntegrationTestRunner(options: ProductRunnerOptions): void {
  const cleanup: Array<() => Promise<void>> = [];
  const root = {
    createProduct: defineAtomicCommerceCommand("nativePublicCategoryCreateProduct", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.create, input)),
    deleteProduct: defineAtomicCommerceCommand("nativePublicCategoryDeleteProduct", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.delete, input)),
    createCategory: defineAtomicCommerceCommand("nativePublicCategoryCreate", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.createCategories, input)),
    updateCategory: defineAtomicCommerceCommand("nativePublicCategoryUpdate", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.updateCategories, input)),
    deleteCategory: defineAtomicCommerceCommand("nativePublicCategoryDelete", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.deleteCategories, input)),
  };
  let current = Option.none<{
    product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
    reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
    writers: Record<Operation, Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>>;
  }>();
  const get = () => Option.getOrThrow(current);
  beforeAll(async () => {
    if (options.moduleName !== "product") throw new Error("Only public Product Category is admitted");
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid public Category driver");
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    const product = await prepareLogicalProductHost(fixture);
    cleanup.push(() => run(product.host.close));
    await run(product.host.initialize([]));
    const reader = await run(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.list, product.runtime.commands.listCategories,
        product.runtime.commands.countCategories, product.runtime.commands.retrieveCategory] }));
    cleanup.push(() => run(reader.close));
    const catalog = await run(captureProductSchema("native-public-category-suite")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const makeWriter = async (operation: Operation) => {
      const selected = operation === "createProduct" ? product.runtime.commands.create
        : operation === "deleteProduct" ? product.runtime.commands.delete
          : operation === "createCategory" ? product.runtime.commands.createCategories
            : operation === "updateCategory" ? product.runtime.commands.updateCategories
              : product.runtime.commands.deleteCategories;
      const policy = product.runtime.logicalPolicy;
      const names = operation === "createProduct" ? [catalog.product.createdEvent]
        : operation === "deleteProduct" ? [catalog.product.deletedEvent]
          : operation === "createCategory" ? [catalog.category.createdEvent, catalog.category.updatedEvent]
            : operation === "updateCategory" ? [catalog.category.updatedEvent]
              : [catalog.category.deletedEvent, catalog.category.updatedEvent];
      const revision = createHash("sha256").update("native-public-category-" + operation).digest("hex");
      const contracts = names.map(name => defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture }));
      const byName = new Map(names.map((name, index) => [name, contracts[index]]));
      const host = await run(makeAtomicCommerceHost({ ...fixture.hostInput,
        identityAndAccessPolicy: { profile: "native-public-category-" + operation },
        participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
          commands: [selected], validateLogicalCall: policy.validateLogicalCall,
          events: { contracts, select: (message: Json) => {
            const contract = isJsonObject(message) && typeof message.name === "string"
              ? byName.get(message.name) : undefined;
            return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
          } } }],
        commands: [root[operation]], events: { producerRevision: revision, contracts,
          subscribers: [{ id: "native-public-category-" + operation, revision: "a".repeat(64) }],
          validate: events => events.some(event => !event.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
      }));
      cleanup.push(() => run(host.close));
      return host;
    };
    const writers = { createProduct: await makeWriter("createProduct"),
      deleteProduct: await makeWriter("deleteProduct"),
      createCategory: await makeWriter("createCategory"),
      updateCategory: await makeWriter("updateCategory"),
      deleteCategory: await makeWriter("deleteCategory") };
    current = Option.some({ product, reader, writers });
  }, 180_000);
  afterAll(async () => {
    current = Option.none();
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length) throw new AggregateError(failures, "Logical public Category cleanup failed");
  }, 180_000);

  const call = Effect.fn("NativePublicCategory.call")(function* (method: string, args: readonly unknown[]) {
    const read = ["listProductCategories", "listAndCountProductCategories", "retrieveProductCategory"].includes(method);
    const update = method === "updateProductCategories";
    const operation = method === "createProducts" ? "createProduct"
      : method === "createProductCategories" ? "createCategory"
        : update ? "updateCategory" : method === "deleteProductCategories" ? "deleteCategory" : undefined;
    if (!read && operation === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    const contextIndex = read || update ? 2 : 1;
    if (args.length > contextIndex + 1 || args[contextIndex] !== undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const input = yield* Effect.fromResult(captureCommerceInput(update ? { id: args[0], data: args[1] }
      : read ? method === "retrieveProductCategory" ? { id: args[0], config: args[1] }
        : { filters: args[0], config: args[1] } : args[0]));
    const { product, reader, writers } = get();
    const result = read ? yield* reader.read(method === "retrieveProductCategory"
      ? product.runtime.commands.retrieveCategory : method === "listProductCategories"
        ? product.runtime.commands.listCategories : product.runtime.commands.countCategories, input)
      : operation === "createProduct" ? yield* writers.createProduct.run(writers.createProduct.newRequestKey(), root.createProduct, input)
        : operation === "createCategory" ? yield* writers.createCategory.run(writers.createCategory.newRequestKey(), root.createCategory, input)
          : operation === "updateCategory" ? yield* writers.updateCategory.run(writers.updateCategory.newRequestKey(), root.updateCategory, input)
            : yield* writers.deleteCategory.run(writers.deleteCategory.newRequestKey(), root.deleteCategory, input);
    return read ? yield* Effect.fromResult(decodeCategoryProjection(result)) : result;
  });
  const service = new Proxy<object>({}, { get(_target, property) {
    if (typeof property !== "string" || !["createProducts", "createProductCategories",
      "updateProductCategories", "deleteProductCategories", "listProductCategories",
      "listAndCountProductCategories", "retrieveProductCategory"].includes(property))
      throw new Error("Unadmitted public Category method: " + String(property));
    return (...args: readonly unknown[]): Promise<unknown> => run(call(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
        error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    )).then(value => structuredClone(value));
  } }) as ProductTestService;
  describe("Product service", () => {
    beforeEach(async () => {
      const { product, reader, writers } = get();
      const raw = await run(reader.read(product.runtime.commands.listCategories, { filters: {} }));
      const categories = await run(Effect.fromResult(decodeCategoryProjection(raw)));
      if (!Array.isArray(categories) || categories.some(row => !isJsonObject(row) ||
        typeof row.id !== "string" || typeof row.mpath !== "string"))
        throw new Error("Invalid public Category cleanup inventory");
      const leavesFirst = categories.map(row => {
        if (!isJsonObject(row) || typeof row.id !== "string" || typeof row.mpath !== "string")
          throw new Error("Invalid public Category cleanup row");
        return { id: row.id, mpath: row.mpath };
      }).toSorted((left, right) => right.mpath.length - left.mpath.length);
      for (const row of leavesFirst) await run(writers.deleteCategory.run(
        writers.deleteCategory.newRequestKey(), root.deleteCategory, [row.id]));
      const products = await run(reader.read(product.runtime.commands.list, { filters: { id: ["product-1", "product-2"] } }));
      if (!Array.isArray(products) || products.some(row => !isJsonObject(row) || typeof row.id !== "string"))
        throw new Error("Invalid public Category Product cleanup inventory");
      const ids = products.map(row => isJsonObject(row) && typeof row.id === "string" ? row.id : "");
      if (ids.length) await run(writers.deleteProduct.run(writers.deleteProduct.newRequestKey(), root.deleteProduct, ids));
    });
    options.testSuite({ service });
  });
}

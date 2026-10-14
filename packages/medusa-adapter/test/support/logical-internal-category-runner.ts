import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { Cause, Effect, Option } from "effect";
import { captureProductSchema } from "../../src/modules/product/schema";
import { productRuntimeMetadata } from "../../src/modules/product/runtime-metadata";

import { decodeCategoryProjection } from "../../src/modules/product/category-projection";
import { captureCommerceInput } from "../../src/value/input";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import type { ProductRunnerOptions, ProductTestService } from "./runner-contract";

type Operation = "create" | "update" | "delete";
const participant = defineAtomicCommerceParticipant("product");
const run = Effect.runPromise;

/** The original ProductCategoryService suite runs unchanged against one
 * authenticated logical Product source. Other Product methods stay on their
 * separately named compatibility runner until their own cutovers. */
export function moduleIntegrationTestRunner(options: ProductRunnerOptions): void {
  const cleanup: Array<() => Promise<void>> = [];
  const root = {
    create: defineAtomicCommerceCommand("nativeInternalCategoryCreate", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.internalCategoryCreate, input)),
    update: defineAtomicCommerceCommand("nativeInternalCategoryUpdate", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.internalCategoryUpdate, input)),
    delete: defineAtomicCommerceCommand("nativeInternalCategoryDelete", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.internalCategoryDelete, input)),
  };
  let current = Option.none<{
    product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
    reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
    writers: Record<Operation, Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>>;
  }>();
  const get = () => Option.getOrThrow(current);
  beforeAll(async () => {
    if (options.moduleName !== "product") throw new Error("Only Product Category is admitted");
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product Category driver");
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    const product = await prepareLogicalProductHost(fixture);
    cleanup.push(() => run(product.host.close));
    await run(product.host.initialize([]));
    const reader = await run(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.internalCategoryList,
        product.runtime.commands.internalCategoryCount, product.runtime.commands.internalCategoryRetrieve] }));
    cleanup.push(() => run(reader.close));
    const catalog = await run(captureProductSchema("native-internal-category-suite")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const makeWriter = async (operation: Operation) => {
      const selected = operation === "create" ? product.runtime.commands.internalCategoryCreate
        : operation === "update" ? product.runtime.commands.internalCategoryUpdate
          : product.runtime.commands.internalCategoryDelete;
      const host = await run(makeAtomicCommerceHost({ ...fixture.hostInput,
        identityAndAccessPolicy: { profile: "native-internal-category-" + operation },
        participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
          commands: [selected],
          validateLogicalCall: product.runtime.logicalPolicy.validateLogicalCall }],
        commands: [root[operation]],
      }));
      cleanup.push(() => run(host.close));
      return host;
    };
    const writers = { create: await makeWriter("create"), update: await makeWriter("update"),
      delete: await makeWriter("delete") };
    current = Option.some({ product, reader, writers });
  }, 180_000);
  afterAll(async () => {
    current = Option.none();
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length) throw new AggregateError(failures, "Logical Product Category cleanup failed");
  }, 180_000);

  const call = Effect.fn("NativeInternalCategory.call")(function* (method: string, args: readonly unknown[]) {
    const read = method === "list" || method === "listAndCount" || method === "retrieve";
    const contextIndex = read ? 2 : 1;
    if (args.length > contextIndex + 1 || args[contextIndex] !== undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const input = yield* Effect.fromResult(captureCommerceInput(read
      ? method === "retrieve" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }
      : args[0]));
    const { product, reader, writers } = get();
    const result = read ? yield* reader.read(method === "retrieve" ? product.runtime.commands.internalCategoryRetrieve
      : method === "list" ? product.runtime.commands.internalCategoryList
        : product.runtime.commands.internalCategoryCount, input)
      : method === "create" ? yield* writers.create.run(writers.create.newRequestKey(), root.create, input)
        : method === "update" ? yield* writers.update.run(writers.update.newRequestKey(), root.update, input)
          : method === "delete" ? yield* writers.delete.run(writers.delete.newRequestKey(), root.delete, input)
            : yield* Effect.fail(commerceError("invalidAuthority"));
    return yield* Effect.fromResult(decodeCategoryProjection(result));
  });
  const category = new Proxy<object>({}, { get(_target, property) {
    if (typeof property !== "string" || !["list", "listAndCount", "retrieve", "create", "update", "delete"].includes(property))
      throw new Error("Unadmitted internal Category method: " + String(property));
    return (...args: readonly unknown[]): Promise<unknown> => run(call(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
        error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    )).then(value => structuredClone(value));
  } });
  // SAFETY: the pinned test body accesses only the internal Category service.
  const service = { productCategoryService_: category } as ProductTestService;
  describe("Product service", () => {
    beforeEach(async () => {
      const { reader, product, writers } = get();
      const value = await run(reader.read(product.runtime.commands.internalCategoryList, { filters: {} })
        .pipe(Effect.flatMap(result => Effect.fromResult(decodeCategoryProjection(result)))));
      if (!Array.isArray(value) || value.some(row => !isJsonObject(row) ||
        typeof row.id !== "string" || typeof row.mpath !== "string"))
        throw new Error("Invalid Category cleanup inventory");
      const leavesFirst = value.map(row => {
        if (!isJsonObject(row) || typeof row.id !== "string" || typeof row.mpath !== "string")
          throw new Error("Invalid Category cleanup row");
        return { id: row.id, mpath: row.mpath };
      }).toSorted((left, right) => right.mpath.length - left.mpath.length);
      for (const row of leavesFirst) {
        await run(writers.delete.run(writers.delete.newRequestKey(), root.delete, [row.id]));
      }
    });
    options.testSuite({ service });
  });
}

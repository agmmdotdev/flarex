import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { Cause, Effect, Option } from "effect";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";

import { captureCommerceInput } from "../../src/commerce-input";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import type { ProductRunnerOptions, ProductTestService } from "./runner-contract";

type Operation = "create" | "update" | "delete";
const participant = defineAtomicCommerceParticipant("product");
const run = Effect.runPromise;

/** The original public Type suite runs unchanged on one logical Product source. */
export function moduleIntegrationTestRunner(options: ProductRunnerOptions): void {
  const cleanup: Array<() => Promise<void>> = [];
  const root = {
    create: defineAtomicCommerceCommand("nativePublicTypeCreate", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.createTypes, input)),
    update: defineAtomicCommerceCommand("nativePublicTypeUpdate", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.updateTypes, input)),
    delete: defineAtomicCommerceCommand("nativePublicTypeDelete", (ctx, input) =>
      ctx.call(participant, get().product.runtime.commands.deleteTypes, input)),
  };
  let current = Option.none<{
    product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
    reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
    writers: Record<Operation, Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>>;
  }>();
  const get = () => Option.getOrThrow(current);
  beforeAll(async () => {
    if (options.moduleName !== "product") throw new Error("Only Product Type is admitted");
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product Type driver");
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    const product = await prepareLogicalProductHost(fixture);
    cleanup.push(() => run(product.host.close));
    await run(product.host.initialize([]));
    const reader = await run(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.listTypes,
        product.runtime.commands.countTypes, product.runtime.commands.retrieveType] }));
    cleanup.push(() => run(reader.close));
    const catalog = await run(captureProductSchema("native-public-type-suite")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const makeWriter = async (operation: Operation) => {
      const selected = operation === "create" ? product.runtime.commands.createTypes
        : operation === "update" ? product.runtime.commands.updateTypes : product.runtime.commands.deleteTypes;
      const policy = product.runtime.logicalPolicy;
      const name = operation === "create" ? catalog.type.createdEvent
        : operation === "update" ? catalog.type.updatedEvent : catalog.type.deletedEvent;
      const revision = createHash("sha256").update("native-public-type-" + operation).digest("hex");
      const contract = defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture });
      const host = await run(makeAtomicCommerceHost({ ...fixture.hostInput,
        identityAndAccessPolicy: { profile: "native-public-type-" + operation },
        participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
          commands: [selected], validateLogicalCall: policy.validateLogicalCall,
          ...(operation === "delete" ? { allowSetNull: true as const } : {}),
          events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
        commands: [root[operation]],
        events: { producerRevision: revision, contracts: [contract],
          subscribers: [{ id: "native-public-type-" + operation, revision: "a".repeat(64) }],
          validate: events => events.some(event => !event.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
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
    if (failures.length) throw new AggregateError(failures, "Logical Product Type cleanup failed");
  }, 180_000);

  const call = Effect.fn("NativePublicType.call")(function* (method: string, args: readonly unknown[]) {
    const read = method === "listProductTypes" || method === "listAndCountProductTypes" ||
      method === "retrieveProductType";
    const create = method === "createProductTypes";
    const update = method === "updateProductTypes";
    const remove = method === "deleteProductTypes";
    if (!read && !create && !update && !remove) return yield* Effect.fail(commerceError("invalidAuthority"));
    const contextIndex = create || remove ? 1 : 2;
    if (args.length > contextIndex + 1 || args[contextIndex] !== undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const input = yield* Effect.fromResult(captureCommerceInput(update
      ? { id: args[0], data: args[1] }
      : read ? method === "retrieveProductType" ? { id: args[0], config: args[1] }
        : { filters: args[0], config: args[1] } : args[0]));
    const { product, reader, writers } = get();
    return read ? yield* reader.read(method === "retrieveProductType" ? product.runtime.commands.retrieveType
      : method === "listProductTypes" ? product.runtime.commands.listTypes
        : product.runtime.commands.countTypes, input)
      : create ? yield* writers.create.run(writers.create.newRequestKey(), root.create, input)
        : update ? yield* writers.update.run(writers.update.newRequestKey(), root.update, input)
          : yield* writers.delete.run(writers.delete.newRequestKey(), root.delete, input);
  });
  const service = new Proxy<object>({}, { get(_target, property) {
    if (typeof property !== "string" || !["createProductTypes", "updateProductTypes",
      "deleteProductTypes", "listProductTypes", "listAndCountProductTypes", "retrieveProductType"].includes(property))
      throw new Error("Unadmitted public Type method: " + String(property));
    return (...args: readonly unknown[]): Promise<unknown> => run(call(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
        error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    )).then(value => structuredClone(value));
  } }) as ProductTestService;
  describe("Product service", () => {
    beforeEach(async () => {
      const { product, reader, writers } = get();
      const rows = await run(reader.read(product.runtime.commands.listTypes, { filters: {} }));
      if (!Array.isArray(rows) || rows.some(row => !isJsonObject(row) || typeof row.id !== "string"))
        throw new Error("Invalid Type cleanup inventory");
      const ids = rows.map(row => {
        if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Invalid Type cleanup row");
        return row.id;
      });
      if (ids.length) await run(writers.delete.run(writers.delete.newRequestKey(), root.delete, ids));
    });
    options.testSuite({ service });
  });
}

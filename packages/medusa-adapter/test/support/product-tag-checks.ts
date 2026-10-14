import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { captureProductSchema } from "../../src/modules/product/schema";
import { productRuntimeMetadata } from "../../src/modules/product/runtime-metadata";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner, runLogicalProductCommand } from
  "./logical-product-runner";

const run = Effect.runPromise;

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Product Tag boundary", () => {
  it("isolates inverse relations and preserves empty and collection projections", async () => {
    const { currency, product: { runtime }, reader } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.createTags,
      [{ id: "tag_owned", value: "shared" }, { id: "tag_empty", value: "empty" }]));
    await run(runLogicalProductCommand(runtime.commands.createCollections,
      { id: "collection_owned", title: "collection", handle: "collection" }));
    await run(runLogicalProductCommand(runtime.commands.create,
      { id: "product_owned", title: "local", handle: "local", collection_id: "collection_owned",
        tags: [{ id: "tag_owned" }] }));

    const cleanup: Array<() => Promise<void>> = [];
    try {
      const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
      const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: currency.resource, includeProduct: true,
        fixtureIdentity: { deploymentId: "deployment_product_tag_shop_b",
          projectId: "project_product_tag_shop_b", uuidOffset: 21_000 },
      });
      const otherProduct = await prepareLogicalProductHost(other);
      cleanup.push(() => run(otherProduct.host.close));
      await run(otherProduct.host.initialize([]));
      const commands = [otherProduct.runtime.commands.createTags,
        otherProduct.runtime.commands.createCollections, otherProduct.runtime.commands.create];
      const metadata = await run(captureProductSchema("tag-checks")
        .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
      const names = [metadata.tag.createdEvent, metadata.collection.createdEvent,
        metadata.product.createdEvent];
      const revision = createHash("sha256").update("logical-product-tag-second-shop").digest("hex");
      const contracts = names.map(name => defineCommerceEventContract({
        name, revision, internal: true, decode: otherProduct.runtime.logicalPolicy.capture,
      }));
      const participant = defineAtomicCommerceParticipant("product");
      const root = defineAtomicCommerceCommand("secondShopProductTagCreate", (ctx, args) => {
        if (!isJsonObject(args) || typeof args.slot !== "number" ||
          !Number.isSafeInteger(args.slot) || args.input === undefined)
          return Effect.fail(commerceError("invalidInput"));
        const selected = commands[args.slot];
        return selected === undefined ? Effect.fail(commerceError("invalidInput"))
          : ctx.call(participant, selected, args.input);
      });
      const writer = await run(makeAtomicCommerceHost({ ...other.hostInput,
        identityAndAccessPolicy: { profile: "logical-product-tag-second-shop" },
        participants: [{ participant, logicalStorage: otherProduct.hostInput.logicalStorage,
          commands, validateLogicalCall: otherProduct.runtime.logicalPolicy.validateLogicalCall,
          events: { contracts, select: event => {
            const token = isJsonObject(event) && typeof event.name === "string"
              ? contracts[names.indexOf(event.name)] : undefined;
            return token === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(token);
          } } }],
        commands: [root], events: { producerRevision: revision, contracts,
          subscribers: [{ id: "logical-product-tag-second-shop", revision }],
          validate: events => events.some(event => !event.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
      }));
      cleanup.push(() => run(writer.close));
      const writeOther = (slot: number, input: Json) =>
        run(writer.run(writer.newRequestKey(), root, { slot, input }));
      await writeOther(0, { id: "tag_owned", value: "shared" });
      await writeOther(1, { id: "collection_owned", title: "foreign collection", handle: "foreign-collection" });
      await writeOther(2, { id: "product_owned", title: "foreign", handle: "foreign",
        collection_id: "collection_owned", tags: [{ id: "tag_owned" }] });
      await writeOther(2, { id: "product_foreign", title: "foreign only", handle: "foreign-only",
        tags: [{ id: "tag_owned" }] });

      const before = await logicalCurrencyInventory(currency);
      expect(await run(reader.read(runtime.commands.countTags,
        { filters: { value: "shared" }, config: { select: ["value", "products.title"],
          relations: ["products.collection"], take: 1 } }))).toEqual([[
        { id: "tag_owned", value: "shared", products: [{ id: "product_owned", title: "local",
          collection_id: "collection_owned",
          collection: expect.objectContaining({ id: "collection_owned", title: "collection" }) }] },
      ], 1]);
      expect(await run(reader.read(runtime.commands.retrieveTag,
        { id: "tag_empty", config: { select: ["value", "products.id"], relations: ["products"] } })))
        .toEqual({ id: "tag_empty", value: "empty", products: [] });
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
    } finally {
      for (const close of cleanup.reverse()) await close();
    }
  }, 180_000);

  it("authenticates DTO echoes and refuses unsupported inputs without publication", async () => {
    const { currency, product: { runtime }, reader } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.createTags, { id: "tag_echo", value: "before" }));
    const original = await run(reader.read(runtime.commands.retrieveTag, { id: "tag_echo" }));
    if (!isJsonObject(original) || typeof original.created_at !== "string" ||
      typeof original.updated_at !== "string") throw new Error("Missing Tag DTO");
    const input = { ...original, value: "after" };
    const snapshot = structuredClone(input);
    await run(runLogicalProductCommand(runtime.commands.upsertTags, input));
    expect(input).toEqual(snapshot);
    const current = await run(reader.read(runtime.commands.retrieveTag, { id: "tag_echo" }));
    expect(current).toMatchObject({ id: "tag_echo", value: "after",
      created_at: original.created_at, deleted_at: original.deleted_at });
    const before = await logicalCurrencyInventory(currency);
    for (const bad of [
      { ...original, value: "stale" }, { ...original, updated_at: "2000-01-01T00:00:00.000Z" },
      { ...original, created_at: "2000-01-01T00:00:00.000Z" },
      { ...original, deleted_at: "2000-01-01T00:00:00.000Z" },
      { ...original, id: "missing" }, { value: "new", created_at: original.created_at },
      { id: "tag_echo", updated_at: original.updated_at },
    ]) expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.upsertTags, bad))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    for (const bad of [
      { scopeId: "other" }, { table: "product" }, { filters: { value: ["bad"] } },
      { filters: { products: { id: "other" } } },
      { config: { select: ["products.missing"], relations: ["products"] } },
      { config: { relations: ["products.tags"] } },
      { config: { take: 257 } }, { config: { skip: -1 } },
    ]) expect(await run(Effect.result(reader.read(runtime.commands.listTags, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    for (const bad of [
      { title: "bad", tags: [{ id: "tag_echo", value: "rewrite" }] },
      { title: "bad", tags: [{ id: "tag_echo" }], tag_ids: ["tag_echo"] },
    ]) expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.create, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  });

  it("rolls back a new Tag when a later upsert member is missing", async () => {
    const { currency, product: { runtime } } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    const input: Json = [{ value: "must-rollback" }, { id: "missing-tag", value: "missing" }];
    expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.upsertTags, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure",
        cause: { message: 'ProductTag with id "missing-tag" not found' } } });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  });
}) });

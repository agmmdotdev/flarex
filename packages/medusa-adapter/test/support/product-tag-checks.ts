import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { coreProductSnapshot, createCoreProductScopePair } from "./core-product-checks";
import { getCoreProductRunnerFixture, productIntegrationTestRunner, runCoreProductCommand } from "./core-product-runner";

const run = Effect.runPromise;

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Product Tag boundary", () => {
  it("isolates inverse relations and preserves empty and collection projections", async () => {
    const pair = await createCoreProductScopePair(getCoreProductRunnerFixture().product);
    const { product, foreign } = pair, { runtime } = product;
    const write = (command: CommerceCommand, input: Json) => product.run(product.host.run(product.host.newRequestKey(), command, input));
    const foreignWrite = (command: CommerceCommand, input: Json) => foreign.run(foreign.host.run(foreign.host.newRequestKey(), command, input));
    try {
      await write(runtime.commands.createTags, [{ id: "tag_owned", value: "shared" }, { id: "tag_empty", value: "empty" }]);
      await write(runtime.commands.createCollections, { id: "collection_owned", title: "collection", handle: "collection" });
      await write(runtime.commands.create, { id: "product_owned", title: "local", handle: "local", collection_id: "collection_owned", tags: [{ id: "tag_owned" }] });
      await foreignWrite(foreign.runtime.commands.createTags, { id: "tag_owned", value: "shared" });
      await foreignWrite(foreign.runtime.commands.createCollections, { id: "collection_owned", title: "foreign collection", handle: "foreign-collection" });
      await foreignWrite(foreign.runtime.commands.create, { id: "product_owned", title: "foreign", handle: "foreign", collection_id: "collection_owned", tags: [{ id: "tag_owned" }] });
      await foreignWrite(foreign.runtime.commands.create, { id: "product_foreign", title: "foreign only", handle: "foreign-only", tags: [{ id: "tag_owned" }] });
      const before = await coreProductSnapshot(product);
      const query = { filters: { value: "shared" }, config: { select: ["value", "products.title"], relations: ["products.collection"], take: 1 } };
      expect(await product.run(product.host.read(runtime.commands.countTags, query))).toEqual([[
        { id: "tag_owned", value: "shared", products: [{ id: "product_owned", title: "local", collection_id: "collection_owned",
          collection: expect.objectContaining({ id: "collection_owned", title: "collection" }) }] },
      ], 1]);
      expect(await foreign.run(foreign.host.read(foreign.runtime.commands.countTags, query))).toMatchObject([[
        { id: "tag_owned", products: expect.arrayContaining([{ id: "product_owned", title: "foreign",
          collection_id: "collection_owned", collection: expect.objectContaining({ title: "foreign collection" }) }]) },
      ], 1]);
      expect(await product.run(product.host.read(runtime.commands.retrieveTag,
        { id: "tag_empty", config: { select: ["value", "products.id"], relations: ["products"] } })))
        .toEqual({ id: "tag_empty", value: "empty", products: [] });
      expect(await coreProductSnapshot(product)).toEqual(before);
    } finally { await pair.close(); }
  }, 180_000);

  it("authenticates DTO echoes and refuses unsupported inputs without publication", async () => {
    const { product, product: { runtime }, reader } = getCoreProductRunnerFixture();
    await run(runCoreProductCommand(runtime.commands.createTags, { id: "tag_echo", value: "before" }));
    const original = await run(reader.read(runtime.commands.retrieveTag, { id: "tag_echo" }));
    if (!isJsonObject(original) || typeof original.created_at !== "string" ||
      typeof original.updated_at !== "string") throw new Error("Missing Tag DTO");
    const input = { ...original, value: "after" };
    const snapshot = structuredClone(input);
    await run(runCoreProductCommand(runtime.commands.upsertTags, input));
    expect(input).toEqual(snapshot);
    const current = await run(reader.read(runtime.commands.retrieveTag, { id: "tag_echo" }));
    expect(current).toMatchObject({ id: "tag_echo", value: "after",
      created_at: original.created_at, deleted_at: original.deleted_at });
    const before = await coreProductSnapshot(product);
    for (const bad of [
      { ...original, value: "stale" }, { ...original, updated_at: "2000-01-01T00:00:00.000Z" },
      { ...original, created_at: "2000-01-01T00:00:00.000Z" },
      { ...original, deleted_at: "2000-01-01T00:00:00.000Z" },
      { ...original, id: "missing" }, { value: "new", created_at: original.created_at },
      { id: "tag_echo", updated_at: original.updated_at },
    ]) expect(await run(Effect.result(runCoreProductCommand(runtime.commands.upsertTags, bad))))
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
    ]) expect(await run(Effect.result(runCoreProductCommand(runtime.commands.create, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await coreProductSnapshot(product)).toEqual(before);
  });

  it("rolls back a new Tag when a later upsert member is missing", async () => {
    const { product, product: { runtime } } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(product);
    const input: Json = [{ value: "must-rollback" }, { id: "missing-tag", value: "missing" }];
    expect(await run(Effect.result(runCoreProductCommand(runtime.commands.upsertTags, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure",
        cause: { message: 'ProductTag with id "missing-tag" not found' } } });
    expect(await coreProductSnapshot(product)).toEqual(before);
  });
}) });

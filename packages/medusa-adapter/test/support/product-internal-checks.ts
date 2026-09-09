import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;

describe("Internal Product boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("searches DML fields before paging and combines relation and deleted filters", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductCreate, [
      { id: "a", title: "Alpha", handle: "alpha" },
      { id: "b", title: "Plain", handle: "beta", subtitle: "NeEdLe" },
      { id: "c", title: "Plain", handle: "gamma", description: "needle" },
      { id: "d", title: "Plain", handle: "needle-only" },
      { id: "e", title: "Needle", handle: "deleted" },
    ]));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductSoftDelete, "e"));
    const input = { filters: { q: "needle" }, config: { select: ["id"] } };
    expect(await run(fixture.host.read(runtime.commands.internalProductList, input))).toEqual([{ id: "b" }, { id: "c" }]);
    expect(await run(fixture.host.read(runtime.commands.internalProductList, { ...input, config: { select: ["id"], withDeleted: true } })))
      .toEqual([{ id: "b" }, { id: "c" }, { id: "e" }]);
    expect(await run(fixture.host.read(runtime.commands.count, { ...input, config: { select: ["id"], skip: 1, take: 1 } })))
      .toEqual([[{ id: "c" }], 2]);
    expect(await run(fixture.host.read(runtime.commands.internalProductList, { ...input, filters: { q: "needle", id: ["b", "d"] } })))
      .toEqual([{ id: "b" }]);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "category", name: "category" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.update, { id: "b", data: { category_ids: ["category"] } }));
    expect(await run(fixture.host.read(runtime.commands.internalProductList, { ...input, filters: { q: "needle", categories: { id: "category" } } })))
      .toEqual([{ id: "b" }]);
  });

  it("updates every selected internal batch member beyond the public default page", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const products = Array.from({ length: 16 }, (_, index) => ({ id: "batch-" + index, title: "before", handle: "batch-" + index }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductCreate, products));
    const changes = products.map(product => ({ id: product.id, title: "after" }));
    const result = await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductUpdate, changes));
    expect(result).toHaveLength(16);
    const read = await run(fixture.host.read(runtime.commands.internalProductList, { config: { select: ["id", "title"] } }));
    expect(read).toHaveLength(16);
    expect(read).toEqual(expect.arrayContaining(changes));
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("retains internal facts and replay with scalar and array results and no publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const before = await commerceInventory(fixture);
    const key = fixture.host.newRequestKey();
    const input = { id: "internal", title: "internal", handle: "internal" };
    const created = await run(fixture.host.run(key, runtime.commands.internalProductCreate, input));
    expect(created).toMatchObject(input);
    const after = await commerceInventory(fixture);
    expect(after.facts.slice(before.facts.length)).toHaveLength(1);
    expect(await run(fixture.host.run(key, runtime.commands.internalProductCreate, input))).toEqual(created);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductUpdate, { id: "internal", title: "scalar" })))
      .toMatchObject({ id: "internal", title: "scalar" });
    expect(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductUpdate, [{ selector: { id: "internal" }, data: { title: "array" } }])))
      .toMatchObject([{ id: "internal", title: "array" }]);
    expect(takeProductRunnerEvents()).toEqual([]);
    const catalog = await run(captureProductSchema("internal-product-events").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const policy = productLocalEventPolicy(fixture.descriptor, catalog, () => Effect.void);
    const facts = after.facts.slice(before.facts.length).map((fact): Parameters<typeof policy.validate>[1][number] => {
      const codecVersion = fact.codecVersion;
      if (codecVersion !== 1 && codecVersion !== 2) throw new Error("Unexpected key codec");
      return { ...fact, codecVersion };
    });
    expect(await run(Effect.result(policy.validate([], facts, "productInternalProductcreate")))).toMatchObject({ _tag: "Success" });
    for (const command of ["productCreate", "productInternalProductupdate", "productInternalProductsoftDelete"])
      expect(await run(Effect.result(policy.validate([], facts, command)))).toMatchObject({ _tag: "Failure" });
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "public", title: "public" }));
    const events = takeProductRunnerEvents();
    expect(events).toHaveLength(1);
    expect(await run(Effect.result(policy.validate(events, facts, "productInternalProductcreate")))).toMatchObject({ _tag: "Failure" });
  });

  it("rolls back invalid arrays and authenticates internal lifecycle cascades", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "root", title: "root", options: [{ title: "size", values: ["S"] }],
      variants: [{ id: "variant", title: "small", options: { size: "S" } }],
    }));
    takeProductRunnerEvents();
    const before = await commerceInventory(fixture);
    for (const input of [
      [{ id: "root", title: "changed" }, { id: "missing", title: "failure" }],
      [{ id: "root", title: "changed" }, { title: "failure" }],
      { id: "root", manager: {} }, { id: "root", messageAggregator: {} },
      { id: "root", deleted_at: "2026-01-01T00:00:00.000Z" },
      { id: "root", images: [{ url: "unsupported" }] },
    ]) expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductUpdate, input)))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    const deleted = await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductSoftDelete, "root"));
    expect(deleted).toMatchObject([[{ id: "root", deleted_at: expect.any(String) }], { ProductVariant: [{ id: "variant", deleted_at: expect.any(String) }] }]);
    const deletedState = await commerceInventory(fixture);
    expect(deletedState.facts.length).toBeGreaterThan(before.facts.length + 1);
    const restored = await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalProductRestore, "root"));
    expect(restored).toMatchObject([[{ id: "root", deleted_at: null }], { ProductVariant: [{ id: "variant", deleted_at: null }] }]);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});

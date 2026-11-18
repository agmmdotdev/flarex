import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { coreProductSnapshot, coreProductNewMessages } from "./core-product-checks";
import { getCoreProductRunnerFixture, productIntegrationTestRunner, runCoreProductCommand } from "./core-product-runner";
const run = Effect.runPromise;

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Internal Product boundary", () => {
  it("searches active DML fields before paging and combines relation filters", async () => {
    const { product: { runtime }, reader } = getCoreProductRunnerFixture();
    await run(runCoreProductCommand(runtime.commands.internalProductCreate, [
      { id: "a", title: "Alpha", handle: "alpha" },
      { id: "b", title: "Plain", handle: "beta", subtitle: "NeEdLe" },
      { id: "c", title: "Plain", handle: "gamma", description: "needle" },
      { id: "d", title: "Plain", handle: "needle-only" },
      { id: "e", title: "Needle", handle: "deleted" },
    ]));
    await run(runCoreProductCommand(runtime.commands.internalProductSoftDelete, "e"));
    const input = { filters: { q: "needle" }, config: { select: ["id"] } };
    expect(await run(reader.read(runtime.commands.internalProductList, input))).toEqual([{ id: "b" }, { id: "c" }]);
    expect(await run(reader.read(runtime.commands.count, { ...input, config: { select: ["id"], skip: 1, take: 1 } })))
      .toEqual([[{ id: "c" }], 2]);
    expect(await run(reader.read(runtime.commands.internalProductList, { ...input, filters: { q: "needle", id: ["b", "d"] } })))
      .toEqual([{ id: "b" }]);
    await run(runCoreProductCommand(runtime.commands.createCategories, { id: "category", name: "category" }));
    await run(runCoreProductCommand(runtime.commands.update, { id: "b", data: { category_ids: ["category"] } }));
    expect(await run(reader.read(runtime.commands.internalProductList, { ...input, filters: { q: "needle", categories: { id: "category" } } })))
      .toEqual([{ id: "b" }]);
  });

  it("updates every selected internal batch member beyond the public default page", async () => {
    const { product, product: { runtime }, reader } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(product);
    const products = Array.from({ length: 16 }, (_, index) => ({ id: "batch-" + index, title: "before", handle: "batch-" + index }));
    await run(runCoreProductCommand(runtime.commands.internalProductCreate, products));
    const changes = products.map(product => ({ id: product.id, title: "after" }));
    const result = await run(runCoreProductCommand(runtime.commands.internalProductUpdate, changes));
    expect(result).toHaveLength(16);
    const read = await run(reader.read(runtime.commands.internalProductList, { config: { select: ["id", "title"] } }));
    expect(read).toHaveLength(16);
    expect(read).toEqual(expect.arrayContaining(changes));
    const after = await coreProductSnapshot(product);
    expect(after.families).toEqual(before.families);
    expect(after.revisions.length - before.revisions.length).toBe(32);
  });

  it("retains internal facts and replay with scalar and array results and no publication", async () => {
    const { product, product: { runtime, host: writer } } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(product);
    const key = writer.newRequestKey();
    const input = { id: "internal", title: "internal", handle: "internal" };
    const created = await run(runCoreProductCommand(runtime.commands.internalProductCreate, input, key));
    expect(created).toMatchObject(input);
    const after = await coreProductSnapshot(product);
    expect(after.revisions.slice(before.revisions.length)).toHaveLength(1);
    expect(after.families).toEqual(before.families);
    expect(await run(runCoreProductCommand(runtime.commands.internalProductCreate, input, key))).toEqual(created);
    expect(await coreProductSnapshot(product)).toEqual(after);
    expect(await run(runCoreProductCommand(runtime.commands.internalProductUpdate, { id: "internal", title: "scalar" })))
      .toMatchObject({ id: "internal", title: "scalar" });
    expect(await run(runCoreProductCommand(runtime.commands.internalProductUpdate, [{ selector: { id: "internal" }, data: { title: "array" } }])))
      .toMatchObject([{ id: "internal", title: "array" }]);
    const silent = await coreProductSnapshot(product);
    expect(silent.families).toEqual(before.families);
    expect(silent.revisions.length - after.revisions.length).toBe(2);
    await run(runCoreProductCommand(runtime.commands.create, { id: "public", title: "public" }));
    const published = await coreProductSnapshot(product);
    expect(coreProductNewMessages(silent, published)).toHaveLength(1);
  });

  it("rolls back invalid arrays and authenticates internal lifecycle cascades", async () => {
    const { product, product: { runtime } } = getCoreProductRunnerFixture();
    await run(runCoreProductCommand(runtime.commands.create, {
      id: "root", title: "root", options: [{ title: "size", values: ["S"] }],
      variants: [{ id: "variant", title: "small", options: { size: "S" } }],
    }));
    const before = await coreProductSnapshot(product);
    for (const input of [
      [{ id: "root", title: "changed" }, { id: "missing", title: "failure" }],
      [{ id: "root", title: "changed" }, { title: "failure" }],
      { id: "root", manager: {} }, { id: "root", messageAggregator: {} },
      { id: "root", deleted_at: "2026-01-01T00:00:00.000Z" },
      { id: "root", images: [{ url: "unsupported" }] },
    ]) expect(await run(Effect.result(runCoreProductCommand(runtime.commands.internalProductUpdate, input)))).toMatchObject({ _tag: "Failure" });
    expect(await coreProductSnapshot(product)).toEqual(before);
    const deleted = await run(runCoreProductCommand(runtime.commands.internalProductSoftDelete, "root"));
    expect(deleted).toMatchObject([[{ id: "root", deleted_at: expect.any(String) }], { ProductVariant: [{ id: "variant", deleted_at: expect.any(String) }] }]);
    const deletedState = await coreProductSnapshot(product);
    expect(deletedState.revisions.length).toBeGreaterThan(before.revisions.length + 1);
    const restored = await run(runCoreProductCommand(runtime.commands.internalProductRestore, "root"));
    expect(restored).toMatchObject([[{ id: "root", deleted_at: null }], { ProductVariant: [{ id: "variant", deleted_at: null }] }]);
    expect((await coreProductSnapshot(product)).families).toEqual(before.families);
  });
  it("coalesces duplicate internal lifecycle roots and preserves empty and missing native results", async () => {
    const { product, product: { runtime } } = getCoreProductRunnerFixture();
    const decode = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject),
      Schema.Record(Schema.String, Schema.Array(Schema.JsonObject))]));
    await run(runCoreProductCommand(runtime.commands.create, {
      id: "root", title: "root", options: [{ title: "size", values: ["S"] }],
      variants: [{ id: "variant", title: "small", options: { size: "S" } }],
    }));
    const before = await coreProductSnapshot(product);
    for (const command of [runtime.commands.internalProductSoftDelete, runtime.commands.internalProductRestore]) {
      expect(await run(runCoreProductCommand(command, []))).toEqual([[], {}]);
      expect(await run(runCoreProductCommand(command, ["missing"]))).toEqual([[], {}]);
    }
    const unchanged = await coreProductSnapshot(product);
    expect(unchanged.rows).toEqual(before.rows); expect(unchanged.revisions).toEqual(before.revisions);
    expect(unchanged.families).toEqual(before.families);
    const deleted = decode(await run(runCoreProductCommand(runtime.commands.internalProductSoftDelete, ["missing", "root", "root"])));
    expect(deleted[0]).toMatchObject([{ id: "root", deleted_at: expect.any(String) }]);
    expect(deleted[0]).toHaveLength(1);
    expect(deleted[1].ProductVariant).toMatchObject([{ id: "variant", deleted_at: expect.any(String) }]);
    const afterDelete = await coreProductSnapshot(product);
    expect(afterDelete.revisions.length - before.revisions.length).toBe(4);
    const restored = decode(await run(runCoreProductCommand(runtime.commands.internalProductRestore, ["missing", "root", "root"])));
    expect(restored[0]).toMatchObject([{ id: "root", deleted_at: null }]); expect(restored[0]).toHaveLength(1);
    expect(restored[1].ProductVariant).toMatchObject([{ id: "variant", deleted_at: null }]);
    const afterRestore = await coreProductSnapshot(product);
    expect(afterRestore.revisions.length - afterDelete.revisions.length).toBe(4);
    expect(afterRestore.families).toEqual(before.families);
  });
}) });

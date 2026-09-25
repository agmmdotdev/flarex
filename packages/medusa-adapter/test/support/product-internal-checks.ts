import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner, runLogicalProductCommand } from "./logical-product-runner";
const run = Effect.runPromise;

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Internal Product boundary", () => {
  it("searches active DML fields before paging and combines relation filters", async () => {
    const { product: { runtime }, reader } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.internalProductCreate, [
      { id: "a", title: "Alpha", handle: "alpha" },
      { id: "b", title: "Plain", handle: "beta", subtitle: "NeEdLe" },
      { id: "c", title: "Plain", handle: "gamma", description: "needle" },
      { id: "d", title: "Plain", handle: "needle-only" },
      { id: "e", title: "Needle", handle: "deleted" },
    ]));
    await run(runLogicalProductCommand(runtime.commands.internalProductSoftDelete, "e"));
    const input = { filters: { q: "needle" }, config: { select: ["id"] } };
    expect(await run(reader.read(runtime.commands.internalProductList, input))).toEqual([{ id: "b" }, { id: "c" }]);
    expect(await run(reader.read(runtime.commands.count, { ...input, config: { select: ["id"], skip: 1, take: 1 } })))
      .toEqual([[{ id: "c" }], 2]);
    expect(await run(reader.read(runtime.commands.internalProductList, { ...input, filters: { q: "needle", id: ["b", "d"] } })))
      .toEqual([{ id: "b" }]);
    await run(runLogicalProductCommand(runtime.commands.createCategories, { id: "category", name: "category" }));
    await run(runLogicalProductCommand(runtime.commands.update, { id: "b", data: { category_ids: ["category"] } }));
    expect(await run(reader.read(runtime.commands.internalProductList, { ...input, filters: { q: "needle", categories: { id: "category" } } })))
      .toEqual([{ id: "b" }]);
  });

  it("updates every selected internal batch member beyond the public default page", async () => {
    const { currency, product: { runtime }, reader } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    const products = Array.from({ length: 16 }, (_, index) => ({ id: "batch-" + index, title: "before", handle: "batch-" + index }));
    await run(runLogicalProductCommand(runtime.commands.internalProductCreate, products));
    const changes = products.map(product => ({ id: product.id, title: "after" }));
    const result = await run(runLogicalProductCommand(runtime.commands.internalProductUpdate, changes));
    expect(result).toHaveLength(16);
    const read = await run(reader.read(runtime.commands.internalProductList, { config: { select: ["id", "title"] } }));
    expect(read).toHaveLength(16);
    expect(read).toEqual(expect.arrayContaining(changes));
    const after = await logicalCurrencyInventory(currency);
    expect(after.events).toEqual(before.events);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(32);
  });

  it("retains internal facts and replay with scalar and array results and no publication", async () => {
    const { currency, product: { runtime }, writer } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    const key = writer.newRequestKey();
    const input = { id: "internal", title: "internal", handle: "internal" };
    const created = await run(runLogicalProductCommand(runtime.commands.internalProductCreate, input, key));
    expect(created).toMatchObject(input);
    const after = await logicalCurrencyInventory(currency);
    expect(after.rowChanges.slice(before.rowChanges.length)).toHaveLength(1);
    expect(after.events).toEqual(before.events);
    expect(await run(runLogicalProductCommand(runtime.commands.internalProductCreate, input, key))).toEqual(created);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
    expect(await run(runLogicalProductCommand(runtime.commands.internalProductUpdate, { id: "internal", title: "scalar" })))
      .toMatchObject({ id: "internal", title: "scalar" });
    expect(await run(runLogicalProductCommand(runtime.commands.internalProductUpdate, [{ selector: { id: "internal" }, data: { title: "array" } }])))
      .toMatchObject([{ id: "internal", title: "array" }]);
    const silent = await logicalCurrencyInventory(currency);
    expect(silent.events).toEqual(before.events);
    expect(silent.rowChanges.length - after.rowChanges.length).toBe(2);
    await run(runLogicalProductCommand(runtime.commands.create, { id: "public", title: "public" }));
    const published = await logicalCurrencyInventory(currency);
    expect(published.events.length - silent.events.length).toBe(1);
  });

  it("rolls back invalid arrays and authenticates internal lifecycle cascades", async () => {
    const { currency, product: { runtime } } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.create, {
      id: "root", title: "root", options: [{ title: "size", values: ["S"] }],
      variants: [{ id: "variant", title: "small", options: { size: "S" } }],
    }));
    const before = await logicalCurrencyInventory(currency);
    for (const input of [
      [{ id: "root", title: "changed" }, { id: "missing", title: "failure" }],
      [{ id: "root", title: "changed" }, { title: "failure" }],
      { id: "root", manager: {} }, { id: "root", messageAggregator: {} },
      { id: "root", deleted_at: "2026-01-01T00:00:00.000Z" },
      { id: "root", images: [{ url: "unsupported" }] },
    ]) expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.internalProductUpdate, input)))).toMatchObject({ _tag: "Failure" });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
    const deleted = await run(runLogicalProductCommand(runtime.commands.internalProductSoftDelete, "root"));
    expect(deleted).toMatchObject([[{ id: "root", deleted_at: expect.any(String) }], { ProductVariant: [{ id: "variant", deleted_at: expect.any(String) }] }]);
    const deletedState = await logicalCurrencyInventory(currency);
    expect(deletedState.rowChanges.length).toBeGreaterThan(before.rowChanges.length + 1);
    const restored = await run(runLogicalProductCommand(runtime.commands.internalProductRestore, "root"));
    expect(restored).toMatchObject([[{ id: "root", deleted_at: null }], { ProductVariant: [{ id: "variant", deleted_at: null }] }]);
    expect((await logicalCurrencyInventory(currency)).events).toEqual(before.events);
  });
}) });

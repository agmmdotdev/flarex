import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { decodeCategoryProjection } from "../../src/modules/product/category-projection";
import { coreProductSnapshot, coreProductNewMessages, createCoreProductScopePair, installCoreProductDocumentFault } from "./core-product-checks";
import type { CoreProductFixture } from "./core-product-fixture";
import { getCoreProductRunnerFixture, productIntegrationTestRunner, runCoreProductCommand } from "./core-product-runner";

const run = Effect.runPromise;
const decoded = (value: Parameters<typeof decodeCategoryProjection>[0]) =>
  run(Effect.fromResult(decodeCategoryProjection(value)));

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Product Category boundary", () => {
  it("isolates inverse products and tree reads from colliding foreign scope rows", async () => {
    const pair = await createCoreProductScopePair(getCoreProductRunnerFixture().product);
    const { product, foreign } = pair, { runtime } = product;
    const write = (selected: CoreProductFixture, command: CommerceCommand, input: Json) =>
      selected.run(selected.host.run(selected.host.newRequestKey(), command, input));
    try {
      for (const [selected, label] of [[product, "local"], [foreign, "foreign"]] as const) {
        await write(selected, selected.runtime.commands.internalProductCreate, { id: "product_owned", title: label, handle: label });
        await write(selected, selected.runtime.commands.createCategories, { id: "root", name: label + " root", products: [{ id: "product_owned" }] });
        await write(selected, selected.runtime.commands.createCategories, { id: "child", name: label + " child", parent_category_id: "root" });
      }
      await write(foreign, foreign.runtime.commands.createCategories, { id: "foreign_only", name: "foreign only", parent_category_id: "root" });
      const query = { filters: { id: "root", include_descendants_tree: true },
        config: { relations: ["products"], select: ["id", "name", "products.title"], take: 1 } };
      expect(await decoded(await product.run(product.host.read(runtime.commands.countCategories, query))))
        .toMatchObject([[{ id: "root", name: "local root", products: [{ id: "product_owned", title: "local" }],
          category_children: [{ id: "child", name: "local child", category_children: [] }] }], 1]);
      expect(await decoded(await foreign.run(foreign.host.read(foreign.runtime.commands.countCategories, query))))
        .toMatchObject([[{ id: "root", name: "foreign root", products: [{ id: "product_owned", title: "foreign" }],
          category_children: expect.arrayContaining([expect.objectContaining({ id: "child", name: "foreign child" }),
            expect.objectContaining({ id: "foreign_only", name: "foreign only" })]) }], 1]);
      const internal = { filters: { parent_category_id: ["root"] }, config: { relations: ["parent_category"] } };
      expect(await decoded(await product.run(product.host.read(runtime.commands.internalCategoryCount, internal))))
        .toMatchObject([[{ id: "child", name: "local child", parent_category: { id: "root", name: "local root" } }], 1]);
      const before = await coreProductSnapshot(product);
      await expect(write(product, runtime.commands.updateCategories, { id: "child", data: { parent_category_id: "foreign_only" } }))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await coreProductSnapshot(product)).toEqual(before);
      await write(product, runtime.commands.deleteCategories, "child");
      expect(await decoded(await product.run(product.host.read(runtime.commands.internalCategoryCount, internal)))).toEqual([[], 0]);
      expect(await decoded(await foreign.run(foreign.host.read(foreign.runtime.commands.internalCategoryCount, internal))))
        .toMatchObject([[{ id: "child", name: "foreign child" }, { id: "foreign_only", name: "foreign only" }], 2]);
    } finally { await pair.close(); }
  }, 180_000);

  it("rolls back a native tree move after a late materialization failure and replays", async () => {
    const { product, product: { runtime, host: writer }, reader } =
      getCoreProductRunnerFixture();
    for (const category of [{ id: "old", name: "old" }, { id: "new", name: "new" },
      { id: "moving", name: "moving", parent_category_id: "old" },
      { id: "leaf", name: "leaf", parent_category_id: "moving" },
      { id: "sibling", name: "sibling", parent_category_id: "old" }])
      await run(runCoreProductCommand(runtime.commands.createCategories, category));
    const input = { id: "moving", data: { parent_category_id: "new", rank: 0 } };
    const before = await coreProductSnapshot(product);
    const fault = await installCoreProductDocumentFault(product, { target: "business", at: 2 });
    try {
      await expect(run(runCoreProductCommand(runtime.commands.updateCategories, input)))
        .rejects.toMatchObject({ reason: "resourceFailure" });
      expect(await fault.visits()).toEqual([{ count: 2, is_called: true }]);
      expect(await coreProductSnapshot(product)).toEqual(before);
    } finally { await fault.close(); }
    const key = writer.newRequestKey();
    const result = await run(runCoreProductCommand(runtime.commands.updateCategories, input, key));
    const after = await coreProductSnapshot(product);
    expect(await decoded(await run(reader.read(runtime.commands.countCategories,
      { filters: { id: ["moving", "leaf", "sibling"] } }))))
      .toMatchObject([expect.arrayContaining([
        expect.objectContaining({ id: "moving", parent_category_id: "new", mpath: "new.moving", rank: 0 }),
        expect.objectContaining({ id: "leaf", parent_category_id: "moving", mpath: "new.moving.leaf" }),
        expect.objectContaining({ id: "sibling", rank: 0 }),
      ]), 3]);
    expect(after.revisions.length - before.revisions.length).toBe(3);
    expect(coreProductNewMessages(before, after).length).toBe(3);
    expect(await run(runCoreProductCommand(runtime.commands.updateCategories, input, key))).toEqual(result);
    expect(await coreProductSnapshot(product)).toEqual(after);
  }, 180_000);

  it("preserves the Product while deleting leaf membership and closing sibling ranks", async () => {
    const { product, product: { runtime, host: writer }, reader } = getCoreProductRunnerFixture();
    await run(runCoreProductCommand(runtime.commands.create,
      { id: "product", title: "product", handle: "product" }));
    await run(runCoreProductCommand(runtime.commands.createCategories, { id: "root", name: "root" }));
    await run(runCoreProductCommand(runtime.commands.createCategories,
      { id: "leaf", name: "leaf", parent_category_id: "root", products: [{ id: "product" }] }));
    await run(runCoreProductCommand(runtime.commands.createCategories,
      { id: "sibling", name: "sibling", parent_category_id: "root" }));
    const before = await coreProductSnapshot(product);
    const key = writer.newRequestKey();
    const result = await run(runCoreProductCommand(runtime.commands.deleteCategories, "leaf", key));
    const after = await coreProductSnapshot(product);
    expect(await run(reader.read(runtime.commands.retrieve, { id: "product" })))
      .toMatchObject({ id: "product", title: "product" });
    expect(await decoded(await run(reader.read(runtime.commands.countCategories,
      { filters: {}, config: { relations: ["products"] } }))))
      .toMatchObject([expect.arrayContaining([
        expect.objectContaining({ id: "root" }),
        expect.objectContaining({ id: "sibling", rank: 0 }),
      ]), 2]);
    expect(after.revisions.length - before.revisions.length).toBe(3);
    expect(after.revisions.filter(row => row.deleted).length -
      before.revisions.filter(row => row.deleted).length).toBe(2);
    expect(coreProductNewMessages(before, after).length).toBe(2);
    expect(await run(runCoreProductCommand(runtime.commands.deleteCategories, "leaf", key))).toEqual(result);
    expect(await coreProductSnapshot(product)).toEqual(after);
  }, 180_000);

  it("records final rank facts and authenticated batch events on replay", async () => {
    const { product, product: { runtime, host: writer }, reader } = getCoreProductRunnerFixture();
    await run(runCoreProductCommand(runtime.commands.createCategories,
      { id: "existing", name: "existing" }));
    const before = await coreProductSnapshot(product);
    const input = [{ id: "first", name: "first", rank: 0 }, { id: "second", name: "second", rank: 0 }];
    // Opaque command/event authority is verified by the native host and event
    // closure. The retired LogicalCall transcript forgery observer has no Core API.
    const key = writer.newRequestKey();
    const result = await run(runCoreProductCommand(runtime.commands.createCategories, input, key));
    const after = await coreProductSnapshot(product);
    expect(await decoded(await run(reader.read(runtime.commands.countCategories, { filters: {} }))))
      .toMatchObject([expect.arrayContaining([
        expect.objectContaining({ id: "existing", rank: 2 }),
        expect.objectContaining({ id: "first", rank: 1 }),
        expect.objectContaining({ id: "second", rank: 0 }),
      ]), 3]);
    expect(after.revisions.length - before.revisions.length).toBe(3);
    expect(coreProductNewMessages(before, after)).toHaveLength(3);
    expect(await run(runCoreProductCommand(runtime.commands.createCategories, input, key))).toEqual(result);
    expect(await coreProductSnapshot(product)).toEqual(after);
  }, 180_000);

  it("refuses cycles, forged paths, invalid ranks and foreign inputs without publication", async () => {
    const { product, product: { runtime } } = getCoreProductRunnerFixture();
    for (const category of [{ id: "root", name: "root" }, { id: "other", name: "other" },
      { id: "child", name: "child", parent_category_id: "root" }])
      await run(runCoreProductCommand(runtime.commands.createCategories, category));
    const before = await coreProductSnapshot(product);
    for (const input of [{ id: "root", data: { parent_category_id: "child" } },
      { id: "root", data: { parent_category_id: "root" } },
      { id: "child", data: { mpath: "forged" } }, { id: "child", data: { rank: -1 } },
      { id: "child", data: { scopeId: "foreign" } }])
      await expect(run(runCoreProductCommand(runtime.commands.updateCategories, input)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(run(runCoreProductCommand(runtime.commands.upsertCategories, [
      { id: "root", parent_category_id: "other" }, { id: "other", parent_category_id: "root" },
    ]))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    for (const input of [{ id: "ambiguous.id", name: "bad" }, { id: "__root__", name: "bad" },
      { name: "bad", parent_category_id: "__root__" },
      { name: "bad", products: [{ id: "missing" }] }])
      await expect(run(runCoreProductCommand(runtime.commands.createCategories, input)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await coreProductSnapshot(product)).toEqual(before);
  }, 180_000);
}) });

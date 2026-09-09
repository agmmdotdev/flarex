import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { decodeCategoryProjection } from "../../src/product-category-projection";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;

describe("Internal Category boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("retains write facts and replay with no internal publication while preserving public events", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const before = await commerceInventory(fixture);
    const key = fixture.host.newRequestKey();
    const input = [{ id: "first", name: "first", handle: "first" }, { id: "second", name: "second", handle: "second", rank: 0 }];
    const created = await run(fixture.host.run(key, runtime.commands.internalCategoryCreate, input));
    const after = await commerceInventory(fixture);
    const facts = after.facts.slice(before.facts.length);
    expect(facts.filter(fact => fact.operation === "insert")).toHaveLength(2);
    expect(facts.filter(fact => fact.operation === "update")).toHaveLength(1);
    expect(takeProductRunnerEvents()).toEqual([]);
    expect(await run(fixture.host.run(key, runtime.commands.internalCategoryCreate, input))).toEqual(created);
    expect(await commerceInventory(fixture)).toEqual(after);
    const catalog = await run(captureProductSchema("internal-category-events").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const policy = productLocalEventPolicy(fixture.descriptor, catalog, () => Effect.void);
    const rowFacts = facts.map((fact): Parameters<typeof policy.validate>[1][number] => {
      const codecVersion = fact.codecVersion;
      if (codecVersion !== 1 && codecVersion !== 2) throw new Error("Unexpected key codec");
      return { ...fact, codecVersion };
    });
    expect(await run(Effect.result(policy.validate([], rowFacts, "productInternalCategorycreate")))).toMatchObject({ _tag: "Success" });
    expect(await run(Effect.result(policy.validate([], rowFacts, "productCreatecategory")))).toMatchObject({ _tag: "Failure" });
    expect(await run(Effect.result(policy.validate([], rowFacts, "productInternalCategoryupdate")))).toMatchObject({ _tag: "Failure" });
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalCategoryUpdate, [{ id: "first", name: "changed", rank: 0 }]));
    const deleted = await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalCategoryDelete, ["first"]).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))));
    expect(deleted).toEqual(["first"]);
    expect(takeProductRunnerEvents()).toEqual([]);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "public", name: "public" }));
    const events = takeProductRunnerEvents();
    expect(events).toHaveLength(1);
    expect(await run(Effect.result(policy.validate(events, rowFacts, "productInternalCategorycreate")))).toMatchObject({ _tag: "Failure" });
  });

  it("rolls back an earlier array member when a later internal update fails", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalCategoryCreate, [{ id: "root", name: "root", handle: "root" }]));
    const before = await commerceInventory(fixture);
    const key = fixture.host.newRequestKey();
    expect(await run(Effect.result(fixture.host.run(key, runtime.commands.internalCategoryUpdate, [{ id: "root", name: "changed" }, { id: "missing", name: "failure" }])))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("refuses invalid complete arrays and authority fields without publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalCategoryCreate, [{ id: "root", name: "root", handle: "root" }, { id: "other", name: "other", handle: "other" }]));
    const before = await commerceInventory(fixture);
    for (const input of [
      [{ id: "root", parent_category_id: "other" }, { id: "other", parent_category_id: "root" }],
      [{ id: "root", name: "changed" }, { id: "other", mpath: "forged" }],
      [{ id: "root", rank: -1 }], [{ id: "root", parent_category_id: "foreign" }],
      [{ id: "root", manager: {} }], [{ id: "root", messageAggregator: {} }],
    ]) expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.internalCategoryUpdate, input)))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});

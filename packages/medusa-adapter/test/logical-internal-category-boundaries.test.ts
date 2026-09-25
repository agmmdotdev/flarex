import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLogicalCategoryCreateEventPolicy, productLogicalInternalCategoryPolicy } from "../src/product-local-events";
import { decodeCategoryProjection } from "../src/product-category-projection";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import type { CommerceHost } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Category test driver");
const cleanup: Array<() => Promise<void>> = [];
const run = Effect.runPromise;
type Source = Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type Product = Awaited<ReturnType<typeof prepareLogicalProductHost>>;
let source: Source;
let product: Product;
let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
let reader: CommerceHost;
const categories = () => reader.read(product.runtime.commands.internalCategoryList, { filters: {} })
  .pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value))));

async function command(operation: "create" | "update" | "delete" | "publicCreate") {
  const selected = operation === "create" ? product.runtime.commands.internalCategoryCreate
    : operation === "update" ? product.runtime.commands.internalCategoryUpdate
      : operation === "delete" ? product.runtime.commands.internalCategoryDelete
        : product.runtime.commands.createCategories;
  const publicPolicy = operation === "publicCreate" ? productLogicalCategoryCreateEventPolicy(catalog) : undefined;
  const validateLogical = publicPolicy?.validateLogical ??
    productLogicalInternalCategoryPolicy(catalog, operation === "publicCreate" ? "create" : operation).validateLogical;
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand(`logicalCategory${operation}`, (ctx, input) => ctx.call(participant, selected, input));
  const revision = createHash("sha256").update(`logical-category-${operation}`).digest("hex");
  const contract = publicPolicy === undefined ? undefined : defineCommerceEventContract({
    name: catalog.category.createdEvent, revision, internal: true, decode: publicPolicy.capture,
  });
  const host = await run(makeAtomicCommerceHost({ ...source.hostInput,
    identityAndAccessPolicy: { profile: `logical-category-${operation}` },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [selected], validateLogical,
      ...(contract === undefined ? {} : { events: { contracts: [contract], select: () => Effect.succeed(contract) } }) }],
    commands: [root],
    ...(contract === undefined ? {} : { events: { producerRevision: revision, contracts: [contract],
      subscribers: [{ id: "logical-category-public", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }),
  }));
  cleanup.push(() => run(host.close));
  return { host, root, run: (input: Parameters<typeof host.run>[2]) => host.run(host.newRequestKey(), root, input) };
}

describe("internal Category boundaries on shared logical Product storage", () => {
  beforeAll(async () => {
    source = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(source);
    cleanup.push(() => run(product.host.close));
    await run(product.host.initialize([]));
    reader = await run(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.internalCategoryList] }));
    cleanup.push(() => run(reader.close));
    catalog = await run(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length) throw new AggregateError(failures, "Logical Category cleanup failed");
  }, 120_000);

  it("retains silent ordered facts and replay while public creation publishes", async () => {
    const create = await command("create"), update = await command("update");
    const remove = await command("delete"), publicCreate = await command("publicCreate");
    const before = await logicalCurrencyInventory(source);
    const input = [{ id: "first", name: "first", handle: "first", parent_category_id: null, rank: 100 },
      { id: "second", name: "second", handle: "second", rank: 0 }];
    const key = create.host.newRequestKey();
    const created = await run(create.host.run(key, create.root, input));
    const after = await logicalCurrencyInventory(source);
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(after.revisions.length - before.revisions.length).toBe(2);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(await run(categories())).toMatchObject([
      { id: "first", rank: 1 }, { id: "second", rank: 0 },
    ]);
    expect(after.events).toEqual(before.events);
    expect(await run(create.host.run(key, create.root, input))).toEqual(created);
    expect(await logicalCurrencyInventory(source)).toEqual(after);
    await run(update.run([{ id: "first", name: "changed", rank: 0 }]));
    expect(await run(categories())).toMatchObject([
      { id: "first", name: "changed", rank: 0 }, { id: "second", rank: 1 },
    ]);
    expect(await run(remove.run(["first"]).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))))).toEqual(["first"]);
    expect(await run(categories())).toMatchObject([{ id: "second", rank: 0 }]);
    expect((await logicalCurrencyInventory(source)).events).toEqual(before.events);
    await run(publicCreate.run({ id: "public", name: "public" }));
    expect((await logicalCurrencyInventory(source)).events.length).toBe(before.events.length + 1);
  }, 120_000);

  it("rolls back an earlier array member when a later update fails", async () => {
    const create = await command("create"), update = await command("update");
    await run(create.run([{ id: "rollback-root", name: "root", handle: "rollback-root" }]));
    const before = await logicalCurrencyInventory(source);
    await expect(run(update.run([{ id: "rollback-root", name: "changed" },
      { id: "missing", name: "failure" }]))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await logicalCurrencyInventory(source)).toEqual(before);
  }, 120_000);

  it("accepts native generated Category identity and refuses an absent required handle", async () => {
    const create = await command("create");
    await expect(run(create.run([{ name: "missing handle", parent_category_id: null }]))).rejects
      .toMatchObject({ _tag: "CommerceTransactionError" });
    const result = await run(create.run([{ name: "generated category", handle: "generated-category", parent_category_id: null }]));
    const rows = await run(Effect.fromResult(decodeCategoryProjection(result)));
    expect(rows).toMatchObject([{ name: "generated category", parent_category_id: null }]);
    expect(await run(categories())).toContainEqual(expect.objectContaining({
      id: expect.stringMatching(/^pcat_/), name: "generated category", parent_category_id: null,
    }));
  }, 120_000);

  it("keeps ordered descendant paths across two native moves in one update", async () => {
    const create = await command("create"), update = await command("update");
    await run(create.run([{ id: "move-a", name: "A", handle: "move-a" },
      { id: "move-d", name: "D", handle: "move-d" }]));
    await run(create.run([{ id: "move-b", name: "B", handle: "move-b", parent_category_id: "move-a" }]));
    await run(create.run([{ id: "move-c", name: "C", handle: "move-c", parent_category_id: "move-b" }]));
    await run(update.run([{ id: "move-a", parent_category_id: "move-d" },
      { id: "move-b", parent_category_id: null }]));
    const rows = await run(categories());
    expect(rows).toContainEqual(expect.objectContaining({ id: "move-a", mpath: "move-d.move-a" }));
    expect(rows).toContainEqual(expect.objectContaining({ id: "move-b", mpath: "move-b" }));
    expect(rows).toContainEqual(expect.objectContaining({ id: "move-c", mpath: "move-b.move-c" }));
  }, 120_000);

  it("refuses invalid complete arrays and authority fields without publication", async () => {
    const create = await command("create"), update = await command("update");
    await run(create.run([{ id: "invalid-root", name: "root", handle: "invalid-root" },
      { id: "invalid-other", name: "other", handle: "invalid-other" }]));
    const before = await logicalCurrencyInventory(source);
    for (const input of [
      [{ id: "invalid-root", parent_category_id: "invalid-other" },
        { id: "invalid-other", parent_category_id: "invalid-root" }],
      [{ id: "invalid-root", name: "changed" }, { id: "invalid-other", mpath: "forged" }],
      [{ id: "invalid-root", rank: -1 }], [{ id: "invalid-root", parent_category_id: "foreign" }],
      [{ id: "invalid-root", manager: {} }], [{ id: "invalid-root", messageAggregator: {} }],
    ]) await expect(run(update.run(input))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await logicalCurrencyInventory(source)).toEqual(before);
  }, 120_000);

  it("refuses rank maintenance outside the selected root's sibling group", async () => {
    const policy = productLogicalInternalCategoryPolicy(catalog, "update");
    const rootBefore = { id: "selected", name: "selected", rank: 1, mpath: "selected",
      parent_category_id: null, deleted_at: null };
    const otherBefore = { id: "other", name: "other", rank: 1, mpath: "parent.other",
      parent_category_id: "parent", deleted_at: null };
    await expect(run(policy.validateLogical([{
      commandName: "productInternalCategoryupdate", mode: "write",
      input: [{ id: "selected", rank: 0 }], result: [{ id: "selected", rank: 0 }],
      events: [], fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0,
    }], [
      { ordinal: 0, table: catalog.category.table.name, operation: "patch",
        before: rootBefore, after: { ...rootBefore, rank: 0 } },
      { ordinal: 1, table: catalog.category.table.name, operation: "patch",
        before: otherBefore, after: { ...otherBefore, rank: 2 } },
    ], [], [], []))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(run(policy.validateLogical([{
      commandName: "productInternalCategoryupdate", mode: "write",
      input: [{ id: "selected", name: "changed" }], result: [{ id: "selected", name: "changed" }],
      events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
    }], [{ ordinal: 0, table: catalog.category.table.name, operation: "patch",
      before: rootBefore, after: { ...rootBefore, rank: 0 } }], [], [], [])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    const sameParentSibling = { ...otherBefore, parent_category_id: null, mpath: "other" };
    await expect(run(policy.validateLogical([{
      commandName: "productInternalCategoryupdate", mode: "write",
      input: [{ id: "selected", rank: 0 }], result: [{ id: "selected", rank: 0, mpath: "selected" }],
      events: [], fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0,
    }], [
      { ordinal: 0, table: catalog.category.table.name, operation: "patch",
        before: rootBefore, after: { ...rootBefore, rank: 0 } },
      { ordinal: 1, table: catalog.category.table.name, operation: "patch",
        before: sameParentSibling, after: { ...sameParentSibling, rank: 100 } },
    ], [], [], []))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    for (const forged of [
      { ...rootBefore, name: "changed", rank: 100 },
      { ...rootBefore, name: "changed", mpath: "elsewhere.selected" },
    ]) await expect(run(policy.validateLogical([{
      commandName: "productInternalCategoryupdate", mode: "write",
      input: [{ id: "selected", name: "changed" }], result: [forged],
      events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
    }], [{ ordinal: 0, table: catalog.category.table.name, operation: "patch",
      before: rootBefore, after: forged }], [], [], [])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(run(policy.validateLogical([{
      commandName: "productInternalCategoryupdate", mode: "write",
      input: [{ id: "selected", parent_category_id: "right" }],
      result: [{ id: "selected", parent_category_id: "right", rank: 1, mpath: "wrong.selected" }],
      events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
    }], [{ ordinal: 0, table: catalog.category.table.name, operation: "patch",
      before: rootBefore, after: { ...rootBefore, parent_category_id: "right", mpath: "wrong.selected" } }],
    [], [{ table: catalog.category.table.name, row: { id: "right", mpath: "right" } }], [])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    const createPolicy = productLogicalInternalCategoryPolicy(catalog, "create");
    await expect(run(createPolicy.validateLogical([{
      commandName: "productInternalCategorycreate", mode: "write",
      input: [{ id: "child", name: "child", handle: "child", parent_category_id: "right" }],
      result: [{ id: "child", rank: 0 }],
      events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
    }], [{ ordinal: 0, table: catalog.category.table.name, operation: "insert", before: null,
      after: { id: "child", name: "child", handle: "child", parent_category_id: "right",
        rank: 0, mpath: "wrong.child", deleted_at: null } }],
    [], [{ table: catalog.category.table.name, row: { id: "right", mpath: "right" } }], [])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
  });
});

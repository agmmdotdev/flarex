import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CommonEvents, Modules } from "@medusajs/framework/utils/portable";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productCallReceipts } from "../src/product-local-events";
import { decodeCategoryProjection } from "../src/product-category-projection";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand, type CommerceHost } from "../../persistence-postgres/src/commerceTransaction/commands";
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

async function command(operation: "create" | "update" | "delete" | "publicCreate" | "publicUpdate" | "publicDelete", preloadIds?: readonly string[]) {
  const selected = operation === "create" ? product.runtime.commands.internalCategoryCreate
    : operation === "update" ? product.runtime.commands.internalCategoryUpdate
      : operation === "delete" ? product.runtime.commands.internalCategoryDelete
        : operation === "publicCreate" ? product.runtime.commands.createCategories
          : operation === "publicUpdate" ? product.runtime.commands.updateCategories
            : product.runtime.commands.deleteCategories;
  const policy = product.runtime.logicalPolicy;
  const publicPolicy = operation.startsWith("public") ? policy : undefined;
  const validateLogicalCall = policy.validateLogicalCall;
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand(`logicalCategory${operation}`, (ctx, input) => Effect.gen(function* () {
    if (preloadIds !== undefined) yield* ctx.call(participant, product.runtime.commands.internalCategoryList,
      { filters: { id: [...preloadIds] }, config: { select: ["id"] } });
    return yield* ctx.call(participant, selected, input);
  }));
  const revision = createHash("sha256").update(`logical-category-${operation}`).digest("hex");
  const names = operation === "publicCreate" ? [catalog.category.createdEvent, catalog.category.updatedEvent]
    : operation === "publicUpdate" ? [catalog.category.updatedEvent]
      : operation === "publicDelete" ? [catalog.category.deletedEvent, catalog.category.updatedEvent] : [];
  const contracts = publicPolicy === undefined ? [] : names.map(name => defineCommerceEventContract({
    name, revision, internal: true, decode: publicPolicy.capture,
  }));
  const byName = new Map(names.map((name, index) => [name, contracts[index]]));
  const host = await run(makeAtomicCommerceHost({ ...source.hostInput,
    identityAndAccessPolicy: { profile: `logical-category-${operation}` },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [selected, ...(preloadIds === undefined ? [] : [product.runtime.commands.internalCategoryList])], validateLogicalCall,
      ...(publicPolicy === undefined ? {} : { events: { contracts, select: message => {
        const event = typeof message === "object" && message !== null && "name" in message &&
          typeof message.name === "string" ? byName.get(message.name) : undefined;
        return event === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(event);
      } } }) }],
    commands: [root],
    ...(publicPolicy === undefined ? {} : { events: { producerRevision: revision, contracts,
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

  it("replays public update/delete without duplicate facts or events and refuses a forged pivot", async () => {
    const create = await command("publicCreate"), update = await command("publicUpdate");
    const remove = await command("publicDelete");
    await run(create.run({ id: "public-replay", name: "Before" }));
    const updateInput = { id: "public-replay", data: { name: "After" } };
    const updateKey = update.host.newRequestKey();
    const updated = await run(update.host.run(updateKey, update.root, updateInput));
    const afterUpdate = await logicalCurrencyInventory(source);
    expect(await run(update.host.run(updateKey, update.root, updateInput))).toEqual(updated);
    expect(await logicalCurrencyInventory(source)).toEqual(afterUpdate);
    expect(await run(categories())).toContainEqual(expect.objectContaining({ id: "public-replay", name: "After" }));
    const deleteKey = remove.host.newRequestKey();
    const deleted = await run(remove.host.run(deleteKey, remove.root, ["public-replay"]));
    const afterDelete = await logicalCurrencyInventory(source);
    expect(await run(remove.host.run(deleteKey, remove.root, ["public-replay"]))).toEqual(deleted);
    expect(await logicalCurrencyInventory(source)).toEqual(afterDelete);
    expect(await run(categories())).not.toContainEqual(expect.objectContaining({ id: "public-replay" }));

    const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products")?.join;
    if (relation?.type !== "manyToMany") throw new Error("Missing Category Product pivot");
    const before = { id: "public-replay", name: "After", rank: 0, mpath: "public-replay",
      parent_category_id: null, deleted_at: null };
    const deletedEvent = { name: catalog.category.deletedEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.category.eventObject, action: CommonEvents.DELETED },
      data: { id: "public-replay" } };
    const deletion = { commandName: "productDeletecategory", mode: "write" as const,
      input: ["public-replay"], result: null, events: [deletedEvent],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const rootDelete = { ordinal: 0, table: catalog.category.table.name, operation: "delete" as const,
      before, after: null };
    const policy = productCallReceipts(catalog);
    await run(policy.validateLogicalCall(deletion, { mutations: [rootDelete], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }));
    await expect(run(policy.validateLogicalCall({ ...deletion, toAttempt: 2 }, { mutations: [rootDelete, {
      ordinal: 1, table: relation.pivotTable, operation: "delete" as const,
      before: { id: "forged", [relation.sourceColumns[0] ?? "category_id"]: "unselected" }, after: null,
    }], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(run(policy.validateLogicalCall({ ...deletion, events: [{ ...deletedEvent,
      data: { id: "unselected" } }] }, { mutations: [rootDelete], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] })))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });

    const updatePolicy = productCallReceipts(catalog);
    const updatedRow = { ...before, name: "Changed" };
    const updatedEvent = { name: catalog.category.updatedEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.category.eventObject, action: CommonEvents.UPDATED },
      data: { id: "public-replay" } };
    const updateReceipt = { commandName: "productupdatecategory", mode: "write" as const,
      input: { id: "public-replay", data: { name: "Changed" } }, result: updatedRow,
      events: [updatedEvent], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const updateMutation = { ordinal: 0, table: catalog.category.table.name, operation: "patch" as const,
      before, after: updatedRow };
    await run(updatePolicy.validateLogicalCall(updateReceipt, { mutations: [updateMutation], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }));
    await expect(run(updatePolicy.validateLogicalCall({ ...updateReceipt,
      result: { ...updatedRow, name: "Fabricated" } }, { mutations: [updateMutation], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] })))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    const { name: _omittedName, ...missingName } = updatedRow;
    await expect(run(updatePolicy.validateLogicalCall({ ...updateReceipt,
      result: missingName }, { mutations: [updateMutation], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] })))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
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

  it("confines matching Category parents and children to each shop", async () => {
    const create = await command("create");
    await run(create.run([{ id: "shared-root", name: "Shop A", handle: "shop-a" },
      { id: "shared-child", name: "Child A", handle: "child-a", parent_category_id: "shared-root" }]));
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: source.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_native_category_shop_b",
        projectId: "project_native_category_shop_b", uuidOffset: 22_000 },
    });
    const otherProduct = await prepareLogicalProductHost(other);
    cleanup.push(() => run(otherProduct.host.close));
    await run(otherProduct.host.initialize([]));
    const otherReader = await run(makeCommerceHost({ ...otherProduct.hostInput,
      commands: [otherProduct.runtime.commands.internalCategoryList] }));
    cleanup.push(() => run(otherReader.close));
    const otherParticipant = defineAtomicCommerceParticipant("product");
    const otherRoot = defineAtomicCommerceCommand("createOtherShopCategories", (ctx, input) =>
      ctx.call(otherParticipant, otherProduct.runtime.commands.internalCategoryCreate, input));
    const otherWriter = await run(makeAtomicCommerceHost({ ...other.hostInput,
      identityAndAccessPolicy: { profile: "native-category-other-shop" },
      participants: [{ participant: otherParticipant, logicalStorage: otherProduct.hostInput.logicalStorage,
        commands: [otherProduct.runtime.commands.internalCategoryCreate],
        validateLogicalCall: otherProduct.runtime.logicalPolicy.validateLogicalCall }],
      commands: [otherRoot],
    }));
    cleanup.push(() => run(otherWriter.close));
    await run(otherWriter.run(otherWriter.newRequestKey(), otherRoot,
      [{ id: "shared-root", name: "Shop B", handle: "shop-b" },
        { id: "shared-child", name: "Child B", handle: "child-b", parent_category_id: "shared-root" }]));
    const selected = { filters: { parent_category_id: "shared-root" } };
    const first = await run(reader.read(product.runtime.commands.internalCategoryList, selected)
      .pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))));
    const second = await run(otherReader.read(otherProduct.runtime.commands.internalCategoryList, selected)
      .pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))));
    expect(first).toMatchObject([{ id: "shared-child", name: "Child A", parent_category_id: "shared-root" }]);
    expect(second).toMatchObject([{ id: "shared-child", name: "Child B", parent_category_id: "shared-root" }]);
  }, 180_000);

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

  it("authenticates native tree maintenance and preserves sequential move semantics", async () => {
    const create = await command("create"), update = await command("update", ["guard-a", "guard-b"]);
    await run(create.run([{ id: "guard-a", name: "A", handle: "guard-a" },
      { id: "guard-b", name: "B", handle: "guard-b", parent_category_id: "guard-a" }]));
    const before = await logicalCurrencyInventory(source);
    for (const input of [
      [{ id: "guard-a", parent_category_id: "guard-b" }, { id: "guard-b", parent_category_id: null }],
      [{ id: "guard-a", parent_category_id: ["guard-b"] }],
      [{ id: "guard-a", parent_category_id: { length: 1 } }],
    ]) await expect(run(update.run(input))).rejects.toMatchObject({ reason: "adapterFailure" });
    expect(await logicalCurrencyInventory(source)).toEqual(before);
    await run(update.run([{ id: "guard-b", parent_category_id: null }, { id: "guard-a", parent_category_id: "guard-b" }]));
    expect(await run(categories())).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "guard-a", parent_category_id: "guard-b", mpath: "guard-b.guard-a" }),
      expect.objectContaining({ id: "guard-b", parent_category_id: null, mpath: "guard-b" }),
    ]));
    const counterfeit = defineCommerceCommand("productInternalCategoryupdate", "write", () => Effect.succeed([]));
    await expect(run(product.runtime.logicalPolicy.validateLogicalCall({
      commandName: "productInternalCategoryupdate", mode: "write", input: [], result: [],
      events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
    }, { mutations: [], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }, counterfeit)))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
  }, 120_000);

  it("validates selected ancestry beyond the unrelated Category row bound", async () => {
    const create = await command("create"), update = await command("update");
    const before = await logicalCurrencyInventory(source);
    for (let start = 0; start < 90; start++) {
      const id = `indexed-root-${start}`;
      await run(create.run([{ id, name: id, handle: id }]));
    }
    for (let number = 0; number < 180; number++) {
      const id = `indexed-child-${number}`;
      await run(create.run([{ id, name: id, handle: id, parent_category_id: `indexed-root-${number % 90}` }]));
    }
    const populated = await logicalCurrencyInventory(source);
    expect(populated.rows.length - before.rows.length).toBe(270);
    const selected = { id: "indexed-selected", name: "Selected", handle: "indexed-selected",
      parent_category_id: "indexed-child-0" };
    await run(create.run([selected]));
    expect(await run(reader.read(product.runtime.commands.internalCategoryList,
      { filters: { id: "indexed-selected" } }).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value))))))
      .toMatchObject([{ id: "indexed-selected", mpath: "indexed-root-0.indexed-child-0.indexed-selected" }]);
    const after = await logicalCurrencyInventory(source);
    await expect(run(update.run([{ id: "indexed-root-0", parent_category_id: "indexed-selected" }])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError", reason: "adapterFailure" });
    expect(await logicalCurrencyInventory(source)).toEqual(after);
  }, 300_000);
});

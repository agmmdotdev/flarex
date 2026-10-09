import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { CommonEvents, Modules } from "@medusajs/framework/utils/portable";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type AtomicCommerceCommand } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceDerivedIdEventContract, defineCommerceEventContract } from
  "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { decodeCategoryProjection } from "../src/product-category-projection";

import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid composition driver");
const run = Effect.runPromise;
const participant = defineAtomicCommerceParticipant("product");
const revision = "c".repeat(64);
const cleanup: Array<() => Promise<void>> = [];
let source: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
let policy: typeof product.runtime.logicalPolicy;

async function hostFor(root: AtomicCommerceCommand,
  validateLogicalCall: LogicalCommerceCallValidation = policy.validateLogicalCall,
  terminal?: "replace" | "delete") {
  const names = [catalog.category.createdEvent, catalog.category.updatedEvent, catalog.category.deletedEvent,
    catalog.collection.createdEvent, catalog.collection.updatedEvent, catalog.collection.deletedEvent,
    catalog.tag.createdEvent, catalog.tag.updatedEvent, catalog.tag.deletedEvent,
    catalog.product.createdEvent, catalog.product.deletedEvent];
  const named = names.map(name => ({ name,
    contract: defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture }) }));
  const updatedProduct = Result.getOrThrow(defineCommerceDerivedIdEventContract({
    name: catalog.product.updatedEvent, revision, internal: true,
    metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.UPDATED },
  }));
  const contracts = [...named.map(entry => entry.contract), updatedProduct];
  const commands = product.runtime.commands;
  const host = await run(makeAtomicCommerceHost({ ...source.hostInput,
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [commands.create, commands.update, commands.delete,
        commands.createCategories, commands.updateCategories, commands.deleteCategories,
        commands.internalCategoryCreate, commands.internalCategoryUpdate, commands.internalCategoryDelete,
        commands.retrieveCategory, commands.internalCategoryRetrieve, commands.listCategories,
        commands.createCollections, commands.updateCollections, commands.upsertCollections,
        commands.deleteCollections, commands.retrieveCollection, commands.listCollections,
        commands.createTags, commands.updateTagsBySelector, commands.softDeleteTags],
      validateLogicalCall,
      ...(terminal === "delete" ? { allowSetNull: true as const } : {}),
      ...(terminal === "replace" ? { allowReferenceReplacement: true as const,
        derivedIdEvent: { contract: updatedProduct } } : {}),
      events: { contracts, select: event => {
        const selected = isJsonObject(event) && typeof event.name === "string"
          ? event.name === catalog.product.updatedEvent ? updatedProduct
            : named.find(entry => entry.name === event.name)?.contract : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected);
      } } }],
    commands: [root], events: { producerRevision: revision, contracts,
      subscribers: [{ id: "category-collection-composition", revision }],
      ...(terminal === "replace" ? { derivedIdValidation: "capturedOnly" as const } : {}),
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  cleanup.push(() => run(host.close));
  return host;
}

describe("native Category and Collection call composition", () => {
  beforeAll(async () => {
    source = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(source);
    cleanup.push(() => run(product.host.close));
    await run(product.host.initialize([]));
    catalog = await run(captureProductSchema("category-collection-composition")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    policy = product.runtime.logicalPolicy;
    const seedPolicy = product.runtime.logicalPolicy;
    const event = defineCommerceEventContract({ name: catalog.product.createdEvent, revision,
      internal: true, decode: seedPolicy.capture });
    const seed = defineAtomicCommerceCommand("seedCompositionProduct", (ctx, input) =>
      ctx.call(participant, product.runtime.commands.create, input));
    const seedHost = await run(makeAtomicCommerceHost({ ...source.hostInput,
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
        commands: [product.runtime.commands.create], validateLogicalCall: seedPolicy.validateLogicalCall,
        events: { contracts: [event], select: () => Effect.succeed(event) } }], commands: [seed],
      events: { producerRevision: revision, contracts: [event],
        subscribers: [{ id: "composition-seed", revision }], validate: () => Effect.void },
    }));
    try {
      await run(seedHost.run(seedHost.newRequestKey(), seed, { id: "composition-product", title: "Member" }));
    } finally { await run(seedHost.close); }
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length > 0) throw new AggregateError(failures, "Composition cleanup failed");
  }, 120_000);

  it("composes repeated tree and Collection changes with pending reads, exact events and replay", async () => {
    const commands = product.runtime.commands;
    const seed = defineAtomicCommerceCommand("seedCompositionTree", (ctx, input) =>
      ctx.call(participant, commands.createCategories, input));
    const seedHost = await hostFor(seed);
    for (const input of [
      [{ id: "composition-a", name: "A" }, { id: "composition-b", name: "B" }],
      { id: "composition-child", name: "Child", parent_category_id: "composition-a",
        products: [{ id: "composition-product" }] },
      { id: "composition-leaf", name: "Leaf", parent_category_id: "composition-child",
        products: [{ id: "composition-product" }] },
    ]) await run(seedHost.run(seedHost.newRequestKey(), seed, input));
    let executions = 0;
    const root = defineAtomicCommerceCommand("mixedCategoryCollectionCalls", Effect.fn("Composition.mixed")(
      function* (ctx) {
        executions++;
        const collection = yield* ctx.call(participant, commands.createCollections,
          { id: "composition-collection", title: "First" });
        yield* ctx.call(participant, commands.updateCategories,
          { id: "composition-child", data: { parent_category_id: "composition-b" } });
        const moved = yield* ctx.call(participant, commands.retrieveCategory,
          { id: "composition-leaf", config: { select: ["id", "mpath", "parent_category_id"] } });
        const category = yield* ctx.call(participant, commands.updateCategories,
          { id: "composition-child", data: { name: "Final child" } });
        return { moved, category, collection };
      }));
    const host = await hostFor(root);
    const before = await logicalCurrencyInventory(source);
    const key = host.newRequestKey();
    const value = await run(host.run(key, root, null));
    expect(value).toMatchObject({
      moved: { payload: { id: "composition-leaf", mpath: "composition-b.composition-child.composition-leaf" } },
      category: { id: "composition-child", name: "Final child", parent_category_id: "composition-b" },
      collection: { id: "composition-collection", title: "First" },
    });
    const after = await logicalCurrencyInventory(source);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(after.physicalFacts).toEqual(before.physicalFacts);
    expect(new Set(after.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
    const messages = after.events.slice(before.events.length).map(event => event.envelope);
    expect(messages.map(event => event.contract).sort()).toEqual([
      ...Array<string>(3).fill(catalog.category.updatedEvent),
      catalog.collection.createdEvent,
    ].sort());
    expect(await run(host.run(key, root, null))).toEqual(value);
    expect(executions).toBe(1);
    expect(await logicalCurrencyInventory(source)).toEqual(after);
  }, 120_000);

  it("composes a public membership pivot with internal sibling reorder and public leaf deletion", async () => {
    const commands = product.runtime.commands;
    const seed = defineAtomicCommerceCommand("seedReorderTree", (ctx, input) =>
      ctx.call(participant, commands.createCategories, input));
    const seedHost = await hostFor(seed);
    await run(seedHost.run(seedHost.newRequestKey(), seed, { id: "reorder-parent", name: "Reorder" }));
    await run(seedHost.run(seedHost.newRequestKey(), seed, [
      { id: "reorder-a", name: "Reorder A", parent_category_id: "reorder-parent" },
      { id: "reorder-b", name: "Reorder B", parent_category_id: "reorder-parent" },
    ]));
    const root = defineAtomicCommerceCommand("nativeReorderComposition", Effect.fn("Composition.reorder")(
      function* (ctx) {
        yield* ctx.call(participant, commands.createCategories, { id: "reorder-leaf", name: "Reorder leaf",
          parent_category_id: "reorder-parent", products: [{ id: "composition-product" }] });
        const moved = yield* ctx.call(participant, commands.internalCategoryUpdate, [{ id: "reorder-b", rank: 0 }]);
        yield* ctx.call(participant, commands.deleteCategories, ["reorder-leaf"]);
        return moved;
      }));
    const host = await hostFor(root);
    const before = await logicalCurrencyInventory(source);
    const key = host.newRequestKey();
    const value = await run(host.run(key, root, null));
    expect(Result.getOrThrow(decodeCategoryProjection(value))).toMatchObject([{ id: "reorder-b", rank: 0 }]);
    const after = await logicalCurrencyInventory(source);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
      catalog.category.createdEvent, catalog.category.deletedEvent,
    ]);
    expect(await run(host.run(key, root, null))).toEqual(value);
    expect(await logicalCurrencyInventory(source)).toEqual(after);
    const reader = await run(makeCommerceHost({ ...product.hostInput, commands: [commands.internalCategoryList] }));
    cleanup.push(() => run(reader.close));
    const rows = await run(reader.read(commands.internalCategoryList,
      { filters: { parent_category_id: "reorder-parent" }, config: { order: { rank: "ASC" } } })
      .pipe(Effect.flatMap(result => Effect.fromResult(decodeCategoryProjection(result)))));
    expect(rows).toMatchObject([{ id: "reorder-b", rank: 0 }, { id: "reorder-a", rank: 1 }]);
    expect(rows).toHaveLength(2);
  }, 120_000);

  it("composes repeated Collection updates and mixed upsert with Tag creation", async () => {
    const commands = product.runtime.commands;
    let executions = 0;
    const root = defineAtomicCommerceCommand("repeatedCollectionCalls", Effect.fn("Composition.collections")(
      function* (ctx) {
        executions++;
        yield* ctx.call(participant, commands.createCollections,
          { id: "repeated-collection", title: "Initial", handle: "repeated-collection",
            metadata: { retained: true, removed: "old" } });
        yield* ctx.call(participant, commands.updateCollections,
          { id: "repeated-collection", data: { title: "Second", metadata: { removed: "", added: "second" } } });
        yield* ctx.call(participant, commands.upsertCollections, [
          { id: "repeated-collection", title: "Third", metadata: { added: "third" } }, { title: "Generated", handle: "composition-generated" },
        ]);
        yield* ctx.call(participant, commands.createTags, { id: "composition-tag", value: "Composed" });
        yield* ctx.call(participant, commands.updateCollections,
          { id: "repeated-collection", data: { title: "Final" } });
        return yield* ctx.call(participant, commands.retrieveCollection, { id: "repeated-collection" });
      }));
    const host = await hostFor(root);
    const before = await logicalCurrencyInventory(source);
    const key = host.newRequestKey();
    const value = await run(host.run(key, root, null));
    expect(value).toMatchObject({ id: "repeated-collection", title: "Final",
      metadata: { retained: true, added: "third" } });
    const after = await logicalCurrencyInventory(source);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract).sort()).toEqual([
      catalog.collection.createdEvent, catalog.collection.createdEvent, catalog.tag.createdEvent,
      ...Array<string>(3).fill(catalog.collection.updatedEvent),
    ].sort());
    expect(await run(host.run(key, root, null))).toEqual(value);
    expect(executions).toBe(1);
    expect(await logicalCurrencyInventory(source)).toEqual(after);
  }, 120_000);

  it("coalesces pending Product inserts, updates and deletes with terminal membership replacement", async () => {
    const commands = product.runtime.commands;
    const seed = defineAtomicCommerceCommand("seedPendingReplacement", (ctx) => Effect.gen(function* () {
      yield* ctx.call(participant, commands.createCollections, { id: "overlap-collection", title: "Overlap" });
      yield* ctx.call(participant, commands.create, [
        { id: "overlap-updated", title: "Before", collection_id: "overlap-collection" },
        { id: "overlap-deleted", title: "Deleted", collection_id: "overlap-collection" },
        { id: "overlap-detached", title: "Detached", collection_id: "overlap-collection" },
      ]);
      return null;
    }));
    const seedHost = await hostFor(seed);
    await run(seedHost.run(seedHost.newRequestKey(), seed, null));
    const root = defineAtomicCommerceCommand("pendingReplacement", (ctx, refuse) => Effect.gen(function* () {
      yield* ctx.call(participant, commands.create, { id: "overlap-created", title: "Created" });
      yield* ctx.call(participant, commands.update, { id: "overlap-updated", data: { title: "After" } });
      yield* ctx.call(participant, commands.delete, ["overlap-deleted"]);
      const result = yield* ctx.call(participant, commands.updateCollections, {
        id: "overlap-collection", data: { product_ids: ["overlap-created", "overlap-updated"] },
      });
      if (refuse === true) yield* ctx.call(participant, commands.listCollections, { filters: {} })
        .pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
      return result;
    }));
    const host = await hostFor(root, policy.validateLogicalCall, "replace");
    const before = await logicalCurrencyInventory(source);
    await expect(run(host.run(host.newRequestKey(), root, true))).rejects.toMatchObject({ reason: "rollbackOnly" });
    expect(await logicalCurrencyInventory(source)).toEqual(before);
    const key = host.newRequestKey();
    const value = await run(host.run(key, root, false));
    const after = await logicalCurrencyInventory(source);
    const facts = after.rowChanges.slice(before.rowChanges.length);
    const revisions = after.revisions.filter(row => row.commitSeq === facts[0]?.commitSeq);
    expect(facts).toHaveLength(5);
    expect(revisions).toHaveLength(5);
    expect(new Set(facts.map(row => row.tableId + "/" + row.rowId)).size).toBe(5);
    expect(new Set(facts.map(row => row.commitSeq)).size).toBe(1);
    const events = after.events.slice(before.events.length).map(row => row.envelope);
    expect(events.map(event => event.contract)).toEqual([
      catalog.product.createdEvent, catalog.product.updatedEvent, catalog.product.deletedEvent,
      catalog.collection.updatedEvent, catalog.product.updatedEvent,
      catalog.product.updatedEvent, catalog.product.updatedEvent,
    ]);
    expect(events.slice(4).map(event => event.message)).toMatchObject([
      { data: { id: "overlap-detached" } }, { data: { id: "overlap-created" } }, { data: { id: "overlap-updated" } },
    ]);
    expect(await run(product.host.read(commands.internalProductRetrieve, { id: "overlap-updated" })))
      .toMatchObject({ title: "After", collection_id: "overlap-collection" });
    expect(await run(product.host.read(commands.internalProductRetrieve, { id: "overlap-created" })))
      .toMatchObject({ title: "Created", collection_id: "overlap-collection" });
    expect(await run(product.host.read(commands.internalProductRetrieve, { id: "overlap-detached" })))
      .toMatchObject({ collection_id: null });
    expect(await run(product.host.read(commands.internalProductList, { filters: { id: "overlap-deleted" } }))).toEqual([]);
    expect(await run(host.run(key, root, false))).toEqual(value);
    expect(await logicalCurrencyInventory(source)).toEqual(after);
  }, 120_000);

  it("keeps a malformed later receipt sticky and rolls back earlier native calls", async () => {
    let reached = false;
    let writes = 0;
    const commands = product.runtime.commands;
    const validate: LogicalCommerceCallValidation = (call, activity, command) => {
      if (call.mode === "write") writes++;
      return policy.validateLogicalCall(call.commandName === "productupdatecategory"
        ? { ...call, result: { id: "late-category", name: "Forged" } } : call, activity, command);
    };
    const root = defineAtomicCommerceCommand("lateCategoryReceipt", Effect.fn("Composition.lateReceipt")(
      function* (ctx) {
        yield* ctx.call(participant, commands.createCollections, { id: "late-collection", title: "Before refusal" });
        yield* ctx.call(participant, commands.createCategories, { id: "late-category", name: "Before" });
        yield* ctx.call(participant, commands.updateCategories, { id: "late-category", data: { name: "After" } })
          .pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
        yield* ctx.call(participant, commands.retrieveCollection, { id: "late-collection" });
        reached = true;
        return null;
      }));
    const host = await hostFor(root, validate);
    const before = await logicalCurrencyInventory(source);
    const failure = await run(Effect.flip(host.run(host.newRequestKey(), root, null)));
    expect(failure).toMatchObject({ reason: "rollbackOnly" });
    if (!Cause.isCause(failure.cause)) throw new Error("Missing original receipt failure");
    expect(Result.getOrThrow(Cause.findError(failure.cause))).toMatchObject({ reason: "receiptMismatch" });
    expect(writes).toBe(3);
    expect(reached).toBe(false);
    expect(await logicalCurrencyInventory(source)).toEqual(before);
  }, 120_000);

  it.each(["replace", "delete"] as const)("preserves terminal %s admission after earlier scalar calls", async terminal => {
    const commands = product.runtime.commands;
    const id = "terminal-" + terminal;
    const seed = defineAtomicCommerceCommand("seedTerminal" + terminal, (ctx, input) =>
      ctx.call(participant, commands.createCollections, input));
    const seedHost = await hostFor(seed);
    await run(seedHost.run(seedHost.newRequestKey(), seed, { id, title: "Before", handle: id, product_ids: ["composition-product"] }));
    const root = defineAtomicCommerceCommand("terminalComposition" + terminal, Effect.fn("Composition.terminal")(
      function* (ctx, readAfter) {
        yield* ctx.call(participant, commands.createCategories, { id: id + "-category", name: "Pending", handle: id });
        yield* ctx.call(participant, commands.updateCollections, { id, data: { title: "Updated" } });
        const result = yield* ctx.call(participant,
          terminal === "replace" ? commands.updateCollections : commands.deleteCollections,
          terminal === "replace" ? { id, data: { product_ids: [] } } : [id]);
        if (readAfter === true) yield* ctx.call(participant, commands.listCategories, { filters: {} }).pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
        return result;
      }));
    const host = await hostFor(root, policy.validateLogicalCall, terminal);
    const before = await logicalCurrencyInventory(source);
    const failure = await run(Effect.exit(host.run(host.newRequestKey(), root, true)));
    if (!Exit.isFailure(failure)) throw new Error("Terminal operation unexpectedly committed");
    expect(failure.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason))
      .toEqual(expect.arrayContaining(["rollbackOnly", "invalidAuthority"]));
    expect(await logicalCurrencyInventory(source)).toEqual(before);
    const key = host.newRequestKey();
    const result = await run(host.run(key, root, false));
    const after = await logicalCurrencyInventory(source);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract).sort()).toEqual([
      catalog.category.createdEvent, catalog.collection.updatedEvent,
      terminal === "replace" ? catalog.collection.updatedEvent : catalog.collection.deletedEvent,
      ...(terminal === "replace" ? [catalog.product.updatedEvent] : []),
    ].sort());
    expect(await run(product.host.read(commands.internalProductRetrieve, { id: "composition-product" })))
      .toMatchObject({ collection_id: null });
    expect(await run(host.run(key, root, false))).toEqual(result);
    expect(await logicalCurrencyInventory(source)).toEqual(after);
  }, 120_000);
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { ProductModuleService } from "@medusajs/product/services";
import { MessageAggregator } from "@medusajs/framework/utils/portable";
import { Link } from "@medusajs/modules-sdk/link";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { productCategoryDeletionResources, productCategoryCreationResources, productCategoryUpdateResources } from "../src/workflow/policy";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductCategory } from "./support/logical-product-category-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductCategory>>;
let fixtureCleanupCount = 0;
const readRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const readIds = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })));
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)
  .orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq);
const deliveries = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)
  .orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId);
const revisions = () => connected.fixture.persistence.drizzle.select().from(fxAppRowRevisions);
const snapshot = async () => ({ rows: await rows(), events: await events(), commits: await commits(), deliveries: await deliveries() });
const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]; if (value === undefined) throw new Error("Expected a native Category result"); return value;
};
const WorkflowEvent = Schema.Struct({ name: Schema.Literals(["product-category.created", "product-category.updated", "product-category.deleted"]) });

function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return failurePath(reason.error);
      case "Die": return failurePath(reason.defect);
      case "Interrupt": return [reason._tag];
    }
  });
  if (value === null || typeof value !== "object") return [];
  const reason = Object.getOwnPropertyDescriptor(value, "reason")?.value;
  const cause = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : failurePath(cause))];
}

function observe(trace: string[], count?: { calls: number }): ExecutionDiagnosticPolicy {
  return { observe: (name, work) => Effect.sync(() => {
    if (count !== undefined && name === "BoundedRequest.enter") count.calls++;
  }).pipe(Effect.andThen(work), Effect.tap(value => Effect.sync(() => {
    if (name === "AtomicEvents.retain" && Schema.is(WorkflowEvent)(value)) trace.push(value.name);
  }))) };
}

async function removeActiveCategories() {
  // Cleanup uses the separately admitted ordinary physical leaf operation. Its
  // explicit fixture budget keeps a production-profile refusal from preventing
  // release of the existing large sibling graph.
  for (;;) {
    const active = readRows(await Effect.runPromise(connected.listCategories()));
    if (active.length === 0) return;
    const parents = new Set(active.map(row => row.parent_category_id));
    const leaves = active.filter(row => !parents.has(row.id)).slice(0, 4).map(row => row.id);
    const ids = Schema.decodeUnknownSync(Schema.Array(Schema.String))(leaves);
    if (ids.length === 0) throw new Error("Category cleanup encountered an invalid cycle");
    await connected.physicallyDeleteCategories(ids);
  }
}

describe("native Product Category workflows on shared logical storage", () => {
  beforeAll(async () => {
    connected = await prepareLogicalProductCategory(driver, close => cleanup.push(close));
    fixtureCleanupCount = cleanup.length;
  }, 180_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await removeActiveCategories();
    while (cleanup.length > fixtureCleanupCount) await cleanup.pop()?.();
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates empty and four-entry parent-before-child graphs with native nullish handles and events before hooks", async () => {
    const products = await connected.seedProducts("category-create-max");
    const trace: string[] = [], seen: string[][] = [], count = { calls: 0 };
    const host = await connected.prepareCreate({ categoriesCreated: async (input, context) => {
      expect(Object.hasOwn(input, "additional_data")).toBe(true);
      expect(input.additional_data).toEqual({ witness: "maximum" });
      expect(trace).toEqual(input.categories.map(() => "product-category.created"));
      trace.push("hook"); seen.push(input.categories.map(category => category.id));
      if (input.categories.length === 0) return;
      const graph = await context.resources.query.graph({ entity: "product_category", fields: ["id", "name"],
        filters: { id: input.categories.map(category => category.id) }, pagination: { take: 4 } });
      expect(graph.data).toEqual(input.categories.map(category => ({ id: category.id, name: category.name })));
    } });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductCategories");
    const beforeEmpty = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { product_categories: [], additional_data: { witness: "maximum" } })
      .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))))).toEqual([]);
    expect(trace).toEqual(["hook"]); expect(seen).toEqual([[]]); expect(native).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual(beforeEmpty.rows); expect(await events()).toEqual(beforeEmpty.events);
    trace.length = 0;
    const categories = [0, 1, 2, 3].map(index => ({ id: "pcat-create-max-" + index, name: "Category maximum " + index,
      ...(index === 1 ? { handle: null } : index === 2 ? { handle: "" } : {}),
      ...(index === 0 ? {} : { parent_category_id: "pcat-create-max-" + (index - 1) }),
      products: [{ id: products[index]! }], metadata: { nested: { index, enabled: true } } }));
    const before = await snapshot();
    const created = await Effect.runPromise(host.run(host.newRequestKey(), { product_categories: categories, additional_data: { witness: "maximum" } })
      .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count))));
    expect(created.map(category => category.id)).toEqual(categories.map(category => category.id));
    expect(created.map(category => category.handle)).toEqual(["category-maximum-0", "category-maximum-1", "", "category-maximum-3"]);
    expect(created.map(category => category.mpath)).toEqual(["pcat-create-max-0", "pcat-create-max-0.pcat-create-max-1",
      "pcat-create-max-0.pcat-create-max-1.pcat-create-max-2", "pcat-create-max-0.pcat-create-max-1.pcat-create-max-2.pcat-create-max-3"]);
    expect(created.map(category => category.metadata)).toEqual(categories.map(category => category.metadata));
    expect(seen).toEqual([[], created.map(category => category.id)]); expect(native).toHaveBeenCalledTimes(2);
    for (const [index, category] of created.entries()) expect(await Effect.runPromise(connected.categoryMembers(category.id)))
      .toMatchObject({ id: category.id, products: [{ id: products[index] }] });
    const emitted = (await events()).slice(before.events.length);
    expect(emitted.filter(event => event.envelope.contract === "product-category.created").map(event => event.envelope.message))
      .toEqual(created.map(category => expect.objectContaining({ data: { id: category.id } })));
    expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.category.createdEvent).map(event => event.envelope.message))
      .toEqual([expect.objectContaining({ data: { id: created.map(category => category.id) }, metadata: {
        source: "product", object: connected.product.runtime.metadata.category.eventObject, action: "created",
      } })]);
    expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.product.updatedEvent)).toHaveLength(0);
    expect((await commits()).length - before.commits.length).toBe(1);
    expect(count.calls).toBeGreaterThan(0); expect(count.calls).toBeLessThanOrEqual(productCategoryCreationResources.calls);
    expect(emitted.length).toBeLessThanOrEqual(productCategoryCreationResources.eventMessages);
    console.info("Category four-entry creation", { calls: count.calls, events: emitted.length });
  }, 120_000);

  it("uses native default Category ordering for reversed and duplicate selectors and replaces metadata", async () => {
    const create = await connected.prepareCreate(), ids = ["pcat-order-a", "pcat-order-b", "pcat-order-c", "pcat-order-d"];
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: ids.map((id, rank) => ({
      id, name: id, rank, metadata: { keep: true, nested: { old: true } },
    })) }));
    const preimages: string[][] = [], nativeResults: string[][] = [], hooks: string[][] = [];
    const update = await connected.prepareUpdate({ categoriesUpdated: input => { hooks.push(input.categories.map(category => category.id)); } });
    const originalList = ProductModuleService.prototype.listProductCategories;
    const originalUpdate = ProductModuleService.prototype.updateProductCategories;
    vi.spyOn(ProductModuleService.prototype, "listProductCategories").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(originalList, this, args); preimages.push(readIds(result).map(row => row.id)); return result;
    });
    vi.spyOn(ProductModuleService.prototype, "updateProductCategories").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(originalUpdate, this, args); nativeResults.push(readIds(result).map(row => row.id)); return result;
    });
    for (const requested of [[...ids].reverse(), [ids[1]!, ids[0]!, ids[1]!]]) {
      preimages.length = 0; nativeResults.length = 0; hooks.length = 0;
      const expected = requested.length === 4 ? ids : ids.slice(0, 2);
      const before = await snapshot(), key = update.newRequestKey();
      const input = { selector: { id: requested }, update: { metadata: { next: true } } };
      const changed = await Effect.runPromise(update.run(key, input));
      expect(preimages).toEqual([expected]); expect(nativeResults).toEqual([expected]); expect(hooks).toEqual([expected]);
      expect(changed.map(category => category.id)).toEqual(expected);
      expect(changed.map(category => category.metadata)).toEqual(expected.map(() => ({ next: true })));
      const emitted = (await events()).slice(before.events.length), moduleName = connected.product.runtime.metadata.category.updatedEvent;
      expect(emitted.filter(event => event.envelope.contract === moduleName).map(event => event.envelope.message))
        .toEqual([...expected.map(id => expect.objectContaining({ data: { id } })), expect.objectContaining({ data: { id: expected } })]);
      expect(emitted.filter(event => event.envelope.contract === "product-category.updated").map(event => event.envelope.message))
        .toEqual(expected.map(id => expect.objectContaining({ data: { id } })));
      const committed = await snapshot();
      expect(await Effect.runPromise(update.run(key, input))).toEqual(changed); expect(await snapshot()).toEqual(committed);
      expect(hooks).toEqual([expected]);
    }
    expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: ids[0]! }, update: {} }))).toMatchObject([{ id: ids[0] }]);
    expect(first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: ids[0]! }, update: { metadata: {} } }))).metadata).toEqual({});
    expect(first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: ids[0]! }, update: { metadata: null } }))).metadata).toBeNull();
    const beforeEmpty = await snapshot();
    expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: [] }, update: { metadata: { mustNotApply: true } } }))).toEqual([]);
    expect(await rows()).toEqual(beforeEmpty.rows); expect(await events()).toEqual(beforeEmpty.events);
  }, 120_000);

  it("moves native subtrees, clamps requested ranks and keeps parent preimages without accepting cycles or missing parents", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate();
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [
      { id: "pcat-tree-old", name: "Old" }, { id: "pcat-tree-new", name: "New" },
      { id: "pcat-tree-moving", name: "Moving", parent_category_id: "pcat-tree-old" },
      { id: "pcat-tree-leaf", name: "Leaf", parent_category_id: "pcat-tree-moving" },
    ] }));
    const nativeList = ProductModuleService.prototype.listProductCategories, preimages: unknown[] = [];
    vi.spyOn(ProductModuleService.prototype, "listProductCategories").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(nativeList, this, args); preimages.push(structuredClone(result)); return result;
    });
    const moved = await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: "pcat-tree-moving" },
      update: { parent_category_id: "pcat-tree-new", rank: 100 } }));
    expect(moved).toMatchObject([{ id: "pcat-tree-moving", parent_category_id: "pcat-tree-new", rank: 0,
      mpath: "pcat-tree-new.pcat-tree-moving" }]);
    expect(preimages).toMatchObject([[{ id: "pcat-tree-moving", parent_category_id: "pcat-tree-old", rank: 0 }]]);
    expect(readRows(await Effect.runPromise(connected.listCategories(["pcat-tree-leaf"]))))
      .toMatchObject([{ id: "pcat-tree-leaf", mpath: "pcat-tree-new.pcat-tree-moving.pcat-tree-leaf" }]);
    const before = await snapshot();
    for (const parent_category_id of ["pcat-tree-leaf", "pcat-tree-moving", "pcat-tree-missing"]) {
      const result = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: { id: "pcat-tree-moving" },
        update: { parent_category_id } })));
      expect(result._tag).toBe("Failure"); expect(await snapshot()).toEqual(before);
    }
    const renamed = await Effect.runPromise(update.run(update.newRequestKey(), { selector: { name: "Moving" }, update: { name: "Moved", is_active: true } }));
    expect(renamed).toMatchObject([{ id: "pcat-tree-moving", name: "Moved", handle: "moving", is_active: true }]);
    expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { handle: "moving", is_active: true }, update: {} })))
      .toMatchObject([{ id: "pcat-tree-moving" }]);
    const beforeMissing = await snapshot();
    expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: "pcat-update-missing" }, update: { name: "Missing" } }))).toEqual([]);
    expect(await rows()).toEqual(beforeMissing.rows); expect(await events()).toEqual(beforeMissing.events);
  }, 120_000);

  it("moves four selected subtrees across a complete sixteen-Category graph and exposes final pending ranks to the hook", async () => {
    const create = await connected.prepareCreate();
    const oldParent = "pcat-max-old", newParent = "pcat-max-new";
    const moving = [0, 1, 2, 3].map(index => "pcat-max-move-" + index);
    const stationary = ["pcat-max-stay-0", "pcat-max-stay-1"];
    const descendants = moving.flatMap(parent => [0, 1].map(index => ({
      id: parent + "-leaf-" + index, name: parent + " leaf " + index, parent_category_id: parent,
    })));
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [
      { id: oldParent, name: "Maximum old parent" }, { id: newParent, name: "Maximum new parent" },
    ] }));
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: moving.map(id => ({
      id, name: id, parent_category_id: oldParent,
    })) }));
    for (let offset = 0; offset < descendants.length; offset += 4)
      await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: descendants.slice(offset, offset + 4) }));
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: stationary.map(id => ({
      id, name: id, parent_category_id: newParent,
    })) }));
    expect(readRows(await Effect.runPromise(connected.listCategories()))).toHaveLength(16);
    const expectedCohort = [...moving.map((id, index) => ({ id, parent_category_id: newParent, rank: 3 - index,
      mpath: newParent + "." + id })), ...stationary.map((id, index) => ({ id, parent_category_id: newParent, rank: 4 + index,
      mpath: newParent + "." + id }))];
    const expectedDescendants = descendants.map(descendant => ({ id: descendant.id,
      parent_category_id: descendant.parent_category_id,
      mpath: newParent + "." + descendant.parent_category_id + "." + descendant.id }));
    const trace: string[] = [], count = { calls: 0 }; let hooks = 0;
    const update = await connected.prepareUpdate({ categoriesUpdated: async (input, context) => {
      hooks++;
      expect(input.categories.map(category => ({ id: category.id, rank: category.rank })))
        .toEqual(moving.map(id => ({ id, rank: 0 })));
      expect(trace).toEqual(moving.map(() => "product-category.updated"));
      const pending = await context.resources.query.graph({ entity: "product_category", fields: ["id", "rank", "mpath", "parent_category_id"],
        filters: { id: [...moving, ...stationary, ...descendants.map(descendant => descendant.id)] }, pagination: { take: 16 } });
      expect(pending.data).toHaveLength(14);
      expect(pending.data).toEqual(expect.arrayContaining(expectedCohort));
      expect(pending.data).toEqual(expect.arrayContaining(expectedDescendants.map(descendant => expect.objectContaining(descendant))));
      trace.push("hook");
    } });
    const before = await snapshot(), key = update.newRequestKey();
    const input = { selector: { id: [...moving].reverse() }, update: { parent_category_id: newParent, rank: 0 } };
    const result = await Effect.runPromise(update.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count))))
      .catch(async cause => {
        expect(await snapshot()).toEqual(before);
        console.info("Category maximum four-root subtree refusal with full rollback", { calls: count.calls, reasons: failurePath(cause) });
        throw cause;
      });
    expect(result.map(category => ({ id: category.id, rank: category.rank }))).toEqual(moving.map(id => ({ id, rank: 0 })));
    const stored = readRows(await Effect.runPromise(connected.listCategories()));
    expect(stored).toHaveLength(16);
    expect(stored).toEqual(expect.arrayContaining([...expectedCohort, ...expectedDescendants].map(category => expect.objectContaining(category))));
    const emitted = (await events()).slice(before.events.length);
    expect(emitted.filter(event => event.envelope.contract === "product-category.updated").map(event => event.envelope.message))
      .toEqual(moving.map(id => expect.objectContaining({ data: { id } })));
    expect((await commits()).length - before.commits.length).toBe(1);
    expect(count.calls).toBeGreaterThan(0); expect(count.calls).toBeLessThanOrEqual(productCategoryUpdateResources.calls);
    expect(emitted.length).toBeLessThanOrEqual(productCategoryUpdateResources.eventMessages);
    console.info("Category maximum four-root subtree update", { calls: count.calls, events: emitted.length });
    const committed = await snapshot();
    expect(await Effect.runPromise(update.run(key, input))).toEqual(result); expect(hooks).toBe(1); expect(await snapshot()).toEqual(committed);
  }, 180_000);

  it("creates four rank-zero roots over sixteen existing siblings and refuses a seventeenth initial identity atomically", async () => {
    const seed = await connected.prepareCreate();
    const existing = Array.from({ length: 16 }, (_, index) => "pcat-create-cohort-old-" + String(index).padStart(2, "0"));
    for (let offset = 0; offset < existing.length; offset += 4)
      await Effect.runPromise(seed.run(seed.newRequestKey(), { product_categories: existing.slice(offset, offset + 4).map(id => ({ id, name: id })) }));
    const added = [0, 1, 2, 3].map(index => "pcat-create-cohort-new-" + index);
    const trace: string[] = [], count = { calls: 0 };
    const host = await connected.prepareCreate({ categoriesCreated: async (input, context) => {
      expect(input.categories.map(category => ({ id: category.id, rank: category.rank }))).toEqual(added.map(id => ({ id, rank: 0 })));
      expect(trace).toEqual(added.map(() => "product-category.created"));
      const pending = await context.resources.query.graph({ entity: "product_category", fields: ["id", "rank"], pagination: { take: 20 } });
      expect(pending.data).toHaveLength(20);
      expect(pending.data).toEqual(expect.arrayContaining([...existing.map((id, index) => ({ id, rank: index + 4 })),
        ...added.map((id, index) => ({ id, rank: 3 - index }))]));
    } });
    try {
      const before = await snapshot();
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { product_categories: added.map(id => ({ id, name: id, rank: 0 })) })
        .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count))))
        .catch(async cause => {
          expect(await snapshot()).toEqual(before);
          console.info("Category maximum creation refusal with full rollback", { calls: count.calls, reasons: failurePath(cause) });
          throw cause;
        });
      expect(result.map(category => category.id)).toEqual(added);
      const stored = readRows(await Effect.runPromise(connected.listCategories()));
      expect(stored).toHaveLength(20);
      expect(stored).toEqual(expect.arrayContaining([...existing.map((id, index) => expect.objectContaining({ id, rank: index + 4 })),
        ...added.map((id, index) => expect.objectContaining({ id, rank: 3 - index }))]));
      const emitted = (await events()).slice(before.events.length), category = connected.product.runtime.metadata.category;
      expect(emitted.filter(event => event.envelope.contract === category.updatedEvent).map(event => event.envelope.message))
        .toEqual([...existing, ...added.slice(0, 3)].map(id => expect.objectContaining({ data: { id } })));
      expect(emitted.filter(event => event.envelope.contract === category.createdEvent).map(event => event.envelope.message))
        .toEqual([expect.objectContaining({ data: { id: added } })]);
      expect(emitted.filter(event => event.envelope.contract === "product-category.created").map(event => event.envelope.message))
        .toEqual(added.map(id => expect.objectContaining({ data: { id } })));
      expect((await commits()).length - before.commits.length).toBe(1);
      expect(count.calls).toBeGreaterThan(0); expect(count.calls).toBeLessThanOrEqual(productCategoryCreationResources.calls);
      expect(emitted.length).toBeLessThanOrEqual(productCategoryCreationResources.eventMessages);
      console.info("Category maximum four-entry sibling-shifting creation", { calls: count.calls, events: emitted.length });
      // The next named command has its own initial sixteen-identity boundary.
      // Use the separately supported physical operation to leave exactly
      // seventeen active roots, then witness a complete refusal and rollback.
      await connected.physicallyDeleteCategories(added.slice(0, 3));
      expect(readRows(await Effect.runPromise(connected.listCategories()))).toHaveLength(17);
      const update = await connected.prepareUpdate(), beforeOverflow = await snapshot();
      const overflow = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), {
        selector: { id: first(existing) }, update: { rank: 0, metadata: { mustNotPublish: true } },
      })));
      expect(overflow._tag).toBe("Failure");
      if (overflow._tag === "Failure") expect(failurePath(overflow.failure)).toContain("unsupportedProfile");
      expect(await snapshot()).toEqual(beforeOverflow);
    } finally {
      const activeAdded = readIds(await Effect.runPromise(connected.listCategories(added))).map(category => category.id);
      await connected.physicallyDeleteCategories(activeAdded);
    }
  }, 180_000);

  it("rolls back earlier rank writes when a later selected cohort crosses sixteen initial Category identities", async () => {
    const create = await connected.prepareCreate();
    const parents = [0, 1, 2, 3].map(index => "pcat-late-closure-parent-" + index);
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: parents.map(id => ({ id, name: id })) }));
    const selected: string[] = [];
    for (const [parentIndex, parent] of parents.entries()) {
      const children = [0, 1, 2, 3].map(index => ({ id: "pcat-late-closure-child-" + parentIndex + "-" + index,
        name: "Late closure child " + parentIndex + " " + index, parent_category_id: parent }));
      selected.push(first(children).id);
      await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: children }));
    }
    expect(readRows(await Effect.runPromise(connected.listCategories()))).toHaveLength(20);
    const hook = vi.fn(), update = await connected.prepareUpdate({ categoriesUpdated: hook });
    const callbacks = vi.spyOn(MessageAggregator.prototype, "saveRawMessageData");
    const preimages = vi.spyOn(ProductModuleService.prototype, "listProductCategories");
    const before = await snapshot();
    // Rank-only preimages do not hydrate the whole tree. Each subsequent
    // selected update discovers its actual parent and sibling cohort after the
    // preceding cohort has already completed native rank mutation callbacks.
    const result = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), {
      selector: { id: selected }, update: { rank: 3 },
    })));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(preimages).toHaveBeenCalledExactlyOnceWith({ id: selected }, { select: ["id", "rank"], relations: [] }, expect.any(Object));
    expect(callbacks.mock.calls.some(([messages]) => (Array.isArray(messages) ? messages : [messages]).some(message => message.action === "updated"))).toBe(true);
    expect(hook).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    // The admitted creation can leave twenty rows. Cleanup uses the existing
    // separate physical operation rather than widening this initial read cap.
  }, 180_000);

  it("preserves duplicate native leaf-deletion ranks, Product pivots and the full Link tuple before the hook", async () => {
    const products = await connected.seedProducts("category-delete-pivots", 1), create = await connected.prepareCreate();
    const ids = ["pcat-delete-a", "pcat-delete-b", "pcat-delete-c", "pcat-delete-d"];
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: ids.map((id, rank) => ({
      id, name: id, rank, ...(rank === 0 ? { products: [{ id: first(products) }] } : {}),
    })) }));
    const productsBefore = await Effect.runPromise(connected.listProducts(products));
    expect(await Effect.runPromise(connected.categoryMembers(first(ids)))).toMatchObject({ products: [{ id: first(products) }] });
    const requested = [first(ids), first(ids)], trace: string[] = [];
    const deletion = await connected.prepareDelete({ categoriesDeleted: async (input, context) => {
      expect(input.ids).toEqual(requested); expect(trace.filter(value => value === "product-category.deleted")).toHaveLength(2);
      expect(trace).toContain("native-link-completed"); trace.push("hook");
      expect(await context.resources.query.graph({ entity: "product_category", fields: ["id", "rank"],
        filters: { id: [first(ids)] }, pagination: { take: 1 } })).toMatchObject({ data: [] });
    } });
    const originalDelete = Link.prototype.delete;
    const native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(originalDelete, this, args); trace.push("native-link-completed"); return result;
    });
    const before = await snapshot(), tombstones = (await revisions()).filter(row => row.isTombstone).length;
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), requested)
      .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))))).toBeNull();
    expect(native).toHaveBeenCalledExactlyOnceWith({ product: { product_category_id: requested } });
    expect(await native.mock.results[0]?.value).toEqual([null, {}]); expect(trace.at(-1)).toBe("hook");
    expect(readRows(await Effect.runPromise(connected.listCategories(ids))).map(category => ({ id: category.id, rank: category.rank })))
      .toEqual([{ id: ids[1], rank: -1 }, { id: ids[2], rank: 0 }, { id: ids[3], rank: 1 }]);
    expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones);
    expect(await rows()).toHaveLength(before.rows.length);
    const emitted = (await events()).slice(before.events.length), category = connected.product.runtime.metadata.category;
    expect(emitted.filter(event => event.envelope.contract === category.deletedEvent).map(event => event.envelope.message))
      .toEqual([expect.objectContaining({ data: { id: first(ids) } })]);
    expect(emitted.filter(event => event.envelope.contract === category.updatedEvent)).toHaveLength(3);
    expect(emitted.filter(event => event.envelope.contract === "product-category.deleted").map(event => event.envelope.message))
      .toEqual(requested.map(id => expect.objectContaining({ data: { id } })));
    const update = await connected.prepareUpdate();
    expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: ids[1]! }, update: { metadata: { negative: "retained" } } })))
      .toMatchObject([{ id: ids[1], rank: -1, metadata: { negative: "retained" } }]);
    const reused = await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [{ name: "Reused handle", handle: first(ids) }] }));
    expect(first(reused).id).not.toBe(first(ids));
    expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
  }, 120_000);

  it("deletes distinct leaves in either order and retains all four duplicate decrements", async () => {
    const create = await connected.prepareCreate(), deletion = await connected.prepareDelete();
    for (const mode of ["forward", "reverse", "four-duplicates"] as const) {
      const ids = [0, 1, 2, 3].map(index => "pcat-leaf-order-" + mode + "-" + index);
      await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: ids.map((id, rank) => ({ id, name: id, rank })) }));
      const a = first(ids), b = first(ids.slice(1));
      const requested = mode === "forward" ? [a, b] : mode === "reverse" ? [b, a] : [a, a, a, a];
      const before = await snapshot(), key = deletion.newRequestKey();
      expect(await Effect.runPromise(deletion.run(key, requested))).toBeNull();
      const stored = readRows(await Effect.runPromise(connected.listCategories(ids)));
      expect(stored.map(category => ({ id: category.id, rank: category.rank }))).toEqual(mode === "four-duplicates"
        ? ids.slice(1).map((id, index) => ({ id, rank: -3 + index }))
        : ids.slice(2).map((id, index) => ({ id, rank: index })));
      const emitted = (await events()).slice(before.events.length);
      expect(emitted.filter(event => event.envelope.contract === "product-category.deleted").map(event => event.envelope.message))
        .toEqual(requested.map(id => expect.objectContaining({ data: { id } })));
      expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.category.deletedEvent).map(event => event.envelope.message))
        .toEqual([...new Set(requested)].map(id => expect.objectContaining({ data: { id } })));
      expect((await commits()).length - before.commits.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(deletion.run(key, requested))).toBeNull(); expect(await snapshot()).toEqual(committed);
      await removeActiveCategories();
    }
  }, 180_000);

  it("deletes four duplicate roots across sixteen siblings with native signed ranks and final pending hook views", async () => {
    const create = await connected.prepareCreate();
    const siblings = Array.from({ length: 16 }, (_, index) => "pcat-delete-max-" + String(index).padStart(2, "0"));
    for (let offset = 0; offset < siblings.length; offset += 4)
      await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: siblings.slice(offset, offset + 4).map(id => ({ id, name: id })) }));
    const requested = Array.from({ length: 4 }, () => first(siblings));
    const expected = siblings.slice(1).map((id, index) => ({ id, rank: index - 3 }));
    const trace: string[] = [], count = { calls: 0 }; let hooks = 0;
    const deletion = await connected.prepareDelete({ categoriesDeleted: async (input, context) => {
      hooks++; expect(input.ids).toEqual(requested);
      expect(trace).toEqual(requested.map(() => "product-category.deleted"));
      const pending = await context.resources.query.graph({ entity: "product_category", fields: ["id", "rank"], pagination: { take: 16 } });
      expect(pending.data).toEqual(expected); trace.push("hook");
    } });
    const before = await snapshot(), key = deletion.newRequestKey();
    expect(await Effect.runPromise(deletion.run(key, requested).pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count))))
      .catch(async cause => {
        expect(await snapshot()).toEqual(before);
        console.info("Category maximum duplicate deletion refusal with full rollback", { calls: count.calls, reasons: failurePath(cause) });
        throw cause;
      })).toBeNull();
    expect(readRows(await Effect.runPromise(connected.listCategories(siblings))).map(row => ({ id: row.id, rank: row.rank }))).toEqual(expected);
    const emitted = (await events()).slice(before.events.length), category = connected.product.runtime.metadata.category;
    expect(emitted.filter(event => event.envelope.contract === category.updatedEvent).map(event => event.envelope.message))
      .toEqual(siblings.slice(1).map(id => expect.objectContaining({ data: { id } })));
    expect(emitted.filter(event => event.envelope.contract === category.deletedEvent).map(event => event.envelope.message))
      .toEqual([expect.objectContaining({ data: { id: first(siblings) } })]);
    expect(emitted.filter(event => event.envelope.contract === "product-category.deleted").map(event => event.envelope.message))
      .toEqual(requested.map(id => expect.objectContaining({ data: { id } })));
    expect((await commits()).length - before.commits.length).toBe(1);
    expect(count.calls).toBeGreaterThan(0); expect(count.calls).toBeLessThanOrEqual(productCategoryDeletionResources.calls);
    expect(emitted.length).toBeLessThanOrEqual(productCategoryDeletionResources.eventMessages);
    console.info("Category maximum four-duplicate sibling deletion", { calls: count.calls, events: emitted.length });
    const committed = await snapshot();
    expect(await Effect.runPromise(deletion.run(key, requested))).toBeNull(); expect(hooks).toBe(1); expect(await snapshot()).toEqual(committed);
  }, 180_000);

  it("preserves more than four existing Product pivots without traversing or mutating their owners", async () => {
    const create = await connected.prepareCreate(), deletion = await connected.prepareDelete();
    const category = first(await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [{ name: "Category many existing Products" }] })));
    const products = [...await connected.seedProducts("category-backrefs-left", 4, category.id),
      ...await connected.seedProducts("category-backrefs-right", 4, category.id)];
    const members = Schema.decodeUnknownSync(Schema.Struct({ products: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
      await Effect.runPromise(connected.categoryMembers(category.id)));
    expect(new Set(members.products.map(product => product.id))).toEqual(new Set(products));
    const productsBefore = await Effect.runPromise(connected.listProducts(products)), before = await snapshot();
    const tombstones = (await revisions()).filter(row => row.isTombstone).length;
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), [category.id]))).toBeNull();
    expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
    const after = await snapshot();
    expect(after.rows).toHaveLength(before.rows.length);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones);
    // A single root pointer advances. All eight Product and eight pivot
    // pointers retain their exact original committed identities and revisions.
    expect(after.rows.filter((row, index) => row.commitSeq !== before.rows[index]?.commitSeq)).toHaveLength(1);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract))
      .toEqual([connected.product.runtime.metadata.category.deletedEvent, "product-category.deleted"]);
  }, 120_000);

  it("runs empty deletion and refuses missing, already-deleted and parent-child roots atomically in both orders", async () => {
    const create = await connected.prepareCreate(), deletion = await connected.prepareDelete();
    const beforeEmpty = await snapshot();
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), []))).toBeNull();
    expect(await rows()).toEqual(beforeEmpty.rows); expect(await events()).toEqual(beforeEmpty.events);
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [
      { id: "pcat-leaf-parent", name: "Parent" }, { id: "pcat-leaf-child", name: "Child", parent_category_id: "pcat-leaf-parent" },
    ] }));
    const before = await snapshot();
    for (const input of [["pcat-leaf-missing"], ["pcat-leaf-parent", "pcat-leaf-child"], ["pcat-leaf-child", "pcat-leaf-parent"],
      ["pcat-leaf-child", "pcat-leaf-missing"]]) {
      const result = await Effect.runPromise(Effect.result(deletion.run(deletion.newRequestKey(), input)));
      expect(result._tag).toBe("Failure"); expect(await snapshot()).toEqual(before);
    }
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), ["pcat-leaf-child"]))).toBeNull();
    const after = await snapshot();
    const repeated = await Effect.runPromise(Effect.result(deletion.run(deletion.newRequestKey(), ["pcat-leaf-child"])));
    expect(repeated._tag).toBe("Failure"); expect(await snapshot()).toEqual(after);
  }, 120_000);

  it("physically removes soft-deleted Category descendants and their retained pivots while preserving Products", async () => {
    const products = await connected.seedProducts("category-physical-descendant-products", 2);
    const productsBefore = await Effect.runPromise(connected.listProducts(products));
    const pointerKey = (row: typeof fxAppRowCurrent.$inferSelect) => [row.scopeUuid, row.tableId, Buffer.from(row.rowId).toString("hex")].join(":");
    const beforeCreation = new Set((await rows()).map(pointerKey));
    const create = await connected.prepareCreate(), deletion = await connected.prepareDelete();
    const ids = ["pcat-physical-parent", "pcat-physical-child", "pcat-physical-grandchild"];
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [
      { id: first(ids), name: "Physical parent" },
      { id: first(ids.slice(1)), name: "Physical child", parent_category_id: first(ids), products: [{ id: first(products) }] },
      { id: first(ids.slice(2)), name: "Physical grandchild", parent_category_id: first(ids.slice(1)), products: [{ id: first(products.slice(1)) }] },
    ] }));
    const ownedPointers = new Set((await rows()).filter(row => !beforeCreation.has(pointerKey(row))).map(pointerKey));
    expect(ownedPointers.size).toBe(5); // Three Categories and their two pivots.
    const tombstonesBefore = (await revisions()).filter(row => row.isTombstone).length;
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), [first(ids.slice(2))]))).toBeNull();
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), [first(ids.slice(1))]))).toBeNull();
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstonesBefore);
    expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
    const beforePhysical = await snapshot();
    await connected.physicallyDeleteCategories([first(ids)]);
    expect(await Effect.runPromise(connected.listCategories(ids))).toEqual([]);
    expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
    const current = await connected.fixture.persistence.drizzle.select({
      scopeUuid: fxAppRowCurrent.scopeUuid, tableId: fxAppRowCurrent.tableId, rowId: fxAppRowCurrent.rowId,
      commitSeq: fxAppRowCurrent.commitSeq, isTombstone: fxAppRowRevisions.isTombstone,
    }).from(fxAppRowCurrent).innerJoin(fxAppRowRevisions, and(
      eq(fxAppRowCurrent.scopeUuid, fxAppRowRevisions.scopeUuid), eq(fxAppRowCurrent.tableId, fxAppRowRevisions.tableId),
      eq(fxAppRowCurrent.rowId, fxAppRowRevisions.rowId), eq(fxAppRowCurrent.commitSeq, fxAppRowRevisions.commitSeq),
    ));
    const removed = current.filter(row => ownedPointers.has(pointerKey(row)));
    expect(removed).toHaveLength(5); expect(removed.every(row => row.isTombstone)).toBe(true);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstonesBefore + 5);
    expect((await commits()).length - beforePhysical.commits.length).toBe(1);
    const emitted = (await events()).slice(beforePhysical.events.length);
    expect(emitted.map(event => event.envelope.contract)).toEqual([connected.product.runtime.metadata.category.deletedEvent]);
    expect(emitted.map(event => event.envelope.message)).toEqual([expect.objectContaining({ data: { id: first(ids) } })]);
  }, 120_000);

  it("refuses oversized roots, complete fifth selected roots and depth overflow without publishing a prefix", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate(), deletion = await connected.prepareDelete();
    const ids = Array.from({ length: 5 }, (_, index) => "pcat-bounds-" + index);
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: ids.slice(0, 4).map(id => ({ id, name: id })) }));
    await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [{ id: first(ids.slice(4)), name: first(ids) + " fifth" }] }));
    const before = await snapshot();
    const fifth = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: {}, update: { metadata: { wrong: true } } })));
    expect(fifth._tag).toBe("Failure"); if (fifth._tag === "Failure") expect(failurePath(fifth.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    for (const work of [create.run(create.newRequestKey(), { product_categories: ids.map(id => ({ name: id + "overflow" })) }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: ids }, update: {} }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), ids).pipe(Effect.asVoid),
      create.run(create.newRequestKey(), { product_categories: [
        { id: "pcat-deep-1", name: "Deep1", parent_category_id: first(ids) },
        { id: "pcat-deep-2", name: "Deep2", parent_category_id: "pcat-deep-1" },
        { id: "pcat-deep-3", name: "Deep3", parent_category_id: "pcat-deep-2" },
        { id: "pcat-deep-4", name: "Deep4", parent_category_id: "pcat-deep-3" },
      ] }).pipe(Effect.asVoid)]) {
      expect((await Effect.runPromise(Effect.result(work)))._tag).toBe("Failure"); expect(await snapshot()).toEqual(before);
    }
  }, 120_000);
  it("rolls back each native mutation and already captured workflow events when a hook fails", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const trace: string[] = [], seed = await connected.prepareCreate();
    const category = first(await Effect.runPromise(seed.run(seed.newRequestKey(), { product_categories: [{ name: "Category hook seed" }] })));
    const create = await connected.prepareCreate({ categoriesCreated: async (input, context) => {
      expect(input.categories).toHaveLength(1); expect(trace).toEqual(["product-category.created"]); trace.push("hook");
      escaped = () => context.resources.product.createProductCategories([{ name: "Escaped Category" }]);
      throw new Error("Category create hook rejected after captured workflow event");
    } });
    const update = await connected.prepareUpdate({ categoriesUpdated: input => {
      expect(input.categories).toMatchObject([{ id: category.id, name: "Category hook changed" }]);
      expect(trace).toEqual(["product-category.updated"]); trace.push("hook");
      throw new Error("Category update hook rejected after captured workflow event");
    } });
    const deletion = await connected.prepareDelete({ categoriesDeleted: async (input, context) => {
      expect(input.ids).toEqual([category.id]); expect(trace).toEqual(["product-category.deleted"]); trace.push("hook");
      expect(await context.resources.query.graph({ entity: "product_category", fields: ["id"],
        filters: { id: [category.id] }, pagination: { take: 1 } })).toMatchObject({ data: [] });
      throw new Error("Category delete hook rejected after captured workflow event");
    } });
    for (const work of [create.run(create.newRequestKey(), { product_categories: [{ name: "Category hook created" }] }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: category.id }, update: { name: "Category hook changed" } }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), [category.id]).pipe(Effect.asVoid)]) {
      trace.length = 0; const before = await snapshot();
      const result = await Effect.runPromise(Effect.result(work.pipe(Effect.provideService(ExecutionDiagnostics, observe(trace)))));
      expect(result._tag).toBe("Failure"); if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("adapterFailure");
      expect(trace[trace.length - 1]).toBe("hook"); expect(await snapshot()).toEqual(before);
    }
    if (escaped === undefined) throw new Error("The actual Category creation hook was not reached");
    const beforeLate = await snapshot();
    await escaped().then(() => { throw new Error("Escaped Category creation unexpectedly succeeded"); }, cause => {
      expect(failurePath(cause)).toContain("closed");
    });
    expect(await snapshot()).toEqual(beforeLate);
  }, 120_000);

  it("refuses a hook's extra native Category write despite correctly grouped additional events", async () => {
    let written = 0;
    const host = await connected.prepareCreate({ categoriesCreated: async (_input, context) => {
      const extra = await context.resources.product.createProductCategories([{ name: "Extra hook Category" }]); written = extra.length;
      await context.resources.event_bus.emit(extra.map(category => ({ name: "product-category.created", data: { id: category.id },
        metadata: { eventGroupId: context.eventGroupId } })));
    } });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { product_categories: [{ name: "Parent hook Category" }] })));
    expect(written).toBe(1); expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("retains a caught forbidden-resource refusal after native work and revokes escaped reads", async () => {
    let caught: string[] = [], escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareCreate({ categoriesCreated: (input, context) => {
      expect(input.categories).toHaveLength(1);
      escaped = () => context.resources.query.graph({ entity: "product_category", fields: ["id"], pagination: { take: 1 } });
      try { context.container.resolve("transactionManager"); }
      catch (cause) { caught = failurePath(cause); }
    } });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { product_categories: [{ name: "Caught Category refusal" }] })));
    expect(caught).toContain("unsupportedProfile"); expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    if (escaped === undefined) throw new Error("Native Category hook was not reached before the refusal");
    await escaped().then(() => { throw new Error("Escaped Category read unexpectedly succeeded"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("recovers complete Category DTOs after the real committed transaction loses its acknowledgement", async () => {
    const fixture = connected.fixture;
    let lose = true, failures = 0, hooks = 0, committedAtAck: Awaited<ReturnType<typeof snapshot>> | undefined, hookOutput: unknown;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value); lose = false;
        return Effect.tryPromise({ try: snapshot, catch: cause => new RelationalSessionError({ reason: "resourceFailure", cause }) })
          .pipe(Effect.flatMap(observed => {
            committedAtAck = observed; failures++;
            return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost native Category COMMIT acknowledgement") }));
          }));
      }),
    ));
    const host = await connected.prepareCreate({ categoriesCreated: input => { hooks++; hookOutput = structuredClone(input.categories); } },
      { ...connected.execution, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductCategories");
    try {
      const key = host.newRequestKey(), input = { product_categories: [{ name: "Category uncertain ack", metadata: { nested: { retained: true } } }] }, before = await snapshot();
      const result = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(failures).toBe(1);
      if (committedAtAck === undefined) throw new Error("Actual Category COMMIT was not observed before ACK loss");
      expect(committedAtAck.commits.length - before.commits.length).toBe(1); expect(committedAtAck.rows.length - before.rows.length).toBe(1);
      const emitted = committedAtAck.events.slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([connected.product.runtime.metadata.category.createdEvent, "product-category.created"]);
      expect(committedAtAck.deliveries.length - before.deliveries.length).toBe(2);
      expect(result).toEqual(hookOutput); expect(result).toMatchObject([{ id: expect.any(String), name: input.product_categories[0]?.name,
        handle: "category-uncertain-ack", metadata: input.product_categories[0]?.metadata, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null }]);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(native).toHaveBeenCalledTimes(1); expect(hooks).toBe(1);
      expect(await snapshot()).toEqual(committedAtAck);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("replays all three Category roots once and binds input and revision", async () => {
    let creates = 0, updates = 0, deletes = 0;
    const create = await connected.prepareCreate({ categoriesCreated: () => { creates++; } });
    const changed = await connected.prepareCreate({}, connected.execution, "c".repeat(64));
    const key = create.newRequestKey(), input = { product_categories: [{ name: "Category replay" }], additional_data: { once: true } };
    const created = await Effect.runPromise(create.run(key, input)), afterCreate = await snapshot();
    expect(await Effect.runPromise(create.run(key, input))).toEqual(created); expect(creates).toBe(1); expect(await snapshot()).toEqual(afterCreate);
    for (const work of [create.run(key, { ...input, additional_data: { once: false } }), changed.run(key, input)]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("requestConflict");
      expect(await snapshot()).toEqual(afterCreate);
    }
    const category = first(created), update = await connected.prepareUpdate({ categoriesUpdated: () => { updates++; } });
    const updateKey = update.newRequestKey(), patch = { selector: { id: category.id }, update: { name: "Category replay changed" } };
    const updated = await Effect.runPromise(update.run(updateKey, patch)), afterUpdate = await snapshot();
    expect(await Effect.runPromise(update.run(updateKey, patch))).toEqual(updated); expect(updates).toBe(1); expect(await snapshot()).toEqual(afterUpdate);
    const deletion = await connected.prepareDelete({ categoriesDeleted: () => { deletes++; } });
    const deleteKey = deletion.newRequestKey(), ids = [category.id, category.id];
    expect(await Effect.runPromise(deletion.run(deleteKey, ids))).toBeNull(); const afterDelete = await snapshot();
    expect(await Effect.runPromise(deletion.run(deleteKey, ids))).toBeNull(); expect(deletes).toBe(1); expect(await snapshot()).toEqual(afterDelete);
  }, 120_000);

  it("cancels after native creation and workflow capture and denies a late hook callback", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>()), finished = await Effect.runPromise(Deferred.make<void>());
    const trace: string[] = []; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const host = await connected.prepareCreate({ categoriesCreated: async (input, context) => {
      expect(input.categories).toHaveLength(1); expect(trace).toEqual(["product-category.created"]); trace.push("hook");
      escaped = () => context.resources.product.createProductCategories([{ name: "Cancelled late Category" }]);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined));
    } });
    try {
      const before = await snapshot();
      const interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { product_categories: [{ name: "Cancelled Category" }] })
          .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      })));
      expect(interrupted._tag).toBe("Failure"); if (interrupted._tag === "Failure") expect(failurePath(interrupted.cause)).toContain("Interrupt");
      expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Actual Category creation did not reach its hook before cancellation");
      await escaped().then(() => { throw new Error("Cancelled Category callback retained authority"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); }
  }, 120_000);

  it("confines matching Category and Product identities and request keys to each shop", async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: connected.fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_category_workflow_shop_b", projectId: "project_category_workflow_shop_b", uuidOffset: 100_000 } });
    const other = await prepareLogicalProductCategory(driver, close => cleanup.push(close), fixture);
    const create = await connected.prepareCreate(), otherCreate = await other.prepareCreate(), key = create.newRequestKey();
    const input = { product_categories: [{ id: "pcat-workflow-shared", name: "Category shared" }] };
    const left = first(await Effect.runPromise(create.run(key, input))), right = first(await Effect.runPromise(otherCreate.run(key, input)));
    expect(left.id).toBe(right.id);
    const leftProducts = await connected.seedProducts("category-scope-products", 1), rightProducts = await other.seedProducts("category-scope-products", 1);
    expect(leftProducts).toEqual(rightProducts);
    const update = await connected.prepareUpdate();
    await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: left.id }, update: { name: "Changed only left", metadata: { scope: "left" } } }));
    expect(readRows(await Effect.runPromise(connected.listCategories([left.id])))).toMatchObject([{ name: "Changed only left", metadata: { scope: "left" } }]);
    expect(readRows(await Effect.runPromise(other.listCategories([right.id])))).toMatchObject([{ name: "Category shared", metadata: null }]);
    expect(await Effect.runPromise(create.run(key, input))).toEqual([left]);
    expect(await Effect.runPromise(otherCreate.run(key, input))).toEqual([right]);
    const deletion = await connected.prepareDelete(); await Effect.runPromise(deletion.run(deletion.newRequestKey(), [left.id]));
    expect(await Effect.runPromise(connected.listCategories([left.id]))).toEqual([]);
    expect(readRows(await Effect.runPromise(other.listCategories([right.id])))).toMatchObject([{ id: right.id }]);
  }, 180_000);

  it.skipIf(driver !== "postgres")("settles one competing default-OCC Category root after both native hooks enter (PostgreSQL only)", async () => {
    const create = await connected.prepareCreate();
    const category = first(await Effect.runPromise(create.run(create.newRequestKey(), { product_categories: [{ name: "Category competing" }] })));
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>()), observed: string[] = [];
    const host = await connected.prepareUpdate({ categoriesUpdated: async input => {
      observed.push(first(input.categories).name);
      if (observed.length === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
    } });
    try {
      const before = await snapshot(), selector = { id: category.id };
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const left = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector, update: { name: "Category competing left" } })));
        const right = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector, update: { name: "Category competing right" } })));
        yield* Deferred.await(reached).pipe(Effect.timeout(15_000));
        expect(new Set(observed)).toEqual(new Set(["Category competing left", "Category competing right"]));
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(left), yield* Fiber.join(right)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.filter(result => result._tag === "Failure")).toHaveLength(1);
      for (const result of results) if (result._tag === "Failure" && !failurePath(result.cause).includes("writeConflict"))
        throw new Error("Competing Category root failed outside the actual OCC boundary", { cause: result.cause });
      const winner = results.find(result => result._tag === "Success");
      if (winner === undefined || winner._tag !== "Success") throw new Error("Missing successful Category root");
      expect(readRows(await Effect.runPromise(connected.listCategories([category.id])))).toEqual(winner.value);
      const after = await snapshot(), emitted = after.events.slice(before.events.length), committed = after.commits.slice(before.commits.length);
      expect(committed).toHaveLength(1); expect(emitted).toHaveLength(2);
      expect(emitted.filter(event => event.envelope.contract === "product-category.updated").map(event => event.envelope.message))
        .toEqual(winner.value.map(row => expect.objectContaining({ data: { id: row.id } })));
      expect(emitted.every(event => event.commitSeq === first(committed).commitSeq)).toBe(true);
      expect(after.deliveries.slice(before.deliveries.length)).toHaveLength(2);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 180_000);
});

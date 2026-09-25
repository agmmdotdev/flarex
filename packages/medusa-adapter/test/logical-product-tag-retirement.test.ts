import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { deleteProductTagsWorkflow } from "@medusajs/core-flows/product/delete-product-tags";
import { currencyWorkflowModule } from "../src/currency-service";
import { productLogicalCreateEventPolicy, productLogicalTagEventPolicy } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { prepareProductTagWorkflow } from "../src/product-tag-workflow";
import { prepareProductTagUpdateWorkflow, type ProductTagUpdateWorkflowHooks } from "../src/product-tag-update-workflow";
import { prepareProductTagDeleteWorkflow, type ProductTagDeleteResources, type ProductTagDeleteWorkflowHooks } from "../src/product-tag-delete-workflow";
import { productTagDeletionEvents } from "../src/product-tag-workflow-events";
import { ProductLifecycleIds } from "../src/product-lifecycle";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
const revision = createHash("sha256").update("logical-product-tag-retirement").digest("hex");
const subscribers = [{ id: "logical-product-tag-retirement", revision: "a".repeat(64) }];

const rows = () => currency.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => currency.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => currency.persistence.drizzle.select().from(fxSystemCommits);
const updateInput = (id: string, value = `${id}-updated`) =>
  ({ selector: { id }, update: { value }, additional_data: { witness: id } });

function lostAcknowledgementSession(cause: string) {
  let lose = true;
  return issueRelationalSession(currency.persistence.drizzle, (profile, work) =>
    runRelationalSession(currency.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", error =>
        Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause: error }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause }));
      }),
    ));
}

async function hosts(options?: {
  updateHooks?: ProductTagUpdateWorkflowHooks;
  deleteHooks?: ProductTagDeleteWorkflowHooks;
  session?: typeof currency.session;
}) {
  const execution = { identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
    prepare: (composition: AtomicWorkflowHostComposition) =>
      makeAtomicCommerceHost({ ...product.hostInput, session: options?.session ?? currency.session, ...composition }) };
  const selected = { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage };
  const create = await Effect.runPromise(prepareProductTagWorkflow({ execution,
    modules: { product: { ...selected, moduleEvents: productLogicalTagEventPolicy(catalog) },
      currency: { module: Result.getOrThrow(currencyWorkflowModule),
        logicalStorage: currency.hostInput.logicalStorage } },
    revision, subscribers }));
  const update = await Effect.runPromise(prepareProductTagUpdateWorkflow({ execution,
    modules: { product: { ...selected, moduleEvents: productLogicalTagEventPolicy(catalog) } },
    revision, subscribers, ...(options?.updateHooks === undefined ? {} : { hooks: options.updateHooks }) }));
  const remove = await Effect.runPromise(prepareProductTagDeleteWorkflow({ execution,
    modules: { product: { ...selected, moduleEvents: productLogicalTagEventPolicy(catalog) } },
    revision, subscribers, ...(options?.deleteHooks === undefined ? {} : { hooks: options.deleteHooks }) }));
  return { create, update, remove, close: async () => {
    await Effect.runPromise(create.close);
    await Effect.runPromise(update.close);
    await Effect.runPromise(remove.close);
  } };
}

async function createTag(host: Awaited<ReturnType<typeof hosts>>["create"], value: string) {
  const created = await Effect.runPromise(host.run(host.newRequestKey(), { product_tags: [{ value }] }));
  const id = created[0]?.id;
  if (typeof id !== "string") throw new Error("Missing created Product-tag ID");
  return id;
}

describe("native Product-tag update/delete on logical storage", () => {
  beforeAll(async () => {
    currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(currency);
    catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product-tag cleanup failed");
  }, 120_000);

  it("preserves selector, unchanged, missing and soft-delete behavior with exact native events", async () => {
    let expectedHookId: string | undefined;
    let witnessed = 0;
    const flow = await hosts({ updateHooks: { productTagsUpdated: async (input, { resources }) => {
      if (input.additional_data?.witness !== "tag-retire-selector") return;
      witnessed++;
      expect(input.product_tags).toMatchObject([{ id: expectedHookId, value: "tag-retire-changed" }]);
      expect((await resources.query.graph({ entity: "product_tag", fields: ["id", "value"],
        filters: { id: expectedHookId }, pagination: { take: 1 } })).data)
        .toMatchObject([{ id: expectedHookId, value: "tag-retire-changed" }]);
    } } });
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.listTags] }));
    try {
      expect(await Effect.runPromise(flow.update.run(flow.update.newRequestKey(),
        { selector: {}, update: { value: "none" } }))).toEqual([]);
      const id = await createTag(flow.create, "tag-retire-selector");
      expectedHookId = id;
      expect(await Effect.runPromise(flow.update.run(flow.update.newRequestKey(),
        { selector: {}, update: { value: "tag-retire-selector-empty" } })))
        .toMatchObject([{ id, value: "tag-retire-selector-empty" }]);
      const other = await createTag(flow.create, "tag-retire-other");
      const beforeUpdate = await events();
      const updateKey = flow.update.newRequestKey();
      const updated = await Effect.runPromise(flow.update.run(updateKey, {
        selector: { value: "tag-retire-selector-empty" }, update: { value: "tag-retire-changed" },
        additional_data: { witness: "tag-retire-selector" },
      }));
      expect(updated).toMatchObject([{ id, value: "tag-retire-changed" }]);
      expect(witnessed).toBe(1);
      expect((await events()).slice(beforeUpdate.length).map(row => row.envelope.contract))
        .toEqual(["product.product-tag.updated", "product-tag.updated"]);
      await expect(Effect.runPromise(flow.update.run(updateKey, {
        selector: { value: "tag-retire-selector-empty" }, update: { value: "different-request" },
        additional_data: { witness: "tag-retire-selector" },
      }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await Effect.runPromise(flow.update.run(flow.update.newRequestKey(), {
        selector: { id: [id, "missing-tag"], value: "tag-retire-changed" },
        update: { value: "tag-retire-changed" },
      }))).toMatchObject([{ id, value: "tag-retire-changed" }]);
      const beforeMissing = { rows: await rows(), events: await events() };
      for (const selector of [{ id: [] }, { id: "missing-tag" }, { id, value: "not-matching" }]) {
        expect(await Effect.runPromise(flow.update.run(flow.update.newRequestKey(), {
          selector, update: { value: "unselected" },
        }))).toEqual([]);
      }
      expect(await rows()).toEqual(beforeMissing.rows);
      expect(await events()).toEqual(beforeMissing.events);
      const deleteKey = flow.remove.newRequestKey();
      expect(await Effect.runPromise(flow.remove.run(deleteKey, { ids: [id] }))).toBeNull();
      const afterDelete = { rows: await rows(), events: await events() };
      expect(afterDelete.events.slice(beforeMissing.events.length).map(row => row.envelope.contract))
        .toEqual(["product.product-tag.deleted", "product-tag.deleted"]);
      expect(await Effect.runPromise(flow.remove.run(deleteKey, { ids: [id] }))).toBeNull();
      await expect(Effect.runPromise(flow.remove.run(deleteKey, { ids: [other] })))
        .rejects.toMatchObject({ reason: "requestConflict" });
      expect(await rows()).toEqual(afterDelete.rows);
      expect(await events()).toEqual(afterDelete.events);
      expect(await Effect.runPromise(read.read(product.runtime.commands.listTags, {
        filters: { id }, config: { withDeleted: true },
      }))).toMatchObject([{ id, value: "tag-retire-changed", deleted_at: expect.anything() }]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.listTags, {
        filters: { id }, config: {},
      }))).toEqual([]);
      expect(await Effect.runPromise(flow.remove.run(flow.remove.newRequestKey(), { ids: ["missing-tag", other] })))
        .toBeNull();
      expect(await Effect.runPromise(flow.remove.run(flow.remove.newRequestKey(), { ids: [] }))).toBeNull();
    } finally {
      await flow.close();
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("soft-deletes an attached tag without deleting its Product or membership row", async () => {
    const flow = await hosts();
    const createProduct = await Effect.runPromise(prepareProductCreateWorkflow({
      execution: { identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...product.hostInput, ...composition }) },
      modules: { product: { module: product.runtime.workflow,
        logicalStorage: product.hostInput.logicalStorage,
        moduleEvents: productLogicalCreateEventPolicy(catalog) } },
      revision, subscribers,
    }));
    const reader = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.list, product.runtime.commands.listTags] }));
    try {
      const removedId = await createTag(flow.create, "tag-retire-attached-removed");
      const keptId = await createTag(flow.create, "tag-retire-attached-kept");
      await Effect.runPromise(createProduct.run(createProduct.newRequestKey(), { products: [{
        id: "prod_tag_retirement_attached", title: "Attached Tag Product",
        tag_ids: [removedId, keptId],
      }] }));
      const readProduct = () => Effect.runPromise(reader.read(product.runtime.commands.list, {
        filters: { id: "prod_tag_retirement_attached" }, config: { relations: ["tags"] },
      }));
      expect(await readProduct()).toMatchObject([{ tags: [
        { id: removedId }, { id: keptId },
      ] }]);
      const beforeRows = await rows();
      let hooks = 0;
      let escaped: ProductTagDeleteResources["product"]["softDeleteProductTags"] | undefined;
      const deleting = await hosts({ deleteHooks: { productTagsDeleted: async (input, { resources }) => {
        hooks++;
        escaped = resources.product.softDeleteProductTags;
        expect(input.ids).toEqual([removedId]);
        expect((await resources.query.graph({ entity: "product_tag", fields: ["id", "value"],
          filters: { id: [removedId, keptId] }, pagination: { take: 2 } })).data)
          .toEqual([{ id: keptId, value: "tag-retire-attached-kept" }]);
        expect((await resources.query.graph({ entity: "product", fields: ["id", "tags.id"],
          filters: { id: "prod_tag_retirement_attached" }, pagination: { take: 1 } })).data)
          .toEqual([{ id: "prod_tag_retirement_attached", tags: [{ id: keptId }] }]);
      } } });
      try {
        expect(await Effect.runPromise(deleting.remove.run(deleting.remove.newRequestKey(),
          { ids: [removedId] }))).toBeNull();
      } finally { await deleting.close(); }
      expect(hooks).toBe(1);
      await expect(escaped?.([keptId])).rejects.toMatchObject({ reason: "closed" });
      expect(await rows()).toHaveLength(beforeRows.length);
      expect(await readProduct()).toMatchObject([{ id: "prod_tag_retirement_attached",
        tags: [{ id: keptId }] }]);
      expect(await Effect.runPromise(reader.read(product.runtime.commands.listTags, {
        filters: { id: removedId }, config: { withDeleted: true },
      }))).toMatchObject([{ id: removedId, deleted_at: expect.anything() }]);
      const replacement = await createTag(flow.create, "tag-retire-attached-removed");
      expect(replacement).not.toBe(removedId);
    } finally {
      await flow.close();
      await Effect.runPromise(createProduct.close);
      await Effect.runPromise(reader.close);
    }
  }, 120_000);

  it("refuses malformed selectors, duplicate values and duplicate deletion IDs before publication", async () => {
    const flow = await hosts();
    try {
      const id = await createTag(flow.create, "tag-retire-invalid-a");
      const other = await createTag(flow.create, "tag-retire-invalid-b");
      const before = { rows: await rows(), events: await events() };
      await expect(Effect.runPromise(flow.update.run(flow.update.newRequestKey(), {
        selector: { id: [id, other] }, update: { value: "one-duplicate-value" },
      }))).rejects.toBeDefined();
      for (const [field, value] of [["selector", { q: "search" }],
        ["selector", { value: ["tag-retire-invalid-a"] }],
        ["selector", { id: Array.from({ length: 257 }, () => id) }],
        ["update", {}], ["update", { value: "changed", id }],
        ["additional_data", null]] as const) {
        const input = Object.defineProperty(updateInput(id), field, { value });
        await expect(Effect.runPromise(flow.update.run(flow.update.newRequestKey(), input)))
          .rejects.toMatchObject({ reason: "invalidInput" });
      }
      for (const invalid of [[id, id], [""], ["x".repeat(257)],
        Array.from({ length: 257 }, (_, index) => `tag-${index}`), id, null]) {
        const input = Object.defineProperty({ ids: [id] }, "ids", { value: invalid });
        const exit = await Effect.runPromise(Effect.exit(flow.remove.run(flow.remove.newRequestKey(), input)));
        if (!Exit.isFailure(exit)) throw new Error("Expected invalid Product-tag deletion input");
        expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "invalidInput")).toBe(true);
      }
      expect(await rows()).toEqual(before.rows);
      expect(await events()).toEqual(before.events);
    } finally { await flow.close(); }
  }, 120_000);

  it("keeps hook failures and caught resource refusals fatal, including an invalid native output", async () => {
    const seed = await hosts();
    const id = await createTag(seed.create, "tag-retire-refusal");
    const other = await createTag(seed.create, "tag-retire-refusal-other");
    await seed.close();
    const before = { rows: await rows(), events: await events(), commits: await commits() };
    for (const hook of [
      { productTagsUpdated: () => { throw new Error("Product-tag update hook failed"); } },
      { productTagsUpdated: async (_input, { resources }) => {
        await resources.query.graph({ entity: "currency", fields: ["code"] }).catch(() => undefined);
      } },
    ] satisfies ProductTagUpdateWorkflowHooks[]) {
      const flow = await hosts({ updateHooks: hook });
      try {
        await expect(Effect.runPromise(flow.update.run(flow.update.newRequestKey(), updateInput(id))))
          .rejects.toBeDefined();
        expect(await rows()).toEqual(before.rows);
        expect(await events()).toEqual(before.events);
        expect(await commits()).toEqual(before.commits);
      } finally { await flow.close(); }
    }
    for (const hook of [
      { productTagsDeleted: () => { throw new Error("Product-tag delete hook failed"); } },
      { productTagsDeleted: async (_input, { resources }) => {
        await resources.product.softDeleteProductTags([""]).catch(() => undefined);
      } },
      { productTagsDeleted: async (_input, { resources }) => {
        await resources.product.softDeleteProductTags([other]);
      } },
      { productTagsDeleted: async (_input, { resources, eventGroupId }) => {
        await resources.event_bus.emit([{ name: "product-tag.deleted", data: { id: other },
          metadata: { eventGroupId } }]);
      } },
    ] satisfies ProductTagDeleteWorkflowHooks[]) {
      const flow = await hosts({ deleteHooks: hook });
      try {
        await expect(Effect.runPromise(flow.remove.run(flow.remove.newRequestKey(), { ids: [id] })))
          .rejects.toBeDefined();
        expect(await rows()).toEqual(before.rows);
        expect(await events()).toEqual(before.events);
        expect(await commits()).toEqual(before.commits);
      } finally { await flow.close(); }
    }
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: {
      module: product.runtime.workflow, methods: ["softDeleteProductTags"], graph: true,
    } }, true));
    const invalid = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...product.hostInput, ...composition }) },
      modules: { product: { module: product.runtime.workflow,
        logicalStorage: product.hostInput.logicalStorage,
        moduleEvents: productLogicalTagEventPolicy(catalog) } },
      revision, subscribers,
      workflow: { name: "wrongLogicalProductTagDeletionOutput", resources,
        prepared: Result.getOrThrow(deleteProductTagsWorkflow.prepare()),
        input: Schema.Struct({ ids: ProductLifecycleIds }), output: Schema.Array(Schema.Json),
        events: productTagDeletionEvents(product.runtime.workflow.methods.softDeleteProductTags) },
    }));
    try {
      await expect(Effect.runPromise(invalid.run(invalid.newRequestKey(), { ids: [id] })))
        .rejects.toMatchObject({ reason: "storedCorruption" });
      expect(await rows()).toEqual(before.rows);
      expect(await events()).toEqual(before.events);
      expect(await commits()).toEqual(before.commits);
    } finally { await Effect.runPromise(invalid.close); }
  }, 120_000);

  it("drains cancelled update/delete hooks and replays uncertain commits without repeating them", async () => {
    const seed = await hosts();
    const updateId = await createTag(seed.create, "tag-retire-cancel-update");
    const deleteId = await createTag(seed.create, "tag-retire-cancel-delete");
    await seed.close();
    for (const [kind, id] of [["update", updateId], ["delete", deleteId]] as const) {
      const reached = await Effect.runPromise(Deferred.make<void>());
      let release: (() => void) | undefined;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const cancelled = await hosts(kind === "update"
        ? { updateHooks: { productTagsUpdated: async () => {
          await Effect.runPromise(Deferred.succeed(reached, undefined));
          await wait;
        } } }
        : { deleteHooks: { productTagsDeleted: async () => {
          await Effect.runPromise(Deferred.succeed(reached, undefined));
          await wait;
        } } });
      const before = { rows: await rows(), events: await events(), commits: await commits() };
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const action = kind === "update"
            ? cancelled.update.run(cancelled.update.newRequestKey(), updateInput(id))
            : cancelled.remove.run(cancelled.remove.newRequestKey(), { ids: [id] });
          const fiber = yield* Effect.forkScoped(action);
          yield* Deferred.await(reached).pipe(Effect.timeout(5000));
          yield* Fiber.interrupt(fiber);
        })));
      } finally { release?.(); await cancelled.close(); }
      expect(await rows()).toEqual(before.rows);
      expect(await events()).toEqual(before.events);
      expect(await commits()).toEqual(before.commits);
      let hooks = 0;
      const session = lostAcknowledgementSession(`lost logical Product-tag ${kind} acknowledgement`);
      const recovering = await hosts(kind === "update"
        ? { session, updateHooks: { productTagsUpdated: () => { hooks++; } } }
        : { session, deleteHooks: { productTagsDeleted: () => { hooks++; } } });
      try {
        const key = kind === "update" ? recovering.update.newRequestKey() : recovering.remove.newRequestKey();
        const run = () => kind === "update"
          ? Effect.runPromise(recovering.update.run(key, updateInput(id)))
          : Effect.runPromise(recovering.remove.run(key, { ids: [id] }));
        const result = await run();
        const after = { rows: await rows(), events: await events(), commits: await commits() };
        expect(hooks).toBe(1);
        expect(after.events).toHaveLength(before.events.length + 2);
        expect(after.commits).toHaveLength(before.commits.length + 1);
        expect(await run()).toEqual(result);
        expect(hooks).toBe(1);
        expect(await rows()).toEqual(after.rows);
        expect(await events()).toEqual(after.events);
        expect(await commits()).toEqual(after.commits);
      } finally { await recovering.close(); }
    }
  }, 120_000);

  it.skipIf(driver !== "postgres")("hides pending tag changes and settles duplicate keys once", async () => {
    const seed = await hosts();
    const updateId = await createTag(seed.create, "tag-retire-pending-update");
    const deleteId = await createTag(seed.create, "tag-retire-pending-delete");
    await seed.close();
    for (const [kind, id] of [["update", updateId], ["delete", deleteId]] as const) {
      const before = { rows: await rows(), events: await events(), commits: await commits() };
      let hooks = 0;
      const observe = async () => {
        hooks++;
        expect(await rows()).toEqual(before.rows);
        expect(await events()).toEqual(before.events);
      };
      const flow = await hosts(kind === "update"
        ? { updateHooks: { productTagsUpdated: observe } }
        : { deleteHooks: { productTagsDeleted: observe } });
      try {
        const key = kind === "update" ? flow.update.newRequestKey() : flow.remove.newRequestKey();
        const run = () => kind === "update"
          ? Effect.runPromise(flow.update.run(key, updateInput(id)))
          : Effect.runPromise(flow.remove.run(key, { ids: [id] }));
        const [first, second] = await Promise.all([run(), run()]);
        expect(second).toEqual(first);
        expect(hooks).toBe(1);
        expect(await commits()).toHaveLength(before.commits.length + 1);
        expect(await events()).toHaveLength(before.events.length + 2);
      } finally { await flow.close(); }
    }
  }, 120_000);
});

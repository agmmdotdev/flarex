import { expectWorkflowRefusal } from "./support/workflow-failure-assertions";
import { withWorkflowPolicy } from "./support/workflow-policy-fixture";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { currencyWorkflowModule } from "../src/modules/currency/service";

import { prepareProductTagWorkflow } from "../src/workflows/product/tag";
import { prepareProductTagUpdateWorkflow } from "../src/workflows/product/tag-update";
import { prepareProductTagDeleteWorkflow } from "../src/workflows/product/tag-delete";

import { createCoreProductWorkflowFixture, openCoreProductCommandHost, type CoreProductWorkflowFixture } from "./support/core-product-workflow-fixture";
import type { AtomicWorkflowExecution } from "../src/workflow/host";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
const coreRows = async (selected = currency) => (await selected.fixture.snapshot()).rows;
const coreEvents = async (selected = currency) => (await selected.fixture.snapshot()).events;

let currency: CoreProductWorkflowFixture;
let product: CoreProductWorkflowFixture["product"];

function forgeModuleId(policy: import("../src/workflow/module").WorkflowLogicalPolicy) {
  return { ...policy, capture: (event: unknown) => policy.capture(event).pipe(Effect.map(message =>
    isJsonObject(message) && message.data !== undefined && isJsonObject(message.data)
      ? { ...message, data: { ...message.data, id: "ptag_forged" } } : message)) };
}

describe("native Product-tag lifecycle on logical Product storage", () => {
  beforeAll(async () => {
    currency = await createCoreProductWorkflowFixture(driver, close => cleanup.push(close), { includeCurrency: true });
    product = currency.product;

  }, 180_000);
  afterAll(async () => {
    for (const close of cleanup.reverse()) await close();
  }, 120_000);

  it("updates and deletes native tags against logical row transitions", async () => {
    const revision = createHash("sha256").update("logical-product-tag-lifecycle").digest("hex");
    const subscribers = [{ id: "logical-product-tags", revision: "a".repeat(64) }];
    const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: currency.execution.identityAndAccessPolicy,
      prepare: composition => currency.execution.prepare(composition) };
    const create = await Effect.runPromise(prepareProductTagWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, nativeStorage: product.source }, currency: { module: Result.getOrThrow(currencyWorkflowModule),
          nativeStorage: currency.fixture.source("currency") } }, revision, subscribers }));
    let hookCalls = 0;
    const update = await Effect.runPromise(prepareProductTagUpdateWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, nativeStorage: product.source } }, revision, subscribers,
      hooks: { productTagsUpdated: async (input, { resources }) => {
        hookCalls++;
        const tag = input.product_tags[0];
        if (tag === undefined) return;
        expect(await resources.product.listProductTags({ id: tag.id },
          { select: ["id", "value"], relations: [] })).toMatchObject([{ id: tag.id, value: tag.value }]);
        expect(await resources.query.graph({ entity: "product_tag", fields: ["id", "value"],
          filters: { id: tag.id }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ id: tag.id, value: tag.value }] });
      } } }));
    const remove = await Effect.runPromise(prepareProductTagDeleteWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, nativeStorage: product.source } }, revision, subscribers }));
    try {
      const tags = await Effect.runPromise(create.run(create.newRequestKey(),
        { product_tags: [{ value: "tag-a" }, { value: "tag-b" }] }));
      expect(tags).toHaveLength(2);
      const id = tags[0]?.id;
      if (typeof id !== "string") throw new Error("Missing created tag ID");
      const beforeEmpty = await coreRows();
      const beforeEmptyEvents = await coreEvents();
      expect(await Effect.runPromise(update.run(update.newRequestKey(),
        { selector: { id: "missing-tag" }, update: { value: "no-match" } }))).toEqual([]);
      expect(await coreRows()).toEqual(beforeEmpty);
      expect(await coreEvents()).toEqual(beforeEmptyEvents);
      const updateKey = update.newRequestKey();
      const changed = await Effect.runPromise(update.run(updateKey,
        { selector: { id }, update: { value: "tag-a-updated" } }));
      expect(changed).toMatchObject([{ id, value: "tag-a-updated" }]);
      expect(hookCalls).toBe(2);
      const afterUpdate = await coreRows();
      const afterUpdateEvents = await coreEvents();
      expect(afterUpdateEvents.slice(beforeEmptyEvents.length).map(event => event.envelope.contract))
        .toEqual(["product.product-tag.updated", "product-tag.updated"]);
      expect(await Effect.runPromise(update.run(updateKey,
        { selector: { id }, update: { value: "tag-a-updated" } }))).toEqual(changed);
      expect(hookCalls).toBe(2);
      expect(await coreRows()).toEqual(afterUpdate);
      expect(await coreEvents()).toEqual(afterUpdateEvents);
      const otherId = tags[1]?.id;
      if (typeof otherId !== "string") throw new Error("Missing second tag ID");
      const conflict = await Effect.runPromise(Effect.exit(update.run(update.newRequestKey(),
        { selector: { id: [id, otherId] }, update: { value: "duplicate-value" } })));
      if (!Exit.isFailure(conflict)) throw new Error("Duplicate tag value unexpectedly committed");
      expect(conflict.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason))
        .toEqual(expect.arrayContaining(["rollbackOnly", "invalidInput"]));
      expect(await coreRows()).toEqual(afterUpdate);
      expect(await coreEvents()).toEqual(afterUpdateEvents);
      const deleteKey = remove.newRequestKey();
      expect(await Effect.runPromise(remove.run(deleteKey, { ids: [id, otherId] }))).toBeNull();
      const afterDelete = await coreRows();
      const afterDeleteEvents = await coreEvents();
      expect(afterDeleteEvents.slice(afterUpdateEvents.length).map(event => event.envelope.contract))
        .toEqual(["product.product-tag.deleted", "product.product-tag.deleted", "product-tag.deleted", "product-tag.deleted"]);
      expect(await Effect.runPromise(remove.run(deleteKey, { ids: [id, otherId] }))).toBeNull();
      expect(await coreRows()).toEqual(afterDelete);
      expect(await coreEvents()).toEqual(afterDeleteEvents);
      expect(await Effect.runPromise(remove.run(remove.newRequestKey(), { ids: ["missing-tag"] }))).toBeNull();
      expect(await coreRows()).toEqual(afterDelete);
      expect((await coreEvents()).slice(afterDeleteEvents.length)
        .map(event => event.envelope.contract)).toEqual(["product-tag.deleted"]);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.close);
      await Effect.runPromise(remove.close);
    }
  }, 120_000);

  it("rolls back updated and deleted module messages with forged row IDs", async () => {
    const revision = createHash("sha256").update("logical-product-tag-lifecycle-refusal").digest("hex");
    const subscribers = [{ id: "logical-product-tags", revision: "a".repeat(64) }];
    const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: currency.execution.identityAndAccessPolicy,
      prepare: composition => currency.execution.prepare(composition) };
    const create = await Effect.runPromise(prepareProductTagWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, nativeStorage: product.source },
        currency: { module: Result.getOrThrow(currencyWorkflowModule), nativeStorage: currency.fixture.source("currency") } },
      revision, subscribers }));
    const update = await Effect.runPromise(prepareProductTagUpdateWorkflow({ execution,
      modules: { product: { module: withWorkflowPolicy(product.runtime.workflow, forgeModuleId), nativeStorage: product.source } }, revision, subscribers }));
    const remove = await Effect.runPromise(prepareProductTagDeleteWorkflow({ execution,
      modules: { product: { module: withWorkflowPolicy(product.runtime.workflow, forgeModuleId), nativeStorage: product.source } }, revision, subscribers }));
    try {
      const tags = await Effect.runPromise(create.run(create.newRequestKey(),
        { product_tags: [{ value: "refusal-tag" }] }));
      const id = tags[0]?.id;
      if (typeof id !== "string") throw new Error("Missing refusal tag ID");
      const before = await currency.fixture.snapshot(), beforeRows = before.rows, beforeEvents = before.events;
      for (const work of [update.run(update.newRequestKey(), { selector: { id }, update: { value: "uncommitted-update" } }),
        remove.run(remove.newRequestKey(), { ids: [id] })]) {
        const exit = await Effect.runPromiseExit(work);
        expect(await currency.fixture.snapshot()).toEqual(before);
        expectWorkflowRefusal(exit, "receiptMismatch");
      }
      expect(await coreRows()).toEqual(beforeRows);
      expect(await coreEvents()).toEqual(beforeEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.close);
      await Effect.runPromise(remove.close);
    }
  }, 120_000);

  it("selects one requested tag after the logical catalog exceeds the row bound", async () => {
    const revision = createHash("sha256").update("logical-product-tag-large-catalog").digest("hex");
    const subscribers = [{ id: "logical-product-tags", revision: "a".repeat(64) }];
    const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: currency.execution.identityAndAccessPolicy,
      prepare: composition => currency.execution.prepare(composition) };
    const create = await Effect.runPromise(prepareProductTagWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, nativeStorage: product.source },
        currency: { module: Result.getOrThrow(currencyWorkflowModule), nativeStorage: currency.fixture.source("currency") } },
      revision, subscribers }));
    const remove = await Effect.runPromise(prepareProductTagDeleteWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, nativeStorage: product.source } }, revision, subscribers }));
    const reader = await Effect.runPromise(openCoreProductCommandHost(currency, {
      commands: [product.runtime.commands.listTags] }));
    try {
      let selectedId: string | undefined;
      for (let offset = 0; offset < 129; offset += 20) {
        const tags = await Effect.runPromise(create.run(create.newRequestKey(), { product_tags:
          Array.from({ length: Math.min(20, 129 - offset) }, (_, index) =>
            ({ value: `large-tag-${offset + index}` })) }));
        if (selectedId === undefined) selectedId = tags[0]?.id;
      }
      if (selectedId === undefined) throw new Error("Missing selected tag ID");
      const read = () => Effect.runPromise(reader.read(product.runtime.commands.listTags,
        { filters: { id: selectedId }, config: { select: ["id", "value"] } }));
      expect(await read()).toMatchObject([{ id: selectedId, value: "large-tag-0" }]);
      const beforeEvents = await coreEvents();
      expect(await Effect.runPromise(remove.run(remove.newRequestKey(), { ids: [selectedId] }))).toBeNull();
      expect(await read()).toEqual([]);
      expect((await coreEvents()).slice(beforeEvents.length)
        .map(event => event.envelope.contract)).toEqual(["product.product-tag.deleted", "product-tag.deleted"]);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(remove.close);
      await Effect.runPromise(reader.close);
    }
  }, 240_000);
});

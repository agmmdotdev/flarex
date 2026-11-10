import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { prepareProductTagWorkflow } from "../src/workflows/product/tag";
import { prepareProductTagUpdateWorkflow } from "../src/workflows/product/tag-update";
import { createCoreProductWorkflowFixture, type CoreProductWorkflowFixture } from "./support/core-product-workflow-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CoreProductWorkflowFixture;
const revision = createHash("sha256").update("native-product-tag-metadata").digest("hex");
const subscribers = [{ id: "tag-metadata", revision: "a".repeat(64) }];
const options = () => ({ execution: fixture.execution,
  modules: { product: { module: fixture.product.runtime.workflow, nativeStorage: fixture.product.source } }, revision, subscribers });

describe("native Product Tag metadata workflow on current Core storage", () => {
  beforeAll(async () => { fixture = await createCoreProductWorkflowFixture(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("updates only metadata, retains native merge/null/empty behavior and emits both event families", async () => {
    const create = await Effect.runPromise(prepareProductTagWorkflow(options()));
    const update = await Effect.runPromise(prepareProductTagUpdateWorkflow(options()));
    try {
      const [tag] = await Effect.runPromise(create.run(create.newRequestKey(), { product_tags: [{
        value: "metadata-tag", metadata: { keep: "retained", replace: "old", remove: "old", nested: { old: true } },
      }] }));
      if (tag === undefined) throw new Error("Missing Tag");
      const apply = (data: { metadata?: null | Record<string, string | boolean | Record<string, boolean>> }) =>
        Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: tag.id }, update: data }));
      const before = await fixture.snapshot();
      const merged = await apply({ metadata: { replace: "new", remove: "", nested: { added: true } } });
      expect(merged).toMatchObject([{ id: tag.id, value: "metadata-tag" }]);
      expect(merged[0]?.metadata).toEqual({ keep: "retained", replace: "new", nested: { added: true } });
      const empty = await apply({});
      expect(empty).toMatchObject([{ id: tag.id, value: "metadata-tag" }]);
      expect(empty[0]?.metadata).toEqual({ keep: "retained", replace: "new", nested: { added: true } });
      // Pinned prepareUpdateMetadata skips an empty object; the native update
      // still writes that supplied object, rather than merging previous keys.
      const cleared = await apply({ metadata: {} });
      expect(cleared).toMatchObject([{ id: tag.id, value: "metadata-tag" }]);
      expect(cleared[0]?.metadata).toEqual({});
      expect(await apply({ metadata: null })).toMatchObject([{ id: tag.id, value: "metadata-tag", metadata: null }]);
      const after = await fixture.snapshot();
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(
        Array.from({ length: 4 }, () => ["product.product-tag.updated", "product-tag.updated"]).flat());
      expect(await Effect.runPromise(update.run(update.newRequestKey(),
        { selector: { id: "missing-tag" }, update: { metadata: {} } }))).toEqual([]);
      expect((await fixture.snapshot()).events).toEqual(after.events);
    } finally {
      await Effect.runPromise(update.close);
      await Effect.runPromise(create.close);
    }
  }, 120_000);

  it("rolls back metadata and events when the native updated hook fails", async () => {
    const create = await Effect.runPromise(prepareProductTagWorkflow(options()));
    let hookCalls = 0;
    const update = await Effect.runPromise(prepareProductTagUpdateWorkflow({ ...options(), hooks: {
      productTagsUpdated: async ({ product_tags }, { resources }) => {
        hookCalls++;
        const tag = product_tags[0];
        if (tag === undefined) throw new Error("Missing updated Tag");
        expect(await resources.product.listProductTags({ id: tag.id },
          { select: ["id", "value", "metadata"], relations: [] })).toMatchObject([
          { id: tag.id, value: "rollback-metadata", metadata: { changed: true } },
        ]);
        throw new Error("Fail after native metadata update");
      },
    } }));
    try {
      const [tag] = await Effect.runPromise(create.run(create.newRequestKey(), { product_tags: [{ value: "rollback-metadata" }] }));
      if (tag === undefined) throw new Error("Missing Tag");
      const before = await fixture.snapshot();
      const outcome = await Effect.runPromiseExit(update.run(update.newRequestKey(),
        { selector: { id: tag.id }, update: { metadata: { changed: true } } }));
      expect(Exit.isFailure(outcome)).toBe(true);
      expect(hookCalls).toBe(1);
      expect(await fixture.snapshot()).toEqual(before);
      // Native compensation preimages normalize metadata key paths only at
      // listProductTags' workflow view. Ordinary reads remain strict.
      expect(Exit.isFailure(await Effect.runPromiseExit(fixture.reads.read(fixture.product.runtime.commands.listTags,
        { filters: { id: tag.id }, config: { select: ["metadata.changed"] } })))).toBe(true);
      expect(await fixture.snapshot()).toEqual(before);
      for (const data of [{ id: "forged" }, { updated_at: "2026-01-01" }, { metadata: [] }]) {
        const invalidInput: unknown = { selector: { id: tag.id }, update: data };
        // @ts-expect-error Deliberately exercise runtime refusal of malformed external input.
        expect(Exit.isFailure(await Effect.runPromiseExit(update.run(update.newRequestKey(), invalidInput)))).toBe(true);
        expect(await fixture.snapshot()).toEqual(before);
      }
      expect(hookCalls).toBe(1);
    } finally {
      await Effect.runPromise(update.close);
      await Effect.runPromise(create.close);
    }
  }, 120_000);
});

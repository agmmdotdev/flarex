import { describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit } from "effect";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { isNonArrayRecord } from "@flarex/utils/records";
import { coreProductSnapshot, coreProductNewMessages, installCoreProductDocumentFault, openCoreProductCheckHost } from "./core-product-checks";
import { getCoreProductRunnerFixture, productIntegrationTestRunner } from "./core-product-runner";

const run = Effect.runPromise;
const object = (value: Json | undefined): JsonObject => {
  if (value === undefined || !isJsonObject(value)) throw new Error("Expected Product object");
  return value;
};
const array = (value: Json | undefined): readonly Json[] => {
  if (!Array.isArray(value)) throw new Error("Expected Product array");
  return value;
};
const product = (count: number) => ({ title: "Scale receipts", images: Array.from({ length: count }, (_, rank) => ({ url: `image-${rank + 1}` })) });
const hasLimitExceeded = (error: unknown): boolean => {
  if (Cause.isCause(error)) return error.reasons.some(reason =>
    Cause.isFailReason(reason) && hasLimitExceeded(reason.error));
  return isNonArrayRecord(error) && (error.reason === "limitExceeded" || hasLimitExceeded(error.cause));
};
const create = (input: Json, key?: string) => {
  const { product } = getCoreProductRunnerFixture();
  return product.host.run(key ?? product.host.newRequestKey(), product.runtime.commands.create, input);
};

productIntegrationTestRunner({ moduleName: "product", testSuite: ({ service }) => describe("Product scale checks", () => {

  it("retains every row, ordinal and scalar event and replays without another publication", async () => {
    const { product: productFixture, product: { host: writer } } = getCoreProductRunnerFixture();
    const imageTable = productFixture.definition.tables.find(table => table.localName === productFixture.runtime.metadata.image.table.name);
    if (imageTable === undefined) throw new Error("Missing Core Image table identity");
    const before = await coreProductSnapshot(productFixture);
    const args = { ...product(1000), options: [{ title: "size", values: ["one"] }], variants: [{ title: "One", options: { size: "one" } }] };
    const key = writer.newRequestKey();
    const result = object(await run(create(args, key)));
    const images = array(result.images).map(object);
    expect(images).toHaveLength(1000);
    expect(images.map(image => image.rank)).toEqual(Array.from({ length: 1000 }, (_, index) => index));
    const after = await coreProductSnapshot(productFixture);
    const revisions = after.revisions.slice(before.revisions.length);
    expect(revisions).toHaveLength(1005);
    expect(revisions.filter(row => row.table === imageTable.name)).toHaveLength(1000);
    expect(after.rows).toHaveLength(before.rows.length + 1005);
    expect(after.rows.filter(row => row.table === imageTable.name)).toHaveLength(1000);
    if (typeof result.id !== "string") throw new Error("Missing Product ID");
    const stored = await service.retrieveProduct(result.id, { relations: ["images"] });
    expect(stored.images?.map(image => [image.id, image.rank, image.url]))
      .toEqual(images.map(image => [image.id, image.rank, image.url]));
    const events = coreProductNewMessages(before, after).map(object);
    expect(events).toHaveLength(1004);
    const imageEvents = events.filter(event => object(event.metadata).object === "product_image");
    expect(imageEvents).toHaveLength(1000);
    expect(imageEvents.map(event => object(event.data).id).toSorted()).toEqual(images.map(image => image.id).toSorted());
    expect(events.every(event => typeof object(event.data).id === "string")).toBe(true);
    expect(await run(create(args, key))).toEqual(result);
    expect(await coreProductSnapshot(productFixture)).toEqual(after);

  });

  it.each([255, 256, 257])("preserves complete results across the %i-image write boundary", async count => {
    const { product: productFixture } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(productFixture);
    const result = object(await run(create(product(count))));
    expect(array(result.images)).toHaveLength(count);
    if (typeof result.id !== "string") throw new Error("Missing Product ID");
    const retrieved = await service.retrieveProduct(result.id, { relations: ["images"] });
    expect(retrieved.images?.map(image => image.url)).toEqual(product(count).images.map(image => image.url));
    const after = await coreProductSnapshot(productFixture);
    expect(coreProductNewMessages(before, after)).toHaveLength(count + 1);
  });

  it("rolls back the earlier image batch when the final batch fails", async () => {
    const { product: productFixture } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(productFixture);
    const fault = await installCoreProductDocumentFault(productFixture, { target: "business", at: 258 });
    try {
      expect(Exit.isFailure(await Effect.runPromiseExit(create(product(257))))).toBe(true);
      expect(await fault.visits()).toEqual([{ count: 258, is_called: true }]);
      expect(await coreProductSnapshot(productFixture)).toEqual(before);
    } finally { await fault.close(); }

  });

  it("rolls back native Product rows and pending events when cancelled after a nested write", async () => {
    const { product: productFixture, product: { runtime } } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(productFixture);
    const reached = await run(Deferred.make<void>());
    const command = defineCommerceCommand("productScaleCancellation", "write", Effect.fn("ProductScale.cancel")(function* (ctx, input) {
      const created = yield* ctx.nested(runtime.commands.create, input);
      expect(array(object(created).images)).toHaveLength(257);
      yield* Deferred.succeed(reached, undefined);
      return yield* Effect.never;
    }));
    const local = await productFixture.run(openCoreProductCheckHost(productFixture, [command, runtime.commands.create]));
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(local.run(local.newRequestKey(), command, product(257)), { signal: controller.signal });
    try {
      await Promise.race([run(Deferred.await(reached)), pending.then(exit => { throw new Error("Settled before cancellation: " + exit._tag, { cause: exit }); })]);
      controller.abort();
      expect(Exit.isFailure(await pending)).toBe(true);
    } finally { controller.abort(); await pending; await run(local.close); }
    expect(await coreProductSnapshot(productFixture)).toEqual(before);
  });

  it("refuses an oversized command result without publication", async () => {
    const { product: productFixture } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(productFixture);
    const command = defineCommerceCommand("productScaleOversizedResult", "write", ctx => Effect.succeed("x".repeat(ctx.resources.commandBytes)));
    const local = await productFixture.run(openCoreProductCheckHost(productFixture, [command]));
    try {
      expect(await run(Effect.result(local.run(local.newRequestKey(), command, null)))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(await coreProductSnapshot(productFixture)).toEqual(before);
    } finally { await run(local.close); }
  });

  it("refuses an oversized image and native graph beyond the shared budget atomically", async () => {
    const { product: productFixture } = getCoreProductRunnerFixture();
    const before = await coreProductSnapshot(productFixture);
    for (const input of [{ title: "Oversized", images: [{ url: "x".repeat(65_537) }] }, product(2048)]) {
      const exit = await Effect.runPromiseExit(create(input));
      expect(Exit.isFailure(exit) && hasLimitExceeded(exit.cause)).toBe(true);
      expect(await coreProductSnapshot(productFixture)).toEqual(before);
    }
  });

  it("refuses an event-free graph beyond the native identity budget", async () => {
    const { product: productFixture } = getCoreProductRunnerFixture();
    const catalog = productFixture.runtime.metadata;
    const before = await coreProductSnapshot(productFixture);
    const command = defineCommerceCommand("productScaleFactBudget", "write", Effect.fn("ProductScale.factBudget")(function* (ctx) {
      const table = yield* ctx.table(catalog.product.table.name);
      for (let start = 0; start < 65; start += 32) {
        yield* table.write(ctx.manager, "insert", Array.from({ length: Math.min(32, 65 - start) }, (_, index) => ({
          id: `product_scale_fact_${start + index}`, title: "Fact budget",
          handle: `product-scale-fact-${start + index}` })));
      }
      return null;
    }));
    const local = await productFixture.run(openCoreProductCheckHost(productFixture, [command], {
      nativeLimits: { maxIdentities: 64, maxDocumentBytes: 65_536 } }));
    try {
      const exit = await Effect.runPromiseExit(local.run(local.newRequestKey(), command, null));
      expect(Exit.isFailure(exit) && hasLimitExceeded(exit.cause)).toBe(true);
      expect(await coreProductSnapshot(productFixture)).toEqual(before);
    } finally { await run(local.close); }
  });
}) });

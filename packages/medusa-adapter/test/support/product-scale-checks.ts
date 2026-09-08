import { beforeEach, describe, expect, it } from "vitest";
import { Deferred, Effect, Exit } from "effect";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";

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
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

const localHost = Effect.fn("ProductScale.host")(function* (commands: readonly CommerceCommand[], delivered: Json[]) {
  const { fixture } = getProductRunnerFixture();
  const catalog = yield* captureProductSchema("scale-policy").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame)));
  return yield* makeLocalCommerceHost({ ...fixture.hostInput, commands: [...fixture.hostInput.commands, ...commands] },
    productLocalEventPolicy(fixture.descriptor, catalog, events => Effect.sync(() => { delivered.push(...events); })));
});

describe("Product scale checks", () => {
  beforeEach(clearProductRunnerRows);

  it("retains every row, ordinal and scalar event and replays without another publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const before = await commerceInventory(fixture);
    const args = { ...product(1000), options: [{ title: "size", values: ["one"] }], variants: [{ title: "One", options: { size: "one" } }] };
    const key = fixture.host.newRequestKey();
    const result = object(await run(fixture.host.run(key, runtime.commands.create, args)));
    const images = array(result.images).map(object);
    expect(images).toHaveLength(1000);
    expect(images.map(image => image.rank)).toEqual(Array.from({ length: 1000 }, (_, index) => index));
    const after = await commerceInventory(fixture);
    const facts = after.facts.slice(before.facts.length);
    expect(facts).toHaveLength(1005);
    expect(facts.map(fact => fact.changeOrdinal)).toEqual(Array.from({ length: 1005 }, (_, index) => index));
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.commits.at(-1)?.relationalChangeCount).toBe(1005);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(after.wakes).toHaveLength(before.wakes.length + 1);
    expect(after.tables.image).toHaveLength(1000);
    const events = takeProductRunnerEvents().map(object);
    expect(events).toHaveLength(1004);
    const imageEvents = events.filter(event => object(event.metadata).object === "product_image");
    expect(imageEvents).toHaveLength(1000);
    expect(imageEvents.map(event => object(event.data).id).toSorted()).toEqual(images.map(image => image.id).toSorted());
    expect(events.every(event => typeof object(event.data).id === "string")).toBe(true);
    expect(await run(fixture.host.run(key, runtime.commands.create, args))).toEqual(result);
    expect(takeProductRunnerEvents()).toEqual([]);
    expect(await commerceInventory(fixture)).toEqual(after);
    process.stdout.write(JSON.stringify({ scaleReceipt: { graphRows: 1005, facts: facts.length, events: events.length,
      inputBytes: Buffer.byteLength(JSON.stringify(args)), resultBytes: Buffer.byteLength(JSON.stringify(result)),
      imageRowBytes: Buffer.byteLength(JSON.stringify(after.tables.image)) } }) + "\n");
  });

  it.each([255, 256, 257])("preserves complete results across the %i-image write boundary", async count => {
    const { fixture, runtime } = getProductRunnerFixture();
    const result = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, product(count))));
    expect(array(result.images)).toHaveLength(count);
    if (typeof result.id !== "string") throw new Error("Missing Product ID");
    const retrieved = object(await run(fixture.host.read(runtime.commands.retrieve, { id: result.id, config: { relations: ["images"] } })));
    expect(array(retrieved.images).map(image => object(image).url)).toEqual(product(count).images.map(image => image.url));
    expect(takeProductRunnerEvents()).toHaveLength(count + 1);
  });

  it("rolls back the earlier image batch when the final batch fails", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const layout = fixture.descriptor.layout.frame;
    const image = layout.tables.find(table => table.identity.tableId === "image");
    if (image === undefined) throw new Error("Missing image table");
    const rank = image.columns.find(column => column.identity.columnId === "rank");
    if (rank === undefined) throw new Error("Missing image rank column");
    const target = quote(layout.targetNamespace.schemaName) + "." + quote(image.name);
    const before = await commerceInventory(fixture);
    // A sequence is deliberately nontransactional evidence that the last batch
    // reached SQL after 256 earlier rows. All business and publication rows roll back.
    await fixture.persistence.exec("create sequence fx_scale_attempts");
    await fixture.persistence.exec("create sequence fx_scale_batches");
    await fixture.persistence.exec("create function fx_scale_completed() returns trigger language plpgsql as $$ begin perform nextval('fx_scale_batches'); return null; end $$");
    await fixture.persistence.exec(`create function fx_scale_fail() returns trigger language plpgsql as $$ begin perform nextval('fx_scale_attempts'); if NEW.${quote(rank.name)} = 256 then raise exception 'scale final batch failure'; end if; return NEW; end $$`);
    try {
      await fixture.persistence.exec(`create trigger fx_scale_completed after insert on ${target} for each statement execute function fx_scale_completed()`);
      await fixture.persistence.exec(`create trigger fx_scale_fail before insert on ${target} for each row execute function fx_scale_fail()`);
      expect(Exit.isFailure(await Effect.runPromiseExit(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, product(257))))).toBe(true);
      expect((await fixture.persistence.query<{ last_value: string | number }>("select last_value from fx_scale_attempts")).rows.map(row => Number(row.last_value))).toEqual([257]);
      expect((await fixture.persistence.query("select last_value::integer as completed, is_called from fx_scale_batches")).rows).toEqual([{ completed: 1, is_called: true }]);
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toEqual([]);
    } finally {
      await fixture.persistence.exec(`drop trigger if exists fx_scale_completed on ${target}`);
      await fixture.persistence.exec("drop function fx_scale_completed()");
      await fixture.persistence.exec("drop sequence fx_scale_batches");
      await fixture.persistence.exec(`drop trigger if exists fx_scale_fail on ${target}`);
      await fixture.persistence.exec("drop function fx_scale_fail()");
      await fixture.persistence.exec("drop sequence fx_scale_attempts");
    }
  });

  it("rolls back every batch and event when cancelled after nested creation", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const reached = await run(Deferred.make<void>());
    const command = defineCommerceCommand("productScaleCancellation", "write", Effect.fn("ProductScale.cancel")(function* (ctx) {
      const value = object(yield* ctx.nested(runtime.commands.create, product(257)));
      expect(array(value.images)).toHaveLength(257);
      yield* Deferred.succeed(reached, undefined);
      return yield* Effect.never;
    }));
    const delivered: Json[] = [];
    const local = await run(localHost([command], delivered));
    const before = await commerceInventory(fixture);
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), command, null), { signal: controller.signal });
    try {
      await Promise.race([run(Deferred.await(reached)), pending.then(exit => { throw new Error("Settled before cancellation: " + exit._tag); })]);
      controller.abort();
      expect(Exit.isFailure(await pending)).toBe(true);
    } finally { controller.abort(); await pending; }
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(delivered).toEqual([]);
  });

  it("refuses an oversized command result without publication", async () => {
    const { fixture } = getProductRunnerFixture();
    const command = defineCommerceCommand("productScaleOversizedResult", "write", ctx => Effect.succeed("x".repeat(ctx.resources.commandBytes)));
    const delivered: Json[] = [];
    const local = await run(localHost([command], delivered));
    const before = await commerceInventory(fixture);
    expect(await run(Effect.result(local.host.run(local.host.newRequestKey(), command, null)))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(delivered).toEqual([]);
  });

  it("refuses an oversized image and a graph beyond the fact budget atomically", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const before = await commerceInventory(fixture);
    for (const input of [{ title: "Oversized", images: [{ url: "x".repeat(65_537) }] }, product(2048)]) {
      expect(Exit.isFailure(await Effect.runPromiseExit(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, input)))).toBe(true);
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toEqual([]);
    }
  });
});

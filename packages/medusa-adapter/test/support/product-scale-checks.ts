import { describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit } from "effect";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { isJsonObject, logicalCommerceBatchResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { fxControlTables } from "../../../persistence-postgres/src/database/schema";
import { isNonArrayRecord } from "@flarex/utils/records";
import { captureProductSchema } from "../../src/modules/product/schema";
import { productRuntimeMetadata } from "../../src/modules/product/runtime-metadata";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner } from "./logical-product-runner";

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
const hasLimitExceeded = (error: unknown): boolean => {
  if (Cause.isCause(error)) return error.reasons.some(reason =>
    Cause.isFailReason(reason) && hasLimitExceeded(reason.error));
  return isNonArrayRecord(error) && (error.reason === "limitExceeded" || hasLimitExceeded(error.cause));
};
const create = (input: Json, key?: string) => {
  const { product: { runtime }, writer, root, commands } = getLogicalProductRunnerFixture();
  const slot = commands.indexOf(runtime.commands.create);
  if (slot < 0) throw new Error("Missing native Product create command");
  return writer.run(key ?? writer.newRequestKey(), root, { slot, input });
};

const boundedHost = (commands: readonly CommerceCommand[], facts = logicalCommerceBatchResources.facts) => {
  const { product } = getLogicalProductRunnerFixture();
  return makeCommerceHost({ ...product.hostInput, commands,
    logicalResources: { ...logicalCommerceBatchResources, facts } });
};

productIntegrationTestRunner({ moduleName: "product", testSuite: ({ service }) => describe("Product scale checks", () => {

  it("retains every row, ordinal and scalar event and replays without another publication", async () => {
    const { currency, product: productFixture, writer } = getLogicalProductRunnerFixture();
    const catalog = await run(captureProductSchema("logical-scale-image-evidence")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const imageTable = (await currency.control.drizzle.select().from(fxControlTables))
      .find(table => table.deploymentId === currency.deploymentId && table.namespace === "medusa" &&
        table.logicalName === `${productFixture.definition.schema.coordinate.lineageId}/${catalog.image.table.name}`);
    if (imageTable === undefined) throw new Error("Missing logical Image table identity");
    const before = await logicalCurrencyInventory(currency);
    const args = { ...product(1000), options: [{ title: "size", values: ["one"] }], variants: [{ title: "One", options: { size: "one" } }] };
    const key = writer.newRequestKey();
    const result = object(await run(create(args, key)));
    const images = array(result.images).map(object);
    expect(images).toHaveLength(1000);
    expect(images.map(image => image.rank)).toEqual(Array.from({ length: 1000 }, (_, index) => index));
    const after = await logicalCurrencyInventory(currency);
    const facts = after.rowChanges.slice(before.rowChanges.length);
    expect(facts).toHaveLength(1005);
    expect(facts.filter(fact => fact.tableId === imageTable.tableId)).toHaveLength(1000);
    expect(facts.map(fact => fact.changeOrdinal)).toEqual(Array.from({ length: 1005 }, (_, index) => index));
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.commits.at(-1)?.changeCount).toBe(1005);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(after.wakes).toHaveLength(before.wakes.length + 1);
    expect(after.rows).toHaveLength(before.rows.length + 1005);
    expect(after.rows.filter(row => row.tableId === imageTable.tableId)).toHaveLength(1000);
    if (typeof result.id !== "string") throw new Error("Missing Product ID");
    const stored = await service.retrieveProduct(result.id, { relations: ["images"] });
    expect(stored.images?.map(image => [image.id, image.rank, image.url]))
      .toEqual(images.map(image => [image.id, image.rank, image.url]));
    const events = after.events.slice(before.events.length).map(event => object(event.envelope.message));
    expect(events).toHaveLength(1004);
    const imageEvents = events.filter(event => object(event.metadata).object === "product_image");
    expect(imageEvents).toHaveLength(1000);
    expect(imageEvents.map(event => object(event.data).id).toSorted()).toEqual(images.map(image => image.id).toSorted());
    expect(events.every(event => typeof object(event.data).id === "string")).toBe(true);
    expect(await run(create(args, key))).toEqual(result);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
    process.stdout.write(JSON.stringify({ scaleReceipt: { graphRows: 1005, facts: facts.length, events: events.length,
      inputBytes: Buffer.byteLength(JSON.stringify(args)), resultBytes: Buffer.byteLength(JSON.stringify(result)),
      imageDtoBytes: Buffer.byteLength(JSON.stringify(images)) } }) + "\n");
  });

  it.each([255, 256, 257])("preserves complete results across the %i-image write boundary", async count => {
    const { currency } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    const result = object(await run(create(product(count))));
    expect(array(result.images)).toHaveLength(count);
    if (typeof result.id !== "string") throw new Error("Missing Product ID");
    const retrieved = await service.retrieveProduct(result.id, { relations: ["images"] });
    expect(retrieved.images?.map(image => image.url)).toEqual(product(count).images.map(image => image.url));
    const after = await logicalCurrencyInventory(currency);
    expect(after.events).toHaveLength(before.events.length + count + 1);
  });

  it("rolls back the earlier image batch when the final batch fails", async () => {
    const { currency } = getLogicalProductRunnerFixture();
    const schemaRows = await currency.persistence.query<{ schema: string }>("select current_schema() as schema");
    const schemaName = schemaRows.rows[0]?.schema;
    if (schemaName === undefined) throw new Error("Missing logical fixture schema");
    const schema = quote(schemaName);
    const target = schema + "." + quote("fx_app_row_rev");
    const before = await logicalCurrencyInventory(currency);
    // A sequence is deliberately nontransactional evidence that the last batch
    // reached SQL after earlier pages. All row, event and outcome effects roll back.
    await currency.persistence.exec(`create sequence ${schema}.fx_scale_attempts`);
    await currency.persistence.exec(`create sequence ${schema}.fx_scale_batches`);
    await currency.persistence.exec(`create function ${schema}.fx_scale_completed() returns trigger language plpgsql as $$ begin perform nextval('${schema}.fx_scale_batches'); return null; end $$`);
    await currency.persistence.exec(`create function ${schema}.fx_scale_fail() returns trigger language plpgsql as $$ begin
      if nextval('${schema}.fx_scale_attempts') = 258 then raise exception 'scale final batch failure'; end if; return NEW; end $$`);
    try {
      await currency.persistence.exec(`create trigger fx_scale_completed after insert on ${target} for each statement execute function ${schema}.fx_scale_completed()`);
      await currency.persistence.exec(`create trigger fx_scale_fail before insert on ${target} for each row execute function ${schema}.fx_scale_fail()`);
      expect(Exit.isFailure(await Effect.runPromiseExit(create(product(257))))).toBe(true);
      expect((await currency.persistence.query<{ last_value: string | number }>(`select last_value from ${schema}.fx_scale_attempts`)).rows.map(row => Number(row.last_value))).toEqual([258]);
      const completed = (await currency.persistence.query<{ completed: number; is_called: boolean }>(
        `select last_value::integer as completed, is_called from ${schema}.fx_scale_batches`)).rows[0];
      expect(completed?.is_called).toBe(true);
      expect(completed?.completed).toBeGreaterThan(1);
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
    } finally {
      await currency.persistence.exec(`drop trigger if exists fx_scale_completed on ${target}`);
      await currency.persistence.exec(`drop function ${schema}.fx_scale_completed()`);
      await currency.persistence.exec(`drop sequence ${schema}.fx_scale_batches`);
      await currency.persistence.exec(`drop trigger if exists fx_scale_fail on ${target}`);
      await currency.persistence.exec(`drop function ${schema}.fx_scale_fail()`);
      await currency.persistence.exec(`drop sequence ${schema}.fx_scale_attempts`);
    }
  });

  it("rolls back native Product rows and pending events when cancelled after a nested write", async () => {
    const { currency, product: { runtime }, participant, prepareWriter } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    const reached = await run(Deferred.make<void>());
    const command = defineAtomicCommerceCommand("productScaleCancellation", Effect.fn("ProductScale.cancel")(function* (ctx, input) {
      const created = yield* ctx.call(participant, runtime.commands.create, input);
      expect(array(object(created).images)).toHaveLength(257);
      yield* Deferred.succeed(reached, undefined);
      return yield* Effect.never;
    }));
    const local = await run(prepareWriter(command));
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(local.run(local.newRequestKey(), command, product(257)), { signal: controller.signal });
    try {
      await Promise.race([run(Deferred.await(reached)), pending.then(exit => { throw new Error("Settled before cancellation: " + exit._tag, { cause: exit }); })]);
      controller.abort();
      expect(Exit.isFailure(await pending)).toBe(true);
    } finally { controller.abort(); await pending; await run(local.close); }
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  });

  it("refuses an oversized command result without publication", async () => {
    const { currency } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    const command = defineCommerceCommand("productScaleOversizedResult", "write", ctx => Effect.succeed("x".repeat(ctx.resources.commandBytes)));
    const local = await run(boundedHost([command]));
    try {
      expect(await run(Effect.result(local.run(local.newRequestKey(), command, null)))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
    } finally { await run(local.close); }
  });

  it("refuses an oversized image and native graph beyond the shared budget atomically", async () => {
    const { currency } = getLogicalProductRunnerFixture();
    const before = await logicalCurrencyInventory(currency);
    for (const input of [{ title: "Oversized", images: [{ url: "x".repeat(65_537) }] }, product(2048)]) {
      const exit = await Effect.runPromiseExit(create(input));
      expect(Exit.isFailure(exit) && hasLimitExceeded(exit.cause)).toBe(true);
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
    }
  });

  it("refuses an event-free graph beyond the logical row fact budget", async () => {
    const { currency } = getLogicalProductRunnerFixture();
    const catalog = await run(captureProductSchema("logical-scale-fact-budget")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const before = await logicalCurrencyInventory(currency);
    const command = defineCommerceCommand("productScaleFactBudget", "write", Effect.fn("ProductScale.factBudget")(function* (ctx) {
      const table = yield* ctx.table(catalog.product.table.name);
      for (let start = 0; start < 65; start += 32) {
        yield* table.write(ctx.manager, "insert", Array.from({ length: Math.min(32, 65 - start) }, (_, index) => ({
          id: `product_scale_fact_${start + index}`, title: "Fact budget",
          handle: `product-scale-fact-${start + index}` })));
      }
      return null;
    }));
    const local = await run(boundedHost([command], 64));
    try {
      const exit = await Effect.runPromiseExit(local.run(local.newRequestKey(), command, null));
      expect(Exit.isFailure(exit) && hasLimitExceeded(exit.cause)).toBe(true);
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
    } finally { await run(local.close); }
  });
}) });

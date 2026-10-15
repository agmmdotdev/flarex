import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { prepareProductCreateWorkflow } from "../src/workflows/product/create";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareProductVariantUpdateWorkflow } from "../src/workflows/product/variant-update";
import { productVariantUpdateResources } from "../src/workflow/policy";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { projectExactNumericColumns } from "../src/value/exact-numeric";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalVariantUpdate } from "./support/logical-variant-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalVariantUpdate>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const Id = Schema.decodeUnknownSync(Schema.String);
const decodeWorkflowEvent = Schema.decodeUnknownSync(Schema.StructWithRest(Schema.Struct({ data: Schema.Struct({ id: Schema.String }) }),
  [Schema.Record(Schema.String, Schema.Json)]));
const ids = (seeded: Awaited<ReturnType<typeof connected.seed>>) => seeded.map(variant => variant.id);
const prepare = async (...args: Parameters<typeof connected.prepare>) => {
  const host = await connected.prepare(...args);
  cleanup.push(() => Effect.runPromise(host.close));
  return host;
};
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

describe("complete native Product Variant update workflow", () => {
  beforeAll(async () => { connected = await prepareLogicalVariantUpdate(await logicalCurrencyFixture(driver, close => cleanup.push(close), {
    includeProduct: true, includePricing: true, includeVariantInventory: true,
  }), close => cleanup.push(close)); }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("updates four variants, replaces prices and dismisses Inventory links under one bounded root", async () => {
    const seeded = await connected.seed("update-max", 4, 2);
    const host = await prepare({ productVariantsUpdated: async (value, context) => {
      expect(value.product_variants.map(row => row.id)).toEqual(ids(seeded));
      expect(value.additional_data).toEqual({ note: "maximum" });
      const pending = await context.resources.query.graph({ entity: "product_variant_inventory_item", fields: ["variant_id", "inventory_item_id"],
        filters: { variant_id: ids(seeded) }, pagination: { take: 8 } });
      expect(pending.data).toEqual([]);
    } });
    const input = { product_variants: seeded.map((variant, index) => ({ id: variant.id, title: "changed-" + index, manage_inventory: false,
      prices: [{ id: Id(variant.prices.find(price => price.currency_code === "USD")?.id), amount: "987.6543210987654321", rules: { channel_id: "new" } },
        { currency_code: "GBP", amount: 300, rules: { region_id: "created" } }],
    })), additional_data: { note: "maximum" } };
    const beforeCommits = await commits(), beforeEvents = await events();
    let calls = 0;
    const key = host.newRequestKey();
    const result = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(productVariantUpdateResources.calls);
    expect(result).toHaveLength(4);
    expect(result.every(variant => variant.manage_inventory === false && variant.price_set?.prices.length === 2)).toBe(true);
    expect((await commits()).length - beforeCommits.length).toBe(1);
    const emitted = (await events()).slice(beforeEvents.length);
    expect(emitted.filter(event => event.envelope.contract === "product-variant.updated").map(event => decodeWorkflowEvent(event.envelope.message).data))
      .toEqual(ids(seeded).map(id => ({ id })));
    const storedEvents = await events(), storedRows = await rows();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    expect(await rows()).toEqual(storedRows);
    expect(await events()).toEqual(storedEvents);
  });

  it("keeps native empty batch and empty selector behavior without Product listing", async () => {
    const host = await prepare();
    const list = vi.spyOn(ProductModuleService.prototype, "listProductVariants");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { product_variants: [] }))).toEqual([]);
      expect(list).not.toHaveBeenCalled();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [] }, update: { title: "nothing" } }))).toEqual([]);
    } finally { list.mockRestore(); }
  });

  it("preserves omitted prices, clears explicit empty prices and leaves Inventory records intact", async () => {
    const seeded = await connected.seed("update-omission", 1), variant = seeded[0]!;
    const host = await prepare();
    const omitted = await Effect.runPromise(host.run(host.newRequestKey(), { product_variants: [{ id: variant.id, title: "only-title" }] }));
    expect(omitted[0]).not.toHaveProperty("price_set");
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: variant.id }, update: { prices: [], manage_inventory: false } }));
    expect(result).toMatchObject([{ id: variant.id, manage_inventory: false, price_set: { prices: [] } }]);
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: result[0]!.price_set!.id }, config: { relations: ["prices", "prices.price_rules"] } })))
      .toMatchObject([{ prices: [] }]);
  });

  it.each(["batch", "selector"] as const)("rolls back variants, prices, rules and links when the %s completion hook fails", async form => {
    const seeded = await connected.seed("update-hook-" + form, 1), id = seeded[0]!.id;
    const hook = vi.fn(() => { throw new Error("product variants updated hook failed"); });
    const host = await prepare({ productVariantsUpdated: hook });
    const beforeRows = await rows(), beforeEvents = await events();
    const input = form === "batch" ? { product_variants: [{ id, title: "changed", manage_inventory: false, prices: [] }] }
      : { selector: { id }, update: { title: "changed", manage_inventory: false, prices: [] } };
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
  });

  it("rejects forged native service preparations without invoking getters or execution", async () => {
    let getters = 0;
    const fake = Object.defineProperty({}, "dismissMethod", { enumerable: true, get: () => { getters++; return connected.inventory.link.runtime.nativeServices.inventory.dismissMethod; } });
    const execution = { ...connected.execution, prepare: vi.fn(connected.execution.prepare) };
    const result = await Effect.runPromise(Effect.result(prepareProductVariantUpdateWorkflow({ execution, modules: connected.modules,
      nativeLinks: { inventory: fake, pricing: connected.inventory.link.runtime.nativeServices.pricing },
      revision: "a".repeat(64), subscribers: [] })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(getters).toBe(0);
    expect(execution.prepare).not.toHaveBeenCalled();
  });

  it("allows repeated DTO serialization while refusing mismatched raw values and rounded entity data", async () => {
    const row = { amount: "987.65432109876543210", raw_amount: { value: "987.65432109876543210", precision: 20 } };
    const first = await Effect.runPromise(projectExactNumericColumns(row, [{ name: "amount" }]));
    expect(await Effect.runPromise(projectExactNumericColumns(first, [{ name: "amount" }], "reserialize"))).toEqual(first);
    expect(await Effect.runPromise(Effect.result(projectExactNumericColumns(first, [{ name: "amount" }], "exact"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    expect(await Effect.runPromise(Effect.result(projectExactNumericColumns({ ...row, amount: 1 }, [{ name: "amount" }], "reserialize"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("updates native scalar metadata and options through selectors without touching omitted pricing", async () => {
    const seeded = await connected.seed("update-fields", 2), host = await prepare();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids(seeded) },
      update: { allow_backorder: true, metadata: { shared: "yes", count: 2 } } })))
      .toEqual(expect.arrayContaining(ids(seeded).map(id => expect.objectContaining({ id, allow_backorder: true, metadata: { shared: "yes", count: 2 } }))));
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: seeded[0]!.id },
      update: { options: { Size: "3" }, metadata: { shared: null, added: true } } }));
    // Native Variant updates use upsertWithReplace, which replaces the JSON
    // column. The internal service's scalar-update metadata merge is bypassed.
    expect(result[0]).toMatchObject({ options: [expect.objectContaining({ value: "3" })] });
    expect(result[0]?.metadata).toEqual({ shared: null, added: true });
    expect(result[0]).not.toHaveProperty("price_set");
  });

  it("refuses managed fields and oversized graphs before native Product methods", async () => {
    const host = await prepare(), beforeRows = await rows(), beforeEvents = await events();
    const upsert = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants"), update = vi.spyOn(ProductModuleService.prototype, "updateProductVariants");
    try {
      const bad = [
        { product_variants: [{ id: "managed-variant", product_id: "foreign" }] },
        { product_variants: [{ id: "managed-variant", created_at: "2026-01-01T00:00:00.000Z" }] },
        { product_variants: Array.from({ length: 5 }, (_, index) => ({ id: "over-limit-" + index })) },
        { product_variants: [{ id: "managed-variant", prices: [{ id: "managed-price", amount: 1, raw_amount: { value: "1", precision: 20 } }] }] },
      ];
      for (const input of bad) {
        const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)));
        expect(result).toMatchObject({ _tag: "Failure" });
        expect(failurePath(result._tag === "Failure" ? result.failure : undefined), JSON.stringify(input)).toContain("invalidInput");
      }
      expect(upsert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { upsert.mockRestore(); update.mockRestore(); }
  });

  it("keeps the native missing-Pricing-link error and rolls back an earlier variant update", async () => {
    const seed = await Effect.runPromise(prepareProductCreateWorkflow({ execution: connected.execution,
      modules: { product: { module: connected.product.runtime.workflow, logicalStorage: connected.product.hostInput.logicalStorage } },
      revision: "d".repeat(64), subscribers: [{ id: "bare-variant-seed", revision: "e".repeat(64) }] }));
    try {
      await Effect.runPromise(seed.run(seed.newRequestKey(), { products: [{ id: "unpriced-product", title: "bare", options: [{ title: "Size", values: ["S"] }],
        variants: [{ id: "unpriced-variant", title: "bare", sku: "unpriced-sku", options: { Size: "S" } }] }] }));
    } finally { await Effect.runPromise(seed.close); }
    const host = await prepare(), beforeRows = await rows(), beforeEvents = await events();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { product_variants: [{ id: "unpriced-variant", title: "pending", prices: [] }] })));
    expect(result).toMatchObject({ _tag: "Failure" });
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
  });

  it("does not reattach Inventory links when inventory management is enabled again", async () => {
    const seeded = await connected.seed("update-enable", 1), id = seeded[0]!.id, host = await prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), { product_variants: [{ id, manage_inventory: false }] }));
    const verify = await prepare({ productVariantsUpdated: async (_value, context) => {
      expect((await context.resources.query.graph({ entity: "product_variant_inventory_item", fields: ["variant_id", "inventory_item_id"],
        filters: { variant_id: [id] }, pagination: { take: 8 } })).data).toEqual([]);
    } });
    expect(await Effect.runPromise(verify.run(verify.newRequestKey(), { product_variants: [{ id, manage_inventory: true }] })))
      .toMatchObject([{ id, manage_inventory: true }]);
  });

  it("makes a caught method refusal sticky and revokes an escaped native method", async () => {
    const seeded = await connected.seed("update-caught", 1), id = seeded[0]!.id;
    let escaped: ((selector: { id: string }, update: JsonObject) => Promise<readonly JsonObject[]>) | undefined;
    let caught = false;
    const host = await prepare({ productVariantsUpdated: async (_value, context) => {
      escaped = context.resources.product.updateProductVariants;
      try { await escaped({ id }, { product_id: "foreign" }); } catch { caught = true; }
    } });
    const beforeRows = await rows(), beforeEvents = await events();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { product_variants: [{ id, title: "pending" }] })));
    expect(result).toMatchObject({ _tag: "Failure" }); expect(caught).toBe(true);
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    expect(escaped).toBeDefined();
    if (escaped !== undefined) await expect(escaped({ id }, { title: "escaped" })).rejects.toMatchObject({ reason: "closed" });
  });

  it("cancels after pending native updates and ignores their late completion", async () => {
    const seeded = await connected.seed("update-cancel", 1), host = await prepare(), id = seeded[0]!.id;
    const reached = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined;
    const original = ProductModuleService.prototype.upsertProductVariants;
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { product_variants: [{ id, title: "cancelled" }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      finish?.(); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("recovers a lost acknowledgement without repeating native updates and binds replay identity", async () => {
    const seeded = await connected.seed("update-uncertain", 1), id = seeded[0]!.id;
    let lose = true;
    const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Variant update COMMIT acknowledgement") })); }),
    ));
    const host = await prepare({}, { ...connected.execution, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const changed = await prepare({}, connected.execution, "c".repeat(64));
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants");
    try {
      const key = host.newRequestKey(), input = { product_variants: [{ id, title: "uncertain" }] };
      const result = await Effect.runPromise(host.run(key, input)); expect(lose).toBe(false); expect(native).toHaveBeenCalledTimes(1);
      const storedRows = await rows(), storedEvents = await events();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await rows()).toEqual(storedRows); expect(await events()).toEqual(storedEvents);
    } finally { native.mockRestore(); }
  });

  it.skipIf(driver !== "postgres")("allows overlapping native callbacks and rejects one stale variant update", async () => {
    const seeded = await connected.seed("update-competing", 1), id = seeded[0]!.id, host = await prepare();
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    let count = 0;
    const original = ProductModuleService.prototype.upsertProductVariants;
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { product_variants: [{ id, title: "first" }] })));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { product_variants: [{ id, title: "second" }] })));
        yield* Deferred.await(reached).pipe(Effect.timeout(10_000)); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.flatMap(result => result._tag === "Failure" ? failurePath(result.cause) : [])).toContain("writeConflict");
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  });

  it("confines matching variant IDs and request keys to two shops", async () => {
    const other = await prepareLogicalVariantUpdate(await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantInventory: true, resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "variant_update_shop_b", projectId: "variant_update_shop_b", uuidOffset: 24_000 },
    }), close => cleanup.push(close));
    const left = await connected.seed("update-scoped", 1), right = await other.seed("update-scoped", 1);
    expect(ids(left)).toEqual(ids(right));
    const first = await prepare(), second = await other.prepare(); cleanup.push(() => Effect.runPromise(second.close));
    const key = first.newRequestKey(), input = { product_variants: [{ id: left[0]!.id, title: "only-first-shop" }] };
    expect(await Effect.runPromise(first.run(key, input))).toMatchObject([{ title: "only-first-shop" }]);
    expect(await Effect.runPromise(other.product.host.read(other.product.runtime.commands.internalProductRetrieve,
      { id: "update-scoped-product", config: { relations: ["variants"] } })))
      .toMatchObject({ variants: [expect.objectContaining({ id: right[0]!.id, title: "update-scoped0" })] });
    expect(await Effect.runPromise(second.run(key, input))).toMatchObject([{ title: "only-first-shop" }]);
  }, 180_000);
});

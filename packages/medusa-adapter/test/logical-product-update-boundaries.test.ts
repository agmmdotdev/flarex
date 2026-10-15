import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { prepareProductUpdateWorkflow, type ProductUpdateHooks } from "../src/workflows/product/update";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { prepareLogicalProductUpdate } from "./support/logical-product-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductUpdate>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
type HookContext = Parameters<NonNullable<ProductUpdateHooks["productsUpdated"]>>[1];
const removal = (id: string, title: string) => ({ products: [{ id, title, variants: [], sales_channels: [], shipping_profile_id: null }] });

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

describe("whole-Product workflow authority, lifecycle and settlement boundaries", () => {
  beforeAll(async () => { connected = await prepareLogicalProductUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("refuses forged tokens and authentic creation profiles before invoking native Product mutation", async () => {
    const beforeRows = await rows(), beforeEvents = await events();
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProducts");
    const attempts = [
      { ...connected.options, link: structuredClone(connected.link) },
      { ...connected.options, modules: { ...connected.modules,
        pricing: { ...connected.modules.pricing, module: structuredClone(connected.modules.pricing.module) } } },
      { ...connected.options, modules: { ...connected.modules,
        pricing: { ...connected.modules.pricing, module: connected.creation.pricing.runtime.workflow } } },
      { ...connected.options, modules: { ...connected.modules,
        product_links: { ...connected.modules.product_links, module: connected.creation.productLinks.runtime.workflow } } },
      { ...connected.options, modules: { ...connected.modules,
        variant_links: { ...connected.modules.variant_links, module: connected.creation.inventory.link.runtime.workflow } } },
    ];
    try {
      for (const options of attempts) {
        const result = await Effect.runPromise(Effect.result(prepareProductUpdateWorkflow(options)));
        if (result._tag === "Success") await Effect.runPromise(result.success.close);
        expect(result).toMatchObject({ _tag: "Failure" });
      }
      expect(native).not.toHaveBeenCalled();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { native.mockRestore(); }
  });

  it("rolls back the entire native cascade after a caught Link refusal and revokes the escaped method", async () => {
    const product = (await connected.seed("product-boundary-caught", 1, 2))[0]!;
    let escaped: HookContext["resources"]["link"]["delete"] | undefined;
    let caught = false;
    const host = await connected.prepare({ productsUpdated: async (_value, context) => {
      escaped = context.resources.link.delete;
      try { await escaped({ product: { variant_id: ["1", "2", "3", "4", "5"] } }); } catch { caught = true; }
    } });
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), removal(product.id, "pending cascade"))));
    expect(result).toMatchObject({ _tag: "Failure" }); expect(caught).toBe(true);
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
    expect(escaped).toBeDefined();
    if (escaped !== undefined) await expect(escaped({ product: { variant_id: product.variants.map(variant => variant.id) } }))
      .rejects.toMatchObject({ reason: "closed" });
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
  });

  it("cancels after native Pricing descendants have changed and ignores the late callback result", async () => {
    const product = (await connected.seed("product-boundary-cancel"))[0]!, host = await connected.prepare();
    const reached = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined;
    const original = PricingModuleService.prototype.softDeletePriceSets;
    const native = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; });
      return result;
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), removal(product.id, "cancelled cascade")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* Fiber.interrupt(fiber);
      }));
      expect(native).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
      finish?.();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("recovers a lost COMMIT acknowledgement once and binds both replay input and revision", async () => {
    const product = (await connected.seed("product-boundary-uncertain"))[0]!;
    let lose = true;
    const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Product cascade COMMIT acknowledgement") }));
      }),
    ));
    const host = await connected.prepare({}, { ...connected.execution,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const changed = await Effect.runPromise(prepareProductUpdateWorkflow({ ...connected.options, revision: "c".repeat(64) }));
    cleanup.push(() => Effect.runPromise(changed.close));
    const productNative = vi.spyOn(ProductModuleService.prototype, "upsertProducts");
    const pricingNative = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets");
    try {
      const key = host.newRequestKey(), input = removal(product.id, "committed cascade"), beforeCommits = await commits();
      const result = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(productNative).toHaveBeenCalledTimes(1); expect(pricingNative).toHaveBeenCalledTimes(1);
      expect((await commits()).length - beforeCommits.length).toBe(1);
      const storedRows = await rows(), storedEvents = await events();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      await expect(Effect.runPromise(host.run(key, removal(product.id, "changed replay")))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(productNative).toHaveBeenCalledTimes(1); expect(pricingNative).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(storedRows); expect(await events()).toEqual(storedEvents);
    } finally { productNative.mockRestore(); pricingNative.mockRestore(); }
  });

  it.skipIf(driver !== "postgres")("settles one of two competing whole-Product cascades and rejects the stale root", async () => {
    const product = (await connected.seed("product-boundary-competing"))[0]!, host = await connected.prepare();
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    let count = 0;
    const original = ProductModuleService.prototype.upsertProducts;
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProducts").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
      return result;
    });
    try {
      const beforeCommits = await commits(), beforeEvents = await events();
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), removal(product.id, "first cascade"))));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), removal(product.id, "second cascade"))));
        yield* Deferred.await(reached).pipe(Effect.timeout(10_000));
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.flatMap(result => result._tag === "Failure" ? failurePath(result.cause) : [])).toContain("writeConflict");
      expect((await commits()).length - beforeCommits.length).toBe(1);
      expect((await events()).slice(beforeEvents.length).filter(event => event.envelope.contract === "product.updated")).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 120_000);

  it("confines matching Product/Variant IDs, cascade targets and request keys to their shop", async () => {
    const other = await prepareLogicalProductUpdate(driver, close => cleanup.push(close), {
      resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "product_update_boundary_shop_b", projectId: "product_update_boundary_shop_b", uuidOffset: 32_000 },
    });
    const left = (await connected.seed("product-boundary-scoped"))[0]!, right = (await other.seed("product-boundary-scoped"))[0]!;
    expect(left.id).toBe(right.id); expect(left.variants.map(variant => variant.id)).toEqual(right.variants.map(variant => variant.id));
    const first = await connected.prepare(), second = await other.prepare(), key = first.newRequestKey();
    const input = removal(left.id, "only first shop");
    expect(await Effect.runPromise(first.run(key, input))).toMatchObject([{ id: left.id, title: "only first shop", variants: [] }]);
    expect(await Effect.runPromise(other.pricing.host.read(other.pricing.runtime.list, {
      filters: { id: right.variants.map(variant => variant.price_set_id) }, config: { relations: ["prices"] },
    }))).toMatchObject([{ deleted_at: null, prices: [expect.anything(), expect.anything()] }]);
    const observed = await Effect.runPromise(second.run(second.newRequestKey(), { products: [{ id: right.id }] }));
    expect(observed).toMatchObject([{ id: right.id, title: "product-boundary-scoped0", variants: [{ id: right.variants[0]!.id }] }]);
    expect(await Effect.runPromise(second.run(key, input))).toMatchObject([{ id: right.id, title: "only first shop", variants: [] }]);
    expect(await Effect.runPromise(first.run(key, input))).toMatchObject([{ id: left.id, title: "only first shop", variants: [] }]);
  }, 180_000);
});

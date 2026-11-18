import { expectWorkflowRefusal } from "./support/workflow-failure-assertions";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { prepareProductUpdateWorkflow, type ProductUpdateHooks } from "../src/workflows/product/update";
import { prepareCoreProductUpdate } from "./support/core-product-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductUpdate>>;
const snapshot = () => connected.fixture.snapshot();
const events = async () => (await snapshot()).events;
const outcomes = async () => (await snapshot()).outcomes;
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
  beforeAll(async () => { connected = await prepareCoreProductUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("refuses forged tokens and authentic creation profiles before invoking native Product mutation", async () => {
    const beforeState = await snapshot(), beforeEvents = await events();
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
        const result = await Effect.runPromise(Effect.exit(prepareProductUpdateWorkflow(options)));
        if (result._tag === "Success") await Effect.runPromise(result.value.close);
        expect(result).toMatchObject({ _tag: "Failure" });
        if (result._tag === "Failure") {
          expect(result.cause.reasons).toHaveLength(1);
          const [causeReason] = result.cause.reasons;
          if (causeReason === undefined || !Cause.isFailReason(causeReason)) throw new Error("Expected one typed workflow refusal");
          expect(causeReason.error).toBeInstanceOf(CommerceTransactionError);
          expect(causeReason.error).toMatchObject({ reason: "unsupportedProfile" });
        }
      }
      expect(native).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents);
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
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
    const result = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), removal(product.id, "pending cascade"))));
    expectWorkflowRefusal(result, "invalidInput"); expect(caught).toBe(true);
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
    expect(escaped).toBeDefined();
    if (escaped !== undefined) await expect(escaped({ product: { variant_id: product.variants.map(variant => variant.id) } }))
      .rejects.toMatchObject({ reason: "closed" });
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents);
  });

  it("cancels after native Pricing descendants have changed and ignores the late callback result", async () => {
    const product = (await connected.seed("product-boundary-cancel"))[0]!, host = await connected.prepare();
    const reached = await Effect.runPromise(Deferred.make<void>()), finished = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    let completed = false;
    const original = PricingModuleService.prototype.softDeletePriceSets;
    const native = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; });
      completed = true; await Effect.runPromise(Deferred.succeed(finished, undefined));
      return result;
    });
    try {
      const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
      const fiber = Effect.runFork(host.run(host.newRequestKey(), removal(product.id, "cancelled cascade")));
      try {
        await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
        await Effect.runPromise(Fiber.interrupt(fiber));
        const interrupted = await Effect.runPromise(Fiber.await(fiber));
        expect(interrupted._tag).toBe("Failure");
        if (interrupted._tag === "Failure") expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
        expect(completed).toBe(false);
        if (escaped === undefined) throw new Error("Native Pricing callback did not expose its borrowed capability");
        await escaped().then(() => { throw new Error("Cancelled native Pricing callback unexpectedly succeeded"); }, cause => {
          expect(failurePath(cause)).toContain("closed");
        });
        expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
        finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
        expect(completed).toBe(true);
      } finally { finish?.(); await Effect.runPromise(Fiber.interrupt(fiber)); }
      expect(native).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("recovers a lost COMMIT acknowledgement once and binds both replay input and revision", async () => {
    const product = (await connected.seed("product-boundary-uncertain"))[0]!;
    const fault = connected.fixture.loseNextNativeRootAcknowledgement();
    const host = await connected.prepare();
    const changed = await Effect.runPromise(prepareProductUpdateWorkflow({ ...connected.options, revision: "c".repeat(64) }));
    cleanup.push(() => Effect.runPromise(changed.close));
    const productNative = vi.spyOn(ProductModuleService.prototype, "upsertProducts");
    const pricingNative = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets");
    try {
      const key = host.newRequestKey(), input = removal(product.id, "committed cascade"), beforeOutcomes = await outcomes();
      const result = await Effect.runPromise(host.run(key, input));
      expect(fault.failures).toBe(1); expect(productNative).toHaveBeenCalledTimes(1); expect(pricingNative).toHaveBeenCalledTimes(1);
      expect((await outcomes()).length - beforeOutcomes.length).toBe(1);
      expect(fault.evidence).toBeDefined();
      expect((await outcomes()).filter(outcome => outcome.timestamp === fault.evidence?.timestamp)).toHaveLength(1);
      const storedState = await snapshot(), storedEvents = await events();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      await expect(Effect.runPromise(host.run(key, removal(product.id, "changed replay")))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(productNative).toHaveBeenCalledTimes(1); expect(pricingNative).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(storedState); expect(await events()).toEqual(storedEvents);
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
      const beforeOutcomes = await outcomes(), beforeEvents = await events();
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), removal(product.id, "first cascade"))));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), removal(product.id, "second cascade"))));
        yield* Deferred.await(reached).pipe(Effect.timeout(10_000));
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      const rejected = results.filter(result => result._tag === "Failure");
      expect(rejected).toHaveLength(1);
      const failure = rejected[0];
      if (failure === undefined) throw new Error("Missing stale-root failure");
      expect(failure.cause.reasons).toHaveLength(1);
      const [causeReason] = failure.cause.reasons;
      expect(causeReason !== undefined && Cause.isFailReason(causeReason)).toBe(true);
      if (causeReason !== undefined && Cause.isFailReason(causeReason)) {
        expect(causeReason.error).toBeInstanceOf(CommerceTransactionError);
        expect(causeReason.error).toMatchObject({ reason: "writeConflict" });
      }
      expect((await outcomes()).length - beforeOutcomes.length).toBe(1);
      expect((await events()).slice(beforeEvents.length).filter(event => event.envelope.contract === "product.updated")).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 120_000);

  it("confines matching Product/Variant IDs, cascade targets and request keys to their shop", async () => {
    const other = await prepareCoreProductUpdate(driver, close => cleanup.push(close), {
      physical: connected.fixture.physical,
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

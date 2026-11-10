import { expectWorkflowRefusal } from "./support/workflow-failure-assertions";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareProductDeletionWorkflow, type ProductDeletionHooks } from "../src/workflows/product/deletion";
import { prepareCoreProductDeletion } from "./support/core-product-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductDeletion>>;
const snapshot = () => connected.fixture.snapshot();
const events = async () => (await snapshot()).events;
const outcomes = async () => (await snapshot()).outcomes;
type HookContext = Parameters<NonNullable<ProductDeletionHooks["productsDeleted"]>>[1];
const removal = (id: string) => ({ ids: [id] });

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

describe("Product deletion workflow authority, lifecycle and settlement boundaries", () => {
  beforeAll(async () => { connected = await prepareCoreProductDeletion(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("refuses forged tokens and authentic creation profiles before invoking native Product mutation", async () => {
    const beforeState = await snapshot(), beforeEvents = await events();
    const native = vi.spyOn(ProductModuleService.prototype, "softDeleteProducts");
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
        const result = await Effect.runPromise(Effect.exit(prepareProductDeletionWorkflow(options)));
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
    const host = await connected.prepareProduct({ productsDeleted: async (_value, context) => {
      escaped = context.resources.link.delete;
      try { await escaped({ product: { variant_id: ["1", "2", "3", "4", "5"] } }); } catch { caught = true; }
    } });
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
    const result = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), removal(product.id))));
    expectWorkflowRefusal(result, "invalidInput"); expect(caught).toBe(true);
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
    expect(escaped).toBeDefined();
    if (escaped !== undefined) await expect(escaped({ product: { variant_id: product.variants.map(variant => variant.id) } }))
      .rejects.toMatchObject({ reason: "closed" });
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents);
  });

  it("cancels after native Pricing descendants have changed and ignores the late callback result", async () => {
    const product = (await connected.seed("product-boundary-cancel"))[0]!, host = await connected.prepareProduct();
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
      const fiber = Effect.runFork(host.run(host.newRequestKey(), removal(product.id)));
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
    const host = await connected.prepareProduct();
    const changed = await Effect.runPromise(prepareProductDeletionWorkflow({ ...connected.options, revision: "c".repeat(64) }));
    cleanup.push(() => Effect.runPromise(changed.close));
    const productNative = vi.spyOn(ProductModuleService.prototype, "softDeleteProducts");
    const pricingNative = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets");
    try {
      const key = host.newRequestKey(), input = removal(product.id), beforeOutcomes = await outcomes();
      const result = await Effect.runPromise(host.run(key, input));
      expect(fault.failures).toBe(1); expect(productNative).toHaveBeenCalledTimes(1); expect(pricingNative).toHaveBeenCalledTimes(1);
      expect((await outcomes()).length - beforeOutcomes.length).toBe(1);
      expect(fault.evidence).toBeDefined();
      expect((await outcomes()).filter(outcome => outcome.timestamp === fault.evidence?.timestamp)).toHaveLength(1);
      const storedState = await snapshot(), storedEvents = await events();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      await expect(Effect.runPromise(host.run(key, { ids: [product.id, "different-request"] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(productNative).toHaveBeenCalledTimes(1); expect(pricingNative).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(storedState); expect(await events()).toEqual(storedEvents);
    } finally { productNative.mockRestore(); pricingNative.mockRestore(); }
  });

  it.skipIf(driver !== "postgres")("settles one of two competing whole-Product cascades and rejects the stale root", async () => {
    const product = (await connected.seed("product-boundary-competing"))[0]!, host = await connected.prepareProduct();
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    let count = 0;
    const original = ProductModuleService.prototype.softDeleteProducts;
    const native = vi.spyOn(ProductModuleService.prototype, "softDeleteProducts").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
      return result;
    });
    try {
      const beforeOutcomes = await outcomes(), beforeEvents = await events();
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), removal(product.id))));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), removal(product.id))));
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
      expect((await events()).slice(beforeEvents.length).filter(event => event.envelope.contract === "product.deleted")).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 120_000);

  it.each(["product", "variant"] as const)("confines matching %s IDs, cascade targets and request keys to their shop", async kind => {
    const other = await prepareCoreProductDeletion(driver, close => cleanup.push(close), {
      physical: connected.fixture.physical,
    });
    const prefix = "product-boundary-scoped-" + kind;
    const left = (await connected.seed(prefix))[0]!, right = (await other.seed(prefix))[0]!;
    expect(left.id).toBe(right.id); expect(left.variants.map(variant => variant.id)).toEqual(right.variants.map(variant => variant.id));
    const first = kind === "product" ? await connected.prepareProduct() : await connected.prepareVariant();
    const second = kind === "product" ? await other.prepareProduct() : await other.prepareVariant(), key = first.newRequestKey();
    const input = kind === "product" ? removal(left.id) : { ids: [left.variants[0]!.id], product_id: left.id };
    expect(await Effect.runPromise(first.run(key, input))).toBeNull();
    expect(await Effect.runPromise(other.pricing.host.read(other.pricing.runtime.list, {
      filters: { id: right.variants.map(variant => variant.price_set_id) }, config: { relations: ["prices"] },
    }))).toMatchObject([{ deleted_at: null, prices: [expect.anything(), expect.anything()] }]);
    {
      const observed = await Effect.runPromise(other.creation.product.reads.read(other.creation.product.runtime.commands.internalProductList,
        { filters: { id: [right.id] }, config: { relations: ["variants"] } }));
      expect(observed).toMatchObject([{ id: right.id, title: prefix + "0", variants: [{ id: right.variants[0]!.id }] }]);
    }
    expect(await Effect.runPromise(second.run(key, input))).toBeNull();
    expect(await Effect.runPromise(first.run(key, input))).toBeNull();
  }, 180_000);

  it.each(["before-final-mutation", "after-final-mutation"] as const)("refuses a scoped Variant deletion after trusted parent movement %s without replaying callbacks", async timing => {
    const [selected, destination] = await connected.seed("variant-parent-race-" + timing, 2, 2);
    if (selected === undefined || destination === undefined) throw new Error("Missing trusted parent race endpoints");
    const variant = selected.variants[0]!, table = connected.creation.product.runtime.metadata.variant.table.name;
    // Public Variant updates refuse reparenting. This trusted test-only command
    // stimulates a concurrent row change through actual Core FK/OCC settlement;
    // it introduces no public reparent API or replacement lifecycle mechanism.
    const move = defineCommerceCommand("testTrustedVariantParentMovement", "write", Effect.fn("Test.moveVariantParent")(function* (ctx) {
      return yield* (yield* ctx.table(table)).write(ctx.manager, "update", [{ id: variant.id, product_id: destination.id }]);
    }));
    const writer = await connected.fixture.run(connected.fixture.openWriteHost("product", [move]));
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = ProductModuleService.prototype.softDeleteProductVariants;
    const native = vi.spyOn(ProductModuleService.prototype, "softDeleteProductVariants").mockImplementation(async function (this: ProductModuleService, ...args) {
      if (timing === "before-final-mutation") {
        await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release));
      }
      const result = await Reflect.apply(original, this, args);
      if (timing === "after-final-mutation") {
        await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release));
      }
      return result;
    });
    const hook = vi.fn(), host = await connected.prepareVariant({ productVariantsDeleted: hook });
    try {
      const before = await snapshot(), beforeOutcomes = await outcomes(), key = host.newRequestKey();
      const beforeLinks = await connected.fixture.readRows("variant_links"), beforeInventory = await connected.fixture.readRows("inventory");
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(Effect.exit(host.run(key, { ids: [variant.id], product_id: selected.id })));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* writer.run(writer.newRequestKey(), move, null).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.join(pending);
      })));
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") expect(failurePath(outcome.cause)).toContain("writeConflict");
      expect(native).toHaveBeenCalledTimes(1);
      expect(native.mock.calls[0]?.[0]).toEqual({ id: [variant.id], product_id: selected.id });
      expect(hook).toHaveBeenCalledTimes(1);
      const after = await snapshot();
      expect(after.events).toEqual(before.events);
      expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(after.revisions.filter(row => row.timestamp > beforeOutcomes.at(-1)!.timestamp))
        .toEqual([expect.objectContaining({ deleted: false, value: expect.objectContaining({ id: variant.id, product_id: destination.id, deleted_at: null }) })]);
      expect(after.outcomes).toHaveLength(beforeOutcomes.length + 1);
      expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list, {
        filters: { id: variant.price_set_id }, config: { relations: ["prices"] },
      }))).toMatchObject([{ deleted_at: null, prices: [expect.anything(), expect.anything()] }]);
      expect(await connected.fixture.readRows("variant_links")).toEqual(beforeLinks);
      expect(await connected.fixture.readRows("inventory")).toEqual(beforeInventory);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); await Effect.runPromise(writer.close);
    }
  }, 180_000);
});

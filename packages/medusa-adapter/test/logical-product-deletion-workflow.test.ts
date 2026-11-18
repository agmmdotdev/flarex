import { expectWorkflowDefect, expectWorkflowRefusal } from "./support/workflow-failure-assertions";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { Cause, Exit, Effect, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { productDeletionResources } from "../src/workflow/policy";
import { prepareCoreProductDeletion } from "./support/core-product-deletion-fixture";
import type { ProductDeletionHooks } from "../src/workflows/product/deletion";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductDeletion>>;
const snapshot = () => connected.fixture.snapshot();
const events = async () => (await snapshot()).events;
const outcomes = async () => (await snapshot()).outcomes;
const itemIds = (prefix: string, count: number) => Array.from({ length: count * 2 }, (_, index) => prefix + "-inventory-" + index);
const eventIds = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
const idsIn = (selected: Awaited<ReturnType<typeof events>>) => selected.flatMap(event => {
  const id = eventIds(event.envelope.message).data.id; return typeof id === "string" ? [id] : id;
});
type QueryResources = Pick<Parameters<NonNullable<ProductDeletionHooks["productsDeleted"]>>[1]["resources"], "query">;

function nativeFailure(outcome: Exit.Exit<unknown, unknown>): MedusaError {
  if (Exit.isSuccess(outcome)) throw new Error("Expected the native workflow to fail");
  const reasons = outcome.cause.reasons;
  const failures = reasons.filter(Cause.isFailReason).map(reason => reason.error);
  expect(reasons.filter(Cause.isDieReason)).toEqual([]);
  expect(failures).toHaveLength(2);
  for (const failure of failures) expect(failure).toBeInstanceOf(CommerceTransactionError);
  expect(failures.map(failure => failure instanceof CommerceTransactionError ? failure.reason : undefined).toSorted())
    .toEqual(["adapterFailure", "rollbackOnly"].toSorted());
  // Parallel native siblings may already have settled or may be canceled.
  // Every additional authoritative reason must remain an explicit interruption.
  for (const reason of reasons) if (!Cause.isFailReason(reason)) expect(Cause.isInterruptReason(reason)).toBe(true);
  const original = failures.find(failure => failure instanceof CommerceTransactionError && failure.reason === "adapterFailure");
  if (!(original instanceof CommerceTransactionError) || !(original.cause instanceof MedusaError))
    throw new Error("Native adapter refusal lost its original MedusaError");
  return original.cause;
}

describe("native Product and Variant deletion roots", () => {
  beforeAll(async () => { connected = await prepareCoreProductDeletion(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it.each(["product", "variant"] as const)("deletes the complete maximum %s graph and publishes its native event families once", async kind => {
    const prefix = "deletion-max-" + kind, seeded = await connected.seed(prefix, 4, 2, true), inventoryIds = itemIds(prefix, 4);
    await connected.seedStock(prefix, inventoryIds);
    const ids = kind === "product" ? seeded.map(product => product.id) : seeded.flatMap(product => product.variants.map(variant => variant.id));
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
    const limitedExecution = { ...connected.execution, prepare: (composition: Parameters<typeof connected.execution.prepare>[0]) =>
      connected.execution.prepare({ ...composition, requestCallLimit: 64 }) };
    const limited = kind === "product" ? await connected.prepareProduct({}, limitedExecution) : await connected.prepareVariant({}, limitedExecution);
    const refusal = await Effect.runPromise(Effect.exit(limited.run(limited.newRequestKey(), { ids })));
    expectWorkflowRefusal(refusal, "limitExceeded");
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
    const hook = vi.fn(async (_value: { readonly ids: readonly string[] }, context: { readonly resources: QueryResources }) => {
      expect((await context.resources.query.graph({ entity: "inventory", fields: ["id", "reserved_quantity"], filters: { id: inventoryIds }, pagination: { take: 8 } })).data).toEqual([]);
      expect((await context.resources.query.graph({ entity: kind === "product" ? "products" : "variants", fields: ["id"], filters: { id: ids }, pagination: { take: 4 } })).data).toEqual([]);
    });
    // Both native hooks have the same payload; their contexts expose the same Query capability.
    const host = kind === "product" ? await connected.prepareProduct({ productsDeleted: hook }) : await connected.prepareVariant({ productVariantsDeleted: (value, context) => hook(value, context) });
    let calls = 0;
    const key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Native deletion maximum", kind, "calls", calls)))))).toBeNull();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(productDeletionResources.calls);
    expect(hook).toHaveBeenCalledTimes(1);
    const emitted = (await events()).slice(beforeEvents.length), name = kind === "product" ? "product.deleted" : "product-variant.deleted";
    console.info("Native deletion maximum", kind, "events", emitted.length);
    expect(emitted.length).toBeLessThanOrEqual(productDeletionResources.eventMessages);
    expect(idsIn(emitted.filter(event => event.envelope.contract === name))).toEqual(ids);
    expect(idsIn(emitted.filter(event => event.envelope.contract.startsWith("inventory.")))).toHaveLength(32);
    expect(idsIn(emitted.filter(event => event.envelope.contract.startsWith("pricing.")))).toHaveLength(36);
    expect(idsIn(emitted.filter(event => event.envelope.contract.startsWith("product.product")))).toHaveLength(kind === "product" ? 36 : 4);
    expect((await outcomes()).length - beforeOutcomes.length).toBe(1);
    const finalState = await snapshot(), finalEvents = await events();
    expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
    expect(hook).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(finalState); expect(await events()).toEqual(finalEvents);
  }, 240_000);

  it.each(["product", "variant"] as const)("preserves empty, missing and duplicate requested IDs in the %s hook and workflow events", async kind => {
    const seeded = await connected.seed("deletion-ids-" + kind, 1, 2), id = kind === "product" ? seeded[0]!.id : seeded[0]!.variants[0]!.id;
    const hook = vi.fn();
    const host = kind === "product" ? await connected.prepareProduct({ productsDeleted: hook }) : await connected.prepareVariant({ productVariantsDeleted: hook });
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
    const tooMany = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), { ids: ["a", "b", "c", "d", "e"] })));
    expectWorkflowRefusal(tooMany, "invalidInput"); expect(hook).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toBeNull();
    expect(hook.mock.calls[0]?.[0]).toEqual({ ids: [] });
    const ids = ["missing-deletion-" + kind, id, id], before = await events();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
    expect(hook.mock.calls[1]?.[0]).toEqual({ ids });
    const name = kind === "product" ? "product.deleted" : "product-variant.deleted";
    expect(idsIn((await events()).slice(before.length).filter(event => event.envelope.contract === name))).toEqual(ids);
    const deletedBefore = await events();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id] }))).toBeNull();
    const deletedAgain = (await events()).slice(deletedBefore.length);
    expect(idsIn(deletedAgain.filter(event => event.envelope.contract === name))).toEqual([id]);
    expect(deletedAgain.every(event => event.envelope.contract === name)).toBe(true);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: ["absent-only-" + kind] }))).toBeNull();
  });

  it.each(["product", "variant"] as const)("retains native reservation refusal ordering and rolls back the whole %s root", async kind => {
    const prefix = "deletion-reserved-" + kind, seeded = await connected.seed(prefix, 1, 2), inventoryIds = itemIds(prefix, 1);
    await connected.seedStock(prefix, inventoryIds, 1);
    const ids = kind === "product" ? seeded.map(product => product.id) : seeded.flatMap(product => product.variants.map(variant => variant.id));
    const host = kind === "product" ? await connected.prepareProduct() : await connected.prepareVariant();
    const pricing = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets"), inventory = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems");
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
    try {
      const result = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), { ids })));
      expect(result).toMatchObject({ _tag: "Failure" });
      expect(nativeFailure(result)).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
        message: `Cannot remove following inventory item(s) since they have reservations: [${inventoryIds.join(", ")}].` });
      expect(pricing).toHaveBeenCalledTimes(kind === "variant" ? 1 : 0);
      expect(inventory).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
    } finally { pricing.mockRestore(); inventory.mockRestore(); }
  });

  it.each(["product", "variant"] as const)("rolls back all lifecycle and Link changes when the %s completion hook throws", async kind => {
    const seeded = await connected.seed("deletion-hook-" + kind, 1, 2);
    const original = new Error("Deletion hook failed");
    const hook = vi.fn(() => { throw original; });
    const host = kind === "product" ? await connected.prepareProduct({ productsDeleted: hook }) : await connected.prepareVariant({ productVariantsDeleted: hook });
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes();
    const ids = kind === "product" ? seeded.map(product => product.id) : seeded.flatMap(product => product.variants.map(variant => variant.id));
    expectWorkflowDefect(await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), { ids }))), original);
    expect(hook).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
  });

  it("retains an Item shared with an outside unmanaged Variant while deleting the exclusively owned Item", async () => {
    const prefix = "deletion-shared", target = (await connected.seed(prefix, 1, 2))[0]!, outside = (await connected.seed(prefix + "-outside", 1, 2))[0]!;
    const outsideVariant = outside.variants[0]!, update = await connected.prepare();
    await Effect.runPromise(update.run(update.newRequestKey(), { products: [{ id: outside.id, variants: [{ id: outsideVariant.id, manage_inventory: false }] }] }));
    await connected.attachInventory(outsideVariant.id, itemIds(prefix, 1)[0]!);
    const host = await connected.prepareProduct({ productsDeleted: async (_value, context) => {
      expect((await context.resources.query.graph({ entity: "inventory", fields: ["id"], filters: { id: itemIds(prefix, 1) }, pagination: { take: 8 } })).data)
        .toEqual([{ id: itemIds(prefix, 1)[0] }]);
      expect((await context.resources.query.graph({ entity: "variants", fields: ["id", "manage_inventory"], filters: { id: outsideVariant.id }, pagination: { take: 4 } })).data)
        .toEqual([{ id: outsideVariant.id, manage_inventory: false }]);
    } });
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [target.id] }))).toBeNull();
  });

  it("admits false-flag Variants in the selected ownership map but creates no candidates when all flags are false", async () => {
    for (const mixed of [false, true]) {
      const prefix = "deletion-flags-" + mixed, seeded = await connected.seed(prefix, mixed ? 2 : 1, 2), disabled = seeded.at(-1)!;
      const update = await connected.prepare();
      await Effect.runPromise(update.run(update.newRequestKey(), { products: [{ id: disabled.id, variants: [{ id: disabled.variants[0]!.id, manage_inventory: false }] }] }));
      if (mixed) {
        await connected.dismissInventory(disabled.variants[0]!.id, itemIds(prefix, 2)[3]!);
        await connected.attachInventory(disabled.variants[0]!.id, itemIds(prefix, 2)[0]!);
      }
      const host = await connected.prepareVariant({ productVariantsDeleted: async (_value, context) => {
        const actual = await context.resources.query.graph({ entity: "inventory", fields: ["id"], filters: { id: itemIds(prefix, mixed ? 2 : 1) }, pagination: { take: 8 } });
        expect(actual.data.map(row => row.id)).toEqual(mixed ? itemIds(prefix, 2).slice(2) : itemIds(prefix, 1));
      } });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: seeded.flatMap(product => product.variants.map(variant => variant.id)) }))).toBeNull();
    }
  });

  it("refuses an oversized old owned graph after earlier child effects and rolls back everything", async () => {
    const seeded = await connected.seed("deletion-old-images", 1, 2), product = seeded[0]!;
    await connected.appendImage("deletion-old-images", product.id);
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes(), host = await connected.prepareProduct();
    const result = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), { ids: [product.id] })));
    expectWorkflowRefusal(result, "unsupportedProfile");
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
  });

  it("refuses an inverse ownership closure above four before deleting any target", async () => {
    const prefix = "deletion-inverse", target = (await connected.seed(prefix, 1, 2))[0]!, outside = await connected.seed(prefix + "-outside", 4, 2);
    for (const product of outside) await connected.attachInventory(product.variants[0]!.id, itemIds(prefix, 1)[0]!);
    const beforeState = await snapshot(), beforeEvents = await events(), beforeOutcomes = await outcomes(), host = await connected.prepareVariant();
    const result = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), { ids: [target.variants[0]!.id] })));
    expectWorkflowRefusal(result, "unsupportedProfile");
    expect(await snapshot()).toEqual(beforeState); expect(await events()).toEqual(beforeEvents); expect(await outcomes()).toEqual(beforeOutcomes);
  });
});

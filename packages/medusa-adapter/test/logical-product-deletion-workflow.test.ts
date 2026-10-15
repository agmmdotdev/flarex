import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { productDeletionResources } from "../src/workflow/policy";
import { prepareLogicalProductDeletion } from "./support/logical-product-deletion-fixture";
import type { ProductDeletionHooks } from "../src/workflows/product/deletion";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductDeletion>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const itemIds = (prefix: string, count: number) => Array.from({ length: count * 2 }, (_, index) => prefix + "-inventory-" + index);
const eventIds = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
const idsIn = (selected: Awaited<ReturnType<typeof events>>) => selected.flatMap(event => {
  const id = eventIds(event.envelope.message).data.id; return typeof id === "string" ? [id] : id;
});
type QueryResources = Pick<Parameters<NonNullable<ProductDeletionHooks["productsDeleted"]>>[1]["resources"], "query">;
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value === null || typeof value !== "object") return [];
  const reason: unknown = Object.getOwnPropertyDescriptor(value, "reason")?.value;
  const cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : reasons(cause))];
}

function failureMessages(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failureMessages(reason.error)
    : reason._tag === "Die" ? failureMessages(reason.defect) : []);
  if (value === null || typeof value !== "object") return [];
  const message: unknown = Object.getOwnPropertyDescriptor(value, "message")?.value;
  const cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof message === "string" ? [message] : []), ...(cause === undefined ? [] : failureMessages(cause))];
}

describe("native Product and Variant deletion roots", () => {
  beforeAll(async () => { connected = await prepareLogicalProductDeletion(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it.each(["product", "variant"] as const)("deletes the complete maximum %s graph and publishes its native event families once", async kind => {
    const prefix = "deletion-max-" + kind, seeded = await connected.seed(prefix, 4, 2, true), inventoryIds = itemIds(prefix, 4);
    await connected.seedStock(prefix, inventoryIds);
    const ids = kind === "product" ? seeded.map(product => product.id) : seeded.flatMap(product => product.variants.map(variant => variant.id));
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const limitedExecution = { ...connected.execution, prepare: (composition: Parameters<typeof connected.execution.prepare>[0]) =>
      connected.execution.prepare({ ...composition, requestCallLimit: 64 }) };
    const limited = kind === "product" ? await connected.prepareProduct({}, limitedExecution) : await connected.prepareVariant({}, limitedExecution);
    const refusal = await Effect.runPromise(Effect.result(limited.run(limited.newRequestKey(), { ids })));
    expect(refusal).toMatchObject({ _tag: "Failure" });
    expect(reasons(refusal._tag === "Failure" ? refusal.failure : undefined)).toContain("limitExceeded");
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
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
    expect((await commits()).length - beforeCommits.length).toBe(1);
    const finalRows = await rows(), finalEvents = await events();
    expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
    expect(hook).toHaveBeenCalledTimes(1); expect(await rows()).toEqual(finalRows); expect(await events()).toEqual(finalEvents);
  }, 240_000);

  it.each(["product", "variant"] as const)("preserves empty, missing and duplicate requested IDs in the %s hook and workflow events", async kind => {
    const seeded = await connected.seed("deletion-ids-" + kind, 1, 2), id = kind === "product" ? seeded[0]!.id : seeded[0]!.variants[0]!.id;
    const hook = vi.fn();
    const host = kind === "product" ? await connected.prepareProduct({ productsDeleted: hook }) : await connected.prepareVariant({ productVariantsDeleted: hook });
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const tooMany = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: ["a", "b", "c", "d", "e"] })));
    expect(tooMany).toMatchObject({ _tag: "Failure" }); expect(hook).not.toHaveBeenCalled();
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
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
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    try {
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids })));
      expect(result).toMatchObject({ _tag: "Failure" });
      expect(failureMessages(result._tag === "Failure" ? result.failure : undefined)).toContain(
        `Cannot remove following inventory item(s) since they have reservations: [${inventoryIds.join(", ")}].`);
      expect(pricing).toHaveBeenCalledTimes(kind === "variant" ? 1 : 0);
      expect(inventory).not.toHaveBeenCalled();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
    } finally { pricing.mockRestore(); inventory.mockRestore(); }
  });

  it.each(["product", "variant"] as const)("rolls back all lifecycle and Link changes when the %s completion hook throws", async kind => {
    const seeded = await connected.seed("deletion-hook-" + kind, 1, 2);
    const hook = vi.fn(() => { throw new Error("Deletion hook failed"); });
    const host = kind === "product" ? await connected.prepareProduct({ productsDeleted: hook }) : await connected.prepareVariant({ productVariantsDeleted: hook });
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const ids = kind === "product" ? seeded.map(product => product.id) : seeded.flatMap(product => product.variants.map(variant => variant.id));
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids })))).toMatchObject({ _tag: "Failure" });
    expect(hook).toHaveBeenCalledTimes(1); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
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
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits(), host = await connected.prepareProduct();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: [product.id] })));
    expect(result).toMatchObject({ _tag: "Failure" }); expect(reasons(result._tag === "Failure" ? result.failure : undefined)).toContain("unsupportedProfile");
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
  });

  it("refuses an inverse ownership closure above four before deleting any target", async () => {
    const prefix = "deletion-inverse", target = (await connected.seed(prefix, 1, 2))[0]!, outside = await connected.seed(prefix + "-outside", 4, 2);
    for (const product of outside) await connected.attachInventory(product.variants[0]!.id, itemIds(prefix, 1)[0]!);
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits(), host = await connected.prepareVariant();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: [target.variants[0]!.id] })));
    expect(result).toMatchObject({ _tag: "Failure" }); expect(reasons(result._tag === "Failure" ? result.failure : undefined)).toContain("unsupportedProfile");
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
  });
});

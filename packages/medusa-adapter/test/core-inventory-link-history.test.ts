import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Schema } from "effect";
import { LinkService } from "@medusajs/link-modules";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { getAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { prepareInventoryItemDeletionWorkflow } from "../src/workflows/inventory/delete-items";
import type { AtomicWorkflowExecution, AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareCoreInventoryItemDeletion } from "./support/core-inventory-item-delete-fixture";
import { prepareCoreInventoryCreateHost } from "./support/core-product-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreInventoryItemDeletion>>;
let unrelatedIds: readonly string[];
let unrelatedProductId: string;

/** A genuine smaller admitted native profile, using the same composition owner
 * as ordinary workflow preparation. No index metadata or query result changes. */
function eightLinkRows() {
  const observed: Array<{ calls: number; events: number; catalogRows: number }> = [];
  const execution: AtomicWorkflowExecution = { ...connected.execution,
    prepare: Effect.fn("InventoryLinkHistory.prepare")(function* (composition: AtomicWorkflowHostComposition) {
      let selected = 0;
      const participants = composition.participants.map(member => {
        if (getAtomicCommerceParticipant(member.participant) !== "inventory_item_links") return member;
        if (member.nativeStorage === undefined) throw new Error("Link history witness requires the authentic Core source");
        selected++;
        return { ...member, logicalResources: { ...defaultCommerceResources, ...member.logicalResources, catalogRows: 8 } };
      });
      expect(selected).toBe(1);
      const selectedComposition = { ...composition, participants, requestCallLimit: 64, requestEventLimit: 64 };
      const member = selectedComposition.participants.find(member => getAtomicCommerceParticipant(member.participant) === "inventory_item_links");
      if (member === undefined || member.nativeStorage === undefined || member.logicalResources === undefined)
        throw new Error("Missing admitted native Link capture allowance");
      observed.push({ calls: selectedComposition.requestCallLimit, events: selectedComposition.requestEventLimit,
        catalogRows: member.logicalResources.catalogRows });
      // The shared native configuration maps this member's catalogRows directly
      // to the live Core participant's maxIdentities; other member limits remain.
      return yield* connected.execution.prepare(selectedComposition);
    }) };
  return { execution, observed };
}

const linkRows = (ids: readonly string[]) => Effect.runPromise(connected.probe("product_variant_inventory_item", ids));

describe("native Item-endpoint complete Link history", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreInventoryItemDeletion(driver, close => cleanup.push(close));
    const unrelated = await connected.seed("reverse-unrelated", 2, 0, 1, true);
    unrelatedIds = [...unrelated.items, ...unrelated.outsideItems];
    const product = unrelated.products[0];
    if (product === undefined) throw new Error("Missing genuine unrelated Product");
    unrelatedProductId = product.id;
    expect((await linkRows(unrelatedIds)).length).toBeGreaterThan(8);
  }, 240_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Unable to close native Link history fixtures");
  }, 120_000);

  it("deletes and restores selected active and predeleted history within eight identities despite unrelated Links", async () => {
    const selected = await connected.seed("reverse-selected", 1, 0, 1);
    const first = selected.items[0];
    if (first === undefined) throw new Error("Missing selected native Item");
    const predelete = await connected.prepareLinkDelete();
    await Effect.runPromise(predelete.run(predelete.newRequestKey(), [first]));
    const before = await linkRows(selected.items), unrelated = await linkRows(unrelatedIds);
    expect(before.length).toBeGreaterThan(0); expect(before.length).toBeLessThanOrEqual(8);
    expect(before.some(row => row.deleted_at === null)).toBe(true);
    expect(before.some(row => typeof row.deleted_at === "string")).toBe(true);
    expect((await connected.creation.readTable("variant_links", "product_variant_inventory_item")).length).toBeGreaterThan(8);

    const limited = eightLinkRows();
    const host = await Effect.runPromise(prepareInventoryItemDeletionWorkflow({ ...connected.options, execution: limited.execution }));
    cleanup.push(() => Effect.runPromise(host.close));
    expect(await Effect.runPromise(host.run(host.newRequestKey(), selected.items))).toEqual(selected.items);
    const deleted = await linkRows(selected.items);
    expect(deleted.map(row => row.id)).toEqual(before.map(row => row.id));
    expect(deleted.every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(await linkRows(unrelatedIds)).toEqual(unrelated);

    const restore = await connected.prepareRestore(limited.execution);
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), selected.items))).toBeNull();
    const restored = await linkRows(selected.items);
    expect(restored.map(row => row.id)).toEqual(before.map(row => row.id));
    expect(restored.every(row => row.deleted_at === null)).toBe(true);
    expect(restored.map(({ updated_at: _updated, deleted_at: _deleted, ...row }) => row))
      .toEqual(before.map(({ updated_at: _updated, deleted_at: _deleted, ...row }) => row));
    expect(await linkRows(unrelatedIds)).toEqual(unrelated);
    expect(limited.observed).toEqual([{ calls: 64, events: 64, catalogRows: 8 }, { calls: 64, events: 64, catalogRows: 8 }]);
  }, 240_000);

  it("validates an empty endpoint after a genuine competing Link appears instead of capturing unrelated endpoints", async () => {
    const id = "reverse-empty-item";
    const create = await prepareCoreInventoryCreateHost(connected.fixture, connected.creation.inventory.inventory);
    try {
      await Effect.runPromise(create.host.run(create.host.newRequestKey(), create.create,
        [{ id, sku: id, title: "Initially unlinked Item" }]));
    } finally { await Effect.runPromise(create.host.close); }
    expect(await linkRows([id])).toEqual([]);
    const variants = await connected.appendVariant("reverse-new-membership", unrelatedProductId);
    const variant = variants[0];
    if (variant === undefined) throw new Error("Missing genuine competing Variant");
    const limited = eightLinkRows();
    const host = await Effect.runPromise(prepareInventoryItemDeletionWorkflow({ ...connected.options, execution: limited.execution }));
    cleanup.push(() => Effect.runPromise(host.close));
    const reached = Deferred.makeUnsafe<void>(), original = LinkService.prototype.softDelete;
    let finish: (() => void) | undefined;
    const native = vi.spyOn(LinkService.prototype, "softDelete").mockImplementation(async function (this: LinkService<JsonObject>, ...args) {
      const result = await Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; });
      return result;
    });
    const pending = Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), [id])));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      await connected.attachInventory(variant.id, id);
      const committed = await connected.fixture.snapshot();
      finish?.();
      const refused = await pending;
      if (Exit.isSuccess(refused)) throw new Error("Empty native Link membership ignored a competing insertion");
      expect(refused.cause.reasons.filter(Cause.isDieReason)).toEqual([]);
      expect(refused.cause.reasons.filter(Cause.isInterruptReason)).toEqual([]);
      expect(refused.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("writeConflict");
      expect(native).toHaveBeenCalledTimes(1);
      expect(await connected.fixture.snapshot()).toEqual(committed);
      const selected = await linkRows([id]);
      expect(selected).toHaveLength(1); expect(selected[0]).toMatchObject({ variant_id: variant.id, inventory_item_id: id, deleted_at: null });
      expect((await Effect.runPromise(connected.probe("inventory_item", [id])))[0]?.deleted_at).toBeNull();
      expect(limited.observed).toEqual([{ calls: 64, events: 64, catalogRows: 8 }]);
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 180_000);
});

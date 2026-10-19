import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLogicalFulfillmentDeliveryTranslation } from "./support/logical-fulfillment-delivery-translation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentDeliveryTranslation>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const idOf = (row: JsonObject) => Schema.decodeUnknownSync(Schema.String)(row.id);
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const unchanged = (before: Snapshot, after: Snapshot) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
};

describe("native Fulfillment Delivery module/query translation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalFulfillmentDeliveryTranslation(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes genuine native listFulfillments and exact singleton projection without a counted read", async () => {
    const created = await connected.seed("delivery145-query", { maximum: true }), id = idOf(created), host = await connected.prepareQuery(),
      list = vi.spyOn(FulfillmentModuleService.prototype, "listFulfillments"), count = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountFulfillments");
    try {
      const before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), id))).toEqual([{ id, delivered_at: null, canceled_at: null }]);
      expect(list).toHaveBeenCalledTimes(1); expect(count).not.toHaveBeenCalled();
      expect(list.mock.calls[0]?.slice(0, 2)).toEqual([{ id: [id] }, {
        select: ["id", "delivered_at", "canceled_at"], relations: [], order: { id: "ASC" }, take: null,
      }]);
      unchanged(before, await connected.snapshot());
    } finally { list.mockRestore(); count.mockRestore(); }
  }, 180_000);

  it.each(["missing", "historical"])("keeps native %s Query absence read-only", async kind => {
    const created = await connected.seed("delivery145-query-" + kind), id = kind === "missing" ? "ful145-never-created" : idOf(created);
    if (kind === "historical") await connected.arrangeShipment("fulfillment", "softDelete", [{ id }]);
    const host = await connected.prepareQuery(), before = await connected.snapshot();
    await expect(Effect.runPromise(host.run(host.newRequestKey(), id))).rejects.toMatchObject({ reason: "adapterFailure",
      cause: { type: "not_found", message: "Fulfillment id not found: " + id } });
    unchanged(before, await connected.snapshot());
  }, 180_000);

  it("assigns delivered_at through the actual native child and protects complete children and sibling rows", async () => {
    const created = await connected.seed("delivery145-update", { maximum: true }), id = idOf(created);
    await connected.seed("delivery145-update-protected", { maximum: true });
    const beforeRows = await connected.read(), before = await connected.snapshot(), host = await connected.prepareUpdate();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), id)), afterRows = await connected.read(), after = await connected.snapshot();
    expect(result).toMatchObject({ id, delivered_at: expect.any(String), shipped_at: null, canceled_at: null, items: created.items, labels: created.labels });
    expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
    const oldRoot = beforeRows.find(row => row.id === id), newRoot = afterRows.find(row => row.id === id);
    expect(newRoot).toEqual({ ...oldRoot, delivered_at: result.delivered_at, updated_at: expect.any(String) });
    expect(eventsSince(before, after).map(event => event.envelope.contract)).toEqual(["fulfillment.fulfillment.updated"]);
  }, 180_000);

  it("uses the actual projected StepResponse preimage for the native null inverse", async () => {
    const created = await connected.seed("delivery145-update-inverse", { maximum: true }), id = idOf(created), beforeRows = await connected.read(), before = await connected.snapshot();
    const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
    if (getter === undefined) throw new Error("Missing actual native retained compensation getter");
    const retained: unknown[] = [], preimage = Schema.Struct({ id: Schema.String, delivered_at: Schema.Null });
    const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
      const value: unknown = Reflect.apply(getter, this, []);
      if (Schema.is(preimage)(value)) retained.push(value);
      return value;
    });
    try {
      const host = await connected.prepareUpdate(() => {
        if (retained.length !== 1) throw new Error("Expected one observed native Delivery update preimage");
        return retained[0];
      });
      await Effect.runPromise(host.run(host.newRequestKey(), id));
      expect(retained).toEqual([{ id, delivered_at: null }]);
      const afterRows = await connected.read(), after = await connected.snapshot(), oldRoot = beforeRows.find(row => row.id === id);
      expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
      expect(afterRows.find(row => row.id === id)).toEqual({ ...oldRoot, updated_at: expect.any(String) });
      expect(eventsSince(before, after).map(event => event.envelope.contract)).toEqual(["fulfillment.fulfillment.updated", "fulfillment.fulfillment.updated"]);
    } finally { spy.mockRestore(); }
  }, 180_000);
});

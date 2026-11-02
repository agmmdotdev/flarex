import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { createCoreLinksFixture, type CoreLinkFamily, type CoreLinksFixture } from "./support/core-links-fixture";
import { EventEnvelope } from "../../persistence-postgres/src/commit/events/model";
import { CoreTransactionError } from "../../persistence-postgres/src/core/api";
import { CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { CorePersistenceError } from "../../persistence-postgres/src/core/contracts";
import { readDocumentObject } from "../../persistence-postgres/src/core/registry";
import { prepareCorePriceListCreation } from "./support/core-price-list-create-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Core Links driver");
let fixture: CoreLinksFixture;
let beforePricingReturn: (() => Promise<void>) | undefined;
const create = (family: CoreLinkFamily, pairs: Json, direct = false, key?: string) => {
  const { host, command } = fixture.select(family);
  return fixture.run(host.run(key ?? host.newRequestKey(), command.create, { pairs, direct }));
};
const dismiss = (family: CoreLinkFamily, pairs: Json) => {
  const { host, command } = fixture.select(family);
  return fixture.run(host.run(host.newRequestKey(), command.dismiss, pairs));
};
const restore = (family: CoreLinkFamily, selector: Json) => {
  const { host, command } = fixture.select(family);
  return fixture.run(host.run(host.newRequestKey(), command.restore, selector));
};
async function eventRows(selected = fixture) {
  const name = selected.eventDefinition.tables.find(table => table.privateEvent?.role === "envelope")?.name;
  if (name === undefined) throw new Error("Missing authentic event envelope table");
  const rows = (await selected.inventory()).rows.filter(row => row.table === name).toSorted((left, right) =>
    left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1
      : typeof left.value.ordinal === "number" && typeof right.value.ordinal === "number" ? left.value.ordinal - right.value.ordinal : 0);
  return Schema.decodeUnknownSync(Schema.Array(EventEnvelope))(rows.map(row => row.value.envelope));
}
function barrier() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve: () => { if (resolve === undefined) throw new Error("Missing barrier resolver"); resolve(); } };
}
function retainedCoreFailures(cause: Cause.Cause<unknown>, visited = new Set<object>()): readonly CoreTransactionError[] {
  if (visited.has(cause)) return [];
  visited.add(cause);
  return cause.reasons.flatMap(reason => {
    if (!Cause.isFailReason(reason)) return [];
    const error = reason.error;
    if (error instanceof CoreTransactionError) return [error];
    if (!(error instanceof CommerceTransactionError)) return [];
    if (error.cause instanceof CoreTransactionError) return [error.cause];
    return Cause.isCause(error.cause) ? retainedCoreFailures(error.cause, visited) : [];
  });
}

describe("standalone native Pricing and Variant Link Core installation", () => {
  const cleanup: Array<() => Promise<void>> = [];
  let connected: Awaited<ReturnType<typeof prepareCorePriceListCreation>>;
  beforeAll(async () => { connected = await prepareCorePriceListCreation(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("installs Pricing6 plus its one native flat Link and private events over exactly five physical tables", async () => {
    expect(connected.fixture.sources.map(source => source.definition.tables.length)).toEqual([6, 1]);
    expect(connected.fixture.sources.map(source => source.definition.source.key)).toEqual(["medusa.pricing", "medusa.variant-pricing-link"]);
    expect(connected.fixture.eventDefinition).toBeDefined();
    const link = connected.fixture.sources[1]?.definition;
    if (link === undefined) throw new Error("Missing actual standalone native Link source");
    expect(link.foreignKeys).toBeUndefined();
    expect(link.tables).toHaveLength(1);
    expect(await connected.fixture.physical.query(`select table_name as name from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE' order by table_name`, [connected.fixture.physical.namespace]))
      .toEqual(["documents", "indexes", "leases", "persistence_globals", "read_only"].map(name => ({ name })));
    const variantId = connected.variantIds[0], priceSetId = connected.setIds[0];
    if (variantId === undefined || priceSetId === undefined) throw new Error("Missing genuine standalone Link comparison seed");
    const host = await Effect.runPromise(connected.fixture.openReadHost("variant_pricing_link", [connected.link.count]));
    try {
      expect(await Effect.runPromise(host.read(connected.link.count, { filters: { variant_id: [variantId] },
        config: { select: ["variant_id", "price_set_id"], relations: [], skip: 0, take: 4, order: { variant_id: "ASC" } } })))
        .toEqual([[{ variant_id: variantId, price_set_id: priceSetId }], 1]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});

describe("actual stored Module Links through Core", () => {
  beforeAll(async () => {
    fixture = await createCoreLinksFixture(driver, { beforeCreateReturn: async family => {
      if (family === "pricing") await beforePricingReturn?.();
    } });
  }, 180_000);
  afterAll(async () => { if (fixture !== undefined) await fixture.close(); }, 120_000);

  it("installs genuine business tuple rows without endpoint FKs or private projection roles", async () => {
    expect(fixture.definitions.sales.tables.map(table => table.localName).sort()).toEqual(["product_sales_channel", "product_shipping_profile"]);
    const unique = new Set(Object.values(fixture.definitions));
    expect([...unique].flatMap(definition => definition.tables)).toHaveLength(4);
    for (const definition of unique) {
      expect(definition.foreignKeys).toBeUndefined();
      expect(definition.privateTables).toBeUndefined();
      for (const table of definition.tables) {
        expect(table.rowKey?.fields).toHaveLength(2);
        expect(table.privateReference).toBeUndefined();
        expect(table.privateEvent).toBeUndefined();
      }
    }
  });

  it("preserves missing endpoints, many cardinality and native rich defaults", async () => {
    await create("sales", [["absent-product", "absent-channel-a", { id: "sales-a" }], ["absent-product", "absent-channel-b", { id: "sales-b" }],
      ["another-absent-product", "absent-channel-a", { id: "sales-c" }]]);
    expect(await fixture.rows("sales", { product_id: "absent-product" })).toHaveLength(2);
    await create("sales", [["tuple-product-a", "tuple-channel-a", { id: "shared-business-id" }],
      ["tuple-product-b", "tuple-channel-b", { id: "shared-business-id" }]]);
    expect(await fixture.rows("sales", { id: "shared-business-id" })).toHaveLength(2);
    await create("inventory", [["absent-variant", "absent-item-default", { id: "rich-default" }],
      ["absent-variant", "absent-item-supplied", { id: "rich-supplied", required_quantity: 7 }]]);
    expect(await fixture.rows("inventory", { variant_id: "absent-variant" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rich-default", required_quantity: 1, deleted_at: null }),
      expect.objectContaining({ id: "rich-supplied", required_quantity: 7, deleted_at: null }),
    ]));
    const before = await fixture.data();
    await expect(create("inventory", [["valid-variant", "valid-item", {}], ["invalid-variant", "invalid-item", { required_quantity: 2147483648 }]]))
      .rejects.toBeDefined();
    expect(await fixture.data()).toEqual(before);
  });

  it("runs the existing selected Product Links commands and native router through the same Core host", async () => {
    const { host } = fixture.select("sales"), native = fixture.productRuntime;
    const sales = { product: { product_id: "named-product" }, sales_channel: { sales_channel_id: "named-channel" }, data: { id: "named-sales" } };
    const shipping = { product: { product_id: "named-product" }, fulfillment: { shipping_profile_id: "named-profile" }, data: { id: "named-shipping" } };
    const before = await eventRows();
    await fixture.run(host.run(host.newRequestKey(), native.create, sales));
    expect(await fixture.run(host.read(native.countSales, { filters: { product_id: "named-product" }, config: { take: 8 } })))
      .toMatchObject([[{ id: "named-sales", deleted_at: null }], 1]);
    await fixture.run(host.run(host.newRequestKey(), native.dismiss, sales));
    expect((await fixture.rows("sales", { product_id: "named-product" }))[0]?.deleted_at).toBeTypeOf("string");
    await fixture.run(host.run(host.newRequestKey(), native.create, shipping));
    await fixture.run(host.run(host.newRequestKey(), native.dismiss, shipping));
    await fixture.run(host.run(host.newRequestKey(), native.restoreShipping, { fulfillment: { shipping_profile_id: "named-profile" } }));
    expect(await fixture.run(host.read(native.countShipping, { filters: { product_id: "named-product" }, config: { take: 8 } })))
      .toMatchObject([[{ id: "named-shipping", deleted_at: null }], 1]);
    expect((await eventRows()).slice(before.length).map(event => event.contract)).toEqual([
      "LinkProductSalesChannel.attached", "LinkProductSalesChannel.detached", "LinkProductShippingProfile.attached",
      "LinkProductShippingProfile.detached", "LinkProductShippingProfile.attached",
    ]);
  });

  it("enforces both singular directions and rolls back a whole native bulk conflict", async () => {
    await create("pricing", [["cardinality-variant", "cardinality-set", { id: "cardinality-original" }]]);
    const before = await fixture.data(), eventsBefore = await eventRows();
    for (const pair of [["cardinality-variant", "different-set", {}], ["different-variant", "cardinality-set", {}]])
      await expect(create("pricing", [pair], true)).rejects.toBeDefined();
    await expect(create("pricing", [["bulk-variant", "bulk-set-a", {}], ["bulk-variant", "bulk-set-b", {}]], true)).rejects.toBeDefined();
    expect(await fixture.data()).toEqual(before);
    expect(await eventRows()).toEqual(eventsBefore);
  });

  it("keeps tuple identity and replacement timestamps while replaying the same request without new events", async () => {
    const { host } = fixture.select("pricing");
    const pairs = [["replacement-variant", "replacement-set", { id: "link-original" }]];
    const key = host.newRequestKey();
    const value = await create("pricing", pairs, true, key);
    const original = (await fixture.rows("pricing", { variant_id: "replacement-variant" }))[0];
    if (original === undefined) throw new Error("Missing genuine native Link row");
    const before = await fixture.inventory(), eventsBefore = await eventRows();
    const originalEnvelope = before.rows.find(row => row.value.id === "link-original")?.value._id;
    expect(originalEnvelope).toBeTypeOf("string");
    expect(await create("pricing", pairs, true, key)).toEqual(value);
    expect(await fixture.inventory()).toEqual(before);
    expect(await eventRows()).toEqual(eventsBefore);
    await create("pricing", [["replacement-variant", "replacement-set", { id: "link-replaced" }]], true);
    expect(await fixture.rows("pricing", { variant_id: "replacement-variant" })).toEqual([
      { ...original, id: "link-replaced", deleted_at: null },
    ]);
    expect((await fixture.inventory()).rows.find(row => row.value.id === "link-replaced")?.value._id).toBe(originalEnvelope);
  });

  it("retains dismiss history, refuses ambiguous restore, and restores only the exact native pair", async () => {
    await create("shipping", [["history-product", "old-profile", { id: "history-old" }]]);
    await dismiss("shipping", [["history-product", "old-profile"]]);
    await create("shipping", [["history-product", "new-profile", { id: "history-new" }]]);
    const active = await fixture.data();
    await expect(restore("shipping", { product_id: "history-product" })).rejects.toBeDefined();
    await expect(create("shipping", [["history-product", "old-profile", {}]], true)).rejects.toBeDefined();
    expect(await fixture.data()).toEqual(active);
    await dismiss("shipping", [["history-product", "new-profile"]]);
    const tombstones = await fixture.data();
    await expect(restore("shipping", { product_id: "history-product" })).rejects.toBeDefined();
    expect(await fixture.data()).toEqual(tombstones);
    await restore("shipping", { product_id: "history-product", shipping_profile_id: "old-profile" });
    const rows = await fixture.rows("shipping", { product_id: "history-product" });
    expect(rows.find(row => row.id === "history-old")?.deleted_at).toBeNull();
    expect(rows.find(row => row.id === "history-new")?.deleted_at).toBeTypeOf("string");
    await create("shipping", [["another-product", "old-profile", { id: "many-products-one-profile" }]]);
    expect(await fixture.rows("shipping", { shipping_profile_id: "old-profile" })).toHaveLength(2);
  });

  it("preserves an already active restore's ID and timestamps while durably retaining native event meaning", async () => {
    await create("pricing", [["restore-active-variant", "restore-active-set", { id: "restore-active" }]]);
    const original = await fixture.rows("pricing", { variant_id: "restore-active-variant" });
    const before = await eventRows();
    await restore("pricing", { variant_id: "restore-active-variant", price_set_id: "restore-active-set" });
    expect(await fixture.rows("pricing", { variant_id: "restore-active-variant" })).toEqual(original);
    const emitted = (await eventRows()).slice(before.length);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ contract: "LinkProductVariantPriceSet.attached", internal: true,
      message: { data: { id: "restore-active" } } });
  });

  it("refuses endpoint overrides and duplicate tuples before any partial native Link persists", async () => {
    const before = await fixture.data(), eventsBefore = await eventRows();
    for (const data of [{ variant_id: "override" }, { price_set_id: "override" }])
      await expect(create("pricing", [["override-valid", "override-first", {}], ["override-bad", "override-last", data]], true)).rejects.toBeDefined();
    await expect(create("sales", [["duplicate-product", "duplicate-channel", {}], ["duplicate-product", "duplicate-channel", {}]], true)).rejects.toBeDefined();
    expect(await fixture.data()).toEqual(before);
    expect(await eventRows()).toEqual(eventsBefore);
  });

  it("keeps a caught native cardinality failure sticky and rolls back a later root failure with its events", async () => {
    const { host, command } = fixture.select("pricing");
    const before = await fixture.data(), eventsBefore = await eventRows();
    await expect(fixture.run(host.run(host.newRequestKey(), command.caught, null))).rejects.toBeDefined();
    await expect(fixture.run(host.run(host.newRequestKey(), command.late,
      { pairs: [["late-variant", "late-set", { id: "late-row" }]], direct: false }))).rejects.toBeDefined();
    expect(await fixture.data()).toEqual(before);
    expect(await eventRows()).toEqual(eventsBefore);
  });

  it("keeps identical endpoints and request keys isolated between two app owners sharing the physical store", async () => {
    const other = await createCoreLinksFixture(driver, { sharedPhysical: fixture.physical, instanceName: "links-shop-b",
      target: { scopeUuid: "67200000-0000-4000-8000-000000000101", epochUuid: "67200000-0000-4000-8000-000000000102" } });
    try {
      const first = fixture.select("sales"), second = other.select("sales");
      const input = { pairs: [["shared-product", "shared-channel", { id: "shared-native-id" }]], direct: true };
      const key = "commerce/core-links-shared-request";
      await fixture.run(first.host.run(key, first.command.create, input));
      await other.run(second.host.run(key, second.command.create, input));
      expect(other.physical.namespace).toBe(fixture.physical.namespace);
      expect(other.physical.instanceName).not.toBe(fixture.physical.instanceName);
      const before = await other.inventory();
      await dismiss("sales", [["shared-product", "shared-channel"]]);
      expect(await other.inventory()).toEqual(before);
      expect((await other.rows("sales", { product_id: "shared-product" }))[0]?.deleted_at).toBeNull();
      expect((await fixture.rows("sales", { product_id: "shared-product" }))[0]?.deleted_at).toBeTypeOf("string");
    } finally { await other.close(); }
  }, 180_000);

  it("conflicts a stale native contender without replaying either service or publishing its events", async () => {
    const entered = barrier(), release = barrier();
    let callbacks = 0;
    beforePricingReturn = async () => { callbacks++; beforePricingReturn = undefined; entered.resolve(); await release.promise; };
    const first = create("pricing", [["contended-first", "contended-set", { id: "contended-loser" }]], true);
    try {
      await entered.promise;
      await create("pricing", [["contended-second", "contended-set", { id: "contended-winner" }]], true);
      release.resolve();
      await expect(first).rejects.toMatchObject({ reason: "writeConflict" });
      expect(callbacks).toBe(1);
      expect(await fixture.rows("pricing", { price_set_id: "contended-set" })).toMatchObject([{ id: "contended-winner" }]);
      const events = await eventRows();
      const IDs = events.flatMap(event => {
        if (!isJsonObject(event.message)) return [];
        const data = event.message.data;
        if (data === undefined || !isJsonObject(data)) return [];
        const ids = data.id;
        return ids === undefined ? [] : Array.isArray(ids) ? ids : [ids];
      });
      expect(IDs).toContain("contended-winner");
      expect(IDs).not.toContain("contended-loser");
    } finally { beforePricingReturn = undefined; release.resolve(); await Promise.allSettled([first]); }
  }, 60_000);

  it("charges actual stored Link rows to the user write budget", async () => {
    const bounded = await createCoreLinksFixture(driver, { transactionLimits: { documentsWritten: 0 } });
    try {
      const { host, command } = bounded.select("sales");
      const before = await bounded.data(), eventsBefore = await eventRows(bounded);
      const result = await bounded.run(Effect.exit(host.run(host.newRequestKey(), command.create,
        { pairs: [["budget-product", "budget-channel", { id: "budget-native-link" }]], direct: true })));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) throw new Error("A Link business row escaped its zero user-write allowance");
      expect(retainedCoreFailures(result.cause), Cause.pretty(result.cause)).toContainEqual(expect.objectContaining({
        reason: "capacity", cause: { budget: "documentsWritten", actual: 1, limit: 0 },
      }));
      expect(await bounded.data()).toEqual(before);
      expect(await eventRows(bounded)).toEqual(eventsBefore);
    } finally { await bounded.close(); }
  }, 180_000);

  it("reconciles Link acknowledgement loss and explicitly retries a proven noncommit through one shared generation owner", async () => {
    const callbacks: Record<CoreLinkFamily, number> = { sales: 0, shipping: 0, inventory: 0, pricing: 0 };
    const lostKey = "commerce/core-links-lost-ack", retryKey = "commerce/core-links-proven-noncommit";
    let fault: "none" | "ack" | "noncommit" = "none";
    const selected = await createCoreLinksFixture(driver, { beforeCreateReturn: async family => { callbacks[family]++; },
      wrapPersistence: persistence => ({ ...persistence, write: (lease, batch) => Effect.gen(function* () {
        const rows = batch.documents.filter(document => !document.deleted).map(document => Result.getOrThrow(readDocumentObject(document)));
        if (fault === "noncommit" && rows.some(row => row.id === "retry-pricing-link")) {
          fault = "none";
          return yield* new CorePersistenceError({ reason: "unavailable", cause: "Link save refused" });
        }
        yield* persistence.write(lease, batch);
        if (fault === "ack" && rows.some(row => row.key === lostKey && row.state === "committed")) {
          fault = "none";
          return yield* new CorePersistenceError({ reason: "uncertainWrite", cause: "Link acknowledgement lost" });
        }
      }) }) });
    const call = (family: CoreLinkFamily, pairs: Json, key?: string) => {
      const { host, command } = selected.select(family);
      return selected.run(host.run(key ?? host.newRequestKey(), command.create, { pairs, direct: true }));
    };
    try {
      await call("inventory", [["retained-variant", "retained-item", { id: "retained-rich-link", required_quantity: 3 }]]);
      await call("pricing", [["retained-pricing-variant", "retained-price-set", { id: "retained-pricing-link" }]]);
      const inventoryBefore = await selected.rows("inventory"), pricingBefore = await selected.rows("pricing"), eventsBefore = await eventRows(selected);
      const salesHost = selected.select("sales").host;
      const salesInput = [["lost-product", "lost-channel", { id: "lost-ack-sales-link" }]];
      fault = "ack";
      await expect(call("sales", salesInput, lostKey)).rejects.toMatchObject({ reason: "decisionUncertain", cause: { reason: "uncertainWrite" } });
      await selected.run(selected.recover);
      expect(callbacks.sales).toBe(1);
      expect(selected.select("sales").host).toBe(salesHost);
      expect(await selected.rows("inventory")).toEqual(inventoryBefore);
      expect(await selected.rows("pricing")).toEqual(pricingBefore);
      expect(await selected.rows("sales", { product_id: "lost-product" })).toMatchObject([{ id: "lost-ack-sales-link" }]);
      const replay = await call("sales", salesInput, lostKey);
      const afterLoss = await selected.data(), afterLossEvents = await eventRows(selected);
      expect(await call("sales", salesInput, lostKey)).toEqual(replay);
      expect(await selected.data()).toEqual(afterLoss);
      expect(await eventRows(selected)).toEqual(afterLossEvents);
      expect(afterLossEvents.slice(eventsBefore.length).map(event => event.contract)).toEqual(["LinkProductSalesChannel.attached"]);
      expect(callbacks).toEqual({ sales: 1, shipping: 0, inventory: 1, pricing: 1 });

      const retryInput = [["retry-pricing-variant", "retry-price-set", { id: "retry-pricing-link" }]];
      fault = "noncommit";
      await expect(call("pricing", retryInput, retryKey)).rejects.toMatchObject({ reason: "resourceFailure", cause: { reason: "unavailable" } });
      await selected.run(selected.recover);
      expect(await selected.data()).toEqual(afterLoss);
      expect(await eventRows(selected)).toEqual(afterLossEvents);
      expect(callbacks.pricing).toBe(2);
      const retried = await call("pricing", retryInput, retryKey);
      expect(callbacks.pricing).toBe(3);
      expect(await selected.rows("pricing", { variant_id: "retry-pricing-variant" })).toMatchObject([{ id: "retry-pricing-link" }]);
      const committed = await selected.data(), committedEvents = await eventRows(selected);
      expect(await call("pricing", retryInput, retryKey)).toEqual(retried);
      expect(await selected.data()).toEqual(committed);
      expect(await eventRows(selected)).toEqual(committedEvents);
      expect(committedEvents.slice(afterLossEvents.length).map(event => event.contract)).toEqual(["LinkProductVariantPriceSet.attached"]);
      expect(callbacks).toEqual({ sales: 1, shipping: 0, inventory: 1, pricing: 3 });
    } finally { await selected.close(); }
  }, 180_000);
});

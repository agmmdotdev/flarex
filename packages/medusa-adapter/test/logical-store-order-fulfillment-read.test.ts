import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import { makeFulfillmentStoreOrderReadCommands } from "../src/modules/fulfillment/store-order-read-service";
import { compileFulfillmentCreationCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareOrderFulfillmentLinkRead } from "../src/links/order-fulfillment-service";
import { compileOrderFulfillmentLinkCoreDefinition } from "../src/links/order-fulfillment-schema";
import { createCoreNativeWorkflowFixture } from "./support/core-native-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const counted = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Int]));
let fulfillment: Effect.Success<ReturnType<typeof makeFulfillmentStoreOrderReadCommands>>;
let link: Effect.Success<ReturnType<typeof prepareOrderFulfillmentLinkRead>>;
let fixture: Awaited<ReturnType<typeof createCoreNativeWorkflowFixture>>;
beforeAll(async () => {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  fulfillment = await Effect.runPromise(makeFulfillmentStoreOrderReadCommands());
  link = await Effect.runPromise(prepareOrderFulfillmentLinkRead());
  const [definition, linkDefinition] = await Effect.runPromise(Effect.all([
    compileFulfillmentCreationCoreDefinition(target), compileOrderFulfillmentLinkCoreDefinition(target),
  ]));
  fixture = await createCoreNativeWorkflowFixture(driver, { sources: [
    { name: "fulfillment", definition, initialCommands: fulfillment.commands, rows: [
      ...Array.from({ length: 5 }, (_, index) => ({ table: "fulfillment_address", row: { id: "fuladdr-store-" + index, city: "Destination " + index, country_code: "us" } })),
      ...Array.from({ length: 5 }, (_, index) => ({ table: "fulfillment", row: { id: "ful-store-" + index, location_id: "location-store",
        delivery_address_id: "fuladdr-store-" + index, packed_at: "2026-01-01T00:00:00.000Z" } })),
      { table: "fulfillment_item", row: { id: "fulit-store", fulfillment_id: "ful-store-0", title: "Native item", sku: "native-sku", barcode: "native-barcode",
        quantity: "2.5", raw_quantity: { value: "2.5", precision: 20 }, line_item_id: "order-line-store" } },
      { table: "fulfillment_label", row: { id: "fulla-store", fulfillment_id: "ful-store-0", tracking_number: "native-tracking",
        tracking_url: "https://tracking.test/native", label_url: "https://labels.test/native" } },
    ] },
    { name: "order_fulfillment_links", definition: linkDefinition, initialCommands: link.commands,
      rows: Array.from({ length: 5 }, (_, index) => ({ table: "order_fulfillment", row: {
        id: "ordful-store-" + index, order_id: "order-store-" + index, fulfillment_id: "ful-store-" + index,
      } })) },
  ] });
}, 300_000);
afterAll(() => fixture?.close(), 120_000);

it("reads nonempty native Fulfillment children and owning Address plus a Link cohort beyond four", async () => {
  const before = await fixture.snapshot();
  const host = await fixture.run(fixture.openReadHost("fulfillment", fulfillment.commands));
  const links = await fixture.run(fixture.openReadHost("order_fulfillment_links", link.commands));
  try {
    const [rows, count] = counted(await Effect.runPromise(host.read(fulfillment.count, { filters: {
      id: Array.from({ length: 5 }, (_, index) => "ful-store-" + index),
    }, config: { select: ["id", "packed_at", "items", "labels", "delivery_address"], relations: ["items", "labels", "delivery_address"], take: 256, skip: 0 } })));
    expect(count).toBe(5);
    expect(rows[0]).toMatchObject({ id: "ful-store-0", packed_at: "2026-01-01T00:00:00.000Z",
      items: [{ id: "fulit-store", quantity: 2.5, raw_quantity: { value: "2.5", precision: 20 } }],
      labels: [{ id: "fulla-store", tracking_number: "native-tracking" }],
      delivery_address: { id: "fuladdr-store-0", city: "Destination 0" } });
    const [pairs, total] = counted(await Effect.runPromise(links.read(link.count, { filters: {
      order_id: Array.from({ length: 5 }, (_, index) => "order-store-" + index),
    }, config: { select: ["id", "order_id", "fulfillment_id"], relations: [], take: 256, skip: 0 } })));
    expect(total).toBe(5);
    expect(pairs.map(row => row.fulfillment_id)).toEqual(Array.from({ length: 5 }, (_, index) => "ful-store-" + index));
  } finally { await Effect.runPromise(links.close); await Effect.runPromise(host.close); }
  expect(await fixture.snapshot()).toEqual(before);
});

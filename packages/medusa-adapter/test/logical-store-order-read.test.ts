import { Effect, Result, Schema } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import { makeStoreOrderReadCommands } from "../src/modules/order/store-read-service";
import { prepareCoreOrderFixture, finishOrderFixture } from "./support/core-order-fixture";
import { storeOrderReadResources } from "../src/modules/order/store-read-input";
import { captureNativeNumericDto } from "../src/value/native-numeric";
import { orderTotalsFields } from "@medusajs/order/utils/totals-selection";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let order: Effect.Success<ReturnType<typeof makeStoreOrderReadCommands>>;
let local: Awaited<ReturnType<typeof prepareCoreOrderFixture>>;
const itemVersions = Array.from({ length: 53 }, (_, index) => ({ index, version: index === 1 ? 2 : 1 }))
  .concat([{ index: 0, version: 2 }, { index: 1, version: 1 }]);
beforeAll(async () => {
  order = await Effect.runPromise(makeStoreOrderReadCommands());
  local = await prepareCoreOrderFixture(driver, close => cleanup.push(close), order.commands, [
    ...Array.from({ length: 53 }, (_, index) => ({ table: "order", row: { id: "order-store-" + String(index).padStart(3, "0"),
      display_id: index + 1, currency_code: "usd", version: index === 1 ? 2 : 1,
      status: index % 2 === 0 ? "pending" : "completed", customer_id: "customer-store", is_draft_order: false } })),
    ...Array.from({ length: 53 }, (_, index) => ({ table: "order_summary", row: { id: "summary-store-" + index,
      order_id: "order-store-" + String(index).padStart(3, "0"), version: index === 1 ? 2 : 1, totals: { current_order_total: index + 10 } } })),
    ...itemVersions.map(({ index, version }) => ({ table: "order_line_item", row: { id: `item-store-${index}-v${version}`,
      title: "Versioned Store item", unit_price: "10", raw_unit_price: { value: "10", precision: 20 } } })),
    ...itemVersions.map(({ index, version }) => ({ table: "order_item", row: { id: `detail-store-${index}-v${version}`,
      order_id: "order-store-" + String(index).padStart(3, "0"), item_id: `item-store-${index}-v${version}`, version,
      quantity: "1", raw_quantity: { value: "1", precision: 20 } } })),
    { table: "order_summary", row: { id: "summary-store-stale-0", order_id: "order-store-000", version: 2, totals: { current_order_total: 999 } } },
    { table: "order_summary", row: { id: "summary-store-stale-1", order_id: "order-store-001", version: 1, totals: { current_order_total: 999 } } },
    { table: "order", row: { id: "order-other-customer", display_id: 100, currency_code: "usd", status: "pending", customer_id: "customer-other", is_draft_order: false } },
    { table: "order", row: { id: "order-store-draft", display_id: 101, currency_code: "usd", status: "pending", customer_id: "customer-store", is_draft_order: true } },
  ]);
}, 300_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

it("pages and counts the genuine native service across more than fifty Orders without durable read effects", async () => {
  const before = await local.snapshot();
  const host = await local.fixture.run(local.fixture.openReadHost("order", order.commands, {
    resources: storeOrderReadResources, nativeLimits: { maxIdentities: 2048, maxDocumentBytes: commerceLimits.rowBytes },
  }));
  try {
    const read = (config: { take: number; skip?: number; order?: { id: "ASC" | "DESC" } }) => Effect.runPromise(host.read(order.orders, {
      filters: { customer_id: "customer-store", is_draft_order: false }, config: { ...config, select: ["id", "status", "version", "currency_code"] },
    }));
    const first = await read({ take: 50, order: { id: "ASC" } });
    expect(first).toMatchObject([expect.arrayContaining([{ id: "order-store-000", status: "pending", version: 1, currency_code: "usd" }]), 53]);
    expect(Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Int]))(first)[0]).toHaveLength(50);
    expect(await read({ take: 50, skip: 50, order: { id: "ASC" } })).toEqual([
      [50, 51, 52].map(index => ({ id: "order-store-" + String(index).padStart(3, "0"), status: index % 2 === 0 ? "pending" : "completed", version: 1, currency_code: "usd" })), 53,
    ]);
    expect(await read({ take: 0 })).toEqual([[], 53]);
    const descending = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Int]))(await read({ take: 1, order: { id: "DESC" } }));
    expect(descending[0][0]?.id).toBe("order-store-052");
    const [populated, count] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Int]))(
      await Effect.runPromise(host.read(order.orders, { filters: { customer_id: "customer-store", is_draft_order: false },
        config: { select: ["id", "version", "items", "summary"], relations: ["items", "summary"], take: 50, skip: 0 } })));
    expect(count).toBe(53); expect(populated).toHaveLength(50);
    expect(populated[0]).toMatchObject({ id: "order-store-000", version: 1,
      summary: { current_order_total: 10 }, items: [{ id: "item-store-0-v1", detail: { version: 1 } }] });
    expect(populated[1]).toMatchObject({ id: "order-store-001", version: 2,
      summary: { current_order_total: 11 }, items: [{ id: "item-store-1-v2", detail: { version: 2 } }] });
    expect(Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(populated[0]?.items)).toHaveLength(1);
    expect(Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(populated[1]?.items)).toHaveLength(1);
    const numeric = await Effect.runPromise(host.read(order.orders, { filters: { customer_id: "customer-store", is_draft_order: false },
      config: { select: ["id", "status", "version", "currency_code", "summary", "items.*", "items.detail.*", ...orderTotalsFields()],
        relations: ["items", "summary"], take: 50, skip: 0 } }));
    const [full, total] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Int]))(numeric);
    expect(total).toBe(53); expect(full).toHaveLength(50);
    expect(full[0]).toMatchObject({ id: "order-store-000", total: 10, item_total: 10,
      items: [{ id: "item-store-0-v1", total: 10, detail: { version: 1 } }] });
    expect(full[49]).toMatchObject({ id: "order-store-049", total: 10, items: [{ id: "item-store-49-v1", total: 10 }] });
    expect(captureNativeNumericDto(numeric)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(Result.isSuccess(captureNativeNumericDto(numeric, storeOrderReadResources))).toBe(true);
  } finally { await Effect.runPromise(host.close); }
  expect(await local.snapshot()).toEqual(before);
});

import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PaymentEvents } from "@medusajs/framework/utils/portable";
import { prepareCorePaymentFinance } from "./support/core-payment-finance-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { orderFinanceRows, type OrderFinanceInitialRow } from "./support/logical-order-finance-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const json = Schema.decodeUnknownSync(Schema.Json);

// A real discounted item and manual shipping preserve the original total of
// 15 while exercising native adjustment cloning and preview relation reads.
const previewRows: readonly OrderFinanceInitialRow[] = [
  ...orderFinanceRows.map(value => {
    const row = { ...value.row };
    if (value.table === "order_shipping_method") delete row.shipping_option_id;
    if (value.table === "order_line_item" || value.table === "order_item") {
      row.unit_price = "13.500000000000000000";
      row.raw_unit_price = { value: "13.500000000000000000", precision: 20 };
    }
    return { ...value, row };
  }),
  { table: "order_line_item_adjustment", row: { id: "ordliadj-finance", item_id: "ordli-finance", version: 1,
    amount: "1.0000000000000000000", raw_amount: { value: "1.0000000000000000000", precision: 20 }, code: "discount" } },
];

describe("genuine native single Payment refund with Order credit lines", () => {
  const cleanup: Array<() => Promise<void>> = [];
  let fixture: Awaited<ReturnType<typeof prepareCorePaymentFinance>>;
  beforeAll(async () => { fixture = await prepareCorePaymentFinance(driver, close => cleanup.push(close), previewRows); }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("refunds, confirms the native credit-line child, and replays the complete atomic result", async () => {
    const payment = object(await Effect.runPromise(fixture.authorize.run(fixture.authorize.newRequestKey(), { id: "payses_finance" })));
    const id = text(payment.id);
    await Effect.runPromise(fixture.capture.run(fixture.capture.newRequestKey(), { payment_id: id }));
    const before = await fixture.snapshot();
    const key = fixture.refund.newRequestKey(), input = { payment_id: id, amount: "3.125", note: "Native single refund" };
    const result = await Effect.runPromise(fixture.refund.run(key, input));
    expect(result).toMatchObject({ id, refunds: [] });
    const beforeReplay = await fixture.snapshot();
    const timestamp = expectCheckoutSettlement(before, beforeReplay, key);
    expect(beforeReplay.events.filter(event => event.envelope.contract === PaymentEvents.REFUNDED))
      .toMatchObject([{ timestamp, envelope: { message: { data: { id } } } }]);
    expect(await Effect.runPromise(fixture.refund.run(key, input))).toEqual(result);
    expect(await fixture.snapshot()).toEqual(beforeReplay);
    const rows = await fixture.read();
    expect(rows.find(row => row.id === "order-finance")?.version).toBe(2);
    const previousShipping = rows.find(row => row.id === "ordspmv-finance");
    const nextShipping = rows.filter(row => row.order_id === "order-finance" && row.shipping_method_id === "ordsm-finance" && row.version === 2);
    expect(previousShipping).toBeDefined();
    expect(nextShipping).toHaveLength(1);
    expect(nextShipping[0]?.id).not.toBe(previousShipping?.id);
    expect(nextShipping[0]).toMatchObject({ created_at: previousShipping?.created_at,
      updated_at: previousShipping?.updated_at, deleted_at: previousShipping?.deleted_at });
    const refund = rows.find(row => typeof row.id === "string" && row.id.startsWith("ref_"));
    expect(refund).toMatchObject({ payment_id: id, amount: "3.1250000000000000000", note: "Native single refund" });
    const transactions = rows.filter(row => row.reference === "refund" && row.reference_id === refund?.id);
    expect(transactions).toMatchObject([{ order_id: "order-finance", amount: "-3.1250000000000000000", version: 1 }]);
    const changes = rows.filter(row => typeof row.id === "string" && row.id.startsWith("ordch_"));
    expect(changes).toMatchObject([{ version: 2, status: "confirmed", confirmed_at: expect.any(String) }]);
    const actions = rows.filter(row => typeof row.id === "string" && row.id.startsWith("ordchact_"));
    expect(actions).toMatchObject([{ version: 2, applied: true, action: "CREDIT_LINE_ADD", ordering: expect.any(Number) }]);
    const credits = rows.filter(row => typeof row.id === "string" && row.id.startsWith("ordcl_"));
    expect(credits).toMatchObject([{ version: 2, amount: "3.1250000000000000000", reference: "payment_collection" }]);
    const adjustments = rows.filter(row => row.item_id === "ordli-finance" && row.version === 2 && row.code === "discount");
    expect(adjustments).toMatchObject([{ amount: "1.0000000000000000000" }]);
    const currentSummary = rows.find(row => typeof row.id === "string" && row.id.startsWith("ordsum_") && row.version === 2);
    expect(currentSummary?.totals).toMatchObject({ paid_total: 15, refunded_total: 3.125, transaction_total: 11.875, pending_difference: 0 });
    for (const row of [refund, transactions[0], changes[0], actions[0], credits[0], adjustments[0], nextShipping[0], currentSummary])
      expect(beforeReplay.revisions).toContainEqual(expect.objectContaining({ timestamp, value: expect.objectContaining({ id: text(row?.id) }) }));
    expect(fixture.errors).toEqual([]);
  }, 240_000);

  it("uses a stored native refund reason when the native root defaults to a full refund", async () => {
    const reasonFixture = await prepareCorePaymentFinance(driver, close => cleanup.push(close), previewRows, "linked", fixture.fixture.physical);
    const payment = object(await Effect.runPromise(reasonFixture.authorize.run(reasonFixture.authorize.newRequestKey(), { id: "payses_finance" })));
    const id = text(payment.id);
    await Effect.runPromise(reasonFixture.capture.run(reasonFixture.capture.newRequestKey(), { payment_id: id }));
    const key = reasonFixture.refund.newRequestKey(), input = { payment_id: id, refund_reason_id: "refr-finance" };
    const result = await Effect.runPromise(reasonFixture.refund.run(key, input));
    expect(result).toMatchObject({ id, refunds: [] });
    const inventory = await reasonFixture.snapshot();
    expect(await Effect.runPromise(reasonFixture.refund.run(key, input))).toEqual(result);
    expect(await reasonFixture.snapshot()).toEqual(inventory);
    const rows = await reasonFixture.read();
    expect(rows.find(row => typeof row.id === "string" && row.id.startsWith("ref_")))
      .toMatchObject({ payment_id: id, refund_reason_id: "refr-finance", amount: "15.000000000000000000" });
    expect(rows.filter(row => typeof row.id === "string" && row.id.startsWith("ordcl_")))
      .toMatchObject([{ version: 2, reference: "Native refund reason", reference_id: "NATIVE_REFUND", amount: "15.000000000000000000" }]);
    expect(rows.find(row => row.id === "order-finance")?.version).toBe(2);
    expect(reasonFixture.errors).toEqual([]);
  }, 240_000);

  it("refuses a missing native refund reason and publishes no Payment or Order changes", async () => {
    const id = text((await fixture.read()).find(row => row.payment_session_id === "payses_finance")?.id);
    const before = await fixture.fixture.inventory(), key = fixture.refund.newRequestKey();
    const result = await Effect.runPromise(Effect.result(fixture.refund.run(key, {
      payment_id: id, amount: "1", refund_reason_id: "refr-missing",
    })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: {
      type: "not_found", message: "RefundReason id not found: refr-missing",
    } } });
    await expectCheckoutRollback(fixture.fixture, before, key);
  }, 240_000);

  it("refuses over-refunds without publishing Core rows, revisions, indexes or events", async () => {
    const rows = await fixture.read(), id = text(rows.find(row => row.payment_session_id === "payses_finance")?.id);
    const before = await fixture.fixture.inventory(), key = fixture.refund.newRequestKey();
    const result = await Effect.runPromise(Effect.result(fixture.refund.run(key, { payment_id: id, amount: "12" })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { cause: { type: "invalid_data",
      message: "You are not allowed to refund more than the captured amount" } } });
    await expectCheckoutRollback(fixture.fixture, before, key);
  }, 240_000);
});

describe("retained native confirmation inverse", () => {
  const cleanup: Array<() => Promise<void>> = [];
  let fixture: Awaited<ReturnType<typeof prepareCorePaymentFinance>>;
  beforeAll(async () => { fixture = await prepareCorePaymentFinance(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("restores the prior version with native undo and keeps inverse replay stable", async () => {
    const create = await fixture.prepareRetainedChange("change"), actions = await fixture.prepareRetainedChange("actions");
    const change = object(await Effect.runPromise(create.run(create.newRequestKey(), { order_id: "order-finance", change_type: "credit_line" })));
    const changeId = text(change.retained);
    await Effect.runPromise(actions.run(actions.newRequestKey(), [{ order_change_id: changeId, action: "CREDIT_LINE_ADD", amount: "3.125" }]));
    const forward = await fixture.prepareRetainedConfirmation(), inverse = await fixture.prepareRetainedConfirmation(true);
    const confirmed = object(await Effect.runPromise(forward.run(forward.newRequestKey(), {
      orderId: "order-finance", changes: [{ id: changeId, status: "pending" }],
    })));
    expect(confirmed.output).toMatchObject({ credit_lines: [{ version: 2, amount: 3.125 }] });
    const beforeUndo = await fixture.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, json(confirmed.retained)))).toBeNull();
    const inventory = await fixture.snapshot();
    expectCheckoutSettlement(beforeUndo, inventory, key);
    expect(await Effect.runPromise(inverse.run(key, json(confirmed.retained)))).toBeNull();
    expect(await fixture.snapshot()).toEqual(inventory);
    const rows = await fixture.read();
    expect(rows.find(row => row.id === "order-finance")?.version).toBe(1);
    expect(rows.find(row => row.id === changeId)).toMatchObject({ status: "pending", confirmed_at: null });
    expect(rows.filter(row => row.order_change_id === changeId)).toMatchObject([{ applied: false }]);
    expect(rows.filter(row => row.order_id === "order-finance" && row.version === 2 && row.deleted_at !== undefined && row.deleted_at !== null))
      .toHaveLength(4);
    expect(fixture.errors).toEqual([]);
  }, 240_000);
});

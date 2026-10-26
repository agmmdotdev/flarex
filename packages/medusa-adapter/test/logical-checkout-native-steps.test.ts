import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareLogicalOrderCheckout } from "./support/logical-order-checkout-fixture";
import { prepareLogicalPaymentFinance } from "./support/logical-payment-finance-fixture";
import { paymentCollectionId } from "./support/logical-payment-session-fixture";
import { prepareNativePaymentRecreation, prepareRetainedCheckoutPayment } from "./support/logical-checkout-payment-compensation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), string = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];

describe("genuine checkout child steps", () => {
  let order: Awaited<ReturnType<typeof prepareLogicalOrderCheckout>>;
  beforeAll(async () => { order = await prepareLogicalOrderCheckout(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.splice(0).reverse()) await close(); }, 120_000);
  it("retains actual native creation IDs and executes the native Order inverse completely", async () => {
    const forward = await order.retainedCreation(), inverse = await order.retainedCreation(true);
    const created = object(await Effect.runPromise(forward.run(forward.newRequestKey(), [{ currency_code: "usd",
      items: [{ title: "Native inverse item", quantity: 1, unit_price: "12.5", requires_shipping: false }] }])));
    const retained = Schema.decodeUnknownSync(Schema.Array(Schema.String))(created.retained);
    expect(retained).toHaveLength(1);
    expect(created.output).toMatchObject([{ id: retained[0], items: [{ title: "Native inverse item" }] }]);
    const before = await order.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
    const after = await order.snapshot();
    expect(after.rowChanges.length - before.rowChanges.length).toBe(4);
    expect(await order.read(retained)).toEqual([]);
    expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
    expect(await order.snapshot()).toEqual(after);
  }, 240_000);
});

describe("native checkout Payment recreation child", () => {
  const releases: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentFinance>>;
  beforeAll(async () => { local = await prepareLogicalPaymentFinance(driver, close => releases.push(close)); }, 240_000);
  afterAll(async () => { for (const release of releases.reverse()) await release(); }, 120_000);
  it("refunds a captured Payment, preserves Order accounting and replaces the active session in one replayed root", async () => {
    const authorized = object(await Effect.runPromise(local.authorize.run(local.authorize.newRequestKey(), { id: "payses_finance" })));
    const paymentId = string(authorized.id);
    await Effect.runPromise(local.capture.run(local.capture.newRequestKey(), { payment_id: paymentId }));
    const host = await prepareNativePaymentRecreation(local, close => releases.push(close));
    const before = await local.snapshot(), key = host.newRequestKey(), input = { payment_collection_id: paymentCollectionId,
      provider_id: "pp_system_default" as const, payment_id: paymentId, amount: "15", note: "Refunded due to cart completion failure" };
    const exit = await Effect.runPromiseExit(host.run(key, input));
    if (Exit.isFailure(exit)) {
      expect(await local.snapshot()).toEqual(before);
      throw new Error(Cause.pretty(exit.cause));
    }
    const result = object(exit.value);
    expect(result).toMatchObject({ payment_collection_id: paymentCollectionId, amount: 15, status: "pending" });
    expect(result.id).not.toBe("payses_finance");
    const after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    const current = await local.read();
    expect(current.find(row => row.id === "payses_finance")).toMatchObject({ authorized_at: expect.any(String) });
    expect(current.find(row => row.id === paymentId)).toMatchObject({ payment_session_id: "payses_finance" });
    expect((await local.read()).find(row => row.id === "ordsum-finance")?.totals).toMatchObject({ paid_total: 15, refunded_total: 15, transaction_total: 0 });
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);
});

describe("native checkout retained Payment compensator", () => {
  const releases: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentFinance>>;
  beforeAll(async () => {
    local = await prepareLogicalPaymentFinance(driver, close => releases.push(close));
    const payment = object(await Effect.runPromise(local.authorize.run(local.authorize.newRequestKey(), { id: "payses_finance" })));
    await Effect.runPromise(local.capture.run(local.capture.newRequestKey(), { payment_id: string(payment.id) }));
  }, 240_000);
  afterAll(async () => { for (const release of releases.reverse()) await release(); }, 120_000);
  it("rolls back the actual captured-Payment callback child, replacement and Order accounting after a late failure", async () => {
    const forward = await prepareRetainedCheckoutPayment(local, "forward", close => releases.push(close));
    const retained = object(await Effect.runPromise(forward.run(forward.newRequestKey(), "payses_finance")));
    expect(retained).toEqual({ output: "payses_finance", retained: "payses_finance" });
    const inverse = await prepareRetainedCheckoutPayment(local, "late", close => releases.push(close)), before = await local.snapshot();
    const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), string(retained.retained)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late failure after native checkout Payment inverse");
    expect(await local.snapshot()).toEqual(before);
    expect(local.errors).toEqual([]);
  }, 240_000);
  it("executes the retained inverse through its declared child and replays one outer outcome", async () => {
    const inverse = await prepareRetainedCheckoutPayment(local, "inverse", close => releases.push(close));
    const before = await local.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, "payses_finance"))).toBeNull();
    const after = await local.snapshot(), rows = await local.read();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(rows.find(row => row.id === "payses_finance")).toMatchObject({ authorized_at: expect.any(String) });
    expect(rows.filter(row => row.payment_collection_id === paymentCollectionId && row.status === "pending")).toHaveLength(1);
    expect(rows.find(row => row.id === "ordsum-finance")?.totals).toMatchObject({ refunded_total: 15, transaction_total: 0 });
    expect(await Effect.runPromise(inverse.run(key, "payses_finance"))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
    expect(local.errors).toEqual([]);
  }, 240_000);
});

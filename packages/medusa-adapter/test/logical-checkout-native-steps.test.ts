import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareCorePaymentFinance } from "./support/core-payment-finance-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { paymentCollectionId } from "./support/payment-fixture-data";
import { prepareNativePaymentRecreation, prepareRetainedCheckoutPayment } from "./support/checkout-payment-compensation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), string = Schema.decodeUnknownSync(Schema.String);

describe("native checkout Payment recreation child", () => {
  const releases: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareCorePaymentFinance>>;
  beforeAll(async () => { local = await prepareCorePaymentFinance(driver, close => releases.push(close)); }, 240_000);
  afterAll(() => finishOrderFixture(releases.reverse()), 120_000);
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
    expectCheckoutSettlement(before, after, key);
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
  let local: Awaited<ReturnType<typeof prepareCorePaymentFinance>>;
  beforeAll(async () => {
    local = await prepareCorePaymentFinance(driver, close => releases.push(close));
    const payment = object(await Effect.runPromise(local.authorize.run(local.authorize.newRequestKey(), { id: "payses_finance" })));
    await Effect.runPromise(local.capture.run(local.capture.newRequestKey(), { payment_id: string(payment.id) }));
  }, 240_000);
  afterAll(() => finishOrderFixture(releases.reverse()), 120_000);
  it("rolls back the actual captured-Payment callback child, replacement and Order accounting after a late failure", async () => {
    const forward = await prepareRetainedCheckoutPayment(local, "forward", close => releases.push(close));
    const retained = object(await Effect.runPromise(forward.run(forward.newRequestKey(), "payses_finance")));
    expect(retained).toEqual({ output: "payses_finance", retained: "payses_finance" });
    const inverse = await prepareRetainedCheckoutPayment(local, "late", close => releases.push(close));
    const before = await local.fixture.inventory(), key = inverse.newRequestKey();
    const exit = await Effect.runPromiseExit(inverse.run(key, string(retained.retained)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late failure after native checkout Payment inverse");
    await expectCheckoutRollback(local.fixture, before, key);
    expect(local.errors).toEqual([]);
  }, 240_000);
  it("executes the retained inverse through its declared child and replays one outer outcome", async () => {
    const inverse = await prepareRetainedCheckoutPayment(local, "inverse", close => releases.push(close));
    const before = await local.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, "payses_finance"))).toBeNull();
    const after = await local.snapshot(), rows = await local.read();
    expectCheckoutSettlement(before, after, key);
    expect(rows.find(row => row.id === "payses_finance")).toMatchObject({ authorized_at: expect.any(String) });
    expect(rows.filter(row => row.payment_collection_id === paymentCollectionId && row.status === "pending")).toHaveLength(1);
    expect(rows.find(row => row.id === "ordsum-finance")?.totals).toMatchObject({ refunded_total: 15, transaction_total: 0 });
    expect(await Effect.runPromise(inverse.run(key, "payses_finance"))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
    expect(local.errors).toEqual([]);
  }, 240_000);
});

import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareCorePaymentFinance } from "./support/core-payment-finance-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { prepareRetainedCheckoutPayment } from "./support/checkout-payment-compensation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), id = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];

describe("native checkout exact captured-Payment inverse", () => {
  let local: Awaited<ReturnType<typeof prepareCorePaymentFinance>>;
  beforeAll(async () => {
    local = await prepareCorePaymentFinance(driver, close => cleanup.push(close), [], "unlinked", undefined, "9007199254740993.0000");
  }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);
  it("refunds the complete stored raw amount beyond Number precision and retains the referenced Session", async () => {
    const payment = object(await Effect.runPromise(local.authorize.run(local.authorize.newRequestKey(), { id: "payses_finance" })));
    await Effect.runPromise(local.capture.run(local.capture.newRequestKey(), { payment_id: id(payment.id) }));
    const inverse = await prepareRetainedCheckoutPayment(local, "inverse", close => cleanup.push(close));
    const key = inverse.newRequestKey(), before = await local.snapshot(), exit = await Effect.runPromiseExit(inverse.run(key, "payses_finance"));
    if (Exit.isFailure(exit)) {
      expect(await local.snapshot()).toEqual(before);
      throw new Error(Cause.pretty(exit.cause));
    }
    expect(exit.value).toBeNull();
    const rows = await local.read(), refund = rows.find(row => typeof row.id === "string" && row.id.startsWith("ref_"));
    expect(refund).toMatchObject({ amount: "9007199254740993.0000", raw_amount: { value: "9007199254740993.0000", precision: 20 } });
    expect(rows.find(row => row.id === "payses_finance")).toMatchObject({ authorized_at: expect.any(String) });
    expect(rows.filter(row => row.status === "pending")).toMatchObject([{ amount: "9007199254740993.0000",
      raw_amount: { value: "9007199254740993.0000", precision: 20 } }]);
    const after = await local.snapshot();
    expectCheckoutSettlement(before, after, key);
    expect(await Effect.runPromise(inverse.run(key, "payses_finance"))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
    expect(local.errors).toEqual([]);
  }, 240_000);
});

import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentModuleService } from "@medusajs/payment/services";
import { OrderModuleService } from "@medusajs/order/services";
import { MathBN } from "@medusajs/framework/utils/portable";
import { prepareLogicalCheckout } from "./support/logical-checkout-fixture";
import { expectCheckoutContention } from "./support/checkout-contention";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../persistence-postgres/src/execution/diagnostics/operation";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";

it("checks the entire contention Cause and distinguishes repeated SQL observation from independent failure", () => {
  const sql = { code: "55P03" };
  const callback = Cause.fail({ reason: "invalidAuthority", cause: { _tag: "ScopeAuthorizationRevocationEpochPersistenceError",
    operation: "lockForOrdinaryWrite", cause: { cause: sql } } });
  const resource = (error: unknown, phase = "callback") => Cause.fail({ reason: "resourceFailure", cause: {
    _tag: "RelationalSessionError", reason: "resourceFailure", cause: { _tag: "PhysicalSessionResourceIssue", phase, cause: error },
  } });
  const repeated = Cause.combine(callback, resource(sql));
  expectCheckoutContention(callback);
  expectCheckoutContention(repeated);
  for (const extra of [Cause.die("cleanup defect"), Cause.interrupt(1), Cause.fail("another failure")]) {
    expect(() => expectCheckoutContention(Cause.combine(callback, extra))).toThrow();
    expect(() => expectCheckoutContention(Cause.combine(repeated, extra))).toThrow();
  }
  expect(() => expectCheckoutContention(Cause.combine(callback, resource({ code: "55P03" })))).toThrow();
  expect(() => expectCheckoutContention(Cause.combine(callback, resource(sql, "rollback")))).toThrow();
});

describe("native complete Cart checkout on " + driver, () => {
  const cleanup: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareLogicalCheckout>>;
  let lastPhase = "fixture not started";
  beforeAll(async () => { local = await prepareLogicalCheckout(driver, release => cleanup.push(release), {
    onPhase: phase => { lastPhase = phase; }, additionalCases: [
    { name: "exact", amount: "9007199254740993.0000" },
    { name: "fractional", amount: "1.25", unitPrice: "1", quantity: 1.25, compareAt: "9007199254740993.0000" },
    { name: "canceled", badSession: true }, { name: "late" }, { name: "concurrent" },
    { name: "populated-customer", customerId: "customer-unadmitted" },
    { name: "captured", amount: "9007199254740993.0000" },
    { name: "partially-refunded" }, { name: "fully-refunded" },
    { name: "exact-refunded", amount: "9007199254740993.0000" }, { name: "late-refunded" },
  ] }); }, 600_000);
  afterAll(async () => {
    if (lastPhase !== "checkout host prepared") console.info("Last completed checkout fixture phase:", lastPhase);
    for (const release of cleanup.reverse()) await release();
  }, 120_000);
  const selectedCase = (name: string) => {
    const selected = local.cases.get(name);
    if (selected === undefined) throw new Error("Missing checkout fixture case " + name);
    return selected;
  };
  it("places one native Order, authorizes Payment, links and completes Cart, then replays and retries", async () => {
    const before = await local.snapshot();
    const key = local.host.newRequestKey();
    const pending = new Map<number, string>(), recent: string[] = [], counts = new Map<string, number>();
    let ordinal = 0;
    const diagnostics: ExecutionDiagnosticPolicy = { observe: (name, work) => Effect.suspend(() => {
      const id = ordinal++, started = Date.now(); pending.set(id, name); counts.set(name, (counts.get(name) ?? 0) + 1);
      return work.pipe(Effect.onExit(exit => Effect.sync(() => {
        pending.delete(id); recent.push(name + ":" + (Date.now() - started) + ":" + (Exit.isSuccess(exit) ? "success" : "failure")); if (recent.length > 96) recent.shift();
      })));
    }) };
    const diagnostic = process.env.FLAREX_CHECKOUT_DIAGNOSTICS === "1";
    const run = local.host.run(key, { id: local.cartId });
    const result = await Effect.runPromise(diagnostic ? Effect.provideService(run, ExecutionDiagnostics, diagnostics) : run)
      .finally(() => { if (diagnostic) console.info("Checkout callback diagnostic", JSON.stringify({ calls: ordinal, counts: Object.fromEntries(counts), pending: [...pending.values()], recent })); });
    expect(result.id).toMatch(/^order_/);
    const rows = await local.rows();
    expect(rows.find(row => row.id === local.cartId)?.completed_at).toEqual(expect.any(String));
    expect(rows.filter(row => row.cart_id === local.cartId && row.order_id === result.id)).toHaveLength(1);
    expect(rows.filter(row => row.order_id === result.id && row.payment_collection_id === local.collectionId)).toHaveLength(1);
    expect(MathBN.eq(Schema.decodeUnknownSync(Schema.String)(rows.find(row => row.payment_session_id === local.sessionId)?.amount), "12.5")).toBe(true);
    const after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    const placed = after.events.filter(event => event.envelope.contract === "order.placed");
    expect(placed).toHaveLength(1);
    expect(placed[0]?.envelope.message).toMatchObject({ options: { priority: 10 } });
    expect(await Effect.runPromise(local.host.run(key, { id: local.cartId }))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: local.cartId }))).toEqual(result);
    expect((await local.rows()).filter(row => row.cart_id === local.cartId && typeof row.order_id === "string")).toHaveLength(1);
  }, 120_000);

  it("retains exact native line, Order Summary, Session and Payment amounts beyond safe integers", async () => {
    const ids = selectedCase("exact");
    const result = await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
    const rows = await local.rows();
    expect(rows.find(row => row.payment_session_id === ids.sessionId)?.amount).toBe("9007199254740993.0000");
    expect(rows.find(row => row.id === ids.sessionId)?.amount).toBe("9007199254740993.0000");
    const wrapper = rows.find(row => row.order_id === result.id && typeof row.item_id === "string");
    const line = rows.find(row => row.id === wrapper?.item_id);
    expect(line?.unit_price).toBe("9007199254740993.0000");
    const summary = Schema.decodeUnknownSync(Schema.Struct({ totals: Schema.Struct({
      raw_current_order_total: Schema.Struct({ value: Schema.String }),
    }) }))(rows.find(row => row.order_id === result.id && Object.hasOwn(row, "totals")));
    expect(summary.totals.raw_current_order_total.value).toBe("9007199254740993");
  }, 120_000);

  it("preserves fractional quantity and the exact comparison price through native Order creation", async () => {
    const ids = selectedCase("fractional");
    const result = await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
    const rows = await local.rows();
    const wrapper = rows.find(row => row.order_id === result.id && typeof row.item_id === "string");
    const line = rows.find(row => row.id === wrapper?.item_id);
    expect(MathBN.eq(Schema.decodeUnknownSync(Schema.String)(line?.unit_price), "1")).toBe(true);
    expect(line?.compare_at_unit_price).toBe("9007199254740993.0000");
    expect(MathBN.eq(Schema.decodeUnknownSync(Schema.String)(wrapper?.quantity), "1.25")).toBe(true);
    expect(MathBN.eq(Schema.decodeUnknownSync(Schema.String)(rows.find(row => row.payment_session_id === ids.sessionId)?.amount), "1.25")).toBe(true);
  }, 120_000);

  it("rejects an unprocessable Session and populated Customer capability without publishing anything", async () => {
    for (const name of ["canceled", "populated-customer"]) {
      const before = await local.snapshot(), ids = selectedCase(name);
      const exit = await Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        if (name === "canceled") expect(Cause.pretty(exit.cause)).toContain("Payment sessions are required");
        else expect(Cause.findErrorOption(exit.cause)).toMatchObject({ _tag: "Some", value: { reason: "unsupportedProfile" } });
      }
      expect(await local.snapshot()).toEqual(before);
    }
  }, 120_000);

  it("rolls back actual authorization, native Order/Links, Cart completion and pending events after a late native failure", async () => {
    const ids = selectedCase("late"), before = await local.snapshot();
    const native = PaymentModuleService.prototype.authorizePaymentSession;
    let completedNativeAuthorization = false;
    const spy = vi.spyOn(PaymentModuleService.prototype, "authorizePaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const result = await native.apply(this, args);
      if (args[0] === ids.sessionId) {
        completedNativeAuthorization = true;
        throw new Error("Late native checkout failure after authorization");
      }
      return result;
    });
    try {
      const exit = await Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
      expect(completedNativeAuthorization).toBe(true);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late native checkout failure after authorization");
    } finally { spy.mockRestore(); }
    expect(await local.snapshot()).toEqual(before);
    expect(local.runtime.errors).toEqual([expect.stringContaining("Late native checkout failure after authorization")]);
    const result = await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
    expect(result.id).toMatch(/^order_/);
  }, 120_000);

  it("serializes competing completion requests into one native Order and one placed event", async () => {
    const ids = selectedCase("concurrent"), before = await local.snapshot();
    const keys = [local.host.newRequestKey(), local.host.newRequestKey()];
    const outcomes = await Promise.all(keys.map(key => Effect.runPromiseExit(local.host.run(key, { id: ids.cartId }))));
    const successful = outcomes.filter(Exit.isSuccess);
    expect(successful.length).toBeGreaterThanOrEqual(1);
    const placed = successful[0]?.value;
    if (placed === undefined) throw new Error("Neither competing checkout placed an Order");
    for (const outcome of outcomes) {
      if (Exit.isSuccess(outcome)) expect(outcome.value).toEqual(placed);
      else {
        // The ordinary fixture has a short SQL lock timeout. Its exact bounded
        // contention refusal must be retryable after the winner has settled;
        // unrelated authority errors or business failures are not accepted.
        expect(driver).toBe("postgres");
        expectCheckoutContention(outcome.cause);
      }
    }
    for (const key of keys) expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(placed);
    expect((await local.rows()).filter(row => row.cart_id === ids.cartId && typeof row.order_id === "string")).toHaveLength(1);
    const after = await local.snapshot();
    expect(after.events.filter(event => event.envelope.contract === "order.placed").length - before.events.filter(event => event.envelope.contract === "order.placed").length).toBe(1);
  }, 120_000);

  it("accounts a genuine pre-captured Payment by Capture identity and exact amount during checkout", async () => {
    const ids = selectedCase("captured"), capture = await local.prepareCapturedPayment();
    await Effect.runPromise(capture.run(capture.newRequestKey(), { id: ids.sessionId }));
    const before = await local.snapshot(), key = local.host.newRequestKey();
    const result = await Effect.runPromise(local.host.run(key, { id: ids.cartId }));
    const rows = await local.rows(), transactions = rows.filter(row => row.order_id === result.id && row.reference === "capture");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ amount: "9007199254740993.0000", currency_code: "usd" });
    expect(rows.find(row => row.id === transactions[0]?.reference_id)).toMatchObject({ amount: "9007199254740993.0000" });
    const after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
  }, 120_000);

  for (const [name, amount, total] of [["partially-refunded", "4", "12.5"], ["fully-refunded", "12.5", "12.5"],
    ["exact-refunded", "9007199254740993.0000", "9007199254740993.0000"]] as const)
    it("accounts existing " + name + " Payment history by Capture and Refund identity", async () => {
      const ids = selectedCase(name), capture = await local.prepareCapturedPayment(), refund = await local.prepareRefundedPayment();
      const payment = await Effect.runPromise(capture.run(capture.newRequestKey(), { id: ids.sessionId }));
      const paymentId = Schema.decodeUnknownSync(Schema.String)(payment.id);
      await Effect.runPromise(refund.run(refund.newRequestKey(), { payment_id: paymentId, amount }));
      const key = local.host.newRequestKey(), result = await Effect.runPromise(local.host.run(key, { id: ids.cartId }));
      const rows = await local.rows(), transactions = rows.filter(row => row.order_id === result.id && typeof row.reference === "string");
      const refunded = rows.find(row => row.payment_id === paymentId && Object.hasOwn(row, "refund_reason_id"));
      expect(transactions.filter(row => row.reference === "capture")).toHaveLength(1);
      expect(refunded?.id).toEqual(expect.any(String));
      const refundTransactions = transactions.filter(row => row.reference === "refund");
      expect(refundTransactions).toHaveLength(1);
      expect(refundTransactions[0]?.reference_id).toBe(refunded?.id);
      expect(refundTransactions[0]?.currency_code).toBe("usd");
      expect(MathBN.eq(Schema.decodeUnknownSync(Schema.String)(refundTransactions[0]?.amount), "-" + amount)).toBe(true);
      const summary = rows.find(row => row.order_id === result.id && Object.hasOwn(row, "totals"));
      expect(summary?.totals).toMatchObject({ paid_total: Number(total), refunded_total: Number(amount), transaction_total: Number(total) - Number(amount) });
      const raw = Schema.decodeUnknownSync(Schema.Struct({ raw_refunded_total: Schema.Struct({ value: Schema.String }) }))(summary?.totals);
      expect(MathBN.eq(raw.raw_refunded_total.value, amount)).toBe(true);
      const after = await local.snapshot();
      expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(result);
      expect(await local.snapshot()).toEqual(after);
    }, 120_000);

  it("rolls back native Capture and Refund accounting after a late Order transaction failure", async () => {
    const ids = selectedCase("late-refunded"), capture = await local.prepareCapturedPayment(), refund = await local.prepareRefundedPayment();
    const payment = await Effect.runPromise(capture.run(capture.newRequestKey(), { id: ids.sessionId }));
    await Effect.runPromise(refund.run(refund.newRequestKey(), { payment_id: Schema.decodeUnknownSync(Schema.String)(payment.id), amount: "4" }));
    const before = await local.snapshot(), native = OrderModuleService.prototype.addOrderTransactions;
    let reached = false;
    const spy = vi.spyOn(OrderModuleService.prototype, "addOrderTransactions").mockImplementation(async function (this: OrderModuleService, ...args) {
      await native.apply(this, args);
      reached = true;
      throw new Error("Late failure after native Capture and Refund accounting");
    });
    try {
      const outcome = await Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
      expect(reached).toBe(true);
      expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(Cause.pretty(outcome.cause)).toContain("Late failure after native Capture and Refund accounting");
    } finally { spy.mockRestore(); }
    expect(await local.snapshot()).toEqual(before);
    expect((await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }))).id).toMatch(/^order_/);
  }, 120_000);
});

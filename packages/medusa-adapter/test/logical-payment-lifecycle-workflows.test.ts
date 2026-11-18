import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { prepareCorePaymentLifecycle } from "./support/core-payment-lifecycle-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectCheckoutRollback as expectNativeRollback, expectCheckoutSettlement as expectNativeSettlement } from "./support/core-checkout-evidence";
import { paymentCollectionId } from "./support/payment-fixture-data";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareCorePaymentLifecycle>>;
const scenario = (rows: Parameters<typeof prepareCorePaymentLifecycle>[2] = []) => {
  const releases: Array<() => Promise<void>> = [];
  onTestFinished(() => finishOrderFixture(releases.reverse()));
  return prepareCorePaymentLifecycle(driver, release => releases.push(release), rows, base.fixture.physical);
};
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? failures(reason.error)
    : Cause.isDieReason(reason) ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof Error) return [value.name, value.message, ...failures(value.cause)];
  return [];
}
beforeAll(async () => { base = await prepareCorePaymentLifecycle(driver, close => cleanup.push(close)); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);
describe("native System Payment authorization, capture and refund", () => {
  it("executes the genuine native steps with collection accounting and stable replay", async () => {
    const connected = base, before = await connected.snapshot();
    const authorize = await connected.prepareAuthorize(), key = authorize.newRequestKey();
    const payment = Schema.decodeUnknownSync(Schema.JsonObject)(await Effect.runPromise(authorize.run(key, { id: "payses_lifecycle" })));
    expect(payment).toMatchObject({ id: expect.stringMatching(/^pay_/), amount: 12.5, captures: [] });
    expect((await connected.read()).find(row => row.id === paymentCollectionId)).toMatchObject({ status: "authorized",
      authorized_amount: "12.500000000000000000", captured_amount: "0.0000000000000000000", refunded_amount: "0.0000000000000000000", completed_at: null });
    const committed = await connected.snapshot();
    expectNativeSettlement(before, committed, key);
    expect(await Effect.runPromise(authorize.run(key, { id: "payses_lifecycle" }))).toEqual(payment);
    expect(await connected.snapshot()).toEqual(committed);
    const id = Schema.decodeUnknownSync(Schema.String)(payment.id), capture = await connected.prepareCapture();
    const captured = Schema.decodeUnknownSync(Schema.JsonObject)(await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: id, amount: "12.5" })));
    expect(captured).toMatchObject({ id, captured_at: expect.any(String), captures: [{ amount: 12.5 }] });
    expect((await connected.read()).find(row => row.id === paymentCollectionId)).toMatchObject({ status: "completed",
      authorized_amount: "12.500000000000000000", captured_amount: "12.500000000000000000", refunded_amount: "0.0000000000000000000", completed_at: expect.any(String) });
    const refund = await connected.prepareRefund();
    const refunded = await Effect.runPromise(refund.run(refund.newRequestKey(), { payment_id: id, amount: "3.125", note: "Partial native refund" }));
    expect(refunded).toMatchObject({ id, refunds: [{ amount: 3.125, note: "Partial native refund" }] });
    expect((await connected.read()).find(row => row.id === paymentCollectionId)).toMatchObject({ status: "completed",
      authorized_amount: "12.500000000000000000", captured_amount: "12.500000000000000000", refunded_amount: "3.1250000000000000000",
      raw_refunded_amount: { value: "3.1250000000000000000", precision: 20 } });
    expect(connected.errors).toEqual([]);
  }, 240_000);

  it("preserves partial capture, native over-capture refusal and captured-payment idempotency", async () => {
    const local = await scenario(), authorize = await local.prepareAuthorize(), capture = await local.prepareCapture();
    const payment = object(await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: "payses_lifecycle" }))), id = text(payment.id);
    const partial = await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: id, amount: "3.125", captured_by: "actor" }));
    expect(partial).toMatchObject({ captured_at: null, captures: [{ amount: 3.125, created_by: null }] });
    const before = await local.fixture.inventory(), rejectedKey = capture.newRequestKey();
    const rejected = await Effect.runPromiseExit(capture.run(rejectedKey, { payment_id: id, amount: "10" }));
    expect(Exit.isFailure(rejected)).toBe(true);
    if (Exit.isFailure(rejected)) expect(failures(rejected.cause).join(" ")).toContain("You cannot capture more than the authorized amount");
    await expectNativeRollback(local.fixture, before, rejectedKey);
    const completed = await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: id, amount: "9.375" }));
    expect(completed).toMatchObject({ captured_at: expect.any(String), captures: expect.arrayContaining([
      expect.objectContaining({ amount: 3.125 }), expect.objectContaining({ amount: 9.375 }),
    ]) });
    // A captured Payment is a native early return; another call adds no Capture.
    expect(await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: id }))).toEqual(completed);
  }, 240_000);

  it("executes retained authorization cancellation and refuses later capture", async () => {
    const local = await scenario(), forward = await local.prepareRetainedAuthorization();
    const result = object(await Effect.runPromise(forward.run(forward.newRequestKey(), { id: "payses_lifecycle" })));
    const retained = object(result.retained), inverse = await local.prepareRetainedAuthorization(true);
    const beforeInverse = await local.snapshot(), inverseKey = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(inverseKey, retained))).toBeNull();
    const afterInverse = await local.snapshot();
    expectNativeSettlement(beforeInverse, afterInverse, inverseKey);
    expect(await Effect.runPromise(inverse.run(inverseKey, retained))).toBeNull();
    expect(await local.snapshot()).toEqual(afterInverse);
    const capture = await local.prepareCapture(), before = await local.fixture.inventory(), rejectedKey = capture.newRequestKey();
    const rejected = await Effect.runPromiseExit(capture.run(rejectedKey, { payment_id: text(retained.id) }));
    expect(Exit.isFailure(rejected)).toBe(true);
    if (Exit.isFailure(rejected)) expect(failures(rejected.cause).join(" ")).toContain("has been canceled");
    await expectNativeRollback(local.fixture, before, rejectedKey);
  }, 240_000);

  it("rolls back all authorization rows and events after a late parent defect", async () => {
    const local = await scenario(), host = await local.prepareLateAuthorization(), before = await local.fixture.inventory();
    const key = host.newRequestKey(), rejected = await Effect.runPromiseExit(host.run(key, { id: "payses_lifecycle" }));
    expect(Exit.isFailure(rejected)).toBe(true);
    if (Exit.isFailure(rejected)) expect(failures(rejected.cause)).toContain(local.lateFailure.message);
    await expectNativeRollback(local.fixture, before, key);
  }, 240_000);

  it.each(["capturePayment", "refundPayment"] as const)("preserves provider %s failure and native row cleanup", async method => {
    const local = await scenario(), authorize = await local.prepareAuthorize();
    const payment = object(await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: "payses_lifecycle" }))), id = text(payment.id);
    const capture = await local.prepareCapture();
    if (method === "refundPayment") await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: id }));
    const host = method === "capturePayment" ? capture : await local.prepareRefund(), before = await local.fixture.inventory();
    const deleted: unknown[] = [], bind = local.payment.prepared.bind;
    const binding = vi.spyOn(local.payment.prepared, "bind").mockImplementation((...args) => {
      const bound = bind(...args), captureDelete = bound.captureRepository.delete.bind(bound.captureRepository),
        refundDelete = bound.refundRepository.delete.bind(bound.refundRepository);
      return { ...bound, captureRepository: { ...bound.captureRepository, delete: (...values) => {
        deleted.push(structuredClone(values[0])); return captureDelete(...values);
      } }, refundRepository: { ...bound.refundRepository, delete: (...values) => {
        deleted.push(structuredClone(values[0])); return refundDelete(...values);
      } } };
    });
    const failure = new Error("Injected native System " + method + " provider defect"), spy = vi.spyOn(SystemPaymentProvider.prototype, method).mockRejectedValue(failure);
    try {
      const key = host.newRequestKey(), rejected = await Effect.runPromiseExit(host.run(key, { payment_id: id, amount: "3.125" }));
      expect(Exit.isFailure(rejected)).toBe(true);
      if (Exit.isFailure(rejected)) expect(failures(rejected.cause).join("\n"), Cause.pretty(rejected.cause)).toContain(failure.message);
      expect(deleted).toEqual([{ $or: [{ id: expect.stringMatching(method === "capturePayment" ? /^capt_/ : /^ref_/) }] }]);
      await expectNativeRollback(local.fixture, before, key);
    } finally { spy.mockRestore(); binding.mockRestore(); }
  }, 240_000);

  it("preserves an authorization provider defect before any row or event commits", async () => {
    const local = await scenario(), host = await local.prepareAuthorize(), before = await local.fixture.inventory();
    const failure = new Error("Injected System authorization defect"), spy = vi.spyOn(SystemPaymentProvider.prototype, "authorizePayment").mockRejectedValue(failure);
    try {
      const key = host.newRequestKey(), rejected = await Effect.runPromiseExit(host.run(key, { id: "payses_lifecycle" }));
      expect(Exit.isFailure(rejected)).toBe(true);
      if (Exit.isFailure(rejected)) expect(failures(rejected.cause)).toContain(failure.message);
      await expectNativeRollback(local.fixture, before, key);
    } finally { spy.mockRestore(); }
  }, 240_000);

  it("rejects a forged native capture result and rolls back its genuine writes", async () => {
    const local = await scenario(), authorize = await local.prepareAuthorize(), capture = await local.prepareCapture();
    const payment = object(await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: "payses_lifecycle" }))), before = await local.fixture.inventory();
    const original = PaymentModuleService.prototype.capturePayment;
    const spy = vi.spyOn(PaymentModuleService.prototype, "capturePayment").mockImplementation(async function (this: PaymentModuleService, ...args) {
      return { ...await original.apply(this, args), currency_code: "forged-currency" };
    });
    try {
      const key = capture.newRequestKey(), rejected = await Effect.runPromiseExit(capture.run(key, { payment_id: text(payment.id) }));
      expect(Exit.isFailure(rejected)).toBe(true);
      if (Exit.isFailure(rejected)) expect(rejected.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error.reason === "receiptMismatch"), Cause.pretty(rejected.cause)).toBe(true);
      await expectNativeRollback(local.fixture, before, key);
    } finally { spy.mockRestore(); }
  }, 240_000);

  it("refuses a fifth existing Capture before the capture provider runs", async () => {
    const id = "pay_overflow", stored = Array.from({ length: 5 }, (_, index) => ({ id: "cap_overflow_" + index,
      payment_id: id, amount: "1", raw_amount: { value: "1", precision: 20 } }));
    const local = await scenario([
      { table: "payment", row: { id, payment_session_id: "payses_lifecycle", payment_collection_id: paymentCollectionId,
        provider_id: "pp_system_default", amount: "12.5", raw_amount: { value: "12.5", precision: 20 }, currency_code: "usd", data: {} } },
      ...stored.map(row => ({ table: "capture", row })),
    ]);
    const host = await local.prepareCapture(), before = await local.fixture.inventory();
    expect(before.rows.filter(row => row.value.payment_id === id).map(row => text(row.value.id)).sort())
      .toEqual(stored.map(row => row.id));
    const provider = vi.spyOn(SystemPaymentProvider.prototype, "capturePayment");
    try {
      const key = host.newRequestKey(), rejected = await Effect.runPromiseExit(host.run(key, { payment_id: id, amount: "1" }));
      expect(Exit.isFailure(rejected)).toBe(true); expect(provider).not.toHaveBeenCalled();
      if (Exit.isFailure(rejected)) expect(rejected.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error.reason === "limitExceeded"), Cause.pretty(rejected.cause)).toBe(true);
      await expectNativeRollback(local.fixture, before, key);
    } finally { provider.mockRestore(); }
  }, 240_000);
});

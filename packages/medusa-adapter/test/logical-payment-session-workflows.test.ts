import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { prepareCorePaymentSessions } from "./support/core-payment-session-fixture";
import { paymentCollectionId, paymentSessionSeed } from "./support/payment-fixture-data";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareCorePaymentSessions>>;
const scenario = (rows: Parameters<typeof prepareCorePaymentSessions>[2] = []) => {
  const releases: Array<() => Promise<void>> = [];
  onTestFinished(() => finishOrderFixture(releases.reverse()));
  return prepareCorePaymentSessions(driver, release => releases.push(release), rows, base.fixture.physical);
};
const object = Schema.decodeUnknownSync(Schema.JsonObject);
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? failures(reason.error)
    : Cause.isDieReason(reason) ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof Error) return [value.name, value.message, ...failures(value.cause)];
  return [];
}
beforeAll(async () => { base = await prepareCorePaymentSessions(driver, close => cleanup.push(close)); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);
describe("genuine System Payment sessions", { concurrent: false }, () => {
  it("creates a collection through the genuine native service and uses it in the native session root", async () => {
    const connected = await scenario(), create = await connected.prepareCreateCollection();
    const before = await connected.snapshot(), collectionKey = create.newRequestKey();
    const collection = object(await Effect.runPromise(create.run(collectionKey, { currency_code: "usd", amount: "8.125", metadata: { support: true } })));
    expect(collection).toMatchObject({ id: expect.stringMatching(/^pay_col_/), amount: 8.125, status: "not_paid", payment_sessions: [], payments: [], payment_providers: [] });
    const afterCollection = await connected.snapshot();
    expectCheckoutSettlement(before, afterCollection, collectionKey);
    const host = await connected.prepareCreate(), sessionKey = host.newRequestKey();
    const session = object(await Effect.runPromise(host.run(sessionKey, { payment_collection_id: Schema.decodeUnknownSync(Schema.String)(collection.id),
      provider_id: "pp_system_default" })));
    expect(session).toMatchObject({ amount: 8.125, payment_collection_id: collection.id });
    expectCheckoutSettlement(afterCollection, await connected.snapshot(), sessionKey);
  }, 240_000);
  it("runs the native creation root and replaces the collection's previous sessions", async () => {
    const connected = await scenario([paymentSessionSeed("payses_replace", { previous: true })]);
    const host = await connected.prepareCreate();
    const output = Schema.decodeUnknownSync(Schema.JsonObject)(await Effect.runPromise(host.run(host.newRequestKey(), {
      payment_collection_id: paymentCollectionId, provider_id: "pp_system_default", data: { replacement: true },
    })));
    expect(output).toMatchObject({ id: expect.stringMatching(/^payses_/), data: { replacement: true }, amount: 12.5 });
    expect(output.id).not.toBe("payses_replace");
    expect((await connected.read()).map(row => row.id).sort()).toEqual([paymentCollectionId, output.id].sort());
    expect(connected.errors).toEqual([]);
  }, 240_000);
  it("creates a native session and deletes it through the genuine native deletion child", async () => {
    const connected = await scenario();
    const create = await connected.prepareCreateStep();
    const session = Schema.decodeUnknownSync(Schema.JsonObject)(await Effect.runPromise(create.run(create.newRequestKey(), {
      payment_collection_id: paymentCollectionId, provider_id: "pp_system_default", currency_code: "usd", amount: "12.5", data: { marker: "native" },
    })));
    expect(session).toMatchObject({ id: expect.stringMatching(/^payses_/), amount: 12.5, provider_id: "pp_system_default", data: { marker: "native" }, status: "pending" });
    const remove = await connected.prepareDelete(), id = Schema.decodeUnknownSync(Schema.String)(session.id);
    expect(await Effect.runPromise(remove.run(remove.newRequestKey(), { ids: [id] }))).toEqual([id]);
    expect((await connected.read()).map(row => row.id)).toEqual([paymentCollectionId]);
    expect(connected.errors).toEqual([]);
  }, 240_000);

  it("deletes and replays a selected cohort independently for identical IDs and keys in two scopes", async () => {
    const seed = paymentSessionSeed("payses_old");
    const connected = await scenario([seed]), peer = await scenario([seed]);
    const host = await connected.prepareDelete(), peerHost = await peer.prepareDelete(), key = host.newRequestKey();
    const input = { ids: ["payses_old"] }, before = await connected.snapshot(), peerBefore = await peer.snapshot();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(input.ids);
    const after = await connected.snapshot();
    expectCheckoutSettlement(before, after, key);
    expect(await peer.snapshot()).toEqual(peerBefore);
    expect(await Effect.runPromise(peerHost.run(key, input))).toEqual(input.ids);
    const peerAfter = await peer.snapshot();
    expectCheckoutSettlement(peerBefore, peerAfter, key);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(input.ids);
    expect(await connected.snapshot()).toEqual(after);
    expect(await peer.snapshot()).toEqual(peerAfter);
    expect((await connected.read()).map(row => row.id)).toEqual([paymentCollectionId]);
    expect((await peer.read()).map(row => row.id)).toEqual([paymentCollectionId]);
  }, 240_000);

  it("replaces four old sessions, preserves native defaults and replays without invoking providers twice", async () => {
    const connected = await scenario(Array.from({ length: 4 }, (_, index) => paymentSessionSeed(`payses_max_${index}`)));
    const host = await connected.prepareCreate(), key = host.newRequestKey(), before = await connected.snapshot();
    const input = { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" as const };
    const initiated = vi.spyOn(SystemPaymentProvider.prototype, "initiatePayment"), deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    try {
      const output = object(await Effect.runPromise(host.run(key, input)));
      expect(output).toMatchObject({ data: {}, metadata: {}, context: {} });
      expect((await connected.read()).map(row => row.id).sort()).toEqual([paymentCollectionId, output.id].sort());
      expect(initiated).toHaveBeenCalledTimes(1); expect(deleted).toHaveBeenCalledTimes(4);
      const after = await connected.snapshot();
      expectCheckoutSettlement(before, after, key);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(initiated).toHaveBeenCalledTimes(1); expect(deleted).toHaveBeenCalledTimes(4);
      expect(await connected.snapshot()).toEqual(after);
    } finally { initiated.mockRestore(); deleted.mockRestore(); }
  }, 240_000);

  it("executes the genuine retained deletion inverse and recreates sessions with new identities", async () => {
    const connected = await scenario([paymentSessionSeed("payses_inverse", { retained: true })]);
    const forward = await connected.prepareRetainedDeletion();
    const response = object(await Effect.runPromise(forward.run(forward.newRequestKey(), ["payses_inverse"])));
    expect(response.output).toEqual(["payses_inverse"]);
    expect(response.retained).toEqual([expect.objectContaining({ id: "payses_inverse", data: { retained: true }, payment_collection: { id: paymentCollectionId } })]);
    expect((await connected.read()).map(row => row.id)).toEqual([paymentCollectionId]);
    const inverse = await connected.prepareRetainedDeletion(true);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), Schema.decodeUnknownSync(Schema.Json)(response.retained)))).toBeNull();
    const recreated = (await connected.read()).filter(row => row.id !== paymentCollectionId);
    expect(recreated).toHaveLength(1);
    expect(recreated[0]).toMatchObject({ id: expect.stringMatching(/^payses_/), data: { retained: true }, context: null, metadata: null });
    expect(recreated[0]?.id).not.toBe("payses_inverse");
  }, 240_000);

  it("refuses a fifth old session before providers run and preserves the entire collection", async () => {
    const connected = await scenario(Array.from({ length: 5 }, (_, index) => paymentSessionSeed(`payses_overflow_${index}`)));
    const host = await connected.prepareCreate(), before = await connected.fixture.inventory(), key = host.newRequestKey();
    const initiated = vi.spyOn(SystemPaymentProvider.prototype, "initiatePayment"), deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    try {
      const exit = await Effect.runPromiseExit(host.run(key, { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(initiated).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled();
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { initiated.mockRestore(); deleted.mockRestore(); }
  }, 240_000);

  it("runs genuine empty deletion without invoking providers or publishing events", async () => {
    const connected = await scenario(), host = await connected.prepareDelete(), before = await connected.fixture.inventory(), key = host.newRequestKey();
    const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    try {
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toEqual([]);
      expect(deleted).not.toHaveBeenCalled();
      const after = await connected.fixture.inventory();
      expect(after.outcomes.filter(record => record.value.key === key)).toMatchObject([
        { value: { key, kind: "nativeRoot", state: "committed" } },
      ]);
      expect({ ...after, outcomes: after.outcomes.filter(record => record.value.key !== key) }).toEqual(before);
      expect(connected.errors).toEqual([]);
    } finally { deleted.mockRestore(); }
  }, 240_000);

  it("uses the actual native creation compensation value to remove only the new session", async () => {
    const connected = await scenario([paymentSessionSeed("payses_keep")]), forward = await connected.prepareRetainedCreation();
    const response = object(await Effect.runPromise(forward.run(forward.newRequestKey(), { payment_collection_id: paymentCollectionId,
      provider_id: "pp_system_default", currency_code: "usd", amount: "12.5", data: {} })));
    expect(response.retained).toBe(object(response.output).id);
    const inverse = await connected.prepareRetainedCreation(true);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), Schema.decodeUnknownSync(Schema.Json)(response.retained)))).toBeNull();
    expect((await connected.read()).map(row => row.id).sort()).toEqual([paymentCollectionId, "payses_keep"].sort());
  }, 240_000);

  it("rolls back an entire native replacement after a late parent failure", async () => {
    const connected = await scenario([paymentSessionSeed("payses_rollback", { unchanged: true })]);
    const host = await connected.prepareLateFailure(), before = await connected.fixture.inventory(), key = host.newRequestKey();
    const result = await Effect.runPromiseExit(host.run(key, { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(failures(result.cause)).toContain("Late parent failure after genuine Payment root");
    await expectCheckoutRollback(connected.fixture, before, key);
  }, 240_000);

  it("keeps native missing-collection failure after a nonthrowing singleton query", async () => {
    const connected = await scenario(), host = await connected.prepareCreate(), before = await connected.fixture.inventory(), key = host.newRequestKey();
    const result = await Effect.runPromiseExit(host.run(key, { payment_collection_id: "pay_col_missing", provider_id: "pp_system_default" }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(failures(result.cause)).toContain("TypeError");
    await expectCheckoutRollback(connected.fixture, before, key);
  }, 240_000);

  it("rejects Customer and external-provider roots before mutation", async () => {
    const connected = await scenario(), host = await connected.prepareCreate();
    for (const extra of [{ customer_id: "cus_unadmitted" }, { provider_id: "pp_external" }]) {
      // Deliberately cross the runtime facade with an invalid foreign input;
      // a TypeScript-only rejection would not prove sticky runtime refusal.
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromiseExit(Reflect.apply(host.run, host, [key, { payment_collection_id: paymentCollectionId,
        provider_id: "pp_system_default", ...extra }]));
      expect(Exit.isFailure(result)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
    }
  }, 240_000);

  it("keeps exact amount companions through the genuine native service and DTO projection", async () => {
    const connected = await scenario(), host = await connected.prepareCreateStep();
    const output = object(await Effect.runPromise(host.run(host.newRequestKey(), { payment_collection_id: paymentCollectionId,
      provider_id: "pp_system_default", currency_code: "usd", amount: "9007199254740993.125", data: {} })));
    expect(output.raw_amount).toEqual({ value: "9007199254740993.1250", precision: 20 });
    expect((await connected.read()).find(row => row.id === output.id)?.amount).toBe("9007199254740993.1250");
  }, 240_000);

  it("rolls back real writes when the native result is corrupted after serialization", async () => {
    const connected = await scenario([paymentSessionSeed("payses_forgery")]), host = await connected.prepareCreate();
    const before = await connected.fixture.inventory(), key = host.newRequestKey(), original = PaymentModuleService.prototype.createPaymentSession;
    const spy = vi.spyOn(PaymentModuleService.prototype, "createPaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const result = await original.apply(this, args); return { ...result, amount: 999 };
    });
    try {
      const exit = await Effect.runPromiseExit(host.run(key, { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { spy.mockRestore(); }
  }, 240_000);

  it("preserves a provider deletion defect despite native partial-failure logging and leaves all rows committed as before", async () => {
    const connected = await scenario([paymentSessionSeed("payses_provider_failure")]), host = await connected.prepareCreate();
    const before = await connected.fixture.inventory(), key = host.newRequestKey(), failure = new Error("Injected System provider deletion defect");
    const spy = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment").mockRejectedValue(failure);
    try {
      const exit = await Effect.runPromiseExit(host.run(key, { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(failures(exit.cause)).toContain(failure.message);
      // A compound Cause crosses the native Promise ABI as an inert private
      // receipt. Native logging stringifies that receipt; the original defect
      // remains authenticated in the full Cause asserted above.
      expect(connected.errors).toEqual([expect.stringContaining("Encountered an error when trying to delete payment session - payses_provider_failure - ")]);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { spy.mockRestore(); }
  }, 240_000);
});

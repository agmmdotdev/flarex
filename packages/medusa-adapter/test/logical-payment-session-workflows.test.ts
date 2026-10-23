import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { prepareLogicalPaymentSessions, paymentCollectionId, paymentSessionSeed } from "./support/logical-payment-session-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let base: Awaited<ReturnType<typeof prepareLogicalPaymentSessions>>, ordinal = 0;
const scenario = (rows: Parameters<typeof prepareLogicalPaymentSessions>[2] = []) => prepareLogicalPaymentSessions(driver, close => cleanup.push(close), rows,
  { resource: base.fixture.resource, fixtureIdentity: { deploymentId: `payment-sessions-${++ordinal}`, projectId: "payment-session-tests", uuidOffset: 5_000_000 + ordinal * 10_000 } });
const object = Schema.decodeUnknownSync(Schema.JsonObject);
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? failures(reason.error)
    : Cause.isDieReason(reason) ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof Error) return [value.name, value.message, ...failures(value.cause)];
  return [];
}
beforeAll(async () => { base = await prepareLogicalPaymentSessions(driver, close => cleanup.push(close)); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);
describe("genuine System Payment sessions", { concurrent: false }, () => {
  it("creates a collection through the genuine native service and uses it in the native session root", async () => {
    const connected = await scenario(), create = await connected.prepareCreateCollection();
    const collection = object(await Effect.runPromise(create.run(create.newRequestKey(), { currency_code: "usd", amount: "8.125", metadata: { support: true } })));
    expect(collection).toMatchObject({ id: expect.stringMatching(/^pay_col_/), amount: 8.125, status: "not_paid", payment_sessions: [], payments: [], payment_providers: [] });
    const host = await connected.prepareCreate();
    const session = object(await Effect.runPromise(host.run(host.newRequestKey(), { payment_collection_id: Schema.decodeUnknownSync(Schema.String)(collection.id),
      provider_id: "pp_system_default" })));
    expect(session).toMatchObject({ amount: 8.125, payment_collection_id: collection.id });
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

  it("deletes a complete selected cohort and retains the collection", async () => {
    const connected = await scenario([paymentSessionSeed("payses_old")]);
    const host = await connected.prepareDelete(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { ids: ["payses_old"] }))).toEqual(["payses_old"]);
    const after = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, { ids: ["payses_old"] }))).toEqual(["payses_old"]);
    expect((await connected.snapshot()).events).toEqual(after.events);
    expect((await connected.read()).map(row => row.id)).toEqual([paymentCollectionId]);
  }, 240_000);

  it("replaces four old sessions, preserves native defaults and replays without invoking providers twice", async () => {
    const connected = await scenario(Array.from({ length: 4 }, (_, index) => paymentSessionSeed(`payses_max_${index}`)));
    const host = await connected.prepareCreate(), key = host.newRequestKey();
    const input = { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" as const };
    const initiated = vi.spyOn(SystemPaymentProvider.prototype, "initiatePayment"), deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    try {
      const output = object(await Effect.runPromise(host.run(key, input)));
      expect(output).toMatchObject({ data: {}, metadata: {}, context: {} });
      expect((await connected.read()).map(row => row.id).sort()).toEqual([paymentCollectionId, output.id].sort());
      expect(initiated).toHaveBeenCalledTimes(1); expect(deleted).toHaveBeenCalledTimes(4);
      const after = await connected.snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(initiated).toHaveBeenCalledTimes(1); expect(deleted).toHaveBeenCalledTimes(4);
      expect((await connected.snapshot()).events).toEqual(after.events);
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
    const host = await connected.prepareCreate(), before = await connected.snapshot(), rows = await connected.read();
    const initiated = vi.spyOn(SystemPaymentProvider.prototype, "initiatePayment"), deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    try {
      const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(initiated).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled();
      expect(await connected.read()).toEqual(rows);
      expect((await connected.snapshot()).events).toEqual(before.events);
    } finally { initiated.mockRestore(); deleted.mockRestore(); }
  }, 240_000);

  it("runs genuine empty deletion without invoking providers or publishing events", async () => {
    const connected = await scenario(), host = await connected.prepareDelete(), before = await connected.snapshot();
    const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toEqual([]);
      expect(deleted).not.toHaveBeenCalled();
      expect((await connected.snapshot()).events).toEqual(before.events);
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
    const host = await connected.prepareLateFailure(), rows = await connected.read(), before = await connected.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(failures(result.cause)).toContain("Late parent failure after genuine Payment root");
    expect(await connected.read()).toEqual(rows);
    expect((await connected.snapshot()).events).toEqual(before.events);
  }, 240_000);

  it("keeps native missing-collection failure after a nonthrowing singleton query", async () => {
    const connected = await scenario(), host = await connected.prepareCreate(), rows = await connected.read(), before = await connected.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { payment_collection_id: "pay_col_missing", provider_id: "pp_system_default" }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(failures(result.cause)).toContain("TypeError");
    expect(await connected.read()).toEqual(rows);
    expect((await connected.snapshot()).events).toEqual(before.events);
  }, 240_000);

  it("rejects Customer and external-provider roots before mutation", async () => {
    const connected = await scenario(), host = await connected.prepareCreate(), before = await connected.snapshot();
    for (const extra of [{ customer_id: "cus_unadmitted" }, { provider_id: "pp_external" }]) {
      // Deliberately cross the runtime facade with an invalid foreign input;
      // a TypeScript-only rejection would not prove sticky runtime refusal.
      const result = await Effect.runPromiseExit(Reflect.apply(host.run, host, [host.newRequestKey(), { payment_collection_id: paymentCollectionId,
        provider_id: "pp_system_default", ...extra }]));
      expect(Exit.isFailure(result)).toBe(true);
    }
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
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
    const before = await connected.snapshot(), rows = await connected.read(), original = PaymentModuleService.prototype.createPaymentSession;
    const spy = vi.spyOn(PaymentModuleService.prototype, "createPaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const result = await original.apply(this, args); return { ...result, amount: 999 };
    });
    try {
      const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(await connected.read()).toEqual(rows);
      expect((await connected.snapshot()).events).toEqual(before.events);
    } finally { spy.mockRestore(); }
  }, 240_000);

  it("preserves a provider deletion defect despite native partial-failure logging and leaves all rows committed as before", async () => {
    const connected = await scenario([paymentSessionSeed("payses_provider_failure")]), host = await connected.prepareCreate();
    const before = await connected.snapshot(), rows = await connected.read(), failure = new Error("Injected System provider deletion defect");
    const spy = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment").mockRejectedValue(failure);
    try {
      const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { payment_collection_id: paymentCollectionId, provider_id: "pp_system_default" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(failures(exit.cause)).toContain(failure.message);
      // A compound Cause crosses the native Promise ABI as an inert private
      // receipt. Native logging stringifies that receipt; the original defect
      // remains authenticated in the full Cause asserted above.
      expect(connected.errors).toEqual([expect.stringContaining("Encountered an error when trying to delete payment session - payses_provider_failure - ")]);
      expect(await connected.read()).toEqual(rows);
      expect((await connected.snapshot()).events).toEqual(before.events);
    } finally { spy.mockRestore(); }
  }, 240_000);
});

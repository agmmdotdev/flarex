import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { preparePaymentCaptureWorkflow } from "../src/workflows/payment/capture-payment";
import { prepareLogicalPaymentFinance } from "./support/logical-payment-finance-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);

describe("genuine native Payment financial roots", () => {
  let fixture: Awaited<ReturnType<typeof prepareLogicalPaymentFinance>>;
  beforeAll(async () => { fixture = await prepareLogicalPaymentFinance(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("captures a linked Payment and records native Order accounting in the same replayed root", async () => {
    const payment = object(await Effect.runPromise(fixture.authorize.run(fixture.authorize.newRequestKey(), { id: "payses_finance" })));
    const id = text(payment.id), request = fixture.capture.newRequestKey(), input = { payment_id: id };
    // Omitted amount deliberately uses the native Capture.raw_amount record
    // in the unchanged root's Order transaction transform.
    // The trusted outer owner can retain its ordinary cap. The native root
    // must refuse atomically there, while its named finance profile completes.
    expect(commerceLimits.calls).toBe(64);
    const ordinary = await Effect.runPromise(preparePaymentCaptureWorkflow({ ...fixture.options, execution: {
      ...fixture.options.execution, prepare: composition => fixture.options.execution.prepare({ ...composition, requestCallLimit: commerceLimits.calls }),
    } }));
    onTestFinished(() => Effect.runPromise(ordinary.close));
    const before = await fixture.snapshot();
    expect(await Effect.runPromise(Effect.result(ordinary.run(ordinary.newRequestKey(), input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await fixture.snapshot()).toEqual(before);
    const captured = object(await Effect.runPromise(fixture.capture.run(request, input)));
    expect(captured).toMatchObject({ id, captured_at: expect.any(String), captures: [{ amount: 15 }] });
    expect(await Effect.runPromise(fixture.capture.run(request, input))).toEqual(captured);
    const rows = await fixture.read(), capture = rows.find(row => typeof row.id === "string" && row.id.startsWith("capt_"));
    const transactions = rows.filter(row => typeof row.id === "string" && row.id.startsWith("ordtrx_"));
    expect(transactions).toMatchObject([{ order_id: "order-finance", version: 1, amount: "15.000000000000000000",
      raw_amount: { value: "15.000000000000000000", precision: 20 }, reference: "capture", reference_id: capture?.id }]);
    expect(rows.find(row => row.id === "ordsum-finance")?.totals).toMatchObject({ paid_total: 15, refunded_total: 0,
      transaction_total: 15, pending_difference: 0 });
    expect(fixture.errors).toEqual([]);
  }, 240_000);

  it("executes the native retained refund-transaction inverse and restores ordinary accounting", async () => {
    const forward = await fixture.prepareRetainedTransactions();
    onTestFinished(() => Effect.runPromise(forward.close));
    const inverse = await fixture.prepareRetainedTransactions(true);
    onTestFinished(() => Effect.runPromise(inverse.close));
    const key = forward.newRequestKey(), input = [{ order_id: "order-finance", amount: "-3.125", currency_code: "usd",
      reference: "refund", reference_id: "ref-retained-inverse" }];
    const refunded = object(await Effect.runPromise(forward.run(key, input)));
    expect(refunded.output).toMatchObject([{ amount: -3.125, version: 1, order_id: "order-finance" }]);
    expect(await Effect.runPromise(forward.run(key, input))).toEqual(refunded);
    const retained = Schema.decodeUnknownSync(Schema.Array(Schema.String))(refunded.retained);
    expect(retained).toHaveLength(1);
    expect((await fixture.read()).find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 15, refunded_total: 3.125, transaction_total: 11.875, pending_difference: 3.125 });
    const undoKey = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(undoKey, retained))).toBeNull();
    const inventory = await fixture.snapshot();
    expect(await Effect.runPromise(inverse.run(undoKey, retained))).toBeNull();
    expect(await fixture.snapshot()).toEqual(inventory);
    const after = await fixture.read();
    expect(after.some(row => typeof row.id === "string" && retained.includes(row.id))).toBe(false);
    expect(after.filter(row => typeof row.id === "string" && row.id.startsWith("ordtrx_"))).toHaveLength(1);
    expect(after.find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 15, refunded_total: 0, transaction_total: 15, pending_difference: 0 });
    expect(fixture.errors).toEqual([]);
  }, 240_000);

  it("creates native Change/Actions and executes their retained compensators through authenticated atomic participants", async () => {
    const create = await fixture.prepareRetainedChange("change");
    onTestFinished(() => Effect.runPromise(create.close));
    const actions = await fixture.prepareRetainedChange("actions");
    onTestFinished(() => Effect.runPromise(actions.close));
    const removeActions = await fixture.prepareRetainedChange("actions", true);
    onTestFinished(() => Effect.runPromise(removeActions.close));
    const removeChange = await fixture.prepareRetainedChange("change", true);
    onTestFinished(() => Effect.runPromise(removeChange.close));
    const key = create.newRequestKey(), input = { order_id: "order-finance", change_type: "credit_line" };
    const change = object(await Effect.runPromise(create.run(key, input)));
    expect(change.output).toMatchObject({ order_id: "order-finance", version: 2, status: "pending", actions: [] });
    expect(await Effect.runPromise(create.run(key, input))).toEqual(change);
    const id = text(change.retained);
    const added = object(await Effect.runPromise(actions.run(actions.newRequestKey(), [{ order_change_id: id,
      order_id: "order-finance", version: 2, action: "CREDIT_LINE_ADD", amount: "3.125", reference: "refund", reference_id: "ref-credit" },
      { order_change_id: id, order_id: "order-finance", version: 2, action: "CREDIT_LINE_ADD", amount: "1.875",
        reference: "refund", reference_id: "ref-credit-two" }])));
    expect(added.output).toMatchObject([{ order_change_id: id, order_id: "order-finance", version: 2, ordering: expect.any(Number),
      applied: false, details: {}, amount: 3.125 },
      { order_change_id: id, order_id: "order-finance", version: 2, ordering: expect.any(Number), applied: false, details: {}, amount: 1.875 }]);
    const orderings = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ ordering: Schema.Number })))(added.output);
    expect(orderings[1]?.ordering).toBe(orderings[0]!.ordering + 1);
    const retained = Schema.decodeUnknownSync(Schema.Struct({ entityIdentifiers: Schema.Array(Schema.String),
      moduleRegistrationName: Schema.Literal("order"), compensateMethod: Schema.Literal("deleteOrderChangeActions") }))(added.retained);
    expect(retained.entityIdentifiers).toHaveLength(2);
    const before = await fixture.read();
    expect(await Effect.runPromise(Effect.result(create.run(create.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
    expect(await fixture.read()).toEqual(before);
    const undoActionsKey = removeActions.newRequestKey();
    expect(await Effect.runPromise(removeActions.run(undoActionsKey, retained))).toBeNull();
    expect(await Effect.runPromise(removeActions.run(undoActionsKey, retained))).toBeNull();
    expect(await Effect.runPromise(removeChange.run(removeChange.newRequestKey(), change.retained!))).toBeNull();
    const after = await fixture.read();
    expect(after.some(row => row.id === id || typeof row.id === "string" && retained.entityIdentifiers.includes(row.id))).toBe(false);
    expect(after.find(row => row.id === "order-finance")?.version).toBe(1);
  }, 240_000);

  it("executes the native batch refund root, records its linked Order transaction, and preserves replay and refusal", async () => {
    const rows = await fixture.read(), payment = rows.find(row => row.payment_session_id === "payses_finance"), id = text(payment?.id);
    const emptyBefore = await fixture.read();
    expect(await Effect.runPromise(fixture.refunds.run(fixture.refunds.newRequestKey(), []))).toEqual([]);
    expect(await fixture.read()).toEqual(emptyBefore);
    const request = fixture.refunds.newRequestKey(), input = [{ payment_id: id, amount: "3.125", note: "Native batch refund" }];
    const result = await Effect.runPromise(fixture.refunds.run(request, input));
    expect(result).toMatchObject([{ id, refunds: [{ amount: 3.125, note: "Native batch refund" }] }]);
    expect(await Effect.runPromise(fixture.refunds.run(request, input))).toEqual(result);
    const after = await fixture.read();
    const refund = after.find(row => row.payment_id === id && typeof row.id === "string" && row.id.startsWith("ref_"));
    expect(refund).toBeDefined();
    expect(after.filter(row => row.reference === "refund" && row.reference_id === refund?.id))
      .toMatchObject([{ order_id: "order-finance", version: 1, amount: "-3.1250000000000000000" }]);
    expect(after.find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 15, refunded_total: 3.125, transaction_total: 11.875, pending_difference: 3.125 });
    expect(await Effect.runPromise(Effect.result(fixture.refunds.run(fixture.refunds.newRequestKey(), [{ payment_id: id, amount: "12" }]))))
      .toMatchObject({ _tag: "Failure" });
    expect(await fixture.read()).toEqual(after);
    expect(fixture.errors).toEqual([]);
  }, 240_000);

  it.each(["separate-keys", "one-batch"] as const)("accounts once for each successful partial refund of the same Payment: %s", async mode => {
    const repeated = await prepareLogicalPaymentFinance(driver, onTestFinished, undefined, "linked", {
      resource: fixture.fixture.resource, fixtureIdentity: { deploymentId: "payment-finance-repeated-refund-" + mode,
        projectId: "payment-finance-tests", uuidOffset: mode === "separate-keys" ? 8_020_000 : 8_030_000 },
    });
    const payment = object(await Effect.runPromise(repeated.authorize.run(repeated.authorize.newRequestKey(), { id: "payses_finance" })));
    const id = text(payment.id);
    await Effect.runPromise(repeated.capture.run(repeated.capture.newRequestKey(), { payment_id: id }));
    if (mode === "separate-keys")
      await Effect.runPromise(repeated.refunds.run(repeated.refunds.newRequestKey(), [{ payment_id: id, amount: "3.125" }]));
    const key = repeated.refunds.newRequestKey(), input = mode === "separate-keys" ? [{ payment_id: id, amount: "1" }]
      : [{ payment_id: id, amount: "3.125" }, { payment_id: id, amount: "1" }];
    const result = await Effect.runPromise(repeated.refunds.run(key, input));
    const returned = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result);
    expect(returned.at(-1)).toMatchObject({ id, refunds: expect.arrayContaining([expect.objectContaining({ id: expect.any(String), amount: 3.125 }),
      expect.objectContaining({ id: expect.any(String), amount: 1 })]) });
    const rows = await repeated.read(), transactions = rows.filter(row => row.reference === "refund" && row.order_id === "order-finance");
    expect(transactions).toHaveLength(2);
    const refundIds = rows.filter(row => row.payment_id === id && typeof row.id === "string" && row.id.startsWith("ref_")).map(row => row.id);
    expect(refundIds).toHaveLength(2);
    expect(transactions.map(row => row.reference_id).sort()).toEqual([...refundIds].sort());
    expect(transactions).toEqual(expect.arrayContaining([expect.objectContaining({ amount: "-3.1250000000000000000" }),
      expect.objectContaining({ amount: "-1.0000000000000000000" })]));
    expect(rows.find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 15, refunded_total: 4.125, transaction_total: 10.875, pending_difference: 4.125 });
    const inventory = await repeated.snapshot();
    expect(await Effect.runPromise(repeated.refunds.run(key, input))).toEqual(result);
    expect(await repeated.snapshot()).toEqual(inventory);
    expect(repeated.errors).toEqual([]);
  }, 240_000);
  it("rolls back the first staged refund when the native batch catches a later participant refusal", async () => {
    const rows = await fixture.read(), payment = rows.find(row => row.payment_session_id === "payses_finance"), id = text(payment?.id);
    const before = await fixture.snapshot();
    // Each amount fits the queried refundable total. The second invocation
    // must see the first staged refund and fail in the genuine Payment guard;
    // the batch step's native catch cannot clear the outer rollback-only state.
    const result = await Effect.runPromise(Effect.result(fixture.refunds.run(fixture.refunds.newRequestKey(), [
      { payment_id: id, amount: "8" }, { payment_id: id, amount: "8" },
    ])));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: {
      type: "invalid_data", message: "You cannot refund more than what is captured on the payment.",
    } } });
    const after = await fixture.snapshot();
    expect(after.rows).toEqual(before.rows);
    expect(after.revisions).toEqual(before.revisions);
    expect(after.events).toEqual(before.events);
    expect(after.physicalFacts).toEqual(before.physicalFacts);
  }, 240_000);

  it("executes the genuine retained transaction inverse beyond Number precision in an independent scope", async () => {
    // Native Summary numeric fields retain their native rounding semantics.
    // Keep this precision witness isolated from subsequent ordinary accounting.
    const preciseFixture = await prepareLogicalPaymentFinance(driver, onTestFinished, undefined, "linked", {
      resource: fixture.fixture.resource, fixtureIdentity: { deploymentId: "payment-finance-precision",
        projectId: "payment-finance-tests", uuidOffset: 8_010_000 },
    });
    // The genuine native inverse must see its checked raw companion rather
    // than the rounded public amount. This failed receipt validation when the
    // accounting input discarded raw_amount; native summary math is retained.
    const forward = await preciseFixture.prepareRetainedTransactions(), inverse = await preciseFixture.prepareRetainedTransactions(true);
    const precise = object(await Effect.runPromise(forward.run(forward.newRequestKey(), [{ order_id: "order-finance",
      amount: "9007199254740993.125", currency_code: "usd", reference: "capture", reference_id: "capt-precision" }])));
    const retained = Schema.decodeUnknownSync(Schema.Array(Schema.String))(precise.retained);
    expect(precise.output).toMatchObject([{ raw_amount: { value: "9007199254740993.1250", precision: 20 } }]);
    const undoKey = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(undoKey, retained))).toBeNull();
    expect(await Effect.runPromise(inverse.run(undoKey, retained))).toBeNull();
    const after = await preciseFixture.read();
    expect(after.some(row => typeof row.id === "string" && retained.includes(row.id))).toBe(false);
    expect(after.filter(row => typeof row.id === "string" && row.id.startsWith("ordtrx_"))).toHaveLength(0);
  }, 240_000);

  it("captures with a genuinely empty Link dataset and leaves unrelated Order accounting untouched", async () => {
    const unlinked = await prepareLogicalPaymentFinance(driver, onTestFinished, undefined, "unlinked", {
      resource: fixture.fixture.resource, fixtureIdentity: { deploymentId: "payment-finance-unlinked",
        projectId: "payment-finance-tests", uuidOffset: 8_000_000 },
    });
    const payment = object(await Effect.runPromise(unlinked.authorize.run(unlinked.authorize.newRequestKey(), { id: "payses_finance" })));
    const id = text(payment.id), key = unlinked.capture.newRequestKey(), input = { payment_id: id };
    const result = await Effect.runPromise(unlinked.capture.run(key, input));
    expect(result).toMatchObject({ id, captured_at: expect.any(String), captures: [{ amount: 15 }] });
    const inventory = await unlinked.snapshot();
    expect(await Effect.runPromise(unlinked.capture.run(key, input))).toEqual(result);
    expect(await unlinked.snapshot()).toEqual(inventory);
    const rows = await unlinked.read();
    expect(rows.some(row => typeof row.id === "string" && row.id.startsWith("ordtrx_"))).toBe(false);
    expect(rows.find(row => row.id === "order-finance")?.version).toBe(1);
    expect(rows.find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 0, refunded_total: 0, transaction_total: 0, pending_difference: 15 });
    expect(unlinked.errors).toEqual([]);
  }, 240_000);
});

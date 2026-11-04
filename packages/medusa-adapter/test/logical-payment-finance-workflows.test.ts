import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, onTestFinished, vi } from "vitest";
import { PaymentEvents } from "@medusajs/framework/utils/portable";
import { OrderModuleService } from "@medusajs/order/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { preparePaymentAuthorizationWorkflow } from "../src/workflows/payment/authorize-session";
import { preparePaymentCaptureWorkflow } from "../src/workflows/payment/capture-payment";
import { preparePaymentRefundWorkflow } from "../src/workflows/payment/refund-payment";
import { preparePaymentRefundsWorkflow } from "../src/workflows/payment/refund-payments";
import type { PaymentFinanceWorkflowInput } from "../src/workflows/payment/finance-configuration";
import type { LegacyInstalledWorkflowModules } from "../src/workflow/host";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { prepareCorePaymentFinance } from "./support/core-payment-finance-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);

describe("genuine native Payment financial roots", () => {
  let fixture: Awaited<ReturnType<typeof prepareCorePaymentFinance>>;
  beforeAll(async () => { fixture = await prepareCorePaymentFinance(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("recovers a linked Capture and its Order accounting after losing the commit acknowledgement", async () => {
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
    const refusedKey = ordinary.newRequestKey(), beforeRefusal = await fixture.fixture.inventory();
    expect(await Effect.runPromise(Effect.result(ordinary.run(refusedKey, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    await expectCheckoutRollback(fixture.fixture, beforeRefusal, refusedKey);

    const before = await fixture.snapshot(), fault = fixture.fixture.loseNextNativeRootAcknowledgement();
    const capturePayment = vi.spyOn(PaymentModuleService.prototype, "capturePayment");
    const addTransactions = vi.spyOn(OrderModuleService.prototype, "addOrderTransactions");
    try {
      const captured = object(await Effect.runPromise(fixture.capture.run(request, input)));
      expect(captured).toMatchObject({ id, captured_at: expect.any(String), captures: [{ amount: 15 }] });
      expect(fault).toMatchObject({ armed: false, failures: 1 });
      const rows = await fixture.read(), capture = rows.find(row => typeof row.id === "string" && row.id.startsWith("capt_"));
      const transactions = rows.filter(row => typeof row.id === "string" && row.id.startsWith("ordtrx_"));
      expect(transactions).toMatchObject([{ order_id: "order-finance", version: 1, amount: "15.000000000000000000",
        raw_amount: { value: "15.000000000000000000", precision: 20 }, reference: "capture", reference_id: capture?.id }]);
      expect(rows.find(row => row.id === "ordsum-finance")?.totals).toMatchObject({ paid_total: 15, refunded_total: 0,
        transaction_total: 15, pending_difference: 0 });

      const after = await fixture.snapshot(), timestamp = expectCheckoutSettlement(before, after, request);
      expect(fault.evidence?.timestamp).toBe(timestamp);
      for (const rowId of [id, text(capture?.id), text(transactions[0]?.id), "ordsum-finance"])
        expect(after.revisions).toContainEqual(expect.objectContaining({ timestamp, value: expect.objectContaining({ id: rowId }) }));
      const paymentSource = fixture.fixture.source("payment");
      const captureTable = fixture.fixture.sources.find(source => source.source === paymentSource)
        ?.definition.tables.find(table => table.localName === "capture");
      const paymentIndex = captureTable?.indexes?.find(index => index.nativeId === "IDX_capture_payment_id");
      const captureRevision = after.revisions.find(row => row.table === captureTable?.name && row.value?.id === capture?.id);
      if (captureTable === undefined || paymentIndex === undefined || captureRevision === undefined)
        throw new Error("Missing genuine Capture index or settled document revision");
      const captureIndexEntries = (snapshot: typeof after) => snapshot.indexes.filter(entry =>
        entry.table === captureTable.name && entry.name === paymentIndex.indexName && entry.id === captureRevision.id);
      expect(captureIndexEntries(before)).toEqual([]);
      expect(captureIndexEntries(after)).toMatchObject([{ timestamp }]);
      const capturedEvents = after.events.filter(event => event.envelope.contract === PaymentEvents.CAPTURED);
      expect(capturedEvents).toMatchObject([{ timestamp, envelope: { message: { data: { id } } } }]);
      expect(after.deliveries).toContainEqual(expect.objectContaining({ timestamp, value: expect.objectContaining({
        family_id: capturedEvents[0]?.familyId, ordinal: capturedEvents[0]?.ordinal, state: "pending",
      }) }));

      const recovered = await Effect.runPromise(preparePaymentCaptureWorkflow(fixture.options));
      onTestFinished(() => Effect.runPromise(recovered.close));
      const inventory = await fixture.fixture.inventory();
      expect(await Effect.runPromise(recovered.run(request, input))).toEqual(captured);
      expect(await Effect.runPromise(Effect.result(recovered.run(request, { ...input, amount: "1" }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(capturePayment).toHaveBeenCalledTimes(1);
      expect(addTransactions).toHaveBeenCalledTimes(1);
      expect(await fixture.fixture.inventory()).toEqual(inventory);
      expect(fixture.errors).toEqual([]);
    } finally { capturePayment.mockRestore(); addTransactions.mockRestore(); }
  }, 240_000);

  it("refuses swapped Core selectors and Legacy refund bindings before preparing a finance host", async () => {
    const { modules } = fixture.options, before = await fixture.fixture.inventory();
    const prepare = vi.fn(fixture.options.execution.prepare);
    const execution = { ...fixture.options.execution, prepare };
    const payment = fixture.fixture.source("payment"), order = fixture.fixture.source("order");
    const swapped = await Effect.runPromise(Effect.result(preparePaymentCaptureWorkflow({ ...fixture.options, execution, modules: {
      ...modules, payment: { module: modules.payment.module, nativeStorage: order },
      order: { module: modules.order.module, nativeStorage: payment },
    } })));
    expect(swapped).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const wrongAuthorization = await Effect.runPromise(Effect.result(preparePaymentAuthorizationWorkflow({ ...fixture.options, execution,
      modules: { payment: { module: modules.payment.module, nativeStorage: order } },
    })));
    expect(wrongAuthorization).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    type LegacyModules = LegacyInstalledWorkflowModules<PaymentFinanceWorkflowInput["modules"]>;
    expectTypeOf<LegacyModules>().not.toExtend<Parameters<typeof preparePaymentRefundWorkflow>[0]["modules"]>();
    expectTypeOf<LegacyModules>().not.toExtend<Parameters<typeof preparePaymentRefundsWorkflow>[0]["modules"]>();
    const legacy = { ...fixture.options, execution, modules: {
      payment: { module: modules.payment.module, logicalStorage: null },
      order: { module: modules.order.module, logicalStorage: null },
      order_payment_collection_links: { module: modules.order_payment_collection_links.module, logicalStorage: null },
    } };
    for (const prepareRefund of [preparePaymentRefundWorkflow, preparePaymentRefundsWorkflow]) {
      // @ts-expect-error Deliberately unissued envelopes exercise runtime refusal before storage preparation.
      const denied = await Effect.runPromise(Effect.result(prepareRefund(legacy)));
      expect(denied).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(await fixture.fixture.inventory()).toEqual(before);
  }, 240_000);

  it("executes the native retained refund-transaction inverse and restores ordinary accounting", async () => {
    const forward = await fixture.prepareRetainedTransactions();
    const inverse = await fixture.prepareRetainedTransactions(true);
    const key = forward.newRequestKey(), input = [{ order_id: "order-finance", amount: "-3.125", currency_code: "usd",
      reference: "refund", reference_id: "ref-retained-inverse" }];
    const refunded = object(await Effect.runPromise(forward.run(key, input)));
    expect(refunded.output).toMatchObject([{ amount: -3.125, version: 1, order_id: "order-finance" }]);
    expect(await Effect.runPromise(forward.run(key, input))).toEqual(refunded);
    const retained = Schema.decodeUnknownSync(Schema.Array(Schema.String))(refunded.retained);
    expect(retained).toHaveLength(1);
    expect((await fixture.read()).find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 15, refunded_total: 3.125, transaction_total: 11.875, pending_difference: 3.125 });
    const beforeUndo = await fixture.snapshot(), undoKey = inverse.newRequestKey();
    const transaction = beforeUndo.revisions.find(row => row.value?.id === retained[0]);
    if (transaction === undefined) throw new Error("Missing retained Order transaction revision");
    expect(await Effect.runPromise(inverse.run(undoKey, retained))).toBeNull();
    const inventory = await fixture.snapshot();
    const timestamp = expectCheckoutSettlement(beforeUndo, inventory, undoKey);
    expect(inventory.revisions).toContainEqual(expect.objectContaining({ table: transaction.table, id: transaction.id,
      timestamp, previous: transaction.timestamp, deleted: true, value: null }));
    expect(inventory.indexes.some(entry => entry.table === transaction.table && entry.id === transaction.id)).toBe(false);
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
    const actions = await fixture.prepareRetainedChange("actions");
    const removeActions = await fixture.prepareRetainedChange("actions", true);
    const removeChange = await fixture.prepareRetainedChange("change", true);
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
    const before = await fixture.fixture.inventory(), duplicateKey = create.newRequestKey();
    expect(await Effect.runPromise(Effect.result(create.run(duplicateKey, input)))).toMatchObject({ _tag: "Failure" });
    await expectCheckoutRollback(fixture.fixture, before, duplicateKey);
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
    const before = await fixture.snapshot();
    const request = fixture.refunds.newRequestKey(), input = [{ payment_id: id, amount: "3.125", note: "Native batch refund" }];
    const result = await Effect.runPromise(fixture.refunds.run(request, input));
    expect(result).toMatchObject([{ id, refunds: [{ amount: 3.125, note: "Native batch refund" }] }]);
    const settled = await fixture.snapshot();
    expectCheckoutSettlement(before, settled, request);
    expect(await Effect.runPromise(fixture.refunds.run(request, input))).toEqual(result);
    expect(await fixture.snapshot()).toEqual(settled);
    const after = await fixture.read();
    const refund = after.find(row => row.payment_id === id && typeof row.id === "string" && row.id.startsWith("ref_"));
    expect(refund).toBeDefined();
    expect(after.filter(row => row.reference === "refund" && row.reference_id === refund?.id))
      .toMatchObject([{ order_id: "order-finance", version: 1, amount: "-3.1250000000000000000" }]);
    expect(after.find(row => row.id === "ordsum-finance")?.totals)
      .toMatchObject({ paid_total: 15, refunded_total: 3.125, transaction_total: 11.875, pending_difference: 3.125 });
    const beforeRefusal = await fixture.fixture.inventory(), refusedKey = fixture.refunds.newRequestKey();
    expect(await Effect.runPromise(Effect.result(fixture.refunds.run(refusedKey, [{ payment_id: id, amount: "12" }]))))
      .toMatchObject({ _tag: "Failure" });
    await expectCheckoutRollback(fixture.fixture, beforeRefusal, refusedKey);
    expect(fixture.errors).toEqual([]);
  }, 240_000);

  it.each(["separate-keys", "one-batch"] as const)("accounts once for each successful partial refund of the same Payment: %s", async mode => {
    const repeated = await prepareCorePaymentFinance(driver, onTestFinished, undefined, "linked", fixture.fixture.physical);
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
    const before = await fixture.fixture.inventory(), key = fixture.refunds.newRequestKey();
    // Each amount fits the queried refundable total. The second invocation
    // must see the first staged refund and fail in the genuine Payment guard;
    // the batch step's native catch cannot clear the outer rollback-only state.
    const provider = vi.spyOn(SystemPaymentProvider.prototype, "refundPayment");
    try {
      const result = await Effect.runPromise(Effect.result(fixture.refunds.run(key, [
        { payment_id: id, amount: "8" }, { payment_id: id, amount: "8" },
      ])));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: {
        type: "invalid_data", message: "You cannot refund more than what is captured on the payment.",
      } } });
      expect(provider).toHaveBeenCalledTimes(1);
      await expectCheckoutRollback(fixture.fixture, before, key);
    } finally { provider.mockRestore(); }
  }, 240_000);

  it("executes the genuine retained transaction inverse beyond Number precision in an independent scope", async () => {
    // Native Summary numeric fields retain their native rounding semantics.
    // Keep this precision witness isolated from subsequent ordinary accounting.
    const preciseFixture = await prepareCorePaymentFinance(driver, onTestFinished, undefined, "linked", fixture.fixture.physical);
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
    const unlinked = await prepareCorePaymentFinance(driver, onTestFinished, undefined, "unlinked", fixture.fixture.physical);
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

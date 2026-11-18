import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { prepareCoreCustomerAccounts, accountCustomer, accountCollection } from "./support/core-customer-account-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";
import * as addressReceipts from "../src/modules/customer/address-receipt";
import * as accountReceipts from "../src/modules/payment/account-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let local: Awaited<ReturnType<typeof prepareCoreCustomerAccounts>>;
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const sessionInput = { customer_id: accountCustomer, payment_collection_id: accountCollection, provider_id: "pp_system_default" as const };
const packets: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
const originalAddressPolicy = addressReceipts.customerAddressPolicy, originalAccountPolicy = accountReceipts.paymentAccountPolicy;
async function success<A, E>(effect: Effect.Effect<A, E>) {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause) + "\nCaptured failure: " + JSON.stringify(exit.cause, (key, value) => key === "stack" ? undefined : value));
  return exit.value;
}
beforeAll(async () => {
  vi.spyOn(addressReceipts, "customerAddressPolicy").mockImplementation(prepared => {
    const policy = originalAddressPolicy(prepared);
    return { ...policy, validateLogicalCall: Effect.fn("CustomerAddress.captureActualReceipt")(function* (call, activity) {
      yield* policy.validateLogicalCall(call, activity); packets.push(structuredClone({ call, activity }));
    }) };
  });
  vi.spyOn(accountReceipts, "paymentAccountPolicy").mockImplementation(prepared => {
    const policy = originalAccountPolicy(prepared);
    return { ...policy, validateLogicalCall: Effect.fn("PaymentAccount.captureActualReceipt")(function* (call, activity) {
      yield* policy.validateLogicalCall(call, activity); packets.push(structuredClone({ call, activity }));
    }) };
  });
  local = await prepareCoreCustomerAccounts(driver, release => cleanup.push(release));
}, 240_000);
afterEach(() => local.closeCaseHosts(), 120_000);
afterAll(async () => { vi.restoreAllMocks(); await finishOrderFixture(cleanup.reverse()); }, 120_000);

it("runs the native Address create root and replaces each default without changing another Customer", async () => {
  const host = await local.addresses.create();
  await success(host.run(host.newRequestKey(), { addresses: [
    { id: "cuaddr-account-old", customer_id: accountCustomer, city: "Old", is_default_billing: true, is_default_shipping: true },
    { id: "cuaddr-account-other", customer_id: "cus-other-account", city: "Other", is_default_billing: true, is_default_shipping: true },
  ] }));
  const before = await local.snapshot(), key = host.newRequestKey(), input = { addresses: [{ id: "cuaddr-account-current", customer_id: accountCustomer,
    city: "Current", is_default_billing: true, is_default_shipping: true, metadata: { address_book: true } }] };
  const output = await success(host.run(key, input));
  expect(output).toMatchObject([{ id: "cuaddr-account-current", city: "Current", is_default_billing: true, is_default_shipping: true }]);
  const rows = await local.read();
  expect(rows.find(row => row.id === "cuaddr-account-old")).toMatchObject({ is_default_billing: false, is_default_shipping: false });
  expect(rows.find(row => row.id === "cuaddr-account-other")).toMatchObject({ is_default_billing: true, is_default_shipping: true });
  const after = await local.snapshot();
  const timestamp = expectCheckoutSettlement(before, after, key);
  expect(after.revisions.filter(row => row.timestamp === timestamp).map(row => row.value?.id))
    .toEqual(expect.arrayContaining(["cuaddr-account-current", "cuaddr-account-old"]));
  expect(await success(host.run(key, input))).toEqual(output);
  expect(await local.snapshot()).toEqual(after);
}, 180_000);

it("creates the System account and stored Link with the selected native billing Address", async () => {
  const host = await local.prepareSession(), create = vi.spyOn(SystemPaymentProvider.prototype, "createAccountHolder"), key = host.newRequestKey();
  try {
    const before = await local.snapshot();
    const session = object(await success(host.run(key, sessionInput)));
    expect(session).toMatchObject({ payment_collection_id: accountCollection, amount: 12.5, context: {
      customer: { id: accountCustomer, email: "accounts@example.invalid", billing_address: { id: "cuaddr-account-current", city: "Current" } },
      account_holder: { id: expect.stringMatching(/^acchld_/), external_id: accountCustomer, data: {}, provider_id: "pp_system_default" },
    } });
    const rows = await local.read(), holders = rows.filter(row => typeof row.id === "string" && row.id.startsWith("acchld_"));
    expect(holders).toHaveLength(1);
    const holderId = holders[0]?.id;
    if (typeof holderId !== "string" || typeof session.id !== "string") throw new Error("Missing native account or Session identity");
    expect(rows.filter(row => row.account_holder_id === holderId)).toMatchObject([{ customer_id: accountCustomer }]);
    const after = await local.snapshot();
    const timestamp = expectCheckoutSettlement(before, after, key);
    const revisions = after.revisions.filter(row => row.timestamp === timestamp);
    const tables = local.fixture.sources.flatMap(source => source.definition.tables);
    const table = (name: string) => tables.find(entry => entry.localName === name)?.name;
    expect(revisions.find(row => row.table === table("account_holder") && row.value?.id === holderId)?.value)
      .toMatchObject({ external_id: accountCustomer });
    expect(revisions.find(row => row.table === table("customer_account_holder") && row.value?.account_holder_id === holderId)?.value)
      .toMatchObject({ customer_id: accountCustomer });
    expect(revisions.find(row => row.table === table("payment_session") && row.value?.id === session.id)?.value)
      .toMatchObject({ payment_collection_id: accountCollection });
    expect(await success(host.run(key, sessionInput))).toEqual(session); expect(await local.snapshot()).toEqual(after); expect(create).toHaveBeenCalledTimes(1);
  } finally { create.mockRestore(); }
}, 180_000);

it("reuses the linked account on replacement and does not call provider account creation again", async () => {
  const host = await local.prepareSession(), create = vi.spyOn(SystemPaymentProvider.prototype, "createAccountHolder");
  try {
    const before = await local.read(), account = before.find(row => typeof row.id === "string" && row.id.startsWith("acchld_"));
    const output = object(await success(host.run(host.newRequestKey(), { ...sessionInput, data: { replace: true } })));
    expect(output).toMatchObject({ data: { replace: true }, context: { account_holder: account } });
    expect(create).not.toHaveBeenCalled();
    expect((await local.read()).filter(row => row.external_id === accountCustomer)).toEqual([account]);
    expect((await local.read()).filter(row => row.account_holder_id === account?.id)).toHaveLength(1);
  } finally { create.mockRestore(); }
}, 180_000);

it("rolls back a new account, Link and Session after a late native-parent failure", async () => {
  const host = await local.lateSession(), before = await local.fixture.inventory(), key = host.newRequestKey();
  const exit = await Effect.runPromiseExit(host.run(key, { ...sessionInput, customer_id: "cus-other-account" }));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late Customer account/session parent failure");
  await expectCheckoutRollback(local.fixture, before, key);
}, 180_000);

it("rolls back native default replacement and Address insertion after a late parent failure", async () => {
  const host = await local.lateAddress(), before = await local.fixture.inventory(), key = host.newRequestKey();
  const exit = await Effect.runPromiseExit(host.run(key, { addresses: [{ id: "cuaddr-account-rollback", customer_id: accountCustomer, is_default_billing: true }] }));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late Customer Address parent failure");
  await expectCheckoutRollback(local.fixture, before, key);
}, 180_000);

it("refuses two native defaults for one Customer and retains the previous default atomically", async () => {
  const host = await local.addresses.create(), before = await local.fixture.inventory(), key = host.newRequestKey();
  const exit = await Effect.runPromiseExit(host.run(key, { addresses: ["cuaddr-bad-first", "cuaddr-bad-second"].map(id =>
    ({ id, customer_id: accountCustomer, is_default_billing: true })) }));
  expect(Exit.isFailure(exit)).toBe(true);
  await expectCheckoutRollback(local.fixture, before, key);
}, 180_000);

it("retains native Customer foreign-key enforcement at settlement", async () => {
  const host = await local.addresses.create(), before = await local.fixture.inventory(), key = host.newRequestKey();
  const exit = await Effect.runPromiseExit(host.run(key, { addresses: [{ id: "cuaddr-orphan", customer_id: "cus-address-missing" }] }));
  const failures = expectWorkflowTypedFailures(exit, "invalidInput");
  expect(failures.find(failure => failure.reason === "invalidInput")?.cause).toMatchObject({
    _tag: "CoreNativeForeignKeyError", reason: "targetMissing", sourceFields: ["customer_id"], targetFields: ["id"],
  });
  const accepted = packets.find(packet => packet.call.commandName === "customerAddressesCreate" && packet.activity.mutations.some(row => row.after?.id === "cuaddr-orphan"));
  expect(accepted?.activity.mutations[0]?.after).toMatchObject({ id: "cuaddr-orphan", customer_id: "cus-address-missing" });
  await expectCheckoutRollback(local.fixture, before, key);
}, 180_000);

it("preserves the native scalar creation planner for repeated Address identities", async () => {
  const create = await local.addresses.create();
  const output = await success(create.run(create.newRequestKey(), { addresses: [
    { id: "cuaddr-duplicate", customer_id: "cus-other-account", city: "First", metadata: null },
    { id: "cuaddr-duplicate", customer_id: "cus-other-account", city: "Second", metadata: { filled: true } },
  ] }));
  expect(output).toHaveLength(2); expect(output[0]).toEqual(output[1]);
  expect(output[0]).toMatchObject({ city: "First", metadata: { filled: true } });
  expect((await local.read()).filter(row => row.id === "cuaddr-duplicate")).toHaveLength(1);
  const remove = await local.addresses.delete(); await success(remove.run(remove.newRequestKey(), { ids: ["cuaddr-duplicate"] }));
}, 180_000);

it("updates native Address defaults and scalars, then physically deletes the selected Address", async () => {
  const update = await local.addresses.update();
  expect(await success(update.run(update.newRequestKey(), { selector: { id: "cuaddr-account-old" }, update: { city: "Updated", is_default_billing: true } })))
    .toMatchObject([{ id: "cuaddr-account-old", city: "Updated", is_default_billing: true }]);
  expect((await local.read()).find(row => row.id === "cuaddr-account-current")).toMatchObject({ is_default_billing: false, is_default_shipping: true });
  const remove = await local.addresses.delete(), key = remove.newRequestKey();
  expect(await success(remove.run(key, { ids: ["cuaddr-account-old"] }))).toBeNull();
  expect((await local.read()).some(row => row.id === "cuaddr-account-old")).toBe(false);
  const after = await local.snapshot(); await success(remove.run(key, { ids: ["cuaddr-account-old"] })); expect(await local.snapshot()).toEqual(after);
}, 180_000);

it("uses the native first-Address fallback when no default billing Address remains", async () => {
  const host = await local.prepareSession(), output = object(await success(host.run(host.newRequestKey(), sessionInput)));
  expect(output).toMatchObject({ context: { customer: { billing_address: { id: "cuaddr-account-current", is_default_billing: false } } } });
}, 180_000);

it("creates a System account without an Address, then carries all four saved Addresses into a replacement Session", async () => {
  const session = await local.prepareSession(), input = { ...sessionInput, customer_id: "cus-account-empty" };
  const empty = object(await success(session.run(session.newRequestKey(), input)));
  expect(empty).toMatchObject({ context: { customer: { id: "cus-account-empty", addresses: [] } } });
  const context = object(empty.context), customer = object(context.customer);
  expect(Object.hasOwn(customer, "billing_address")).toBe(false);
  const create = await local.addresses.create();
  await success(create.run(create.newRequestKey(), { addresses: [1, 2, 3, 4].map(index => ({ id: "cuaddr-empty-" + index,
    customer_id: "cus-account-empty", city: "Saved " + index })) }));
  const output = object(await success(session.run(session.newRequestKey(), input))), populated = object(object(output.context).customer);
  expect(populated.addresses).toHaveLength(4);
  expect(populated.billing_address).toMatchObject({ id: "cuaddr-empty-1" });
}, 180_000);

it("fails an absent Customer before account, Link or Session writes and rejects an unsupported provider", async () => {
  const host = await local.prepareSession(), before = await local.fixture.inventory(), absent = host.newRequestKey();
  expect(Exit.isFailure(await Effect.runPromiseExit(host.run(absent, { ...sessionInput, customer_id: "cus-absent" })))).toBe(true);
  await expectCheckoutRollback(local.fixture, before, absent);
  // Deliberately cross the foreign runtime boundary to prove unsupported input
  // is rejected even when it bypasses the statically selected System provider.
  const beforeUnsupported = await local.fixture.inventory(), unsupported = host.newRequestKey();
  expect(Exit.isFailure(await Effect.runPromiseExit(Reflect.apply(host.run, host,
    [unsupported, { ...sessionInput, provider_id: "pp_remote_unsupported" }])))).toBe(true);
  await expectCheckoutRollback(local.fixture, beforeUnsupported, unsupported);
}, 180_000);

it("retains the ordinary request allowance while the named Customer Session profile selects the existing Payment allowance", async () => {
  const host = await local.defaultSession(), before = await local.fixture.inventory(), key = host.newRequestKey();
  const exit = await Effect.runPromiseExit(host.run(key, { ...sessionInput, customer_id: "cus-account-empty" }));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error] : []))
    .toEqual(expect.arrayContaining([expect.objectContaining({ reason: "limitExceeded" }), expect.objectContaining({ reason: "rollbackOnly" })]));
  await expectCheckoutRollback(local.fixture, before, key);
}, 180_000);

it("recreates a physically deleted Address from the genuine retained preimage", async () => {
  const before = (await local.read()).find(row => row.id === "cuaddr-account-other");
  const beforeDelete = await local.snapshot();
  const forward = await local.retained("delete"), inverse = await local.retained("delete", true);
  const deleteKey = forward.newRequestKey();
  const result = object(await success(forward.run(deleteKey, ["cuaddr-account-other"])));
  expect(result.retained).toEqual([before]);
  expect((await local.read()).some(row => row.id === "cuaddr-account-other")).toBe(false);
  const deleted = await local.snapshot();
  const deletedAt = expectCheckoutSettlement(beforeDelete, deleted, deleteKey);
  const preimage = beforeDelete.revisions.findLast(row => row.value?.id === "cuaddr-account-other");
  expect(preimage).toBeDefined();
  expect(deleted.revisions.find(row => row.timestamp === deletedAt && row.id === preimage?.id))
    .toMatchObject({ deleted: true, value: null, previous: preimage?.timestamp });
  const key = inverse.newRequestKey();
  expect(await success(inverse.run(key, Schema.decodeUnknownSync(Schema.Json)(result.retained)))).toBeNull();
  expect((await local.read()).find(row => row.id === "cuaddr-account-other")).toEqual(before);
  const after = await local.snapshot();
  const restoredAt = expectCheckoutSettlement(deleted, after, key);
  expect(after.revisions.find(row => row.timestamp === restoredAt && row.value?.id === "cuaddr-account-other"))
    .toMatchObject({ deleted: false, value: before });
  await success(inverse.run(key, Schema.decodeUnknownSync(Schema.Json)(result.retained))); expect(await local.snapshot()).toEqual(after);
}, 180_000);

it("uses the actual native creation and scalar-update compensation markers", async () => {
  const create = await local.retained("create"), remove = await local.retained("create", true);
  const inserted = object(await success(create.run(create.newRequestKey(), [{ customer_id: accountCustomer, city: "Temporary" }])));
  const ids = Schema.decodeUnknownSync(Schema.Array(Schema.String))(inserted.retained);
  expect(ids).toHaveLength(1); expect((await local.read()).some(row => row.id === ids[0])).toBe(true);
  await success(remove.run(remove.newRequestKey(), ids)); expect((await local.read()).some(row => row.id === ids[0])).toBe(false);
  const before = (await local.read()).find(row => row.id === "cuaddr-account-current");
  const update = await local.retained("update"), restore = await local.retained("update", true);
  const changed = object(await success(update.run(update.newRequestKey(), { selector: { id: "cuaddr-account-current" }, update: { city: "Moved" } })));
  expect(changed.retained).toEqual([{ id: "cuaddr-account-current", city: before?.city }]);
  await success(restore.run(restore.newRequestKey(), Schema.decodeUnknownSync(Schema.Json)(changed.retained)));
  expect((await local.read()).find(row => row.id === "cuaddr-account-current")).toMatchObject({ city: before?.city,
    customer_id: accountCustomer, is_default_billing: before?.is_default_billing, is_default_shipping: before?.is_default_shipping });
}, 180_000);

it("restores both defaults through the genuine native unset-step compensators", async () => {
  for (const kind of ["billing", "shipping"] as const) {
    const field = "is_default_" + kind, forward = await local.retained(kind), inverse = await local.retained(kind, true);
    const result = object(await success(forward.run(forward.newRequestKey(), { create: [{ customer_id: "cus-other-account", [field]: true }] })));
    expect(result.retained).toEqual(["cuaddr-account-other"]);
    expect((await local.read()).find(row => row.id === "cuaddr-account-other")?.[field]).toBe(false);
    await success(inverse.run(inverse.newRequestKey(), Schema.decodeUnknownSync(Schema.Json)(result.retained)));
    expect((await local.read()).find(row => row.id === "cuaddr-account-other")?.[field]).toBe(true);
  }
}, 180_000);

it("deletes a newly created System account through the genuine retained step inverse", async () => {
  const forward = await local.retained("account"), inverse = await local.retained("account", true);
  const result = object(await success(forward.run(forward.newRequestKey(), { provider_id: "pp_system_default", context: { customer: { id: "cus-retained-account" } } })));
  const account = object(result.retained);
  expect(account).toMatchObject({ external_id: "cus-retained-account", data: {}, email: null });
  const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deleteAccountHolder");
  try {
    const key = inverse.newRequestKey(), before = await local.snapshot();
    await success(inverse.run(key, account)); expect(deleted).toHaveBeenCalledTimes(1);
    expect((await local.read()).some(row => row.id === account.id)).toBe(false);
    const after = await local.snapshot();
    const timestamp = expectCheckoutSettlement(before, after, key);
    const preimage = before.revisions.findLast(row => row.value?.id === account.id);
    expect(preimage).toBeDefined();
    expect(after.revisions.find(row => row.timestamp === timestamp && row.id === preimage?.id))
      .toMatchObject({ deleted: true, value: null, previous: preimage?.timestamp });
  } finally { deleted.mockRestore(); }
}, 180_000);

it("retains a null compensation marker for an existing account and leaves it untouched", async () => {
  const account = (await local.read()).find(row => row.external_id === accountCustomer);
  if (account === undefined) throw new Error("Missing linked native System account");
  const forward = await local.retained("account"), inverse = await local.retained("account", true), before = await local.snapshot();
  const forwardKey = forward.newRequestKey(), inverseKey = inverse.newRequestKey();
  const output = object(await success(forward.run(forwardKey, { provider_id: "pp_system_default",
    context: { customer: { id: accountCustomer, email: "accounts@example.invalid" }, account_holder: account } })));
  expect(output).toEqual({ output: account, retained: null });
  const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deleteAccountHolder");
  try { await success(inverse.run(inverseKey, null)); expect(deleted).not.toHaveBeenCalled(); } finally { deleted.mockRestore(); }
  const { outcomes, ...after } = await local.snapshot();
  expect(outcomes.slice(before.outcomes.length)).toMatchObject([
    { value: { key: forwardKey, kind: "nativeRoot", state: "committed" } },
    { value: { key: inverseKey, kind: "nativeRoot", state: "committed" } },
  ]);
  expect({ ...after, outcomes: outcomes.slice(0, before.outcomes.length) }).toEqual(before);
}, 180_000);

it("refuses forged Address/account results, event omission, changed source keys and missing reads", async () => {
  for (const [name, validate] of [["customerAddressesCreate", originalAddressPolicy(local.customer.prepared).validateLogicalCall],
    ["customerAddressesUpdate", originalAddressPolicy(local.customer.prepared).validateLogicalCall],
    ["customerAddressesList", originalAddressPolicy(local.customer.prepared).validateLogicalCall],
    ["paymentAccountHolderCreate", originalAccountPolicy(local.payment.prepared).validateLogicalCall],
    ["paymentAccountHolderCount", originalAccountPolicy(local.payment.prepared).validateLogicalCall],
    ["paymentAccountHolderDelete", originalAccountPolicy(local.payment.prepared).validateLogicalCall]] as const) {
    const packet = packets.find(value => value.call.commandName === name && (value.call.mode === "write" ? value.activity.mutations.length > 0 : value.activity.observedRows.length > 0));
    if (packet === undefined) throw new Error("Missing actual native receipt " + name);
    await success(validate(packet.call, packet.activity));
    expect(await Effect.runPromise(Effect.result(validate({ ...packet.call, result: { forged: true } }, packet.activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    if (packet.call.events.length) expect(await Effect.runPromise(Effect.result(validate({ ...packet.call, events: [] }, packet.activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    if (packet.activity.relationalReads.length) expect(await Effect.runPromise(Effect.result(validate(packet.call, { ...packet.activity, relationalReads: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    if (packet.activity.mutations.length) expect(await Effect.runPromise(Effect.result(validate(packet.call, { ...packet.activity,
      mutations: packet.activity.mutations.map(value => value.after === null ? { ...value, before: value.before === null ? null : { ...value.before, id: "forged" } }
        : { ...value, after: { ...value.after, customer_id: "cus-forged" } }) }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  }
});

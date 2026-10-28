import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLogicalCustomerAccounts, accountCustomer } from "./support/logical-customer-account-fixture";
import * as addressReceipts from "../src/modules/customer/address-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const json = Schema.decodeUnknownSync(Schema.Json), object = Schema.decodeUnknownSync(Schema.JsonObject);
let local: Awaited<ReturnType<typeof prepareLogicalCustomerAccounts>>;
const originalAddressPolicy = addressReceipts.customerAddressPolicy;
const replacementPackets: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
async function success<A, E>(effect: Effect.Effect<A, E>) {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  return exit.value;
}
beforeAll(async () => {
  vi.spyOn(addressReceipts, "customerAddressPolicy").mockImplementation(prepared => {
    const policy = originalAddressPolicy(prepared);
    return { ...policy, validateLogicalCall: Effect.fn("CustomerAddress.captureReplacementReceipt")(function* (call, activity) {
      yield* policy.validateLogicalCall(call, activity);
      if (call.commandName === "customerAddressesUpdate" && object(call.input).options !== undefined) replacementPackets.push(structuredClone({ call, activity }));
    }) };
  });
  local = await prepareLogicalCustomerAccounts(driver, release => cleanup.push(release));
  const create = await local.addresses.create();
  await success(create.run(create.newRequestKey(), { addresses: [
    { id: "cuaddr-default-selector", customer_id: accountCustomer, city: "Before", is_default_billing: true, is_default_shipping: true },
    { id: "cuaddr-default-foreign", customer_id: "cus-other-account", city: "Other", is_default_billing: true, is_default_shipping: true },
  ] }));
}, 240_000);
afterAll(async () => { vi.restoreAllMocks(); for (const release of cleanup.reverse()) await release(); }, 120_000);

it.each(["is_default_billing", "is_default_shipping"] as const)("updates the originally selected %s Address and retains its default", async field => {
  const host = await local.addresses.update(), key = host.newRequestKey();
  const input = { selector: { customer_id: accountCustomer, [field]: true }, update: { [field]: true, city: field } };
  expect(await success(host.run(key, input))).toMatchObject([{ id: "cuaddr-default-selector", [field]: true, city: field }]);
  expect((await local.read()).find(row => row.id === "cuaddr-default-selector")).toMatchObject({ [field]: true, city: field });
  expect((await local.read()).find(row => row.id === "cuaddr-default-foreign")).toMatchObject({ is_default_billing: true, is_default_shipping: true, city: "Other" });
  const after = await local.snapshot();
  await success(host.run(key, input)); expect(await local.snapshot()).toEqual(after);
}, 180_000);

it.each(["billing", "shipping"] as const)("retains only competing %s default identities and restores them through the genuine inverse", async kind => {
  const field = "is_default_" + kind, id = "cuaddr-competing-" + kind;
  const create = await local.addresses.create(), remove = await local.addresses.delete();
  await success(create.run(create.newRequestKey(), { addresses: [{ id, customer_id: accountCustomer, city: "Nondefault" }] }));
  const forward = await local.retained(kind), inverse = await local.retained(kind, true);
  const output = object(await success(forward.run(forward.newRequestKey(), { update: { selector: { id }, update: { [field]: true } } })));
  expect(output.retained).toEqual(["cuaddr-default-selector"]);
  expect((await local.read()).find(row => row.id === "cuaddr-default-selector")?.[field]).toBe(false);
  expect((await local.read()).find(row => row.id === id)?.[field]).toBe(false);
  const key = inverse.newRequestKey(), marker = json(output.retained);
  await success(inverse.run(key, marker));
  expect((await local.read()).find(row => row.id === "cuaddr-default-selector")?.[field]).toBe(true);
  expect((await local.read()).find(row => row.id === "cuaddr-default-foreign")?.[field]).toBe(true);
  const after = await local.snapshot();
  await success(inverse.run(key, marker)); expect(await local.snapshot()).toEqual(after);
  await success(remove.run(remove.newRequestKey(), { ids: [id] }));
}, 180_000);

it.each(["is_default_billing", "is_default_shipping"] as const)("keeps an initially false %s selector from expanding after default replacement", async field => {
  const id = "cuaddr-false-selector-" + field, create = await local.addresses.create(), remove = await local.addresses.delete(), host = await local.addresses.update();
  await success(create.run(create.newRequestKey(), { addresses: [{ id, customer_id: accountCustomer, city: "Initially nondefault" }] }));
  try {
    const key = host.newRequestKey(), input = { selector: { customer_id: accountCustomer, [field]: false }, update: { [field]: true, city: "Selected originally" } };
    expect(await success(host.run(key, input))).toMatchObject([{ id, [field]: true, city: "Selected originally" }]);
    expect((await local.read()).find(row => row.id === "cuaddr-default-selector")?.[field]).toBe(false);
    const after = await local.snapshot();
    await success(host.run(key, input)); expect(await local.snapshot()).toEqual(after);
  } finally {
    await success(host.run(host.newRequestKey(), { selector: { id: "cuaddr-default-selector" }, update: { [field]: true } }));
    await success(remove.run(remove.newRequestKey(), { ids: [id] }));
  }
}, 180_000);

const metadataCases: ReadonlyArray<{ label: string; before: JsonObject | null; patch: JsonObject; after: JsonObject }> = [
  { label: "added, removed, nested and empty-string keys", before: { old: 1, removed: true, empty: "", nested: { before: true } },
    patch: { old: 3, removed: "", added: 2, nested: { after: true } }, after: { old: 3, empty: "", added: 2, nested: { after: true } } },
  { label: "an empty object", before: {}, patch: { added: 2 }, after: { added: 2 } },
  { label: "null", before: null, patch: { added: 2 }, after: { added: 2 } },
];
it.each(metadataCases)("restores exact retained metadata for $label, including inverse rollback and replay", async ({ before, patch, after }) => {
  const id = "cuaddr-retained-metadata-" + (before === null ? "null" : Object.keys(before).length === 0 ? "empty" : "full");
  const create = await local.addresses.create(), remove = await local.addresses.delete();
  await success(create.run(create.newRequestKey(), { addresses: [{ id, customer_id: "cus-other-account", city: "Unchanged", metadata: before }] }));
  const forward = await local.retained("update"), inverse = await local.retained("update", true), failedInverse = await local.retained("update", true, true);
  const result = object(await success(forward.run(forward.newRequestKey(), { selector: { id }, update: { metadata: patch } })));
  expect(result.retained).toEqual([{ id, metadata: before }]);
  expect((await local.read()).find(row => row.id === id)?.metadata).toEqual(after);
  const retained = json(result.retained), beforeFailure = await local.snapshot();
  const failure = await Effect.runPromiseExit(failedInverse.run(failedInverse.newRequestKey(), retained));
  expect(Exit.isFailure(failure)).toBe(true);
  if (Exit.isFailure(failure)) expect(Cause.pretty(failure.cause)).toContain("Late retained Customer account inverse failure");
  expect(await local.snapshot()).toEqual(beforeFailure);
  const key = inverse.newRequestKey();
  await success(inverse.run(key, retained));
  const restoredRow = (await local.read()).find(row => row.id === id);
  expect(restoredRow).toMatchObject({ city: "Unchanged", customer_id: "cus-other-account" });
  expect(restoredRow?.metadata).toEqual(before);
  const restored = await local.snapshot();
  await success(inverse.run(key, retained)); expect(await local.snapshot()).toEqual(restored);
  await success(remove.run(remove.newRequestKey(), { ids: [id] }));
}, 180_000);

it("refuses an exact restoration receipt when its native metadata replacement option is removed", async () => {
  const packet = replacementPackets[0];
  if (packet === undefined) throw new Error("Missing genuine native metadata replacement receipt");
  const validate = originalAddressPolicy(local.customer.prepared).validateLogicalCall;
  await success(validate(packet.call, packet.activity));
  const input = { ...object(packet.call.input) }; delete input.options;
  expect(await Effect.runPromise(Effect.result(validate({ ...packet.call, input }, packet.activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
});

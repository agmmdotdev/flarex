import { Result } from "effect";
import { expect, it } from "vitest";
import { StepResponse } from "@medusajs/workflows-sdk";
import { updateCustomerAddressesWorkflow } from "@medusajs/core-flows/customer/update-addresses";

function nativeUpdateNode() {
  const node = Result.getOrThrow(updateCustomerAddressesWorkflow.prepare()).nodes.find(value => value.name === "update-customer-addresses");
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing actual native Address update compensator");
  return { ...node, compensate: node.compensate };
}

function nativeDefaultNode(field: "is_default_billing" | "is_default_shipping") {
  const name = "maybe-unset-default-" + (field === "is_default_billing" ? "billing" : "shipping") + "-customer-addresses";
  const node = Result.getOrThrow(updateCustomerAddressesWorkflow.prepare()).nodes.find(value => value.name === name);
  if (node?.kind !== "step") throw new Error("Missing actual native default-unsetting step");
  return node;
}

it("retains native Address metadata as one scalar in the update compensation preimage", async () => {
  const node = nativeUpdateNode();
  const calls: unknown[] = [];
  const service = {
    listCustomerAddresses: async (...args: unknown[]) => { calls.push(args); return [{ id: "cuaddr-preimage", metadata: { nested: { before: true } } }]; },
    updateCustomerAddresses: async () => [],
  };
  await Reflect.apply(node.invoke, undefined, [{ selector: { id: "cuaddr-preimage" }, update: { metadata: { nested: { replacement: true } } } },
    { eventGroupId: "native-address-preimage", container: { resolve: () => service } }]);
  expect(calls).toEqual([[{ id: "cuaddr-preimage" }, { select: ["metadata"], relations: [] }]]);
});

it("requests exact metadata replacement only for a retained metadata preimage", async () => {
  const node = nativeUpdateNode(), calls: unknown[] = [];
  const service = { updateCustomerAddresses: async (...args: unknown[]) => { calls.push(args); return []; } };
  const before = { id: "cuaddr-preimage", metadata: { old: 1, empty: "" } };
  await Reflect.apply(node.compensate, undefined, [[before], { container: { resolve: () => service } }]);
  expect(calls).toEqual([[before.id, before, undefined, { metadata: "replace" }]]);
  calls.length = 0;
  const scalar = { id: "cuaddr-preimage", city: "Before" };
  await Reflect.apply(node.compensate, undefined, [[scalar], { container: { resolve: () => service } }]);
  expect(calls).toEqual([[scalar.id, scalar]]);
});

it.each(["is_default_billing", "is_default_shipping"] as const)("keeps a selected %s Address stable without unsetting itself", async field => {
  const calls: unknown[] = [], selected = { id: "cuaddr-selected", customer_id: "cus-preimage" };
  const service = {
    listCustomerAddresses: async () => [selected],
    updateCustomerAddresses: async (...args: unknown[]) => { calls.push(args); return []; },
  };
  const response = await Reflect.apply(nativeDefaultNode(field).invoke, undefined, [{ update: { selector: { customer_id: "cus-preimage", [field]: true }, update: { [field]: true } } },
    { container: { resolve: () => service } }]);
  if (!(response instanceof StepResponse)) throw new Error("Missing native default-unsetting response");
  expect(calls).toEqual([]);
  expect(response.compensateInput).toEqual([]);
});

it.each(["is_default_billing", "is_default_shipping"] as const)("unsets another %s default while retaining the selected nondefault Address", async field => {
  const calls: unknown[] = [], selected = { id: "cuaddr-selected", customer_id: "cus-preimage" };
  let read = 0;
  const service = {
    listCustomerAddresses: async () => ++read === 1 ? [selected] : [{ id: "cuaddr-other", customer_id: "cus-preimage" }],
    updateCustomerAddresses: async (...args: unknown[]) => { calls.push(args); return []; },
  };
  const response = await Reflect.apply(nativeDefaultNode(field).invoke, undefined, [{ update: { selector: { id: selected.id }, update: { [field]: true } } },
    { container: { resolve: () => service } }]);
  if (!(response instanceof StepResponse)) throw new Error("Missing native default-unsetting response");
  expect(calls).toEqual([[{ id: ["cuaddr-other"] }, { [field]: false }]]);
  expect(response.compensateInput).toEqual(["cuaddr-other"]);
});

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { createWorkflow, createStep, WorkflowResponse, StepResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { setTaxLinesForItemsStep, type SetTaxLinesForItemsStepInput } from "@medusajs/core-flows/cart/set-tax-lines-for-items-step";
import { createLineItemAdjustmentsStep, type CreateLineItemAdjustmentsCartStepInput } from "@medusajs/core-flows/cart/create-line-item-adjustments-step";
import { createShippingMethodAdjustmentsStep } from "@medusajs/core-flows/cart/create-shipping-method-adjustments-step";
import { removeShippingMethodAdjustmentsStep } from "@medusajs/core-flows/cart/remove-shipping-method-adjustments-step";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { compileCartCreationDefinition } from "../src/modules/cart/creation-schema";
import { makeCartCreationWorkflowCommands } from "../src/modules/cart/refresh-service";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { captureNativeNumericDto } from "../src/value/native-numeric";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepare>>;
async function prepare() {
  const cart = await Effect.runPromise(makeCartCreationWorkflowCommands()), definition = await Effect.runPromise(compileCartCreationDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.cart-creation-refresh", owner: "medusa", writeProfile: "medusa.cart-creation-refresh",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema }, bindings: definition.schema.tables.map(table => ({
      kind: "definition", localName: table.identity.tableId, table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` },
    })) }));
  const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid Cart refresh empty dataset"), hashFailure: cause => new Error("Cart refresh hash", { cause }) }));
  const storage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "cart-refresh-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const read = defineCommerceCommand("cartRefreshRead", "read", Effect.fn(function* (ctx, input) {
    const table = yield* Schema.decodeUnknownEffect(Schema.Literals(definition.schema.tables.map(table => table.identity.tableId)))(input)
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return [...yield* (yield* ctx.table(table)).find(ctx.manager, { take: 256, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [] } })];
  }));
  const reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [read] }));
  cleanup.push(() => Effect.runPromise(reader.close)); await Effect.runPromise(reader.initialize([]));
  const participant = defineAtomicCommerceParticipant("cartCreationRefresh"), roots = {
    create: defineAtomicCommerceCommand("cartRefreshCreateRoot", (ctx, input) => ctx.call(participant, cart.create, input)),
    setTax: defineAtomicCommerceCommand("cartRefreshSetTaxRoot", (ctx, input) => ctx.call(participant, cart.setItemTax, input)),
    setShippingTax: defineAtomicCommerceCommand("cartRefreshSetShippingTaxRoot", (ctx, input) => ctx.call(participant, cart.setShippingTax, input)),
    listTax: defineAtomicCommerceCommand("cartRefreshListTaxRoot", (ctx, input) => ctx.call(participant, cart.listItemTax, input)),
    addAdjustments: defineAtomicCommerceCommand("cartRefreshAddAdjustmentRoot", (ctx, input) => ctx.call(participant, cart.addItemAdjustments, input)),
    removeAdjustments: defineAtomicCommerceCommand("cartRefreshRemoveAdjustmentRoot", (ctx, input) => ctx.call(participant, cart.softDeleteItemAdjustments, input)),
    restoreAdjustments: defineAtomicCommerceCommand("cartRefreshRestoreAdjustmentRoot", (ctx, input) => ctx.call(participant, cart.restoreItemAdjustments, input)),
    addEmptyShippingAdjustments: defineAtomicCommerceCommand("cartRefreshAddEmptyShippingAdjustmentRoot", (ctx, input) => ctx.call(participant, cart.addShippingAdjustments, input)),
    removeEmptyShippingAdjustments: defineAtomicCommerceCommand("cartRefreshRemoveEmptyShippingAdjustmentRoot", (ctx, input) => ctx.call(participant, cart.softDeleteShippingAdjustments, input)),
    restoreEmptyShippingAdjustments: defineAtomicCommerceCommand("cartRefreshRestoreEmptyShippingAdjustmentRoot", (ctx, input) => ctx.call(participant, cart.restoreShippingAdjustments, input)),
    list: defineAtomicCommerceCommand("cartRefreshListRoot", (ctx, input) => ctx.call(participant, cart.list, input)),
  };
  const traces: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const policy = cart.logicalEventPolicy(), event = defineCommerceEventContract({ name: "cartRefreshEvents", revision: "a".repeat(64), internal: true, decode: policy.capture });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: storage, logicalResources: { ...defaultCommerceResources, calls: 512 }, commands: cart.commands,
      events: { contracts: [event], select: () => Effect.succeed(event) }, validateLogicalCall: (call, activity) => Effect.gen(function* () {
        traces.push({ call, activity }); yield* policy.validateLogicalCall(call, activity);
      }) }], events: { producerRevision: "b".repeat(64), subscribers: [{ id: "cartRefreshProbe", revision: "c".repeat(64) }], contracts: [event],
      validate: messages => messages.some(message => !message.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    requestCallLimit: 512, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued", commands: Object.values(roots) }));
  cleanup.push(() => Effect.runPromise(host.close));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition,
      participants: composition.participants.map(registration => ({ ...registration, validateLogicalCall: (call, activity, command) => Effect.gen(function* () {
        traces.push({ call, activity });
        if (registration.validateLogicalCall !== undefined) yield* registration.validateLogicalCall(call, activity, command);
      }) })) }) };
  const nativeTax = createWorkflow("probe-native-cart-tax-preimage", (input: WorkflowData<SetTaxLinesForItemsStepInput>) => new WorkflowResponse(setTaxLinesForItemsStep(input)));
  const nativeAdjustment = createWorkflow("probe-native-cart-adjustment-preimage", (input: WorkflowData<CreateLineItemAdjustmentsCartStepInput>) => new WorkflowResponse(createLineItemAdjustmentsStep(input)));
  const nativeShipping = createWorkflow("probe-native-cart-empty-shipping-preimage", () => {
    createShippingMethodAdjustmentsStep({ shippingMethodAdjustmentsToCreate: [] });
    removeShippingMethodAdjustmentsStep({ shippingMethodAdjustmentIdsToRemove: [] });
    return new WorkflowResponse(null);
  });
  const taxNode = Result.getOrThrow(nativeTax.prepare()).nodes.find(node => node.name === "set-tax-lines-for-items"),
    adjustmentNode = Result.getOrThrow(nativeAdjustment.prepare()).nodes.find(node => node.name === "create-line-item-adjustments"),
    shippingNodes = Result.getOrThrow(nativeShipping.prepare()).nodes;
  if (taxNode?.kind !== "step" || adjustmentNode?.kind !== "step" || shippingNodes.length !== 2 ||
    taxNode.compensate === undefined || adjustmentNode.compensate === undefined) throw new Error("Missing genuine native Cart child callbacks");
  const tax = { invoke: taxNode.invoke, compensate: taxNode.compensate }, adjustment = { invoke: adjustmentNode.invoke, compensate: adjustmentNode.compensate };
  const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: cart.workflow,
    methods: ["listLineItemTaxLines", "listShippingMethodTaxLines", "setLineItemTaxLines", "setShippingMethodTaxLines", "addLineItemAdjustments", "softDeleteLineItemAdjustments",
      "addShippingMethodAdjustments", "softDeleteShippingMethodAdjustments", "restoreShippingMethodAdjustments"], graph: false } }, true));
  const inverseCounts = { tax: 0, adjustment: 0, shipping: 0 };
  const makeNativeInverseProbe = async (kind: "tax" | "adjustment" | "shipping", lateFailure = false) => {
    const step = createStep("probe-native-cart-retained-child-inverse", resources.callback(async (input: Record<string, unknown>, context) => {
      if (kind === "shipping") {
        for (const node of shippingNodes) {
          if (node.kind !== "step" || node.compensate === undefined) throw new Error("Missing genuine empty Shipping callback");
          const response = await node.invoke(node.name === "create-shipping-method-adjustments" ? { shippingMethodAdjustmentsToCreate: [] } : { shippingMethodAdjustmentIdsToRemove: [] }, context);
          if (!(response instanceof StepResponse)) throw new Error("Missing native empty Shipping preimage");
          await node.compensate(response.compensateInput, context);
        }
      } else {
        const native = kind === "tax" ? tax : adjustment, response = await native.invoke(input, context);
        if (!(response instanceof StepResponse)) throw new Error("Missing genuine native child preimage");
        const preimage = Result.getOrThrow(captureNativeNumericDto(response.compensateInput));
        await native.compensate(preimage, context);
      }
      inverseCounts[kind]++;
      if (lateFailure) throw new Error("After genuine native Cart child inverse");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-cart-retained-child-inverse", (input: WorkflowData<Record<string, unknown>>) => new WorkflowResponse(step(input)));
    const probe = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { cart: { module: cart.workflow, logicalStorage: storage,
      logicalResources: { ...defaultCommerceResources, calls: 512 } } }, revision: "d".repeat(64), subscribers: [{ id: "nativeCartChildInverse", revision: "e".repeat(64) }],
      requestCallLimit: 512, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "nativeCartChildInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.JsonObject, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(probe.close)); return probe;
  };
  return { cart, host, roots, traces, makeNativeInverseProbe, inverseCounts,
    read: async (table: string) => Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(reader.read(read, table))) };
}
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(async () => {
  try {
    if (process.env.FLAREX_CART_REFRESH_TRACE !== undefined && typeof connected !== "undefined")
      writeFileSync(process.env.FLAREX_CART_REFRESH_TRACE, JSON.stringify(connected.traces, null, 2));
  } finally { for (const close of cleanup.reverse()) await close(); }
}, 180_000);

it("creates native nullable context and separate exact LineItems through the complete profile", async () => {
  const result = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.create, [{ id: "cart-refresh", currency_code: "usd", email: null,
    shipping_address: { country_code: "us", city: null }, items: [{ id: "cali-refresh", title: "Root line", quantity: 1, unit_price: "9007199254740993.1250",
      product_type: null, product_type_id: null, product_collection: null, metadata: null }] }]));
  expect(result).toMatchObject({ carts: [{ id: "cart-refresh", email: null, items: [], shipping_address: { city: null } }] });
  expect(await connected.read("cart_line_item")).toEqual([expect.objectContaining({ id: "cali-refresh", unit_price: "9007199254740993.1250",
    raw_unit_price: { value: "9007199254740993.1250", precision: 20 } })]);
});

it("admits the genuine root transient fields without storing or presenting either field", async () => {
  const input = [{ id: "cart-root-transients", currency_code: "usd", promo_codes: ["NATIVE"], additional_data: { marker: "workflow-only" },
    metadata: { retained: true }, shipping_address: { country_code: "us" } }];
  const key = connected.host.newRequestKey(), result = await Effect.runPromise(connected.host.run(key, connected.roots.create, input));
  expect(result).toMatchObject({ carts: [{ id: "cart-root-transients", metadata: { retained: true } }] });
  expect(result).not.toHaveProperty("carts.0.promo_codes");
  expect(result).not.toHaveProperty("carts.0.additional_data");
  for (const table of ["cart", "cart_address", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"])
    for (const row of await connected.read(table)) {
      expect(row).not.toHaveProperty("promo_codes"); expect(row).not.toHaveProperty("additional_data");
    }
  expect(await Effect.runPromise(connected.host.run(key, connected.roots.create, input))).toEqual(result);
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.host.run(key, connected.roots.create,
    [{ ...input[0], additional_data: { marker: "changed-workflow-identity" } }])))).toBe(true);
});

it("executes native fresh Tax replacement, selected preimage reads and actual soft deletion", async () => {
  const run = (rate: number) => Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.setTax,
    { cart_id: "cart-refresh", tax_lines: [{ item_id: "cali-refresh", code: "VAT", rate, description: null, provider_id: null, tax_rate_id: null }] }));
  const first = await run(7.25);
  expect(first).toEqual([expect.objectContaining({ code: "VAT", rate: 7.25, description: null })]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.listTax, { item_id: ["cali-refresh"] }))).toEqual(first);
  const second = await run(8.5);
  expect(second).toEqual([expect.objectContaining({ code: "VAT", rate: 8.5 })]);
  const stored = await connected.read("cart_line_item_tax_line");
  expect(stored).toHaveLength(2);
  expect(stored.filter(row => row.deleted_at === null)).toEqual([expect.objectContaining({ rate: 8.5 })]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.setTax, { cart_id: "cart-refresh", tax_lines: [] }))).toEqual([]);
  expect((await connected.read("cart_line_item_tax_line")).every(row => typeof row.deleted_at === "string")).toBe(true);
});

it("retains real empty Shipping Tax parent/child reads and has no fabricated writes", async () => {
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.setShippingTax, { cart_id: "cart-refresh", tax_lines: [] }))).toEqual([]);
  const trace = connected.traces.findLast(trace => trace.call.commandName === "cartSetShippingTaxForCreation");
  expect(trace?.activity.relationalReads.map(read => read.table)).toEqual(["cart_shipping_method", "cart_shipping_method_tax_line"]);
  expect(trace?.activity.mutations).toEqual([]);
  expect(trace?.call.events).toEqual([]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.addEmptyShippingAdjustments, []))).toEqual([]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.removeEmptyShippingAdjustments, []))).toEqual({});
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.restoreEmptyShippingAdjustments, []))).toEqual({});
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), connected.roots.addEmptyShippingAdjustments,
    [{ shipping_method_id: "unreachable", amount: 1 }])))).toBe(true);
});

it("creates exact native adjustments and retains actual generated lifecycle maps, receipt refusal and replay", async () => {
  const key = connected.host.newRequestKey(), input = [{ item_id: "cali-refresh", amount: "9007199254740993.1250", code: "EXACT", promotion_id: null, is_tax_inclusive: true,
    metadata: { raw_amount: { value: "1.2300", precision: 20 } } }];
  const created = await Effect.runPromise(connected.host.run(key, connected.roots.addAdjustments, input));
  expect(await Effect.runPromise(connected.host.run(key, connected.roots.addAdjustments, input))).toEqual(created);
  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, raw_amount: Schema.Struct({ value: Schema.String }) })))(created);
  expect(rows[0]?.raw_amount.value).toBe("9007199254740993.125");
  expect(created).toEqual([expect.objectContaining({ metadata: input[0]?.metadata })]);
  const ids = rows.map(row => row.id), deleted = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.removeAdjustments, ids));
  expect(deleted).toEqual({ line_item_adjustment_id: ids });
  const restored = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.restoreAdjustments, ids));
  expect(restored).toEqual({ line_item_adjustment_id: ids });
  expect((await connected.read("cart_line_item_adjustment"))[0]).toMatchObject({ deleted_at: null, amount: "9007199254740993.1250" });
  const rawOnly = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ items: Schema.Array(Schema.JsonObject) })))(
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.list, { filters: { id: "cart-refresh" },
      config: { select: ["id", "items.id", "items.raw_unit_price", "items.adjustments.raw_amount"], relations: ["items.adjustments"] } })));
  expect(rawOnly[0]?.items[0]).toMatchObject({ raw_unit_price: { value: "9007199254740993.125", precision: 20 },
    adjustments: [expect.objectContaining({ raw_amount: { value: "9007199254740993.125", precision: 20 } })] });
  expect(rawOnly[0]?.items[0]).not.toHaveProperty("unit_price");
  expect(Schema.decodeUnknownSync(Schema.Struct({ adjustments: Schema.Array(Schema.JsonObject) }))(rawOnly[0]?.items[0]).adjustments[0]).not.toHaveProperty("amount");
  const trace = connected.traces.findLast(trace => trace.call.commandName === "cartAddItemAdjustmentsForCreation");
  if (trace === undefined) throw new Error("Missing genuine native adjustment trace");
  const tampered = await Effect.runPromiseExit(connected.cart.logicalEventPolicy().validateLogicalCall({ ...trace.call,
    result: [{ ...Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(trace.call.result)[0], amount: 0 }] }, trace.activity));
  expect(Exit.isFailure(tampered)).toBe(true);
  const dto = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(trace.call.result)[0];
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.cart.logicalEventPolicy().validateLogicalCall({ ...trace.call,
    result: [{ ...dto, raw_amount: { value: "9007199254740993.1250", precision: 20 } }] }, trace.activity)))).toBe(true);
});

it("executes genuine native Tax preimages and retained inverse before commit and before forced rollback", async () => {
  await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.setTax,
    { cart_id: "cart-refresh", tax_lines: [{ item_id: "cali-refresh", code: "OLD", rate: 3, description: null, provider_id: null, tax_rate_id: null }] }));
  const [cart] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roots.list,
    { filters: { id: "cart-refresh" }, config: { select: ["id", "items.id", "items.tax_lines.id", "items.tax_lines.code", "items.tax_lines.rate"], relations: ["items.tax_lines"] } })));
  if (cart === undefined) throw new Error("Missing genuine selected Cart for native Tax callback");
  const input = { cart, item_tax_lines: [{ line_item_id: "cali-refresh", code: "NEW", rate: 9, name: "Native Tax" }], shipping_tax_lines: [] };
  const probe = await connected.makeNativeInverseProbe("tax");
  expect(await Effect.runPromise(probe.run(probe.newRequestKey(), input))).toBeNull();
  expect(connected.inverseCounts.tax).toBe(1);
  expect((await connected.read("cart_line_item_tax_line")).filter(row => row.deleted_at === null)).toEqual([expect.objectContaining({ code: "OLD", rate: 3 })]);
  const retained = connected.traces.findLast(trace => trace.call.commandName === "cartSetItemTaxForCreation");
  if (retained === undefined) throw new Error("Missing genuine native Tax inverse trace");
  const selected = new Set(retained.activity.relationalReads.flatMap(read => read.table === "cart_line_item_tax_line"
    ? (read.orderedIdentities ?? []).map(identity => identity.id) : [])), changed = new Set(retained.activity.mutations.map(mutation => mutation.after?.id));
  const excluded = retained.activity.observedRows.find(observation => observation.table === "cart_line_item_tax_line" &&
    typeof observation.row.deleted_at === "string" && !selected.has(observation.row.id) && !changed.has(observation.row.id));
  if (excluded === undefined) throw new Error("Missing actual excluded pending Tax cohort member");
  for (const patch of [{ item_id: "cali-outside-parent" }, { deleted_at: null }]) {
    expect(Exit.isFailure(await Effect.runPromiseExit(connected.cart.logicalEventPolicy().validateLogicalCall(retained.call,
      { ...retained.activity, observedRows: retained.activity.observedRows.map(observation => observation === excluded
        ? { ...observation, row: { ...observation.row, ...patch } } : observation) })))).toBe(true);
  }
  const before = await connected.read("cart_line_item_tax_line"), failure = await connected.makeNativeInverseProbe("tax", true);
  expect(Exit.isFailure(await Effect.runPromiseExit(failure.run(failure.newRequestKey(), input)))).toBe(true);
  expect(connected.inverseCounts.tax).toBe(2);
  expect(await connected.read("cart_line_item_tax_line")).toEqual(before);
});

it("executes genuine native Adjustment and empty Shipping retained compensators", async () => {
  const probe = await connected.makeNativeInverseProbe("adjustment"), before = await connected.read("cart_line_item_adjustment");
  expect(await Effect.runPromise(probe.run(probe.newRequestKey(), { lineItemAdjustmentsToCreate: [{ item_id: "cali-refresh", code: "NATIVE_INVERSE",
    amount: "9007199254740993.1250" }] }))).toBeNull();
  expect(connected.inverseCounts.adjustment).toBe(1);
  const added = (await connected.read("cart_line_item_adjustment")).filter(row => !before.some(prior => prior.id === row.id));
  expect(added).toEqual([expect.objectContaining({ amount: "9007199254740993.1250", raw_amount: { value: "9007199254740993.1250", precision: 20 }, deleted_at: expect.any(String) })]);
  const shipping = await connected.makeNativeInverseProbe("shipping");
  expect(await Effect.runPromise(shipping.run(shipping.newRequestKey(), {}))).toBeNull();
  expect(connected.inverseCounts.shipping).toBe(1);
});

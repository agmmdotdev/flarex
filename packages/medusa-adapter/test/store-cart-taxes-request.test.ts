import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import SystemTaxService from "@medusajs/tax/providers/system";
import { CartModuleService } from "@medusajs/cart/services";
import { FeatureFlag } from "@medusajs/framework/utils/portable";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { setTaxLinesForItemsStep, type SetTaxLinesForItemsStepInput } from "@medusajs/core-flows/cart/set-tax-lines-for-items-step";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import { prepareCartTaxesWorkflow } from "../src/workflows/cart/taxes";
import { cartCreationResources } from "../src/workflows/cart/create-owned";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost } from "../src/workflow/host";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { captureNativeNumericDto } from "../src/value/native-numeric";
import { cartCreationModuleNames } from "../src/workflows/cart/creation-graph";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storeCartTaxSeedRows } from "./support/store-cart-request-catalog";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const isCartTaxEvent = Schema.is(Schema.Struct({ metadata: Schema.Struct({ source: Schema.Literal("cart"), object: Schema.Literal("line_item_tax_line"), action: Schema.String }),
  data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => { tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storeCartTaxSeedRows }); }, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 60_000);

async function request(id: string, options: Readonly<{ value?: unknown; key?: string; query?: string; method?: "GET" | "POST" }> = {}) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes, admitCartRefetchFields: runtime.admitCartRefetchFields });
    const method = options.method ?? "POST";
    const response = yield* Effect.promise(() => http.handle(new Request(`https://store.test/store/carts/${id}${method === "GET" ? "" : "/taxes"}${options.query ?? ""}`, {
      method, headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken },
      ...(method === "GET" ? {} : { body: JSON.stringify(options.value ?? {}) }),
    })));
    return { status: response.status, value: yield* Effect.promise(() => response.json()) };
  }));
}
const modules = () => Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(cartCreationModuleNames.map(name =>
  [name, { module: tested.catalog.runtimes.workflows[name], nativeStorage: tested.fixture.source(name) }])), cartCreationModuleNames));
const prepare = () => Effect.runPromise(prepareCartTaxesWorkflow({ execution: tested.fixture.execution, modules: modules(),
  salesChannelRead: tested.catalog.runtimes.salesChannelRead, revision: "5".repeat(64), subscribers: [{ id: "native-cart-tax-replay", revision: "6".repeat(64) }] }));

it("forces native Tax despite the manual Region, refetches totals and retains Payment without a Cart workflow event", async () => {
  const before = await tested.fixture.snapshot(), payment = await tested.fixture.readRows("payment");
  const tax = vi.spyOn(SystemTaxService.prototype, "getTaxLines");
  try {
    for (let index = 0; index < 2; index++) {
      const response = await request("cart-http-tax-manual", { value: index === 0 ? { fields: "unsupported.body.field" } : {} });
      expect(response.status, JSON.stringify(response.value)).toBe(200);
      expect(decodeCart(response.value).cart).toMatchObject({ id: "cart-http-tax-manual", subtotal: 12.5, tax_total: 1.25, total: 13.75,
        region: { id: "reg-http-tax-manual", automatic_taxes: false },
        items: [{ tax_lines: [{ code: "NATIVE-US", rate: 10, provider_id: "system" }] }],
        payment_collection: { id: "paycol-http-tax-manual", amount: 12.5, payment_sessions: [{ id: "payses-http-tax-manual", amount: 12.5 }] } });
    }
    expect(tax).toHaveBeenCalled();
    expect(await tested.fixture.readRows("payment")).toEqual(payment);
    const after = await tested.fixture.snapshot(), history = after.rows.filter(row => row.value.item_id === "line-http-tax-manual");
    expect(history).toHaveLength(3);
    expect(history.filter(row => row.value.deleted_at === null)).toEqual([expect.objectContaining({ value: expect.objectContaining({ code: "NATIVE-US", rate: 10 }) })]);
    const events = after.events.slice(before.events.length);
    expect(events.filter(event => !event.envelope.internal)).toEqual([]);
    expect(events.filter(event => event.envelope.contract === "cart.updated")).toEqual([]);
    const messages = events.map(event => event.envelope.message);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ source: "cart", object: "line_item_tax_line", action: "created" }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ source: "cart", object: "line_item_tax_line", action: "deleted" }) }),
    ]));
    for (const action of ["created", "deleted"]) {
      const ids = messages.filter(isCartTaxEvent).filter(message => message.metadata.action === action)
        .flatMap(message => typeof message.data.id === "string" ? [message.data.id] : message.data.id).sort();
      const expected = history.filter(row => action === "created" ? row.value.id !== "tax-http-stale-manual" : row.value.deleted_at !== null)
        .map(row => row.value.id).sort();
      expect(ids).toEqual(expected);
    }
    expect(after.outcomes).toHaveLength(before.outcomes.length + 2);
    const fetched = await request("cart-http-tax-manual", { method: "GET" });
    expect(fetched.status).toBe(200); expect(decodeCart(fetched.value).cart.total).toBe(13.75);
  } finally { tax.mockRestore(); }
});

it("retains native forced-country, empty Cart, missing Cart and fetched completed-field behavior", async () => {
  const tax = vi.spyOn(SystemTaxService.prototype, "getTaxLines");
  try {
    for (const id of ["cart-http-tax-no-country", "cart-http-tax-no-country-item"]) {
      const before = await tested.fixture.snapshot(), response = await request(id);
      expect(response.status, JSON.stringify(response.value)).toBe(400);
      expect(response.value).toMatchObject({ message: expect.stringContaining("country code is required") });
      expect(await tested.fixture.snapshot()).toEqual(before);
    }
    const empty = await request("cart-http-tax-empty", { query: "?fields=id,total" });
    expect(empty.status, JSON.stringify(empty.value)).toBe(200);
    expect(decodeCart(empty.value).cart).toEqual({ id: "cart-http-tax-empty", total: 0, raw_total: { value: "0", precision: 20 } });
    expect(tax).not.toHaveBeenCalled();
    const missingBefore = await tested.fixture.snapshot(), missing = await request("cart-http-tax-missing");
    expect(missing.status, JSON.stringify(missing.value)).toBe(404); expect(await tested.fixture.snapshot()).toEqual(missingBefore);
    // The genuine workflow's fixed fetch selection omits completed_at.
    const completed = await request("cart-http-tax-completed");
    expect(completed.status, JSON.stringify(completed.value)).toBe(200);
    expect(decodeCart(completed.value).cart).toMatchObject({ completed_at: "2026-01-01T00:00:00.000Z", total: 13.75 });
  } finally { tax.mockRestore(); }
});

it("rejects invalid keys, native body fields and unsupported refetch projections before writes", async () => {
  const before = await tested.fixture.snapshot();
  for (const options of [{ key: storeCartRevokedToken }, { value: { fields: 42 } }, { value: { cart_id: "forged", force_tax_calculation: false } },
    { query: "?fields=id,unsupported" }]) expect((await request("cart-http-tax-failure", options)).status).toBe(400);
  expect(await tested.fixture.snapshot()).toEqual(before);
  const root = await prepare();
  try {
    for (const input of [{ cart_id: "cart-http-tax-failure", force_tax_calculation: false },
      { cart_id: "cart-http-tax-failure", force_tax_calculation: true, cart: { id: "forged" } }])
      expect(Result.isFailure(root.decodeInput(input))).toBe(true);
  } finally { await Effect.runPromise(root.close); }
  const translation = FeatureFlag.isFeatureEnabled("translation");
  FeatureFlag.setFlag("translation", true);
  try { expect(Exit.isFailure(await Effect.runPromiseExit(prepareCartTaxesWorkflow({ execution: tested.fixture.execution, modules: modules(),
    salesChannelRead: tested.catalog.runtimes.salesChannelRead, revision: "5".repeat(64), subscribers: [] })))).toBe(true); }
  finally { FeatureFlag.setFlag("translation", translation); }
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("rolls back genuine Tax provider failure and a later failure after pending native item Tax writes", async () => {
  const before = await tested.fixture.snapshot(), logger = vi.spyOn(storeCartLogger, "error").mockImplementation(() => undefined);
  const provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines").mockRejectedValueOnce(new Error("native-cart-tax-provider-failure"));
  try {
    expect((await request("cart-http-tax-failure")).status).toBe(500);
    expect(provider).toHaveBeenCalledTimes(1); expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { provider.mockRestore(); logger.mockRestore(); }
  let itemWritten = false, lateFailure = false;
  const nativeItem = CartModuleService.prototype.setLineItemTaxLines;
  const item = vi.spyOn(CartModuleService.prototype, "setLineItemTaxLines").mockImplementation(async function (this: CartModuleService, ...args) {
    const result = await Reflect.apply(nativeItem, this, args); itemWritten = true; return result;
  });
  const nativeShipping = CartModuleService.prototype.setShippingMethodTaxLines;
  const shipping = vi.spyOn(CartModuleService.prototype, "setShippingMethodTaxLines").mockImplementation(async function (this: CartModuleService, ...args) {
    await Reflect.apply(nativeShipping, this, args);
    if (!itemWritten) throw new Error("Late Tax probe ran before the native item write");
    lateFailure = true;
    throw new Error("native-cart-tax-after-item-write");
  });
  try {
    expect((await request("cart-http-tax-failure")).status).toBe(500);
    expect(itemWritten).toBe(true); expect(lateFailure).toBe(true); expect(item).toHaveBeenCalledTimes(1); expect(shipping).toHaveBeenCalledTimes(1);
    expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { item.mockRestore(); shipping.mockRestore(); }
});

it("recovers lost root acknowledgement and replays the same key without recalculating or duplicating events", async () => {
  const root = await prepare(), tax = vi.spyOn(SystemTaxService.prototype, "getTaxLines");
  try {
    const key = root.newRequestKey(), fault = tested.fixture.loseNextNativeRootAcknowledgement();
    const args = Result.getOrThrow(root.decodeInput({ cart_id: "cart-http-tax-replay", force_tax_calculation: true }));
    expect(await Effect.runPromise(root.run(key, args))).toBeNull();
    expect(fault).toMatchObject({ armed: false, failures: 1 }); expect(tax).toHaveBeenCalled();
    const calls = tax.mock.calls.length, before = await tested.fixture.snapshot();
    expect(await Effect.runPromise(root.run(key, args))).toBeNull();
    expect(tax).toHaveBeenCalledTimes(calls); expect(await tested.fixture.snapshot()).toEqual(before);
    expect(Exit.isFailure(await Effect.runPromiseExit(root.run(key, { ...args, cart_id: "cart-http-tax-manual" })))).toBe(true);
    expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { tax.mockRestore(); await Effect.runPromise(root.close); }
});

it("executes the genuine retained Tax inverse, recreating prior values with new identities", async () => {
  const installed = modules(), cart = installed.cart;
  const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: tested.catalog.runtimes.workflows.cart, graph: false,
    methods: ["listLineItemTaxLines", "listShippingMethodTaxLines", "setLineItemTaxLines", "setShippingMethodTaxLines"] } }, true));
  const native = createWorkflow("http-tax-native-inverse-source", (input: WorkflowData<SetTaxLinesForItemsStepInput>) => new WorkflowResponse(setTaxLinesForItemsStep(input)));
  const node = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "set-tax-lines-for-items");
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native Tax retained inverse");
  const inverse = node.compensate;
  let inverses = 0;
  const step = createStep("http-tax-native-inverse", resources.callback(async (input: typeof Schema.JsonObject.Type, context) => {
    const response = await node.invoke(input, context);
    if (!(response instanceof StepResponse)) throw new Error("Missing native Tax preimage");
    await inverse(Result.getOrThrow(captureNativeNumericDto(response.compensateInput)), context); inverses++;
    return new StepResponse(null);
  }));
  const flow = createWorkflow("http-tax-native-inverse", (input: WorkflowData<typeof Schema.JsonObject.Type>) => new WorkflowResponse(step(input)));
  const root = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: tested.fixture.execution,
    modules: { cart: { ...cart, logicalResources: cartCreationResources } }, requestCallLimit: 512,
    revision: "7".repeat(64), subscribers: [{ id: "native-cart-tax-inverse", revision: "8".repeat(64) }],
    executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "nativeCartTaxInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.JsonObject, output: Schema.Null,
      events: internalModuleWorkflowEvents } }));
  try {
    const args = { cart: { id: "cart-http-tax-failure" }, item_tax_lines: [{ line_item_id: "line-http-tax-failure", code: "TEMPORARY", rate: 9, name: "Inverse probe" }], shipping_tax_lines: [] };
    expect(await Effect.runPromise(root.run(root.newRequestKey(), args))).toBeNull(); expect(inverses).toBe(1);
    const rows = (await tested.fixture.snapshot()).rows.filter(row => row.value.item_id === "line-http-tax-failure");
    const active = rows.filter(row => row.value.deleted_at === null);
    expect(active).toEqual([expect.objectContaining({ value: expect.objectContaining({ code: "STALE", rate: 0, provider_id: "tp_system" }) })]);
    expect(active[0]?.value.id).not.toBe("tax-http-stale-failure");
    expect(rows.some(row => row.value.code === "TEMPORARY" && typeof row.value.deleted_at === "string")).toBe(true);
  } finally { await Effect.runPromise(root.close); }
});

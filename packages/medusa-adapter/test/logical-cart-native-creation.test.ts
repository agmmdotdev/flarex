import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createWorkflow, createStep, transform, WorkflowResponse, StepResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createCartsStep } from "@medusajs/core-flows/cart/create-carts-step";
import { updateCartsStep } from "@medusajs/core-flows/cart/update-carts-step";
import { CartModuleService } from "@medusajs/cart/services";
import { CartCreates, CartCreationReceipt } from "../src/modules/cart/creation-input";
import { prepareOwnedCartCreationWorkflow, cartCreationResources } from "../src/workflows/cart/create-owned";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import type { DAL } from "@medusajs/framework/types";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { withCommerceService } from "../src/module/service-bridge";
import { captureCommerceInput } from "../src/value/input";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { captureCartCreationEvent } from "../src/modules/cart/creation-receipt";
import { makeCartCreationCommands } from "../src/modules/cart/creation-service";
import { prepareCoreCartFixture } from "./support/core-cart-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const CompletionInput = Schema.Struct({ id: Schema.String, completed_at: Schema.String });
const cleanup: Array<() => Promise<void>> = [];
const participant = defineAtomicCommerceParticipant("cartCreation");
let connected: Awaited<ReturnType<typeof prepare>>;
async function prepare() {
  const local = await prepareCoreCartFixture(driver, close => cleanup.push(close), []);
  const { fixture } = local, { execution } = local.options;
  const nativeStorage = fixture.source("cart"), cart = await Effect.runPromise(makeCartCreationCommands());
  const decodeTable = Schema.decodeUnknownEffect(Schema.Literals(local.cartDefinition.tables.map(table => table.localName ?? table.name)));
  const read = defineCommerceCommand("cartCreationRead", "read", Effect.fn(function* (ctx, input) {
    const table = yield* decodeTable(input)
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return [...yield* (yield* ctx.table(table)).find(ctx.manager, { take: 256, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [] } })];
  }));
  const budgetReads = new Map<string, { reference: number; serializer: number }>();
  let getterCalls = 0, statefulArrayReads = 0, stableArrayReads = 0, singletonReads = 0, closedSerializer: DAL.RepositoryService["serialize"] | undefined;
  const serializeProbe = defineCommerceCommand("cartCreationSerializeProbe", "read", Effect.fn(function* (ctx, input) {
    const mode = yield* Schema.decodeUnknownEffect(Schema.Literals(["reorder", "clone", "getter", "mixed", "empty", "close", "proxy", "proxy-stable", "issued-clone", "singleton-proxy", "combined", "over-bound", "over-bound-extra", "over-bound-issued"]))(input)
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return yield* withCommerceService(ctx, owner => cart.prepared.bind(ctx, owner), async bound => {
      if (mode === "close") { closedSerializer = bound.repository.serialize; return null; }
      const shared = { transactionManager: ctx.manager }, proxyMode = ["proxy", "proxy-stable", "issued-clone", "singleton-proxy", "combined"].includes(mode),
        budgetMode = ["over-bound", "over-bound-extra", "over-bound-issued"].includes(mode),
        rows = await bound.repository.find(buildQuery({ id: [budgetMode ? "cart-native-budget" : proxyMode ? "cart-native-origin" : "cart-native-serialize"] }, {}), shared);
      if (budgetMode) {
        const issued: unknown = rows[0];
        if (issued === null || typeof issued !== "object" || Array.isArray(issued)) throw new Error("Missing genuine bounded Cart row");
        const counts = { reference: 0, serializer: 0 }; budgetReads.set(mode, counts);
        let reference = true;
        const target = mode === "over-bound-extra" ? rows.slice(0, 0) : rows;
        const values = new Proxy(target, { getOwnPropertyDescriptor(value, key) {
          if (reference) counts.reference++; else counts.serializer++;
          return Reflect.getOwnPropertyDescriptor(value, key);
        } });
        if (mode === "over-bound-issued") bound.remember(values);
        for (let index = 0; index <= ctx.resources.valueNodes; index++) {
          if (mode === "over-bound-extra") Object.defineProperty(target, "extra-" + index, { value: true, enumerable: true });
          else if (index > 0) target.push(issued);
        }
        const expected = captureCommerceInput(values, ctx.resources);
        if (!Result.isFailure(expected) || expected.failure.reason !== "limitExceeded") throw new Error("Existing value owner did not enforce its node budget");
        reference = false;
        return bound.repository.serialize(values);
      }
      if (proxyMode) {
        const issued: unknown = rows[0];
        if (issued === null || typeof issued !== "object" || Array.isArray(issued)) throw new Error("Missing genuine issued Cart row");
        if (mode === "combined") {
          const other = await bound.repository.find(buildQuery({ id: ["cart-native-origin-other"] }, {}), shared);
          return bound.repository.serialize([...rows, ...other]);
        }
        if (mode === "issued-clone") {
          rows[0] = { ...issued, id: "cart-replaced-member", currency_code: "eur" };
          return bound.repository.serialize(rows);
        }
        if (mode === "singleton-proxy") {
          singletonReads = 0;
          return bound.repository.serialize(new Proxy(issued, {
            getOwnPropertyDescriptor(target, key) { singletonReads++; return Reflect.getOwnPropertyDescriptor(target, key); },
          }));
        }
        const forged = { ...issued, id: "cart-forged-proxy", currency_code: "eur" };
        if (mode === "proxy") statefulArrayReads = 0; else stableArrayReads = 0;
        const values = new Proxy([issued], {
          getOwnPropertyDescriptor(target, key) {
            const property = Reflect.getOwnPropertyDescriptor(target, key);
            if (key !== "0" || property === undefined) return property;
            if (mode === "proxy") { statefulArrayReads++; return { ...property, value: statefulArrayReads === 1 ? forged : issued }; }
            stableArrayReads++; return property;
          },
        });
        return bound.repository.serialize(values);
      }
      if (mode === "empty") return bound.repository.serialize([]);
      if (mode === "mixed") {
        const [lines] = await bound.lineItemRepository.findAndCount(buildQuery({ id: ["cali-native-serialize"] }, {}), shared);
        return bound.repository.serialize([rows[0], lines[0]]);
      }
      if (mode === "getter") {
        const values = [rows[0]]; Object.defineProperty(values, "0", { get: () => { getterCalls++; return rows[0]; } });
        return bound.repository.serialize(values);
      }
      return bound.repository.serialize(mode === "clone" ? structuredClone(rows) : [...rows]);
    });
  }));
  const reader = await fixture.run(fixture.openReadHost("cart", [read, serializeProbe]));
  cleanup.push(() => Effect.runPromise(reader.close));
  const create = defineAtomicCommerceCommand("cartCreationRoot", (ctx, input) => ctx.call(participant, cart.create, input));
  const inverse = defineAtomicCommerceCommand("cartCreationInverseRoot", (ctx, input) => ctx.call(participant, cart.compensate, input));
  const roundtrip = defineAtomicCommerceCommand("cartCreationRoundtrip", (ctx, input) => Effect.gen(function* () {
    const created = yield* ctx.call(participant, cart.create, input);
    const value = yield* Schema.decodeUnknownEffect(Schema.Struct({ receipt: Schema.Struct({ operation_id: Schema.String }) }))(created)
      .pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
    return yield* ctx.call(participant, cart.compensate, value.receipt);
  }));
  // This low-level module probe executes the same closed production receipt
  // policy that the genuine native step receives through its workflow module.
  const event = defineCommerceEventContract({ name: "cartCreationBoundaryEvents", revision: "c".repeat(64), internal: true, decode: captureCartCreationEvent });
  const traces: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const validateCreation = cart.logicalEventPolicy().validateLogicalCall;
  const prepareProbe = async (executionIsolation?: "scopeExclusive") => {
    const host = await fixture.run(execution.prepare({ identityAndAccessPolicy: execution.identityAndAccessPolicy,
      participants: [{ participant, nativeStorage, logicalResources: cartCreationResources, commands: cart.commands,
        events: { contracts: [event], select: () => Effect.succeed(event) },
        validateLogicalCall: Effect.fn("CartCreationTest.observeReceipt")(function* (call, activity) {
          traces.push({ call, activity });
          yield* validateCreation(call, activity);
        }) }],
      events: { producerRevision: "c".repeat(64), subscribers: [{ id: "cartCreationBoundaryProbe", revision: "d".repeat(64) }], contracts: [event],
        validate: messages => messages.some(message => !message.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
      requestCallLimit: cartCreationResources.calls, commands: [create, inverse, roundtrip],
      ...(executionIsolation === undefined ? {} : { executionIsolation }) }));
    cleanup.push(() => Effect.runPromise(host.close));
    return host;
  };
  const host = await prepareProbe("scopeExclusive");
  const modules = { cart: { module: cart.workflow, nativeStorage } }, revision = "e".repeat(64),
    subscribers = [{ id: "nativeCartCreation", revision: "f".repeat(64) }];
  const native = await Effect.runPromise(prepareOwnedCartCreationWorkflow({ execution, modules, revision, subscribers }));
  cleanup.push(() => Effect.runPromise(native.close));
  const prepareCompletion = async () => {
    const flow = createWorkflow("native-created-cart-completion", (input: WorkflowData<typeof CompletionInput.Type>) =>
      new WorkflowResponse(updateCartsStep(transform(input, value => [value]))));
    const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: local.cart.workflow,
      methods: ["listCarts", "updateCarts", "listAddresses", "updateAddresses"], graph: false } }, true));
    const completion = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options, modules: local.modules,
      workflow: { name: "nativeCreatedCartCompletion", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: CompletionInput, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(completion.close));
    return completion;
  };
  const original = createWorkflow("probe-native-cart-create-callback", (input: WorkflowData<typeof CartCreates.Type>) => new WorkflowResponse(createCartsStep(input)));
  const retained = Result.getOrThrow(original.prepare()).nodes.find(node => node.name === "create-carts");
  if (retained?.kind !== "step" || retained.compensate === undefined || retained.compensation !== "transactionCovered") throw new Error("Missing genuine Cart retained inverse");
  const nativeInverse = retained.compensate;
  let inverseCompleted = 0;
  const prepareInverse = async (lateFailure = false) => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: cart.workflow,
      methods: ["createCartsWithOwnership", "compensateCartsCreation"], graph: false } }, true));
    const undo = createStep("probe-native-cart-retained-inverse", resources.callback(async (receipt: typeof CartCreationReceipt.Type, context) => {
      await nativeInverse(receipt, context); inverseCompleted++;
      if (lateFailure) throw new Error("Late native Cart inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-cart-retained-inverse", (receipt: WorkflowData<typeof CartCreationReceipt.Type>) => new WorkflowResponse(undo(receipt)));
    const inverseHost = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
      modules: { cart: { ...modules.cart, logicalResources: cartCreationResources } }, revision, subscribers,
      requestCallLimit: cartCreationResources.calls, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeCartRetainedInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: CartCreationReceipt, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(inverseHost.close)); return inverseHost;
  };
  return { host, reader, create, inverse, roundtrip, traces, native, prepareInverse, prepareProbe, prepareCompletion,
    snapshot: fixture.snapshot, cartDefinition: local.cartDefinition,
    inverseCompleted: () => inverseCompleted, cart, serializeProbe, budgetReads: (mode: string) => budgetReads.get(mode), getterCalls: () => getterCalls, descriptorReads: () => ({ statefulArrayReads, stableArrayReads, singletonReads }),
    serializeAfterClose: () => { if (closedSerializer === undefined) throw new Error("No captured closed serializer"); return closedSerializer([]); },
    events: async () => (await fixture.snapshot()).events.map(event => event.envelope),
    read: (table: string) => Effect.runPromise(reader.read(read, table)) };
}
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(async () => {
  try {
    if (process.env.FLAREX_CART_CREATION_TRACE !== undefined && typeof connected !== "undefined")
      writeFileSync(process.env.FLAREX_CART_CREATION_TRACE, JSON.stringify({ calls: connected.traces, committedEvents: await connected.events() }, null, 2));
  } finally { await finishOrderFixture(cleanup.reverse()); }
}, 180_000);

it("runs genuine native creation, its separate Line Item call and retained ownership inverse", async () => {
  const result = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create, [{ id: "cart-native-owned", currency_code: "usd",
    shipping_address: { country_code: "us", city: "Shipping" }, billing_address: { country_code: "us", city: "Billing" },
    items: [{ id: "cali-native-owned", title: "Exact native line", quantity: 1, unit_price: "9007199254740993.1250" }],
  }]));
  const value = Schema.decodeUnknownSync(Schema.Struct({ carts: Schema.Array(Schema.JsonObject), receipt: Schema.Struct({ operation_id: Schema.String }) }))(result);
  expect(value.carts[0]).toMatchObject({ id: "cart-native-owned", items: [], credit_lines: [], shipping_methods: [],
    shipping_address: { city: "Shipping" }, billing_address: { city: "Billing" } });
  expect(value.carts[0]).not.toHaveProperty("creation_claims");
  expect(await connected.read("cart_line_item")).toEqual([expect.objectContaining({ id: "cali-native-owned", unit_price: "9007199254740993.1250",
    raw_unit_price: { value: "9007199254740993.1250", precision: 20 } })]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, value.receipt))).toMatchObject({ status: "compensated",
    deletedCartIds: ["cart-native-owned"], retainedAddressIds: [] });
  for (const table of ["cart", "cart_address", "cart_line_item", "cart_creation_cart", "cart_creation_address"]) expect(await connected.read(table)).toEqual([]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, value.receipt))).toMatchObject({ status: "alreadyCompensated" });
});
it("preserves empty native creation and the actual same-root retained inverse", async () => {
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create, []))).toEqual({ carts: [] });
  expect(await Effect.runPromise(connected.native.run(connected.native.newRequestKey(), []))).toEqual([]);
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.roundtrip, [{ id: "cart-native-roundtrip", currency_code: "usd",
    shipping_address: { country_code: "mm" } }]))).toMatchObject({ status: "compensated", deletedCartIds: ["cart-native-roundtrip"] });
  const ordinary = await connected.prepareProbe(), before = await connected.snapshot();
  const result = await Effect.runPromise(Effect.result(ordinary.run(ordinary.newRequestKey(), connected.create,
    [{ id: "cart-native-without-exclusion", currency_code: "usd" }])));
  expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(await connected.snapshot()).toEqual(before);
});


it("executes the genuine native create-carts step, checks exact children and replays its committed result", async () => {
  const eventCount = (await connected.events()).length, requestKey = connected.native.newRequestKey(), input = [{ id: "cart-native-step", currency_code: "usd",
    shipping_address: { customer_id: "cus-context", country_code: "us" }, billing_address: { country_code: "mm" },
    items: [{ id: "cali-native-step", title: "Taxed exact line", quantity: 1, unit_price: "9007199254740993.1250",
      compare_at_unit_price: "9007199254740995.5000", tax_lines: [{ id: "calitxl-native-step", code: "VAT", rate: 7.25 }],
      adjustments: [{ id: "caliadj-native-step", code: "exact", amount: "1.2500" }] }],
  }];
  const create = vi.spyOn(CartModuleService.prototype, "createCartsWithOwnership");
  try {
    const result = await Effect.runPromise(connected.native.run(requestKey, input));
    expect(result).toEqual([expect.objectContaining({ id: "cart-native-step", items: [], shipping_address: expect.objectContaining({ customer_id: "cus-context" }) })]);
    expect(create).toHaveBeenCalledTimes(1);
    const committed = await connected.snapshot();
    expect(await Effect.runPromise(connected.native.run(requestKey, input))).toEqual(result);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await connected.snapshot()).toEqual(committed);
  } finally { create.mockRestore(); }
  const createdEvents = (await connected.events()).slice(eventCount);
  const publicNames = [];
  for (const event of createdEvents) {
    const message = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, metadata: Schema.Struct({ object: Schema.String }) }))(event.message);
    if (!message.metadata.object.startsWith("cart_creation_")) publicNames.push(message.name);
  }
  expect(publicNames).toEqual(["cart.address.created", "cart.address.created", "cart.cart.created", "cart.line-item.created", "cart.line-item-tax-line.created", "cart.line-item-adjustment.created"]);
  expect(createdEvents).toHaveLength(10);
  expect(await connected.read("cart_line_item_tax_line")).toEqual([expect.objectContaining({ id: "calitxl-native-step", rate: 7.25 })]);
  expect(await connected.read("cart_line_item_adjustment")).toEqual([expect.objectContaining({ id: "caliadj-native-step", amount: "1.2500000000000000000", raw_amount: { value: "1.2500000000000000000", precision: 20 } })]);
});

it("completes a genuinely created Cart through the same Core installation", async () => {
  const id = "cart-native-created-then-completed", completedAt = "2026-10-27T00:00:00.000Z";
  const createKey = connected.native.newRequestKey();
  const created = await Effect.runPromise(connected.native.run(createKey, [{ id, currency_code: "usd" }]));
  expect(created).toMatchObject([{ id }]);
  const before = await connected.snapshot(), completion = await connected.prepareCompletion(), completionKey = completion.newRequestKey();
  const table = connected.cartDefinition.tables.find(candidate => candidate.localName === "cart")?.name;
  const prior = before.rows.find(row => row.table === table && row.value.id === id);
  if (table === undefined || prior === undefined) throw new Error("Missing Core Cart created by the native step");
  expect(prior.value.completed_at).toBeNull();
  const createOutcome = before.outcomes.find(record => record.value.key === createKey);
  expect(createOutcome).toMatchObject({ timestamp: prior.timestamp, value: { kind: "nativeRoot", state: "committed" } });
  expect(await Effect.runPromise(completion.run(completionKey, { id, completed_at: completedAt }))).toMatchObject([{ id, completed_at: completedAt }]);
  const after = await connected.snapshot(), outcome = after.outcomes.find(record => record.value.key === completionKey);
  if (outcome === undefined) throw new Error("Missing committed Core Cart completion outcome");
  expect(outcome.timestamp).toBeGreaterThan(prior.timestamp);
  expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
  expect(after.revisions.filter(row => row.timestamp === outcome.timestamp)).toEqual([expect.objectContaining({
    table, previous: prior.timestamp, deleted: false, value: expect.objectContaining({ id, completed_at: completedAt }),
  })]);
  expect(after.rows.filter(row => row.table !== table || row.value.id !== id))
    .toEqual(before.rows.filter(row => row.table !== table || row.value.id !== id));
  expect(after.events.slice(before.events.length)).toMatchObject([{
    timestamp: outcome.timestamp, envelope: { contract: "cart.cart.updated", message: { data: { id } } },
  }]);
});

it("runs the real retained callback and restores Cart, Address and receipt state after a late failure", async () => {
  const created = Schema.decodeUnknownSync(Schema.Struct({ receipt: CartCreationReceipt }))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create,
    [{ id: "cart-native-callback", currency_code: "usd", shipping_address: { country_code: "mm" } }])));
  const before = await Promise.all(["cart", "cart_address", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"].map(connected.read));
  const beforeFailure = await connected.snapshot(), beforeInverse = connected.inverseCompleted(), failing = await connected.prepareInverse(true), failed = await Effect.runPromiseExit(failing.run(failing.newRequestKey(), created.receipt));
  expect(connected.inverseCompleted()).toBe(beforeInverse + 1);
  expect(await connected.snapshot()).toEqual(beforeFailure);
  expect(Exit.isFailure(failed)).toBe(true);
  expect(await Promise.all(["cart", "cart_address", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"].map(connected.read))).toEqual(before);
  const inverse = await connected.prepareInverse();
  const key = inverse.newRequestKey();
  expect(await Effect.runPromise(inverse.run(key, created.receipt))).toBe(null);
  const compensated = await connected.snapshot();
  expect(await Effect.runPromise(inverse.run(key, created.receipt))).toBe(null);
  expect(connected.inverseCompleted()).toBe(beforeInverse + 2);
  expect(await connected.snapshot()).toEqual(compensated);
  expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.receipt))).toBe(null);
  expect(connected.inverseCompleted()).toBe(beforeInverse + 3);
});
it("retains a genuinely reused Address when its original creation is compensated", async () => {
  const first = Schema.decodeUnknownSync(Schema.Struct({ carts: Schema.Array(Schema.Struct({ shipping_address_id: Schema.String })), receipt: CartCreationReceipt }))(
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create, [{ id: "cart-native-shared-original", currency_code: "usd", shipping_address: { city: "Shared" } }])));
  const address = first.carts[0]?.shipping_address_id;
  if (address === undefined) throw new Error("Missing genuine Address identity");
  const second = Schema.decodeUnknownSync(Schema.Struct({ receipt: CartCreationReceipt }))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create,
    [{ id: "cart-native-shared-reuse", currency_code: "usd", shipping_address: address }])));
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, first.receipt))).toMatchObject({
    deletedCartIds: ["cart-native-shared-original"], deletedAddressIds: [], retainedAddressIds: [address] });
  expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, second.receipt))).toMatchObject({
    deletedCartIds: ["cart-native-shared-reuse"], deletedAddressIds: [], retainedAddressIds: [] });
  expect(await connected.read("cart_address")).toEqual(expect.arrayContaining([expect.objectContaining({ id: address, city: "Shared" })]));
});

it("authenticates native reordered issued rows and refuses clones, mixed models, accessors and closed owners", async () => {
  const created = Schema.decodeUnknownSync(Schema.Struct({ receipt: CartCreationReceipt }))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create,
    [{ id: "cart-native-serialize", currency_code: "usd", items: [{ id: "cali-native-serialize", title: "Serializer origin", quantity: 1, unit_price: 1 }] }])));
  expect(await Effect.runPromise(connected.reader.read(connected.serializeProbe, "reorder"))).toEqual([expect.objectContaining({ id: "cart-native-serialize" })]);
  expect(await Effect.runPromise(connected.reader.read(connected.serializeProbe, "empty"))).toEqual([]);
  for (const mode of ["clone", "mixed", "getter"]) expect(Exit.isFailure(await Effect.runPromiseExit(connected.reader.read(connected.serializeProbe, mode)))).toBe(true);
  expect(connected.getterCalls()).toBe(0);
  expect(await Effect.runPromise(connected.reader.read(connected.serializeProbe, "close"))).toBe(null);
  await expect(connected.serializeAfterClose()).rejects.toMatchObject({ reason: "closed" });
  await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, created.receipt));
});
it("captures one authenticated Cart array view and refuses replaced issued members and unissued singleton proxies", async () => {
  const created = Schema.decodeUnknownSync(Schema.Struct({ receipt: CartCreationReceipt }))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create,
    [{ id: "cart-native-origin", currency_code: "usd" }, { id: "cart-native-origin-other", currency_code: "usd" }])));
  for (const mode of ["proxy", "issued-clone", "singleton-proxy"])
    expect.soft(await Effect.runPromiseExit(connected.reader.read(connected.serializeProbe, mode)), mode).toMatchObject({ _tag: "Failure" });
  expect.soft(connected.descriptorReads().statefulArrayReads).toBe(1);
  expect.soft(connected.descriptorReads().singletonReads).toBe(0);
  expect(await Effect.runPromise(connected.reader.read(connected.serializeProbe, "proxy-stable")))
    .toEqual([expect.objectContaining({ id: "cart-native-origin", currency_code: "usd" })]);
  expect.soft(connected.descriptorReads().stableArrayReads).toBe(1);
  expect(await Effect.runPromise(connected.reader.read(connected.serializeProbe, "combined")))
    .toEqual([expect.objectContaining({ id: "cart-native-origin" }), expect.objectContaining({ id: "cart-native-origin-other" })]);
  await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, created.receipt));
});
it("bounds foreign Cart array keys before descriptor callbacks, including expanded issued arrays", async () => {
  const created = Schema.decodeUnknownSync(Schema.Struct({ receipt: CartCreationReceipt }))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create,
    [{ id: "cart-native-budget", currency_code: "usd" }])));
  for (const mode of ["over-bound", "over-bound-extra", "over-bound-issued"]) {
    expect(await Effect.runPromiseExit(connected.reader.read(connected.serializeProbe, mode))).toMatchObject({ _tag: "Failure" });
    expect.soft(connected.budgetReads(mode), mode).toEqual({ reference: 0, serializer: 0 });
  }
  await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, created.receipt));
});
it("rejects tampered creation/inverse receipts and retains the explicit private sibling-event distinction", async () => {
  const start = connected.traces.length;
  const created = Schema.decodeUnknownSync(Schema.Struct({ receipt: CartCreationReceipt }))(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create,
    [{ id: "cart-native-tamper", currency_code: "usd", shipping_address: { country_code: "us" }, billing_address: { country_code: "mm" } }])));
  await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, created.receipt));
  const traces = connected.traces.slice(start), policy = connected.cart.logicalEventPolicy(), forward = traces.find(trace => trace.call.commandName === "cartCreateWithOwnership"),
    inverse = traces.find(trace => trace.call.commandName === "cartCompensateCreation");
  if (forward === undefined || inverse === undefined) throw new Error("Missing actual native production receipt traces");
  const rejects = async (call: typeof forward.call, activity: typeof forward.activity) => {
    const exit = await Effect.runPromiseExit(policy.validateLogicalCall(call, activity));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "receiptMismatch")).toBe(true);
  };
  await rejects({ ...forward.call, events: forward.call.events.slice(1) }, forward.activity);
  await rejects({ ...forward.call, events: [...forward.call.events, forward.call.events[0]!] }, forward.activity);
  await rejects(forward.call, { ...forward.activity, relationalReads: forward.activity.relationalReads.slice(1) });
  const original = forward.activity.mutations[0];
  if (original?.after === null || original?.after === undefined) throw new Error("Missing actual native insertion");
  await rejects(forward.call, { ...forward.activity, mutations: [{ ...original, after: { ...original.after, country_code: "zz" } }, ...forward.activity.mutations.slice(1)] });
  await rejects({ ...inverse.call, result: { status: "compensated", deletedCartIds: [], deletedAddressIds: [], retainedAddressIds: [] } }, inverse.activity);
  await rejects(inverse.call, { ...inverse.activity, mutations: inverse.activity.mutations.slice(1).map((mutation, ordinal) => ({ ...mutation, ordinal })) });
  const publicEvents = forward.call.events.filter(event => !Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Struct({ object: Schema.String }) }))(event).metadata.object.startsWith("cart_creation_")),
    privateEvents = forward.call.events.filter(event => !publicEvents.includes(event));
  const operationEvents = privateEvents.filter(event => Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Struct({ object: Schema.String }) }))(event).metadata.object === "cart_creation_operation"),
    claimEvents = privateEvents.filter(event => !operationEvents.includes(event));
  expect(Exit.isSuccess(await Effect.runPromiseExit(policy.validateLogicalCall({ ...forward.call, events: [...publicEvents, ...operationEvents, ...claimEvents.reverse()] }, forward.activity)))).toBe(true);
  await rejects({ ...forward.call, events: [...publicEvents, ...claimEvents, ...operationEvents] }, forward.activity);
  const swapped = [...publicEvents]; if (swapped.length < 2) throw new Error("Missing public native event sequence");
  [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
  await rejects({ ...forward.call, events: [...swapped, ...privateEvents] }, forward.activity);
});

it("creates and compensates the maximum admitted Cart creation cohort", async () => {
  const eventCount = (await connected.events()).length, traceCount = connected.traces.length;
  const input = Array.from({ length: 4 }, (_, index) => ({ id: "cart-native-batch-" + (3 - index), currency_code: "usd",
    shipping_address: { city: "Batch shipping " + index }, billing_address: { city: "Batch billing " + index },
    items: [{ id: "cali-native-batch-" + (3 - index), title: "Exact batch line " + index, quantity: index + 1,
      unit_price: "9007199254740993.1250", compare_at_unit_price: "9007199254740995.5000",
      tax_lines: [{ id: "calitxl-native-batch-" + (3 - index), code: "VAT", rate: 7.25 }],
      adjustments: [{ id: "caliadj-native-batch-" + (3 - index), code: "exact", amount: "1.2500" }] }],
  }));
  const value = Schema.decodeUnknownSync(Schema.Struct({ carts: Schema.Array(Schema.Struct({ id: Schema.String,
    shipping_address_id: Schema.String, billing_address_id: Schema.String })), receipt: CartCreationReceipt }))(
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.create, input)));
  expect(value.carts.map(cart => cart.id)).toEqual(input.map(cart => cart.id));
  const inserted = (await connected.events()).slice(eventCount), publicEvents: Array<{ name: string; id: string }> = [];
  for (const event of inserted) {
    const message = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, metadata: Schema.Struct({ object: Schema.String }),
      data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }))(event.message);
    if (!message.metadata.object.startsWith("cart_creation_"))
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) publicEvents.push({ name: message.name, id });
  }
  const lines = input.flatMap(cart => cart.items), addresses = value.carts.flatMap(cart => [cart.shipping_address_id, cart.billing_address_id]);
  expect(publicEvents).toEqual([
    ...addresses.map(id => ({ name: "cart.address.created", id })),
    ...input.map(cart => ({ name: "cart.cart.created", id: cart.id })),
    ...lines.map(line => ({ name: "cart.line-item.created", id: line.id })),
    ...lines.flatMap(line => line.tax_lines.map(tax => ({ name: "cart.line-item-tax-line.created", id: tax.id }))),
    ...lines.flatMap(line => line.adjustments.map(adjustment => ({ name: "cart.line-item-adjustment.created", id: adjustment.id }))),
  ]);
  expect(inserted).toHaveLength(37);
  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), lineIds = new Set(lines.map(line => line.id)),
    taxIds = new Set(lines.flatMap(line => line.tax_lines.map(tax => tax.id))), adjustmentIds = new Set(lines.flatMap(line => line.adjustments.map(adjustment => adjustment.id)));
  expect(rows(await connected.read("cart_line_item")).filter(row => typeof row.id === "string" && lineIds.has(row.id)))
    .toEqual(lines.map(line => expect.objectContaining({ id: line.id, quantity: line.quantity, unit_price: "9007199254740993.1250",
      raw_unit_price: { value: "9007199254740993.1250", precision: 20 }, compare_at_unit_price: "9007199254740995.5000",
      raw_compare_at_unit_price: { value: "9007199254740995.5000", precision: 20 } })).reverse());
  expect(rows(await connected.read("cart_line_item_tax_line")).filter(row => typeof row.id === "string" && taxIds.has(row.id)))
    .toEqual(lines.flatMap(line => line.tax_lines.map(tax => expect.objectContaining({ id: tax.id, item_id: line.id, rate: 7.25 }))).reverse());
  expect(rows(await connected.read("cart_line_item_adjustment")).filter(row => typeof row.id === "string" && adjustmentIds.has(row.id)))
    .toEqual(lines.flatMap(line => line.adjustments.map(adjustment => expect.objectContaining({ id: adjustment.id, item_id: line.id,
      amount: "1.2500000000000000000", raw_amount: { value: "1.2500000000000000000", precision: 20 } }))).reverse());
  const outcome = Schema.decodeUnknownSync(Schema.Struct({ deletedCartIds: Schema.Array(Schema.String), deletedAddressIds: Schema.Array(Schema.String),
    retainedAddressIds: Schema.Array(Schema.String) }))(
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverse, value.receipt)));
  expect(outcome).toEqual({ deletedCartIds: input.map(cart => cart.id).sort(), deletedAddressIds: [...addresses].sort(), retainedAddressIds: [] });
  const traces = connected.traces.slice(traceCount);
  expect(traces.map(trace => ({ mutations: trace.activity.mutations.length, events: trace.call.events.length })))
    .toEqual([{ mutations: 37, events: 37 }, { mutations: 37, events: 13 }]);
  for (const [table, ids] of [["cart", new Set(input.map(cart => cart.id))], ["cart_address", new Set(addresses)],
    ["cart_line_item", lineIds], ["cart_line_item_tax_line", taxIds], ["cart_line_item_adjustment", adjustmentIds],
    ["cart_creation_cart", new Set(input.map(cart => cart.id))], ["cart_creation_address", new Set(addresses)]] as const)
    expect(rows(await connected.read(table)).filter(row => typeof row.id === "string" && ids.has(row.id))).toEqual([]);
});

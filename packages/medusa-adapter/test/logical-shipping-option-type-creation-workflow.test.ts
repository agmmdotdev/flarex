import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { createShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/create-shipping-option-types";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionTypeCreationWorkflow } from "../src/workflows/fulfillment/create-shipping-option-types";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { prepareCoreShippingOptionTypeCreation, shippingOptionTypeSeedIds } from "./support/core-shipping-option-type-creation-fixture";
import { serviceZoneParents } from "./support/native-fulfillment-graph-fixture";
import { expectCapturedWorkflowRefusal, expectWorkflowDefect, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreShippingOptionTypeCreation>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const input = (prefix: string) => ({ shipping_option_types: [
  { id: prefix + "-rich", label: " Native Label ", code: " Raw CODE ", description: " Native description " },
  { label: "Generated", code: " Raw CODE " },
  { id: prefix + "-null", label: "Null", code: "", description: null },
  { id: prefix + "-empty", label: "", code: " Raw CODE ", description: "" },
] });
describe("genuine Shipping Option Type creation through Core", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreShippingOptionTypeCreation(driver, close => cleanup.push(close));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(() => finishOrderFixture([...cleanup.splice(sharedCleanupCount).reverse(), connected.closeCaseHosts]), 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("preserves native supplied-ID aliases with final description and distinct module/workflow event cohorts", async () => {
    const host = await connected.prepare(), before = await connected.snapshot(), key = host.newRequestKey();
    const value = { shipping_option_types: [
      { id: "sotype-identity-alias", label: "first", code: "first", description: null },
      { id: "sotype-identity-alias", label: "ignored", code: "ignored", description: "filled" },
    ] }, original = structuredClone(value);
    const output = rows(await Effect.runPromise(host.run(key, value)));
    expect(value).toEqual(original); expect(output).toHaveLength(2); expect(output[1]).toEqual(output[0]);
    expect(output[0]).toMatchObject({ id: "sotype-identity-alias", label: "first", code: "first", description: "filled", shipping_options: [] });
    expect(await connected.read(["sotype-identity-alias"])).toHaveLength(1);
    const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
    const events = after.events.slice(before.events.length);
    expect(events.map(event => event.envelope.contract)).toEqual(["fulfillment.shipping-option-type.created", "shipping-option-type.created", "shipping-option-type.created"]);
    const inverse = await connected.prepareInverse(), inverseKey = inverse.newRequestKey();
    await Effect.runPromise(inverse.run(inverseKey, output.map(row => text(row.id))));
    expect(await connected.read(["sotype-identity-alias"])).toEqual([]);
    const undone = await connected.snapshot(), inverseTimestamp = expectCheckoutSettlement(after, undone, inverseKey);
    expect(undone.revisions.filter(revision => revision.timestamp === inverseTimestamp)).toMatchObject([
      { previous: timestamp, deleted: true, value: null },
    ]);
  }, 240_000);

  it("creates the complete four-Type result in order, executes its hook, emits both event families and replays once", async () => {
    const value = { ...input("sotype-max"), additional_data: { native: true, nested: { value: "kept" } } }, originalInput = structuredClone(value);
    const trace: string[] = [], native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionTypes"), provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    let hookRows: unknown, escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepare({ shippingOptionTypesCreated: (payload, context) => {
      expect(native).toHaveBeenCalledTimes(1); trace.push("hook"); hookRows = structuredClone(payload.shipping_option_types);
      expect(payload.additional_data).toEqual(value.additional_data);
      expect(payload.shipping_option_types.every(row => row.shipping_options.length === 0)).toBe(true);
      expect(Object.keys(context.resources).sort()).toEqual(["event_bus", "fulfillment"]);
      expect(Object.keys(context.resources.fulfillment).sort()).toEqual(["createShippingOptionTypes", "deleteShippingOptionTypes"]);
      escaped = () => context.resources.fulfillment.createShippingOptionTypes([{ label: "Escaped", code: "escaped" }]);
    } });
    const changed = await connected.prepare({}, "e".repeat(64));
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ShippingOptionType creation maximum BoundedRequest.enter", calls);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(output.map(row => row.label)).toEqual(value.shipping_option_types.map(row => row.label));
      expect(output[0]).toMatchObject(value.shipping_option_types[0]!);
      expect(output[1]).toMatchObject({ id: expect.stringMatching(/^sotype_/), description: null });
      expect(output[2]).toMatchObject({ description: null }); expect(output[3]).toMatchObject({ description: "" });
      for (const row of output) {
        expect(Object.keys(row).sort()).toEqual(["id", "label", "description", "code", "created_at", "updated_at", "deleted_at", "shipping_options"].sort());
        expect(row).toMatchObject({ shipping_options: [], created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
      }
      expect(output).toEqual(hookRows); expect(value).toEqual(originalInput); expect(trace).toEqual(["hook"]); expect(provider).not.toHaveBeenCalled();
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length), ids = output.map(row => text(row.id));
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
      expect(emitted.map(event => event.envelope.contract)).toEqual([
        ...ids.map(() => "fulfillment.shipping-option-type.created"), ...ids.map(() => "shipping-option-type.created"),
      ]);
      expect(emitted.map(event => event.envelope.internal)).toEqual([...ids.map(() => true), ...ids.map(() => false)]);
      for (const family of ["fulfillment.shipping-option-type.created", "shipping-option-type.created"])
        expect(emitted.filter(event => event.envelope.contract === family).map(event => event.envelope.message)).toEqual(ids.map(id => expect.objectContaining({ data: { id } })));
      const timestamp = expectCheckoutSettlement(before, after, key);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp).map(revision => revision.value?.id).toSorted()).toEqual(ids.toSorted());
      expect(await connected.read(ids)).toEqual(output.map(({ shipping_options: _shipping, ...row }) => row).sort((a, b) => text(a.id).localeCompare(text(b.id))));
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output); expect(native).toHaveBeenCalledTimes(1); expect(trace).toEqual(["hook"]);
      await expect(Effect.runPromise(host.run(key, { shipping_option_types: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, value))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
      if (escaped === undefined) throw new Error("Missing genuine escaped hook method");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("retains empty Fulfillment resolution and hook execution without native module or workflow messages", async () => {
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionTypes"), hook = vi.fn();
    const host = await connected.prepare({ shippingOptionTypesCreated: (payload, context) => {
      expect(payload.shipping_option_types).toEqual([]); expect(payload.additional_data).toBeUndefined();
      expect(typeof context.container.resolve<{ emit: unknown }>("event_bus").emit).toBe("function"); hook();
    } });
    try {
      const before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { shipping_option_types: [] }))).toEqual([]);
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]); expect(hook).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot();
      expect(after.outcomes.slice(before.outcomes.length)).toMatchObject([{ value: { key, kind: "nativeRoot", state: "committed" } }]);
      expect({ ...after, outcomes: before.outcomes }).toEqual(before);
      const inverse = await connected.prepareAbsentInverse(), deletion = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingOptionTypes");
      try { expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), null))).toBeNull(); expect(deletion).not.toHaveBeenCalled(); }
      finally { deletion.mockRestore(); }
    } finally { native.mockRestore(); }
  }, 180_000);

  it("refuses the genuine event-producing profile without an event bus during trusted admission", async () => {
    const hook = vi.fn(), native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionTypes");
    try {
      const before = await connected.snapshot();
      await expect(connected.prepareWithoutEventBus(hook)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(native).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled();
      expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("retains the genuine native empty event callback's required resolution without emitting messages", async () => {
    const prepared = Result.getOrThrow(createShippingOptionTypesWorkflow.prepare()), step = prepared.nodes.find(node => node.name === "emit-event-step");
    if (step?.kind !== "step") throw new Error("Missing genuine native event callback");
    // This is an observational port for the exact prepared native callback.
    // Connected cases above separately prove the real bus, service and storage.
    const emit = vi.fn(), resolve = vi.fn().mockReturnValue({ emit });
    await step.invoke({ eventName: "shipping-option-type.created", data: [] }, { container: { resolve }, eventGroupId: "native-empty-type-event" });
    expect(resolve.mock.calls).toEqual([["event_bus"]]); expect(emit).not.toHaveBeenCalled();
    const failure = new Error("Missing native event bus"), missing = vi.fn().mockImplementation(() => { throw failure; });
    await expect(step.invoke({ eventName: "shipping-option-type.created", data: [] }, { container: { resolve: missing }, eventGroupId: "native-empty-type-event" })).rejects.toBe(failure);
    expect(missing.mock.calls).toEqual([["event_bus"]]); expect(emit).not.toHaveBeenCalled();
  });

  it("keeps ordinary insert semantics for existing and tombstoned IDs with no prefix publication", async () => {
    const host = await connected.prepare();
    for (const conflicting of [shippingOptionTypeSeedIds.existing, shippingOptionTypeSeedIds.deleted]) {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const value = { shipping_option_types: [{ id: "sotype-prefix-" + conflicting, label: "First", code: "same" },
        { id: conflicting, label: "Conflict", code: "same" }] };
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, value)), "invalidInput");
      await expectCheckoutRollback(connected.fixture, before, key);
    }
  }, 240_000);

  it("executes the full native root and its genuine physical inverse within unchanged limits", async () => {
    const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
    if (getter === undefined) throw new Error("Missing genuine SDK retained-response getter");
    const retainedValues: unknown[] = [];
    const retained = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
      const value: unknown = Reflect.apply(getter, this, []);
      // The genuine emit-event step retains a separate object for its inverse.
      if (Array.isArray(value)) retainedValues.push(structuredClone(value));
      return value;
    });
    const actualRetained = () => {
      if (retainedValues.length !== 1) throw new Error("Expected exactly the genuine Type retained value");
      return retainedValues[0];
    };
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingOptionTypes");
    try {
      const host = await connected.prepareRoundtrip(actualRetained), value = input("sotype-inverse");
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ShippingOptionType maximum root plus inverse BoundedRequest.enter", calls);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(output).toHaveLength(4);
      const ids = output.map(row => text(row.id));
      expect(actualRetained()).toEqual(ids); expect(native.mock.calls.map(call => call[0])).toEqual([ids]);
      expect(await connected.read(ids)).toEqual([]);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(emitted.filter(event => event.envelope.contract === "fulfillment.shipping-option-type.deleted")).toHaveLength(4);
      expect(emitted.filter(event => event.envelope.contract === "shipping-option-type.created")).toHaveLength(4);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
      const timestamp = expectCheckoutSettlement(before, after, key);
      const table = connected.definition.tables.find(table => table.localName === "shipping_option_type");
      if (table === undefined) throw new Error("Missing issued Shipping Option Type table");
      const tombstones = after.revisions.filter(revision => revision.timestamp === timestamp);
      expect(tombstones).toHaveLength(4);
      expect(new Set(tombstones.map(revision => revision.id)).size).toBe(4);
      for (const revision of tombstones) expect(revision).toMatchObject({ table: table.name, previous: null, deleted: true, value: null });
      expect(after.rows).toEqual(before.rows); expect(after.indexes).toEqual(before.indexes);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output);
      expect(actualRetained()).toEqual(ids); expect(native).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);

      retainedValues.length = 0;
      const failure = new Error("Late native Type inverse failure");
      const failing = await connected.prepareRoundtrip(actualRetained, failure);
      const beforeFailure = await connected.fixture.inventory(), failingKey = failing.newRequestKey();
      expectWorkflowDefect(await Effect.runPromiseExit(failing.run(failingKey, input("sotype-late-inverse"))), failure);
      await expectCheckoutRollback(connected.fixture, beforeFailure, failingKey);
    } finally { native.mockRestore(); retained.mockRestore(); }
  }, 240_000);

  it.each([shippingOptionTypeSeedIds.linked, shippingOptionTypeSeedIds.historical])("refuses retained physical inverse for active or historical Option reference %s", async id => {
    const host = await connected.prepareInverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingOptionTypes");
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const failures = expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, [id])), "invalidInput");
      expect(failures.every(failure => failure.reason === "invalidInput" || failure.reason === "rollbackOnly")).toBe(true);
      expect(native).toHaveBeenCalledTimes(1);
      await expectCheckoutRollback(connected.fixture, before, key);
      expect(await connected.read([id])).toHaveLength(1);
      // The pinned native SQLite DAL refuses its attempted required-FK null;
      // shared storage maps noncascade inbound reference refusal to invalidInput.
    } finally { native.mockRestore(); }
  }, 180_000);

  it("refuses nested, managed, unknown and oversized inputs before native work", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionTypes");
    try {
      for (const invalid of [{ shipping_option_types: Array(5).fill({ label: "Too many", code: "code" }) },
        ...["created_at", "updated_at", "deleted_at", "shipping_options", "shipping_option", "shipping_option_id", "metadata"].map(field => ({ shipping_option_types: [{ label: "Invalid", code: "code", [field]: null }] })),
        { shipping_option_types: [{ label: "Invalid", code: null }] }, { shipping_option_types: [{ label: null, code: "code" }] },
        { shipping_option_types: [{ label: "Invalid", code: "code", foreign: true }] }, { shipping_option_types: [], foreign: true }]) {
        const before = await connected.fixture.inventory(), key = host.newRequestKey();
        expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, invalid)), "invalidInput");
        await expectCheckoutRollback(connected.fixture, before, key);
      }
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["order", "scalar", "relation", "missing"] as const)("refuses forged complete native %s after actual inserts", async mode => {
    const original = FulfillmentModuleService.prototype.createShippingOptionTypes;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await original.call(this, ...args);
      if (!Array.isArray(output) || output.length !== 4) throw new Error("Missing genuine four-Type result");
      if (mode === "order") output.reverse();
      else if (mode === "missing") output.pop();
      else { const row: unknown = output[0]; if (typeof row !== "object" || row === null) throw new Error("Missing genuine Type row");
        Reflect.set(row, mode === "scalar" ? "code" : "shipping_options", mode === "scalar" ? "forged" : [{ id: "uncreated-option" }]); }
      return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, input("sotype-forge-" + mode))), "receiptMismatch");
      expect(native).toHaveBeenCalledTimes(1); await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("rolls back hook failure and a caught sibling denial without publishing staged writes/events", async () => {
    for (const mode of ["throw", "catchDenied"] as const) {
      const failure = new Error("Native Type creation hook failure");
      let called = false, caught: unknown;
      const host = await connected.prepare({ shippingOptionTypesCreated: async (_payload, context) => {
        called = true;
        if (mode === "throw") throw failure;
        try { await context.container.resolve<{ createShippingProfiles: (value: unknown) => Promise<unknown> }>("fulfillment")
          .createShippingProfiles({ name: "Denied sibling", type: "default" }); } catch (error) { caught = error; }
      } });
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromiseExit(host.run(key, input("sotype-hook-" + mode)));
      if (mode === "throw") expectWorkflowDefect(outcome, failure);
      else {
        expect(caught).toMatchObject({ reason: "unsupportedProfile" });
        expectCapturedWorkflowRefusal(outcome, "unsupportedProfile");
      }
      expect(called).toBe(true); await expectCheckoutRollback(connected.fixture, before, key);
    }
  }, 240_000);

  it("rejects forged hooks, module identities, sources and resource overrides before execution", async () => {
    const before = await connected.fixture.inventory();
    const prepare = vi.fn(connected.execution.prepare), execution = { ...connected.execution, prepare };
    const inherited: unknown = Object.create({ shippingOptionTypesCreated: () => undefined });
    const invalidHooks: unknown[] = [inherited, { unselectedHook: () => undefined }, { shippingOptionTypesCreated: "invalid" }];
    for (const hooks of invalidHooks)
      // @ts-expect-error Deliberately forged foreign hook registration.
      expectWorkflowTypedFailures(await Effect.runPromiseExit(prepareShippingOptionTypeCreationWorkflow({ ...connected.options, execution, hooks })));
    const wrongSlot = Result.getOrThrow(defineAtomicCommerceNativeSource("foreign", connected.definition));
    const { scopeUuid, epochUuid } = connected.definition.identity;
    const scalar = await Effect.runPromise(compileShippingProfileCoreDefinition({ scopeUuid, epochUuid }));
    const missingOptions = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", scalar));
    for (const fulfillment of [{ ...connected.installed, module: { ...connected.fulfillment.workflow } },
      { ...connected.installed, nativeStorage: wrongSlot }, { ...connected.installed, nativeStorage: missingOptions },
      { ...connected.installed, nativeStorage: { ...connected.installed.nativeStorage } }])
      expectWorkflowTypedFailures(await Effect.runPromiseExit(prepareShippingOptionTypeCreationWorkflow({ ...connected.options, execution, fulfillment })), "invalidAuthority");
    const override = { ...connected.installed, logicalResources: { ...defaultCommerceResources, calls: 128 } };
    expectWorkflowTypedFailures(await Effect.runPromiseExit(prepareShippingOptionTypeCreationWorkflow({ ...connected.options, execution,
      // @ts-expect-error Deliberately verify that a foreign policy override is refused at runtime.
      fulfillment: override,
    })), "unsupportedProfile");
    expect(prepare).not.toHaveBeenCalled(); expect(await connected.fixture.inventory()).toEqual(before);
  });

  it("cancels at the native hook and revokes escaped pending resources", async () => {
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const host = await connected.prepare({ shippingOptionTypesCreated: async (_payload, context) => {
      escaped = () => context.resources.fulfillment.createShippingOptionTypes([{ label: "Late", code: "late" }]);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined));
    } });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey(), interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(key, input("sotype-cancel")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      })));
      expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing actual cancelled hook method"); await expect(escaped()).rejects.toBeDefined();
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { finish?.(); }
  }, 180_000);

  it("exposes bounded physical deletion of an unreferenced existing Type to its selected hook", async () => {
    const id = "sotype-hook-created", existing = shippingOptionTypeSeedIds.existing;
    const host = await connected.prepare({ shippingOptionTypesCreated: async (_payload, context) => {
      await context.resources.fulfillment.deleteShippingOptionTypes([existing]);
    } });
    const before = await connected.snapshot();
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { shipping_option_types: [{ id, label: "Hook-created", code: "hook" }] })));
    expect(output).toMatchObject([{ id, shipping_options: [] }]); expect(await connected.read([existing])).toEqual([]);
    expect(await connected.read([id])).toMatchObject([{ id, label: "Hook-created" }]);
    const emitted = (await connected.snapshot()).events.slice(before.events.length);
    expect(emitted.map(event => event.envelope.contract)).toEqual([
      "fulfillment.shipping-option-type.created", "fulfillment.shipping-option-type.deleted", "shipping-option-type.created",
    ]);
  }, 180_000);

  it("refuses a second creation call from the hook under the root's one-create event correlation", async () => {
    const host = await connected.prepare({ shippingOptionTypesCreated: async (_payload, context) => {
      await context.resources.fulfillment.createShippingOptionTypes([]);
    } });
    const before = await connected.fixture.inventory(), key = host.newRequestKey();
    expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, input("sotype-hook-second-create"))), "receiptMismatch");
    await expectCheckoutRollback(connected.fixture, before, key);
  }, 180_000);

  it("isolates equal Type IDs and request keys across real scopes", async () => {
    const other = await prepareCoreShippingOptionTypeCreation(driver, close => cleanup.push(close), connected.fixture.physical);
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const id = "sotype-cross-scope", first = { shipping_option_types: [{ id, label: "First scope", code: "same" }] }, second = { shipping_option_types: [{ id, label: "Second scope", code: "same" }] };
    const output = await Effect.runPromise(left.run(key, first)); expect(await other.read([id])).toEqual([]);
    const otherOutput = await Effect.runPromise(right.run(key, second)); expect(await connected.read([id])).toMatchObject([{ label: "First scope" }]);
    expect(await other.read([id])).toMatchObject([{ label: "Second scope" }]);
    const after = await connected.snapshot(); expect(await Effect.runPromise(left.run(key, first))).toEqual(output); expect(await Effect.runPromise(right.run(key, second))).toEqual(otherOutput);
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("creates a Type beside genuine Service Zone creation on the same eight-table Core source", async () => {
    const type = await connected.prepare(), zone = await connected.prepareZone();
    const protectedIds = connected.protectedZoneIds;
    const protectedBefore = await connected.read(protectedIds), before = await connected.snapshot(), zoneKey = zone.newRequestKey();
    expect(protectedBefore).toHaveLength(4);
    const zones = rows(await Effect.runPromise(zone.run(zoneKey, { data: [{ name: "Core co-composed Type Zone", fulfillment_set_id: serviceZoneParents.active }] })));
    expect(zones).toMatchObject([{ name: "Core co-composed Type Zone", fulfillment_set_id: serviceZoneParents.active, shipping_options: [] }]);
    const afterZone = await connected.snapshot(), zoneTimestamp = expectCheckoutSettlement(before, afterZone, zoneKey);
    expect(afterZone.events.filter(event => event.timestamp === zoneTimestamp).map(event => event.envelope.contract)).toEqual(["fulfillment.service-zone.created"]);
    const zoneIds = zones.map(row => text(row.id)), storedZones = await connected.read(zoneIds);
    const id = "zone-co-composed-type", typeKey = type.newRequestKey();
    const value = { shipping_option_types: [{ id, label: "Co-composed", code: "native" }] };
    const output = rows(await Effect.runPromise(type.run(typeKey, value)));
    expect(output).toMatchObject([{ id, label: "Co-composed", shipping_options: [] }]);
    expect(await connected.read(protectedIds)).toEqual(protectedBefore);
    expect(await connected.read(zoneIds)).toEqual(storedZones);
    expect(await connected.read([id])).toMatchObject([{ id, label: "Co-composed", code: "native" }]);
    const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(afterZone, after, typeKey);
    expect(after.events.filter(event => event.timestamp === timestamp).map(event => event.envelope.contract))
      .toEqual(["fulfillment.shipping-option-type.created", "shipping-option-type.created"]);
    expect(await Effect.runPromise(type.run(typeKey, value))).toEqual(output);
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("settles one of two overlapping creates for the same supplied ID", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(); let arrivals = 0;
    const hooks = { shippingOptionTypesCreated: async () => {
      arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
    } };
    const left = await connected.prepare(hooks), right = await connected.prepare(hooks), id = "sotype-concurrent-id", before = await connected.snapshot();
    const leftKey = left.newRequestKey(), rightKey = right.newRequestKey();
    try {
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(leftKey, { shipping_option_types: [{ id, label: "Left", code: "same" }] }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(rightKey, { shipping_option_types: [{ id, label: "Right", code: "same" }] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)] as const;
      })));
      expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
      expect(outcomes.filter(Exit.isFailure)).toHaveLength(1); expect(arrivals).toBe(2);
      const [first, second] = outcomes, [winner, failure] = Exit.isSuccess(first) ? [first, second] : [second, first];
      if (!Exit.isSuccess(winner) || !Exit.isFailure(failure)) throw new Error("Expected one accepted and one rejected Type creation");
      expect(expectWorkflowTypedFailures(failure).map(error => error.reason)).toEqual(["writeConflict"]);
      const [committedKey, refusedKey] = Exit.isSuccess(first) ? [leftKey, rightKey] : [rightKey, leftKey];
      const [actual] = await connected.read([id]); expect(actual?.label).toBe(rows(winner.value)[0]?.label);
      const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, committedKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(1);
      expect(after.events.length - before.events.length).toBe(2);
      expect((await connected.fixture.inventory()).outcomes.filter(record => record.value.key === refusedKey))
        .toMatchObject([{ value: { key: refusedKey, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 240_000);
});

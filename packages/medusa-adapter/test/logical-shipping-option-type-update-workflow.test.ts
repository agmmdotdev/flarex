import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { updateShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/update-shipping-option-types";
import { CommerceTransactionError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeShippingOptionTypeCreationCommands } from "../src/modules/fulfillment/shipping-option-type-service";
import { prepareShippingOptionTypeUpdateWorkflow } from "../src/workflows/fulfillment/update-shipping-option-types";
import { prepareLogicalShippingOptionTypeUpdate, shippingOptionTypeUpdateSeed, shippingOptionTypeUpdateSeedTime,
  shippingOptionTypeUpdateLinkedIds } from "./support/logical-shipping-option-type-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingOptionTypeUpdate>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const roundtrip = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }));
const ids = (values: readonly JsonObject[]) => values.map(row => text(row.id));
const maximum = ["sotype-update-max-0", "sotype-update-max-1", "sotype-update-max-2", "sotype-update-max-3"];
const seedIds = [...maximum, "sotype-update-noop", "sotype-update-id-inverse", "sotype-update-description", "sotype-update-outside",
  "sotype-update-inside-a", "sotype-update-inside-b", "sotype-update-id-target", "sotype-update-scope", "sotype-update-race",
  "sotype-update-protected", "sotype-update-duplicates", "sotype-update-failure"];
const initial = [...seedIds.map(id => shippingOptionTypeUpdateSeed(id)), shippingOptionTypeUpdateSeed("sotype-update-deleted", true)];
const updated = "fulfillment.shipping-option-type.updated", created = "fulfillment.shipping-option-type.created", workflowUpdated = "shipping-option-type.updated";
const withoutUpdated = (row: JsonObject) => { const { updated_at: _updated, ...rest } = row; return rest; };
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function eventIds(events: Awaited<ReturnType<typeof connected.snapshot>>["events"], contract: string) {
  return events.filter(event => event.envelope.contract === contract).map(event => {
    expect(event.envelope.internal).toBe(contract !== workflowUpdated);
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Type event data");
    return text(message.data.id);
  });
}
function scalarRows(output: readonly JsonObject[]) {
  for (const row of output) expect(Object.keys(row).sort()).toEqual(["id", "label", "code", "description", "created_at", "updated_at", "deleted_at"].sort());
}

describe("genuine Shipping Option Type update and retained upsert on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalShippingOptionTypeUpdate(driver, close => cleanup.push(close), initial); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("updates the full four-Type root in order with its hook, scalar output, both event families and replay", async () => {
    const value = { selector: { id: [...maximum].reverse() }, update: { label: " Native Label ", code: " Raw CODE ", description: null },
      additional_data: { native: true, nested: { retained: "value" } } }, originalInput = structuredClone(value);
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionTypes"), provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    let observed: unknown, escaped: (() => Promise<unknown>) | undefined, hookCalls = 0;
    const host = await connected.prepare({ shippingOptionTypesUpdated: (payload, context) => {
      expect(native).toHaveBeenCalledTimes(1); hookCalls++; observed = structuredClone(payload.shipping_option_types);
      expect(payload.additional_data).toEqual(value.additional_data);
      expect(Object.keys(context.resources).sort()).toEqual(["event_bus", "fulfillment"]);
      expect(Object.keys(context.resources.fulfillment).sort()).toEqual(["listShippingOptionTypes", "updateShippingOptionTypes", "upsertShippingOptionTypes"]);
      escaped = () => context.resources.fulfillment.listShippingOptionTypes({ id: maximum[0]! }, {});
    } });
    try {
      const key = host.newRequestKey(), before = await connected.snapshot(), protectedBefore = await connected.read(["sotype-update-protected", "sotype-update-deleted"]); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ShippingOptionType update maximum root BoundedRequest.enter", calls);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(ids(output)).toEqual(value.selector.id);
      scalarRows(output); expect(output).toEqual(observed); expect(hookCalls).toBe(1); expect(value).toEqual(originalInput); expect(provider).not.toHaveBeenCalled();
      for (const row of output) {
        expect(row).toMatchObject({ label: " Native Label ", code: " Raw CODE ", description: null, created_at: shippingOptionTypeUpdateSeedTime, deleted_at: null });
        expect(row.updated_at).not.toBe(shippingOptionTypeUpdateSeedTime);
      }
      expect(await connected.read(maximum)).toEqual([...output].sort((a, b) => text(a.id).localeCompare(text(b.id))));
      expect(await connected.read(["sotype-update-protected", "sotype-update-deleted"])).toEqual(protectedBefore);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted, updated)).toEqual(value.selector.id); expect(eventIds(emitted, workflowUpdated)).toEqual(value.selector.id);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(4);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output); expect(hookCalls).toBe(1); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { selector: { id: [] }, update: {} }))).rejects.toMatchObject({ reason: "requestConflict" });
      const changed = await connected.prepare({}, "8".repeat(64)); await expect(Effect.runPromise(changed.run(key, value))).rejects.toMatchObject({ reason: "requestConflict" });
      if (escaped === undefined) throw new Error("Missing escaped genuine Type method"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("retains raw selector order, duplicate collapse, exact preimage projection and genuine scalar restoration", async () => {
    const host = await connected.prepareRoundtrip(), selected = [maximum[2]!, maximum[0]!, maximum[2]!, "sotype-update-missing"], beforeRows = await connected.read(maximum);
    const before = await connected.snapshot(), inverse = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptionTypes"); let calls = 0;
    try {
      const output = roundtrip(await Effect.runPromise(host.run(host.newRequestKey(), { input: { selector: { id: selected }, update: { label: "Temporary inverse label" } } }).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
      )));
      console.info("ShippingOptionType retained forward plus inverse BoundedRequest.enter", calls);
      expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(ids(output.output)).toEqual(selected.slice(0, 2)); scalarRows(output.output);
      expect(output.preimages).toEqual(selected.slice(0, 2).map(id => ({ id, label: beforeRows.find(row => row.id === id)?.label })));
      expect(inverse.mock.calls.map(call => call[0])).toEqual([output.preimages]);
      expect((await connected.read(maximum)).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
      const emitted = (await connected.snapshot()).events.slice(before.events.length); expect(eventIds(emitted, updated)).toEqual([...selected.slice(0, 2), ...selected.slice(0, 2)]);
      expect(eventIds(emitted, workflowUpdated)).toEqual([]);
    } finally { inverse.mockRestore(); }
  }, 240_000);

  it("admits four original preimages plus an outside retarget and preserves the native incomplete business inverse", async () => {
    const host = await connected.prepareRoundtrip(), target = "sotype-update-outside", originals = await connected.read(maximum), before = await connected.snapshot(); let calls = 0;
    const result = roundtrip(await Effect.runPromise(host.run(host.newRequestKey(), { input: { selector: { id: [...maximum] }, update: { id: target, label: "Retargeted outside label" } } }).pipe(
      Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
    )));
    console.info("ShippingOptionType five-identity retarget plus retained inverse BoundedRequest.enter", calls);
    expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(ids(result.output)).toEqual([target]);
    expect(result.preimages).toEqual(originals.map(row => ({ id: row.id, label: row.label })));
    expect((await connected.read(maximum)).map(withoutUpdated)).toEqual(originals.map(withoutUpdated));
    expect(await connected.read([target])).toMatchObject([{ id: target, label: "Retargeted outside label" }]);
    const emitted = (await connected.snapshot()).events.slice(before.events.length); expect(eventIds(emitted, updated)).toEqual([target, ...maximum]);
  }, 240_000);

  it.each([false, true])("fits the complete native root and genuine retained inverse in one default budget (outside target: %s)", async retarget => {
    const prepared = Result.getOrThrow(updateShippingOptionTypesWorkflow.prepare());
    const retained = prepared.nodes.find(node => node.name === "update-shipping-option-types");
    if (retained?.kind !== "step" || retained.compensate === undefined) throw new Error("Missing genuine retained Type inverse");
    const compensate = retained.compensate, list = vi.spyOn(FulfillmentModuleService.prototype, "listShippingOptionTypes");
    const originals = await connected.read(maximum), target = "sotype-update-outside";
    const before = await connected.snapshot(); let calls = 0, inverseCalls = 0;
    try {
      const host = await connected.prepare({ shippingOptionTypesUpdated: async (_payload, context) => {
        // Observe the actual native step's projected list result. The original
        // method and root execute unchanged; no preimage is reconstructed here.
        const preimages = await list.mock.results[0]?.value;
        if (preimages === undefined) throw new Error("Missing actual native preimages");
        await compensate(preimages, context); inverseCalls++;
      } });
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [...maximum] },
        update: { ...(retarget ? { id: target } : {}), label: "Full root temporary", description: null, code: "Full root CODE" } }).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => {
          if (name === "BoundedRequest.enter") calls++;
        }).pipe(Effect.andThen(work)) }),
      )));
      console.info("ShippingOptionType full root and retained inverse BoundedRequest.enter", { retarget, calls });
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(inverseCalls).toBe(1); expect(ids(output)).toEqual(retarget ? [target] : maximum);
      expect((await connected.read(maximum)).map(withoutUpdated)).toEqual(originals.map(withoutUpdated));
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted, workflowUpdated)).toEqual(ids(output));
      expect(after.commits.length - before.commits.length).toBe(1);
    } finally { list.mockRestore(); }
  }, 240_000);

  it("uses the original selected target preimage when retarget B belongs to the original cohort", async () => {
    const host = await connected.prepareRoundtrip(), selected = ["sotype-update-inside-a", "sotype-update-inside-b"], prior = await connected.read(selected);
    const result = roundtrip(await Effect.runPromise(host.run(host.newRequestKey(), { input: { selector: { id: selected }, update: { id: selected[1]!, label: "Inside target changed" } } })));
    expect(ids(result.output)).toEqual([selected[1]]); expect(result.preimages).toEqual(prior.map(row => ({ id: row.id, label: row.label })));
    expect((await connected.read(selected)).map(withoutUpdated)).toEqual(prior.map(withoutUpdated));
  }, 180_000);

  it("correlates full-root workflow events to collapsed actual retarget B rather than original A/C", async () => {
    const host = await connected.prepare(), selected = [maximum[2]!, maximum[0]!], target = "sotype-update-outside", before = await connected.snapshot();
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: selected }, update: { id: target, code: "Retarget CODE" } })));
    expect(ids(output)).toEqual([target]); expect(output[0]?.code).toBe("Retarget CODE");
    const emitted = (await connected.snapshot()).events.slice(before.events.length); expect(eventIds(emitted, updated)).toEqual([target]); expect(eventIds(emitted, workflowUpdated)).toEqual([target]);
  }, 180_000);

  it("preserves missing and deleted retarget errors while an empty original selector avoids retarget lookup", async () => {
    const host = await connected.prepare();
    for (const target of ["sotype-update-missing", "sotype-update-deleted"]) {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: maximum[0]! }, update: { id: target, label: "Never written" } })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain('ShippingOptionType with id "' + target + '" not found');
      expect(await connected.snapshot()).toEqual(before);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [] }, update: { id: target, label: "Ignored" } }))).toEqual([]);
    }
  }, 240_000);

  it("keeps forward empty and ID-only patches unwritten while native workflow events still follow returned rows", async () => {
    const host = await connected.prepare(), id = "sotype-update-noop", target = "sotype-update-id-target", original = await connected.read([id, target]), before = await connected.snapshot();
    const empty = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: {} })));
    const retargeted = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { id: target } })));
    expect(empty).toEqual(original.filter(row => row.id === id)); expect(retargeted).toEqual(original.filter(row => row.id === target)); scalarRows([...empty, ...retargeted]);
    const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.rowChanges).toEqual(before.rowChanges);
    expect(eventIds(after.events.slice(before.events.length), updated)).toEqual([]); expect(eventIds(after.events.slice(before.events.length), workflowUpdated)).toEqual([id, target]);
    const sameValueBefore = await connected.snapshot(), output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { code: " Native CODE " } })));
    expect(output[0]?.updated_at).not.toBe(shippingOptionTypeUpdateSeedTime); expect(eventIds((await connected.snapshot()).events.slice(sameValueBefore.events.length), updated)).toEqual([id]);
  }, 240_000);

  it("retains ID-only preimages yet the genuine upsert inverse writes timestamps and emits updated", async () => {
    const host = await connected.prepareRoundtrip(), id = "sotype-update-id-inverse", [prior] = await connected.read([id]), before = await connected.snapshot();
    if (prior === undefined) throw new Error("Missing no-op inverse seed");
    const result = roundtrip(await Effect.runPromise(host.run(host.newRequestKey(), { input: { selector: { id }, update: {} } })));
    expect(result.output).toEqual([prior]); expect(result.preimages).toEqual([{ id }]);
    const [afterRow] = await connected.read([id]); if (afterRow === undefined) throw new Error("Missing genuine inverse result");
    expect(withoutUpdated(afterRow)).toEqual(withoutUpdated(prior)); expect(afterRow.updated_at).not.toBe(prior.updated_at);
    const after = await connected.snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(1); expect(eventIds(after.events.slice(before.events.length), updated)).toEqual([id]);
  }, 180_000);

  it("preserves empty strings, case, null clearing, omitted fields and description projection", async () => {
    const host = await connected.prepare(), id = "sotype-update-description";
    const empty = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { label: "", code: "", description: "" } })));
    expect(empty[0]).toMatchObject({ label: "", code: "", description: "" });
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { description: null } })))[0]).toMatchObject({ label: "", code: "", description: null });
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { label: " Spaced Case Label " } })))[0]).toMatchObject({ label: " Spaced Case Label ", description: null });
    const inverse = await connected.prepareRoundtrip(), result = roundtrip(await Effect.runPromise(inverse.run(inverse.newRequestKey(), { input: { selector: { id }, update: { description: "Temporary" } } })));
    expect(result.preimages).toEqual([{ id, description: null }]); expect((await connected.read([id]))[0]?.description).toBeNull();
  }, 240_000);

  it("preserves empty native service and hook dependencies without module or workflow messages", async () => {
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionTypes"), list = vi.spyOn(FulfillmentModuleService.prototype, "listShippingOptionTypes"), hook = vi.fn();
    const host = await connected.prepare({ shippingOptionTypesUpdated: (payload, context) => {
      expect(payload.shipping_option_types).toEqual([]); expect(payload.additional_data).toBeUndefined();
      expect(typeof context.container.resolve<{ emit: unknown }>("event_bus").emit).toBe("function"); hook();
    } });
    try {
      const before = await connected.snapshot();
      for (const selected of [[], ["sotype-update-missing"], ["sotype-update-deleted"]])
        expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: selected }, update: { label: "Ignored" } }))).toEqual([]);
      expect(native).toHaveBeenCalledTimes(3); expect(list).toHaveBeenCalledTimes(3); expect(hook).toHaveBeenCalledTimes(3);
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
      const absent = await connected.prepareAbsentInverse(), inverse = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptionTypes");
      try { expect(await Effect.runPromise(absent.run(absent.newRequestKey(), null))).toBeNull(); expect(inverse).not.toHaveBeenCalled(); } finally { inverse.mockRestore(); }
    } finally { native.mockRestore(); list.mockRestore(); }
  }, 240_000);

  it("refuses the event-producing profile without a bus and retains native empty event resolution", async () => {
    const hook = vi.fn(), native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionTypes");
    try { const before = await connected.snapshot(); await expect(connected.prepareWithoutEventBus(hook)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(native).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before); } finally { native.mockRestore(); }
    const prepared = Result.getOrThrow(updateShippingOptionTypesWorkflow.prepare()), step = prepared.nodes.find(node => node.name === "emit-event-step");
    if (step?.kind !== "step") throw new Error("Missing genuine native event callback");
    const emit = vi.fn(), resolve = vi.fn().mockReturnValue({ emit });
    await step.invoke({ eventName: "shipping-option-type.updated", data: [] }, { container: { resolve }, eventGroupId: "native-empty-type-update" });
    expect(resolve.mock.calls).toEqual([["event_bus"]]); expect(emit).not.toHaveBeenCalled();
    const failure = new Error("Missing native event bus"), missing = vi.fn().mockImplementation(() => { throw failure; });
    await expect(step.invoke({ eventName: "shipping-option-type.updated", data: [] }, { container: { resolve: missing }, eventGroupId: "native-empty-type-update" })).rejects.toBe(failure);
    expect(missing.mock.calls).toEqual([["event_bus"]]);
  }, 180_000);

  it("executes genuine inverse upsert on existing tombstones without restoring them and can recreate complete missing rows", async () => {
    const host = await connected.prepareInverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptionTypes"), deleted = "sotype-update-deleted", missing = "sotype-update-recreated";
    try {
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), [{ id: deleted, label: "Historical label changed" }, { id: missing, label: "Recreated", code: "" }]))).toBeNull();
      const returned = rows(await native.mock.results[0]?.value); scalarRows(returned); expect(ids(returned)).toEqual([deleted, missing]);
      expect(returned[0]).toMatchObject({ deleted_at: shippingOptionTypeUpdateSeedTime, label: "Historical label changed", description: " Original description " });
      expect(returned[0]?.updated_at).not.toBe(shippingOptionTypeUpdateSeedTime);
      expect(returned[1]).toMatchObject({ description: null, deleted_at: null, label: "Recreated", code: "" });
      expect(await connected.read([deleted, missing])).toEqual([...returned].sort((a, b) => text(a.id).localeCompare(text(b.id))));
      const emitted = (await connected.snapshot()).events.slice(before.events.length); expect(eventIds(emitted, updated)).toEqual([deleted]); expect(eventIds(emitted, created)).toEqual([missing]);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("retains sequential duplicate inverse upserts and deduplicates their native module event", async () => {
    const host = await connected.prepareInverse(), id = "sotype-update-duplicates", native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptionTypes");
    try {
      const before = await connected.snapshot(); await Effect.runPromise(host.run(host.newRequestKey(), [{ id, label: "First intermediate" }, { id, label: "Second intermediate" }]));
      const returned = rows(await native.mock.results[0]?.value); expect(returned.map(row => row.label)).toEqual(["First intermediate", "Second intermediate"]); scalarRows(returned);
      expect((await connected.read([id]))[0]?.label).toBe("Second intermediate"); expect(eventIds((await connected.snapshot()).events.slice(before.events.length), updated)).toEqual([id]);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("refuses incomplete missing inverse rows and rolls back an earlier actual upsert in a later failing batch", async () => {
    const host = await connected.prepareInverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptionTypes");
    try {
      for (const preimages of [[{ id: "sotype-update-missing-id-only" }], [{ id: "sotype-update-missing-code", label: "No code" }],
        [{ id: "sotype-update-failure", label: "Temporary prefix write" }, { id: "sotype-update-late-missing", label: "No code" }]]) {
        native.mockClear();
        const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), preimages)));
        expect(native).toHaveBeenCalledTimes(1); expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(reasons(result.failure)).toContain("invalidInput");
          for (const refusal of ["unsupportedProfile", "receiptMismatch", "unadmittedEvent"])
            expect(reasons(result.failure)).not.toContain(refusal);
        }
        expect(await connected.snapshot()).toEqual(before);
      }
    } finally { native.mockRestore(); }
  }, 240_000);

  it("retains a freshly inserted identity across a later duplicate upsert and both native action families", async () => {
    const host = await connected.prepareInverse(), id = "sotype-update-new-duplicate";
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptionTypes");
    try {
      const before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), [
        { id, label: "Created intermediate", code: "NEW" }, { id, label: "Updated intermediate" },
      ]))).toBeNull();
      const returned = rows(await native.mock.results[0]?.value);
      scalarRows(returned); expect(returned.map(row => row.label)).toEqual(["Created intermediate", "Updated intermediate"]);
      expect(returned.map(row => row.code)).toEqual(["NEW", "NEW"]);
      expect(await connected.read([id])).toEqual([returned[1]]);
      const emitted = (await connected.snapshot()).events.slice(before.events.length);
      expect(eventIds(emitted, created)).toEqual([id]); expect(eventIds(emitted, updated)).toEqual([id]);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("preserves active and historical Option references through scalar update and retained upsert", async () => {
    const selected = Object.values(shippingOptionTypeUpdateLinkedIds), optionIds = ["sotype-update-active-option", "sotype-update-historical-option"], before = await connected.read(optionIds);
    const host = await connected.prepare(), inverse = await connected.prepareRoundtrip();
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: selected }, update: { label: "Updated linked Type" } })))).toHaveLength(2);
    expect(roundtrip(await Effect.runPromise(inverse.run(inverse.newRequestKey(), { input: { selector: { id: selected }, update: { code: "Temporary linked code" } } }))).preimages).toHaveLength(2);
    expect(await connected.read(optionIds)).toEqual(before);
  }, 240_000);

  it("rolls back the exact whole root after hook failure and after a genuine forward/inverse late failure", async () => {
    const host = await connected.prepare({ shippingOptionTypesUpdated: () => { throw new Error("Native Type update hook failure"); } });
    const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: maximum[0]! }, update: { id: "sotype-update-outside", label: "Rolled back outside target" } })));
    expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    const inverse = await connected.prepareRoundtrip(), failed = await Effect.runPromise(Effect.result(inverse.run(inverse.newRequestKey(), { fail: true,
      input: { selector: { id: [...maximum] }, update: { id: "sotype-update-outside", label: "Late failed outside retarget" } } })));
    expect(Result.isFailure(failed)).toBe(true); if (Result.isFailure(failed)) expect(reasons(failed.failure)).toContain("Late native ShippingOptionType inverse failure");
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("keeps caught sibling denial root-fatal and revokes escaped native continuations", async () => {
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepare({ shippingOptionTypesUpdated: async (_payload, context) => {
      escaped = () => context.resources.fulfillment.upsertShippingOptionTypes([{ id: "sotype-update-protected", label: "Escaped mutation" }]);
      try { await context.container.resolve<{ createShippingProfiles: (input: unknown) => Promise<unknown> }>("fulfillment").createShippingProfiles({ name: "Denied sibling", type: "default" }); }
      catch { caught = true; }
    } });
    const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: maximum[0]! }, update: { label: "Poisoned" } })));
    expect(caught).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    if (escaped === undefined) throw new Error("Missing retained native method"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it.each(["order", "membership", "scalar", "relation", "event"] as const)("refuses forged native %s after actual updates", async mode => {
    const original = FulfillmentModuleService.prototype.updateShippingOptionTypes;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await original.call(this, ...args); if (!Array.isArray(output) || output.length !== 2) throw new Error("Missing genuine two-Type output");
      const first: unknown = output[0]; if (typeof first !== "object" || first === null) throw new Error("Missing genuine Type row");
      if (mode === "order") output.reverse(); else if (mode === "membership") Reflect.set(first, "id", "sotype-update-protected");
      else if (mode === "scalar") Reflect.set(first, "code", "Unstored forged code"); else if (mode === "relation") Reflect.set(first, "shipping_options", []);
      else {
        const bus: unknown = Reflect.get(this, "eventBusModuleService_"); if (typeof bus !== "object" || bus === null) throw new Error("Missing native event bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native emitter");
        await Reflect.apply(emit, bus, [[{ name: updated, data: { id: "sotype-update-protected" }, metadata: { source: "fulfillment", object: "shipping_option_type", action: "updated" } }], { internal: true }]);
      }
      return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: maximum.slice(0, 2) }, update: { code: "Actual staged code" } }))))).toBe(true);
      expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["list", "update"] as const)("refuses a skipped native %s lookup that forges an empty nonempty-selector result", async phase => {
    const host = await connected.prepare();
    const native = phase === "list" ? vi.spyOn(FulfillmentModuleService.prototype, "listShippingOptionTypes").mockResolvedValue([])
      : vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionTypes").mockResolvedValue([]);
    try {
      const before = await connected.snapshot();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        selector: { id: maximum[0]! }, update: { label: "Skipped native lookup" },
      })));
      expect(native).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("receiptMismatch");
      expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("authenticates the installed update profile and refuses managed, nested, unknown and oversized writes before native work", async () => {
    const creation = await Effect.runPromise(makeShippingOptionTypeCreationCommands());
    const invalid = await Effect.runPromise(Effect.result(prepareShippingOptionTypeUpdateWorkflow({ ...connected.options, modules: { fulfillment: {
      ...connected.installed,
      // @ts-expect-error Creation profile intentionally lacks genuine update methods.
      module: creation.workflow,
    } } })));
    expect(invalid).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const forged = await Effect.runPromise(Effect.result(prepareShippingOptionTypeUpdateWorkflow({ ...connected.options, modules: { fulfillment: { ...connected.installed, module: { ...connected.fulfillment.workflow } } } })));
    expect(forged).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const inherited: unknown = Object.create({ shippingOptionTypesUpdated: () => undefined });
    const invalidHooks: unknown[] = [inherited, { foreign: () => undefined }, { shippingOptionTypesUpdated: "invalid" }];
    for (const hooks of invalidHooks)
      // @ts-expect-error Deliberately invalid foreign hook registration.
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareShippingOptionTypeUpdateWorkflow({ ...connected.options, hooks }))))).toBe(true);
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionTypes");
    try {
      const before = await connected.snapshot();
      for (const value of [{ selector: {}, update: {} }, { selector: { id: [...maximum, "fifth"] }, update: {} },
        ...["created_at", "updated_at", "deleted_at", "shipping_options", "metadata", "foreign"].map(field => ({ selector: { id: maximum[0] }, update: { [field]: null } })),
        { selector: { id: maximum[0] }, update: { label: null } }, { selector: { id: maximum[0] }, update: { code: null } }, { selector: { id: maximum[0] }, update: {}, foreign: true }])
        // @ts-expect-error Exercise malformed root input at its actual runtime decoder.
        await expect(Effect.runPromise(host.run(host.newRequestKey(), value))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels in the native hook, rolls back and revokes still-pending resources", async () => {
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(); let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const host = await connected.prepare({ shippingOptionTypesUpdated: async (_payload, context) => {
      escaped = () => context.resources.fulfillment.updateShippingOptionTypes({ id: maximum[0]! }, { label: "Escaped after cancellation" });
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined));
    } });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { id: maximum[0]! }, update: { label: "Cancelled Type update" } }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt");
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing cancelled native resource"); await expect(escaped()).rejects.toBeDefined();
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); }
  }, 180_000);

  it("confines equal Type IDs and request keys to their accepted scope", async () => {
    const id = "sotype-update-scope", other = await prepareLogicalShippingOptionTypeUpdate(driver, close => cleanup.push(close), [shippingOptionTypeUpdateSeed(id)], {
      resource: connected.fixture.resource, fixtureIdentity: { deploymentId: "shipping_option_type_update_b", projectId: "shipping_option_type_update_b", uuidOffset: 810_000 },
    });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), beforeOther = await other.read([id]);
    const input = { selector: { id }, update: { label: "Scoped native Type" } };
    const output = await Effect.runPromise(left.run(key, input)); expect(await other.read([id])).toEqual(beforeOther);
    const otherOutput = await Effect.runPromise(right.run(key, input)); expect((await other.read([id]))[0]?.label).toBe("Scoped native Type");
    const after = await connected.snapshot(); expect(await Effect.runPromise(left.run(key, input))).toEqual(output); expect(await Effect.runPromise(right.run(key, input))).toEqual(otherOutput); expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it.skipIf(driver !== "postgres")("settles one of two overlapping native updates without lost state", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(); let arrivals = 0;
    const hooks = { shippingOptionTypesUpdated: async () => { arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); } };
    const left = await connected.prepare(hooks), right = await connected.prepare(hooks), id = "sotype-update-race", before = await connected.snapshot();
    try {
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { selector: { id }, update: { label: "Optimistic first" } }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { selector: { id }, update: { label: "Optimistic second" } }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      const winners = outcomes.filter(Exit.isSuccess), rejected = outcomes.filter(Exit.isFailure); expect(arrivals).toBe(2); expect(winners).toHaveLength(1); expect(rejected).toHaveLength(1);
      expect(reasons(rejected[0]?.cause)).toContain("writeConflict"); expect(await connected.read([id])).toEqual(rows(winners[0]?.value));
      const after = await connected.snapshot(); expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
      const emitted = after.events.slice(before.events.length); expect(eventIds(emitted, updated)).toEqual([id]); expect(eventIds(emitted, workflowUpdated)).toEqual([id]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 240_000);
});

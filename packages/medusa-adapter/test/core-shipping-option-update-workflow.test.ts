import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { inspectLogicalReferenceFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CoreNativeForeignKeyError, CoreNativeQueryError } from "../../persistence-postgres/src/core/api";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { shippingOptionUpdateResources } from "../src/workflow/policy";
import { prepareShippingOptionUpdateWorkflow, type ShippingOptionUpdateInput } from "../src/workflows/fulfillment/update-shipping-options";
import { prepareCoreShippingOptionUpdate, type ShippingOptionUpdateObservation } from "./support/core-shipping-option-update-fixture";
import { shippingOptionCreationInput, shippingOptionParents, shippingOptionRegionIds } from "./support/shipping-option-creation-fixture-data";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectWorkflowDefect, expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = []; let sharedCleanupCount = 0;
let connected: Awaited<ReturnType<typeof prepareCoreShippingOptionUpdate>>;
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
type Input = typeof ShippingOptionUpdateInput.Type;
const id = Schema.decodeUnknownSync(Schema.String);
const objectRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
function eventDelta(before: Inventory, after: Inventory) {
  const prior = new Set(before.events.map(event => JSON.stringify([event.familyId, event.ordinal])));
  return after.events.filter(event => !prior.has(JSON.stringify([event.familyId, event.ordinal])));
}
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}
function current(rows: readonly JsonObject[], key: string) {
  const row = rows.find(row => row.id === key);
  if (row === undefined) throw new Error("Missing native row " + key);
  return row;
}
function optionRules(rows: readonly JsonObject[], option: string) {
  return rows.filter(row => row.shipping_option_id === option && typeof row.attribute === "string");
}
function prices(rows: readonly JsonObject[], option: string) {
  const link = rows.find(row => row.shipping_option_id === option && typeof row.price_set_id === "string");
  if (link === undefined) throw new Error("Missing genuine Shipping Option Pricing Link");
  return rows.filter(row => row.price_set_id === link.price_set_id && typeof row.currency_code === "string");
}
function nativeState(rows: readonly JsonObject[]) {
  return rows.map(({ updated_at: _time, ...row }) => encodeCanonicalJson(row, issue => {
    throw new Error("Native row lost a canonical JSON field", { cause: issue });
  })).sort();
}
async function scenario(historicalParents = false) {
  return prepareCoreShippingOptionUpdate(driver, close => cleanup.push(close), { physical: connected.fixture.physical, historicalParents });
}
function stored(snapshot: Inventory, key: string) {
  const row = snapshot.rows.find(row => row.value.id === key);
  if (row === undefined) throw new Error("Missing actual Core row " + key);
  return row;
}
function fkFailure<Value, Failure>(outcome: Exit.Exit<Value, Failure>, field: string, target: string) {
  const failure = expectWorkflowRefusal(outcome, "invalidInput");
  expect(failure.cause).toBeInstanceOf(CoreNativeForeignKeyError);
  expect(failure.cause).toMatchObject({ reason: "targetMissing", sourceFields: [field], targetFields: ["id"] });
  expect(inspectLogicalReferenceFailure(failure.cause)).toMatchObject({ storage: "core", origin: "checkpoint",
    sourceColumns: [field], target: { columns: ["id"], values: [target] } });
  return failure;
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine native retained input getter");
  const option = Schema.Struct({ createdIds: Schema.Array(Schema.String), updatedPreviousData: Schema.Array(Schema.Json) });
  const pricing = Schema.Array(Schema.Struct({ shipping_option_id: Schema.String, price_set_id: Schema.String, prices: Schema.Array(Schema.Json) }))
    .check(Schema.isMinLength(1));
  const event = Schema.Struct({ eventGroupId: Schema.String, eventName: Schema.Literal("shipping-option.updated") });
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(structuredClone(value)); return value;
  });
  const one = <Value>(schema: Schema.Codec<Value>) => {
    const selected = values.filter(Schema.is(schema));
    if (selected.length !== 1) throw new Error("Expected exactly one genuine native retained input");
    const value = selected[0];
    if (value === undefined) throw new Error("Missing genuine retained input");
    return value;
  };
  const definitions = { option, pricing, event };
  return { restore: () => spy.mockRestore(), count: (kind: keyof typeof definitions) => values.filter(Schema.is(definitions[kind])).length,
    evidence: () => ({ all: structuredClone(values), option: values.filter(Schema.is(option)), pricing: values.filter(Schema.is(pricing)), event: values.filter(Schema.is(event)) }),
    get: () => ({ option: one(option), pricing: one(pricing), event: one(event) }) };
}
async function measured(host: Awaited<ReturnType<typeof connected.prepare>>, input: Input) {
  let calls = 0;
  const before = await connected.snapshot();
  const result = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
    observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
  })));
  const after = await connected.snapshot(), events = eventDelta(before, after);
  console.info("Shipping Option update calls/messages", calls, events.length);
  expect(calls).toBeLessThanOrEqual(shippingOptionUpdateResources.calls);
  expect(events.length).toBeLessThanOrEqual(shippingOptionUpdateResources.eventMessages);
  return { result, events };
}

describe("genuine native Shipping Option updates", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreShippingOptionUpdate(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { await finishOrderFixture([async () => { await connected?.closeCaseHosts(); }, ...cleanup.splice(sharedCleanupCount).reverse()]); }, 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("executes empty native dependencies and replays one settled root", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    const after = await connected.snapshot();
    expect(eventDelta(before, after)).toEqual([]);
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("updates partial scalar and nested JSON data through the native workflow and preserves replay", async () => {
    const seeded = await connected.seed("partial-update"), option = id(seeded[0]?.id), beforeRows = await connected.read();
    const host = await connected.prepare(), key = host.newRequestKey(), input = [{ id: option, name: " Raw Native Name ",
      data: { nested: { enabled: true, values: ["raw", "value"] } }, metadata: { operator: "eq", nested: { x: 1 } } }];
    const before = await connected.snapshot(), result = await Effect.runPromise(host.run(key, input));
    expect(result).toMatchObject([{ id: option, name: input[0]?.name, data: input[0]?.data, metadata: input[0]?.metadata }]);
    const afterRows = await connected.read(), after = await connected.snapshot();
    expect(prices(afterRows, option)).toEqual(prices(beforeRows, option));
    expect(optionRules(afterRows, option)).toEqual(optionRules(beforeRows, option));
    const events = eventDelta(before, after);
    expect(events.filter(event => event.envelope.contract === "shipping-option.updated").map(event => event.envelope.message))
      .toEqual([{ name: "shipping-option.updated", data: option, metadata: { eventGroupId: expect.any(String) } }]);
    expect(new Set(events.map(event => event.timestamp)).size).toBe(1);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    await expect(Effect.runPromise(host.run(key, [{ id: option, name: "Different replay body" }]))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("preserves the native null-array preimage-helper refusal and rolls back the complete root", async () => {
    const seeded = await connected.seed("null-array-refusal"), option = id(seeded[0]?.id), host = await connected.prepare();
    const before = await connected.snapshot(), outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), [{ id: option,
      name: "Uncommitted null array", data: { nested: { values: [null, "raw"] } } }]));
    if (Exit.isSuccess(outcome)) throw new Error("Expected the native null-array preimage-helper failure");
    const original = outcome.cause.reasons[0];
    if (original === undefined || !Cause.isDieReason(original) || !(original.defect instanceof TypeError))
      throw new Error("Lost the original native null-array TypeError");
    expect(original.defect.message).toBe("Cannot convert undefined or null to object");
    expect(original.defect.stack).toContain("getSelectsAndRelationsFromObjectArray");
    expectWorkflowDefect(outcome, original.defect);
    expect(failurePath(outcome.cause)).toEqual([original.defect.message, "rollbackOnly"]);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("preserves omitted prices and deletes prices only for an explicit empty native replacement", async () => {
    const seeded = await connected.seed("price-omission"), option = id(seeded[0]?.id), before = await connected.read(), host = await connected.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, name: "No price change" }]));
    expect(prices(await connected.read(), option)).toEqual(prices(before, option));
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, prices: [] }]));
    const after = await connected.read();
    expect(prices(after, option)).toEqual([]);
    const oldIds = new Set(prices(before, option).map(price => price.id));
    expect(after.some(row => oldIds.has(row.price_id))).toBe(false);
  }, 240_000);

  it("retains Rule[] no-op and merges a partial existing Rule before native validation", async () => {
    const seeded = await connected.seed("rule-omission"), option = id(seeded[0]?.id), before = await connected.read(), host = await connected.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, rules: [] }]));
    expect(optionRules(await connected.read(), option)).toEqual(optionRules(before, option));
    const rule = optionRules(before, option)[0];
    if (rule === undefined) throw new Error("Missing actual native Rule");
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, rules: [{ id: id(rule.id), value: "changed" }] }]));
    expect(optionRules(await connected.read(), option)).toEqual([{ ...rule, value: "changed", updated_at: expect.any(String) }]);
  }, 240_000);

  it("touches an existing Type object while a scalar reference only changes the Option foreign key", async () => {
    const seeded = await connected.seed("type-reference"), option = id(seeded[0]?.id), beforeRows = await connected.read();
    const type = id(current(beforeRows, option).shipping_option_type_id), host = await connected.prepare(), before = await connected.snapshot();
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, type: { id: type } }]));
    const touched = await connected.snapshot(), typeRow = current(await connected.read(), type);
    expect(typeRow).toMatchObject({ id: type, created_at: current(beforeRows, type).created_at });
    expect(eventDelta(before, touched).some(event => event.envelope.contract === "fulfillment.shipping-option-type.updated")).toBe(true);
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, type_id: shippingOptionParents.type }]));
    const referenced = await connected.snapshot();
    expect(current(await connected.read(), option).shipping_option_type_id).toBe(shippingOptionParents.type);
    expect(eventDelta(touched, referenced).some(event => event.envelope.contract === "fulfillment.shipping-option-type.updated")).toBe(false);
  }, 240_000);

  it("retains a newly created inline Type after the genuine inverse restores the original reference", async () => {
    const seeded = await connected.seed("inline-type-inverse"), option = id(seeded[0]?.id), beforeRows = await connected.read();
    const originalType = current(beforeRows, option).shipping_option_type_id, tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, type: { label: "Inline139", code: "inline139" } }]))).toBeNull();
      const rows = await connected.read();
      expect(current(rows, option).shipping_option_type_id).toBe(originalType);
      expect(rows.filter(row => row.code === "inline139")).toHaveLength(1);
      expect(tap.get().option?.updatedPreviousData).toHaveLength(1);
    } finally { tap.restore(); }
  }, 240_000);

  it("hydrates the native union of mixed batch relations on every returned Option and restores it through genuine inverses", async () => {
    const seeded = await connected.seed("mixed-batch", 2), rows = await connected.read(), first = id(seeded[0]?.id), second = id(seeded[1]?.id);
    const host = await connected.prepare(), result = await Effect.runPromise(host.run(host.newRequestKey(), [{ id: first, name: "Mixed first changed" },
      { id: second, type: { id: id(current(rows, second).shipping_option_type_id) } }]));
    expect(result).toMatchObject([{ id: first, name: "Mixed first changed", type: { id: current(rows, first).shipping_option_type_id } },
      { id: second, type: { id: current(rows, second).shipping_option_type_id } }]);

    const inverseSeed = await connected.seed("mixed-batch-inverse", 2), beforeRows = await connected.read(), tap = retainedTap();
    try {
      const roundtrip = await connected.prepareRoundtrip(tap.get), a = id(inverseSeed[0]?.id), b = id(inverseSeed[1]?.id);
      expect(await Effect.runPromise(roundtrip.run(roundtrip.newRequestKey(), [{ id: a, name: "Mixed inverse changed" },
        { id: b, type: { id: id(current(beforeRows, b).shipping_option_type_id) } }]))).toBeNull();
      expect(nativeState(await connected.read())).toEqual(nativeState(beforeRows));
    } finally { tap.restore(); }
  }, 240_000);

  it("returns the final shared Type state after both ordered native writes and restores its original preimage", async () => {
    const seeded = await connected.seed("shared-type-batch", 2), first = id(seeded[0]?.id), second = id(seeded[1]?.id), host = await connected.prepare();
    const sharedType = id(current(await connected.read(), first).shipping_option_type_id);
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: second, type_id: sharedType }]));
    const result = await Effect.runPromise(host.run(host.newRequestKey(), [{ id: first, type: { id: sharedType, label: "Shared first write" } },
      { id: second, type: { id: sharedType, label: "Shared final write" } }]));
    expect(result).toMatchObject([{ id: first, type: { id: sharedType, label: "Shared final write" } },
      { id: second, type: { id: sharedType, label: "Shared final write" } }]);
    expect(current(await connected.read(), sharedType).label).toBe("Shared final write");

    const inverseSeed = await connected.seed("shared-type-inverse", 2), a = id(inverseSeed[0]?.id), b = id(inverseSeed[1]?.id);
    const inverseType = id(current(await connected.read(), a).shipping_option_type_id);
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: b, type_id: inverseType }]));
    const beforeRows = await connected.read(), tap = retainedTap();
    try {
      const roundtrip = await connected.prepareRoundtrip(tap.get);
      expect(await Effect.runPromise(roundtrip.run(roundtrip.newRequestKey(), [{ id: a, type: { id: inverseType, label: "Shared inverse first" } },
        { id: b, type: { id: inverseType, label: "Shared inverse final" } }]))).toBeNull();
      expect(nativeState(await connected.read())).toEqual(nativeState(beforeRows));
    } finally { tap.restore(); }
  }, 240_000);

  it("admits all four original and four replacement Types and retains native inline-Type orphans after inverse", async () => {
    const seeded = await connected.seed("maximum-inline-type", 4), original = await connected.read(), oldTypes = seeded.map(row =>
      id(current(original, id(row.id)).shipping_option_type_id)), host = await connected.prepare();
    const { result, events } = await measured(host, seeded.map((row, index) => ({ id: id(row.id),
      type: { label: "Maximum inline " + index, code: "maximum-inline-new-" + index } })));
    const forward = await connected.read(), replacements = forward.filter(row => typeof row.code === "string" && row.code.startsWith("maximum-inline-new-"));
    expect(replacements).toHaveLength(4);
    expect(new Set([...oldTypes, ...replacements.map(row => id(row.id))]).size).toBe(8);
    expect(result.map(row => row.type)).toEqual(seeded.map((_row, index) => expect.objectContaining({ code: "maximum-inline-new-" + index })));
    expect(events.filter(event => event.envelope.contract === "fulfillment.shipping-option-type.created")).toHaveLength(4);

    const inverseSeed = await connected.seed("maximum-inline-type-inverse", 4), beforeRows = await connected.read(), tap = retainedTap();
    const originalIds = inverseSeed.map(row => [id(row.id), id(current(beforeRows, id(row.id)).shipping_option_type_id)] as const);
    try {
      const roundtrip = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot();
      expect(await Effect.runPromise(roundtrip.run(roundtrip.newRequestKey(), inverseSeed.map((row, index) => ({ id: id(row.id),
        type: { label: "Maximum inverse inline " + index, code: "maximum-inline-inverse-new-" + index } }))))).toBeNull();
      const rows = await connected.read(), orphans = rows.filter(row => typeof row.code === "string" && row.code.startsWith("maximum-inline-inverse-new-"));
      expect(orphans).toHaveLength(4); expect(rows).toHaveLength(beforeRows.length + 4);
      for (const [option, type] of originalIds) expect(current(rows, id(option)).shipping_option_type_id).toBe(type);
      const orphanIds = new Set(orphans.map(row => id(row.id)));
      expect(nativeState(rows.filter(row => typeof row.id !== "string" || !orphanIds.has(row.id)))).toEqual(nativeState(beforeRows));
      expect(eventDelta(before, await connected.snapshot()).some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
    } finally { tap.restore(); }
  }, 240_000);

  it("updates a native partial price by identity without replacing that identity", async () => {
    const seeded = await connected.seed("partial-price"), option = id(seeded[0]?.id), old = prices(await connected.read(), option)[0];
    if (old === undefined) throw new Error("Missing native Price");
    const host = await connected.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, prices: [{ id: id(old.id), amount: 765 }] }]));
    const changed = prices(await connected.read(), option);
    expect(changed).toHaveLength(1); expect(changed[0]?.id).toBe(old.id); expect(Number(changed[0]?.amount)).toBe(765);
    const beforeIdentityOnly = nativeState(await connected.read());
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, prices: [{ id: id(old.id) }] }]));
    expect(nativeState(await connected.read())).toEqual(beforeIdentityOnly);
  }, 240_000);

  it("replaces different Rule attributes on a surviving Price and restores original child identities in the native inverse", async () => {
    const patch = (option: string, price: string) => [{ id: option, prices: [{ id: price, currency_code: "usd", amount: 777,
      rules: [{ attribute: "item_total", operator: "gte", value: 20 }, { attribute: "item_total", operator: "lt", value: 2000 }] }] }];
    const seeded = await connected.seed("surviving-price-rules"), option = id(seeded[0]?.id), oldRows = await connected.read(), price = prices(oldRows, option)[0];
    if (price === undefined) throw new Error("Missing genuine original Price");
    const oldRules = oldRows.filter(row => row.price_id === price.id), host = await connected.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), patch(option, id(price.id))));
    const forward = await connected.read(), retainedPrice = prices(forward, option);
    expect(retainedPrice).toHaveLength(1); expect(retainedPrice[0]?.id).toBe(price.id);
    expect(Number(retainedPrice[0]?.amount)).toBe(777);
    const replacements = forward.filter(row => row.price_id === price.id);
    expect(replacements.map(row => row.attribute)).toEqual(["item_total", "item_total"]);
    expect(replacements.some(row => oldRules.some(old => old.id === row.id))).toBe(false);

    const inverseSeed = await connected.seed("surviving-price-rules-inverse"), inverseOption = id(inverseSeed[0]?.id), beforeRows = await connected.read();
    const inversePrice = prices(beforeRows, inverseOption)[0];
    if (inversePrice === undefined) throw new Error("Missing genuine retained Price");
    const originals = beforeRows.filter(row => row.price_id === inversePrice.id), tap = retainedTap();
    try {
      const roundtrip = await connected.prepareRoundtrip(tap.get);
      expect(await Effect.runPromise(roundtrip.run(roundtrip.newRequestKey(), patch(inverseOption, id(inversePrice.id))))).toBeNull();
      const restored = await connected.read();
      expect(prices(restored, inverseOption)[0]?.id).toBe(inversePrice.id);
      expect(restored.filter(row => row.price_id === inversePrice.id).map(row => [row.id, row.created_at]).sort())
        .toEqual(originals.map(row => [row.id, row.created_at]).sort());
      expect(nativeState(restored)).toEqual(nativeState(beforeRows));
    } finally { tap.restore(); }
  }, 240_000);

  it("restores original Rule identities and created times through the approved native retained callback", async () => {
    const seeded = await connected.seed("rule-inverse"), option = id(seeded[0]?.id), beforeRows = await connected.read(), tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, [{ id: option, rules: [{ attribute: "replacement", operator: "eq", value: "new" }], prices: [] }]))).toBeNull();
      const after = await connected.snapshot(), rows = await connected.read();
      expect(nativeState(rows)).toEqual(nativeState(beforeRows));
      expect(optionRules(rows, option).map(row => [row.id, row.created_at])).toEqual(optionRules(beforeRows, option).map(row => [row.id, row.created_at]));
      const timestamp = expectCheckoutSettlement(before, after, key);
      for (const original of optionRules(beforeRows, option)) {
        const previous = stored(before, id(original.id)), restored = stored(after, id(original.id));
        expect(restored.value).toMatchObject({ _id: previous.value._id, _creationTime: previous.value._creationTime, created_at: original.created_at });
        expect(after.revisions.filter(row => row.timestamp === timestamp && row.value?._id === previous.value._id))
          .toMatchObject([{ previous: previous.timestamp, deleted: false }]);
      }
      expect(eventDelta(before, after).some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
      expect(eventDelta(before, after).some(event => event.envelope.contract === "fulfillment.shipping-option-rule.created")).toBe(true);
    } finally { tap.restore(); }
  }, 240_000);

  it("restores a changed surviving Rule through all three genuine callbacks without timestamp authority", async () => {
    const local = await scenario(), seeded = await local.seed("surviving-rule-inverse"), option = id(seeded[0]?.id);
    const beforeRows = await local.read(), original = optionRules(beforeRows, option)[0];
    if (original === undefined) throw new Error("Missing genuine surviving Rule");
    const tap = retainedTap(), observations: ShippingOptionUpdateObservation[] = [];
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions"),
      pricing = vi.spyOn(PricingModuleService.prototype, "updatePriceSets");
    try {
      const host = await local.prepareRoundtrip(tap.get, false, observations), key = host.newRequestKey(), before = await local.snapshot();
      const beforeInventory = await local.fixture.inventory();
      const outcome = await Effect.runPromiseExit(host.run(key, [{ id: option, rules: [{ id: id(original.id),
        attribute: id(original.attribute), operator: id(original.operator), value: "changed-surviving-value" }] }]));
      const after = await local.snapshot();
      if (Exit.isFailure(outcome)) {
        // A failing owner witness must retain its complete Cause, real packets,
        // chronological activity and durable history before cleanup.
        console.error("Native44 surviving Rule inverse witness", inspect({ outcome, retained: tap.evidence(), observations,
          before: beforeInventory, after: await local.fixture.inventory() }, { depth: null, maxArrayLength: null, maxStringLength: null }));
        throw new Error(Cause.pretty(outcome.cause), { cause: outcome.cause });
      }
      expect(outcome.value).toBeNull(); expect(native).toHaveBeenCalledTimes(2); expect(pricing).toHaveBeenCalledTimes(1);
      expect(nativeState(await local.read())).toEqual(nativeState(beforeRows));
      const restored = current(await local.read(), id(original.id)), originalStored = stored(before, id(original.id)), restoredStored = stored(after, id(original.id));
      expect(restored.created_at).toBe(original.created_at);
      expect(Date.parse(id(restored.updated_at))).toBeGreaterThanOrEqual(Date.parse(id(original.updated_at)));
      expect(restoredStored.value._id).toBe(originalStored.value._id);
      expect(restoredStored.value._creationTime).toBe(originalStored.value._creationTime);
      const timestamp = expectCheckoutSettlement(before, after, key);
      expect(after.revisions.filter(row => row.timestamp === timestamp && row.value?._id === originalStored.value._id))
        .toMatchObject([{ deleted: false, previous: originalStored.timestamp, value: { id: original.id, value: original.value } }]);
      const writes = observations.filter(entry => entry.call.commandName === "shippingOptionUpsertForUpdate").flatMap(entry => entry.activity.mutations)
        .filter(mutation => mutation.table === "shipping_option_rule");
      expect(writes.map(mutation => mutation.operation)).toEqual(["patch", "patch"]);
      expect(writes.every(mutation => mutation.before?.id === original.id && mutation.after?.id === original.id)).toBe(true);
      expect(eventDelta(before, after).some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
    } finally { tap.restore(); native.mockRestore(); pricing.mockRestore(); }
  }, 240_000);

  it("removes introduced Rules when the genuine retained preimage contained an empty Rule cohort", async () => {
    const creator = await connected.creation.prepare(), created = await Effect.runPromise(creator.run(creator.newRequestKey(),
      shippingOptionCreationInput("empty-rule-inverse").map(option => ({ ...option, rules: [] }))));
    const option = id(created[0]?.id), beforeRows = await connected.read(), tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, rules: [{ attribute: "introduced", operator: "eq", value: "true" }] }]))).toBeNull();
      const rows = await connected.read(); expect(optionRules(rows, option)).toEqual([]);
      expect(nativeState(rows)).toEqual(nativeState(beforeRows));
    } finally { tap.restore(); }
  }, 240_000);

  it("updates the complete four-Option graph including eight distinct Regions under one settlement", async () => {
    const seeded = await connected.seed("maximum-update", 4, true), host = await connected.prepare();
    const input = seeded.map((option, index) => ({ id: id(option.id), name: "Maximum updated " + index,
      rules: [0, 1, 2, 3].map(rule => ({ attribute: "new" + rule, operator: "eq", value: "replacement" + rule })),
      prices: [0, 1].map(price => ({ region_id: id(shippingOptionRegionIds[index * 2 + price]), amount: 200 + index + price,
        rules: [{ attribute: "cart_total", operator: "gte", value: 2 }, { attribute: "cart_total", operator: "lt", value: 200 }] })) }));
    const { result, events } = await measured(host, input), rows = await connected.read(), ids = new Set(input.map(option => option.id));
    expect(result.map(option => option.name)).toEqual(input.map(option => option.name));
    expect(rows.filter(row => ids.has(id(row.shipping_option_id ?? "")) && typeof row.attribute === "string")).toHaveLength(16);
    const priceRows = input.flatMap(option => prices(rows, option.id)); expect(priceRows).toHaveLength(8);
    const priceIds = new Set(priceRows.map(row => row.id));
    expect(rows.filter(row => priceIds.has(row.price_id ?? null))).toHaveLength(24);
    expect(new Set(rows.filter(row => priceIds.has(row.price_id ?? null) && row.attribute === "region_id").map(row => row.value))).toEqual(new Set(shippingOptionRegionIds));
    expect(new Set(events.map(event => event.timestamp)).size).toBe(1);
  }, 240_000);

  it("runs the maximum graph and all three genuine retained inverses without losing Rule or Pricing history", async () => {
    const seeded = await connected.seed("maximum-update-inverse", 4, true), beforeRows = await connected.read(), tap = retainedTap();
    try {
      const trace: ShippingOptionUpdateObservation[] = [];
      const host = await connected.prepareRoundtrip(tap.get, false, trace), input = seeded.map((option, index) => ({ id: id(option.id), name: "Maximum inverse " + index,
        rules: [0, 1, 2, 3].map(rule => ({ attribute: "replacement" + rule, operator: "eq", value: "new" + rule })),
        prices: [0, 1].map(price => ({ region_id: id(shippingOptionRegionIds[index * 2 + price]), amount: 600 + index + price,
          rules: [{ attribute: "cart_total", operator: "gte", value: 3 }, { attribute: "cart_total", operator: "lt", value: 300 }] })) }));
      let calls = 0; const before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      const after = await connected.snapshot(), events = eventDelta(before, after);
      expect(nativeState(await connected.read())).toEqual(nativeState(beforeRows));
      expect(events.some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
      expect(events.some(event => event.envelope.contract === "pricing.price-rule.created")).toBe(true);
      expect(new Set(events.map(event => event.timestamp)).size).toBe(1);
      const timestamp = expectCheckoutSettlement(before, after, key), selected = new Set(seeded.map(row => id(row.id)));
      const originals = beforeRows.filter(row => selected.has(id(row.shipping_option_id ?? "")) && typeof row.attribute === "string");
      expect(originals).toHaveLength(16);
      for (const original of originals) {
        const previous = stored(before, id(original.id)), restored = stored(after, id(original.id));
        expect(restored.value).toMatchObject({ _id: previous.value._id, _creationTime: previous.value._creationTime, created_at: original.created_at });
        expect(after.revisions.filter(row => row.timestamp === timestamp && row.value?._id === previous.value._id))
          .toMatchObject([{ previous: previous.timestamp, deleted: false }]);
      }
      const union = new Set<string>();
      for (const mutation of trace.flatMap(entry => entry.activity.mutations).filter(mutation => mutation.table === "shipping_option_rule"))
        for (const row of [mutation.before, mutation.after]) if (row !== null) union.add(id(row.id));
      expect(union.size).toBe(32);
      console.info("Shipping Option maximum update inverse calls/messages", calls, events.length);
      expect(calls).toBeLessThanOrEqual(shippingOptionUpdateResources.calls);
      expect(events.length).toBeLessThanOrEqual(shippingOptionUpdateResources.eventMessages);
    } finally { tap.restore(); }
  }, 240_000);

  it("isolates identical endpoint IDs in another application scope on the same database resource", async () => {
    const baseline = await connected.read(), selected = await scenario();
    const seeded = await selected.seed("isolated-update"), option = id(seeded[0]?.id), host = await selected.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, name: "Other scope", prices: [] }]));
    expect(current(await selected.read(), option).name).toBe("Other scope");
    expect(prices(await selected.read(), option)).toEqual([]); expect(await connected.read()).toEqual(baseline);
  }, 240_000);

  it.each(["calculated", "missing-region", "invalid-operator", "missing-rule"] as const)("preserves native %s refusal and complete rollback", async mode => {
    const seeded = await connected.seed("refusal-" + mode), option = id(seeded[0]?.id), host = await connected.prepare();
    const patch = mode === "calculated" ? { id: option, price_type: "calculated" as const }
      : mode === "missing-region" ? { id: option, prices: [{ region_id: "missing-region139", amount: 1 }] }
        : mode === "invalid-operator" ? { id: option, prices: [{ currency_code: "usd", amount: 1, rules: [{ attribute: "cart_total", operator: "invalid", value: 1 }] }] }
          : { id: option, rules: [{ id: "missing-rule139", value: "new" }] };
    const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), [patch])));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(failurePath(outcome.failure).join("\n")).toContain({ calculated: "Cannot calcuate pricing for:",
      "missing-region": "Cannot create prices for non-existent regions", "invalid-operator": "operator should be one of", "missing-rule": "The following rules does not exists:" }[mode]);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back a late native inverse failure after pending event clear and complete original-ID restoration", async () => {
    const seeded = await connected.seed("late-update-inverse"), option = id(seeded[0]?.id), tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, true), before = await connected.snapshot();
      const outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), [{ id: option, prices: [],
        rules: [{ attribute: "late", operator: "eq", value: "replacement" }] }]));
      if (Exit.isSuccess(outcome)) throw new Error("Expected the late native Shipping Option update inverse failure");
      const original = outcome.cause.reasons[0];
      if (original === undefined || !Cause.isDieReason(original) || !(original.defect instanceof Error))
        throw new Error("Lost the original native Shipping Option update inverse Error");
      expect(original.defect.constructor).toBe(Error);
      expect(original.defect.message).toBe("Late native Shipping Option update inverse failure");
      expect(original.defect.stack).toContain("core-shipping-option-update-fixture.ts");
      expectWorkflowDefect(outcome, original.defect);
      expect(failurePath(outcome.cause)).toEqual([original.defect.message, "rollbackOnly"]);
      expect(tap.get().option?.updatedPreviousData).toHaveLength(1);
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 240_000);

  it("keeps native key-only calls unwritten while equal supplied scalars still touch the Option", async () => {
    const local = await scenario(), seeded = await local.seed("key-only-native"), option = id(seeded[0]?.id);
    const trace: ShippingOptionUpdateObservation[] = [], host = await local.prepare(trace), before = await local.snapshot();
    await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option }]));
    const keyOnly = trace.find(entry => entry.call.commandName === "shippingOptionUpsertForUpdate");
    if (keyOnly === undefined) throw new Error("Missing real key-only native call");
    expect(keyOnly.call.input).toEqual([{ id: option }]); expect(keyOnly.activity.mutations).toEqual([]);
    expect(stored(await local.snapshot(), option)).toEqual(stored(before, option));
    trace.splice(0);
    const row = current(await local.read(), option), key = host.newRequestKey(), touchedBefore = await local.snapshot();
    await Effect.runPromise(host.run(key, [{ id: option, name: id(row.name) }]));
    const equal = trace.find(entry => entry.call.commandName === "shippingOptionUpsertForUpdate");
    if (equal === undefined) throw new Error("Missing real equal-scalar native call");
    expect(equal.activity.mutations.map(mutation => [mutation.table, mutation.operation])).toEqual([["shipping_option", "patch"]]);
    const after = await local.snapshot(), prior = stored(touchedBefore, option), changed = stored(after, option);
    expect(changed.value._id).toBe(prior.value._id); expect(changed.value._creationTime).toBe(prior.value._creationTime);
    expect(changed.value.created_at).toBe(prior.value.created_at);
    expect(Date.parse(id(changed.value.updated_at))).toBeGreaterThanOrEqual(Date.parse(id(prior.value.updated_at)));
    expectCheckoutSettlement(touchedBefore, after, key);
  }, 240_000);

  it("does not patch an identical surviving Rule during forward execution or its genuine inverse", async () => {
    const local = await scenario(), seeded = await local.seed("unchanged-surviving-rule"), option = id(seeded[0]?.id);
    const beforeRows = await local.read(), original = optionRules(beforeRows, option)[0];
    if (original === undefined) throw new Error("Missing actual unchanged Rule");
    const value = original.value;
    if (value === undefined) throw new Error("Missing actual unchanged Rule value");
    const tap = retainedTap(), trace: ShippingOptionUpdateObservation[] = [];
    try {
      const host = await local.prepareRoundtrip(tap.get, false, trace), before = await local.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, rules: [{ id: id(original.id),
        attribute: id(original.attribute), operator: id(original.operator), value }] }]))).toBeNull();
      const after = await local.snapshot();
      expect(stored(after, id(original.id))).toEqual(stored(before, id(original.id)));
      expect(trace.filter(entry => entry.call.commandName === "shippingOptionUpsertForUpdate")).toHaveLength(2);
      expect(trace.flatMap(entry => entry.activity.mutations).filter(mutation => mutation.table === "shipping_option_rule")).toEqual([]);
      expect(optionRules(await local.read(), option)).toEqual([original]);
      expect(eventDelta(before, after).some(event => event.envelope.contract === "fulfillment.shipping-option-rule.updated")).toBe(false);
      expect(eventDelta(before, after).some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
    } finally { tap.restore(); }
  }, 240_000);

  it("executes actual Type, Option and Rule phases before the next root and retains final union hydration", async () => {
    const local = await scenario(), seeded = await local.seed("ordered-native-update", 2), first = id(seeded[0]?.id), second = id(seeded[1]?.id);
    const sharedType = id(current(await local.read(), first).shipping_option_type_id), assign = await local.prepare();
    await Effect.runPromise(assign.run(assign.newRequestKey(), [{ id: second, type_id: sharedType }]));
    const trace: ShippingOptionUpdateObservation[] = [], host = await local.prepare(trace), before = await local.snapshot(), key = host.newRequestKey();
    const result = await Effect.runPromise(host.run(key, [{ id: first, name: "Mixed first native root", type: { id: sharedType, label: "First state" },
      rules: [{ attribute: "replacement", operator: "eq", value: "new" }] }, { id: second, type: { id: sharedType, label: "Final state" } }]));
    expect(result).toMatchObject([{ id: first, type: { id: sharedType, label: "Final state" } },
      { id: second, type: { id: sharedType, label: "Final state" } }]);
    const write = trace.find(entry => entry.call.commandName === "shippingOptionUpsertForUpdate");
    if (write === undefined) throw new Error("Missing actual mixed native update call");
    expect(write.activity.mutations.map(mutation => [mutation.table, mutation.operation])).toEqual([
      ["shipping_option_type", "patch"], ["shipping_option", "patch"], ["shipping_option_rule", "delete"], ["shipping_option_rule", "insert"],
      ["shipping_option_type", "patch"], ["shipping_option", "patch"],
    ]);
    const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, key), original = stored(before, sharedType);
    expect(after.revisions.filter(row => row.timestamp === timestamp && row.value?._id === original.value._id))
      .toMatchObject([{ previous: original.timestamp, deleted: false, value: { label: "Final state", _creationTime: original.value._creationTime } }]);
  }, 240_000);

  it.each([false, true])("uses physical historical FK targets and preserves native scalar-Type preimage omission (inverse=%s)", async inverse => {
    const local = await scenario(true), seeded = await local.seed("historical-update-" + inverse), option = id(seeded[0]?.id), tap = retainedTap();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const before = await local.read(), host = inverse ? await local.prepareRoundtrip(tap.get) : await local.prepare();
      const parents = before.filter(row => row.id === shippingOptionParents.profile || row.id === shippingOptionParents.type);
      expect(parents).toHaveLength(2); expect(parents.every(row => row.deleted_at !== null)).toBe(true);
      await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, name: "Historical physical assignment",
        shipping_profile_id: shippingOptionParents.profile, type_id: shippingOptionParents.type }]));
      const forward = native.mock.results[0];
      if (forward === undefined || forward.type !== "return") throw new Error("Missing genuine native historical update result");
      expect(objectRows(await forward.value)).toMatchObject([{ id: option, shipping_profile_id: shippingOptionParents.profile,
        shipping_option_type_id: shippingOptionParents.type, type: null }]);
      const after = await local.read(); expect(after.filter(row => row.id === shippingOptionParents.profile || row.id === shippingOptionParents.type)).toEqual(parents);
      expect(current(after, option).shipping_option_type_id).toBe(shippingOptionParents.type);
      if (inverse) {
        expect(native).toHaveBeenCalledTimes(2);
        expect(current(after, option).name).toBe(current(before, option).name);
        const preimage = objectRows(tap.get().option.updatedPreviousData)[0];
        if (preimage === undefined) throw new Error("Missing actual historical inverse preimage");
        for (const field of ["type_id", "type", "shipping_option_type_id"]) expect(Object.hasOwn(preimage, field)).toBe(false);
      } else expect(native).toHaveBeenCalledTimes(1);
    } finally { tap.restore(); native.mockRestore(); }
  }, 240_000);

  it("checks the retained historical Profile afterimage even when both actual update inputs omit its FK", async () => {
    const local = await scenario(true), seeded = await local.seed("omitted-historical-profile"), option = id(seeded[0]?.id), tap = retainedTap();
    const trace: ShippingOptionUpdateObservation[] = [];
    try {
      const before = await local.read(), original = current(before, option), generatedType = current(before, id(original.shipping_option_type_id));
      expect(generatedType.deleted_at).toBeNull();
      const host = await local.prepareRoundtrip(tap.get, false, trace);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, name: "Omitted historical Profile changed" }]))).toBeNull();
      const calls = trace.filter(entry => entry.call.commandName === "shippingOptionUpsertForUpdate"); expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(Object.keys(objectRows(call.call.input)[0] ?? {}).sort()).toEqual(["id", "name"]);
        expect(call.activity.observedRows.some(row => row.table === "shipping_profile" && row.row.id === shippingOptionParents.profile && row.row.deleted_at !== null)).toBe(true);
      }
      expect(Object.keys(objectRows(tap.get().option.updatedPreviousData)[0] ?? {}).sort()).toEqual(["id", "name"]);
      expect(nativeState(await local.read())).toEqual(nativeState(before));
    } finally { tap.restore(); }
  }, 240_000);

  it.each([false, true])("preserves a physical historical Type object without reviving it (inverse=%s)", async inverse => {
    const local = await scenario(true), seeded = await local.seed("historical-type-object-" + inverse), option = id(seeded[0]?.id);
    const beforeRows = await local.read(), originalOption = current(beforeRows, option), historicalType = current(beforeRows, shippingOptionParents.type);
    expect(historicalType.deleted_at).not.toBeNull();
    const tap = retainedTap(), observations: ShippingOptionUpdateObservation[] = [];
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const host = inverse ? await local.prepareRoundtrip(tap.get, false, observations) : await local.prepare(observations);
      const key = host.newRequestKey(), before = await local.fixture.inventory();
      const outcome = await Effect.runPromiseExit(host.run(key, [{ id: option, type: { id: shippingOptionParents.type } }]));
      if (Exit.isFailure(outcome)) {
        // Scalar historical-Type acceptance does not establish this object-touch
        // contract. Preserve the untouched owner failure until native evidence
        // selects its correction; never turn it into an expected refusal.
        console.error("Native44 historical Type object witness", inspect({ outcome, retained: tap.evidence(), observations,
          before, after: await local.fixture.inventory() }, { depth: null, maxArrayLength: null, maxStringLength: null }));
        throw new Error(Cause.pretty(outcome.cause), { cause: outcome.cause });
      }
      const forward = native.mock.results[0];
      if (forward === undefined || forward.type !== "return") throw new Error("Missing actual historical Type-object result");
      expect(objectRows(await forward.value)).toMatchObject([{ id: option, shipping_option_type_id: shippingOptionParents.type, type: null }]);
      const afterRows = await local.read(), touched = current(afterRows, shippingOptionParents.type);
      expect(touched).toMatchObject({ id: historicalType.id, code: historicalType.code, label: historicalType.label,
        created_at: historicalType.created_at, deleted_at: historicalType.deleted_at });
      expect(Date.parse(id(touched.updated_at))).toBeGreaterThanOrEqual(Date.parse(id(historicalType.updated_at)));
      expect(observations.flatMap(entry => entry.activity.mutations).some(mutation => mutation.table === "shipping_option_type" &&
        mutation.operation === "patch" && mutation.after?.id === shippingOptionParents.type)).toBe(true);
      expect(current(afterRows, option).shipping_option_type_id).toBe(inverse ? originalOption.shipping_option_type_id : shippingOptionParents.type);
      expect(native).toHaveBeenCalledTimes(inverse ? 2 : 1);
    } finally { tap.restore(); native.mockRestore(); }
  }, 240_000);

  it.each([{ kind: "profile", inverse: false }, { kind: "profile", inverse: true },
    { kind: "type", inverse: false }, { kind: "type", inverse: true }] as const)(
    "refuses a missing physical $kind before retaining the Option or invoking its inverses (inverse=$inverse)", async ({ kind, inverse }) => {
      const local = await scenario(), seeded = await local.seed("missing-update-" + kind + inverse), option = id(seeded[0]?.id), tap = retainedTap();
      const pricing = vi.spyOn(PricingModuleService.prototype, "updatePriceSets"); let inverses = 0;
      const original = FulfillmentModuleService.prototype.upsertShippingOptions, presented: unknown[] = [];
      const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
        try { return await Reflect.apply(original, this, args); } catch (failure) { presented.push(failure); throw failure; }
      });
      try {
        const host = inverse ? await local.prepareRoundtrip(() => { inverses++; return tap.get(); }) : await local.prepare();
        const missing = "missing-update-" + kind, input = kind === "profile" ? [{ id: option, shipping_profile_id: missing }] : [{ id: option, type_id: missing }];
        const key = host.newRequestKey(), before = await local.fixture.inventory();
        const field = kind === "profile" ? "shipping_profile_id" : "shipping_option_type_id";
        fkFailure(await Effect.runPromiseExit(host.run(key, input)), field, missing);
        expect(presented).toHaveLength(1);
        const presentedError = presented[0];
        expect(presentedError).toBeInstanceOf(Error);
        if (!(presentedError instanceof Error)) throw new Error("Missing native relationship error");
        expect(presentedError.constructor).toBe(Error);
        expect(Object.getPrototypeOf(presentedError)).toBe(Error.prototype);
        expect(presentedError).toMatchObject({ name: "Error",
          message: `You tried to set relationship ${field}: ${missing}, but such entity does not exist` });
        expect(Object.hasOwn(presentedError, "type")).toBe(false);
        expect(Object.hasOwn(presentedError, "code")).toBe(false);
        expect(inverses).toBe(0); expect(pricing).not.toHaveBeenCalled();
        for (const kind of ["option", "pricing", "event"] as const) expect(tap.count(kind)).toBe(0);
        await expectCheckoutRollback(local.fixture, before, key);
      } finally { tap.restore(); pricing.mockRestore(); native.mockRestore(); }
    }, 240_000);

  it("retains complete native Rule validation before an earlier missing physical Profile", async () => {
    const local = await scenario(), seeded = await local.seed("rule-validation-order", 2), host = await local.prepare();
    const key = host.newRequestKey(), before = await local.fixture.inventory();
    const outcome = await Effect.runPromiseExit(host.run(key, [{ id: id(seeded[0]?.id), shipping_profile_id: "earlier-missing-profile" },
      { id: id(seeded[1]?.id), rules: [{ attribute: "enabled", operator: "eq", value: false }] }]));
    const failure = expectWorkflowRefusal(outcome, "adapterFailure");
    expect(failure.cause).toBeInstanceOf(MedusaError);
    expect(failure.cause).toMatchObject({ type: MedusaError.Types.INVALID_DATA, message: "Rule must have an attribute, an operator and a value" });
    expect(failure.cause).not.toBeInstanceOf(CoreNativeForeignKeyError);
    await expectCheckoutRollback(local.fixture, before, key);
  }, 240_000);

  it("refuses a forged deleted-Rule preimage without granting creation-time or internal-identity authority", async () => {
    const local = await scenario(), seeded = await local.seed("forged-rule-preimage"), option = id(seeded[0]?.id), tap = retainedTap();
    try {
      const host = await local.prepareRoundtrip(() => {
        const actual = tap.get(), preimages = objectRows(actual.option.updatedPreviousData);
        return { ...actual, option: { ...actual.option, updatedPreviousData: preimages.map(row => ({ ...row,
          rules: objectRows(row.rules).map(rule => ({ ...rule, created_at: "2026-10-18T00:00:01.000Z" })) })) } };
      });
      const key = host.newRequestKey(), before = await local.fixture.inventory();
      const outcome = await Effect.runPromiseExit(host.run(key, [{ id: option, rules: [{ attribute: "replacement", operator: "eq", value: "new" }] }]));
      const failure = expectWorkflowRefusal(outcome, "invalidInput");
      expect(failure.cause).toBeInstanceOf(CoreNativeQueryError);
      expect(failure.cause).toMatchObject({ reason: "invalidInput", cause: "Reconstitution preimage differs" });
      await expectCheckoutRollback(local.fixture, before, key);
    } finally { tap.restore(); }
  }, 240_000);

  it("refuses a genuine wrong-source binding and a cloned opaque source before execution", async () => {
    const local = await scenario(), before = await local.fixture.inventory();
    for (const nativeStorage of [local.modules.pricing.nativeStorage, { ...local.modules.fulfillment.nativeStorage }]) {
      await expect(Effect.runPromise(prepareShippingOptionUpdateWorkflow({ ...local.options, modules: { ...local.modules,
        fulfillment: { module: local.fulfillment.workflow, nativeStorage } } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
      expect(await local.fixture.inventory()).toEqual(before);
    }
  }, 240_000);

  it("recovers lost acknowledgement and conflicts on a different replay body without rerunning native updates", async () => {
    const local = await scenario(), seeded = await local.seed("lost-update-ack"), option = id(seeded[0]?.id), host = await local.prepare();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions"), pricing = vi.spyOn(PricingModuleService.prototype, "updatePriceSets");
    try {
      const key = host.newRequestKey(), input = [{ id: option, name: "Settled exactly once", prices: [{ currency_code: "usd", amount: 491 }] }];
      const fault = local.fixture.loseNextNativeRootAcknowledgement(), output = await Effect.runPromise(host.run(key, input));
      expect(fault.failures).toBe(1); expect(native).toHaveBeenCalledTimes(1); expect(pricing).toHaveBeenCalledTimes(1);
      const settled = await local.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      await expect(Effect.runPromise(host.run(key, [{ id: option, name: "Different body" }]))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(native).toHaveBeenCalledTimes(1); expect(pricing).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(settled);
    } finally { native.mockRestore(); pricing.mockRestore(); }
  }, 240_000);

  it("keeps a caught sibling denial sticky and revokes a native handle that escaped the update", async () => {
    const local = await scenario(), seeded = await local.seed("caught-update-denial"), option = id(seeded[0]?.id), host = await local.prepare();
    const original = FulfillmentModuleService.prototype.upsertShippingOptions; let denied = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => this.listShippingOptions({ id: [option] });
      try { await this.createShippingProfiles([{ name: "Forbidden update sibling", type: "default" }]); } catch { denied = true; }
      return output;
    });
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, [{ id: option, name: "Must not settle" }])), "rollbackOnly");
      expect(denied).toBe(true); await expectCheckoutRollback(local.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing actual escaped native update handle");
      await expect(escaped()).rejects.toBeDefined(); await expectCheckoutRollback(local.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("cancels after actual update writes and keeps rollback sealed while the callback drains", async () => {
    const local = await scenario(), seeded = await local.seed("cancelled-update"), option = id(seeded[0]?.id), host = await local.prepare();
    const original = FulfillmentModuleService.prototype.upsertShippingOptions, reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined; const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, [{ id: option, name: "Cancelled after write" }]));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      if (Exit.isSuccess(outcome)) throw new Error("Expected interrupted native update");
      expect(outcome.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
      await expectCheckoutRollback(local.fixture, before, key); finish?.();
      await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); await expectCheckoutRollback(local.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 240_000);

  it.each(["before-probe", "after-observation"] as const)("honors a prospective Type deletion %s without replaying native updates", async timing => {
    const local = await scenario(), seeded = await local.seed("parent-race-" + timing), option = id(seeded[0]?.id), host = await local.prepare();
    // The seeded Option owns a generated active Type; sot138 is an unused,
    // prospective target, so its independent deletion violates no committed FK.
    const beforeRows = await local.read(); expect(current(beforeRows, option).shipping_option_type_id).not.toBe(shippingOptionParents.type);
    const removal = await local.prepareParentRemoval("type"), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.upsertShippingOptions;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      if (timing === "before-probe") { await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); }
      return Reflect.apply(original, this, args);
    });
    let closures = 0;
    try {
      const before = await local.snapshot(), key = host.newRequestKey(), removalKey = removal.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, [{ id: option, type_id: shippingOptionParents.type }]).pipe(
          Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => timing === "after-observation" && name === "AtomicEvents.close"
            ? work.pipe(Effect.tap(() => Effect.gen(function* () { closures++; yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release); }))) : work }),
          Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removalKey).pipe(Effect.ensuring(Deferred.succeed(release, undefined))); return yield* Fiber.await(pending);
      })));
      expect(native).toHaveBeenCalledTimes(1);
      if (timing === "before-probe") fkFailure(outcome, "shipping_option_type_id", shippingOptionParents.type);
      else { expect(closures).toBe(1); expect(expectWorkflowTypedFailures(outcome).map(failure => failure.reason)).toEqual(["writeConflict"]); }
      const after = await local.snapshot(), winner = after.outcomes.find(entry => entry.value.key === removalKey);
      expect(winner?.value.state).toBe("committed"); expect((await local.fixture.inventory()).outcomes.find(entry => entry.value.key === key)?.value.state).toBe("failed");
      expect(after.revisions).toHaveLength(before.revisions.length + 1); expect(after.revisions.filter(row => row.timestamp === winner?.timestamp))
        .toMatchObject([{ deleted: true, value: null }]); expect(eventDelta(before, after)).toEqual([]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("refuses the four-Option envelope overflow before native callbacks or publication", async () => {
    const local = await scenario(), seeded = await local.seed("overflow-update"), option = id(seeded[0]?.id), host = await local.prepare();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, Array.from({ length: 5 }, () => ({ id: option })))), "invalidInput");
      expect(native).not.toHaveBeenCalled(); await expectCheckoutRollback(local.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("refuses a command-byte overflow before a native request can be claimed", async () => {
    const local = await scenario(), seeded = await local.seed("byte-overflow-update"), option = id(seeded[0]?.id), host = await local.prepare();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, [{ id: option,
        metadata: { oversized: "x".repeat(shippingOptionUpdateResources.commandBytes) } }])), "limitExceeded");
      expect(native).not.toHaveBeenCalled(); expect(await local.fixture.inventory()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("refuses public managed identities and timestamps before any database effect", async () => {
    const seeded = await connected.seed("managed-refusal"), option = id(seeded[0]?.id), host = await connected.prepare();
    for (const extra of [{ created_at: "2026-10-18T00:00:00.000Z" }, { type: { id: shippingOptionParents.type, updated_at: "2026-10-18T00:00:00.000Z" } },
      { rules: [{ id: "invented", created_at: "2026-10-18T00:00:00.000Z" }] }]) {
      const before = await connected.snapshot();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, ...extra }]))).rejects.toBeDefined();
      expect(await connected.snapshot()).toEqual(before);
    }
  }, 240_000);
});

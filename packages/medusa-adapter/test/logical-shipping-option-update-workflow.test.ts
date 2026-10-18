import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { shippingOptionUpdateResources } from "../src/workflow/policy";
import type { ShippingOptionUpdateInput } from "../src/workflows/fulfillment/update-shipping-options";
import { prepareLogicalShippingOptionUpdate } from "./support/logical-shipping-option-update-fixture";
import { shippingOptionCreationInput, shippingOptionParents, shippingOptionRegionIds } from "./support/logical-shipping-option-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = []; let sharedCleanupCount = 0;
let connected: Awaited<ReturnType<typeof prepareLogicalShippingOptionUpdate>>;
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
type Input = typeof ShippingOptionUpdateInput.Type;
const id = Schema.decodeUnknownSync(Schema.String);
function eventDelta(before: Inventory, after: Inventory) {
  const prior = new Set(before.events.map(event => JSON.stringify([event.scopeUuid, event.commitSeq.toString(), event.eventOrdinal])));
  return after.events.filter(event => !prior.has(JSON.stringify([event.scopeUuid, event.commitSeq.toString(), event.eventOrdinal])));
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
    return selected[0];
  };
  return { restore: () => spy.mockRestore(), get: () => ({ option: one(option), pricing: one(pricing), event: one(event) }) };
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
    connected = await prepareLogicalShippingOptionUpdate(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

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
    expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("preserves the native null-array preimage-helper refusal and rolls back the complete root", async () => {
    const seeded = await connected.seed("null-array-refusal"), option = id(seeded[0]?.id), host = await connected.prepare();
    const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), [{ id: option,
      name: "Uncommitted null array", data: { nested: { values: [null, "raw"] } } }])));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(failurePath(outcome.failure).join("\n")).toContain("Cannot convert undefined or null to object");
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
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), [{ id: option, rules: [{ attribute: "replacement", operator: "eq", value: "new" }], prices: [] }]))).toBeNull();
      const after = await connected.snapshot(), rows = await connected.read();
      expect(nativeState(rows)).toEqual(nativeState(beforeRows));
      expect(optionRules(rows, option).map(row => [row.id, row.created_at])).toEqual(optionRules(beforeRows, option).map(row => [row.id, row.created_at]));
      expect(eventDelta(before, after).some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
      expect(eventDelta(before, after).some(event => event.envelope.contract === "fulfillment.shipping-option-rule.created")).toBe(true);
    } finally { tap.restore(); }
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
    expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
  }, 240_000);

  it("runs the maximum graph and all three genuine retained inverses without losing Rule or Pricing history", async () => {
    const seeded = await connected.seed("maximum-update-inverse", 4, true), beforeRows = await connected.read(), tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get), input = seeded.map((option, index) => ({ id: id(option.id), name: "Maximum inverse " + index,
        rules: [0, 1, 2, 3].map(rule => ({ attribute: "replacement" + rule, operator: "eq", value: "new" + rule })),
        prices: [0, 1].map(price => ({ region_id: id(shippingOptionRegionIds[index * 2 + price]), amount: 600 + index + price,
          rules: [{ attribute: "cart_total", operator: "gte", value: 3 }, { attribute: "cart_total", operator: "lt", value: 300 }] })) }));
      let calls = 0; const before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      const after = await connected.snapshot(), events = eventDelta(before, after);
      expect(nativeState(await connected.read())).toEqual(nativeState(beforeRows));
      expect(events.some(event => event.envelope.contract === "shipping-option.updated")).toBe(false);
      expect(events.some(event => event.envelope.contract === "pricing.price-rule.created")).toBe(true);
      expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
      console.info("Shipping Option maximum update inverse calls/messages", calls, events.length);
      expect(calls).toBeLessThanOrEqual(shippingOptionUpdateResources.calls);
      expect(events.length).toBeLessThanOrEqual(shippingOptionUpdateResources.eventMessages);
    } finally { tap.restore(); }
  }, 240_000);

  it("isolates identical endpoint IDs in another application scope on the same database resource", async () => {
    const baseline = await connected.read(), selected = await prepareLogicalShippingOptionUpdate(driver, close => cleanup.push(close), {
      resource: connected.fixture.resource, fixtureIdentity: { deploymentId: "shipping-139-isolation", projectId: "shipping-139", uuidOffset: 3_600_000 } });
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
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), [{ id: option, prices: [],
        rules: [{ attribute: "late", operator: "eq", value: "replacement" }] }])));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(failurePath(outcome.failure).join("\n")).toContain("Late native Shipping Option update inverse failure");
      expect(tap.get().option?.updatedPreviousData).toHaveLength(1);
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
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

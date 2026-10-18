import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { shippingOptionCreationResources } from "../src/workflow/policy";
import { workflowMethodDefinition } from "../src/workflow/module";
import { prepareLogicalShippingOptionCreation, shippingOptionCreationInput, shippingOptionParents, shippingOptionRegionIds } from "./support/logical-shipping-option-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingOptionCreation>>;
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const eventDelta = (before: Inventory, after: Inventory) => {
  const keys = new Set(before.events.map(event => JSON.stringify([event.scopeUuid, event.commitSeq.toString(), event.eventOrdinal])));
  return after.events.filter(event => !keys.has(JSON.stringify([event.scopeUuid, event.commitSeq.toString(), event.eventOrdinal])));
};
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine native retained input getter");
  const definitions = {
    creation: Schema.Struct({ createdIds: Schema.Array(Schema.String), updatedPreviousData: Schema.Array(Schema.Json) }),
    pricing: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    links: Schema.Struct({ linksToCreate: Schema.Array(Schema.Json), linksToRemove: Schema.Array(Schema.Json) }),
    event: Schema.Struct({ eventGroupId: Schema.String, eventName: Schema.Literal("shipping-option.created") }),
  };
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(structuredClone(value)); return value;
  });
  const one = <Value>(schema: Schema.Codec<Value>) => {
    const selected = values.filter(Schema.is(schema));
    if (selected.length !== 1) throw new Error("Expected exactly one genuine native retained input");
    return selected[0];
  };
  return { restore: () => spy.mockRestore(), get: () => ({ creation: one(definitions.creation), pricing: one(definitions.pricing),
    links: one(definitions.links), event: one(definitions.event) }) };
}

describe("genuine native Shipping Option creation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalShippingOptionCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes empty native dependencies and replays its settled result", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    const after = await connected.snapshot();
    expect(eventDelta(before, after)).toEqual([]);
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("creates the full native Option, inline Type, normalized Rule, Pricing and stored Link under one settlement", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), value = shippingOptionCreationInput("native-flat");
    const before = await connected.snapshot(); let calls = 0;
    const result = await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    expect(result).toMatchObject([{ id: expect.stringMatching(/^so_/), name: "native-flat-0", type: { id: expect.stringMatching(/^sotype_/), label: "native-flat-type-0" },
      rules: [{ operator: "eq", value: "true" }], fulfillments: [] }]);
    const id = result[0]?.id, rows = await connected.read(), link = rows.find(row => row.shipping_option_id === id && typeof row.price_set_id === "string");
    expect(link).toMatchObject({ id: expect.stringMatching(/^sops_/), deleted_at: null });
    const price = rows.find(row => row.price_set_id === link?.price_set_id && row.currency_code === "usd");
    expect(price).toMatchObject({ rules_count: 0 });
    expect(Number(price?.amount)).toBe(100);
    const after = await connected.snapshot(), events = eventDelta(before, after);
    expect(events.filter(event => event.envelope.contract === "shipping-option.created").map(event => event.envelope.message))
      .toEqual([{ name: "shipping-option.created", data: { id }, metadata: { eventGroupId: expect.any(String) } }]);
    expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
    console.info("Shipping Option creation calls/messages", calls, events.length);
    expect(calls).toBeLessThanOrEqual(shippingOptionCreationResources.calls);
    expect(await Effect.runPromise(host.run(key, value))).toEqual(result);
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("uses native Region currency and numeric-rule normalization", async () => {
    const host = await connected.prepare(), value = shippingOptionCreationInput("native-region").map(option => ({ ...option,
      type_id: shippingOptionParents.type, prices: [{ region_id: shippingOptionParents.region, amount: 321,
        rules: [{ attribute: "item_total", operator: "gte", value: 200 }] }] }));
    const result = await Effect.runPromise(host.run(host.newRequestKey(), value));
    expect(result[0]?.type).toMatchObject({ id: shippingOptionParents.type });
    const rows = await connected.read(), link = rows.find(row => row.shipping_option_id === result[0]?.id && typeof row.price_set_id === "string"),
      price = rows.find(row => row.price_set_id === link?.price_set_id && row.currency_code === "eur");
    expect(price).toMatchObject({ rules_count: 2 });
    expect(Number(price?.amount)).toBe(321);
    expect(rows.filter(row => row.price_id === price?.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribute: "region_id", value: shippingOptionParents.region }),
      expect.objectContaining({ attribute: "item_total", operator: "gte", value: "200" }),
    ]));
  }, 240_000);

  it("publishes the complete four-Option maximum in one commit and isolates identical endpoints in another scope", async () => {
    const selected = await prepareLogicalShippingOptionCreation(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "shipping-138-maximum", projectId: "shipping-138", uuidOffset: 3_500_000 } });
    const host = await selected.prepare(), value = shippingOptionCreationInput("maximum-create", 4).map((option, optionIndex) => ({ ...option,
      rules: Array.from({ length: 4 }, (_, index) => ({ attribute: "enabled" + index, operator: "eq", value: true })),
      prices: ["item_total", "quantity"].map((attribute, priceIndex) => {
        const region_id = shippingOptionRegionIds[optionIndex * 2 + priceIndex];
        if (region_id === undefined) throw new Error("Missing distinct Region for the complete price envelope");
        return { region_id, amount: 100, rules: [{ attribute, operator: "gte", value: 1 }, { attribute, operator: "lt", value: 100 }] };
      }) }));
    const other = await connected.read(), before = await selected.snapshot(), key = host.newRequestKey();
    const result = await Effect.runPromise(host.run(key, value)), rows = await selected.read();
    expect(result.map(row => row.name)).toEqual(value.map(row => row.name));
    expect(new Set(result.map(row => row.id)).size).toBe(4);
    expect(rows.filter(row => typeof row.name === "string" && row.name.startsWith("maximum-create-"))).toHaveLength(4);
    expect(rows.filter(row => typeof row.code === "string" && row.code.startsWith("maximum-create-type-"))).toHaveLength(4);
    expect(rows.filter(row => typeof row.shipping_option_id === "string" && typeof row.attribute === "string")).toHaveLength(16);
    expect(rows.filter(row => typeof row.price_set_id === "string" && typeof row.currency_code === "string")).toHaveLength(8);
    expect(rows.filter(row => typeof row.price_id === "string")).toHaveLength(24);
    expect(new Set(rows.filter(row => row.attribute === "region_id" && typeof row.price_id === "string").map(row => row.value))).toEqual(new Set(shippingOptionRegionIds));
    expect(rows.filter(row => typeof row.shipping_option_id === "string" && typeof row.price_set_id === "string")).toHaveLength(4);
    const after = await selected.snapshot(), events = eventDelta(before, after);
    // Native Link.create emits one attached message for the complete ID cohort.
    expect(events).toHaveLength(65); expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
    const linkEvent = workflowMethodDefinition(selected.priceSetLinks.workflow.methods.create)?.moduleEvents[0];
    if (linkEvent === undefined) throw new Error("Missing admitted native Link attachment event");
    expect(events.filter(event => event.envelope.contract === linkEvent).map(event => event.envelope.message)).toEqual([
      expect.objectContaining({ data: { id: expect.arrayContaining(rows.filter(row => typeof row.shipping_option_id === "string" && typeof row.price_set_id === "string")
        .map(row => Schema.decodeUnknownSync(Schema.String)(row.id))) } }),
    ]);
    expect(events.filter(event => event.envelope.contract === "shipping-option.created").map(event => event.envelope.message))
      .toEqual(result.map(row => ({ name: "shipping-option.created", data: { id: row.id }, metadata: { eventGroupId: expect.any(String) } })));
    expect(await connected.read()).toEqual(other);
    expect(await Effect.runPromise(host.run(key, value))).toEqual(result);
    expect(await selected.snapshot()).toEqual(after);
  }, 240_000);

  it.each(["calculated", "unavailable-provider", "missing-region", "invalid-operator"] as const)("preserves native %s refusal and complete rollback", async mode => {
    const host = await connected.prepare(), base = shippingOptionCreationInput(mode)[0];
    if (base === undefined) throw new Error("Missing native creation input");
    const option = mode === "calculated" ? { ...base, price_type: "calculated" as const, prices: [] }
      : mode === "unavailable-provider" ? { ...base, service_zone_id: shippingOptionParents.unavailableZone }
      : mode === "missing-region" ? { ...base, prices: [{ region_id: "missing-region138", amount: 1 }] }
      : { ...base, prices: [{ currency_code: "usd", amount: 1, rules: [{ attribute: "total", operator: "invalid", value: 1 }] }] };
    const before = await connected.snapshot();
    const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), [option])));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(failurePath(outcome.failure).join("\n")).toContain({
      calculated: "Cannot calcuate pricing for:", "unavailable-provider": "are not enabled for the service location",
      "missing-region": "Cannot create prices for non-existent regions", "invalid-operator": "operator should be one of",
    }[mode]);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("runs the maximum graph and all four genuine retained inverses, preserving Type history and module facts", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get), value = shippingOptionCreationInput("maximum-inverse", 4).map(option => ({ ...option,
        rules: Array.from({ length: 4 }, (_, index) => ({ attribute: "enabled" + index, operator: "eq", value: true })),
        prices: ["item_total", "quantity"].map(attribute => ({ region_id: shippingOptionParents.region, amount: 100,
          rules: [{ attribute, operator: "gte", value: 1 }, { attribute, operator: "lt", value: 100 }] })) }));
      const before = await connected.snapshot(); let calls = 0;
      expect(await Effect.runPromise(host.run(host.newRequestKey(), value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      const after = await connected.snapshot(), events = eventDelta(before, after), actual = tap.get(), rows = await connected.read();
      expect(events.some(event => event.envelope.contract === "shipping-option.created")).toBe(false);
      expect(events.some(event => event.envelope.contract === "fulfillment.shipping-option.created")).toBe(true);
      expect(events.some(event => event.envelope.contract === "fulfillment.shipping-option.deleted")).toBe(true);
      expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
      expect(rows.filter(row => typeof row.code === "string" && row.code.startsWith("maximum-inverse-type-"))).toHaveLength(4);
      expect(rows.some(row => typeof row.name === "string" && row.name.startsWith("maximum-inverse-"))).toBe(false);
      for (const id of actual.pricing ?? []) expect(rows.some(row => row.id === id || row.price_set_id === id && typeof row.currency_code === "string")).toBe(false);
      for (const id of actual.creation?.createdIds ?? []) expect(rows.find(row => row.shipping_option_id === id && typeof row.price_set_id === "string"))
        .toMatchObject({ deleted_at: expect.any(String) });
      console.info("Shipping Option maximum retained callbacks calls/messages", calls, events.length);
      expect(calls).toBeLessThanOrEqual(shippingOptionCreationResources.calls);
      expect(events.length).toBeLessThanOrEqual(shippingOptionCreationResources.eventMessages);
    } finally { tap.restore(); }
  }, 240_000);

  it("rolls back a late failure after genuine pending-event clear and all physical inverses", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, true), before = await connected.snapshot();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), shippingOptionCreationInput("late-inverse")))).rejects.toBeDefined();
      expect(await connected.snapshot()).toEqual(before);
      expect(tap.get().creation?.createdIds).toHaveLength(1);
    } finally { tap.restore(); }
  }, 240_000);
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { inspectLogicalReferenceFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CoreNativeForeignKeyError } from "../../persistence-postgres/src/core/api";
import { shippingOptionCreationResources } from "../src/workflow/policy";
import { workflowMethodDefinition } from "../src/workflow/module";
import { prepareCoreShippingOptionCreation } from "./support/core-shipping-option-creation-fixture";
import { shippingOptionCreationInput, shippingOptionParents, shippingOptionRegionIds } from "./support/shipping-option-creation-fixture-data";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { expectWorkflowDefect, expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = []; let sharedCleanupCount = 0;
let connected: Awaited<ReturnType<typeof prepareCoreShippingOptionCreation>>;
const text = Schema.decodeUnknownSync(Schema.String), rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const eventDelta = (before: Inventory, after: Inventory) => {
  const keys = new Set(before.events.map(event => JSON.stringify([event.familyId, event.ordinal])));
  return after.events.filter(event => !keys.has(JSON.stringify([event.familyId, event.ordinal])));
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
    const value = selected[0];
    if (value === undefined) throw new Error("Missing genuine native retained input");
    return value;
  };
  return { restore: () => spy.mockRestore(), count: (kind: keyof typeof definitions) => values.filter(Schema.is(definitions[kind])).length,
    get: () => ({ creation: one(definitions.creation), pricing: one(definitions.pricing),
    links: one(definitions.links), event: one(definitions.event) }) };
}
async function scenario(historicalParents = false) {
  return prepareCoreShippingOptionCreation(driver, close => cleanup.push(close), { physical: connected.fixture.physical, historicalParents });
}
function scalarType(prefix: string, typeId: string = shippingOptionParents.type) {
  return shippingOptionCreationInput(prefix).map(({ type: _inline, ...option }) => ({ ...option, type_id: typeId }));
}
function fkFailure<Value, Failure>(outcome: Exit.Exit<Value, Failure>, field: string, target: string) {
  const original = expectWorkflowRefusal(outcome, "invalidInput");
  expect(original.cause).toBeInstanceOf(CoreNativeForeignKeyError);
  expect(original.cause).toMatchObject({ reason: "targetMissing", sourceFields: [field], targetFields: ["id"] });
  expect(inspectLogicalReferenceFailure(original.cause)).toMatchObject({ storage: "core", origin: "checkpoint",
    sourceColumns: [field], target: { columns: ["id"], values: [target] } });
  return original;
}
function expectParallelPriceRefusal<Value, Failure>(outcome: Exit.Exit<Value, Failure>, message: string) {
  if (Exit.isSuccess(outcome)) throw new Error("Expected the genuine parallel native price refusal");
  // The price validator fails while the provider/Query sibling is active.
  // Preserve both body/drain interruptions and the later rollback seal.
  expect(outcome.cause.reasons.map(reason => reason._tag)).toEqual(["Interrupt", "Fail", "Interrupt", "Fail"]);
  const [bodyInterruption, original, drainedInterruption, sealed] = outcome.cause.reasons;
  if (bodyInterruption === undefined || !Cause.isInterruptReason(bodyInterruption) ||
    drainedInterruption === undefined || !Cause.isInterruptReason(drainedInterruption) ||
    original === undefined || !Cause.isFailReason(original) || !(original.error instanceof CommerceTransactionError) ||
    sealed === undefined || !Cause.isFailReason(sealed) || !(sealed.error instanceof CommerceTransactionError))
    throw new Error("Lost the complete parallel native price refusal");
  expect(bodyInterruption.fiberId).toBeUndefined(); expect(drainedInterruption.fiberId).toBeUndefined();
  expect(original.error.reason).toBe("adapterFailure");
  const native = original.error.cause;
  if (!(native instanceof MedusaError)) throw new Error("Lost the original native price MedusaError");
  expect(native.constructor).toBe(MedusaError); expect(native.type).toBe(MedusaError.Types.INVALID_DATA);
  expect(native.message).toBe(message); expect(native.stack).toContain("validate-shipping-option-prices.ts");
  expect(sealed.error.reason).toBe("rollbackOnly"); expect(sealed.error.cause).toBeUndefined();
  expect(failurePath(outcome.cause)).toEqual(["Interrupt", "adapterFailure", message, "Interrupt", "rollbackOnly"]);
}

describe("genuine native Shipping Option creation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreShippingOptionCreation(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => {
    await connected?.closeCaseHosts();
    for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
  }, 120_000);
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
    expect(new Set(events.map(event => event.timestamp)).size).toBe(1);
    expectCheckoutSettlement(before, after, key);
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
    const selected = await scenario();
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
    expect(events).toHaveLength(65); expect(new Set(events.map(event => event.timestamp)).size).toBe(1);
    expectCheckoutSettlement(before, after, key);
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
    const before = await connected.fixture.inventory(), key = host.newRequestKey();
    const outcome = await Effect.runPromiseExit(host.run(key, [option]));
    if (mode === "calculated" || mode === "missing-region") expectParallelPriceRefusal(outcome, mode === "calculated"
      ? "Cannot calcuate pricing for: [calculated-0] shipping option(s)."
      : "Cannot create prices for non-existent regions. Region with ids [missing-region138] were not found.");
    else expectWorkflowTypedFailures(outcome);
    if (Exit.isFailure(outcome)) expect(failurePath(outcome.cause).join("\n")).toContain({
      calculated: "Cannot calcuate pricing for:", "unavailable-provider": "are not enabled for the service location",
      "missing-region": "Cannot create prices for non-existent regions", "invalid-operator": "operator should be one of",
    }[mode]);
    await expectCheckoutRollback(connected.fixture, before, key);
  }, 240_000);

  it("runs the maximum graph and all four genuine retained inverses, preserving Type history and module facts", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get), value = shippingOptionCreationInput("maximum-inverse", 4).map(option => ({ ...option,
        rules: Array.from({ length: 4 }, (_, index) => ({ attribute: "enabled" + index, operator: "eq", value: true })),
        prices: ["item_total", "quantity"].map(attribute => ({ region_id: shippingOptionParents.region, amount: 100,
          rules: [{ attribute, operator: "gte", value: 1 }, { attribute, operator: "lt", value: 100 }] })) }));
      const before = await connected.snapshot(); let calls = 0;
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      const after = await connected.snapshot(), events = eventDelta(before, after), actual = tap.get(), rows = await connected.read();
      expect(events.some(event => event.envelope.contract === "shipping-option.created")).toBe(false);
      expect(events.some(event => event.envelope.contract === "fulfillment.shipping-option.created")).toBe(true);
      expect(events.some(event => event.envelope.contract === "fulfillment.shipping-option.deleted")).toBe(true);
      expect(new Set(events.map(event => event.timestamp)).size).toBe(1);
      expectCheckoutSettlement(before, after, key);
      expect(actual.creation.updatedPreviousData).toEqual([]); expect(actual.creation.createdIds).toHaveLength(4);
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
      const host = await connected.prepareRoundtrip(tap.get, true), before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromiseExit(host.run(key, shippingOptionCreationInput("late-inverse")));
      if (Exit.isSuccess(outcome)) throw new Error("Expected the genuine late native inverse failure");
      const defect = outcome.cause.reasons.find(Cause.isDieReason)?.defect;
      if (!(defect instanceof Error)) throw new Error("Lost genuine late inverse defect");
      expect(defect.message).toBe("Late native Shipping Option inverse failure"); expectWorkflowDefect(outcome, defect);
      await expectCheckoutRollback(connected.fixture, before, key);
      expect(tap.get().creation?.createdIds).toHaveLength(1);
    } finally { tap.restore(); }
  }, 240_000);

  it.each([
    { kind: "profile", inverse: false }, { kind: "profile", inverse: true },
    { kind: "type", inverse: false }, { kind: "type", inverse: true },
  ] as const)("refuses missing $kind before Pricing, Link or retained inversion (inverse=$inverse)", async ({ kind, inverse }) => {
    const local = await scenario(), tap = retainedTap(), pricing = vi.spyOn(PricingModuleService.prototype, "createPriceSets"),
      creation = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions"), remove = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingOptions");
    let inverseEntries = 0;
    try {
      const host = inverse ? await local.prepareRoundtrip(() => { inverseEntries++; return tap.get(); }) : await local.prepare();
      const missing = "missing-creation-" + kind;
      const input = kind === "profile" ? shippingOptionCreationInput("missing-profile").map(row => ({ ...row, shipping_profile_id: missing }))
        : scalarType("missing-type", missing);
      const before = await local.fixture.inventory(), key = host.newRequestKey(), outcome = await Effect.runPromiseExit(host.run(key, input));
      fkFailure(outcome, kind === "profile" ? "shipping_profile_id" : "shipping_option_type_id", missing);
      expect(creation).toHaveBeenCalledTimes(1); expect(pricing).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
      expect(inverseEntries).toBe(0);
      for (const kind of ["creation", "pricing", "links", "event"] as const) expect(tap.count(kind)).toBe(0);
      await expectCheckoutRollback(local.fixture, before, key);
    } finally { tap.restore(); pricing.mockRestore(); creation.mockRestore(); remove.mockRestore(); }
  }, 240_000);

  it.each(["profile", "type"] as const)("preserves the first Option's %s FK origin across the complete input", async first => {
    const local = await scenario(), host = await local.prepare();
    const profile = shippingOptionCreationInput("first-profile").map(row => ({ ...row, shipping_profile_id: "first-missing-profile" })),
      type = scalarType("first-type", "first-missing-type"), input = first === "profile" ? [...profile, ...type] : [...type, ...profile];
    const before = await local.fixture.inventory(), key = host.newRequestKey();
    fkFailure(await Effect.runPromiseExit(host.run(key, input)), first === "profile" ? "shipping_profile_id" : "shipping_option_type_id",
      first === "profile" ? "first-missing-profile" : "first-missing-type");
    await expectCheckoutRollback(local.fixture, before, key);
  }, 240_000);

  it("retains complete native Rule validation before an earlier missing Profile", async () => {
    const local = await scenario(), host = await local.prepare(), create = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions"),
      pricing = vi.spyOn(PricingModuleService.prototype, "createPriceSets");
    try {
      const input = shippingOptionCreationInput("rule-precedence", 2).map((row, index) => index === 0
        ? { ...row, shipping_profile_id: "earlier-missing-profile" }
        : { ...row, rules: [{ attribute: "enabled", operator: "eq", value: false }] });
      const before = await local.fixture.inventory(), key = host.newRequestKey(), outcome = await Effect.runPromiseExit(host.run(key, input));
      const failures = expectWorkflowTypedFailures(outcome, "adapterFailure");
      expect(failures.some(failure => failurePath(failure).some(message => message.includes("Rule must have an attribute, an operator and a value")))).toBe(true);
      expect(failures.some(failure => failure.cause instanceof CoreNativeForeignKeyError)).toBe(false);
      expect(create).toHaveBeenCalledTimes(1); expect(pricing).not.toHaveBeenCalled();
      await expectCheckoutRollback(local.fixture, before, key);
    } finally { create.mockRestore(); pricing.mockRestore(); }
  }, 240_000);

  it.each([false, true])("keeps historical physical parents distinct from active Type hydration (inverse=%s)", async inverse => {
    const local = await scenario(true), tap = retainedTap(), native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const parents = (await local.read()).filter(row => row.id === shippingOptionParents.profile || row.id === shippingOptionParents.type);
      expect(parents).toHaveLength(2); expect(parents.every(row => row.deleted_at !== null)).toBe(true);
      const host = inverse ? await local.prepareRoundtrip(tap.get) : await local.prepare(), input = scalarType("historical-native-parents");
      await Effect.runPromise(host.run(host.newRequestKey(), input));
      expect(native).toHaveBeenCalledTimes(1);
      const response = native.mock.results[0];
      if (response === undefined || response.type !== "return") throw new Error("Missing actual native historical-parent result");
      expect(rows(await response.value)).toMatchObject([{ shipping_profile_id: shippingOptionParents.profile,
        shipping_option_type_id: shippingOptionParents.type, type: null }]);
      expect((await local.read()).filter(row => row.id === shippingOptionParents.profile || row.id === shippingOptionParents.type)).toEqual(parents);
      expect(tap.get().creation.updatedPreviousData).toEqual([]); expect(tap.get().creation.createdIds).toHaveLength(1);
    } finally { tap.restore(); native.mockRestore(); }
  }, 240_000);

  it("retains native per-root Type, Option and Rule insertion generations in durable history", async () => {
    const local = await scenario(), host = await local.prepare(), before = await local.snapshot(), key = host.newRequestKey();
    const output = rows(await Effect.runPromise(host.run(key, shippingOptionCreationInput("ordered-native", 2))));
    const expected: string[] = [], labels = new Map<string, string>();
    for (const [index, option] of output.entries()) {
      const type = Schema.decodeUnknownSync(Schema.JsonObject)(option.type), child = rows(option.rules)[0];
      if (child === undefined) throw new Error("Missing actual created Rule");
      for (const [id, label] of [[text(type.id), `type${index}`], [text(option.id), `option${index}`], [text(child.id), `rule${index}`]]) {
        if (id === undefined || label === undefined) throw new Error("Missing native creation identity");
        labels.set(id, label); expected.push(label);
      }
    }
    const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
    const ordered = after.revisions.filter(row => row.timestamp === timestamp && row.value !== null && typeof row.value.id === "string" && labels.has(row.value.id))
      .map(row => {
        if (row.value === null || typeof row.value.id !== "string" || typeof row.value._creationTime !== "number")
          throw new Error("Missing Core insertion generation");
        expect(row.previous).toBeNull(); expect(row.deleted).toBe(false);
        return { label: labels.get(row.value.id), time: row.value._creationTime };
      }).toSorted((left, right) => left.time - right.time);
    expect(ordered.map(row => row.label)).toEqual(expected);
  }, 240_000);

  it("refuses a forged retained update packet after actual creation and rolls back the full root", async () => {
    const local = await scenario(), tap = retainedTap();
    try {
      const host = await local.prepareRoundtrip(() => {
        const actual = tap.get(), id = actual.creation.createdIds[0];
        if (id === undefined) throw new Error("Missing actual retained created ID");
        return { ...actual, creation: { ...actual.creation, updatedPreviousData: [{ id, name: "forged-previous-root", rules: [] }] } };
      });
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, shippingOptionCreationInput("forged-inverse"))));
      expect(tap.get().creation.updatedPreviousData).toEqual([]); expect(tap.get().creation.createdIds).toHaveLength(1);
      await expectCheckoutRollback(local.fixture, before, key);
    } finally { tap.restore(); }
  }, 240_000);

  it("recovers lost settlement acknowledgement without replaying native creation or Link/Pricing work", async () => {
    const local = await scenario(), host = await local.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions"),
      pricing = vi.spyOn(PricingModuleService.prototype, "createPriceSets");
    try {
      const key = host.newRequestKey(), input = shippingOptionCreationInput("unknown-outcome"), fault = local.fixture.loseNextNativeRootAcknowledgement();
      const output = await Effect.runPromise(host.run(key, input));
      expect(fault.failures).toBe(1); expect(native).toHaveBeenCalledTimes(1); expect(pricing).toHaveBeenCalledTimes(1);
      const settled = await local.snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(native).toHaveBeenCalledTimes(1); expect(pricing).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(settled);
      await expect(Effect.runPromise(host.run(key, []))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await local.snapshot()).toEqual(settled);
    } finally { native.mockRestore(); pricing.mockRestore(); }
  }, 240_000);

  it("keeps a caught sibling DAL denial sticky and revokes escaped native handles", async () => {
    const local = await scenario(), host = await local.prepare(), original = FulfillmentModuleService.prototype.upsertShippingOptions;
    let denied = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.createShippingProfiles([{ name: "forbidden-sibling", type: "default" }]); } catch { denied = true; }
      return output;
    });
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, shippingOptionCreationInput("sticky-creation"))), "rollbackOnly");
      expect(denied).toBe(true); await expectCheckoutRollback(local.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing actual escaped native handle");
      await expect(escaped()).rejects.toBeDefined(); await expectCheckoutRollback(local.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("cancels after native graph writes and suppresses publication while the actual callback drains", async () => {
    const local = await scenario(), host = await local.prepare(), original = FulfillmentModuleService.prototype.upsertShippingOptions;
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, shippingOptionCreationInput("cancelled-native-create")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      if (Exit.isSuccess(outcome)) throw new Error("Expected interrupted native creation");
      expect(outcome.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
      await expectCheckoutRollback(local.fixture, before, key); finish?.();
      await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      await expectCheckoutRollback(local.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 240_000);

  it("invalidates actual parent dependencies when Profile deletion commits after observation", async () => {
    const local = await scenario(), host = await local.prepare(), removal = await local.prepareParentRemoval("profile");
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(); let closures = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const before = await local.snapshot(), key = host.newRequestKey(), removalKey = removal.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, shippingOptionCreationInput("observed-parent-race")).pipe(
          Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => name === "AtomicEvents.close" ? work.pipe(Effect.tap(() => Effect.gen(function* () {
            closures++; yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
          }))) : work }), Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removalKey).pipe(Effect.ensuring(Deferred.succeed(release, undefined))); return yield* Fiber.await(pending);
      })));
      expect(closures).toBe(1); expect(native).toHaveBeenCalledTimes(1);
      expect(expectWorkflowTypedFailures(outcome).map(failure => failure.reason)).toEqual(["writeConflict"]);
      const after = await local.snapshot(), winner = after.outcomes.find(entry => entry.value.key === removalKey);
      expect(winner?.value.state).toBe("committed");
      expect((await local.fixture.inventory()).outcomes.find(entry => entry.value.key === key)?.value.state).toBe("failed");
      expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(after.revisions.filter(row => row.timestamp === winner?.timestamp)).toMatchObject([{ deleted: true, value: null }]);
      expect(eventDelta(before, after)).toEqual([]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("preserves authentic targetMissing when Profile deletion precedes the first parent probe", async () => {
    const local = await scenario(), host = await local.prepare(), removal = await local.prepareParentRemoval("profile"),
      original = FulfillmentModuleService.prototype.upsertShippingOptions;
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release));
      return Reflect.apply(original, this, args);
    });
    try {
      const before = await local.snapshot(), key = host.newRequestKey(), removalKey = removal.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, shippingOptionCreationInput("missing-at-first-probe")).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removalKey).pipe(Effect.ensuring(Deferred.succeed(release, undefined))); return yield* Fiber.await(pending);
      })));
      fkFailure(outcome, "shipping_profile_id", shippingOptionParents.profile); expect(native).toHaveBeenCalledTimes(1);
      const after = await local.snapshot(), winner = after.outcomes.find(entry => entry.value.key === removalKey);
      expect(winner?.value.state).toBe("committed");
      expect((await local.fixture.inventory()).outcomes.find(entry => entry.value.key === key)?.value.state).toBe("failed");
      expect(after.revisions).toHaveLength(before.revisions.length + 1); expect(eventDelta(before, after)).toEqual([]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("refuses creation-envelope overflow before native callbacks or business publication", async () => {
    const local = await scenario(), host = await local.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingOptions");
    try {
      const before = await local.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, shippingOptionCreationInput("overflow", 5))));
      expect(native).not.toHaveBeenCalled(); await expectCheckoutRollback(local.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 240_000);
});

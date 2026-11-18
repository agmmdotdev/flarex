import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { Link } from "@medusajs/modules-sdk/link";
import { CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { shippingOptionDeletionResources } from "../src/workflow/policy";
import { prepareLogicalShippingOptionDeletion } from "./support/logical-shipping-option-delete-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = []; let sharedCleanupCount = 0, scopeOrdinal = 0;
let connected: Awaited<ReturnType<typeof prepareLogicalShippingOptionDeletion>>;
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const id = Schema.decodeUnknownSync(Schema.String);
function eventDelta(before: Inventory, after: Inventory) {
  const identity = (event: Inventory["events"][number]) => JSON.stringify([event.scopeUuid, event.epochUuid, event.commitSeq.toString(), event.eventOrdinal]);
  const previous = new Set(before.events.map(identity)); return after.events.filter(event => !previous.has(identity(event)));
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function current(rows: readonly JsonObject[], key: string) {
  const row = rows.find(row => row.id === key); if (row === undefined) throw new Error("Missing actual native row " + key); return row;
}
function graph(rows: readonly JsonObject[], options: readonly string[]) {
  const selected = new Set(options);
  const rules = rows.filter(row => selected.has(idOrEmpty(row.shipping_option_id)) && typeof row.attribute === "string");
  const links = rows.filter(row => selected.has(idOrEmpty(row.shipping_option_id)) && typeof row.price_set_id === "string");
  const sets = new Set(links.map(row => id(row.price_set_id)));
  const prices = rows.filter(row => sets.has(idOrEmpty(row.price_set_id)) && typeof row.currency_code === "string");
  const priceIds = new Set(prices.map(row => id(row.id)));
  const priceRules = rows.filter(row => priceIds.has(idOrEmpty(row.price_id)));
  return { options: options.map(option => current(rows, option)), rules, links, sets: [...sets].map(set => current(rows, set)), prices, priceRules,
    all: [...options.map(option => current(rows, option)), ...rules, ...links, ...[...sets].map(set => current(rows, set)), ...prices, ...priceRules] };
}
const idOrEmpty = (value: unknown) => typeof value === "string" ? value : "";
function stable(rows: readonly JsonObject[], ignoreDeleted = false) {
  return rows.map(({ updated_at: _updated, ...row }) => {
    if (ignoreDeleted) Reflect.deleteProperty(row, "deleted_at");
    return encodeCanonicalJson(row, issue => { throw new Error("Native row lost canonical data", { cause: issue }); });
  }).sort();
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine native retained-response getter");
  const ids = Schema.Array(Schema.String), event = Schema.Struct({ eventGroupId: Schema.String, eventName: Schema.Literal("shipping-option.deleted") });
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(structuredClone(value)); return value;
  });
  const get = () => {
    const options = values.filter(Schema.is(ids)), events = values.filter(Schema.is(event));
    const links = values.filter(value => typeof value === "object" && value !== null && !Array.isArray(value)
      && (Object.hasOwn(value, "fulfillment") || Object.hasOwn(value, "__type")));
    if (options.length > 1 || events.length > 1 || links.length !== 1) throw new Error("Unexpected genuine deletion retained inputs");
    return { option: options[0], event: events[0], link: links[0] };
  };
  return { get, restore: () => spy.mockRestore() };
}
async function scenario(name: string) {
  const ordinal = ++scopeOrdinal;
  return prepareLogicalShippingOptionDeletion(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: "option-delete-" + name + "-" + ordinal, projectId: "option-delete-140", uuidOffset: 2_500_000 + ordinal * 10_000 } });
}
async function seed(prefix: string, count = 1, maximum = false) {
  return (await connected.seed(prefix, count, maximum)).map(row => id(row.id));
}
async function failedUnchanged(work: Effect.Effect<unknown, CommerceTransactionError>, before: Inventory, expected?: string) {
  const outcome = await Effect.runPromise(Effect.result(work)); expect(Result.isFailure(outcome)).toBe(true);
  if (expected !== undefined && Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain(expected);
  expect(await connected.snapshot()).toEqual(before);
}

describe("genuine native Shipping Option deletion and retained inverses", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalShippingOptionDeletion(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes the exact native empty Link delete/restore marker without module calls or row effects", async () => {
    const tap = retainedTap(), remove = vi.spyOn(Link.prototype, "delete"), restore = vi.spyOn(Link.prototype, "restore"),
      option = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptions"), pricing = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets");
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot(), rows = await connected.read();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toBeNull();
      expect(option).not.toHaveBeenCalled(); expect(pricing).not.toHaveBeenCalled();
      const marker = { __type: Object.fromEntries([..."Symbol(WorkflowWorkflowData)"].map((character, index) => [index, [character]])) };
      expect(remove).toHaveBeenCalledExactlyOnceWith(marker); expect(restore).toHaveBeenCalledExactlyOnceWith(marker);
      expect(tap.get()).toEqual({ option: undefined, event: undefined, link: marker });
      expect(await connected.read()).toEqual(rows); expect(eventDelta(before, await connected.snapshot())).toEqual([]);
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); option.mockRestore(); pricing.mockRestore(); }
  }, 240_000);

  it("preserves missing/duplicate raw workflow strings while module maps deduplicate real affected rows", async () => {
    const options = await seed("delete-raw", 2), raw = [options[1]!, "delete-raw-missing", options[0]!, options[1]!];
    const host = await connected.prepare(), before = await connected.snapshot(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptions");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: raw }))).toBeNull();
      const affected = Schema.decodeUnknownSync(Schema.JsonObject)(await remove.mock.results[0]?.value);
      expect(new Set(Schema.decodeUnknownSync(Schema.Array(Schema.String))(affected.shipping_option_id))).toEqual(new Set(options));
      expect(eventDelta(before, await connected.snapshot()).filter(event => event.envelope.contract === "shipping-option.deleted")
        .map(event => event.envelope.message)).toEqual(raw.map(data => ({ name: "shipping-option.deleted", data, metadata: { eventGroupId: expect.any(String) } })));
      const missingBefore = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: ["delete-never-existed"] }))).toBeNull();
      expect(await remove.mock.results[1]?.value).toEqual({});
      expect(eventDelta(missingBefore, await connected.snapshot()).map(event => event.envelope.contract)).toEqual(["shipping-option.deleted"]);
    } finally { remove.mockRestore(); }
  }, 240_000);

  it("deletes the complete four-Option graph once, preserves unrelated rows and replays the settled root", async () => {
    const options = await seed("delete-max", 4, true), beforeRows = await connected.read(), selected = graph(beforeRows, options);
    expect([selected.options.length, selected.rules.length, selected.links.length, selected.sets.length, selected.prices.length, selected.priceRules.length])
      .toEqual([4, 16, 4, 4, 8, 24]);
    const selectedIds = new Set(selected.all.map(row => row.id)), host = await connected.prepare(), key = host.newRequestKey(), before = await connected.snapshot();
    let calls = 0;
    expect(await Effect.runPromise(host.run(key, { ids: options }).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull();
    const rows = await connected.read(), after = await connected.snapshot(), events = eventDelta(before, after);
    expect(graph(rows, options).all.every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(rows.filter(row => !selectedIds.has(row.id))).toEqual(beforeRows.filter(row => !selectedIds.has(row.id)));
    expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
    expect(calls).toBeLessThanOrEqual(shippingOptionDeletionResources.calls); expect(events.length).toBeLessThanOrEqual(shippingOptionDeletionResources.eventMessages);
    console.info("Shipping Option deletion calls/messages", calls, events.length);
    expect(await Effect.runPromise(host.run(key, { ids: options }))).toBeNull(); expect(await connected.snapshot()).toEqual(after);
    await failedUnchanged(host.run(key, { ids: [] }), after);
    const revised = await connected.prepare("1".repeat(64)); await failedUnchanged(revised.run(key, { ids: options }), after);
  }, 240_000);

  it("runs all three genuine retained callbacks and preserves complete preimages while cancelling pending workflow events", async () => {
    const options = await seed("delete-max-inverse", 4, true), beforeRows = await connected.read(), tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: options }))).toBeNull();
      expect(tap.get().option).toEqual(options); expect(stable(await connected.read())).toEqual(stable(beforeRows));
      const events = eventDelta(before, await connected.snapshot());
      expect(events.some(event => event.envelope.contract === "shipping-option.deleted")).toBe(false);
      expect(events.some(event => event.envelope.contract === "fulfillment.shipping-option.restored")).toBe(true);
      expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
    } finally { tap.restore(); }
  }, 240_000);

  it.each(["option", "rule", "price", "priceRule", "pricing", "link", "all"] as const)("preserves the genuine %s historical restoration behavior", async history => {
    const options = await seed("delete-history-" + history), selected = graph(await connected.read(), options);
    if (history === "option" || history === "all") await connected.arrangeDeleted("fulfillment", "shipping_option", options.map(id => ({ id })));
    if (history === "rule" || history === "all") await connected.arrangeDeleted("fulfillment", "shipping_option_rule", selected.rules.map(row => ({ id: id(row.id) })));
    if (history === "price" || history === "all") await connected.arrangeDeleted("pricing", "price", selected.prices.map(row => ({ id: id(row.id) })));
    if (history === "priceRule" || history === "all") await connected.arrangeDeleted("pricing", "price_rule", selected.priceRules.map(row => ({ id: id(row.id) })));
    if (history === "pricing" || history === "all") await connected.arrangeDeleted("pricing", "price_set", selected.sets.map(row => ({ id: id(row.id) })));
    if (history === "link" || history === "all") await connected.arrangeDeleted("priceSetLinks", "shipping_option_price_set", selected.links.map(row => ({
      shipping_option_id: id(row.shipping_option_id), price_set_id: id(row.price_set_id),
    })));
    const beforeRows = await connected.read();
    const arranged = graph(beforeRows, options);
    const historicalRows = { option: arranged.options, rule: arranged.rules, price: arranged.prices,
      priceRule: arranged.priceRules, pricing: arranged.sets, link: arranged.links, all: arranged.all }[history];
    expect(historicalRows.length).toBeGreaterThan(0);
    expect(historicalRows.every(row => typeof row.deleted_at === "string")).toBe(true);
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: options }))).toBeNull();
      const afterRows = await connected.read(), restored = graph(afterRows, options);
      expect(stable(afterRows, true)).toEqual(stable(beforeRows, true));
      expect([...restored.options, ...restored.rules].every(row => row.deleted_at === null)).toBe(true);
      if (history === "all") expect([...restored.links, ...restored.sets, ...restored.prices, ...restored.priceRules].every(row => typeof row.deleted_at === "string")).toBe(true);
      else expect(restored.all.every(row => row.deleted_at === null)).toBe(true);
    } finally { tap.restore(); }
  }, 240_000);

  it("deletes four active partners with eight stored Link histories and refuses conflicting retained restore atomically", async () => {
    const options = await seed("delete-historical-partners", 4, true), initial = graph(await connected.read(), options);
    await connected.replacePricing(initial.links.map(row => ({ option: id(row.shipping_option_id), priceSet: id(row.price_set_id) })), true);
    const beforeRows = await connected.read(), selected = graph(beforeRows, options);
    expect([selected.links.length, selected.sets.length, selected.prices.length, selected.priceRules.length]).toEqual([8, 8, 16, 48]);
    const tap = retainedTap();
    try {
      const inverse = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot();
      await failedUnchanged(inverse.run(inverse.newRequestKey(), { ids: options }), before);
      expect(tap.get().option).toEqual(options);
    } finally { tap.restore(); }
    const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: options }))).toBeNull();
    const after = graph(await connected.read(), options);
    expect(after.links.every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(after.sets.filter(row => row.deleted_at === null)).toHaveLength(4); // Dismissed historical partners were never cascade-selected.
  }, 240_000);

  it("refuses ninth stored Link history without publishing any staged Option changes", async () => {
    const options = await seed("delete-link-overflow");
    for (let attempt = 0; attempt < 8; attempt++) {
      const active = graph(await connected.read(), options).links.find(row => row.deleted_at === null);
      if (active === undefined) throw new Error("Missing actual active Link for replacement history");
      await connected.replacePricing([{ option: options[0]!, priceSet: id(active.price_set_id) }]);
    }
    expect(graph(await connected.read(), options).links).toHaveLength(9);
    const host = await connected.prepare(), before = await connected.snapshot(); await failedUnchanged(host.run(host.newRequestKey(), { ids: options }), before, "limitExceeded");
  }, 240_000);

  it.each(["calls", "events"] as const)("refuses an exhausted %s budget atomically after genuine forward work", async family => {
    const options = await seed("delete-budget-" + family, 4, true), tap = retainedTap();
    try {
      const limits = { ...shippingOptionDeletionResources, ...(family === "calls" ? { calls: 1 } : { eventMessages: 1 }) };
      const host = await connected.prepareRoundtrip(tap.get, limits), before = await connected.snapshot();
      await failedUnchanged(host.run(host.newRequestKey(), { ids: options }), before, "limitExceeded");
    } finally { tap.restore(); }
  }, 240_000);

  it("rolls back a late failure after all three genuine retained callbacks", async () => {
    const options = await seed("delete-late-inverse"), tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, shippingOptionDeletionResources, true), before = await connected.snapshot();
      await failedUnchanged(host.run(host.newRequestKey(), { ids: options }), before);
      expect(tap.get().option).toEqual(options);
    } finally { tap.restore(); }
  }, 240_000);

  it.each(["missingMap", "foreignMap", "late", "caught"] as const)("rolls back %s native failure and revokes escaped service capabilities", async mode => {
    const options = await seed("delete-forgery-" + mode), original = FulfillmentModuleService.prototype.softDeleteShippingOptions;
    let escaped: (() => Promise<unknown>) | undefined;
    const remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptions").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late native Shipping Option deletion failure");
      if (mode === "caught") { try { await this.deleteShippingOptions(options); } catch { /* the genuine denied call keeps the root rollback-only */ } return result; }
      if (typeof result !== "object" || result === null) throw new Error("Missing native deletion result");
      if (mode === "missingMap") Reflect.deleteProperty(result, "shipping_option_rule_id"); else Reflect.set(result, "shipping_option_id", ["foreign-option"]);
      return result;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await failedUnchanged(host.run(host.newRequestKey(), { ids: options }), before);
      if (escaped === undefined) throw new Error("Missing genuine escaped service capability");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { remove.mockRestore(); }
  }, 240_000);

  it("refuses the genuine native caught Pricing cascade error tuple and rolls back all three participants", async () => {
    const options = await seed("delete-pricing-cascade-error"), remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets")
      .mockRejectedValue(new Error("Native Pricing cascade witness refusal")), router = vi.spyOn(Link.prototype, "delete");
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await failedUnchanged(host.run(host.newRequestKey(), { ids: options }), before, "adapterFailure");
      expect(remove).toHaveBeenCalledOnce();
      const tuple: unknown = await router.mock.results[0]?.value;
      expect(tuple).toEqual([expect.any(Array), expect.any(Object)]);
    } finally { remove.mockRestore(); router.mockRestore(); }
  }, 240_000);

  it.each(["foreignCascade", "extraTupleValue"] as const)("refuses %s in the actual native Link result", async mode => {
    const options = await seed("delete-link-forgery-" + mode), original = Link.prototype.delete;
    const remove = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const output = await Reflect.apply(original, this, args);
      if (mode === "foreignCascade") Reflect.set(output, 1, { foreignFamily: {} }); else Reflect.set(output, 2, "extra"); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot(); await failedUnchanged(host.run(host.newRequestKey(), { ids: options }), before);
    } finally { remove.mockRestore(); }
  }, 240_000);

  it("isolates identical raw request and endpoint strings across installed scopes", async () => {
    const options = await seed("delete-scope-left"), other = await scenario("right"), otherSeed = await other.seed("delete-scope-right"),
      otherIds = otherSeed.map(row => id(row.id)), left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const otherBefore = await other.read(); expect(await Effect.runPromise(left.run(key, { ids: options }))).toBeNull();
    expect(await other.read()).toEqual(otherBefore);
    // Same raw ID and request key selects no row in the other scope and emits
    // only its own raw workflow message; its genuine Option remains active.
    expect(await Effect.runPromise(right.run(key, { ids: options }))).toBeNull();
    expect(await other.read()).toEqual(otherBefore); expect(graph(await other.read(), otherIds).all.every(row => row.deleted_at === null)).toBe(true);
    const after = await connected.snapshot(); expect(await Effect.runPromise(left.run(key, { ids: options }))).toBeNull();
    expect(await Effect.runPromise(right.run(key, { ids: options }))).toBeNull(); expect(await connected.snapshot()).toEqual(after);
  }, 240_000);
});

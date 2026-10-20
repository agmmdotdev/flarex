import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { PriceListPriceCreationWorkflowInput } from "../src/modules/pricing/price-list-price-input";
import { prepareCreatePriceListPricesWorkflow } from "../src/workflows/pricing/create-price-list-prices";
import { priceListPriceCreationResources } from "../src/workflow/policy";
import { prepareLogicalPriceListPriceCreation } from "./support/logical-price-list-price-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListPriceCreation>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
type Input = typeof PriceListPriceCreationWorkflowInput.Type;
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const id = (row: JsonObject) => Schema.decodeUnknownSync(Schema.String)(row.id);
const children = (row: JsonObject, field: string) => objects(row[field]);
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native event data");
  const ids = Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  return ids.map(id => [event.envelope.contract, id]);
});
const run = async (input: Input) => { const host = await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input)); };
const price = (variant = 0, amount = 40) => ({ variant_id: connected.variantIds[variant]!, currency_code: "USD", amount });
const seed = async (suffix: string, prices: readonly Input["data"][number]["prices"][number][] = []) => {
  const lists = await connected.seedLists({ price_lists_data: [{ title: "native155-" + suffix, description: suffix, prices }] });
  if (!lists[0]) throw new Error("Missing native seed List");
  return lists[0];
};
const maximumInput = async (suffix: string): Promise<Input> => {
  const lists = await connected.seedLists({ price_lists_data: Array.from({ length: 4 }, (_, index) => ({
    title: `maximum155-${suffix}-${index}`, description: "maximum",
  })) });
  return { data: lists.map((list, index) => ({ id: id(list), prices: [
    { ...price(index, -1.25), min_quantity: -2.5, max_quantity: 0, rules: { region_id: "native-region", arbitrary_rule: "" } },
    { ...price((index + 1) % 4, 0), currency_code: "eur", min_quantity: null, max_quantity: 4.5, rules: { second: "value", first: "value" } },
  ] })) };
};
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};

describe(`genuine native Price List Price creation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalPriceListPriceCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); vi.restoreAllMocks(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps empty and priceless roots native, including replay and empty retained inverse", async () => {
    const list = await seed("empty");
    const before = await connected.snapshot(), add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices"),
      remove = vi.spyOn(PricingModuleService.prototype, "removePrices");
    const host = await connected.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { data: [] }))).toEqual([]);
    expect(await Effect.runPromise(host.run(key, { data: [] }))).toEqual([]);
    expect(await run({ data: [{ id: id(list), prices: [] }] })).toEqual([]);
    const inverse = await connected.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    noMutation(before, await connected.snapshot());
  });

  it("creates the maximum native graph and preserves sparse output, ordered events, budgets and replay", async () => {
    const input = await maximumInput("root");
    const before = await connected.snapshot(), protectedRows = await connected.read(connected.protectedIds);
    let calls = 0;
    const host = await connected.prepare(), key = host.newRequestKey();
    const output = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(calls).toBeGreaterThan(64); expect(calls).toBeLessThanOrEqual(priceListPriceCreationResources.calls);
    console.info("Price List Price maximum root calls", calls);
    expect(output).toHaveLength(8);
    for (const row of output) {
      expect(row).not.toHaveProperty("created_at"); expect(row).not.toHaveProperty("updated_at");
      expect(row).not.toHaveProperty("deleted_at"); expect(row).not.toHaveProperty("title");
      expect(children(row, "price_rules")).toHaveLength(2);
      for (const rule of children(row, "price_rules")) expect(rule).not.toHaveProperty("operator");
    }
    const after = await connected.snapshot(), events = eventsSince(before, after);
    expect(eventVector(events)).toEqual([
      ...output.map(row => ["pricing.price.created", id(row)]),
      ...output.flatMap(row => children(row, "price_rules").map(rule => ["pricing.price-rule.created", id(rule)])),
    ]);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output); noMutation(after, await connected.snapshot());
    expect(await connected.read(connected.protectedIds)).toEqual(protectedRows);
  });

  it("completes maximum retained forward and inverse callbacks within the named allowance", async () => {
    const input = await maximumInput("inverse"), before = await connected.snapshot();
    const protectedIds = [...connected.protectedIds, ...connected.historicalIds, ...input.data.map(row => row.id)];
    const protectedRows = await connected.read(protectedIds), forward = await connected.prepareForward();
    let forwardCalls = 0, inverseCalls = 0;
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") forwardCalls++; return work; },
    })));
    expect(result.output).toHaveLength(8); expect(result.compensation).toEqual(result.output.map(id));
    const selected = result.output.flatMap(row => [id(row), ...children(row, "price_rules").map(id)]);
    expect(selected).toHaveLength(24); expect(await connected.read(selected)).toHaveLength(24);
    const created = await connected.snapshot(); expect(eventsSince(before, created)).toHaveLength(24);
    const order = await connected.readStorageOrder(result.compensation), inverse = await connected.prepareInverse(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, result.compensation).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") inverseCalls++; return work; },
    })))).toBeNull();
    expect(await connected.read(selected)).toEqual([]); expect(await connected.read(protectedIds)).toEqual(protectedRows);
    const removed = await connected.snapshot();
    expect(eventVector(eventsSince(created, removed))).toEqual(order.map(id => ["pricing.price.deleted", id]));
    expect(await Effect.runPromise(inverse.run(key, result.compensation))).toBeNull(); noMutation(removed, await connected.snapshot());
    expect(forwardCalls).toBeGreaterThan(64); expect(inverseCalls).toBeGreaterThan(0);
    for (const calls of [forwardCalls, inverseCalls]) expect(calls).toBeLessThanOrEqual(priceListPriceCreationResources.calls);
    console.info("Price List Price maximum retained callback calls", { forwardCalls, inverseCalls });
  });

  it("completes a maximum nested parent and rolls back the same graph after genuine late failure", async () => {
    const input = await maximumInput("parent"), before = await connected.snapshot();
    const failure = await connected.prepareWrapped({ lateFailure: true });
    await expect(Effect.runPromise(failure.run(failure.newRequestKey(), input))).rejects.toMatchObject({
      reason: "adapterFailure", cause: { message: "Late parent failure after native Price List Price creation" },
    });
    noMutation(before, await connected.snapshot());
    const success = await connected.prepareWrapped(), key = success.newRequestKey(); let calls = 0;
    const output = await Effect.runPromise(success.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(output).toHaveLength(8); const after = await connected.snapshot();
    expect(eventsSince(before, after)).toHaveLength(24);
    expect(await Effect.runPromise(success.run(key, input))).toEqual(output); noMutation(after, await connected.snapshot());
    expect(calls).toBeGreaterThan(64); expect(calls).toBeLessThanOrEqual(priceListPriceCreationResources.calls);
    console.info("Price List Price maximum parent calls", calls);
  });

  it("retains default64 maximum refusal and isolates the named allowance in committed replay identity", async () => {
    const input = await maximumInput("default64"), before = await connected.snapshot(), limited = await connected.prepareDefault64();
    const failed = await Effect.runPromise(Effect.exit(limited.run(limited.newRequestKey(), input)));
    if (failed._tag !== "Failure") throw new Error("Default64 maximum unexpectedly completed");
    expect(reasons(failed.cause)).toEqual(expect.arrayContaining(["limitExceeded", "rollbackOnly"]));
    expect(await connected.snapshot()).toEqual(before);
    const small: Input = { data: [{ id: input.data[0]!.id, prices: [price()] }] }, admitted = await connected.prepare();
    const key = limited.newRequestKey(), output = await Effect.runPromise(limited.run(key, small));
    expect(output).toHaveLength(1); const committed = await connected.snapshot();
    await expect(Effect.runPromise(admitted.run(key, small))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await connected.snapshot()).toEqual(committed);
    const reverseKey = admitted.newRequestKey(), reverseOutput = await Effect.runPromise(admitted.run(reverseKey, small));
    expect(reverseOutput).toHaveLength(1); const reverseCommitted = await connected.snapshot();
    await expect(Effect.runPromise(limited.run(reverseKey, small))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await connected.snapshot()).toEqual(reverseCommitted);
  });

  it.each([false, true])("reuses a finite existing Price with changed amount=%s, preserves stamps and physically deletes its retained ID", async changed => {
    const supplied = { ...price(), min_quantity: 1, max_quantity: 9 };
    const list = await seed("reuse-" + changed, [supplied]);
    const existing = children(list, "prices")[0]!;
    const beforeRow = await connected.read([id(existing)]), before = await connected.snapshot();
    const forward = await connected.prepareForward();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, amount: changed ? 88 : 40 }] }] }));
    expect(result.compensation).toEqual([id(existing)]); expect(result.output.map(id)).toEqual([id(existing)]);
    const afterRow = await connected.read([id(existing)]);
    if (changed) expect(afterRow[0]).toMatchObject({ amount: "88.000000000000000000", created_at: beforeRow[0]?.created_at, updated_at: beforeRow[0]?.updated_at, deleted_at: null });
    else expect(afterRow).toEqual(beforeRow);
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([["pricing.price.updated", id(existing)]]);
    const inverse = await connected.prepareInverse(), inverseBefore = await connected.snapshot();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation))).toBeNull();
    expect(await connected.read([id(existing)])).toEqual([]);
    expect(eventVector(eventsSince(inverseBefore, await connected.snapshot()))).toEqual([["pricing.price.deleted", id(existing)]]);
    const inverseAfter = await connected.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation)); noMutation(inverseAfter, await connected.snapshot());
  });

  it("preserves the explicit-null versus omitted quantity identity boundary", async () => {
    const list = await seed("quantity-presence", [{ ...price(), min_quantity: null, max_quantity: null }]);
    const oldId = id(children(list, "prices")[0]!);
    const explicit = await run({ data: [{ id: id(list), prices: [{ ...price(), min_quantity: null, max_quantity: null }] }] });
    expect(explicit.map(id)).toEqual([oldId]);
    const omitted = await run({ data: [{ id: id(list), prices: [price()] }] });
    expect(omitted).toHaveLength(1); expect(id(omitted[0]!)).not.toBe(oldId); expect(await connected.read([oldId])).toHaveLength(1);
  });

  it("repeats rule-bearing reuse and mixed insertion without temporary Rule duplicates", async () => {
    const supplied = { ...price(), min_quantity: 1, max_quantity: 9, rules: { region_id: "same-native-value" } };
    const list = await seed("rules-mixed", [supplied]), old = children(list, "prices")[0]!;
    const oldRule = children(old, "price_rules")[0]!, untouched = await connected.read(connected.protectedIds);
    const input: Input = { data: [{ id: id(list), prices: [{ ...supplied, amount: 88 }, price(1, 12.5)] }] };
    const before = await connected.snapshot(), output = await run(input);
    expect(output.map(id)[0]).toBe(id(old)); expect(output.map(id)[1]).not.toBe(id(old));
    expect(children(output[0]!, "price_rules").map(id)).toEqual([id(oldRule)]);
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
      ["pricing.price.created", id(output[1]!)], ["pricing.price.updated", id(old)], ["pricing.price-rule.updated", id(oldRule)],
    ]);
    const repeated = await run({ data: [{ id: id(list), prices: [{ ...supplied, amount: 99 }] }] });
    expect(repeated.map(id)).toEqual([id(old)]); expect(children(repeated[0]!, "price_rules").map(id)).toEqual([id(oldRule)]);
    expect(await connected.read(connected.protectedIds)).toEqual(untouched);
  });

  it("keeps per-entry normalization and raw duplicate List entries native", async () => {
    const list = await seed("duplicates-fresh");
    const output = await run({ data: [{ id: id(list), prices: [price(0, 10), price(0, 20)] }, { id: id(list), prices: [price(1, 30)] }] });
    expect(output).toHaveLength(2); expect(output.map(row => row.amount)).toEqual([20, 30]);
    expect(new Set(output.map(id)).size).toBe(2);
  });

  it("physically removes complete historical Rule descendants beyond forward child bounds", async () => {
    const rows = await connected.read(connected.historicalIds);
    const target = rows.find(row => row.price_list_id === connected.historicalRootId && row.price_set_id !== undefined && row.deleted_at !== null);
    if (!target) throw new Error("Missing historical Price comparison root");
    const descendants = rows.filter(row => row.price_id === id(target));
    expect(descendants).toHaveLength(3); expect(descendants.some(row => row.deleted_at !== null)).toBe(true);
    const selected = [id(target), ...descendants.map(id)], protectedIds = rows.filter(row => !selected.includes(id(row))).map(id);
    const protectedRows = await connected.read(protectedIds), before = await connected.snapshot(), inverse = await connected.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), [id(target), id(target), "missing155"]));
    expect(await connected.read(selected)).toEqual([]); expect(await connected.read(protectedIds)).toEqual(protectedRows);
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([["pricing.price.deleted", id(target)]]);
  });

  it.each([false, true])("preserves repeated existing IDs across raw List entries, differing amounts=%s", async changed => {
    const supplied = { ...price(), min_quantity: 1, max_quantity: 9, rules: { region_id: "duplicate-existing" } };
    const list = await seed("duplicate-existing-" + changed, [supplied]), old = children(list, "prices")[0]!, rule = children(old, "price_rules")[0]!;
    const forward = await connected.prepareForward(), before = await connected.snapshot();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [
      { id: id(list), prices: [{ ...supplied, amount: changed ? 77 : 40 }] },
      { id: id(list), prices: [{ ...supplied, amount: changed ? 88 : 40 }] },
    ] }));
    expect(result.compensation).toEqual([id(old), id(old)]);
    expect(result.output.map(id)).toEqual([id(old), id(old)]);
    expect(result.output.map(row => row.amount)).toEqual(changed ? [77, 88] : [40, 40]);
    expect(children(result.output[0]!, "price_rules").map(id)).toEqual([id(rule)]);
    expect(result.output[1]).not.toHaveProperty("price_rules");
    expect((await connected.read([id(old)]))[0]?.amount).toBe(changed ? "77.000000000000000000" : "40.000000000000000000");
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
      ["pricing.price.updated", id(old)], ["pricing.price-rule.updated", id(rule)],
    ]);
    const inverse = await connected.prepareInverse(), beforeInverse = await connected.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read([id(old), id(rule)])).toEqual([]);
    expect(eventVector(eventsSince(beforeInverse, await connected.snapshot()))).toEqual([["pricing.price.deleted", id(old)]]);
  });

  it("applies the portable inverse cohort order to reversed duplicate selectors and preserves siblings", async () => {
    const lists = await connected.seedLists({ price_lists_data: [
      { title: "inverse-order155-A", description: "protected List A", rules: { region_id: ["protected155"] }, prices: [
        { ...price(0, 40), rules: { selected155: "A" } },
        { ...price(1, 44), currency_code: "EUR", rules: { sibling155: "untouched" } },
      ] },
      { title: "inverse-order155-B", description: "protected List B", prices: [
        { ...price(0, 55), currency_code: "CAD", rules: { selected155: "B" } },
      ] },
    ] });
    const listA = lists[0], listB = lists[1];
    if (!listA || !listB) throw new Error("Missing genuine native List seeds");
    const a = children(listA, "prices").find(row => row.currency_code === "USD");
    const sibling = children(listA, "prices").find(row => row.currency_code === "EUR");
    const b = children(listB, "prices").find(row => row.currency_code === "CAD");
    if (!a || !b || !sibling) throw new Error("Missing actual seeded Price identities");
    expect(a.deleted_at).toBeNull(); expect(b.deleted_at).toBeNull();
    expect(children(a, "price_rules")).toHaveLength(1);
    expect(children(b, "price_rules")).toHaveLength(1);
    expect(children(sibling, "price_rules")).toHaveLength(1);
    const selectedIds = [id(a), ...children(a, "price_rules").map(id), id(b), ...children(b, "price_rules").map(id)];
    expect(await connected.read(selectedIds)).toHaveLength(4);
    expect(await connected.readStorageOrder([id(a), id(b)])).toEqual([id(a), id(b)]);
    const protectedIds = [...connected.protectedIds, ...connected.historicalIds, id(listA), id(listB),
      ...children(listA, "price_list_rules").map(id), ...children(listB, "price_list_rules").map(id),
      id(sibling), ...children(sibling, "price_rules").map(id)];
    const protectedRows = await connected.read(protectedIds), before = await connected.snapshot();
    const remove = vi.spyOn(PricingModuleService.prototype, "removePrices");
    const inverse = await connected.prepareInverse(), key = inverse.newRequestKey(), raw = [id(b), id(a), id(a)];
    let calls = 0;
    expect(await Effect.runPromise(inverse.run(key, raw).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })))).toBeNull();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    expect(remove).toHaveBeenCalledTimes(1); expect(remove.mock.calls[0]?.[0]).toEqual(raw);
    expect(await connected.read(selectedIds)).toEqual([]);
    expect(await connected.read(protectedIds)).toEqual(protectedRows);
    const after = await connected.snapshot();
    expect(eventVector(eventsSince(before, after))).toEqual([
      ["pricing.price.deleted", id(a)], ["pricing.price.deleted", id(b)],
    ]);
    expect(await Effect.runPromise(inverse.run(key, raw))).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1); noMutation(after, await connected.snapshot());
  });

  it.each([false, true])("preserves native positional DTO reconstruction with an interleaved fresh Price, fresh first=%s", async freshFirst => {
    const supplied = { ...price(1), min_quantity: 1, max_quantity: 9, rules: { region_id: "interleaved-existing" } };
    const list = await seed("interleaved-" + freshFirst, [supplied]), old = children(list, "prices")[0]!, oldRule = children(old, "price_rules")[0]!;
    const a = { id: id(list), prices: [{ ...supplied, amount: 77 }] }, repeated = { id: id(list), prices: [{ ...supplied, amount: 88 }] };
    const fresh = { id: id(list), prices: [{ ...price(1, 55), currency_code: "CAD", min_quantity: 1, max_quantity: 9, rules: { fresh155: "different" } }] };
    const forward = await connected.prepareForward(), before = await connected.snapshot();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: freshFirst ? [fresh, a, repeated] : [a, repeated, fresh] }));
    expect(result.output.map(row => row.amount)).toEqual(freshFirst ? [55, 77, 88] : [77, 88, 55]);
    const newId = result.output.map(id).find(value => value !== id(old));
    if (!newId) throw new Error("Missing fresh native Price ID");
    expect(result.compensation).toEqual(freshFirst ? [newId, id(old), id(old)] : [id(old), id(old), newId]);
    const firstRules = children(result.output[0]!, "price_rules"), secondRules = children(result.output[1]!, "price_rules");
    const newRule = (freshFirst ? firstRules : secondRules)[0]!;
    expect((freshFirst ? secondRules : firstRules).map(id)).toEqual([id(oldRule)]);
    expect(newRule.price_id).toBe(newId); expect(result.output[2]).not.toHaveProperty("price_rules");
    // Native unique-root indices fill raw response positions; A's second DTO
    // can therefore contain B's Rule. Persisted FK ownership remains strict.
    if (!freshFirst) expect(id(result.output[1]!)).toBe(id(old));
    expect((await connected.read([id(newRule)]))[0]?.price_id).toBe(newId);
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
      ["pricing.price.created", newId], ["pricing.price-rule.created", id(newRule)],
      ["pricing.price.updated", id(old)], ["pricing.price-rule.updated", id(oldRule)],
    ]);
    const inverse = await connected.prepareInverse(), inverseBefore = await connected.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read([id(old), id(oldRule), newId, id(newRule)])).toEqual([]);
    expect(eventVector(eventsSince(inverseBefore, await connected.snapshot())))
      .toEqual([["pricing.price.deleted", id(old)], ["pricing.price.deleted", newId]]);
  });

  it("rolls back reused and fresh graphs after genuine late-parent failure", async () => {
    const supplied = { ...price(), min_quantity: 1, max_quantity: 9, rules: { region_id: "rollback" } };
    const list = await seed("parent-rollback", [supplied]), before = await connected.snapshot();
    const host = await connected.prepareWrapped({ lateFailure: true });
    await expect(Effect.runPromise(host.run(host.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, amount: 88 }, { ...price(1), rules: { first: "a", second: "b" } }] }] }))).rejects.toMatchObject({
      reason: "adapterFailure", cause: { message: "Late parent failure after native Price List Price creation" },
    });
    noMutation(before, await connected.snapshot());
  });

  it("retains sticky rollback after caught authority refusal and revokes escaped native methods", async () => {
    const list = await seed("authority"), before = await connected.snapshot();
    const caught = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(caught.run(caught.newRequestKey(), { data: [{ id: id(list), prices: [price()] }] }))).rejects.toBeDefined();
    noMutation(before, await connected.snapshot());
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ escape: callback => { escaped = callback; } });
    await Effect.runPromise(host.run(host.newRequestKey(), { data: [{ id: id(list), prices: [price()] }] }));
    const after = await connected.snapshot();
    if (!escaped) throw new Error("Expected captured scoped method");
    await expect(escaped()).rejects.toBeDefined(); noMutation(after, await connected.snapshot());
  });

  it.each(["missing-list", "missing-link", "empty-rules"])('preserves native refusal and no settlement for %s', async scenario => {
    const list = await seed("refusal-" + scenario), before = await connected.snapshot();
    const supplied = { ...price(), ...(scenario === "empty-rules" ? { rules: {} } : {}), ...(scenario === "missing-link" ? { variant_id: "missing155" } : {}) };
    await expect(run({ data: [{ id: scenario === "missing-list" ? "missing155" : id(list), prices: [supplied] }] })).rejects.toBeDefined();
    noMutation(before, await connected.snapshot());
  });

  it("rejects a broader Pricing binding before native execution", async () => {
    const broad = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    const refused = await Effect.runPromise(prepareCreatePriceListPricesWorkflow({ ...connected.options,
      modules: { ...connected.options.modules, pricing: { ...connected.options.modules.pricing, module: broad.workflow } },
    }).pipe(Effect.result));
    expect(Result.isFailure(refused)).toBe(true);
  });

  it("recovers a lost commit acknowledgement without reexecuting add and binds its revision", async () => {
    const list = await seed("uncertain"), fixture = connected.fixture; let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price List Price acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareCreatePriceListPricesWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareCreatePriceListPricesWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices");
    try {
      const key = host.newRequestKey(), input: Input = { data: [{ id: id(list), prices: [price()] }] }, output = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(add).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(add).toHaveBeenCalledTimes(1); await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      noMutation(after, await connected.snapshot());
    } finally { await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels staged native writes and fences late callback completion", async () => {
    const list = await seed("interruption"), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const original = PricingModuleService.prototype.addPriceListPrices;
    const add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release)); return output;
      } finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { data: [{ id: id(list), prices: [price()] }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      noMutation(before, await connected.snapshot()); await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); add.mockRestore(); }
  }, 120_000);
});

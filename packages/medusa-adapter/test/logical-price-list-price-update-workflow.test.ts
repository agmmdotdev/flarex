import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { PriceListPriceUpdateWorkflowInput } from "../src/modules/pricing/price-list-price-update-input";
import { prepareUpdatePriceListPricesWorkflow } from "../src/workflows/pricing/update-price-list-prices";
import { priceListPriceUpdateResources } from "../src/workflow/policy";
import { encodeExactNumeric, projectExactNumericColumns } from "../src/value/exact-numeric";
import { prepareLogicalPriceListPriceUpdate } from "./support/logical-price-list-price-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListPriceUpdate>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
type Input = typeof PriceListPriceUpdateWorkflowInput.Type;
type SeedInput = Parameters<typeof connected.seedLists>[0];
type SeedPrice = NonNullable<SeedInput["price_lists_data"][number]["prices"]>[number];
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const text = Schema.decodeUnknownSync(Schema.String);
const id = (row: JsonObject) => text(row.id);
const children = (row: JsonObject, field: string) => objects(row[field]);
const graphIds = (row: JsonObject) => [id(row), ...children(row, "price_rules").map(id)];
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Pricing event data");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id])
    .map(id => [event.envelope.contract, id]);
});
const run = async (input: Input) => { const host = await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input)); };
const price = (variant = 0, amount = 40) => ({ variant_id: connected.variantIds[variant]!, currency_code: "USD", amount });
const finitePrice = (variant = 0, amount = 40) => ({ ...price(variant, amount), min_quantity: 1, max_quantity: 9 });
const seed = async (suffix: string, prices: readonly SeedPrice[] = []) => {
  const lists = await connected.seedLists({ price_lists_data: [{ title: "native156-" + suffix, description: suffix, prices }] });
  if (!lists[0]) throw new Error("Missing genuine native seed List");
  return lists[0];
};
const maximum = async (suffix: string): Promise<Input> => {
  const lists = await connected.seedLists({ price_lists_data: Array.from({ length: 4 }, (_, index) => ({
    title: `maximum156-${suffix}-${index}`, description: "maximum",
  })) });
  return { data: lists.map((list, index) => ({ id: id(list), prices: [
    { ...price(index, -1.25), min_quantity: -2.5, max_quantity: 0, rules: { first156: "", second156: "value" } },
    { ...price((index + 1) % 4, 0), currency_code: "eur", min_quantity: null, max_quantity: 4.5, rules: { second156: "value", first156: "value" } },
  ] })) };
};
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};

describe(`corrected native Price List Price update - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalPriceListPriceUpdate(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); vi.restoreAllMocks(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps the empty root and empty retained inverse native without Pricing work or settlement changes", async () => {
    const before = await connected.snapshot(), snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate"),
      update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceListPrices");
    const host = await connected.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { data: [] }))).toEqual([]);
    const committed = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, { data: [] }))).toEqual([]);
    expect(await connected.snapshot()).toEqual(committed);
    const forward = await connected.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [] }));
    expect(retained).toEqual({ output: [], compensation: { before: [], createdPriceIds: [] } });
    const inverse = await connected.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation))).toBeNull();
    expect(snapshot).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    for (const name of ["rows", "revisions", "rowChanges", "physicalFacts", "events"] as const)
      expect((await connected.snapshot())[name], name).toEqual(before[name]);
  });

  it("validates a nonempty priceless List and retains the genuine empty before/new partition", async () => {
    const list = await seed("priceless"), before = await connected.read(), forward = await connected.prepareForward();
    const snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate"),
      update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices");
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [] }] }));
    expect(result).toEqual({ output: [], compensation: { before: [], createdPriceIds: [] } });
    expect(snapshot).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    expect(snapshot.mock.calls[0]?.[0]).toEqual([{ price_list_id: id(list), prices: [] }]);
    expect(await connected.read()).toEqual(before);
  });

  it("completes the actual maximum root under its independently selected named resources", async () => {
    const input = await maximum("root"), before = await connected.snapshot(), protectedRows = await connected.read(connected.protectedIds);
    const host = await connected.prepare(), key = host.newRequestKey(); let calls = 0;
    const output = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    }), Effect.tapError(() => Effect.sync(() => console.info("Price List Price update maximum failure", {
      driver, test: "maximum-native-root", phase: "root", calls,
    })))));
    expect(output).toHaveLength(8); expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(priceListPriceUpdateResources.calls);
    expect(priceListPriceUpdateResources.calls).toBe(128);
    for (const row of output) { expect(children(row, "price_rules")).toHaveLength(2); expect(row).not.toHaveProperty("updated_at"); }
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
      ...output.map(row => ["pricing.price.created", id(row)]),
      ...output.flatMap(row => children(row, "price_rules").map(rule => ["pricing.price-rule.created", id(rule)])),
    ]);
    expect(await connected.read(connected.protectedIds)).toEqual(protectedRows);
    const committed = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
    expect(await connected.snapshot()).toEqual(committed);
    console.info("Price List Price update maximum root calls", calls);
  });

  it("retains and removes the maximum genuine new graph under separately measured inverse resources", async () => {
    const input = await maximum("retained"), beforeRows = await connected.read(), forward = await connected.prepareForward();
    let forwardCalls = 0, inverseCalls = 0;
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") forwardCalls++; return work; },
    }), Effect.tapError(() => Effect.sync(() => console.info("Price List Price update maximum failure", {
      driver, test: "maximum-new-graph", phase: "retained-forward", calls: forwardCalls,
    })))));
    expect(result.output).toHaveLength(8); expect(result.compensation.before).toEqual([]);
    expect(result.compensation.createdPriceIds).toEqual(result.output.map(id));
    const selected = result.output.flatMap(graphIds); expect(selected).toHaveLength(24); expect(await connected.read(selected)).toHaveLength(24);
    const inverse = await connected.prepareInverse(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, result.compensation).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") inverseCalls++; return work; },
    }), Effect.tapError(() => Effect.sync(() => console.info("Price List Price update maximum failure", {
      driver, test: "maximum-new-graph", phase: "retained-inverse", calls: inverseCalls,
    })))))).toBeNull();
    expect(await connected.read()).toEqual(beforeRows);
    const restored = await connected.snapshot(); expect(await Effect.runPromise(inverse.run(key, result.compensation))).toBeNull();
    expect(await connected.snapshot()).toEqual(restored);
    for (const calls of [forwardCalls, inverseCalls]) { expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(priceListPriceUpdateResources.calls); }
    console.info("Price List Price update maximum retained callback calls", { forwardCalls, inverseCalls });
  });

  it("restores the maximum retained existing graph with complete Rule preimages under independently measured calls", async () => {
    const lists = await connected.seedLists({ price_lists_data: Array.from({ length: 4 }, (_, index) => ({
      title: `maximum156-existing-${index}`, description: "complete retained graph", prices: [
        { ...finitePrice(index, 40), rules: { original156: "first", retained156: "second" } },
        { ...finitePrice((index + 1) % 4, 41), currency_code: "eur", rules: { original156: "third", retained156: "fourth" } },
      ],
    })) });
    const beforeRows = await connected.read(), forward = await connected.prepareForward();
    const input: Input = { data: lists.map((list, index) => ({ id: id(list), prices: children(list, "prices").map((row, priceIndex) => ({
      ...finitePrice(priceIndex === 0 ? index : (index + 1) % 4, 77 + priceIndex), id: id(row), currency_code: text(row.currency_code),
      rules: { replaced156: "first", second156: "second" },
    })) })) };
    let forwardCalls = 0, inverseCalls = 0;
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") forwardCalls++; return work; },
    }), Effect.tapError(() => Effect.sync(() => console.info("Price List Price update maximum failure", {
      driver, test: "maximum-existing-graph", phase: "retained-forward", calls: forwardCalls,
    })))));
    expect(result.output).toHaveLength(8); expect(result.compensation.before).toHaveLength(8); expect(result.compensation.createdPriceIds).toEqual([]);
    expect(result.compensation.before.flatMap(row => row.price_rules)).toHaveLength(16);
    const inverse = await connected.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") inverseCalls++; return work; },
    }), Effect.tapError(() => Effect.sync(() => console.info("Price List Price update maximum failure", {
      driver, test: "maximum-existing-graph", phase: "retained-inverse", calls: inverseCalls,
    })))))).toBeNull();
    expect(await connected.read()).toEqual(beforeRows);
    for (const calls of [forwardCalls, inverseCalls]) { expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(priceListPriceUpdateResources.calls); }
    console.info("Price List Price update maximum existing callback calls", { forwardCalls, inverseCalls });
  });

  it("preserves the original64 refusal and binds the named allowance to durable replay identity", async () => {
    const input = await maximum("original64"), before = await connected.snapshot(), limited = await connected.prepareDefault64();
    const failed = await Effect.runPromise(Effect.exit(limited.run(limited.newRequestKey(), input)));
    if (failed._tag !== "Failure") throw new Error("Original64 maximum unexpectedly completed");
    expect(reasons(failed.cause)).toEqual(expect.arrayContaining(["limitExceeded", "rollbackOnly"]));
    expect(await connected.snapshot()).toEqual(before);
    const small: Input = { data: [{ id: input.data[0]!.id, prices: [price()] }] }, admitted = await connected.prepare();
    const key = limited.newRequestKey(); expect(await Effect.runPromise(limited.run(key, small))).toHaveLength(1);
    const committed = await connected.snapshot();
    await expect(Effect.runPromise(admitted.run(key, small))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await connected.snapshot()).toEqual(committed);
    const reverseKey = admitted.newRequestKey(); expect(await Effect.runPromise(admitted.run(reverseKey, small))).toHaveLength(1);
    const reverseCommitted = await connected.snapshot();
    await expect(Effect.runPromise(limited.run(reverseKey, small))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await connected.snapshot()).toEqual(reverseCommitted);
  });

  it.each([false, true])("restores complete existing Price and Rule identities, changed amount=%s", async changed => {
    const supplied = { ...finitePrice(), rules: { region156: "unchanged" } };
    const list = await seed("existing-" + changed, [supplied]), old = children(list, "prices")[0]!;
    const selected = graphIds(old), beforeRows = await connected.read(selected), before = await connected.snapshot(), forward = await connected.prepareForward();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(),
      { data: [{ id: id(list), prices: [{ ...supplied, amount: changed ? 88 : 40 }] }] }));
    expect(result.output.map(id)).toEqual([id(old)]); expect(result.compensation.createdPriceIds).toEqual([]);
    expect(result.compensation.before).toHaveLength(1);
    const retained = result.compensation.before[0]; if (!retained) throw new Error("Missing actual retained Price graph");
    const storedBefore = beforeRows.find(row => id(row) === id(old)); if (!storedBefore) throw new Error("Missing stored Price preimage");
    expect(retained).toEqual(await Effect.runPromise(projectExactNumericColumns({ ...storedBefore,
      price_rules: beforeRows.filter(row => row.price_id === id(old)) }, connected.contracts.tables.price.columns.filter(column => column.type === "bigNumber"))));
    const updated = (await connected.read([id(old)]))[0];
    expect(updated).toMatchObject({ created_at: old.created_at, updated_at: old.updated_at, deleted_at: old.deleted_at });
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
      ["pricing.price.updated", id(old)], ...children(old, "price_rules").map(rule => ["pricing.price-rule.updated", id(rule)]),
    ]);
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read(selected)).toEqual(beforeRows);
  });

  it("restores committed 40→77→88 attempts through 77 and 40, including Rules and replay", async () => {
    const supplied = { ...finitePrice(), rules: { first156: "original", second156: "retained" } };
    const list = await seed("connected-inverse", [supplied]), old = children(list, "prices")[0]!, originalRows = await connected.read();
    const first = await connected.prepareForward(), second = await connected.prepareForward();
    const firstResult = await Effect.runPromise(first.run(first.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, id: id(old), amount: 77 }] }] }));
    expect(firstResult.output.map(id)).toEqual([id(old)]); expect(firstResult.compensation.createdPriceIds).toEqual([]);
    const firstRows = await connected.read(); expect((await connected.read([id(old)]))[0]?.amount).toBe("77.000000000000000000");
    const secondResult = await Effect.runPromise(second.run(second.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, id: id(old), amount: 88 }] }] }));
    expect(secondResult.output.map(id)).toEqual([id(old)]); expect(secondResult.compensation.createdPriceIds).toEqual([]);
    expect((await connected.read([id(old)]))[0]?.amount).toBe("88.000000000000000000");
    const inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceListPrices"), key = inverse.newRequestKey();
    await Effect.runPromise(inverse.run(key, secondResult.compensation)); expect(await connected.read()).toEqual(firstRows);
    expect(restore).toHaveBeenCalledTimes(1); expect(restore.mock.calls[0]?.[0]).toEqual(secondResult.compensation);
    const restored = await connected.snapshot(); await Effect.runPromise(inverse.run(key, secondResult.compensation));
    expect(restore).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(restored);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), firstResult.compensation));
    expect(await connected.read()).toEqual(originalRows);
  });

  it.each([false, true])("preserves measured native implicit Rule matching, reversed insertion order=%s", async reversed => {
    const list = await seed("native-rule-order-" + reversed, [{ ...finitePrice(), rules: { first156: "original", second156: "retained" } }]);
    const old = children(list, "prices")[0]!, originalRows = await connected.read(), oldRows = await connected.read(graphIds(old));
    const oldRules = children(old, "price_rules"), insertionIds = await connected.readStorageOrder(oldRules.map(id));
    expect(insertionIds).toEqual(oldRules.map(id)); expect(insertionIds).toHaveLength(2);
    // Use independently decoded insertion commit/ordinal evidence. Neither
    // generated Rule IDs nor their lexical order determine candidate traversal.
    const orderedRules = insertionIds.map(value => oldRows.find(row => id(row) === value));
    if (orderedRules.some(row => row === undefined)) throw new Error("Missing actual inserted Rule preimage");
    const entries = orderedRules.map((row): readonly [string, string] => {
      if (row === undefined) throw new Error("Missing native Rule insertion member");
      return [text(row.attribute), text(row.value)];
    });
    const rules = Object.fromEntries(reversed ? [...entries].reverse() : entries), forward = await connected.prepareForward(), before = await connected.snapshot();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [{ ...finitePrice(0, 77), rules }] }] }));
    expect(result.output).toHaveLength(1); const actual = result.output[0]; if (!actual) throw new Error("Missing genuine native Price result");
    const actualRules = children(actual, "price_rules"); expect(actualRules).toHaveLength(2);
    if (reversed) {
      expect(id(actual)).not.toBe(id(old)); expect(result.compensation).toEqual({ before: [], createdPriceIds: [id(actual)] });
      expect(await connected.read(graphIds(old))).toEqual(oldRows);
      expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
        ["pricing.price.created", id(actual)], ...actualRules.map(rule => ["pricing.price-rule.created", id(rule)]),
      ]);
    } else {
      expect(id(actual)).toBe(id(old)); expect(actualRules.map(id)).toEqual(insertionIds);
      expect(result.compensation.before.map(row => row.id)).toEqual([id(old)]); expect(result.compensation.createdPriceIds).toEqual([]);
      expect(result.compensation.before[0]?.price_rules).toEqual(oldRows.filter(row => row.price_id === id(old))
        .sort((left, right) => id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0));
      const encoded = await Effect.runPromise(encodeExactNumeric(77));
      expect(await connected.read(graphIds(old))).toEqual(oldRows.map(row => id(row) === id(old)
        ? { ...row, amount: encoded.value, raw_amount: { ...encoded.raw } } : row));
      expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
        ["pricing.price.updated", id(old)], ...insertionIds.map(value => ["pricing.price-rule.updated", value]),
      ]);
    }
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read()).toEqual(originalRows);
  });

  it("restores replaced Rule IDs/content and removes actual new Rule rows", async () => {
    const list = await seed("replace-rules", [{ ...finitePrice(), rules: { old156: "one", retained156: "two" } }]);
    const old = children(list, "prices")[0]!, beforeRows = await connected.read(), forward = await connected.prepareForward();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [
      { ...finitePrice(0, 77), id: id(old), rules: { new156: "replacement" } },
    ] }] }));
    expect(result.compensation.before[0]?.price_rules).toEqual(beforeRows.filter(row => row.price_id === id(old))
      .sort((left, right) => id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0));
    const replacement = children(result.output[0]!, "price_rules"); expect(replacement).toHaveLength(1);
    expect(children(old, "price_rules").map(id)).not.toContain(id(replacement[0]!));
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read()).toEqual(beforeRows); expect(await connected.read(replacement.map(id))).toEqual([]);
  });

  it("restores the same complete Rule preimages through two independently committed replacement and inverse cycles", async () => {
    const list = await seed("repeated-rule-replay", [{ ...finitePrice(), rules: { original156: "first", retained156: "second" } }]);
    const old = children(list, "prices")[0]!, oldIds = children(old, "price_rules").map(id);
    const originalRows = await connected.read(), originalRuleRows = await connected.read(oldIds);
    expect(originalRuleRows).toHaveLength(2);
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    for (const amount of [77, 88]) {
      const forwardKey = forward.newRequestKey(), inverseKey = inverse.newRequestKey();
      const result = await Effect.runPromise(forward.run(forwardKey, { data: [{ id: id(list), prices: [
        { ...finitePrice(0, amount), id: id(old), rules: { replacement156: "new" } },
      ] }] }));
      expect(result.output.map(id)).toEqual([id(old)]); expect(result.compensation.createdPriceIds).toEqual([]);
      expect(result.compensation.before[0]?.price_rules).toEqual(originalRuleRows);
      const replacement = children(result.output[0]!, "price_rules"); expect(replacement).toHaveLength(1);
      expect(oldIds).not.toContain(id(replacement[0]!)); expect(await connected.read(oldIds)).toEqual([]);
      await Effect.runPromise(inverse.run(inverseKey, result.compensation));
      expect(await connected.read(oldIds)).toEqual(originalRuleRows);
      // The authoritative comparison reader includes every live row of all
      // six Pricing tables and the stored Link table, with complete DML values.
      expect(await connected.read()).toEqual(originalRows);
      expect(await connected.read(replacement.map(id))).toEqual([]);
      const restored = await connected.snapshot();
      expect(await Effect.runPromise(inverse.run(inverseKey, result.compensation))).toBeNull();
      expect(await connected.snapshot()).toEqual(restored);
    }
  });

  it("restores old graphs and deletes only the actual fresh identities in a mixed attempt", async () => {
    const list = await seed("mixed", [{ ...finitePrice(), rules: { original156: "one" } }, { ...price(1, 22), currency_code: "EUR", rules: { sibling156: "untouched" } }]);
    const old = children(list, "prices").find(row => row.currency_code === "USD"); if (!old) throw new Error("Missing selected native seed Price");
    const beforeRows = await connected.read(), forward = await connected.prepareForward();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [
      { ...finitePrice(0, 77), rules: { original156: "one" } }, { ...price(2, -12.5), currency_code: "CAD", rules: { fresh156: "new" } },
    ] }] }));
    expect(result.compensation.before.map(row => row.id)).toEqual([id(old)]);
    expect(result.compensation.createdPriceIds).toHaveLength(1); expect(result.compensation.createdPriceIds).not.toContain(id(old));
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read()).toEqual(beforeRows);
  });

  it.each([false, true])("retains native duplicate-entry positional DTOs while compensation partitions unique actual IDs, fresh first=%s", async freshFirst => {
    const supplied = { ...finitePrice(), rules: { existing156: "same" } };
    const list = await seed("duplicates-" + freshFirst, [supplied]), old = children(list, "prices")[0]!, beforeRows = await connected.read();
    const a = { id: id(list), prices: [{ ...supplied, amount: 77 }] }, repeated = { id: id(list), prices: [{ ...supplied, amount: 88 }] };
    const fresh = { id: id(list), prices: [{ ...finitePrice(0, 55), currency_code: "CAD", rules: { fresh156: "different" } }] };
    const forward = await connected.prepareForward(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), {
      data: freshFirst ? [fresh, a, repeated] : [a, repeated, fresh],
    }));
    expect(result.output.map(row => row.amount)).toEqual(freshFirst ? [55, 77, 88] : [77, 88, 55]);
    const newId = result.output.map(id).find(value => value !== id(old)); if (!newId) throw new Error("Missing genuine new Price ID");
    expect(result.compensation.before.map(row => row.id)).toEqual([id(old)]); expect(result.compensation.createdPriceIds).toEqual([newId]);
    expect(result.output[2]).not.toHaveProperty("price_rules");
    const newRule = children(result.output[freshFirst ? 0 : 1]!, "price_rules")[0]!;
    expect(newRule.price_id).toBe(newId); expect((await connected.read([id(newRule)]))[0]?.price_id).toBe(newId);
    if (!freshFirst) expect(id(result.output[1]!)).toBe(id(old));
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read()).toEqual(beforeRows);
  });

  it("restores cross-List ownership, changed matching fields and complete historical Rule membership", async () => {
    const list = await seed("cross-list-history"), rows = await connected.read(connected.historicalIds);
    const old = rows.find(row => row.price_list_id === connected.historicalRootId && row.price_set_id !== undefined && row.deleted_at === null);
    if (!old) throw new Error("Missing canonical active Price with historical Rules");
    const oldRules = rows.filter(row => row.price_id === id(old)); expect(oldRules).toHaveLength(3);
    expect(oldRules.some(row => row.deleted_at !== null)).toBe(true);
    const beforeRows = await connected.read(), forward = await connected.prepareForward();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [
      { ...price(2, 91.5), id: id(old), currency_code: "CAD", min_quantity: 2, max_quantity: 12, rules: { moved156: "new" } },
    ] }] }));
    expect(result.output.map(id)).toEqual([id(old)]); expect(result.compensation.createdPriceIds).toEqual([]);
    expect(result.compensation.before[0]?.price_rules).toEqual(oldRules);
    expect((await connected.read([id(old)]))[0]).toMatchObject({ price_list_id: id(list), price_set_id: connected.setIds[2], currency_code: "CAD" });
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read()).toEqual(beforeRows);
  });

  it("keeps explicit-null and omitted quantity matching distinct and compensates both actual branches", async () => {
    const supplied = { ...price(), min_quantity: null, max_quantity: null }, list = await seed("quantity-presence", [supplied]);
    const old = children(list, "prices")[0]!, originalRows = await connected.read(), forward = await connected.prepareForward();
    const explicit = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, amount: 77 }] }] }));
    expect(explicit.output.map(id)).toEqual([id(old)]); expect(explicit.compensation.before.map(row => row.id)).toEqual([id(old)]);
    const omitted = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [price(0, 88)] }] }));
    expect(omitted.compensation.before).toEqual([]); expect(omitted.compensation.createdPriceIds).toHaveLength(1);
    expect(omitted.compensation.createdPriceIds).not.toContain(id(old));
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), omitted.compensation));
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), explicit.compensation)); expect(await connected.read()).toEqual(originalRows);
  });

  it("changes a historical Price through40→88 and restores both complete retained generations without reactivation", async () => {
    const list = await seed("historical-price-root"), historicalRows = await connected.read(connected.historicalIds);
    const old = historicalRows.find(row => row.price_list_id === connected.historicalRootId && row.price_set_id !== undefined && row.deleted_at !== null);
    if (!old) throw new Error("Missing canonical historical Price root");
    expect(typeof old.deleted_at).toBe("string");
    const oldRules = historicalRows.filter(row => row.price_id === id(old));
    expect(oldRules).toHaveLength(3); expect(oldRules.some(row => row.deleted_at !== null)).toBe(true);
    const originalRows = await connected.read(), forward = await connected.prepareForward();
    const input = (amount: number): Input => ({ data: [{ id: id(list), prices: [{ id: id(old), variant_id: connected.variantIds[0]!, amount }] }] });
    // Establish40 through the real update owner, preserving the canonical seed
    // and retaining its original graph for the final independent cancellation.
    const first = await Effect.runPromise(forward.run(forward.newRequestKey(), input(40)));
    expect(first.output.map(id)).toEqual([id(old)]); expect(first.compensation.createdPriceIds).toEqual([]);
    expect(first.compensation.before[0]?.deleted_at).toBe(old.deleted_at);
    const forty = await Effect.runPromise(encodeExactNumeric(40)), eightyEight = await Effect.runPromise(encodeExactNumeric(88));
    const at40 = (await connected.read([id(old)]))[0];
    expect(at40).toEqual({ ...old, price_list_id: id(list), amount: forty.value, raw_amount: { ...forty.raw } });
    expect(await connected.read(oldRules.map(id))).toEqual(oldRules);
    const rowsAt40 = await connected.read(), before88 = await connected.snapshot();
    const second = await Effect.runPromise(forward.run(forward.newRequestKey(), input(88)));
    expect(second.output.map(id)).toEqual([id(old)]); expect(second.compensation.createdPriceIds).toEqual([]);
    expect(second.compensation.before[0]?.price_rules).toEqual(oldRules);
    expect((await connected.read([id(old)]))[0]).toEqual({ ...at40, amount: eightyEight.value, raw_amount: { ...eightyEight.raw } });
    expect(eventVector(eventsSince(before88, await connected.snapshot()))).toEqual([["pricing.price.updated", id(old)]]);
    const inverse = await connected.prepareInverse(), key = inverse.newRequestKey();
    await Effect.runPromise(inverse.run(key, second.compensation)); expect(await connected.read()).toEqual(rowsAt40);
    const restored = await connected.snapshot(); await Effect.runPromise(inverse.run(key, second.compensation));
    expect(await connected.snapshot()).toEqual(restored);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), first.compensation)); expect(await connected.read()).toEqual(originalRows);
  });

  it("rolls back the complete graph after the known parent failure and retains rather than invokes its compensator", async () => {
    const supplied = { ...finitePrice(), rules: { rollback156: "old" } }, list = await seed("late-parent", [supplied]);
    const before = await connected.snapshot(), update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices"),
      restore = vi.spyOn(PricingModuleService.prototype, "restorePriceListPrices"), host = await connected.prepareWrapped({ lateFailure: true });
    await expect(Effect.runPromise(host.run(host.newRequestKey(), { data: [{ id: id(list), prices: [
      { ...supplied, amount: 88 }, { ...price(1), rules: { fresh156: "new" } },
    ] }] }))).rejects.toMatchObject({ reason: "adapterFailure", cause: { message: "Late parent failure after native Price List Price update" } });
    expect(update).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
  });

  it.each(["missing-list", "missing-link", "empty-rules"])("retains native refusal and zero settlement for %s", async scenario => {
    const list = await seed("refused-" + scenario), before = await connected.snapshot();
    const supplied = { ...price(), ...(scenario === "empty-rules" ? { rules: {} } : {}), ...(scenario === "missing-link" ? { variant_id: "missing156" } : {}) };
    await expect(run({ data: [{ id: scenario === "missing-list" ? "missing156" : id(list), prices: [supplied] }] })).rejects.toBeDefined();
    expect(await connected.snapshot()).toEqual(before);
  });

  it("rejects compensation and managed preimages on the untrusted forward input before native callbacks", async () => {
    const list = await seed("closed-forward", [finitePrice()]), old = children(list, "prices")[0]!;
    const before = await connected.snapshot(), host = await connected.prepare();
    const snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate"),
      update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceListPrices");
    const attempts = [
      { data: [], before: [old], createdPriceIds: [id(old)] },
      { data: [{ id: id(list), prices: [{ ...finitePrice(), id: id(old), updated_at: "2080-01-01T00:00:00.000Z" }] }] },
      { data: [{ id: id(list), prices: [{ ...finitePrice(), id: id(old), price_rules: children(old, "price_rules") }] }] },
    ];
    for (const input of attempts)
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input))).rejects.toMatchObject({ reason: "invalidInput" });
    expect(snapshot).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    expect(await connected.snapshot()).toEqual(before);
  });

  it("retains sticky authority refusal and revokes escaped snapshot methods after the owned lifetime", async () => {
    const list = await seed("authority"), before = await connected.snapshot(), caught = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(caught.run(caught.newRequestKey(), { data: [{ id: id(list), prices: [price()] }] }))).rejects.toBeDefined();
    expect(await connected.snapshot()).toEqual(before);
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ escape: callback => { escaped = callback; } });
    await Effect.runPromise(host.run(host.newRequestKey(), { data: [{ id: id(list), prices: [price()] }] }));
    if (!escaped) throw new Error("Expected an actual scoped snapshot method");
    const committed = await connected.snapshot(); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(committed);
  });

  it("recovers a lost commit acknowledgement without repeating snapshot/update and binds its revision", async () => {
    const list = await seed("uncertain"), fixture = connected.fixture; let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price List Price update acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareUpdatePriceListPricesWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
    } }));
    const changed = await Effect.runPromise(prepareUpdatePriceListPricesWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices");
    try {
      const key = host.newRequestKey(), input: Input = { data: [{ id: id(list), prices: [price()] }] }, output = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(snapshot).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
      const committed = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(snapshot).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(committed);
    } finally { await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels staged writes and fences the late native update callback", async () => {
    const list = await seed("interruption"), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const original = PricingModuleService.prototype.updatePriceListPrices;
    const update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices").mockImplementation(async function (this: PricingModuleService, ...args) {
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
      expect(await connected.snapshot()).toEqual(before); await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); expect(await connected.snapshot()).toEqual(before);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); update.mockRestore(); }
  }, 120_000);
});

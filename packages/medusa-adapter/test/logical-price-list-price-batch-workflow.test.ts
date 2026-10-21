import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, References, Result, Schema, Tracer } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { PriceListPriceBatchWorkflowInput } from "../src/modules/pricing/price-list-price-batch-input";
import { prepareBatchPriceListPricesWorkflow } from "../src/workflows/pricing/batch-price-list-prices";
import { priceListPriceBatchResources } from "../src/workflow/policy";
import { projectExactNumericColumns } from "../src/value/exact-numeric";
import { prepareLogicalPriceListPriceBatch } from "./support/logical-price-list-price-batch-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListPriceBatch>>;
let protectedRows: Awaited<ReturnType<typeof connected.read>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
type Input = typeof PriceListPriceBatchWorkflowInput.Type;
type SeedInput = Parameters<typeof connected.seedLists>[0];
type SeedPrice = NonNullable<SeedInput["price_lists_data"][number]["prices"]>[number];
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const id = (row: JsonObject) => text(row.id), children = (row: JsonObject, key: string) => objects(row[key]);
const graphIds = (row: JsonObject) => [id(row), ...children(row, "price_rules").map(id)];
const graph = (rows: JsonObject[], ids: readonly string[]) => {
  const prices = rows.filter(row => ids.includes(id(row)) && row.price_set_id !== undefined).sort((left, right) => id(left).localeCompare(id(right)));
  return [...prices, ...prices.flatMap(price => rows.filter(row => row.price_id === price.id).sort((left, right) => id(left).localeCompare(id(right))))];
};
const stable = (rows: JsonObject[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updated_at" && key !== "deleted_at")));
const completeBefore = async (rows: JsonObject[], selected: string) => {
  const root = rows.find(row => row.id === selected && row.price_set_id !== undefined);
  if (!root) throw new Error("Missing independently persisted complete Price preimage");
  return Effect.runPromise(projectExactNumericColumns({ ...root, price_rules: rows.filter(row => row.price_id === selected).sort((left, right) => id(left).localeCompare(id(right))) },
    connected.updateContracts.tables.price.columns.filter(column => column.type === "bigNumber")));
};
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing genuine native Pricing event data");
  const ids = Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  return ids.map(id => [event.envelope.contract, id]);
});
const sorted = (rows: readonly (readonly string[])[]) => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};
function measure<Value, Failure, Requirements>(phase: string, work: Effect.Effect<Value, Failure, Requirements>) {
  let calls = 0, lifetimes = 0;
  const operations = new Map<string, number>();
  return work.pipe(Effect.provideService(ExecutionDiagnostics, { observe: (name, observed) => {
    if (name === "BoundedRequest.enter") calls++;
    if (name === "BoundedRequest.makeLifetime") lifetimes++;
    if (name.startsWith("BoundedRequest.")) operations.set(name, (operations.get(name) ?? 0) + 1);
    return observed;
  } }),
    Effect.onExit(exit => Effect.sync(() => console.info("Price batch aggregate capacity", { driver, phase, calls,
      lifetimes, operations: Object.fromEntries(operations), limit: priceListPriceBatchResources.calls, outcome: exit._tag,
      ...(exit._tag === "Failure" ? { reasons: reasons(exit.cause) } : {}) }))),
    Effect.tap(() => Effect.sync(() => { expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(priceListPriceBatchResources.calls); })));
}
const empty = (list: JsonObject): Input => ({ data: { id: id(list), create: [], update: [], delete: [] } });
const price = (variant = 0, currency = "USD", amount = 40, rules: Record<string, string> = { first158: "original", second158: "retained" }) => ({
  variant_id: connected.variantIds[variant]!, currency_code: currency, amount, rules,
});
// The frozen zero-Rule native witness omits rules entirely and supplies null
// quantities. An explicit empty rules object is a different private boundary.
const priceWithoutRules = () => ({ variant_id: connected.variantIds[0]!, currency_code: "USD", amount: 40,
  min_quantity: null, max_quantity: null });
const seed = async (suffix: string, prices: readonly SeedPrice[] = []) => {
  const lists = await connected.seedLists({ price_lists_data: [{ title: "native158-" + suffix, description: suffix, prices }] });
  if (!lists[0]) throw new Error("Missing genuine native List seed"); return lists[0];
};
// The exact production preparer and invocation share diagnostic composition.
// Native Promise owners capture this policy at their existing request boundary;
// no independently counted workflow/service calls stand in for lifetime charges.
const run = (input: Input, phase = "actual parent") => Effect.runPromise(measure(phase +
  ` [create=${input.data.create.length},update=${input.data.update.length},delete=${input.data.delete.length}]`, Effect.gen(function* () {
    const host = yield* connected.prepareEffect(); return yield* host.run(host.newRequestKey(), input);
  })));
const disjoint = async (suffix: string) => {
  const list = await seed(suffix, [price(0)]), other = await seed(suffix + "-delete", [price(1, "EUR")]);
  const old = children(list, "prices")[0]!, deleted = children(other, "prices")[0]!;
  return { list, old, deleted, input: { data: { id: id(list), create: [price(2, "CAD", 51)],
    update: [{ ...price(0, "USD", 77), id: id(old) }], delete: [id(deleted)] } } satisfies Input };
};
const maximum = async () => {
  const lists = await connected.seedLists({ price_lists_data: Array.from({ length: 4 }, (_, index) => ({ title: "native158-maximum-" + index, description: "maximum", prices: [
    price(index % 3, "USD"), price(index % 3, "EUR"),
  ] })) });
  const selected = lists.flatMap(list => children(list, "prices").map(id)).sort(), first = lists[0];
  if (!first) throw new Error("Missing maximum native List");
  const updates = children(first, "prices");
  expect(selected).toHaveLength(8); expect(lists.flatMap(list => children(list, "prices").flatMap(row => children(row, "price_rules")))).toHaveLength(16);
  return { selected, updates, input: { data: { id: id(first), create: [price(2, "CAD", 221), price(2, "GBP", 222)],
    update: updates.map((row, index) => ({ ...price(0, text(row.currency_code), 223 + index), id: id(row) })), delete: [...selected].reverse(),
  } } satisfies Input };
};

describe(`original native Price List Price batch with combined admission - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalPriceListPriceBatch(driver, close => cleanup.push(close)); protectedRows = await connected.read(connected.protectedIds); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); vi.restoreAllMocks(); expect(await connected.read(connected.protectedIds)).toEqual(protectedRows); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps the approved named256-call profile and executes both genuine empty Link queries, both validators and the empty update calls", async () => {
    expect(priceListPriceBatchResources).toEqual({ ...defaultCommerceResources, calls: 256 });
    const list = await seed("empty"), input = empty(list), before = await connected.snapshot(), spans: string[] = [];
    const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
    const validate = vi.spyOn(PricingModuleService.prototype, "listPriceLists"), add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices"),
      snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices"),
      listPrices = vi.spyOn(PricingModuleService.prototype, "listPrices"), remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices");
    const host = await connected.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provideService(References.TracerEnabled, true))))
      .toEqual({ created: [], updated: [], deleted: [] });
    expect(validate).toHaveBeenCalledTimes(2); expect(spans.filter(name => name === "linkCount")).toHaveLength(2);
    expect(snapshot).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    expect(snapshot.mock.calls[0]?.[0]).toEqual([{ price_list_id: id(list), prices: [] }]); expect(update.mock.calls[0]?.[0]).toEqual([{ price_list_id: id(list), prices: [] }]);
    expect(add).not.toHaveBeenCalled(); expect(listPrices).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    noMutation(before, await connected.snapshot()); const committed = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, input))).toEqual({ created: [], updated: [], deleted: [] }); expect(await connected.snapshot()).toEqual(committed);
    expect(validate).toHaveBeenCalledTimes(2); expect(update).toHaveBeenCalledTimes(1);
  });

  it("preserves missing-List business failure for all-empty entries and rolls back every sibling", async () => {
    const before = await connected.snapshot();
    await expect(run({ data: { id: "missing158-list", create: [], update: [], delete: [] } })).rejects.toMatchObject({ reason: "adapterFailure", cause: {
      type: "not_found", message: "Price lists with id: missing158-list was not found",
    } });
    expect(await connected.snapshot()).toEqual(before);
  });

  it.each(["create", "update", "delete"] as const)("runs the genuine %s-only child while retaining named empty sibling slots", async kind => {
    const list = await seed("single-" + kind, [price()]), old = children(list, "prices")[0]!;
    const input: Input = { data: { id: id(list), create: kind === "create" ? [price(1, "CAD", 51)] : [],
      update: kind === "update" ? [{ id: id(old), ...price(0, "USD", 77) }] : [], delete: kind === "delete" ? [id(old)] : [] } };
    const output = await run(input, "single native " + kind + " child");
    expect(output.created).toHaveLength(kind === "create" ? 1 : 0); expect(output.updated.map(id)).toEqual(kind === "update" ? [id(old)] : []);
    expect(output.deleted).toEqual(kind === "delete" ? [id(old)] : []);
    if (kind === "create") expect(output.created[0]).toMatchObject({ amount: 51, price_list_id: id(list), currency_code: "CAD" });
    const persisted = (await connected.read([id(old)]))[0]; expect(persisted?.deleted_at).toEqual(kind === "delete" ? expect.any(String) : null);
    expect(persisted?.amount).toBe(kind === "update" ? "77.000000000000000000" : "40.000000000000000000");
  });

  it("returns complete disjoint child slot values and identities with the correct full persisted graph and event membership", async () => {
    const { input, old, deleted } = await disjoint("disjoint"), beforeRows = await connected.read(), before = await connected.snapshot();
    const add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices"),
      snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate");
    const host = await connected.prepare(), key = host.newRequestKey(), output = await Effect.runPromise(measure("disjoint root", host.run(key, input)));
    expect(output.created).toEqual(await add.mock.results[0]?.value); expect(output.updated).toEqual(await update.mock.results[0]?.value);
    expect(output.created).toHaveLength(1); expect(output.updated.map(id)).toEqual([id(old)]); expect(output.deleted).toEqual([id(deleted)]);
    expect(output.created.map(id)).not.toContain(id(old)); expect(snapshot).toHaveBeenCalledTimes(1);
    const actualSnapshot = await snapshot.mock.results[0]?.value;
    expect(actualSnapshot?.prices).toEqual([await completeBefore(beforeRows, id(old))]);
    const afterRows = await connected.read(), created = output.created[0]!, updatedPrice = output.updated[0]!;
    const oldRules = children(old, "price_rules"), newRules = children(updatedPrice, "price_rules");
    expect(children(created, "price_rules")).toHaveLength(2); expect(newRules).toHaveLength(2);
    // Native normalization reuses Rule IDs only for a complete hash match.
    // These inputs omit quantity keys present as null on the old DTO, so the
    // explicit Price ID survives while the supplied Rules receive new IDs.
    expect(newRules.every(rule => !oldRules.some(oldRule => oldRule.id === rule.id))).toBe(true);
    expect(await connected.read(oldRules.map(id))).toEqual([]);
    const persistedRules = afterRows.filter(row => row.price_id === id(old));
    expect(persistedRules.map(id).sort()).toEqual(newRules.map(id).sort()); expect(persistedRules.every(row => row.deleted_at === null)).toBe(true);
    expect(Object.fromEntries(persistedRules.map(row => [text(row.attribute), text(row.value)]))).toEqual(input.data.update[0]?.rules);
    for (const rule of newRules) expect(persistedRules.find(row => row.id === rule.id)).toMatchObject(rule);
    expect((await connected.read([id(old)]))[0]?.amount).toBe("77.000000000000000000");
    expect(graph(afterRows, [id(deleted)]).every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(stable(graph(afterRows, [id(deleted)]))).toEqual(stable(graph(beforeRows, [id(deleted)])));
    const touched = new Set([...graphIds(old), ...graphIds(deleted), ...graphIds(created), ...graphIds(updatedPrice)]);
    expect(afterRows.filter(row => !touched.has(id(row)))).toEqual(beforeRows.filter(row => !touched.has(id(row))));
    const expected = [["pricing.price.created", id(created)], ...children(created, "price_rules").map(rule => ["pricing.price-rule.created", id(rule)]),
      ["pricing.price.updated", id(old)], ...oldRules.map(rule => ["pricing.price-rule.deleted", id(rule)]),
      ...newRules.map(rule => ["pricing.price-rule.created", id(rule)]),
      ["pricing.price.deleted", id(deleted)], ...children(deleted, "price_rules").map(rule => ["pricing.price-rule.deleted", id(rule)])];
    const after = await connected.snapshot(); expect(sorted(eventVector(eventsSince(before, after)))).toEqual(sorted(expected)); expect(after.physicalFacts).toEqual(before.physicalFacts);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await connected.snapshot()).toEqual(after);
    expect(add).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
  });

  it("preserves base and cross-List deletion without treating raw IDs as membership of the parent List", async () => {
    const list = await seed("raw-parent"), other = await seed("raw-other", [price(1)]), selected = id(children(other, "prices")[0]!), sets = await connected.seedBasePrice();
    if (!sets[0] || !children(sets[0], "prices")[0]) throw new Error("Missing genuine native base Price seed");
    const base = id(children(sets[0], "prices")[0]!), before = await connected.read();
    const output = await run({ data: { id: id(list), create: [], update: [], delete: [selected, base, selected, "", id(list), "missing158"] } });
    expect(output).toEqual({ created: [], updated: [], deleted: [base, selected].sort() });
    const inverse = await connected.prepareIdsInverse("removal"); await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.deleted));
    expect(stable(await connected.read())).toEqual(stable(before));
  });

  it.each([false, true])("proves zero-Rule existing-ID creation reuse, same-ID update sibling=%s", async alsoUpdate => {
    const supplied = priceWithoutRules(), list = await seed("reuse-" + alsoUpdate, [supplied]), old = children(list, "prices")[0]!;
    const output = await run({ data: { id: id(list), create: [{ ...supplied, amount: 207 }],
      update: alsoUpdate ? [{ ...supplied, id: id(old), amount: 209 }] : [], delete: [] } });
    expect(output.created.map(id)).toEqual([id(old)]); expect(output.updated.map(id)).toEqual(alsoUpdate ? [id(old)] : []); expect(output.deleted).toEqual([]);
    expect((await connected.read([id(old)]))[0]?.deleted_at).toBeNull();
    if (!alsoUpdate) expect((await connected.read([id(old)]))[0]?.amount).toBe("207.00000000000000000");
  });

  it("executes update/delete overlap without accepting a new adapter refusal or claiming coherent parent-wide snapshots", async () => {
    const list = await seed("update-delete", [price()]), old = children(list, "prices")[0]!, before = await connected.snapshot();
    // Omitted rules matches the frozen native overlap witness. The native
    // snapshot and update remain separate calls and no sibling order is imposed.
    const output = await run({ data: { id: id(list), create: [], update: [{ id: id(old), variant_id: connected.variantIds[0]!, amount: 210, currency_code: "USD" }], delete: [id(old)] } });
    expect(output.updated.map(id)).toEqual([id(old)]); expect(output.deleted).toEqual([id(old)]); expect(output.created).toEqual([]);
    const stored = (await connected.read([id(old)]))[0]; expect(stored?.amount).toBe("210.00000000000000000"); expect(stored?.deleted_at).toEqual(expect.any(String));
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual(expect.arrayContaining([["pricing.price.updated", id(old)], ["pricing.price.deleted", id(old)]]));
  });

  it("measures two creates, two updates and eight genuinely selected deletions with sixteen Rules under the approved profile", async () => {
    const { input, selected, updates } = await maximum(), beforeRows = await connected.read(), before = await connected.snapshot(), host = await connected.prepare();
    const originalRules = beforeRows.filter(row => typeof row.price_id === "string" && selected.includes(row.price_id));
    const updatedIds = updates.map(id), replacedRules = originalRules.filter(row => typeof row.price_id === "string" && updatedIds.includes(row.price_id));
    expect(originalRules).toHaveLength(16); expect(replacedRules).toHaveLength(4);
    const output = await Effect.runPromise(measure("native mixed maximum 2 create + 2 update + 8 selected delete", host.run(host.newRequestKey(), input)));
    expect(output.created).toHaveLength(2); expect(output.updated.map(id)).toEqual(updates.map(id)); expect(output.deleted).toEqual(selected);
    const createdRules = output.created.flatMap(row => children(row, "price_rules")), replacementRules = output.updated.flatMap(row => children(row, "price_rules"));
    expect(createdRules).toHaveLength(4); expect(replacementRules).toHaveLength(4);
    const afterRows = await connected.read(), surviving = afterRows.filter(row => typeof row.price_id === "string" && selected.includes(row.price_id));
    expect(surviving).toHaveLength(16);
    expect(surviving.filter(row => row.deleted_at === null).map(id).sort()).toEqual(replacementRules.map(id).sort());
    expect(surviving.filter(row => row.deleted_at !== null).map(id).sort()).toEqual(originalRules.filter(row => !replacedRules.some(old => old.id === row.id)).map(id).sort());
    expect(await connected.read(replacedRules.map(id))).toEqual([]);
    expect(afterRows.filter(row => selected.includes(id(row))).every(row => typeof row.deleted_at === "string")).toBe(true);
    for (const expected of input.data.update) {
      const parent = afterRows.find(row => row.id === expected.id && row.price_set_id !== undefined);
      expect(parent?.deleted_at).toEqual(expect.any(String)); expect(Number(parent?.amount)).toBe(expected.amount);
      const rules = surviving.filter(row => row.price_id === expected.id);
      expect(rules).toHaveLength(2); expect(rules.every(row => row.deleted_at === null)).toBe(true);
      expect(Object.fromEntries(rules.map(row => [text(row.attribute), text(row.value)]))).toEqual(expected.rules);
    }
    for (const row of [...createdRules, ...replacementRules]) expect(afterRows.find(stored => stored.id === row.id && stored.price_id === row.price_id)).toMatchObject(row);
    const touched = new Set([...selected, ...originalRules.map(id), ...output.created.flatMap(graphIds), ...replacementRules.map(id)]);
    expect(afterRows.filter(row => !touched.has(id(row)))).toEqual(beforeRows.filter(row => !touched.has(id(row))));
    // Frozen native158 maximum: new4 + replacement4 Rule creates, original16
    // lifecycle deletions plus physical deletion of the four replaced Rules.
    // Compare the complete multiset without imposing sibling/branch order.
    const expectedEvents = [...output.created.map(row => ["pricing.price.created", id(row)]),
      ...[...createdRules, ...replacementRules].map(row => ["pricing.price-rule.created", id(row)]),
      ...selected.map(value => ["pricing.price.deleted", value]),
      ...[...originalRules, ...replacedRules].map(row => ["pricing.price-rule.deleted", id(row)]),
      ...updatedIds.map(value => ["pricing.price.updated", value])];
    const after = await connected.snapshot(), events = eventVector(eventsSince(before, after));
    expect(events).toHaveLength(40); expect(sorted(events)).toEqual(sorted(expectedEvents));
    expect(events.length).toBeLessThanOrEqual(priceListPriceBatchResources.eventMessages); expect(after.physicalFacts).toEqual(before.physicalFacts);
  });

  it("retains genuine creation callbacks and honestly preserves destructive physical inverse loss for an existing reused Price", async () => {
    const supplied = priceWithoutRules(), list = await seed("destructive-native-inverse", [supplied]), old = children(list, "prices")[0]!;
    const forward = await connected.prepareCreationForward(), retained = await Effect.runPromise(measure("creation retained forward", forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, amount: 88 }] }] })));
    expect(retained.output.map(id)).toEqual([id(old)]); expect(retained.compensation).toEqual([id(old)]);
    const inverse = await connected.prepareIdsInverse("creation"), key = inverse.newRequestKey();
    expect(await Effect.runPromise(measure("original destructive creation inverse", inverse.run(key, retained.compensation)))).toBeNull(); expect(await connected.read([id(old)])).toEqual([]);
    const removed = await connected.snapshot(); expect(await Effect.runPromise(inverse.run(key, retained.compensation))).toBeNull(); expect(await connected.snapshot()).toEqual(removed);
    // Native 155 deliberately deletes reused old identities. Successful native
    // cancellation cannot establish restoration of the original batch graph.
  });

  it("retains the original corrected update's complete preimages and restores two committed generations exactly", async () => {
    const supplied = price(), list = await seed("update-inverses", [supplied]), old = children(list, "prices")[0]!, original = await connected.read();
    const forward = await connected.prepareUpdateForward(), first = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, id: id(old), amount: 77 }] }] }));
    expect(first.compensation.before.map(row => row.id)).toEqual([id(old)]); expect(first.compensation.createdPriceIds).toEqual([]);
    expect(first.compensation.before).toEqual([await completeBefore(original, id(old))]);
    expect(first.compensation.before[0]?.price_rules.map(row => row.id)).toEqual(children(old, "price_rules").map(id).sort());
    const firstRows = await connected.read(), second = await Effect.runPromise(forward.run(forward.newRequestKey(), { data: [{ id: id(list), prices: [{ ...supplied, id: id(old), amount: 88 }] }] }));
    expect(second.compensation.before).toEqual([await completeBefore(firstRows, id(old))]);
    const inverse = await connected.prepareUpdateInverse(); await Effect.runPromise(measure("original update inverse", inverse.run(inverse.newRequestKey(), second.compensation)));
    expect(await connected.read()).toEqual(firstRows); await Effect.runPromise(inverse.run(inverse.newRequestKey(), first.compensation)); expect(await connected.read()).toEqual(original);
  });

  it("uses complete historical current-graph restoration through the original removal child with zero restore events", async () => {
    const selected = "price152-comparison-0", beforeRows = await connected.read(), closure = graph(beforeRows, [selected]);
    expect(closure.filter(row => row.price_id !== undefined)).toHaveLength(3); expect(closure.some(row => row.deleted_at !== null)).toBe(true);
    const forward = await connected.prepareRemovalForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    expect(retained).toEqual({ output: [selected], compensation: [selected] });
    const before = await connected.snapshot(), inverse = await connected.prepareIdsInverse("removal"); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation));
    const restored = graph(await connected.read(), [selected]); expect(stable(restored)).toEqual(stable(closure)); expect(restored.every(row => row.deleted_at === null)).toBe(true);
    expect(eventsSince(before, await connected.snapshot())).toEqual([]);
  });

  it("does not recreate a retained Price physically removed by the genuine creation inverse", async () => {
    const list = await seed("physical-missing", [price()]), old = children(list, "prices")[0]!, selected = id(old), forward = await connected.prepareRemovalForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    const physical = await connected.prepareIdsInverse("creation"); await Effect.runPromise(physical.run(physical.newRequestKey(), [selected]));
    expect(await connected.read(graphIds(old))).toEqual([]);
    const before = await connected.snapshot(), inverse = await connected.prepareIdsInverse("removal"); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation));
    expect(await connected.read(graphIds(old))).toEqual([]); noMutation(before, await connected.snapshot());
  });

  it("rolls back an actual three-child batch after late parent failure without executing transaction-covered inverses", async () => {
    const { input } = await disjoint("late-parent"), before = await connected.snapshot(), host = await connected.prepareWrapped({ lateFailure: true });
    const add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices"), remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices"),
      undoCreate = vi.spyOn(PricingModuleService.prototype, "removePrices"), undoUpdate = vi.spyOn(PricingModuleService.prototype, "restorePriceListPrices"), undoRemove = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    const failed = await Effect.runPromise(Effect.exit(measure("actual batch late parent", host.run(host.newRequestKey(), input))));
    expect(failed._tag).toBe("Failure"); if (failed._tag !== "Failure") throw new Error("Late batch parent unexpectedly committed");
    expect(reasons(failed.cause)).toContain("Late parent failure after original Price batch");
    expect(add).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    expect(undoCreate).not.toHaveBeenCalled(); expect(undoUpdate).not.toHaveBeenCalled(); expect(undoRemove).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
  });

  it("preserves child failure and one atomic rollback when a genuine validator rejects a Variant alongside deletion", async () => {
    const list = await seed("child-failure", [price()]), old = children(list, "prices")[0]!, before = await connected.snapshot();
    const host = await connected.prepare();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { data: { id: id(list),
      create: [{ ...price(0, "CAD", 51), variant_id: "missing158-variant" }], update: [], delete: [id(old)] } }));
    if (Exit.isSuccess(failed)) throw new Error("Native Variant validation unexpectedly committed the batch");
    const native = failed.cause.reasons.filter(Cause.isFailReason).filter(reason => reason.error.reason === "adapterFailure");
    expect(native).toHaveLength(1);
    const error = native[0]?.error.cause;
    expect(error).toBeInstanceOf(MedusaError);
    expect(error).toMatchObject({ type: "invalid_data", message: "No price set exist for variants: missing158-variant" });
    expect(failed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === error)).toBe(false);
    expect(await connected.snapshot()).toEqual(before);
  });

  it("commits two actual batch update cycles with distinct old snapshots and durable replay", async () => {
    const list = await seed("cycles", [price()]), old = children(list, "prices")[0]!, snapshot = vi.spyOn(PricingModuleService.prototype, "snapshotPriceListPricesForUpdate"), host = await connected.prepare();
    for (const [cycle, amount] of [77, 88].entries()) {
      const input: Input = { data: { id: id(list), create: [], update: [{ ...price(0, "USD", amount), id: id(old) }], delete: [] } }, key = host.newRequestKey();
      const beforeRows = await connected.read(), oldRules = beforeRows.filter(row => row.price_id === id(old)), before = await connected.snapshot();
      expect(oldRules).toHaveLength(2);
      const output = await Effect.runPromise(host.run(key, input)); expect(output.updated.map(id)).toEqual([id(old)]);
      expect(snapshot).toHaveBeenCalledTimes(cycle + 1);
      expect((await snapshot.mock.results[cycle]?.value)?.prices).toEqual([await completeBefore(beforeRows, id(old))]);
      expect((await connected.read([id(old)]))[0]?.amount).toBe(amount === 77 ? "77.000000000000000000" : "88.000000000000000000");
      const newRules = children(output.updated[0]!, "price_rules"), persistedRules = (await connected.read()).filter(row => row.price_id === id(old));
      expect(newRules).toHaveLength(2); expect(newRules.every(rule => !oldRules.some(oldRule => oldRule.id === rule.id))).toBe(true);
      expect(await connected.read(oldRules.map(id))).toEqual([]); expect(persistedRules.map(id).sort()).toEqual(newRules.map(id).sort());
      expect(persistedRules.every(row => row.deleted_at === null)).toBe(true);
      expect(Object.fromEntries(persistedRules.map(row => [text(row.attribute), text(row.value)]))).toEqual(input.data.update[0]?.rules);
      for (const rule of newRules) expect(persistedRules.find(row => row.id === rule.id)).toMatchObject(rule);
      const expected = [["pricing.price.updated", id(old)], ...oldRules.map(rule => ["pricing.price-rule.deleted", id(rule)]),
        ...newRules.map(rule => ["pricing.price-rule.created", id(rule)])];
      expect(sorted(eventVector(eventsSince(before, await connected.snapshot())))).toEqual(sorted(expected));
      const committed = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await connected.snapshot()).toEqual(committed);
    }
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect((await snapshot.mock.results[0]?.value)?.prices.find((row: JsonObject) => row.id === id(old))?.amount).toBe(40);
    expect((await snapshot.mock.results[1]?.value)?.prices.find((row: JsonObject) => row.id === id(old))?.amount).toBe(77);
  });

  it("exposes exactly nine Pricing methods plus read-only Query and keeps refusal and escaped authority fenced", async () => {
    const list = await seed("authority"), input = empty(list), before = await connected.snapshot(), refused = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(refused.run(refused.newRequestKey(), input))).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: resources => {
      expect(Object.keys(Object(resources)).sort()).toEqual(["event_bus", "pricing", "query", "remoteQuery"]);
      expect(Object.keys(Object(Reflect.get(Object(resources), "pricing"))).sort()).toEqual([
        "addPriceListPrices", "listPriceLists", "listPrices", "removePrices", "restorePriceListPrices", "restorePrices",
        "snapshotPriceListPricesForUpdate", "softDeletePrices", "updatePriceListPrices",
      ]);
    }, escape: callback => { escaped = callback; } });
    await Effect.runPromise(host.run(host.newRequestKey(), input)); if (!escaped) throw new Error("Missing escaped method");
    const committed = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); expect(await connected.snapshot()).toEqual(committed);
  });

  it("requires all three arrays and update IDs and rejects accessors, managed fields, overflow and another authentic profile", async () => {
    const list = await seed("contracts"), host = await connected.prepare(), before = await connected.snapshot(), getter = vi.fn(() => id(list));
    const accessor = Object.defineProperty({ create: [], update: [], delete: [] }, "id", { enumerable: true, get: getter });
    for (const input of [{ data: accessor }, { data: { id: id(list), create: [], update: [] } }, { data: { id: id(list), create: [], delete: [], update: [price()] } },
      { data: { ...empty(list).data, create: [price(), price(), price()] } }, { data: { ...empty(list).data, delete: Array(9).fill("") } },
      { data: { ...empty(list).data, managed: true } }])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    const other = await Effect.runPromise(makeLocalPricingCommands("price-list-price-updates"));
    // Deliberately cross the foreign callable boundary: this authentic module
    // cannot satisfy the batch method union, and must fail runtime authority.
    await expect(Effect.runPromise(Reflect.apply(prepareBatchPriceListPricesWorkflow, undefined, [{ ...connected.options, modules: { ...connected.options.modules,
      pricing: { ...connected.options.modules.pricing, module: other.workflow } } }]))).rejects.toMatchObject({ reason: "invalidAuthority" });
  });

  it("recovers a lost acknowledgement without reexecuting the native parent and refuses changed replay identity", async () => {
    const list = await seed("lost-ack", [price()]), old = children(list, "prices")[0]!, fixture = connected.fixture; let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false; return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price batch acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareBatchPriceListPricesWorkflow({ ...connected.options, execution: { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareBatchPriceListPricesWorkflow({ ...connected.options, revision: "a".repeat(64) })), update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices");
    try {
      const key = host.newRequestKey(), input: Input = { data: { id: id(list), create: [], update: [{ ...price(0, "USD", 77), id: id(old) }], delete: [] } };
      const output = await Effect.runPromise(host.run(key, input)); expect(lose).toBe(false); expect(update).toHaveBeenCalledTimes(1);
      const committed = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(update).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(committed);
    } finally { await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels the actual parallel parent after genuine staged creation and fences late callback completion", async () => {
    const { input } = await disjoint("cancel"), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const original = PricingModuleService.prototype.addPriceListPrices;
    const add = vi.spyOn(PricingModuleService.prototype, "addPriceListPrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result; }
      finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const before = await connected.snapshot(), host = await connected.prepare(), remove = vi.spyOn(PricingModuleService.prototype, "removePrices"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceListPrices");
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), input));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); yield* Fiber.interrupt(fiber); })));
      expect(add).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      await Effect.runPromise(Deferred.succeed(release, undefined)); await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000)));
      expect(await connected.snapshot()).toEqual(before);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareTaxRateDeletionWorkflow } from "../src/workflows/tax/delete-rates";
import { taxInput, taxRate, taxRegion, taxRule, taxSeed, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRateDeletion, taxRateDeleteRegions, taxRateDeleteIds, taxRateDeleteRuleIds,
  taxRateDeleteStamp, taxRateDeletionRows, type TaxRateDeletionInput } from "./support/logical-tax-rate-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const decodeString = Schema.decodeUnknownSync(Schema.String);
const decodeStrings = Schema.decodeUnknownSync(Schema.Array(Schema.String));
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRateDeletion>>, sharedCleanupCount = 0, ordinal = 0;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
const id = (row: JsonObject) => decodeString(row.id);
const eventsSince = (before: Inventory, after: Inventory) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Inventory["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing complete native Tax event");
  const ids = decodeStrings(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  return ids.map(value => [event.envelope.contract, value]);
});
function noTaxMutation(before: Inventory, after: Inventory) {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
}
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRateDeletionRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRateDeletion(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-rate-delete-${name}-${number}`, projectId: "tax-rate-delete-169", uuidOffset: 8_000_000 + number * 10_000 } });
}
const run = async (local: Local, ids: TaxRateDeletionInput) => {
  const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), { ids }));
};
const retained = async (local: Local, ids: TaxRateDeletionInput) => {
  const host = await local.prepareForward(); return Effect.runPromise(host.run(host.newRequestKey(), ids));
};
const restore = async (local: Local, ids: TaxRateDeletionInput) => {
  const host = await local.prepareInverse(); return Effect.runPromise(host.run(host.newRequestKey(), ids));
};
const history = (rows: readonly TaxInitialRow[], ids: readonly string[]) => rows.map(value => ids.includes(id(value.row))
  ? { ...value, row: { ...value.row, deleted_at: taxRateDeleteStamp } } : value);
const sortedRates = [...taxRateDeleteIds].sort();
const sortedRuleRows = () => taxRateDeletionRows().filter(value => value.table === "tax_rate_rule")
  .sort((a, b) => String(a.row.tax_rate_id).localeCompare(String(b.row.tax_rate_id)) || id(a.row).localeCompare(id(b.row)));
const allSelected = [...taxRateDeleteIds, ...taxRateDeleteRuleIds];

/** Original MikroORM witnesses remain separate. This suite selects the human-
 * approved portable ordering while invoking genuine native service callbacks. */
describe(`genuine native Tax Rate cascade deletion - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalTaxRateDeletion(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("keeps the genuine void empty root service call and skips empty retained inverse resolution", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates"),
      inverse = vi.spyOn(TaxModuleService.prototype, "restoreTaxRates");
    expect(await run(local, [])).toBeNull(); expect(remove).toHaveBeenCalledTimes(1); expect(remove.mock.calls[0]?.[0]).toEqual([]);
    expect(await restore(local, [])).toBeNull(); expect(inverse).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("commits maximum Rate-first ID ordering then separately commits the genuine maximum retained inverse within default calls", async () => {
    const local = await scenario("maximum"), before = await local.snapshot(), original = await local.read(), host = await local.prepareForward();
    const input = [taxRateDeleteIds[1], taxRateDeleteIds[3], taxRateDeleteIds[0], taxRateDeleteIds[2]], copy = [...input]; let calls = 0;
    const ids = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(ids).toEqual(copy); expect(input).toEqual(copy);
    const deleted = await local.read(), committed = await local.snapshot();
    for (const row of original) {
      const after = deleted.find(value => value.id === row.id); if (after === undefined) throw new Error("Lost retained Tax row");
      if (allSelected.includes(id(row))) { expect(typeof after.deleted_at).toBe("string"); expect(after.updated_at).toBe(after.deleted_at);
        expect(after).toEqual({ ...row, deleted_at: after.deleted_at, updated_at: after.updated_at }); }
      else expect(after).toEqual(row);
    }
    expect(eventVector(eventsSince(before, committed))).toEqual([
      ...sortedRates.map(value => ["tax.tax-rate.deleted", value]), ...sortedRuleRows().map(value => ["tax.tax-rate-rule.deleted", id(value.row)]),
    ]);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Tax Rate deletion maximum root calls", calls);
    const inverse = await local.prepareInverse(); calls = 0;
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })))).toBeNull();
    const restored = await local.read();
    for (const row of original) { const after = restored.find(value => value.id === row.id);
      expect(after).toEqual(allSelected.includes(id(row)) ? { ...row, updated_at: after?.updated_at } : row); }
    expect(eventsSince(committed, await local.snapshot())).toEqual([]);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Tax Rate restoration maximum root calls", calls);
  }, 240_000);

  it("retains raw duplicate, missing and empty-string positions while maps deduplicate selected IDs", async () => {
    const local = await scenario("raw"), target = taxRateDeleteIds[0], input = ["missing", target, target, ""],
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates"), inverse = vi.spyOn(TaxModuleService.prototype, "restoreTaxRates");
    expect(await retained(local, input)).toEqual(input); expect(remove.mock.calls[0]?.[0]).toEqual(input);
    expect(await restore(local, input)).toBeNull(); expect(inverse.mock.calls[0]?.[0]).toEqual(input);
    const raw = await local.prepareRaw(true), rules = sortedRuleRows().filter(value => value.row.tax_rate_id === target).map(value => id(value.row));
    expect(await Effect.runPromise(raw.run(raw.newRequestKey(), input))).toEqual({ tax_rate_id: [target], tax_rate_rule_id: rules });
  }, 240_000);

  it.each([["missing"], [""]])("keeps absent selection %j free of mutations", async value => {
    const local = await scenario("missing"), before = await local.snapshot(); expect(await run(local, [value])).toBeNull();
    expect(await restore(local, [value])).toBeNull(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("retimestamps historical children and preserves native updated versus deleted event classification", async () => {
    const historicalId = taxRateDeleteRuleIds[0]; if (historicalId === undefined) throw new Error("Missing historical Rule");
    const local = await scenario("child-history", history(taxRateDeletionRows(), [historicalId])), before = await local.snapshot();
    await run(local, [taxRateDeleteIds[0]]); const changed = (await local.read([historicalId]))[0];
    expect(changed?.deleted_at).not.toBe(taxRateDeleteStamp); expect(changed?.updated_at).toBe(changed?.deleted_at);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([["tax.tax-rate.deleted", taxRateDeleteIds[0]],
      ...sortedRuleRows().filter(value => value.row.tax_rate_id === taxRateDeleteIds[0]).map(value =>
        [value.row.id === historicalId ? "tax.tax-rate-rule.updated" : "tax.tax-rate-rule.deleted", id(value.row)])]);
    await restore(local, [taxRateDeleteIds[0]]); expect((await local.read([historicalId]))[0]?.deleted_at).toBeNull();
  }, 240_000);

  it("restores a predeleted requested graph even when its genuine forward step was a no-op", async () => {
    const local = await scenario("all-history", history(taxRateDeletionRows(), allSelected)), before = await local.snapshot();
    const ids = await retained(local, [...taxRateDeleteIds].reverse()); noTaxMutation(before, await local.snapshot());
    await restore(local, ids); expect((await local.read(allSelected)).every(row => row.deleted_at === null)).toBe(true);
    expect(eventsSince(before, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("forward excludes Rates under deleted Regions while retained restore includes historical Regions", async () => {
    const selected = taxRateDeleteIds[0], children = taxRateDeleteRuleIds.slice(0, 2),
      rows = history(taxRateDeletionRows(), [taxRateDeleteRegions[0], ...children]),
      local = await scenario("region-history", rows), original = await local.read(), before = await local.snapshot();
    const activeRate = original.filter(row => row.id === selected), historicalChildren = original.filter(row => children.includes(id(row)));
    expect(activeRate).toHaveLength(1); expect(activeRate[0]?.deleted_at).toBeNull();
    expect(historicalChildren).toHaveLength(2); expect(historicalChildren.every(row => row.deleted_at === taxRateDeleteStamp)).toBe(true);
    const ids = await retained(local, [selected]); noTaxMutation(before, await local.snapshot());
    expect(await local.read([selected])).toEqual(activeRate); expect(await local.read(children)).toEqual(historicalChildren);
    const committed = await local.snapshot(); await restore(local, ids);
    expect(await local.read([selected])).toEqual(activeRate);
    const restoredChildren = await local.read(children);
    for (const child of historicalChildren) { const restored = restoredChildren.find(row => row.id === child.id);
      expect(restored).toEqual({ ...child, deleted_at: null, updated_at: restored?.updated_at }); }
    expect(await local.read(taxRateDeleteRegions)).toEqual(original.filter(row => taxRateDeleteRegions.some(value => value === row.id)));
    expect((await local.read([taxRateDeleteRegions[0]]))[0]?.deleted_at).toBe(taxRateDeleteStamp);
    expect(eventsSince(committed, await local.snapshot())).toEqual([]);
    expect(eventsSince(before, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("active restore discovers deleted children and repeat cancellation preserves the now-active graph", async () => {
    const first = taxRateDeleteRuleIds[0]; if (first === undefined) throw new Error("Missing historical child");
    const local = await scenario("active-restore", history(taxRateDeletionRows(), [first])), original = await local.read([taxRateDeleteIds[0]]);
    await restore(local, [taxRateDeleteIds[0]]); expect(await local.read([taxRateDeleteIds[0]])).toEqual(original);
    expect((await local.read([first]))[0]?.deleted_at).toBeNull(); const before = await local.snapshot();
    await restore(local, [taxRateDeleteIds[0]]); noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it.each([false, true])("reselects later current Rule membership at inverse time, historical=%s", async historical => {
    const selected = taxRateDeleteIds[0], local = await scenario(`later-${historical}`), ids = await retained(local, [selected]), creation = await local.prepareCreation();
    const created = await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [{ tax_rate_id: selected, reference: "product", reference_id: "later-169" }] }));
    const child = created[0]; if (child === undefined) throw new Error("Missing genuine later Rule");
    if (historical) { await restore(local, ids); await run(local, ids); expect((await local.read([child.id]))[0]?.deleted_at).not.toBeNull(); }
    const before = await local.snapshot(); await restore(local, ids);
    expect((await local.read([child.id]))[0]?.deleted_at).toBeNull(); expect(eventsSince(before, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("does not recreate a physically removed historical child", async () => {
    const selected = taxRateDeleteIds[0], rule = taxRateDeleteRuleIds[0]; if (rule === undefined) throw new Error("Missing physical target");
    const local = await scenario("physical-child"), ids = await retained(local, [selected]), physical = await local.preparePhysicalRules();
    await Effect.runPromise(physical.run(physical.newRequestKey(), [rule])); expect(await local.read([rule])).toEqual([]);
    await restore(local, ids); expect(await local.read([rule])).toEqual([]); expect((await local.read([selected]))[0]?.deleted_at).toBeNull();
  }, 240_000);

  it("does not recreate physically removed Rates or their historical Rule descendants", async () => {
    const selected = taxRateDeleteIds[0], children = taxRateDeletionRows().filter(value => value.table === "tax_rate_rule" && value.row.tax_rate_id === selected).map(value => id(value.row)),
      local = await scenario("physical-root"), ids = await retained(local, [selected]), physical = await local.preparePhysicalRates();
    await Effect.runPromise(physical.run(physical.newRequestKey(), [selected]));
    expect(await local.read([selected, ...children])).toEqual([]); const before = await local.snapshot();
    await restore(local, ids); noTaxMutation(before, await local.snapshot()); expect(await local.read([selected, ...children])).toEqual([]);
  }, 240_000);

  it("preserves an unrelated Rate and complete Rule graph byte for byte", async () => {
    const unrelated = "txr169-unrelated", child = "txrule169-unrelated", rows = [...taxRateDeletionRows(),
      taxRate(unrelated, { tax_region_id: taxRateDeleteRegions[0], is_default: false }), taxRule(child, unrelated, "product", "unrelated")],
      local = await scenario("unrelated", rows), original = await local.read([unrelated, child, ...taxRateDeleteRegions, "tp_system"]);
    const ids = await retained(local, [...taxRateDeleteIds]); expect(await local.read(original.map(id))).toEqual(original);
    await restore(local, ids); expect(await local.read(original.map(id))).toEqual(original);
  }, 240_000);

  it("refuses ninth descendants before publishing any Rate or Rule changes", async () => {
    const local = await scenario("over-children", [...taxRateDeletionRows(), taxRule("txrule169-ninth", taxRateDeleteIds[0], "product", "ninth")]),
      before = await local.snapshot(), host = await local.prepare();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [...taxRateDeleteIds] })))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back the complete inverse graph on a later Rule-key collision", async () => {
    const local = await scenario("rule-conflict"), selected = taxRateDeleteIds[0], ids = await retained(local, [selected]), first = taxRateDeletionRows()
      .find(value => value.table === "tax_rate_rule" && value.row.tax_rate_id === selected);
    if (first === undefined) throw new Error("Missing Rule-key preimage");
    const creation = await local.prepareCreation(); await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [{ tax_rate_id: selected,
      reference: "different-reference", reference_id: decodeString(first.row.reference_id) }] }));
    const before = await local.snapshot(), inverse = await local.prepareInverse();
    expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ids)))).toBe(true); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back all restored Rates and Rules on a default Rate collision in the last selected Region", async () => {
    const rows = taxRateDeletionRows().map(value => value.table === "tax_rate" && value.row.id === "txr169-d"
      ? { ...value, row: { ...value.row, is_default: true } } : value), local = await scenario("default-conflict", rows),
      ids = await retained(local, [...taxRateDeleteIds]), creation = await local.prepareRateCreation();
    await Effect.runPromise(creation.run(creation.newRequestKey(), [{ tax_region_id: taxRateDeleteRegions[1], name: "Replacement", code: "REPLACEMENT169", is_default: true }]));
    const before = await local.snapshot(), inverse = await local.prepareInverse();
    expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ids)))).toBe(true); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("denies creation, physical deletion, Region, Provider and calculation methods on the selected Tax capability", async () => {
    const local = await scenario("ungranted"), before = await local.snapshot();
    // Deliberately invalid runtime selections exercise the actual boundary;
    // the authoring API correctly excludes these names from this module.
    for (const method of ["createTaxRates", "deleteTaxRates", "createTaxRateRules", "deleteTaxRateRules", "softDeleteTaxRateRules", "getTaxLines", "listTaxRegions", "createTaxRegions", "updateTaxProviders"])
      expect(Result.isFailure(Reflect.apply(prepareWorkflowResources, undefined,
        [{ tax: { module: local.tax.workflow, methods: [method], graph: false } }, true]))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("keeps native lifecycle failure sticky and preserves late parent defect with zero durable publication", async () => {
    const local = await scenario("late"), host = await local.prepareLateFailure(), before = await local.snapshot(),
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates");
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [...taxRateDeleteIds] }));
    if (Exit.isSuccess(failed)) throw new Error("Expected late native parent failure");
    expect(failed.cause.reasons.some(reason => reason._tag === "Die" && reason.defect === local.lateFailure)).toBe(true);
    for (const reason of failed.cause.reasons) if (reason._tag === "Fail") {
      if (!(reason.error instanceof CommerceTransactionError)) throw new Error("Unexpected typed failure");
      expect(reason.error.reason).toBe("rollbackOnly"); if (reason.error.cause !== undefined) expect(Cause.isCause(reason.error.cause)).toBe(true);
    }
    expect(remove).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("replays identical trusted requests without a second native call and refuses changed replay", async () => {
    const local = await scenario("replay"), host = await local.prepare(), key = host.newRequestKey(), ids = [taxRateDeleteIds[0]],
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates");
    expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); const before = await local.snapshot();
    expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, { ids: [taxRateDeleteIds[1]] })))).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("refuses corrupted native affected maps after real writes and rolls back the entire graph", async () => {
    const local = await scenario("corrupt-map"), host = await local.prepare(), before = await local.snapshot(), original = TaxModuleService.prototype.softDeleteTaxRates;
    vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates").mockImplementation(async function (this: TaxModuleService, ...args) {
      await Reflect.apply(original, this, args); return { tax_rate_id: ["foreign"] };
    });
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [taxRateDeleteIds[0]] })))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("binds same-profile native deletion and retained restore to the executing scope with equal stored IDs", async () => {
    const local = await scenario("scope-local"), foreign = await scenario("scope-foreign"), original = await local.read(),
      foreignRows = await foreign.read(), foreignScope = projectScopeIdUuidV1(foreign.fixture.application.authority.scopeId).scopeUuid,
      localScope = projectScopeIdUuidV1(local.fixture.application.authority.scopeId).scopeUuid,
      foreignEvents = (await foreign.snapshot()).events.filter(value => value.scopeUuid === foreignScope), selected = taxRateDeleteIds[0],
      children = taxRateDeletionRows().filter(value => value.table === "tax_rate_rule" && value.row.tax_rate_id === selected).map(value => id(value.row));
    expect(localScope).not.toBe(foreignScope); expect(original.map(id)).toEqual(foreignRows.map(id));
    expect(await Effect.runPromise(prepareTaxRateDeletionWorkflow({ ...local.options, modules: foreign.options.modules }).pipe(
      Effect.flatMap(host => host.run(host.newRequestKey(), { ids: [selected] }).pipe(Effect.ensuring(host.close))),
    ))).toBeNull();
    expect((await local.read([selected, ...children])).every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(await foreign.read()).toEqual(foreignRows);
    expect((await foreign.snapshot()).events.filter(value => value.scopeUuid === foreignScope)).toEqual(foreignEvents);
    await restore(local, [selected]); const restored = await local.read();
    for (const row of original) { const actual = restored.find(value => value.id === row.id);
      expect(actual).toEqual([selected, ...children].includes(id(row)) ? { ...row, updated_at: actual?.updated_at } : row); }
    expect(await foreign.read()).toEqual(foreignRows);
    expect((await foreign.snapshot()).events.filter(value => value.scopeUuid === foreignScope)).toEqual(foreignEvents);
  }, 240_000);

  it("drains interrupted native deletion before rollback and revokes its captured method without losing the interruption Cause", async () => {
    const local = await scenario("interrupt"), host = await local.prepareCaptured(), before = await local.snapshot(),
      original = TaxModuleService.prototype.softDeleteTaxRates;
    let entered: () => void = () => {}, release: () => void = () => {}, nativeFinished = false, pendingSettled = false;
    const started = new Promise<void>(resolve => { entered = resolve; }), finish = new Promise<void>(resolve => { release = resolve; });
    const remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates").mockImplementation(async function (this: TaxModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); entered(); await finish; nativeFinished = true; return output;
    });
    const controller = new AbortController(), pending = Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [taxRateDeleteIds[0]] }),
      { signal: controller.signal }).finally(() => { pendingSettled = true; });
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Deletion settled before the native cancellation barrier"); })]);
      controller.abort(); await new Promise<void>(resolve => { setTimeout(resolve, 100); });
      expect(pendingSettled).toBe(false); expect(nativeFinished).toBe(false);
      release(); const outcome = await pending;
      if (Exit.isSuccess(outcome)) throw new Error("Expected interrupted native deletion");
      expect(Cause.hasInterrupts(outcome.cause)).toBe(true); expect(pendingSettled).toBe(true); expect(nativeFinished).toBe(true);
      expect(remove).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
      await expect(local.callEscaped()).rejects.toBeDefined(); expect(await local.snapshot()).toEqual(before);
    } finally { release(); try { await pending; } finally { remove.mockRestore(); } }
  }, 240_000);

  it("changes genuine cold Tax calculation through deletion and restores it on retained cancellation", async () => {
    const selected = "txr169-cold", local = await scenario("cold", taxSeed([taxRate(selected, { tax_region_id: taxRateDeleteRegions[0],
      is_default: false, rate: 7, name: "Cold Rate", code: "RATE169_COLD" })], [taxRegion(taxRateDeleteRegions[0])],
    [taxRule("txrule169-cold", selected, "product", "prod163-one")])), calculation = await local.prepareCalculation(), input = taxInput({ shipping_methods: [] });
    const expected = { lineItemTaxLines: [{ rate_id: selected, rate: 7, name: "Cold Rate", code: "RATE169_COLD", line_item_id: "li163-one", provider_id: "system" }], shippingMethodsTaxLines: [] };
    expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual(expected); await run(local, [selected]);
    expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual({ lineItemTaxLines: [], shippingMethodsTaxLines: [] });
    await restore(local, [selected]); expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual(expected);
  }, 240_000);
});

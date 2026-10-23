import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareWorkflowResources } from "../src/workflow/resources";
import type { WorkflowModule } from "../src/workflow/module";
import { prepareTaxRuleReplacementWorkflow } from "../src/workflows/tax/replace-rules";
import { taxRuleReplacementResources } from "../src/workflow/policy";
import { taxInput, taxRate, taxRegion, taxRule, taxSeed, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRuleReplacement, maximumTaxRuleReplacementInput, taxRuleReplacementRows, taxReplacementParents,
  taxReplacementOldIds, taxReplacementRegion, taxReplacementStamp, type TaxReplacementInput } from "./support/logical-tax-rule-replacement-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRuleReplacement>>, sharedCleanupCount = 0, ordinal = 0;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
const id = (row: JsonObject) => Schema.decodeUnknownSync(Schema.String)(row.id);
const eventsSince = (before: Inventory, after: Inventory) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Inventory["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing complete native Tax event");
  const ids = Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  return ids.map(value => [event.envelope.contract, value]);
});
function noTaxMutation(before: Inventory, after: Inventory) {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
}
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRuleReplacementRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRuleReplacement(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-rule-replacement-${name}-${number}`, projectId: "tax-rule-replacement-167", uuidOffset: 7_000_000 + number * 10_000 } });
}
const run = async (local: Local, input: TaxReplacementInput) => { const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input)); };
const oldCohort = [...taxReplacementOldIds].sort();

describe(`genuine native Tax Rule replacement - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalTaxRuleReplacement(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it.each([{ tax_rate_ids: [], rules: [] }, { tax_rate_ids: [], rules: [{ reference: "product", reference_id: "ignored" }] },
    { tax_rate_ids: [""], rules: [] }])("runs genuine empty list and creation dependencies: %j", async input => {
    const local = await scenario("empty"), before = await local.snapshot(), list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"),
      create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"),
      physical = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules"), restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules");
    expect(await run(local, input)).toEqual([]);
    // Medusa's internal service applyDefaultOrdering mutates this same config;
    // the spy therefore observes its genuine default primary-key ordering.
    expect(list).toHaveBeenCalledTimes(1); expect(list.mock.calls[0]?.slice(0, 2)).toEqual([
      { tax_rate_id: input.tax_rate_ids }, { select: ["id"], order: { id: "ASC" } },
    ]);
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]); expect(remove).not.toHaveBeenCalled();
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: [], old: [] }));
    expect(physical).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("replaces four Rates by two templates and measures the complete root under unchanged limits", async () => {
    const local = await scenario("maximum"), beforeRows = await local.read(), before = await local.snapshot(), host = await local.prepare(),
      input = maximumTaxRuleReplacementInput(), original = structuredClone(input), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules");
    let calls = 0;
    const output = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(input).toEqual(original); expect(remove.mock.calls[0]?.[0]).toEqual(oldCohort);
    expect(output.map(row => [row.reference_id, row.tax_rate_id, row.created_by])).toEqual(input.rules.flatMap(rule =>
      input.tax_rate_ids.map(parent => [rule.reference_id, parent, rule.created_by])));
    expect(output).toHaveLength(8); expect(new Set(output.map(row => row.id)).size).toBe(8);
    const afterRows = await local.read(), after = await local.snapshot();
    for (const row of beforeRows) {
      const actual = afterRows.find(value => value.id === row.id);
      if (taxReplacementOldIds.includes(id(row))) {
        expect(typeof actual?.deleted_at).toBe("string"); expect(actual?.updated_at).toBe(actual?.deleted_at);
        expect(actual).toEqual({ ...row, deleted_at: actual?.deleted_at, updated_at: actual?.updated_at });
      } else expect(actual).toEqual(row);
    }
    expect(eventVector(eventsSince(before, after))).toEqual([...taxReplacementOldIds.map(value => ["tax.tax-rate-rule.deleted", value]),
      ...output.map(row => ["tax.tax-rate-rule.created", row.id])]);
    expect(taxRuleReplacementResources).toEqual(defaultCommerceResources);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(eventsSince(before, after).length).toBeLessThanOrEqual(64);
    console.info("Tax Rule replacement maximum root calls/events", calls, eventsSince(before, after).length);
  }, 240_000);

  it("physically removes the new maximum before restoring exactly eight listed old Rules", async () => {
    const local = await scenario("inverse"), originals = await local.read(taxReplacementOldIds), output = await run(local, maximumTaxRuleReplacementInput()),
      before = await local.snapshot(), remove = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules"),
      restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules"), inverse = await local.prepareInverse();
    let calls = 0;
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: output.map(row => row.id), old: oldCohort })
      .pipe(Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; } })))).toBeNull();
    expect(remove.mock.calls[0]?.[0]).toEqual(output.map(row => row.id)); expect(restore.mock.calls[0]?.[0]).toEqual(oldCohort);
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
    expect(await local.read(output.map(row => row.id))).toEqual([]);
    for (const row of originals) { const actual = (await local.read([id(row)]))[0]; expect(actual).toEqual({ ...row, updated_at: actual?.updated_at }); }
    const after = await local.snapshot(); expect(eventVector(eventsSince(before, after))).toEqual(output.map(row => ["tax.tax-rate-rule.deleted", row.id]));
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(eventsSince(before, after).length).toBeLessThanOrEqual(64);
    console.info("Tax Rule replacement maximum inverse calls/events", calls, eventsSince(before, after).length);
  }, 240_000);

  it("preserves the native supplied-ID alias across Rate positions and physically removes its canonical row once", async () => {
    const local = await scenario("aliases"), before = await local.snapshot(), output = await run(local, { tax_rate_ids: taxReplacementParents.slice(0, 2),
      rules: [{ id: "txrule167-shared", reference: "product", reference_id: "shared", created_by: "template-first" }] });
    expect(output).toHaveLength(2); expect(output[0]).toEqual(output[1]); expect(output[0]?.tax_rate_id).toBe(taxReplacementParents[0]);
    expect(await local.read(["txrule167-shared"])).toHaveLength(1);
    expect(eventVector(eventsSince(before, await local.snapshot())).filter(([name]) => name === "tax.tax-rate-rule.created"))
      .toEqual([["tax.tax-rate-rule.created", "txrule167-shared"]]);
    const inverse = await local.prepareInverse(), committed = await local.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: output.map(row => row.id), old: taxReplacementOldIds.slice(0, 4).sort() }));
    expect(await local.read(["txrule167-shared"])).toEqual([]);
    expect(eventVector(eventsSince(committed, await local.snapshot()))).toEqual([["tax.tax-rate-rule.deleted", "txrule167-shared"]]);
  }, 240_000);

  it.each([
    ["duplicate raw Rate", { tax_rate_ids: ["txr167-0", "txr167-0"], rules: [{ reference: "product", reference_id: "same" }] }, 1],
    ["duplicate active reference", { tax_rate_ids: ["txr167-0"], rules: [{ reference: "product", reference_id: "same" }, { reference: "product_type", reference_id: "same" }] }, 1],
    ["missing parent", { tax_rate_ids: ["missing167"], rules: [{ reference: "product", reference_id: "same" }] }, 0],
    ["existing physical Rule identity", { tax_rate_ids: ["txr167-0"], rules: [{ id: "txrule167-old-8", reference: "product", reference_id: "same" }] }, 1],
  ])("preserves genuine constraint failure and whole-root rollback: %s", async (_name, input, expectedSoftDeletes) => {
    const local = await scenario("constraint"), before = await local.snapshot(), host = await local.prepare(),
      list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"),
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules");
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), input)))).toBe(true);
    expect(list).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(expectedSoftDeletes);
    expect(list.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0] ?? 0);
    if (expectedSoftDeletes === 1) {
      expect(list.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0] ?? 0);
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0] ?? 0);
    }
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("excludes historical old Rules and preserves later unrelated Rules during retained cancellation", async () => {
    const historical = taxReplacementOldIds[0]; if (historical === undefined) throw new Error("Missing historical target");
    const rows = taxRuleReplacementRows().map(value => value.table === "tax_rate_rule" && value.row.id === historical
      ? { ...value, row: { ...value.row, deleted_at: taxReplacementStamp } } : value);
    const local = await scenario("history", rows), protectedRow = await local.read([historical]), list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"),
      output = await run(local, maximumTaxRuleReplacementInput());
    expect(list).toHaveBeenCalledTimes(1);
    const listed = await list.mock.results[0]?.value;
    const retained = oldCohort.filter(value => value !== historical);
    expect(listed).toEqual(retained.map(value => ({ id: value })));
    const creation = await local.prepareCreation();
    const later = await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [{ tax_rate_id: "txr167-0", reference: "product", reference_id: "later-unrelated" }] }));
    const laterRows = await local.read(later.map(row => row.id)), inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: output.map(row => row.id), old: retained }));
    expect(await local.read([historical])).toEqual(protectedRow); expect(await local.read(later.map(row => row.id))).toEqual(laterRows);
    expect((await local.read(retained)).every(row => row.deleted_at === null)).toBe(true);
  }, 240_000);

  it("preserves missing retained rows and active restores as zero-event native no-ops", async () => {
    const local = await scenario("stale"), before = await local.snapshot(), inverse = await local.prepareInverse(true);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: ["missing-created"], old: ["missing-old", ...oldCohort.slice(0, 2)] }));
    noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it("does not recreate an independently removed old retained Rule during cancellation", async () => {
    const local = await scenario("stale-retained"), output = await run(local, maximumTaxRuleReplacementInput()), stale = oldCohort[0];
    if (stale === undefined) throw new Error("Missing stale retained target");
    const inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: [stale], old: [] }));
    expect(await local.read([stale])).toEqual([]);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: output.map(row => row.id), old: oldCohort }));
    expect(await local.read([stale])).toEqual([]); expect(await local.read(output.map(row => row.id))).toEqual([]);
    expect((await local.read(oldCohort.filter(value => value !== stale))).every(row => row.deleted_at === null)).toBe(true);
  }, 240_000);

  it("atomically refuses a retained restore uniqueness conflict after the native created inverse starts", async () => {
    const local = await scenario("inverse-conflict"), output = await run(local, maximumTaxRuleReplacementInput()), creation = await local.prepareCreation();
    await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [{ tax_rate_id: "txr167-0", reference: "other-reference", reference_id: "old-0" }] }));
    const before = await local.snapshot(), inverse = await local.prepareInverse(), physical = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules"),
      restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules");
    expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), { created: output.map(row => row.id), old: oldCohort })))).toBe(true);
    expect(physical).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
    expect(await local.read(output.map(row => row.id))).toHaveLength(8);
  }, 240_000);

  it("refuses the complete seventeen-old-Rule cohort before any native mutation", async () => {
    const parent = "txr167-diagnostic", rows = taxSeed([taxRate(parent, { tax_region_id: taxReplacementRegion, is_default: false })], [taxRegion(taxReplacementRegion)],
      Array.from({ length: 17 }, (_, index) => taxRule(`txrule167-diagnostic-${String(17 - index).padStart(2, "0")}`, parent, "product", `old-${index}`)));
    const local = await scenario("seventeen", rows), host = await local.prepare(), before = await local.snapshot(),
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"),
      list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules");
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { tax_rate_ids: [parent], rules: [] })))).toBe(true);
    expect(list).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back native deletion, creation and publication after a late parent defect", async () => {
    const local = await scenario("late"), host = await local.prepareLateFailure(), before = await local.snapshot(),
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRuleReplacementInput()));
    if (Exit.isSuccess(failed)) throw new Error("Expected late native Tax replacement failure");
    expect(failed.cause.reasons.some(reason => reason._tag === "Die" && reason.defect === local.lateFailure)).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("waits for an interrupted native Promise before rolling back its completed replacement writes", async () => {
    const local = await scenario("interrupt"), host = await local.prepare(), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRateRules;
    let entered: () => void = () => {}, release: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; }), finish = new Promise<void>(resolve => { release = resolve; });
    const create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules").mockImplementation(async function (this: TaxModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); entered(); await finish; return output;
    });
    const controller = new AbortController(), pending = Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRuleReplacementInput()), { signal: controller.signal });
    try { await Promise.race([started, pending.then(() => { throw new Error("Replacement ended before native cancellation barrier"); })]);
      controller.abort(); release(); expect(Exit.isFailure(await pending)).toBe(true);
      expect(create).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before); }
    finally { release(); create.mockRestore(); }
  }, 240_000);

  it("replays committed trusted output without invoking native replacement twice and refuses changed replay", async () => {
    const local = await scenario("replay"), host = await local.prepare(), key = host.newRequestKey(), input = maximumTaxRuleReplacementInput(),
      list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    const output = await Effect.runPromise(host.run(key, input)), before = await local.snapshot();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, { tax_rate_ids: [], rules: [] })))).toBe(true);
    expect(list).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1); noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it("confines the replacement source and refuses parent CRUD, calculation, graph and caller-selected limits", async () => {
    const local = await scenario("scope"), before = await local.snapshot();
    const module: WorkflowModule = local.tax.workflow;
    for (const method of ["createTaxRates", "deleteTaxRates", "listTaxRates", "createTaxRegions", "getTaxLines"])
      expect(Result.isFailure(prepareWorkflowResources({ tax: { module, methods: [method], graph: false } }, true))).toBe(true);
    expect(Result.isFailure(prepareWorkflowResources({ tax: { module: local.tax.workflow, methods: [], graph: true } }, true))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(prepareTaxRuleReplacementWorkflow({ ...local.options,
      modules: { tax: { ...local.modules.tax, logicalResources: { ...defaultCommerceResources, calls: 128 } } } })))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(prepareTaxRuleReplacementWorkflow({ ...local.options,
      modules: { tax: { ...local.modules.tax, module: { ...local.tax.workflow } } } }).pipe(
      Effect.flatMap(host => host.run(host.newRequestKey(), maximumTaxRuleReplacementInput()).pipe(Effect.ensuring(host.close))),
    )))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("reuses genuine same-profile preparation while execution binds only the local deployment and scope", async () => {
    const rows = taxRuleReplacementRows(), local = await scenario("reuse-local", rows), foreign = await scenario("reuse-foreign", rows),
      marker = "txrule167-foreign-only";
    expect(await foreign.read()).toEqual(await local.read());
    const creation = await foreign.prepareCreation();
    const marked = await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [
      { id: marker, tax_rate_id: "txr167-0", reference: "product", reference_id: "foreign-only" },
    ] }));
    expect(marked.map(row => row.id)).toEqual([marker]);
    const foreignBefore = await foreign.read();
    expect(await foreign.read([...taxReplacementOldIds, marker])).toHaveLength(9);
    expect(await local.read([marker])).toEqual([]);
    const list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules");
    const output = await Effect.runPromise(prepareTaxRuleReplacementWorkflow({ ...local.options, modules: foreign.modules }).pipe(
      Effect.flatMap(host => host.run(host.newRequestKey(), maximumTaxRuleReplacementInput()).pipe(Effect.ensuring(host.close))),
    ));
    expect(list).toHaveBeenCalledTimes(1); expect(await list.mock.results[0]?.value).toEqual(oldCohort.map(id => ({ id })));
    expect(remove).toHaveBeenCalledTimes(1); expect(remove.mock.calls[0]?.[0]).toEqual(oldCohort);
    expect(output).toHaveLength(8); expect(new Set(output.map(row => row.id)).size).toBe(8);
    const old = await local.read(taxReplacementOldIds), created = await local.read(output.map(row => row.id));
    expect(old).toHaveLength(8); expect(old.every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(created).toHaveLength(8);
    for (const row of output) expect(created.find(value => value.id === row.id)).toEqual(row);
    expect(await local.read([marker])).toEqual([]); expect(await foreign.read()).toEqual(foreignBefore);
  }, 240_000);

  it("refuses a forged complete immediate native DTO without committing either old or new changes", async () => {
    const local = await scenario("forged-dto"), host = await local.prepare(), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRateRules;
    const descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRateRules");
    if (descriptor === undefined) throw new Error("Missing native Rule creation descriptor");
    let nativeCreates = 0, forged = 0;
    Object.defineProperty(TaxModuleService.prototype, "createTaxRateRules", { ...descriptor, value: async function (this: unknown, ...args: unknown[]) {
      nativeCreates++;
      const returned: unknown = await Reflect.apply(original, this, args);
      const rows = Result.getOrThrow(local.tax.contracts.decodeOutput(returned));
      forged++;
      return rows.map(row => ({ ...row, created_by: "forged" }));
    } });
    try { expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRuleReplacementInput())))).toBe(true);
      expect(nativeCreates).toBe(1); expect(forged).toBe(1); expect(await local.snapshot()).toEqual(before); }
    finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRateRules", descriptor); }
  }, 240_000);

  it("keeps refusal sticky when a callback catches a forged native ID list and tries another admitted service", async () => {
    const local = await scenario("sticky"), host = await local.prepareCaughtFailure(), before = await local.snapshot(), original = TaxModuleService.prototype.listTaxRateRules;
    const descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "listTaxRateRules");
    let calls = 0;
    Object.defineProperty(TaxModuleService.prototype, "listTaxRateRules", { configurable: true, writable: true,
      value: async function (this: unknown, ...args: unknown[]) {
        await Reflect.apply(original, this, args); calls++; return [{ id: "foreign-forged" }];
      } });
    try { expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRuleReplacementInput())))).toBe(true);
      expect(calls).toBe(1); expect(await local.snapshot()).toEqual(before); }
    finally { if (descriptor === undefined) Reflect.deleteProperty(TaxModuleService.prototype, "listTaxRateRules");
      else Object.defineProperty(TaxModuleService.prototype, "listTaxRateRules", descriptor); }
  }, 240_000);

  it("refuses a forged creation event emitted after real native SQL and preserves atomic publication", async () => {
    const local = await scenario("forged-event"), host = await local.prepare(), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRateRules;
    const descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRateRules");
    if (descriptor === undefined) throw new Error("Missing native Rule creation descriptor");
    let forged = 0;
    Object.defineProperty(TaxModuleService.prototype, "createTaxRateRules", { ...descriptor,
      value: async function (this: object, ...args: unknown[]) {
        const output: unknown = await Reflect.apply(original, this, args);
        const bus: unknown = Reflect.get(this, "eventBusModuleService_");
        if (bus === null || typeof bus !== "object") throw new Error("Missing genuine native module Event Bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing genuine native emit");
        forged++;
        await Reflect.apply(emit, bus, [[{ name: "tax.tax-rate-rule.created", metadata: { source: "tax", object: "tax_rate_rule", action: "created" },
          data: { id: "foreign-forged-event" } }], { internal: true }]);
        return output;
      } });
    try { expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRuleReplacementInput())))).toBe(true);
      expect(forged).toBe(1); expect(await local.snapshot()).toEqual(before); }
    finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRateRules", descriptor); }
  }, 240_000);

  it("changes cold genuine native item Tax calculation only until the retained replacement inverse", async () => {
    const parent = "txr167-cold", old = "txrule167-cold", local = await scenario("cold", taxSeed([
      taxRate(parent, { tax_region_id: taxReplacementRegion, is_default: false, rate: 7, name: "Cold Rule", code: "RULE167_COLD" }),
    ], [taxRegion(taxReplacementRegion)], [taxRule(old, parent, "product", "prod163-one")]));
    const input = taxInput({ shipping_methods: [] }), expected = { lineItemTaxLines: [{ rate_id: parent, rate: 7, name: "Cold Rule", code: "RULE167_COLD",
      line_item_id: "li163-one", provider_id: "system" }], shippingMethodsTaxLines: [] };
    let calculation = await local.prepareCalculation(); expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual(expected);
    const output = await run(local, { tax_rate_ids: [parent], rules: [{ reference: "product", reference_id: "unmatched" }] });
    calculation = await local.prepareCalculation();
    expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual({ lineItemTaxLines: [], shippingMethodsTaxLines: [] });
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), { created: output.map(row => row.id), old: [old] }));
    calculation = await local.prepareCalculation(); expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual(expected);
  }, 240_000);
});

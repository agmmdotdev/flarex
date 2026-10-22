import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareWorkflowResources } from "../src/workflow/resources";
import type { WorkflowModule } from "../src/workflow/module";
import { taxInput, taxRate, taxRegion, taxRule, taxSeed, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRuleDeletion, taxRuleDeleteRegion, taxRuleDeleteParents, taxRuleDeleteIds,
  taxRuleDeleteStamp, taxRuleDeletionRows, type TaxRuleDeletionInput } from "./support/logical-tax-rule-delete-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRuleDeletion>>, sharedCleanupCount = 0, ordinal = 0;
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
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRuleDeletionRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRuleDeletion(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-rule-delete-${name}-${number}`, projectId: "tax-rule-delete-166", uuidOffset: 4_000_000 + number * 10_000 } });
}
const run = async (local: Local, ids: TaxRuleDeletionInput) => {
  const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), { ids }));
};
const historical = (selected: readonly string[]) => taxRuleDeletionRows().map(value => value.table === "tax_rate_rule" && selected.includes(id(value.row))
  ? { ...value, row: { ...value.row, deleted_at: taxRuleDeleteStamp } } : value);

describe(`genuine native standalone Tax Rule deletion - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalTaxRuleDeletion(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves native void root and skips native resolution on empty forward and inverse", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"),
      restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules");
    expect(await run(local, [])).toBeNull();
    const inverse = await local.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
    expect(remove).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("soft deletes the maximum in candidate insertion order and preserves complete content and parents", async () => {
    const local = await scenario("maximum"), originalRows = await local.read(), before = await local.snapshot(), host = await local.prepare(),
      requested = [taxRuleDeleteIds[5], taxRuleDeleteIds[0], taxRuleDeleteIds[3], taxRuleDeleteIds[4], taxRuleDeleteIds[1], taxRuleDeleteIds[2], taxRuleDeleteIds[7], taxRuleDeleteIds[6]];
    const ids = Schema.decodeUnknownSync(Schema.Array(Schema.String).pipe(Schema.mutable))(requested), original = [...ids]; let calls = 0;
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })))).toBeNull(); expect(ids).toEqual(original);
    const afterRows = await local.read(), after = await local.snapshot();
    for (const row of originalRows) {
      const changed = afterRows.find(value => value.id === row.id); if (changed === undefined) throw new Error("Missing retained native row");
      if (taxRuleDeleteIds.includes(id(row))) {
        expect(typeof changed.deleted_at).toBe("string"); expect(changed.updated_at).toBe(changed.deleted_at);
        expect(changed).toEqual({ ...row, deleted_at: changed.deleted_at, updated_at: changed.updated_at });
      } else expect(changed).toEqual(row);
    }
    expect(eventVector(eventsSince(before, after))).toEqual(taxRuleDeleteIds.map(value => ["tax.tax-rate-rule.deleted", value]));
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Tax Rule deletion maximum root calls", calls);
  }, 240_000);

  it("retains original duplicate and missing IDs rather than affected IDs and restores once with zero events", async () => {
    const local = await scenario("retained"), first = taxRuleDeleteIds[0]; if (first === undefined) throw new Error("Missing target");
    const ids = ["missing", first, first, ""], remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"),
      restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules"), forward = await local.prepareForward();
    expect(await Effect.runPromise(forward.run(forward.newRequestKey(), ids))).toEqual(ids);
    expect(remove.mock.calls[0]?.[0]).toEqual(ids); const before = await local.snapshot(), inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), ids))).toBeNull();
    expect(restore.mock.calls[0]?.[0]).toEqual(ids); expect(eventsSince(before, await local.snapshot())).toEqual([]);
    const restored = (await local.read([first]))[0]; expect(restored?.deleted_at).toBeNull();
  }, 240_000);

  it("authenticates native affected map in storage order for reversed requested IDs", async () => {
    const local = await scenario("raw-map"), raw = await local.prepareRaw(false), selected = taxRuleDeleteIds.slice(0, 3);
    expect(await Effect.runPromise(raw.run(raw.newRequestKey(), [...selected].reverse()))).toEqual({ tax_rate_rule_id: selected });
  }, 180_000);

  it("keeps missing IDs and already deleted rows unchanged during forward", async () => {
    const first = taxRuleDeleteIds[0]; if (first === undefined) throw new Error("Missing target");
    const local = await scenario("history-forward", historical([first])), before = await local.snapshot(), raw = await local.prepareRaw(false);
    expect(await Effect.runPromise(raw.run(raw.newRequestKey(), [first, "missing", ""]))).toEqual({}); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("preserves maximum wholly historical forward rows and restores every original requested Rule", async () => {
    const local = await scenario("all-history", historical(taxRuleDeleteIds)), before = await local.snapshot(), forward = await local.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [...taxRuleDeleteIds].reverse()));
    noTaxMutation(before, await local.snapshot()); expect(retained).toEqual([...taxRuleDeleteIds].reverse());
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained));
    expect((await local.read(taxRuleDeleteIds)).every(row => row.deleted_at === null)).toBe(true);
    expect(eventsSince(before, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("retains arbitrary native JSON metadata through deletion and restoration", async () => {
    const parent = taxRuleDeleteParents[0]; if (parent === undefined) throw new Error("Missing fixture parent");
    const values = [null, [null, "x"], "scalar", false, 7], selected = values.map((_value, index) => `txrule166-json-${index}`);
    const rows = taxSeed([taxRate(parent, { tax_region_id: taxRuleDeleteRegion })], [taxRegion(taxRuleDeleteRegion)], values.map((metadata, index) =>
      taxRule(selected[index] ?? "missing", parent, "product", `json-${index}`, { metadata })));
    const local = await scenario("json", rows), original = await local.read(selected); await run(local, selected);
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), selected));
    const restored = await local.read(selected);
    for (const row of original) { const actual = restored.find(value => value.id === row.id); expect(actual).toEqual({ ...row, updated_at: actual?.updated_at }); }
  }, 240_000);

  it("refuses creation, physical deletion and parent methods outside the deletion profile", async () => {
    const local = await scenario("ungranted"), before = await local.snapshot();
    const module: WorkflowModule = local.tax.workflow;
    for (const method of ["createTaxRateRules", "deleteTaxRateRules", "createTaxRates", "softDeleteTaxRates", "getTaxLines"])
      expect(Result.isFailure(prepareWorkflowResources({ tax: { module, methods: [method], graph: false } }, true))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("preserves native history trap by restoring originally requested predeleted Rules", async () => {
    const first = taxRuleDeleteIds[0]; if (first === undefined) throw new Error("Missing target");
    const local = await scenario("history-trap", historical([first])), original = (await local.read([first]))[0], forward = await local.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [first])); expect(retained).toEqual([first]);
    expect(await local.read([first])).toEqual([original]); const before = await local.snapshot(), inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained)); const restored = (await local.read([first]))[0];
    expect(restored?.deleted_at).toBeNull(); expect(restored?.updated_at).not.toBe(taxRuleDeleteStamp);
    expect(restored).toEqual({ ...original, deleted_at: null, updated_at: restored?.updated_at }); expect(eventsSince(before, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("restores maximum mixed history and active cohort with no native restored events", async () => {
    const local = await scenario("mixed", historical(taxRuleDeleteIds.filter((_value, index) => index % 2 === 0))),
      protectedRows = (await local.read()).filter(row => !taxRuleDeleteIds.includes(id(row))), forward = await local.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [...taxRuleDeleteIds].reverse()));
    const committed = await local.snapshot(), inverse = await local.prepareInverse(); let calls = 0;
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })))).toBeNull();
    expect((await local.read(taxRuleDeleteIds)).every(row => row.deleted_at === null)).toBe(true);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows); expect(eventsSince(committed, await local.snapshot())).toEqual([]);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Tax Rule restore maximum root calls", calls);
  }, 240_000);

  it("returns active restored IDs without changing active timestamps or content", async () => {
    const local = await scenario("active-restore"), before = await local.snapshot(), raw = await local.prepareRaw(true), selected = taxRuleDeleteIds.slice(0, 2);
    expect(await Effect.runPromise(raw.run(raw.newRequestKey(), [...selected].reverse()))).toEqual({ tax_rate_rule_id: selected });
    noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("repeat cancellation preserves restored content and emits no restored events", async () => {
    const local = await scenario("repeat"), forward = await local.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), taxRuleDeleteIds.slice(0, 2))),
      inverse = await local.prepareInverse(true); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained));
    const restored = await local.snapshot(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained)); noTaxMutation(restored, await local.snapshot());
  }, 240_000);

  it("preserves unrelated Rules and allows Rules whose parent Rate is deleted", async () => {
    const parent = taxRuleDeleteParents[0], first = taxRuleDeleteIds[0]; if (parent === undefined || first === undefined) throw new Error("Missing fixture targets");
    const rows = [...taxRuleDeletionRows().map(value => value.table === "tax_rate" && value.row.id === parent ? { ...value, row: { ...value.row, deleted_at: taxRuleDeleteStamp } } : value),
      taxRule("txrule166-unrelated", parent, "product", "unrelated")];
    const local = await scenario("parent-history", rows), protectedRows = (await local.read()).filter(row => row.id !== first);
    await run(local, [first]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), [first]));
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 240_000);

  it("rolls back the complete restore cohort on uniqueness conflict and preserves the independent replacement", async () => {
    const local = await scenario("restore-conflict"), selected = taxRuleDeleteIds.slice(0, 2), originals = await local.read(selected), forward = await local.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), selected)), original = originals[1];
    if (original === undefined) throw new Error("Missing conflicting Rule preimage");
    const creation = await local.prepareCreation();
    await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [{ tax_rate_id: Schema.decodeUnknownSync(Schema.String)(original.tax_rate_id),
      reference: "other-reference", reference_id: Schema.decodeUnknownSync(Schema.String)(original.reference_id) }] }));
    const before = await local.snapshot(), inverse = await local.prepareInverse();
    expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), retained)))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back native deletion and publication while retaining the complete late defect Cause", async () => {
    const local = await scenario("late"), host = await local.prepareLateFailure(), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: [...taxRuleDeleteIds] }));
    if (Exit.isSuccess(failed)) throw new Error("Expected genuine late parent defect");
    expect(failed.cause.reasons.map(reason => reason._tag)).toEqual(["Die", "Fail", "Fail"]);
    const nested: Cause.Cause<unknown>[] = [];
    for (const reason of failed.cause.reasons) {
      if (reason._tag === "Die") expect(reason.defect).toBe(local.lateFailure);
      else if (reason._tag === "Fail") {
        if (!(reason.error instanceof CommerceTransactionError)) throw new Error("Unexpected late-parent typed failure");
        expect(reason.error.reason).toBe("rollbackOnly");
        if (reason.error.cause !== undefined) { if (!Cause.isCause(reason.error.cause)) throw new Error("Missing complete rollback-only Cause"); nested.push(reason.error.cause); }
      } else throw new Error("Unexpected late-parent interruption");
    }
    expect(nested).toHaveLength(1);
    for (const cause of nested) { expect(cause.reasons.map(reason => reason._tag)).toEqual(["Die"]);
      for (const reason of cause.reasons) if (reason._tag === "Die") expect(reason.defect).toBe(local.lateFailure); }
    expect(remove).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("replays a committed trusted request without native deletion again and refuses changed replay", async () => {
    const local = await scenario("replay"), host = await local.prepare(), key = host.newRequestKey(), ids = taxRuleDeleteIds.slice(0, 1),
      remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules");
    expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); const before = await local.snapshot();
    expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, { ids: taxRuleDeleteIds.slice(1, 2) })))).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("refuses a corrupted native affected map without committing actual lifecycle writes", async () => {
    const local = await scenario("corrupt-map"), host = await local.prepare(), before = await local.snapshot(),
      original = TaxModuleService.prototype.softDeleteTaxRateRules;
    const remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules").mockImplementation(async function (this: TaxModuleService, ...args) {
      await Reflect.apply(original, this, args); return { tax_rate_rule_id: ["foreign"] };
    });
    try { expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: taxRuleDeleteIds.slice(0, 1) })))).toBe(true);
      expect(remove).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before); }
    finally { remove.mockRestore(); }
  }, 180_000);

  it("changes cold native item Tax calculation only while its matching Rule is deleted", async () => {
    const parent = "txr166-cold", rule = "txrule166-cold", local = await scenario("cold", taxSeed([
      taxRate(parent, { tax_region_id: taxRuleDeleteRegion, is_default: false, rate: 7, name: "Cold Rule", code: "RULE166_COLD" }),
    ], [taxRegion(taxRuleDeleteRegion)], [taxRule(rule, parent, "product", "prod163-one")]));
    const expected = { lineItemTaxLines: [{ rate_id: parent, rate: 7, name: "Cold Rule", code: "RULE166_COLD", line_item_id: "li163-one", provider_id: "system" }], shippingMethodsTaxLines: [] };
    const calculation = await local.prepareCalculation(), input = taxInput({ shipping_methods: [] });
    expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual(expected);
    await run(local, [rule]); expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual({ lineItemTaxLines: [], shippingMethodsTaxLines: [] });
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), [rule]));
    expect(await Effect.runPromise(calculation.run(calculation.newRequestKey(), input))).toEqual(expected);
  }, 240_000);
});

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { TaxModuleService } from "@medusajs/tax/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareTaxRateUpdateWorkflow } from "../src/workflows/tax/update-rates";
import { prepareWorkflowResources } from "../src/workflow/resources";
import type { WorkflowModule } from "../src/workflow/module";
import type { InstalledWorkflowModule } from "../src/workflow/host";
import { TaxRulePhysicalDeletionIds } from "../src/modules/tax/rule-create-input";
import { TaxRuleDeletionIds } from "../src/modules/tax/rule-delete-input";
import { taxInput, taxRegion, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRateUpdate, maximumTaxRateUpdateInput, taxRateUpdateRows, taxUpdateRateIds,
  taxUpdateOldIds, taxUpdateRegions, taxUpdateStamp, TaxUpdateRetained, type TaxUpdateInput } from "./support/logical-tax-rate-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRateUpdate>>, ordinal = 0;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
const id = (row: JsonObject) => Schema.decodeUnknownSync(Schema.String)(row.id);
const eventsSince = (before: Inventory, after: Inventory) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Inventory["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing complete native Tax update event");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id])
    .map(value => [event.envelope.contract, value]);
});
const withoutUpdated = (row: JsonObject) => { const { updated_at: _updated, ...rest } = row; return rest; };
function noTaxMutation(before: Inventory, after: Inventory) {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
}
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRateUpdateRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRateUpdate(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-rate-update-${name}-${number}`, projectId: "tax-rate-update-168", uuidOffset: 9_000_000 + number * 10_000 } });
}
const run = async (local: Local, input: TaxUpdateInput) => { const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input)); };
const selected = [...taxUpdateRateIds].sort();
const first = taxUpdateRateIds[3];
const historicalRegionRows = (singleton: boolean) => taxRateUpdateRows()
  .filter(value => !singleton || (value.table === "tax_region" ? value.row.id === taxUpdateRegions[0]
    : value.table === "tax_rate" ? value.row.id === taxUpdateRateIds[0]
    : value.table === "tax_rate_rule" ? value.row.id === taxUpdateOldIds[0] : true))
  .map(value => value.table === "tax_region" && value.row.id === taxUpdateRegions[0]
    ? taxRegion(taxUpdateRegions[0], { deleted_at: taxUpdateStamp }) : value);
function retainedTap(local: Local) {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine finite StepResponse compensation getter");
  let rates: unknown, created: unknown, old: unknown;
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []), output: unknown = this.output;
    if (Array.isArray(output) && output.length > 0 && isJsonObject(output[0])) {
      if (typeof output[0].name === "string" && typeof output[0].code === "string")
        rates = Result.getOrThrow(local.tax.contracts.decodePreimages(value));
      else if (typeof output[0].reference === "string") created = Schema.decodeUnknownSync(TaxRulePhysicalDeletionIds)(value);
    } else if (output === undefined && Array.isArray(value) && value.length > 0)
      old = Schema.decodeUnknownSync(TaxRuleDeletionIds)(value);
    return value;
  });
  return { restore: () => spy.mockRestore(), get: () => Schema.decodeUnknownSync(TaxUpdateRetained)({ rates, created, old }),
    rateOnly: () => Schema.decodeUnknownSync(TaxUpdateRetained)({ rates, created: [], old: [] }) };
}

describe(`genuine native Tax Rate selector update - ${driver}`, { concurrent: false }, () => {
  beforeEach(async () => { connected = await prepareLogicalTaxRateUpdate(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try { await close(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length) throw new AggregateError(failures, "Tax Rate update case cleanup failed");
  }, 120_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try { await close(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length) throw new AggregateError(failures, "Tax Rate update remaining fixture cleanup failed");
  }, 120_000);

  it.each([{ rules: undefined }, { rules: [] }])("preserves omitted and empty Rules dependencies (%j)", async ({ rules }) => {
    const local = await scenario("empty-branches"), before = await local.snapshot(), list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"),
      create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules");
    expect(await run(local, { selector: { id: ["txr168-missing"] }, update: { name: "No match", ...(rules === undefined ? {} : { rules }) } })).toEqual([]);
    expect(list).toHaveBeenCalledTimes(rules === undefined ? 0 : 1);
    if (rules !== undefined) expect(list.mock.calls[0]?.slice(0, 2)).toEqual([{ tax_rate_id: [] }, { select: ["id"], order: { id: "ASC" } }]);
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]); expect(remove).not.toHaveBeenCalled();
    noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it.each([{}, { updated_by: "actor-only168" }])("keeps persistent empty/actor-only Rate updates unwritten: %j", async update => {
    const local = await scenario("noop"), before = await local.snapshot(), prior = (await local.read([taxUpdateRateIds[0]]))[0],
      host = await local.prepareForward(true), upsert = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
    if (prior === undefined) throw new Error("Missing Rate no-op seed");
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: taxUpdateRateIds[0] }, update }));
    expect(result.output[0]).toEqual({ ...prior, tax_region: { id: prior.tax_region_id }, ...update });
    expect(result.output[0]).not.toHaveProperty("rules");
    expect(result.preimages).toEqual("updated_by" in update ? [{ id: taxUpdateRateIds[0] }]
      : [{ id: taxUpdateRateIds[0], tax_region_id: prior.tax_region_id, tax_region: { id: prior.tax_region_id } }]);
    expect(upsert).toHaveBeenCalledTimes(1); expect(upsert.mock.calls[0]?.[0]).toEqual(result.preimages);
    noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it.each([
    { label: "nullable-rate", update: { rate: null }, expected: { rate: null }, noop: false },
    { label: "empty-name", update: { name: "" }, expected: { name: "" }, noop: false },
    { label: "nullable-metadata", update: { metadata: null }, expected: { metadata: null }, noop: false },
    { label: "empty-metadata", update: { metadata: {} }, expected: {}, noop: true },
    { label: "singleton-default", update: { is_default: true }, expected: { is_default: true }, noop: false },
    { label: "code-and-combinable", update: { code: "Updated code168", is_combinable: true }, expected: { code: "Updated code168", is_combinable: true }, noop: false },
    { label: "empty-actor", update: { updated_by: "" }, expected: { updated_by: "" }, noop: true },
  ])("preserves characterized native field grammar and retained inverse: $label", async ({ label, update, expected, noop }) => {
    const local = await scenario("typed-" + label), parent = taxUpdateRateIds[0], beforeRows = await local.read(), before = await local.snapshot(),
      prior = beforeRows.find(row => row.id === parent), tap = retainedTap(local);
    if (prior === undefined) throw new Error("Missing native typed-field Rate fixture");
    try {
      const selector = label === "code-and-combinable" ? { tax_region_id: "txreg168-us", code: "UPDATE168_0" } : { id: parent };
      const output = await run(local, { selector, update }), retained = tap.rateOnly();
      expect(output).toHaveLength(1); expect(output[0]).toMatchObject(expected); expect(output[0]).not.toHaveProperty("rules");
      if (noop) {
        expect(output[0]).toEqual({ ...prior, tax_region: { id: prior.tax_region_id }, ...expected });
        noTaxMutation(before, await local.snapshot());
      }
      const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained));
      expect((await local.read()).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
      if (noop) noTaxMutation(before, await local.snapshot());
    } finally { tap.restore(); }
  }, 240_000);

  it("preserves native non-null code refusal despite the public nullable DTO", async () => {
    const local = await scenario("typed-null-code"), host = await local.prepare(), before = await local.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), {
      selector: { id: taxUpdateRateIds[0] }, update: { code: null },
    })))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it.each([
    { label: "name", update: { name: "Historical parent name" } },
    { label: "actor", update: { updated_by: "historical-parent-actor" } },
    { label: "metadata", update: { metadata: { nested: { historical_parent: true }, added: "historical" } } },
  ])("retains the $label preimage under a deleted Region while full update selects no Rate", async ({ label, update }) => {
    const local = await scenario("historical-region-" + label, historicalRegionRows(true)), parent = taxUpdateRateIds[0],
      prior = (await local.read([parent]))[0], before = await local.snapshot(), forward = await local.prepareForward(),
      list = vi.spyOn(TaxModuleService.prototype, "listTaxRates"), nativeUpdate = vi.spyOn(TaxModuleService.prototype, "updateTaxRates");
    if (prior === undefined) throw new Error("Missing active Rate under deleted Region");
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: parent }, update }));
    expect(result.output).toEqual([]);
    expect(result.preimages).toEqual([label === "name" ? { id: parent, name: prior.name }
      : label === "metadata" ? { id: parent, metadata: prior.metadata } : { id: parent }]);
    expect(list).toHaveBeenCalledTimes(1); expect(nativeUpdate).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0]).toEqual({ id: parent }); expect(nativeUpdate.mock.calls[0]?.slice(0, 2)).toEqual([{ id: parent }, update]);
    const committed = await local.snapshot(); noTaxMutation(before, committed);
    const inverse = await local.prepareInverse(), upsert = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
    const failed = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), { rates: result.preimages, created: [], old: [] }));
    if (Exit.isSuccess(failed)) throw new Error("Expected historical-parent sparse recreation refusal");
    expect(upsert).toHaveBeenCalledTimes(1); expect(upsert.mock.calls[0]?.[0]).toEqual(result.preimages);
    expect(failed.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof CommerceTransactionError &&
      reason.error.reason === "invalidInput" && Schema.isSchemaError(reason.error.cause) && String(reason.error.cause).includes("code"))).toBe(true);
    expect(await local.snapshot()).toEqual(committed);
  }, 240_000);

  it("filters empty-update preimages under a deleted Region and skips the retained Rate inverse", async () => {
    const local = await scenario("historical-region-empty", historicalRegionRows(true)), before = await local.snapshot(),
      forward = await local.prepareForward(), list = vi.spyOn(TaxModuleService.prototype, "listTaxRates"),
      nativeUpdate = vi.spyOn(TaxModuleService.prototype, "updateTaxRates"), upsert = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: taxUpdateRateIds[0] }, update: {} }));
    expect(result).toEqual({ output: [], preimages: [] });
    expect(list).toHaveBeenCalledTimes(1); expect(nativeUpdate).toHaveBeenCalledTimes(1);
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), { rates: result.preimages, created: [], old: [] }))).toBeNull();
    expect(upsert).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it("updates only live-Region Rates and atomically preserves the forward graph when historical-parent inverse fails", async () => {
    const local = await scenario("historical-region-mixed", historicalRegionRows(false)), beforeRows = await local.read(), before = await local.snapshot(),
      live = [taxUpdateRateIds[3], taxUpdateRateIds[1]], old = taxUpdateOldIds.filter(value =>
        beforeRows.some(row => row.id === value && live.some(parent => parent === row.tax_rate_id))), tap = retainedTap(local),
      input = maximumTaxRateUpdateInput(), { updated_by: _actor, ...update } = input.update,
      create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    try {
      const output = await run(local, { ...input, update }), retained = tap.get();
      expect(output.map(row => row.id)).toEqual(live);
      expect(retained.rates).toEqual(selected.map(id => ({ id, name: beforeRows.find(row => row.id === id)?.name })));
      expect(retained.old).toEqual([...old].sort()); expect(retained.created).toHaveLength(4);
      expect(create).toHaveBeenCalledTimes(1);
      const submitted = create.mock.calls[0]?.[0];
      if (!Array.isArray(submitted)) throw new Error("Missing genuine mixed Rule expansion input");
      expect(submitted.map(row => [row.reference_id, row.tax_rate_id, row.created_by])).toEqual([
        ...live.map(parent => ["replacement-product", parent, undefined]), ...live.map(parent => ["replacement-type", parent, undefined]),
      ]);
      for (const parent of live) expect((await local.read([parent]))[0]?.name).toBe(update.name);
      const created = await local.read(retained.created);
      expect(created).toHaveLength(4); expect(created.every(row => live.some(parent => parent === row.tax_rate_id) && row.created_by === null)).toBe(true);
      expect((await local.read(old)).every(row => typeof row.deleted_at === "string")).toBe(true);
      for (const row of beforeRows.filter(row => !live.some(parent => parent === row.id) && !old.includes(id(row))))
        expect((await local.read([id(row)]))[0]).toEqual(row);
      const committed = await local.snapshot();
      expect(eventVector(eventsSince(before, committed))).toEqual([
        ...live.map(value => ["tax.tax-rate.updated", value]), ...old.map(value => ["tax.tax-rate-rule.deleted", value]),
        ...retained.created.map(value => ["tax.tax-rate-rule.created", value]),
      ]);
      const inverse = await local.prepareInverse(), physical = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules"),
        restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules"), upsert = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
      const failed = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), retained));
      if (Exit.isSuccess(failed)) throw new Error("Expected mixed historical-parent sparse recreation refusal");
      expect(physical).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1); expect(upsert).toHaveBeenCalledTimes(1);
      expect(physical.mock.calls[0]?.[0]).toEqual(retained.created); expect(restore.mock.calls[0]?.[0]).toEqual(retained.old);
      expect(upsert.mock.calls[0]?.[0]).toEqual(retained.rates);
      expect(physical.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
      expect(restore.mock.invocationCallOrder[0]).toBeLessThan(upsert.mock.invocationCallOrder[0] ?? 0);
      expect(failed.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof CommerceTransactionError &&
        reason.error.reason === "invalidInput" && Schema.isSchemaError(reason.error.cause) && String(reason.error.cause).includes("code"))).toBe(true);
      expect(await local.snapshot()).toEqual(committed);
    } finally { tap.restore(); }
  }, 240_000);

  it("updates four Rates and replaces eight Rules in native selection/template order under default limits", async () => {
    const local = await scenario("maximum"), beforeRows = await local.read(), before = await local.snapshot(), input = maximumTaxRateUpdateInput(),
      copied = structuredClone(input), host = await local.prepare(), tap = retainedTap(local), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    let calls = 0;
    try {
      const output = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
      })));
      const compensation = tap.get();
      expect(input).toEqual(copied); expect(output.map(row => row.id)).toEqual(selected);
      expect(output.every(row => !Object.hasOwn(row, "rules"))).toBe(true);
      for (const row of output) expect(row).toMatchObject({ name: input.update.name, updated_by: "actor168", tax_region: { id: row.tax_region_id } });
      expect(compensation.rates).toEqual(selected.map(id => ({ id, name: beforeRows.find(row => row.id === id)?.name })));
      expect(compensation.old).toEqual([...taxUpdateOldIds].sort());
      expect(compensation.created).toHaveLength(8); expect(new Set(compensation.created).size).toBe(8);
      const createdRows = await local.read(compensation.created);
      const orderedCreated = compensation.created.map(value => createdRows.find(row => row.id === value));
      expect(orderedCreated.map(row => [row?.reference_id, row?.tax_rate_id, row?.created_by])).toEqual([
        ...selected.map(parent => ["replacement-product", parent, "actor168"]), ...selected.map(parent => ["replacement-type", parent, "actor168"]),
      ]);
      expect(create).toHaveBeenCalledTimes(1);
      expect((await local.read(taxUpdateOldIds)).every(row => typeof row.deleted_at === "string")).toBe(true);
      const after = await local.snapshot(), vector = eventVector(eventsSince(before, after));
      expect(vector).toEqual([...selected.map(value => ["tax.tax-rate.updated", value]),
        ...taxUpdateOldIds.map(value => ["tax.tax-rate-rule.deleted", value]),
        ...compensation.created.map(value => ["tax.tax-rate-rule.created", value])]);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(eventsSince(before, after).length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
      expect(new Set(eventsSince(before, after).map(event => event.commitSeq)).size).toBe(1);
      for (const row of beforeRows.filter(value => !taxUpdateRateIds.some(parent => parent === id(value)) && !taxUpdateOldIds.includes(id(value))))
        expect((await local.read([id(row)]))[0]).toEqual(row);
      console.info("Tax Rate update maximum root calls/events", calls, eventsSince(before, after).length);
    } finally { tap.restore(); }
  }, 240_000);

  it("refuses synthetic same-request undo beyond the default limit and rolls back the complete small root", async () => {
    const seed = taxRateUpdateRows().filter(value => value.table === "tax_rate" ? value.row.id === first
      : value.table === "tax_rate_rule" ? value.row.tax_rate_id === first && value.row.id === taxUpdateOldIds[3] : true);
    const local = await scenario("complete-roundtrip", seed), originals = await local.read(), before = await local.snapshot(), tap = retainedTap(local),
      physical = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules"), restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules"),
      upsert = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
    let calls = 0, outcome: Exit.Exit<unknown, unknown> | undefined;
    let reasons: readonly string[] = [];
    try {
      const host = await local.prepareFullRoundtrip(tap.get);
      outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), {
        selector: { id: first }, update: { name: "Small retained roundtrip", rules: [{ reference: "product", reference_id: "small-new-rule" }] },
      })
        .pipe(Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; } })));
      if (Exit.isSuccess(outcome)) throw new Error("Expected default-limit refusal from synthetic same-request undo");
      reasons = outcome.cause.reasons.map(reason => {
        if (reason._tag !== "Fail" || !(reason.error instanceof CommerceTransactionError))
          throw new Error("Expected typed default-limit and rollback-only failures", { cause: reason });
        return reason.error.reason;
      });
      expect(reasons).toEqual(["limitExceeded", "rollbackOnly"]);
      const actual = tap.get();
      expect(actual.rates).toEqual([{ id: first, name: originals.find(row => row.id === first)?.name }]);
      expect(actual.created).toHaveLength(1); expect(actual.old).toEqual([taxUpdateOldIds[3]]);
      expect(physical).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1); expect(upsert).toHaveBeenCalledTimes(1);
      expect(physical.mock.calls[0]?.[0]).toEqual(actual.created);
      expect(restore.mock.calls[0]?.[0]).toEqual(actual.old); expect(upsert.mock.calls[0]?.[0]).toEqual(actual.rates);
      expect(physical.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
      expect(restore.mock.invocationCallOrder[0]).toBeLessThan(upsert.mock.invocationCallOrder[0] ?? 0);
      const after = await local.snapshot(); expect(after).toEqual(before);
      expect(eventsSince(before, after)).toEqual([]);
      expect(await local.read(actual.created)).toEqual([]);
      expect(calls).toBe(63); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
    } finally {
      console.info("Tax Rate update synthetic same-request undo default-limit diagnostic", { boundedRequestEnters: calls,
        defaultCallLimit: defaultCommerceResources.calls, deleteCalls: physical.mock.calls.length,
        restoreCalls: restore.mock.calls.length, upsertCalls: upsert.mock.calls.length,
        reasons });
      tap.restore();
    }
  }, 240_000);

  it("commits genuine retained cancellation after the forward root and preserves native Rule creator overwrite", async () => {
    const local = await scenario("retained"), beforeRows = await local.read(), tap = retainedTap(local);
    try {
      const input = maximumTaxRateUpdateInput(), { updated_by: _actor, ...update } = input.update;
      await run(local, { ...input, update }); const captured = tap.get(), createdRows = await local.read(captured.created);
      expect(createdRows.every(row => row.created_by === null)).toBe(true);
      const before = await local.snapshot(), inverse = await local.prepareInverse(); let calls = 0;
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), captured).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
      })))).toBeNull();
      expect((await local.read()).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
      const vector = eventVector(eventsSince(before, await local.snapshot()));
      expect(vector).toEqual([...captured.created.map(value => ["tax.tax-rate-rule.deleted", value]), ...selected.map(value => ["tax.tax-rate.updated", value])]);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
    } finally { tap.restore(); }
  }, 240_000);

  it("deduplicates raw selector IDs while retaining native ID order and changed-filter membership", async () => {
    const local = await scenario("selectors"), beforeRules = await local.read(taxUpdateOldIds), list = vi.spyOn(TaxModuleService.prototype, "listTaxRates");
    const output = await run(local, { selector: { id: [taxUpdateRateIds[0], first, taxUpdateRateIds[0], taxUpdateRateIds[1], "missing168"] },
      update: { name: "Raw selector order differs" } });
    expect(output.map(row => row.id)).toEqual([first, taxUpdateRateIds[1], taxUpdateRateIds[0]]);
    expect(list.mock.calls[0]?.[0]).toEqual({ id: [taxUpdateRateIds[0], first, taxUpdateRateIds[0], taxUpdateRateIds[1], "missing168"] });
    expect(await local.read(taxUpdateOldIds)).toEqual(beforeRules);
    const changed = await run(local, { selector: { tax_region_id: "txreg168-us", code: ["UPDATE168_0", "UPDATE168_2"] },
      update: { code: "Changed selector field" } });
    expect(changed.map(row => row.id)).toEqual([taxUpdateRateIds[2], taxUpdateRateIds[0]]);
    expect(changed.every(row => row.code === "Changed selector field")).toBe(true);
  }, 240_000);

  it("preserves one supplied Rule identity across four native Rate positions and removes it once", async () => {
    const local = await scenario("rule-alias"), before = await local.snapshot(), tap = retainedTap(local), input = maximumTaxRateUpdateInput();
    try {
      const template = input.update.rules?.[0];
      if (template === undefined) throw new Error("Missing native Rule alias template");
      const changed = { ...input, update: { ...input.update, rules: [{ ...template, id: "txrule168-shared" }] } };
      await run(local, changed); const retained = tap.get();
      expect(retained.created).toEqual(Array(4).fill("txrule168-shared"));
      expect(await local.read(["txrule168-shared"])).toMatchObject([{ id: "txrule168-shared", tax_rate_id: first,
        reference_id: "replacement-product", created_by: "actor168" }]);
      expect(eventVector(eventsSince(before, await local.snapshot())).filter(([name]) => name === "tax.tax-rate-rule.created"))
        .toEqual([["tax.tax-rate-rule.created", "txrule168-shared"]]);
      const inverse = await local.prepareInverse(), committed = await local.snapshot();
      await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained));
      expect(await local.read(["txrule168-shared"])).toEqual([]);
      expect(eventVector(eventsSince(committed, await local.snapshot())).filter(([name]) => name === "tax.tax-rate-rule.deleted"))
        .toEqual([["tax.tax-rate-rule.deleted", "txrule168-shared"]]);
    } finally { tap.restore(); }
  }, 240_000);

  it("excludes predeleted Rules from actual retention and protects a later unrelated Rule", async () => {
    const historical = taxUpdateOldIds[0];
    if (historical === undefined) throw new Error("Missing historical Tax Rule fixture");
    const rows = taxRateUpdateRows().map(value => value.row.id === historical ? { ...value, row: { ...value.row, deleted_at: taxUpdateStamp } } : value);
    const local = await scenario("history", rows), protectedRows = await local.read([historical]), tap = retainedTap(local);
    try {
      await run(local, maximumTaxRateUpdateInput()); const actual = tap.get();
      expect(actual.old).toEqual(taxUpdateOldIds.filter(value => value !== historical).sort());
      const creation = await local.prepareCreation(), later = await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [
        { tax_rate_id: first, reference: "product", reference_id: "later-unrelated168" },
      ] }));
      const laterRows = await local.read(later.map(row => row.id)), inverse = await local.prepareInverse();
      await Effect.runPromise(inverse.run(inverse.newRequestKey(), actual));
      expect(await local.read([historical])).toEqual(protectedRows); expect(await local.read(later.map(row => row.id))).toEqual(laterRows);
    } finally { tap.restore(); }
  }, 240_000);

  it("rolls back the whole retained inverse on an independently occupied old Rule key", async () => {
    const local = await scenario("inverse-conflict"), tap = retainedTap(local);
    try {
      await run(local, maximumTaxRateUpdateInput()); const actual = tap.get(), creation = await local.prepareCreation();
      await Effect.runPromise(creation.run(creation.newRequestKey(), { rules: [
        { tax_rate_id: taxUpdateRateIds[0], reference: "different-reference", reference_id: "prod163-one" },
      ] }));
      const before = await local.snapshot(), inverse = await local.prepareInverse(), remove = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules"),
        restore = vi.spyOn(TaxModuleService.prototype, "restoreTaxRateRules"), upsert = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
      expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), actual)))).toBe(true);
      expect(remove).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1); expect(upsert).not.toHaveBeenCalled();
      expect(await local.snapshot()).toEqual(before); expect(await local.read(actual.created)).toHaveLength(8);
    } finally { tap.restore(); }
  }, 240_000);

  it("refuses a complete seventeen-old-Rule selection without publishing the preceding Rate update", async () => {
    const rows = taxRateUpdateRows(), target = first, parentRows = rows.filter(row => row.table !== "tax_rate_rule"),
      originalRule = rows.find(row => row.table === "tax_rate_rule");
    if (originalRule === undefined) throw new Error("Missing native Rule seed shape");
    const large = [...parentRows, ...Array.from({ length: 17 }, (_, index) => ({ table: "tax_rate_rule", row: {
      ...originalRule.row, id: `txrule168-overflow-${String(index).padStart(2, "0")}`, tax_rate_id: target, reference_id: `overflow-${index}`,
    } }))];
    const local = await scenario("old-cohort-overflow", large), before = await local.snapshot(), host = await local.prepare(),
      list = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules"), remove = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules"),
      create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector: { id: target },
      update: { name: "Never published", rules: [] } })))).toBe(true);
    expect(list).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("refuses five selected Rates at the complete preimage read before native updates", async () => {
    const rows = taxRateUpdateRows(), exemplar = rows.find(value => value.table === "tax_rate");
    if (exemplar === undefined) throw new Error("Missing maximum Rate fixture");
    const local = await scenario("rate-cohort-overflow", [...rows, { table: "tax_rate", row: { ...exemplar.row, id: "txr168-fifth" } }]),
      host = await local.prepare(), before = await local.snapshot(), update = vi.spyOn(TaxModuleService.prototype, "updateTaxRates");
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), {
      selector: { id: [...taxUpdateRateIds, "txr168-fifth"] }, update: { name: "Never entered" },
    })))).toBe(true);
    expect(update).not.toHaveBeenCalled(); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("retains whole nested metadata despite dotted native selects and restores its original content", async () => {
    const local = await scenario("metadata"), parent = taxUpdateRateIds[0], beforeRows = await local.read(), forward = await local.prepareForward(true),
      list = vi.spyOn(TaxModuleService.prototype, "listTaxRates");
    const prior = beforeRows.find(row => row.id === parent);
    if (prior === undefined || prior.metadata === undefined || !isJsonObject(prior.metadata)) throw new Error("Missing original native metadata");
    const output = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: parent }, update: {
      metadata: { nested: { replacement: true }, remove_me: "", fresh: "new" },
    } }));
    expect(list.mock.calls[0]?.[1]).toMatchObject({ select: ["metadata.nested.replacement", "metadata.remove_me", "metadata.fresh"], relations: [] });
    expect(output.preimages).toEqual([{ id: parent, metadata: prior.metadata }]);
    expect(output.output[0]?.metadata).toEqual({ owner: parent, [`only_${parent}`]: 0, nested: { replacement: true }, fresh: "new" });
    expect((await local.read()).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
  }, 240_000);

  it.each([false, true])("preserves native shared forward metadata and restores four distinct preimages (nested: %s)", async nested => {
    const local = await scenario("metadata-four"), original = await local.read(selected), host = await local.prepareForward(true),
      update = nested ? { metadata: { nested: { new_key: true }, shared_update: "all" } } : { metadata: { shared_update: "all", remove_me: "" } };
    const output = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [...taxUpdateRateIds] }, update }));
    expect(output.preimages).toEqual(original.map(row => ({ id: row.id, metadata: row.metadata })));
    const first = output.output[0]?.metadata;
    if (first === undefined || !isJsonObject(first)) throw new Error("Missing native shared metadata output");
    expect(first.owner).toBe(selected[0]); expect(first.shared_update).toBe("all");
    for (const parent of selected) expect(first).toHaveProperty(`only_${parent}`);
    for (const row of output.output) expect(row.metadata).toEqual(first);
    if (nested) expect(first.nested).toEqual({ new_key: true });
    expect((await local.read(selected)).map(withoutUpdated)).toEqual(original.map(withoutUpdated));
  }, 240_000);

  it.each([[16777217, 16777216], [1.0000000596046448, 1.0000001], [1e-45, 1e-45]])(
    "preserves immediate SQL-real update %s and authenticates cold %s before genuine inverse", async (submitted, stored) => {
      const local = await scenario("real"), parent = taxUpdateRateIds[0], forward = await local.prepareForward(), before = (await local.read([parent]))[0];
      if (before === undefined) throw new Error("Missing REAL update seed");
      const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: parent }, update: { rate: submitted } }));
      expect(result.output[0]?.rate).toBe(submitted); expect(result.preimages).toEqual([{ id: parent, rate: before.rate }]);
      expect((await local.read([parent]))[0]?.rate).toBe(stored);
      const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), { rates: result.preimages, created: [], old: [] }));
      expect(withoutUpdated((await local.read([parent]))[0] ?? {})).toEqual(withoutUpdated(before));
    }, 240_000);

  it.each([1e-46, 3.5e38])("refuses native SQL-real range %s without committed rows or publication", async rate => {
    const local = await scenario("real-range"), before = await local.snapshot(), host = await local.prepare();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector: { id: first }, update: { rate } })))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it.each(["default", "rules"] as const)("preserves native %s constraint failure and atomic rollback", async kind => {
    const local = await scenario("constraint"), before = await local.snapshot(), host = await local.prepare();
    const input = kind === "default" ? { selector: { id: [...taxUpdateRateIds] }, update: { is_default: true } }
      : { selector: { id: taxUpdateRateIds[0] }, update: { name: "Never committed", rules: [
        { reference: "product", reference_id: "same" }, { reference: "product_type", reference_id: "same" },
      ] } };
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), input)))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it.each(["missing", "deleted"] as const)("preserves the sparse native inverse required-field failure for a %s Rate", async disposition => {
    const active = await scenario("capture-sparse"), forward = await active.prepareForward(), parent = taxUpdateRateIds[0];
    const original = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: parent }, update: { name: "Temporary" } }));
    expect(original.preimages).toEqual([{ id: parent, name: `Rate ${parent}` }]);
    const initial = taxRateUpdateRows().filter(row => disposition !== "missing" || row.row.id !== parent && row.row.tax_rate_id !== parent)
      .map(row => disposition === "deleted" && (row.row.id === parent || row.row.tax_rate_id === parent)
        ? { ...row, row: { ...row.row, deleted_at: taxUpdateStamp } } : row);
    const local = await scenario("sparse-" + disposition, initial), inverse = await local.prepareInverse(), before = await local.snapshot(),
      native = vi.spyOn(TaxModuleService.prototype, "upsertTaxRates");
    const failed = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), { rates: original.preimages, created: [], old: [] }));
    if (Exit.isSuccess(failed)) throw new Error("Expected sparse native recreation refusal");
    expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual(original.preimages);
    expect(failed.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof CommerceTransactionError &&
      reason.error.reason === "invalidInput" && Schema.isSchemaError(reason.error.cause))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rolls back completed Rate and Rule writes after a genuine late parent defect", async () => {
    const local = await scenario("late"), host = await local.prepareLateFailure(), before = await local.snapshot(),
      rates = vi.spyOn(TaxModuleService.prototype, "updateTaxRates"), rules = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRateUpdateInput()));
    if (Exit.isSuccess(failed)) throw new Error("Expected late genuine Tax Rate update defect");
    expect(failed.cause.reasons.some(reason => reason._tag === "Die" && reason.defect === local.lateFailure)).toBe(true);
    expect(rates).toHaveBeenCalledTimes(1); expect(rules).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("waits for interrupted native Rule creation settlement before discarding the complete graph", async () => {
    const local = await scenario("interrupt"), host = await local.prepare(), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRateRules;
    let entered: () => void = () => {}, release: () => void = () => {}, nativeFinished = false, pendingSettled = false;
    const started = new Promise<void>(resolve => { entered = resolve; }), finish = new Promise<void>(resolve => { release = resolve; });
    const create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules").mockImplementation(async function (this: TaxModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); entered(); await finish; nativeFinished = true; return output;
    });
    const controller = new AbortController(), pending = Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRateUpdateInput()), { signal: controller.signal })
      .finally(() => { pendingSettled = true; });
    try {
      await Promise.race([started, pending.then(() => { throw new Error("Update ended before the native cancellation barrier"); })]);
      controller.abort();
      await new Promise<void>(resolve => { setTimeout(resolve, 100); });
      expect(pendingSettled).toBe(false); expect(nativeFinished).toBe(false);
      release(); expect(Exit.isFailure(await pending)).toBe(true);
      expect(pendingSettled).toBe(true); expect(nativeFinished).toBe(true);
      expect(create).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
    } finally { release(); try { await pending; } finally { create.mockRestore(); } }
  }, 240_000);

  it("replays authenticated committed output once and refuses input/revision conflicts", async () => {
    const local = await scenario("replay"), host = await local.prepare(), key = host.newRequestKey(), input = maximumTaxRateUpdateInput(),
      native = vi.spyOn(TaxModuleService.prototype, "updateTaxRates");
    const output = await Effect.runPromise(host.run(key, input)), before = await local.snapshot();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(native).toHaveBeenCalledTimes(1);
    await expect(Effect.runPromise(host.run(key, { selector: { id: [] }, update: {} }))).rejects.toMatchObject({ reason: "requestConflict" });
    await expect(Effect.runPromise(prepareTaxRateUpdateWorkflow({ ...local.options, revision: "e".repeat(64) }).pipe(
      Effect.flatMap(changed => changed.run(key, input).pipe(Effect.ensuring(changed.close))),
    ))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rejects unissued/wrong-profile modules and per-registration resource overrides", async () => {
    const local = await scenario("authority"), before = await local.snapshot();
    const wrong: InstalledWorkflowModule = { ...local.modules.tax, module: local.creationModule };
    const unissued: InstalledWorkflowModule = { ...local.modules.tax, module: { ...local.tax.workflow } };
    // Deliberately malformed runtime registrations cross the actual facade
    // boundary; no type assertion grants the wrong module its absent methods.
    for (const tax of [wrong, unissued]) expect(Exit.isFailure(await Effect.runPromiseExit(
      Reflect.apply(prepareTaxRateUpdateWorkflow, undefined, [{ ...local.options, modules: { tax } }]),
    ))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(prepareTaxRateUpdateWorkflow({ ...local.options,
      modules: { tax: { ...local.modules.tax, logicalResources: { ...defaultCommerceResources, calls: 128 } } } })))).toBe(true);
    const module: WorkflowModule = local.tax.workflow;
    expect(Result.isFailure(prepareWorkflowResources({ tax: { module, methods: ["deleteTaxRates"], graph: false } }, true))).toBe(true);
    noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it("binds reusable same-profile preparation to the executing local scope", async () => {
    const local = await scenario("scope-local"), foreign = await scenario("scope-foreign"), foreignBefore = await foreign.read();
    const output = await Effect.runPromise(prepareTaxRateUpdateWorkflow({ ...local.options, modules: foreign.modules }).pipe(
      Effect.flatMap(host => host.run(host.newRequestKey(), { selector: { id: first }, update: { name: "Local scope only" } }).pipe(Effect.ensuring(host.close))),
    ));
    expect(output[0]?.name).toBe("Local scope only"); expect((await local.read([first]))[0]?.name).toBe("Local scope only");
    expect(await foreign.read()).toEqual(foreignBefore);
    const escape = await local.prepareCaughtFailure();
    expect(await Effect.runPromise(escape.run(escape.newRequestKey(), { selector: { id: first }, update: {} }))).toEqual([]);
    const settled = await local.snapshot(); await expect(local.callEscaped()).rejects.toBeDefined(); expect(await local.snapshot()).toEqual(settled);
  }, 240_000);

  it("refuses a forged full native Rate DTO after genuine writes and preserves publication", async () => {
    const local = await scenario("forged-output"), host = await local.prepare(), before = await local.snapshot(), original = TaxModuleService.prototype.updateTaxRates,
      descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "updateTaxRates");
    if (descriptor === undefined) throw new Error("Missing native Tax update descriptor");
    let forged = 0;
    Object.defineProperty(TaxModuleService.prototype, "updateTaxRates", { ...descriptor, value: async function (this: unknown, ...args: unknown[]) {
      const output: unknown = await Reflect.apply(original, this, args), rows = Result.getOrThrow(local.tax.contracts.decodeRows(output));
      forged++; return rows.map(row => ({ ...row, name: "Forged unpersisted name" }));
    } });
    try { expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRateUpdateInput())))).toBe(true);
      expect(forged).toBe(1); expect(await local.snapshot()).toEqual(before); }
    finally { Object.defineProperty(TaxModuleService.prototype, "updateTaxRates", descriptor); }
  }, 240_000);

  it("keeps a caught forged Rate preimage refusal sticky before another admitted call", async () => {
    const local = await scenario("sticky"), host = await local.prepareCaughtFailure(), before = await local.snapshot(), original = TaxModuleService.prototype.listTaxRates,
      descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "listTaxRates");
    let calls = 0;
    Object.defineProperty(TaxModuleService.prototype, "listTaxRates", { configurable: true, writable: true, value: async function (this: unknown, ...args: unknown[]) {
      await Reflect.apply(original, this, args); calls++; return [{ id: taxUpdateRateIds[0], name: "Forged preimage" }];
    } });
    try { expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector: { id: taxUpdateRateIds[0] }, update: {} })))).toBe(true);
      expect(calls).toBe(1); expect(await local.snapshot()).toEqual(before); }
    finally { if (descriptor === undefined) Reflect.deleteProperty(TaxModuleService.prototype, "listTaxRates");
      else Object.defineProperty(TaxModuleService.prototype, "listTaxRates", descriptor); }
  }, 240_000);

  it("changes genuine cold calculation until the actual retained Rule and Rate inverses", async () => {
    const local = await scenario("calculation"), input = taxInput({ shipping_methods: [] }), calculate = async () => {
      const host = await local.prepareCalculation(); return Effect.runPromise(host.run(host.newRequestKey(), input));
    };
    const original = await calculate(); expect(original.lineItemTaxLines.length).toBeGreaterThan(0);
    const tap = retainedTap(local);
    try {
      await run(local, maximumTaxRateUpdateInput()); const actual = tap.get(), changed = await calculate();
      expect(changed).toEqual({ lineItemTaxLines: [], shippingMethodsTaxLines: [] });
      const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), actual));
      expect(await calculate()).toEqual(original);
    } finally { tap.restore(); }
  }, 240_000);
});

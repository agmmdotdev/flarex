import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { inspectLogicalRelationalFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { TaxCreationCheckConstraintError, TaxCreationValidationError } from "../src/modules/tax/region-create-failure";
import { taxInput, taxRegion, taxSeed, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRegionCreation, taxRegionCreationInput, maximumTaxRegionCreationInput,
  taxRegionCreationRows, taxRegionCreationParent, type TaxRegionCreationInput } from "./support/logical-tax-region-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRegionCreation>>, sharedCleanupCount = 0, ordinal = 0;
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
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRegionCreationRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRegionCreation(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-region-create-${name}-${number}`, projectId: "tax-region-create-170", uuidOffset: 4_500_000 + number * 10_000 } });
}
const run = async (local: Local, input: TaxRegionCreationInput) => {
  const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
};
/** Build the inverse boundary through two genuine create requests. The four
 * retained roots predate four current child Regions and their default graphs. */
async function buildCompleteInverseMaximum(local: Local) {
  const forward = await local.prepareForward();
  const created = await Effect.runPromise(forward.run(forward.newRequestKey(), maximumTaxRegionCreationInput()));
  await run(local, created.output.map((parent, index) => ({ id: `txreg170-closure-child-${index}`, country_code: `max170-${index}`,
    province_code: "late-child", parent_id: parent.id, default_tax_rate: { id: `txr170-closure-child-${index}`, name: `Child ${index}`,
      code: `CHILD170-${index}`, rules: [
        { id: `txrule170-closure-child-${index}-0`, reference: "product", reference_id: `late-prod-${index}` },
        { id: `txrule170-closure-child-${index}-1`, reference: "product_type", reference_id: `late-type-${index}` },
      ] } })));
  return created;
}
/** Observe the actual public native Promise rejection before its authenticated
 * receipt restores the original core Cause at the outer Effect boundary. */
interface PendingRateDiagnostic {
  readonly id: string;
  readonly tax_region_id: string;
  readonly name: string | null;
  readonly code?: null;
}
/** Complete portable pending entity measured from the native validation owner. */
function expectPendingRate(error: TaxCreationValidationError, identity: PendingRateDiagnostic) {
  const timestamp = Schema.decodeUnknownSync(Schema.String)(error.entity.created_at);
  expect(new Date(timestamp).toISOString()).toBe(timestamp);
  expect(error.entity).toEqual({ rate: null, is_default: true, is_combinable: false,
    metadata: null, created_by: null, deleted_at: null, created_at: timestamp,
    updated_at: timestamp, rules: [], ...identity });
  expect(error.getEntity()).toBe(error.entity);
}

async function observeFailure(local: Local, input: TaxRegionCreationInput) {
  const original = TaxModuleService.prototype.createTaxRegions;
  const descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRegions");
  if (descriptor === undefined) throw new Error("Missing native Region creation descriptor");
  const presented: unknown[] = [];
  async function observed(this: unknown, ...args: unknown[]): Promise<unknown> {
    try { return await Reflect.apply(original, this, args); }
    catch (error) { presented.push(error); throw error; }
  }
  Object.defineProperty(TaxModuleService.prototype, "createTaxRegions", { ...descriptor, value: observed });
  try {
    const host = await local.prepare(), exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), input));
    if (Exit.isSuccess(exit)) throw new Error("Expected genuine native Region failure");
    expect(presented).toHaveLength(1);
    return { exit, presented: presented[0] };
  } finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRegions", descriptor); }
}
/** Probe raw native arguments after the JSON workflow boundary. The original
 * service still executes its complete normalization, callbacks and flush. */
async function runWithNativeArguments(local: Local, input: TaxRegionCreationInput,
  nativeInput: (rows: TaxRegionCreationInput) => unknown) {
  const original = TaxModuleService.prototype.createTaxRegions;
  const descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRegions");
  if (descriptor === undefined) throw new Error("Missing native Region creation descriptor");
  let calls = 0;
  async function observed(this: unknown, ...args: unknown[]): Promise<unknown> {
    const rows = Result.getOrThrow(local.contracts.decodeInput(args[0]));
    calls++;
    return Reflect.apply(original, this, [nativeInput(rows), ...args.slice(1)]);
  }
  Object.defineProperty(TaxModuleService.prototype, "createTaxRegions", { ...descriptor, value: observed });
  try { const output = await run(local, input); expect(calls).toBe(1); return output; }
  finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRegions", descriptor); }
}

function coreFailures(cause: Cause.Cause<unknown>): CommerceTransactionError[] {
  const output: CommerceTransactionError[] = [];
  for (const reason of cause.reasons) if (Cause.isFailReason(reason) && reason.error instanceof CommerceTransactionError) {
    output.push(reason.error);
    if (Cause.isCause(reason.error.cause)) output.push(...coreFailures(reason.error.cause));
  }
  return output;
}

describe(`genuine native Tax Region creation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalTaxRegionCreation(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes native empty creation once on replay and skips empty retained deletion", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), create = vi.spyOn(TaxModuleService.prototype, "createTaxRegions"),
      remove = vi.spyOn(TaxModuleService.prototype, "deleteTaxRegions"), host = await local.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]);
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
    expect(remove).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("keeps complete defaults, native normalization and omitted creation references distinct from storage", async () => {
    const local = await scenario("defaults"), protectedRows = await local.read(), output = await run(local,
      taxRegionCreationInput({ country_code: " Us ", province_code: " Ca " }));
    const row = output[0]; if (row === undefined) throw new Error("Missing complete Region result");
    expect(row).toEqual({ id: row.id, country_code: " us ", province_code: " ca ", metadata: null, created_by: null,
      created_at: row.created_at, updated_at: row.updated_at, deleted_at: null, children: [], tax_rates: [] });
    expect(row.id).toMatch(/^txreg_/);
    expect(Object.hasOwn(row, "parent_id")).toBe(false); expect(Object.hasOwn(row, "provider_id")).toBe(false);
    const { children: _children, tax_rates: _rates, ...scalar } = row;
    expect(await local.read([row.id])).toEqual([{ ...scalar, parent_id: null, provider_id: null }]);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 180_000);

  it("creates the complete native maximum, publishes ordered model groups and replays without writes", async () => {
    const local = await scenario("maximum"), input = maximumTaxRegionCreationInput(), original = structuredClone(input), before = await local.snapshot(),
      protectedRows = await local.read(), host = await local.prepare(), key = host.newRequestKey();
    let calls = 0;
    const output = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(input).toEqual(original); expect(output).toHaveLength(4);
    const stored = await local.read(), rates: JsonObject[] = [], rules: JsonObject[] = [];
    for (const [index, row] of output.entries()) {
      expect(row).toMatchObject({ id: `txreg170-max-${index}`, country_code: `max170-${index}`, created_by: `creator-${index}`,
        metadata: { ordinal: index }, children: [], tax_rates: [] });
      const rate = stored.find(value => value.id === `txr170-max-${index}`);
      if (rate === undefined) throw new Error("Missing native default Rate");
      expect(rate).toMatchObject({ tax_region_id: row.id, is_default: true, is_combinable: index % 2 === 1,
        created_by: `creator-${index}`, rate: index + 0.1 });
      rates.push(rate);
      for (const childIndex of [0, 1]) {
        const rule = stored.find(value => value.id === `txrule170-max-${index}-${childIndex}`);
        if (rule === undefined) throw new Error("Missing native default Rule");
        expect(rule).toMatchObject({ tax_rate_id: rate.id, created_by: `creator-${index}`, metadata: null }); rules.push(rule);
      }
    }
    const committed = await local.snapshot();
    expect(eventVector(eventsSince(before, committed))).toEqual([...output.map(row => ["tax.tax-region.created", row.id]),
      ...rates.map(row => ["tax.tax-rate.created", row.id]), ...rules.map(row => ["tax.tax-rate-rule.created", row.id])]);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Tax Region creation maximum root calls", calls);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await local.snapshot()).toEqual(committed);
  }, 240_000);

  it("retains actual IDs and removes the whole maximum with only explicit Region events in insertion order", async () => {
    const local = await scenario("inverse"), protectedRows = await local.read(), forward = await local.prepareForward();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), maximumTaxRegionCreationInput()));
    expect(created.compensation).toEqual(created.output.map(row => row.id));
    const selected = (await local.read()).filter(row => typeof row.id === "string" && row.id.includes("170-max-"));
    expect(selected).toHaveLength(16);
    const committed = await local.snapshot(), inverse = await local.prepareInverse(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, [...created.compensation].reverse()))).toBeNull();
    expect(await local.read(selected.map(id))).toEqual([]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    const deleted = await local.snapshot();
    expect(eventVector(eventsSince(committed, deleted))).toEqual(created.compensation.map(value => ["tax.tax-region.deleted", value]));
    expect(await Effect.runPromise(inverse.run(key, [...created.compensation].reverse()))).toBeNull(); expect(await local.snapshot()).toEqual(deleted);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
    expect(eventsSince(deleted, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("preserves aliased root result positions, one stored identity and actual retained duplicates", async () => {
    const local = await scenario("alias"), forward = await local.prepareForward(), input = { id: "txreg170-alias", country_code: "ALIAS170" }, before = await local.snapshot();
    const output = await Effect.runPromise(forward.run(forward.newRequestKey(), [input, input]));
    expect(output.output).toHaveLength(2); expect(output.output[0]).toEqual(output.output[1]);
    expect(output.compensation).toEqual(["txreg170-alias", "txreg170-alias"]);
    expect(await local.read([input.id])).toHaveLength(1);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([["tax.tax-region.created", input.id]]);
    const beforeInverse = await local.snapshot();
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.compensation));
    expect(await local.read([input.id])).toEqual([]);
    expect(eventVector(eventsSince(beforeInverse, await local.snapshot()))).toEqual([["tax.tax-region.deleted", input.id]]);
  }, 240_000);

  it("keeps approved insertion event order when original retained Region roots become parent and child", async () => {
    const local = await scenario("inverse-overlap"), protectedRows = await local.read(), forward = await local.prepareForward();
    const parent = "txreg170-overlap-parent", child = "txreg170-overlap-recreated";
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), [
      { id: parent, country_code: "OVERLAP170" }, { id: child, country_code: "OTHER170" },
    ]));
    expect(created.compensation).toEqual([parent, child]);
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [child]))).toBeNull();
    expect(await local.read([child])).toEqual([]);
    await run(local, [{ id: child, country_code: "OVERLAP170", province_code: "late", parent_id: parent }]);
    expect((await local.read([child]))[0]?.parent_id).toBe(parent);
    const before = await local.snapshot(), remove = vi.spyOn(TaxModuleService.prototype, "deleteTaxRegions");
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1); expect(remove.mock.calls[0]?.[0]).toEqual(created.compensation);
    expect(await local.read(created.compensation)).toEqual([]); expect(await local.read()).toEqual(protectedRows);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([
      ["tax.tax-region.deleted", parent], ["tax.tax-region.deleted", child],
    ]);
  }, 240_000);

  it("accepts a visible matching parent while preserving supplied null provider presence", async () => {
    const local = await scenario("parent"), output = await run(local, [{ country_code: "US", province_code: "CA",
      parent_id: taxRegionCreationParent, provider_id: null }]);
    expect(output[0]).toMatchObject({ country_code: "us", province_code: "ca", parent_id: taxRegionCreationParent, provider_id: null });
  }, 180_000);

  it.each([
    ["missing", [{ country_code: "US", province_code: "CA", parent_id: "txreg170-missing" }]],
    ["mismatch", [{ country_code: "CA", province_code: "ON", parent_id: taxRegionCreationParent }]],
    ["null", [{ country_code: "US", province_code: "CA", parent_id: null }]],
    ["same-batch", [{ id: "txreg170-new-parent", country_code: "GB" }, { country_code: "GB", province_code: "LND", parent_id: "txreg170-new-parent" }]],
  ] satisfies readonly (readonly [string, TaxRegionCreationInput])[])("keeps native %s parent refusal before all inserts", async (name, input) => {
    const local = await scenario("parent-" + name), before = await local.snapshot(), failure = await observeFailure(local, input);
    expect(failure.presented).toBeInstanceOf(MedusaError);
    if (!(failure.presented instanceof MedusaError)) throw new Error("Missing original parent validation error");
    expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(failure.presented.message).toContain("Province region must belong to a parent region");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it.each([false, true])("accepts a persisted disabled/historical Provider (historical=%s) without registration", async historical => {
    const rows = [...taxRegionCreationRows(), { table: "tax_provider", row: { id: "tp170-disabled", is_enabled: false,
      created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: historical ? "2020-01-02T00:00:00.000Z" : null } }];
    const local = await scenario("provider-" + historical, rows), output = await run(local, taxRegionCreationInput({ provider_id: "tp170-disabled" }));
    expect(output[0]).toMatchObject({ provider_id: "tp170-disabled" });
  }, 180_000);

  it.each([["tp170-missing", "tp170-missing"], ["tp_missing,tail", "tp_missing"],
    ["tp_missing(tail", "tail"], ["tp_missing)tail", "tp_missing)tail"]])("retains native missing Provider punctuation: %s", async (provider, presentedId) => {
    const local = await scenario("missing-provider"), before = await local.snapshot(), failure = await observeFailure(local, taxRegionCreationInput({ provider_id: provider }));
    if (!(failure.presented instanceof MedusaError)) throw new Error("Missing native Provider error");
    expect(failure.presented.type).toBe(MedusaError.Types.NOT_FOUND);
    expect(failure.presented.message).toBe(`You tried to set relationship provider_id: ${presentedId}, but such entity does not exist`);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it.each(["missing", "null"] as const)("presents the approved required-code %s diagnostic with detached shared entity access", async kind => {
    const local = await scenario("required-" + kind), before = await local.snapshot(), failure = await observeFailure(local,
      taxRegionCreationInput({ default_tax_rate: { name: "Required", ...(kind === "null" ? { code: null } : {}), rules: [] } }));
    if (!(failure.presented instanceof TaxCreationValidationError)) throw new Error("Missing approved portable native ValidationError");
    const error = failure.presented;
    expect(error.name).toBe("ValidationError");
    expect(error.message).toBe(`Value for TaxRate.code is required, '${kind === "null" ? "null" : "undefined"}' found`);
    const pendingId = id(error.entity), pendingRegion = Schema.decodeUnknownSync(Schema.String)(error.entity.tax_region_id);
    expect(pendingId).toMatch(/^txr_/); expect(pendingRegion).toMatch(/^txreg_/);
    expectPendingRate(error, { id: pendingId, tax_region_id: pendingRegion, name: "Required",
      ...(kind === "null" ? { code: null } : {}) });
    const evidence = coreFailures(failure.exit.cause).map(inspectLogicalRelationalFailure)
      .find(value => value !== undefined && (value.kind === "missing" || value.kind === "null") && value.column === "code");
    if (evidence === undefined || (evidence.kind !== "missing" && evidence.kind !== "null") || evidence.candidate === undefined)
      throw new Error("Missing original storage-issued required-column evidence");
    const original = structuredClone(evidence.candidate);
    expect(evidence.kind).toBe(kind);
    expect(Reflect.set(error.entity, "code", "caller-mutated")).toBe(true);
    expect(Reflect.set(error.entity, "metadata", { caller: true })).toBe(true);
    expect(evidence.candidate).toEqual(original); expect(error.getEntity().code).toBe("caller-mutated");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it.each(["missing-code", "duplicate-rule"] as const)("keeps missing Provider ahead of %s after the native nested Rate returns", async branch => {
    const local = await scenario("combined-" + branch), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRates,
      descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRates"), trace: string[] = [];
    if (descriptor === undefined) throw new Error("Missing native nested Rate descriptor");
    async function observed(this: unknown, ...args: unknown[]): Promise<unknown> {
      trace.push("rate-enter"); const output: unknown = await Reflect.apply(original, this, args); trace.push("rate-return"); return output;
    }
    Object.defineProperty(TaxModuleService.prototype, "createTaxRates", { ...descriptor, value: observed });
    try {
      const failure = await observeFailure(local, taxRegionCreationInput({ provider_id: "tp170-missing", default_tax_rate: branch === "missing-code"
        ? { name: "Missing" } : { name: "Duplicate", code: "DUP", rules: [{ reference: "product", reference_id: "same" }, { reference: "product", reference_id: "same" }] } }));
      expect(trace).toEqual(["rate-enter", "rate-return"]);
      if (!(failure.presented instanceof MedusaError)) throw new Error("Missing native first Provider failure");
      expect(failure.presented.type).toBe(MedusaError.Types.NOT_FOUND);
      expect(failure.presented.message).toBe("You tried to set relationship provider_id: tp170-missing, but such entity does not exist");
      expect(await local.snapshot()).toEqual(before);
    } finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRates", descriptor); }
  }, 180_000);

  it("keeps malformed null Rule mapping ahead of missing Provider and every flush", async () => {
    const local = await scenario("null-rules"), before = await local.snapshot(), failure = await observeFailure(local,
      taxRegionCreationInput({ provider_id: "tp170-missing", default_tax_rate: { name: "Bad rules", code: "NULL", rules: null } }));
    expect(failure.presented).toBeInstanceOf(TypeError);
    if (!(failure.presented instanceof TypeError)) throw new Error("Missing genuine native map TypeError");
    expect(failure.presented.message).toContain("map"); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("deletes current and historical late descendants while preserving ancestors, Providers and unrelated graphs", async () => {
    const local = await scenario("late-descendants"), protectedRows = await local.read(), forward = await local.prepareForward();
    const root = await Effect.runPromise(forward.run(forward.newRequestKey(), [{ id: "txreg170-cascade-root", country_code: "CASCADE170" }]));
    await run(local, [{ id: "txreg170-cascade-child", country_code: "CASCADE170", province_code: "child", parent_id: "txreg170-cascade-root",
      default_tax_rate: { id: "txr170-cascade-child", name: "Current", code: "CUR", rules: [{ id: "txrule170-cascade-child", reference: "product", reference_id: "current" }] } }]);
    const stamp = "2020-01-01T00:00:00.000Z";
    await run(local, [{ id: "txreg170-cascade-history", country_code: "CASCADE170", province_code: "history", parent_id: "txreg170-cascade-child", deleted_at: stamp,
      default_tax_rate: { id: "txr170-cascade-history", name: "Historical", code: "HIST", deleted_at: stamp,
        rules: [{ id: "txrule170-cascade-history", reference: "product", reference_id: "history", deleted_at: stamp }] } }]);
    const selected = (await local.read()).filter(row => typeof row.id === "string" && row.id.includes("170-cascade-"));
    expect(selected).toHaveLength(7); const before = await local.snapshot(), inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), root.compensation));
    expect(await local.read(selected.map(id))).toEqual([]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([["tax.tax-region.deleted", "txreg170-cascade-root"]]);
    const after = await local.snapshot(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), ["txreg170-never-existed"]));
    expect(eventsSince(after, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("physically removes the exact complete eight-Region/eight-Rate/sixteen-Rule inverse boundary", async () => {
    const local = await scenario("inverse-boundary"), protectedRows = await local.read(), created = await buildCompleteInverseMaximum(local);
    const selected = (await local.read()).filter(row => typeof row.id === "string" && (row.id.includes("170-max-") || row.id.includes("170-closure-")));
    expect(selected).toHaveLength(32);
    expect(selected.filter(row => Object.hasOwn(row, "country_code"))).toHaveLength(8);
    expect(selected.filter(row => Object.hasOwn(row, "tax_region_id"))).toHaveLength(8);
    expect(selected.filter(row => Object.hasOwn(row, "tax_rate_id"))).toHaveLength(16);
    const before = await local.snapshot(), inverse = await local.prepareInverse();
    let calls = 0;
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...created.compensation].reverse())
      .pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
      })))).toBeNull();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    console.info("Tax Region complete inverse maximum calls", calls);
    expect(await local.read(selected.map(id))).toEqual([]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual(created.compensation.map(value => ["tax.tax-region.deleted", value]));
  }, 240_000);

  it.each(["region", "rate", "rule"] as const)("refuses the complete inverse %s overbound before any durable mutation", async branch => {
    const local = await scenario("inverse-overbound-" + branch), created = await buildCompleteInverseMaximum(local);
    const root = created.compensation[0]; if (root === undefined) throw new Error("Missing retained original root");
    if (branch === "region") await run(local, [{ id: "txreg170-overbound", country_code: "max170-0", province_code: "overbound", parent_id: root }]);
    else if (branch === "rate") {
      const host = await local.prepareAdditionalRates();
      await Effect.runPromise(host.run(host.newRequestKey(), [{ id: "txr170-overbound", tax_region_id: root,
        name: "Late nondefault", code: "LATE170", is_default: false }]));
    } else {
      const host = await local.prepareAdditionalRules();
      await Effect.runPromise(host.run(host.newRequestKey(), { rules: [{ id: "txrule170-overbound", tax_rate_id: "txr170-max-0",
        reference: "product", reference_id: "overbound-unique" }] }));
    }
    const before = await local.snapshot(), protectedRows = await local.read(), inverse = await local.prepareInverse();
    const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), created.compensation));
    if (Exit.isSuccess(exit)) throw new Error("Expected complete current inverse bound refusal");
    expect(coreFailures(exit.cause).some(error => error.reason === "limitExceeded")).toBe(true);
    expect(await local.snapshot()).toEqual(before); expect(await local.read()).toEqual(protectedRows);
  }, 240_000);

  it.each(["child-provider", "child-without-province", "child-empty-province", "country-null-province", "country-province"] as const)
    ("preserves %s rejection, its selected diagnostic and complete rollback", async branch => {
      const local = await scenario("constraint-" + branch);
      if (branch === "country-province") await run(local, [{ country_code: "US", province_code: "CA" }]);
      const input = branch === "child-provider" ? [{ country_code: "US", province_code: "NY", parent_id: taxRegionCreationParent, provider_id: "tp_system" }]
        : branch === "child-without-province" ? [{ country_code: "US", parent_id: taxRegionCreationParent }]
        : branch === "child-empty-province" ? [{ country_code: "US", province_code: "", parent_id: taxRegionCreationParent }]
        : branch === "country-null-province" ? [{ country_code: "US", province_code: null }]
        : [{ country_code: "US", province_code: "CA" }];
      const before = await local.snapshot();
      const failure = await observeFailure(local, input);
      if (branch === "country-null-province" || branch === "country-province") {
        if (!(failure.presented instanceof MedusaError)) throw new Error("Missing native Region uniqueness error");
        expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
        // The null-province message is an unchanged original170 witness. The
        // composite province case additionally checks the exact pinned native
        // formatter grammar; that collision was not measured in the original47.
        expect(failure.presented.message).toBe(branch === "country-null-province"
          ? "Tax region with country_code: us, already exists."
          : "Tax region with country_code: us, province_code: ca, already exists.");
      } else {
        // Approved portable CHECK candidate, separate from the unchanged
        // SQL-bearing original170 native baseline. Only these exact DML IDs
        // map to the measured unquoted PostgreSQL constraint spellings.
        if (!(failure.presented instanceof TaxCreationCheckConstraintError)) throw new Error("Missing approved portable CHECK diagnostic");
        const error = failure.presented;
        const expected = branch === "child-provider"
          ? { id: "CK_tax_region_provider_top_level", publicName: "ck_tax_region_provider_top_level", column: "provider_id" }
          : { id: "CK_tax_region_country_top_level", publicName: "ck_tax_region_country_top_level", column: "province_code" };
        expect(error.name).toBe("CheckConstraintViolationException"); expect(error.code).toBe("23514");
        expect(error.table).toBe("tax_region"); expect(error.constraint).toBe(expected.publicName);
        expect(error.message).toBe(`new row for relation "tax_region" violates check constraint "${expected.publicName}"`);
        expect(Object.getPrototypeOf(error)).toBe(TaxCreationCheckConstraintError.prototype);
        expect(Object.getPrototypeOf(TaxCreationCheckConstraintError.prototype)).toBe(Error.prototype);
        expect(Object.getOwnPropertyNames(error).sort()).toEqual(["stack", "message", "name", "code", "table", "constraint"].sort());
        for (const property of ["type", "sql", "query", "parameters", "params", "detail", "entity", "getEntity",
          "candidate", "cause", "originalError", "driverException"]) expect(Reflect.has(error, property), property).toBe(false);
        const evidence = coreFailures(failure.exit.cause).map(inspectLogicalRelationalFailure).find(value => value?.kind === "check");
        if (evidence?.kind !== "check" || evidence.candidate === undefined) throw new Error("Missing actual storage CHECK evidence");
        expect(evidence.origin).toBe("row"); expect(evidence.column).toBe(expected.column);
        expect(evidence.table).toEqual({ owner: "medusa", lineageId: "commerce.tax", tableId: "tax_region" });
        expect(evidence.constraint).toEqual({ ...evidence.table, constraintId: expected.id });
        expect(evidence.candidate.parent_id).toBe(taxRegionCreationParent);
        expect(evidence.candidate.province_code).toBe(branch === "child-provider" ? "ny" : null);
        expect(evidence.candidate.provider_id).toBe(branch === "child-provider" ? "tp_system" : null);
        const originalEvidence = structuredClone(evidence);
        expect(inspectLogicalRelationalFailure(error)).toBeUndefined();
        expect(Reflect.set(error, "constraint", "caller-mutated-public-diagnostic")).toBe(true);
        expect(evidence).toEqual(originalEvidence); expect(inspectLogicalRelationalFailure(error)).toBeUndefined();
      }
      expect(await local.snapshot()).toEqual(before);
    }, 180_000);

  it("retains the native explicit identity collision diagnostic on a fresh workflow request", async () => {
    const local = await scenario("duplicate-root-id");
    await run(local, [{ id: "txreg170-root", country_code: "PK170" }]);
    const before = await local.snapshot(), failure = await observeFailure(local, [{ id: "txreg170-root", country_code: "PK170-DIFFERENT" }]);
    if (!(failure.presented instanceof MedusaError)) throw new Error("Missing native explicit identity error");
    expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(failure.presented.message).toBe("Tax region with id: txreg170-root, already exists.");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("retains the native composite Rule uniqueness diagnostic with the actual generated default Rate ID", async () => {
    const local = await scenario("duplicate-rule-diagnostic"), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRates,
      descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRates");
    if (descriptor === undefined) throw new Error("Missing native nested Rate descriptor");
    let actualRateId: string | undefined;
    async function observed(this: unknown, ...args: unknown[]): Promise<unknown> {
      const output: unknown = await Reflect.apply(original, this, args);
      const values = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(output);
      const row = values[0]; if (row === undefined) throw new Error("Missing genuine transient default Rate result");
      actualRateId = Schema.decodeUnknownSync(Schema.String)(row.id);
      return output;
    }
    Object.defineProperty(TaxModuleService.prototype, "createTaxRates", { ...descriptor, value: observed });
    try {
      const failure = await observeFailure(local, taxRegionCreationInput({ country_code: "RULE170-DIAGNOSTIC", default_tax_rate: {
        name: "Duplicate Rule", code: "DUP170", rules: [
          { reference: "product", reference_id: "ptyp170c-duplicate" },
          { reference: "product_type", reference_id: "ptyp170c-duplicate" },
        ] } }));
      expect(actualRateId).toMatch(/^txr_/);
      if (actualRateId === undefined || !(failure.presented instanceof MedusaError)) throw new Error("Missing native Rule uniqueness error or actual Rate ID");
      expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
      expect(failure.presented.message).toBe(`Tax rate rule with tax_rate_id: ${actualRateId}, reference_id: ptyp170c-duplicate, already exists.`);
      expect(await local.snapshot()).toEqual(before);
    } finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRates", descriptor); }
  }, 180_000);
  it("preserves caller-managed timestamps and applies the native Region creator to default Rates and Rules", async () => {
    const local = await scenario("managed-creators"), stamp = "2020-01-02T03:04:05.000Z";
    const input = taxRegionCreationInput({ id: "txreg170-managed", created_at: stamp, updated_at: stamp, deleted_at: null,
      created_by: "region-creator", metadata: { nested: { root: true } }, default_tax_rate: { id: "txr170-managed",
        name: "Managed", code: "MANAGED170", created_at: stamp, updated_at: stamp, deleted_at: null,
        created_by: "ignored-rate-creator", rules: [{ id: "txrule170-managed", reference: "product", reference_id: "managed",
          created_at: stamp, updated_at: stamp, deleted_at: null, created_by: "ignored-rule-creator", metadata: { nested: { child: true } } }] } });
    const original = structuredClone(input), output = await run(local, input);
    expect(input).toEqual(original);
    expect(output[0]).toMatchObject({ id: "txreg170-managed", created_at: stamp, updated_at: stamp, deleted_at: null, created_by: "region-creator" });
    const stored = await local.read(["txr170-managed", "txrule170-managed"]);
    expect(stored).toHaveLength(2);
    expect(stored.every(row => row.created_by === "region-creator" && row.created_at === stamp && row.updated_at === stamp)).toBe(true);
    expect(stored.find(row => row.id === "txrule170-managed")?.metadata).toEqual({ nested: { child: true } });
  }, 180_000);

  it("preserves native own-undefined Region creator overwrite through nested Rate and Rule staging", async () => {
    const local = await scenario("undefined-creator");
    const output = await runWithNativeArguments(local, [{ id: "txreg170-undefined-creator", country_code: "UNDEFINED170",
      default_tax_rate: { id: "txr170-undefined-creator", name: "Undefined", code: "UNDEFINED170", created_by: "ignored-rate-creator",
        rules: [{ id: "txrule170-undefined-creator", reference: "product", reference_id: "undefined", created_by: "ignored-rule-creator" }] } }],
      rows => rows.map(row => ({ ...row, created_by: undefined })));
    expect(output[0]?.created_by).toBeNull();
    const stored = await local.read(["txr170-undefined-creator", "txrule170-undefined-creator"]);
    expect(stored).toHaveLength(2); expect(stored.every(row => row.created_by === null)).toBe(true);
  }, 180_000);

  it("pairs mixed omitted, null and present defaults with actual Region positions and no Rule writes or events", async () => {
    const local = await scenario("mixed-defaults"), before = await local.snapshot(),
      createRates = vi.spyOn(TaxModuleService.prototype, "createTaxRates");
    const input: TaxRegionCreationInput = [
      { id: "txreg170-mixed-0", country_code: "MIX170-0" },
      { id: "txreg170-mixed-1", country_code: "MIX170-1", default_tax_rate: { id: "txr170-mixed-1", name: "First", code: "MIX1" } },
      { id: "txreg170-mixed-2", country_code: "MIX170-2", default_tax_rate: null },
      { id: "txreg170-mixed-3", country_code: "MIX170-3", default_tax_rate: { id: "txr170-mixed-3", name: "Second", code: "MIX3", rules: [] } },
    ];
    const output = await run(local, input), rows = await local.read(["txr170-mixed-1", "txr170-mixed-3"]);
    expect(output.map(row => row.id)).toEqual(input.map(row => row.id));
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === "txr170-mixed-1")).toMatchObject({ tax_region_id: "txreg170-mixed-1", is_default: true });
    expect(rows.find(row => row.id === "txr170-mixed-3")).toMatchObject({ tax_region_id: "txreg170-mixed-3", is_default: true });
    expect(createRates).toHaveBeenCalledTimes(1);
    expect((await local.read()).filter(row => typeof row.tax_rate_id === "string" && row.id !== "txrule170-unrelated")).toEqual([]);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([
      ...output.map(row => ["tax.tax-region.created", row.id]),
      ["tax.tax-rate.created", "txr170-mixed-1"], ["tax.tax-rate.created", "txr170-mixed-3"],
    ]);
  }, 180_000);

  it("executes shared native default-object aliases for distinct roots without changing positional creators or foreign keys", async () => {
    const local = await scenario("shared-default"), shared = { name: "Shared", code: "SHARED170", metadata: { nested: { shared: true } } };
    const input: TaxRegionCreationInput = [
      { id: "txreg170-shared-0", country_code: "SHARED170-0", created_by: "creator-0", default_tax_rate: shared },
      { id: "txreg170-shared-1", country_code: "SHARED170-1", created_by: "creator-1", default_tax_rate: shared },
    ];
    const original = structuredClone(input);
    const output = await runWithNativeArguments(local, input, rows => {
      const first = rows[0]; if (first === undefined) throw new Error("Missing native shared default root");
      const sharedDefault = first.default_tax_rate;
      if (sharedDefault === undefined || !isJsonObject(sharedDefault)) throw new Error("Missing native shared default object");
      const aliased = rows.map(row => ({ ...row, default_tax_rate: sharedDefault }));
      expect(aliased[0]?.default_tax_rate).toBe(aliased[1]?.default_tax_rate);
      return aliased;
    });
    expect(input).toEqual(original); expect(input[0]?.default_tax_rate).toBe(shared); expect(input[1]?.default_tax_rate).toBe(shared);
    const rates = (await local.read()).filter(row => row.id !== "txr170-unrelated" && typeof row.tax_region_id === "string");
    expect(rates).toHaveLength(2);
    for (const [index, region] of output.entries()) expect(rates.find(rate => rate.tax_region_id === region.id))
      .toMatchObject({ created_by: "creator-" + index, is_default: true, metadata: shared.metadata });
  }, 180_000);

  it("preserves shared native Region/default metadata aliases while storing detached equal records", async () => {
    const local = await scenario("shared-metadata"), metadata = { nested: { owner: "shared170" } };
    const input = taxRegionCreationInput({ id: "txreg170-shared-metadata", metadata,
      default_tax_rate: { id: "txr170-shared-metadata", name: "Shared metadata", code: "META170", metadata } });
    await runWithNativeArguments(local, input, rows => rows.map(row => {
      const nested = row.default_tax_rate;
      if (nested === undefined || !isJsonObject(nested)) throw new Error("Missing native shared metadata default");
      return { ...row, default_tax_rate: { ...nested, metadata: row.metadata } };
    }));
    expect(input[0]?.metadata).toBe(metadata);
    const rows = await local.read(["txreg170-shared-metadata", "txr170-shared-metadata"]);
    expect(rows).toHaveLength(2); expect(rows.map(row => row.metadata)).toEqual([metadata, metadata]);
    metadata.nested.owner = "caller-mutated";
    expect((await local.read(["txreg170-shared-metadata", "txr170-shared-metadata"])).map(row => row.metadata))
      .toEqual([{ nested: { owner: "shared170" } }, { nested: { owner: "shared170" } }]);
  }, 180_000);

  it("refuses a historical parent before inserting its otherwise matching child", async () => {
    const parent = "txreg170-historical-parent", local = await scenario("historical-parent", [
      ...taxRegionCreationRows(), taxRegion(parent, { country_code: "history170", deleted_at: "2020-01-02T00:00:00.000Z" }),
    ]), before = await local.snapshot();
    const failure = await observeFailure(local, [{ country_code: "HISTORY170", province_code: "child", parent_id: parent }]);
    if (!(failure.presented instanceof MedusaError)) throw new Error("Missing native historical parent refusal");
    expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(failure.presented.message).toContain("Province region must belong to a parent region");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("reuses historical country and province unique keys without changing their historical rows or active parent", async () => {
    const oldCountry = "txreg170-old-country", oldProvince = "txreg170-old-province", stamp = "2020-01-02T00:00:00.000Z";
    const local = await scenario("historical-unique", [...taxRegionCreationRows(),
      taxRegion(oldCountry, { country_code: "gb", deleted_at: stamp }),
      taxRegion(oldProvince, { country_code: "us", province_code: "ca", parent_id: taxRegionCreationParent, provider_id: null, deleted_at: stamp }),
    ]), protectedRows = await local.read();
    const output = await run(local, [{ id: "txreg170-new-country", country_code: "GB" },
      { id: "txreg170-new-province", country_code: "US", province_code: "CA", parent_id: taxRegionCreationParent }]);
    expect(output).toHaveLength(2); expect(output.every(row => row.deleted_at === null)).toBe(true);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 180_000);

  it("physically removes an explicitly retained historical root and its default graph", async () => {
    const local = await scenario("historical-root"), protectedRows = await local.read(), before = await local.snapshot(), forward = await local.prepareForward(),
      stamp = "2020-01-02T00:00:00.000Z";
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), [{ id: "txreg170-retained-history", country_code: "RETAINED170",
      deleted_at: stamp, default_tax_rate: { id: "txr170-retained-history", name: "History", code: "HISTORY170", deleted_at: stamp,
        rules: [{ id: "txrule170-retained-history", reference: "product", reference_id: "history170", deleted_at: stamp }] } }]));
    expect(created.compensation).toEqual(["txreg170-retained-history"]);
    expect(created.output[0]?.deleted_at).toBe(stamp);
    const committed = await local.snapshot(), inverse = await local.prepareInverse();
    expect(eventVector(eventsSince(before, committed))).toEqual([["tax.tax-region.created", "txreg170-retained-history"],
      ["tax.tax-rate.created", "txr170-retained-history"], ["tax.tax-rate-rule.created", "txrule170-retained-history"]]);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation));
    expect(await local.read(["txreg170-retained-history", "txr170-retained-history", "txrule170-retained-history"])).toEqual([]);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    expect(eventVector(eventsSince(committed, await local.snapshot()))).toEqual([["tax.tax-region.deleted", "txreg170-retained-history"]]);
  }, 180_000);

  it("accepts distinct top-level provinces and a province parent for a matching grandchild", async () => {
    const local = await scenario("province-parent");
    await run(local, [{ id: "txreg170-province-country", country_code: "PROVINCE170" }]);
    const parents = await run(local, [{ id: "txreg170-top-province-a", country_code: "PROVINCE170", province_code: "A", parent_id: "txreg170-province-country" },
      { id: "txreg170-top-province-b", country_code: "PROVINCE170", province_code: "B" }]);
    expect(parents).toHaveLength(2);
    const child = await run(local, [{ id: "txreg170-province-grandchild", country_code: "PROVINCE170", province_code: "C", parent_id: "txreg170-top-province-a" }]);
    expect(child[0]).toMatchObject({ country_code: "province170", province_code: "c", parent_id: "txreg170-top-province-a" });
  }, 180_000);

  it("rolls back a fresh duplicate-normalized-country batch before any rows or events commit", async () => {
    const local = await scenario("normalized-country-batch"), before = await local.snapshot();
    const failure = await observeFailure(local, [{ country_code: "DUPLICATE170" }, { country_code: "duplicate170" }]);
    if (!(failure.presented instanceof MedusaError)) throw new Error("Missing native batch uniqueness refusal");
    expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(failure.presented.message).toBe("Tax region with country_code: duplicate170, already exists.");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("independently calculates cold native Tax Lines from a freshly created US/CA graph", async () => {
    const local = await scenario("cold-calculation", taxSeed([], [taxRegion("txreg170-cold-unrelated", { country_code: "unrelated" })]));
    const roots = await run(local, [{ id: "txreg170-cold-us", country_code: "US", provider_id: "tp_system", default_tax_rate: {
      id: "txr170-cold", name: "cold", code: "cold", rate: 1.0000000596046448 } }]);
    expect(roots[0]?.id).toBe("txreg170-cold-us");
    await run(local, [{ id: "txreg170-cold-ca", country_code: "US", province_code: "CA", parent_id: "txreg170-cold-us" }]);
    const host = await local.prepareCalculation(), before = await local.snapshot();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), taxInput({ shipping_methods: [] })));
    expect(output).toEqual({ lineItemTaxLines: [{ rate_id: "txr170-cold", rate: 1.0000001, name: "cold", code: "cold",
      line_item_id: "li163-one", provider_id: "system" }], shippingMethodsTaxLines: [] });
    noTaxMutation(before, await local.snapshot());
  }, 240_000);
  it("rolls back the complete graph and outbox after a genuine late parent failure", async () => {
    const local = await scenario("late-parent"), before = await local.snapshot(), host = await local.prepareLateFailure(), create = vi.spyOn(TaxModuleService.prototype, "createTaxRegions");
    const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRegionCreationInput()));
    if (Exit.isSuccess(exit)) throw new Error("Expected genuine late parent failure");
    expect(exit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === local.lateFailure)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rejects a complete-shaped but forged native output body before committing writes or events", async () => {
    const local = await scenario("corrupt-output"), before = await local.snapshot(), original = TaxModuleService.prototype.createTaxRegions,
      descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRegions");
    if (descriptor === undefined) throw new Error("Missing native Region creation descriptor");
    let corrupted = 0;
    async function changed(this: unknown, ...args: unknown[]): Promise<unknown> {
      const returned: unknown = await Reflect.apply(original, this, args);
      const rows = Result.getOrThrow(local.contracts.decodeOutput(returned)); corrupted++;
      return rows.map(row => ({ ...row, country_code: "forged-country" }));
    }
    Object.defineProperty(TaxModuleService.prototype, "createTaxRegions", { ...descriptor, value: changed });
    try {
      const host = await local.prepare(); expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), taxRegionCreationInput())))).toBe(true);
      expect(corrupted).toBe(1); expect(await local.snapshot()).toEqual(before);
    } finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRegions", descriptor); }
  }, 180_000);

  it.each(["missing", "null"] as const)("measured native required-code %s precedes an existing explicit default Rate identity", async kind => {
    const local = await scenario("measured-required-before-id-" + kind), before = await local.snapshot();
    const failure = await observeFailure(local, [{ id: "txreg170ff-" + kind, country_code: "ff-" + kind,
      default_tax_rate: { id: "txr170-unrelated", name: kind === "null" ? "Null code" : "Missing code",
        ...(kind === "null" ? { code: null } : {}) } }]);
    // Separate unchanged native3-case PG observations establish this precedence;
    // the approved portable diagnostic keeps that original first line.
    if (!(failure.presented instanceof TaxCreationValidationError)) throw new Error("Missing measured native required-code precedence");
    expectPendingRate(failure.presented, { id: "txr170-unrelated", tax_region_id: "txreg170ff-" + kind,
      name: kind === "null" ? "Null code" : "Missing code", ...(kind === "null" ? { code: null } : {}) });
    expect(failure.presented.name).toBe("ValidationError");
    expect(failure.presented.message).toBe("Value for TaxRate.code is required, '" + (kind === "null" ? "null" : "undefined") + "' found");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("measured native country uniqueness precedes later default required-code validation", async () => {
    const local = await scenario("measured-country-before-rate-required"), before = await local.snapshot();
    const failure = await observeFailure(local, [{ id: "txreg170ff-country-duplicate", country_code: "UNRELATED" },
      { id: "txreg170ff-country-later", country_code: "ff-later", default_tax_rate: { id: "txr170ff-later", name: "Later missing code" } }]);
    if (!(failure.presented instanceof MedusaError)) throw new Error("Missing measured native country uniqueness precedence");
    expect(failure.presented.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(failure.presented.message).toBe("Tax region with country_code: unrelated, already exists.");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);


  it("measured native whole Rate group required validation precedes an earlier existing Rate ID", async () => {
    const local = await scenario("measured-rate-group-required"), before = await local.snapshot();
    const failure = await observeFailure(local, [
      { id: "txreg170-group-earlier", country_code: "GROUP-EARLIER", default_tax_rate: {
        id: "txr170-unrelated", name: "Earlier valid", code: "EARLIER-VALID" } },
      { id: "txreg170-group-later", country_code: "GROUP-LATER", default_tax_rate: {
        id: "txr170-group-later", name: "Later missing code" } },
    ]);
    expect(await local.snapshot()).toEqual(before);
    if (!(failure.presented instanceof TaxCreationValidationError)) throw new Error("Missing native model-group required precedence");
    expect(failure.presented.message).toBe("Value for TaxRate.code is required, 'undefined' found");
    expectPendingRate(failure.presented, { id: "txr170-group-later", tax_region_id: "txreg170-group-later", name: "Later missing code" });
  }, 180_000);

  it("measured native missing code precedes a supplied null name in declared-property order", async () => {
    const local = await scenario("measured-required-property-order"), before = await local.snapshot();
    const failure = await observeFailure(local, [{ id: "txreg170-two-required", country_code: "TWO-REQUIRED",
      default_tax_rate: { id: "txr170-two-required", name: null } }]);
    expect(await local.snapshot()).toEqual(before);
    if (!(failure.presented instanceof TaxCreationValidationError)) throw new Error("Missing native required-property precedence");
    expect(failure.presented.message).toBe("Value for TaxRate.code is required, 'undefined' found");
    expectPendingRate(failure.presented, { id: "txr170-two-required", tax_region_id: "txreg170-two-required", name: null });
  }, 180_000);

  it("measured native Region CHECK precedes an existing explicit Region identity", async () => {
    const local = await scenario("measured-check-before-region-id"), before = await local.snapshot();
    const failure = await observeFailure(local, [{ id: "txreg170-unrelated", country_code: "US", province_code: "CHECK-PK",
      parent_id: taxRegionCreationParent, provider_id: "tp_system" }]);
    expect(await local.snapshot()).toEqual(before);
    if (!(failure.presented instanceof TaxCreationCheckConstraintError)) throw new Error("Missing native CHECK-before-identity precedence");
    expect(failure.presented.constraint).toBe("ck_tax_region_provider_top_level");
    expect(failure.presented.message).toBe('new row for relation "tax_region" violates check constraint "ck_tax_region_provider_top_level"');
    const evidence = coreFailures(failure.exit.cause).map(inspectLogicalRelationalFailure).find(value => value?.kind === "check");
    if (evidence?.kind !== "check" || evidence.candidate === undefined) throw new Error("Missing actual storage CHECK evidence");
    expect(evidence.candidate).toMatchObject({ id: "txreg170-unrelated", country_code: "us", province_code: "check-pk",
      parent_id: taxRegionCreationParent, provider_id: "tp_system" });
  }, 180_000);
});
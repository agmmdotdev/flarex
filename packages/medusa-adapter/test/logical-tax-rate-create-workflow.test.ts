import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { taxInput, taxRate, taxRegion, taxSeed, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRateCreation, taxCreationCountry, taxCreationOtherCountry, taxRateCreationRows,
  taxRateCreationInput, maximumTaxRateCreationInput, type TaxRateCreationInput } from "./support/logical-tax-rate-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRateCreation>>, sharedCleanupCount = 0, ordinal = 0;
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
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRateCreationRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRateCreation(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-rate-create-${name}-${number}`, projectId: "tax-rate-create-164", uuidOffset: 3_400_000 + number * 10_000 } });
}
const run = async (local: Local, input: TaxRateCreationInput) => {
  const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
};

describe(`genuine native Tax Rate creation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalTaxRateCreation(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes native empty create while empty compensation skips Tax deletion", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), create = vi.spyOn(TaxModuleService.prototype, "createTaxRates"),
      remove = vi.spyOn(TaxModuleService.prototype, "deleteTaxRates");
    const host = await local.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]);
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
    expect(remove).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("returns the complete native defaults, supplied empty code and empty Rules DTO", async () => {
    const local = await scenario("defaults"), protectedRows = await local.read(), output = await run(local, taxRateCreationInput("minimal", { code: "" }));
    const row = output[0]; if (row === undefined) throw new Error("Missing complete created Rate");
    expect(row).toEqual({ id: row.id, tax_region_id: taxCreationCountry, rate: null, code: "", name: "minimal",
      is_default: false, is_combinable: false, metadata: null, created_by: null, created_at: row.created_at,
      updated_at: row.updated_at, deleted_at: null, rules: [] });
    expect(row.id).toMatch(/^txr_/); expect(new Date(row.created_at).toISOString()).toBe(row.created_at);
    const { rules: _rules, ...scalar } = row;
    expect(await local.read([row.id])).toEqual([scalar]);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 180_000);

  it("creates the complete maximum graph with native Rule association, creator overwrite, events and bounded calls", async () => {
    const local = await scenario("maximum"), input = maximumTaxRateCreationInput(), original = structuredClone(input),
      before = await local.snapshot(), protectedRows = await local.read(), host = await local.prepare(), key = host.newRequestKey();
    let calls = 0;
    const output = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(output).toHaveLength(4); expect(input).toEqual(original);
    const all = await local.read(), children: JsonObject[] = [];
    for (const [index, row] of output.entries()) {
      const parent = input[index]; if (parent === undefined) throw new Error("Missing corresponding maximum input");
      expect(row).toEqual({ id: row.id, tax_region_id: parent.tax_region_id, rate: parent.rate, code: parent.code, name: parent.name,
        is_default: false, is_combinable: index % 2 === 1, metadata: { ordinal: index }, created_by: `creator-${index}`,
        created_at: row.created_at, updated_at: row.updated_at, deleted_at: null, rules: [] });
      for (const rule of parent.rules ?? []) {
        const child = all.find(value => value.tax_rate_id === row.id && value.reference === rule.reference && value.reference_id === rule.reference_id);
        if (child === undefined) throw new Error("Missing native Rule association");
        expect(child).toEqual({ id: child.id, tax_rate_id: row.id, reference: rule.reference, reference_id: rule.reference_id,
          metadata: null, created_by: `creator-${index}`, created_at: child.created_at, updated_at: child.updated_at, deleted_at: null });
        expect(id(child)).toMatch(/^txrule_/); children.push(child);
      }
    }
    expect(children).toHaveLength(8);
    const after = await local.snapshot();
    expect(eventVector(eventsSince(before, after))).toEqual([...output.map(row => ["tax.tax-rate.created", row.id]),
      ...children.map(row => ["tax.tax-rate-rule.created", id(row)])]);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    console.info("Tax Rate creation maximum root calls", calls);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output); noTaxMutation(after, await local.snapshot());
  }, 240_000);

  it("retains actual forward compensation IDs and physically removes every Rate and Rule with only Rate delete events", async () => {
    const local = await scenario("inverse"), protectedRows = await local.read(), before = await local.snapshot(), forward = await local.prepareForward();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), maximumTaxRateCreationInput()));
    expect(created.compensation).toEqual(created.output.map(row => row.id));
    const all = await local.read(), selected = all.filter(row => created.compensation.includes(id(row)) ||
      typeof row.tax_rate_id === "string" && created.compensation.includes(row.tax_rate_id));
    expect(selected).toHaveLength(12); const committed = await local.snapshot();
    expect(eventsSince(before, committed)).toHaveLength(12);
    const inverse = await local.prepareInverse(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, created.compensation))).toBeNull();
    expect(await local.read(selected.map(id))).toEqual([]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    const deleted = await local.snapshot(), vector = eventVector(eventsSince(committed, deleted));
    expect(vector).toHaveLength(4); expect(vector.map(value => value[0])).toEqual(Array(4).fill("tax.tax-rate.deleted"));
    expect(vector.map(value => value[1]).sort()).toEqual([...created.compensation].sort());
    expect(await Effect.runPromise(inverse.run(key, created.compensation))).toBeNull(); noTaxMutation(deleted, await local.snapshot());
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
    expect(eventsSince(deleted, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("rolls back all native writes and publication after a genuine late parent failure", async () => {
    const local = await scenario("late"), host = await local.prepareLateFailure(), create = vi.spyOn(TaxModuleService.prototype, "createTaxRates"), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumTaxRateCreationInput()));
    if (Exit.isSuccess(failed)) throw new Error("Expected the genuine late parent defect to fail the root");
    expect(failed.cause.reasons.map(reason => reason._tag)).toEqual(["Die", "Fail", "Fail"]);
    const nested: Cause.Cause<unknown>[] = [];
    for (const reason of failed.cause.reasons) {
      if (reason._tag === "Die") expect(reason.defect).toBe(local.lateFailure);
      else if (reason._tag === "Fail") {
        if (!(reason.error instanceof CommerceTransactionError)) throw new Error("Unexpected late-parent typed failure");
        expect(reason.error.reason).toBe("rollbackOnly");
        if (reason.error.cause !== undefined) {
          if (!Cause.isCause(reason.error.cause)) throw new Error("Expected the original complete rollback-only Cause");
          nested.push(reason.error.cause);
        }
      } else throw new Error("Unexpected interruption in the late-parent failure");
    }
    expect(nested).toHaveLength(1);
    for (const cause of nested) {
      expect(cause.reasons.map(reason => reason._tag)).toEqual(["Die"]);
      for (const reason of cause.reasons) if (reason._tag === "Die") expect(reason.defect).toBe(local.lateFailure);
    }
    expect(create).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("candidate inverse preserves measured native storage order with supplied IDs and reversed retained selectors", async () => {
    const local = await scenario("inverse-order"), before = await local.snapshot(), forward = await local.prepareForward();
    const input = Schema.decodeUnknownSync(local.contracts.Input)([
      { id: "txr164-z-first", tax_region_id: taxCreationCountry, name: "first", code: "first" },
      { id: "txr164-a-second", tax_region_id: taxCreationCountry, name: "second", code: "second" },
    ]);
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), input));
    expect(created.compensation).toEqual(["txr164-z-first", "txr164-a-second"]);
    const committed = await local.snapshot();
    expect(eventVector(eventsSince(before, committed))).toEqual([
      ["tax.tax-rate.created", "txr164-z-first"], ["tax.tax-rate.created", "txr164-a-second"],
    ]);
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...created.compensation].reverse()))).toBeNull();
    expect(eventVector(eventsSince(committed, await local.snapshot()))).toEqual([
      ["tax.tax-rate.deleted", "txr164-z-first"], ["tax.tax-rate.deleted", "txr164-a-second"],
    ]);
  }, 240_000);

  it.each([[0.1, 0.1], [1.00000006, 1.0000001], [1.0000000596046448, 1.0000001],
    [16777217, 16777216], [1e-45, 1e-45], [3.4028235e38, 3.4028235e38], [null, null], [0, 0]] as const)
    ("retains native immediate REAL %s separately from canonical storage %s", async (value, stored) => {
      const local = await scenario("numeric-" + value), output = await run(local, taxRateCreationInput("numeric", { rate: value }));
      const row = output[0]; if (row === undefined) throw new Error("Missing native numeric result");
      expect(row.rate).toBe(value);
      const { rules: _rules, ...scalar } = row;
      expect(await local.read([row.id])).toEqual([{ ...scalar, rate: stored }]);
    }, 180_000);

  it("preserves native caller-managed identities/timestamps, Rule metadata and parent creator overwrite", async () => {
    const local = await scenario("managed"), stamp = "2020-01-02T03:04:05.000Z";
    const input = taxRateCreationInput("managed", { id: "txr164-supplied", created_at: stamp, updated_at: stamp, deleted_at: null,
      metadata: { nested: { retained: true } }, created_by: "parent-creator", is_combinable: true,
      rules: [{ id: "txrule164-supplied", reference: "product", reference_id: "prod-one", created_at: stamp, updated_at: stamp,
        deleted_at: null, created_by: "ignored-child-creator", metadata: { nested: { child: true } } }] });
    const original = structuredClone(input), output = await run(local, input);
    expect(input).toEqual(original);
    expect(output).toEqual([{ id: "txr164-supplied", tax_region_id: taxCreationCountry, name: "managed", code: "managed", rate: null,
      is_default: false, is_combinable: true, metadata: { nested: { retained: true } }, created_by: "parent-creator",
      created_at: stamp, updated_at: stamp, deleted_at: null, rules: [] }]);
    expect(await local.read(["txrule164-supplied"])).toEqual([{ id: "txrule164-supplied", tax_rate_id: "txr164-supplied",
      reference: "product", reference_id: "prod-one", metadata: { nested: { child: true } }, created_by: "parent-creator",
      created_at: stamp, updated_at: stamp, deleted_at: null }]);
  }, 180_000);

  it("retains aliased Rate positions, REAL presentation and raw-position nested Rules with canonical creators", async () => {
    const local = await scenario("identity-alias"), before = await local.snapshot();
    const input = Schema.decodeUnknownSync(local.contracts.Input)([
      { id: "txr164-alias", tax_region_id: taxCreationCountry, name: "first", code: "first", rate: null, created_by: null,
        rules: [{ id: "txrule164-alias", reference: "product", reference_id: "first", metadata: null }] },
      { id: "txr164-alias", tax_region_id: "ignored-missing-region", name: "ignored", code: "ignored", rate: 0.1, created_by: "later", metadata: { filled: true },
        rules: [{ id: "txrule164-alias", reference: "ignored", reference_id: "ignored", metadata: { child: true } },
          { reference: "product", reference_id: "second" }] },
    ]);
    const original = structuredClone(input), output = await run(local, input);
    expect(input).toEqual(original); expect(output).toHaveLength(2); expect(output[1]).toEqual(output[0]);
    expect(output[0]).toMatchObject({ id: "txr164-alias", tax_region_id: taxCreationCountry, name: "first", rate: 0.1,
      created_by: "later", metadata: { filled: true }, rules: [] });
    const writtenRules = (await local.read()).filter(row => row.tax_rate_id === "txr164-alias");
    expect(writtenRules).toHaveLength(2);
    expect(writtenRules.find(row => row.id === "txrule164-alias")).toMatchObject({ reference: "product", reference_id: "first", metadata: { child: true }, created_by: "later" });
    expect(writtenRules.every(row => row.created_by === "later")).toBe(true);
    expect(eventVector(eventsSince(before, await local.snapshot())).map(row => row[0])).toEqual([
      "tax.tax-rate.created", "tax.tax-rate-rule.created", "tax.tax-rate-rule.created",
    ]);
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.map(row => row.id)));
    expect((await local.read()).some(row => row.id === "txr164-alias" || row.tax_rate_id === "txr164-alias")).toBe(false);
  }, 240_000);

  it.each(["duplicate-default", "duplicate-rule", "different-reference-same-id", "missing-region", "later-missing-region", "underflow", "overflow"] as const)
    ("keeps native %s refusal atomic across all durable families", async branch => {
      const local = await scenario(branch), first = { tax_region_id: taxCreationCountry, name: branch, code: branch };
      const input = Schema.decodeUnknownSync(local.contracts.Input)(branch === "duplicate-default" ? [{ ...first, is_default: true }, { ...first, is_default: true }]
        : branch === "duplicate-rule" || branch === "different-reference-same-id" ? [{ ...first, rules: [
          { reference: "product", reference_id: "same" }, { reference: branch === "duplicate-rule" ? "product" : "product_type", reference_id: "same" }] }]
        : branch === "missing-region" ? [{ ...first, tax_region_id: "txreg164-missing" }]
        : branch === "later-missing-region" ? [first, { ...first, tax_region_id: "txreg164-missing" }]
        : [{ ...first, rate: branch === "underflow" ? 1e-46 : 3.5e38 }]);
      const host = await local.prepare(), before = await local.snapshot(), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), input));
      expect(Exit.isFailure(failed)).toBe(true); expect(await local.snapshot()).toEqual(before);
    }, 180_000);

  it("preserves active-default exclusion and permits historical defaults and deleted Region references", async () => {
    const stamp = "2026-10-22T00:00:00.000Z";
    for (const deleted of [false, true]) {
      const seed = taxSeed([taxRate("txr164-existing", { tax_region_id: taxCreationCountry, deleted_at: deleted ? stamp : null })],
        [taxRegion(taxCreationCountry), taxRegion(taxCreationOtherCountry, { country_code: "ca" })]);
      const local = await scenario("existing-default-" + deleted, seed), host = await local.prepare(), before = await local.snapshot();
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), taxRateCreationInput("new-default", { is_default: true })));
      expect(Exit.isSuccess(result)).toBe(deleted);
      if (!deleted) expect(await local.snapshot()).toEqual(before);
    }
    const local = await scenario("deleted-region", taxSeed([], [taxRegion(taxCreationCountry, { deleted_at: stamp })]));
    const protectedRows = await local.read(), output = await run(local, taxRateCreationInput("deleted-region"));
    expect(output).toHaveLength(1); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 240_000);

  it("independently calculates cold native Tax lines from the committed canonical Rate", async () => {
    const local = await scenario("cold-calculation"), output = await run(local, taxRateCreationInput("cold", { rate: 1.0000000596046448, is_default: true }));
    const row = output[0]; if (row === undefined) throw new Error("Missing committed Tax Rate");
    const host = await local.prepareCalculation(), before = await local.snapshot();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), taxInput({ shipping_methods: [] })));
    expect(result).toEqual({ lineItemTaxLines: [{ rate_id: row.id, rate: 1.0000001, name: "cold", code: "cold",
      line_item_id: "li163-one", provider_id: "system" }], shippingMethodsTaxLines: [] });
    noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it("refuses a corrupted native immediate DTO after SQL conversion without committing its writes", async () => {
    const local = await scenario("corrupted-output"), host = await local.prepare(), before = await local.snapshot();
    const original = TaxModuleService.prototype.createTaxRates;
    const descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRates");
    if (descriptor === undefined) throw new Error("Missing native creation method descriptor");
    let corruptedCalls = 0;
    // The native declaration describes Date fields while serialization returns
    // strings. Keep this deliberate foreign-result corruption at an unknown
    // boundary and validate the actual complete DTO before changing its rate.
    async function corrupted(this: unknown, ...args: unknown[]): Promise<unknown> {
      const returned: unknown = await Reflect.apply(original, this, args);
      const rows = Result.getOrThrow(local.contracts.decodeOutput(Array.isArray(args[0]) ? returned : [returned]))
        .map(row => ({ ...row, rules: [...row.rules], rate: 99 }));
      corruptedCalls++;
      if (Array.isArray(args[0])) return rows;
      const row = rows[0]; if (row === undefined) throw new Error("Missing native scalar Tax creation result");
      return row;
    }
    Object.defineProperty(TaxModuleService.prototype, "createTaxRates", { ...descriptor, value: corrupted });
    try {
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), taxRateCreationInput("corrupted", { rate: 16777217 }))))).toBe(true);
      expect(corruptedCalls).toBe(1);
      expect(await local.snapshot()).toEqual(before);
    } finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRates", descriptor); }
  }, 180_000);
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { taxInput, taxRate, taxRegion, taxRule, taxSeed, type TaxInitialRow } from "./support/logical-item-tax-lines-fixture";
import { prepareLogicalTaxRuleCreation, taxRuleRegion, taxRuleParents, taxRuleCreationRows,
  taxRuleCreationInput, maximumTaxRuleCreationInput, type TaxRuleCreationInput } from "./support/logical-tax-rule-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalTaxRuleCreation>>, sharedCleanupCount = 0, ordinal = 0;
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
async function scenario(name: string, rows: readonly TaxInitialRow[] = taxRuleCreationRows()) {
  const number = ++ordinal;
  return prepareLogicalTaxRuleCreation(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `tax-rule-create-${name}-${number}`, projectId: "tax-rule-create-165", uuidOffset: 3_800_000 + number * 10_000 } });
}
const run = async (local: Local, rules: TaxRuleCreationInput) => {
  const host = await local.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), { rules }));
};

describe(`genuine native standalone Tax Rule creation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalTaxRuleCreation(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes native empty create while empty compensation skips Tax deletion", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"),
      remove = vi.spyOn(TaxModuleService.prototype, "deleteTaxRateRules");
    const host = await local.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { rules: [] }))).toEqual([]);
    expect(await Effect.runPromise(host.run(key, { rules: [] }))).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]);
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
    expect(remove).not.toHaveBeenCalled(); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("returns complete native Rule defaults without a parent relation or creator inheritance", async () => {
    const local = await scenario("defaults"), protectedRows = await local.read(), output = await run(local, taxRuleCreationInput(""));
    const row = output[0]; if (row === undefined) throw new Error("Missing created Rule");
    expect(row).toEqual({ id: row.id, tax_rate_id: taxRuleParents[0], reference: "product", reference_id: "",
      metadata: null, created_by: null, created_at: row.created_at, updated_at: row.updated_at, deleted_at: null });
    expect(row.id).toMatch(/^txrule_/); expect(new Date(row.created_at).toISOString()).toBe(row.created_at);
    expect(await local.read([row.id])).toEqual([row]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 180_000);

  it("creates the complete maximum with native standalone creators, ordered events and bounded calls", async () => {
    const local = await scenario("maximum"), rules = maximumTaxRuleCreationInput(), original = structuredClone(rules),
      before = await local.snapshot(), protectedRows = await local.read(), host = await local.prepare(), key = host.newRequestKey();
    let calls = 0;
    const output = await Effect.runPromise(host.run(key, { rules }).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })));
    expect(output).toHaveLength(8); expect(rules).toEqual(original);
    for (const [index, row] of output.entries()) {
      const input = rules[index]; if (input === undefined) throw new Error("Missing corresponding maximum input");
      expect(row).toEqual({ ...input, id: row.id, created_at: row.created_at, updated_at: row.updated_at, deleted_at: null });
      expect(row.id).toMatch(/^txrule_/);
    }
    expect(await local.read(output.map(row => row.id))).toEqual([...output].sort((left, right) => left.id.localeCompare(right.id)));
    const after = await local.snapshot();
    expect(eventVector(eventsSince(before, after))).toEqual(output.map(row => ["tax.tax-rate-rule.created", row.id]));
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    console.info("Tax Rule creation maximum root calls", calls);
    expect(await Effect.runPromise(host.run(key, { rules }))).toEqual(output); noTaxMutation(after, await local.snapshot());
  }, 240_000);

  it("retains actual compensation IDs and physically removes Rules while preserving all parent rows", async () => {
    const local = await scenario("inverse"), protectedRows = await local.read(), forward = await local.prepareForward();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), maximumTaxRuleCreationInput()));
    expect(created.compensation).toEqual(created.output.map(row => row.id));
    expect(await local.read(created.compensation)).toHaveLength(8);
    const committed = await local.snapshot(), inverse = await local.prepareInverse(), key = inverse.newRequestKey();
    let calls = 0;
    expect(await Effect.runPromise(inverse.run(key, created.compensation).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => { if (name === "BoundedRequest.enter") calls++; return work; },
    })))).toBeNull();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    console.info("Tax Rule retained inverse maximum root calls", calls);
    expect(await local.read(created.compensation)).toEqual([]); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
    const deleted = await local.snapshot();
    expect(eventVector(eventsSince(committed, deleted))).toEqual(created.compensation.map(value => ["tax.tax-rate-rule.deleted", value]));
    expect(await Effect.runPromise(inverse.run(key, created.compensation))).toBeNull(); noTaxMutation(deleted, await local.snapshot());
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
    expect(eventsSince(deleted, await local.snapshot())).toEqual([]);
  }, 240_000);

  it("prepared candidate inverse preserves creation order for reversed IDs and retained selectors", async () => {
    const local = await scenario("inverse-order"), forward = await local.prepareForward();
    const rules = Schema.decodeUnknownSync(local.contracts.Input)([
      { id: "txrule165-z-first", tax_rate_id: taxRuleParents[0], reference: "product", reference_id: "first" },
      { id: "txrule165-a-second", tax_rate_id: taxRuleParents[0], reference: "product", reference_id: "second" },
    ]);
    const before = await local.snapshot(), created = await Effect.runPromise(forward.run(forward.newRequestKey(), rules)), committed = await local.snapshot();
    expect(created.compensation).toEqual(["txrule165-z-first", "txrule165-a-second"]);
    expect(eventVector(eventsSince(before, committed))).toEqual(created.compensation.map(value => ["tax.tax-rate-rule.created", value]));
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...created.compensation].reverse()))).toBeNull();
    expect(eventVector(eventsSince(committed, await local.snapshot()))).toEqual(created.compensation.map(value => ["tax.tax-rate-rule.deleted", value]));
  }, 240_000);

  it("preserves later unrelated Rules and skips a missing retained row", async () => {
    const local = await scenario("missing-inverse"), protectedRows = await local.read(), forward = await local.prepareForward();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), maximumTaxRuleCreationInput()));
    const later = await run(local, taxRuleCreationInput("later-unrelated")), inverse = await local.prepareInverse();
    const first = created.compensation[0]; if (first === undefined) throw new Error("Missing retained Rule identity");
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), [first]));
    const before = await local.snapshot();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual(created.compensation.slice(1).map(value => ["tax.tax-rate-rule.deleted", value]));
    expect(await local.read(created.compensation)).toEqual([]); expect(await local.read(later.map(row => row.id))).toEqual(later);
    expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 240_000);

  it("rolls back native writes and publication with the complete late parent defect Cause", async () => {
    const local = await scenario("late"), host = await local.prepareLateFailure(), create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { rules: maximumTaxRuleCreationInput() }));
    if (Exit.isSuccess(failed)) throw new Error("Expected the genuine late parent defect");
    // Failed completion retains the defect without a second checkpoint refusal.
    expect(failed.cause.reasons.map(reason => reason._tag)).toEqual(["Die", "Fail"]);
    const [defect, refusal] = failed.cause.reasons;
    if (defect === undefined || !Cause.isDieReason(defect) || refusal === undefined || !Cause.isFailReason(refusal))
      throw new Error("Missing exact late-parent completion reasons");
    expect(defect.defect).toBe(local.lateFailure);
    if (!(refusal.error instanceof CommerceTransactionError)) throw new Error("Unexpected late-parent refusal type");
    expect(refusal.error.reason).toBe("rollbackOnly");
    expect(refusal.error.cause).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("preserves caller IDs/timestamps, standalone creator and general JSON metadata", async () => {
    const local = await scenario("managed"), stamp = "2020-01-02T03:04:05.000Z";
    const rules = Schema.decodeUnknownSync(local.contracts.Input)([null, ["a", { nested: true }], "metadata", 7, false].map((metadata, index) => ({
      id: `txrule165-managed-${index}`, tax_rate_id: taxRuleParents[0], reference: index ? "product" : "", reference_id: `managed-${index}`,
      metadata, created_by: index ? "rule-creator" : "", created_at: stamp, updated_at: stamp, deleted_at: index === 4 ? stamp : null,
    })));
    const original = structuredClone(rules), output = await run(local, rules);
    expect(rules).toEqual(original); expect(output).toEqual(rules);
    expect(await local.read(output.map(row => row.id))).toEqual([...output].sort((left, right) => left.id.localeCompare(right.id)));
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.map(row => row.id)));
    expect(await local.read(output.map(row => row.id))).toEqual([]);
  }, 240_000);

  it("preserves native repeated supplied IDs as final positional aliases with one write/event and retained inverse", async () => {
    const local = await scenario("identity-alias"), before = await local.snapshot();
    const rules = Schema.decodeUnknownSync(local.contracts.Input)([
      { id: "txrule165-alias", tax_rate_id: taxRuleParents[0], reference: "product", reference_id: "first", metadata: null, created_by: null },
      { id: "txrule165-alias-b", tax_rate_id: taxRuleParents[1], reference: "product", reference_id: "second" },
      { id: "txrule165-alias", tax_rate_id: "ignored-missing-parent", reference: "ignored", reference_id: "ignored", metadata: { filled: true }, created_by: "later" },
    ]);
    const original = structuredClone(rules), forward = await local.prepareForward();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), rules)), output = created.output;
    expect(created.compensation).toEqual(["txrule165-alias", "txrule165-alias-b", "txrule165-alias"]);
    expect(rules).toEqual(original); expect(output.map(row => row.id)).toEqual(["txrule165-alias", "txrule165-alias-b", "txrule165-alias"]);
    expect(output[2]).toEqual(output[0]); expect(output[0]).toMatchObject({ tax_rate_id: taxRuleParents[0], reference_id: "first", metadata: { filled: true }, created_by: "later" });
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([
      ["tax.tax-rate-rule.created", "txrule165-alias"], ["tax.tax-rate-rule.created", "txrule165-alias-b"],
    ]);
    expect(await local.read(output.map(row => row.id))).toHaveLength(2);
    const inverse = await local.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation));
    expect(await local.read(output.map(row => row.id))).toEqual([]);
  }, 240_000);

  it.each(["duplicate-rule", "different-reference-same-id", "missing-parent", "later-missing-parent"] as const)
    ("keeps native %s refusal atomic across all durable families", async branch => {
      const local = await scenario(branch), base = { tax_rate_id: taxRuleParents[0], reference: "product", reference_id: "same" };
      const rules = Schema.decodeUnknownSync(local.contracts.Input)(branch === "missing-parent" ? [{ ...base, tax_rate_id: "txr165-missing" }]
        : branch === "later-missing-parent" ? [base, { ...base, tax_rate_id: "txr165-missing" }]
        : [base, { ...base, reference: branch === "duplicate-rule" ? "product" : "product_type" }]);
      const host = await local.prepare(), before = await local.snapshot();
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { rules })))).toBe(true);
      expect(await local.snapshot()).toEqual(before);
    }, 180_000);

  it("permits cross-parent reference reuse, historical uniqueness reuse and deleted Rate references", async () => {
    const stamp = "2026-10-22T00:00:00.000Z", parent = taxRuleParents[0];
    if (parent === undefined) throw new Error("Missing fixture parent");
    const rows = [...taxRuleCreationRows().map(value => value.table === "tax_rate" && value.row.id === parent
      ? { ...value, row: { ...value.row, deleted_at: stamp } } : value),
    taxRule("txrule165-historical", parent, "product", "reuse", { deleted_at: stamp })];
    const local = await scenario("historical", rows), protectedRows = await local.read();
    const output = await run(local, Schema.decodeUnknownSync(local.contracts.Input)([
      { tax_rate_id: parent, reference: "product", reference_id: "reuse" },
      { tax_rate_id: taxRuleParents[1], reference: "product_type", reference_id: "reuse" },
    ]));
    expect(output).toHaveLength(2); expect(await local.read(protectedRows.map(id))).toEqual(protectedRows);
  }, 240_000);

  it("rejects an existing active Rule key even under a different reference name", async () => {
    const parent = taxRuleParents[0]; if (parent === undefined) throw new Error("Missing fixture parent");
    const local = await scenario("existing-active", [...taxRuleCreationRows(), taxRule("txrule165-existing", parent, "product", "same")]);
    const before = await local.snapshot(), host = await local.prepare();
    const rules = Schema.decodeUnknownSync(local.contracts.Input)([{ tax_rate_id: parent, reference: "product_type", reference_id: "same" }]);
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { rules })))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("independently consumes committed Rules through genuine native item Tax calculation", async () => {
    const parent = "txr165-cold", local = await scenario("cold", taxSeed([
      taxRate(parent, { tax_region_id: taxRuleRegion, is_default: false, rate: 7, name: "Cold Rule", code: "RULE165_COLD" }),
    ], [taxRegion(taxRuleRegion)]));
    await run(local, Schema.decodeUnknownSync(local.contracts.Input)([{ tax_rate_id: parent, reference: "product", reference_id: "prod163-one" }]));
    const host = await local.prepareCalculation(), before = await local.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), taxInput({ shipping_methods: [] })))).toEqual({
      lineItemTaxLines: [{ rate_id: parent, rate: 7, name: "Cold Rule", code: "RULE165_COLD", line_item_id: "li163-one", provider_id: "system" }],
      shippingMethodsTaxLines: [],
    });
    noTaxMutation(before, await local.snapshot());
  }, 240_000);

  it("rejects conflicting trusted request-key replay without a second native call", async () => {
    const local = await scenario("replay-conflict"), host = await local.prepare(), key = host.newRequestKey(),
      create = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules"), rules = taxRuleCreationInput("original");
    await Effect.runPromise(host.run(key, { rules })); const before = await local.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, { rules: taxRuleCreationInput("changed") })))).toBe(true);
    expect(create).toHaveBeenCalledTimes(1); noTaxMutation(before, await local.snapshot());
  }, 180_000);

  it("refuses a corrupted complete native DTO without committing the actual SQL writes", async () => {
    const local = await scenario("corrupted-output"), host = await local.prepare(), before = await local.snapshot();
    const original = TaxModuleService.prototype.createTaxRateRules, descriptor = Object.getOwnPropertyDescriptor(TaxModuleService.prototype, "createTaxRateRules");
    if (descriptor === undefined) throw new Error("Missing native Rule creation descriptor");
    let corruptedCalls = 0;
    async function corrupted(this: unknown, ...args: unknown[]): Promise<unknown> {
      const returned: unknown = await Reflect.apply(original, this, args);
      const rows = Result.getOrThrow(local.contracts.decodeOutput(Array.isArray(args[0]) ? returned : [returned]))
        .map(row => ({ ...row, reference_id: "corrupted" }));
      corruptedCalls++;
      if (Array.isArray(args[0])) return rows;
      const row = rows[0]; if (row === undefined) throw new Error("Missing native scalar Rule result"); return row;
    }
    Object.defineProperty(TaxModuleService.prototype, "createTaxRateRules", { ...descriptor, value: corrupted });
    try {
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), { rules: taxRuleCreationInput("original") })))).toBe(true);
      expect(corruptedCalls).toBe(1); expect(await local.snapshot()).toEqual(before);
    } finally { Object.defineProperty(TaxModuleService.prototype, "createTaxRateRules", descriptor); }
  }, 180_000);
});

import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceRelationReadQuery } from "../src/query/relations";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePricePreferenceContracts } from "../src/modules/pricing/preference-input";
import { pricingPreferencePolicy } from "../src/modules/pricing/preference-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Contracts = Result.Result.Success<ReturnType<typeof compilePricePreferenceContracts>>;
let contracts: Contracts;
let policy: ReturnType<typeof pricingPreferencePolicy>;
const stamp = "2026-10-20T01:00:00.000Z", changed = "2026-10-20T02:00:00.000Z";
const row = (id: string, fields: JsonObject = {}): JsonObject => ({ id, attribute: "Raw-CaFÉ", value: null,
  is_tax_inclusive: false, created_at: stamp, updated_at: stamp, deleted_at: null, ...fields });
const read = (selector: JsonObject, ids: readonly string[]): Activity["relationalReads"][number] => ({ table: "price_preference",
  query: commerceRelationReadQuery(defaultCommerceResources, Result.getOrThrow(contracts.updatePredicate(selector)), "id", { includeIdentities: true }),
  total: ids.length, returned: ids.length, orderedIdentities: ids.map(id => ({ id })) });
const activity = (observed: readonly JsonObject[], reads: Activity["relationalReads"], mutations: Activity["mutations"] = []): Activity => ({
  mutations, observedRows: observed.map(value => ({ table: "price_preference", row: value })), relationalReads: reads,
  lifecycle: [], setNull: [], referenceReplacements: [],
});
const receipt = (name: string, input: Json, result: Json, evidence: Activity, events: Json[] = []): Receipt => ({
  commandName: name, mode: name === "pricingPreferenceUpdateList" ? "read" : "write", input, result, events,
  fromAttempt: 0, toAttempt: evidence.mutations.length, fromLifecycle: 0, toLifecycle: 0,
});
const event = (id: string | string[]): Json => ({ name: "pricing.price-preference.updated",
  metadata: { source: "pricing", object: "price_preference", action: "updated" }, data: { id } });
const patch = (before: JsonObject, after: JsonObject, ordinal = 0): Activity["mutations"][number] => ({
  ordinal, table: "price_preference", operation: "patch", before, after,
});
const refused = async (call: Receipt, evidence: Activity) => {
  const result = await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, evidence)));
  expect(Result.isFailure(result)).toBe(true);
};

beforeAll(async () => {
  contracts = Result.getOrThrow(compilePricePreferenceContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingPreferencePolicy(contracts);
});

describe("native Price Preference update receipts", () => {
  it("binds the complete executed text query and sparse native preimages", async () => {
    // PostgreSQL membership is authenticated by the actual core query evidence;
    // this unit exercises receipt integrity, not another predicate evaluator.
    const selector = { $or: [{ attribute: { $re: "^Raw-.*$" } }, { value: { $fulltext: "fox" } }] };
    const a = row("a"), z = row("z", { value: "fox", is_tax_inclusive: true });
    const candidates = [z, a, row("unselected"), row("history", { deleted_at: stamp }), row("protected")];
    const evidence = activity(candidates, [read(selector, ["a", "z"])]);
    const call = receipt("pricingPreferenceUpdateList", { filters: selector, config: { select: ["is_tax_inclusive"], relations: [] } },
      [{ id: "a", is_tax_inclusive: false }, { id: "z", is_tax_inclusive: true }], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, input: { filters: { attribute: "other" }, config: { select: ["is_tax_inclusive"] } } }, evidence);
    await refused(call, { ...evidence, relationalReads: [] });
    await refused(call, { ...evidence, relationalReads: [read(selector, ["a"])] });
    await refused(call, { ...evidence, relationalReads: [...evidence.relationalReads, read(selector, ["a", "z"])] });
    await refused(call, { ...evidence, relationalReads: [read(selector, ["a", "a"])] });
    await refused(call, { ...evidence, relationalReads: [read(selector, ["a", "missing"])] });
    await refused(call, { ...evidence, relationalReads: [read(selector, ["z", "a"])] });
    await refused(call, { ...evidence, relationalReads: [{ table: "price_preference", query: read(selector, ["a", "z"]).query, total: 2, returned: 2 }] });
    await refused(call, { ...evidence, relationalReads: [{ ...read(selector, ["a", "z"]), total: 3 }] });
    await refused({ ...call, result: [{ id: "a", is_tax_inclusive: false, value: null }, { id: "z", is_tax_inclusive: true }] }, evidence);
    await refused({ ...call, result: [{ id: "z", is_tax_inclusive: true }, { id: "a", is_tax_inclusive: false }] }, evidence);
    await refused(call, activity([a, { ...z, deleted_at: stamp }], [read(selector, ["a", "z"])]));
  });

  it("requires ID-only empty-update preimages and real reads even for zero matches", async () => {
    const existing = row("p"), selector = { value: { $exists: false } };
    const evidence = activity([existing], [read(selector, ["p"])]);
    const call = receipt("pricingPreferenceUpdateList", { filters: selector, config: { select: [], relations: [] } }, [{ id: "p" }], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [{}] }, evidence);
    await refused({ ...call, result: [existing] }, evidence);
    const empty = activity([row("unselected")], [read(selector, [])]), emptyCall = receipt("pricingPreferenceUpdateList",
      { filters: selector, config: { select: [], relations: [] } }, [], empty);
    await Effect.runPromise(policy.validateLogicalCall(emptyCall, empty));
    await refused(emptyCall, { ...empty, relationalReads: [] });
  });

  it("binds native nested-empty selectors to the executed query and actual selected identities", async () => {
    // The separate unchanged native witness selects only a. Core owns the
    // executed membership; candidate observations do not widen that selection.
    const selector = { $or: [{}, { id: "a" }] };
    const a = row("a"), z = row("z"), historical = row("history", { deleted_at: stamp });
    const evidence = activity([a, z, historical], [read(selector, ["a"])]);
    const list = receipt("pricingPreferenceUpdateList", { filters: selector, config: { select: [], relations: [] } }, [{ id: "a" }], evidence);
    await Effect.runPromise(policy.validateLogicalCall(list, evidence));
    await refused(list, { ...evidence, relationalReads: [read({}, ["a"])] });
    await refused({ ...list, result: [{ id: "a" }, { id: "z" }] }, evidence);

    const after = { ...a, is_tax_inclusive: true, updated_at: changed };
    const updateEvidence = activity([after, z, historical], [read(selector, ["a"]), read({ $or: [{ id: "a" }] }, ["a"])], [patch(a, after)]);
    const update = receipt("pricingPreferenceUpdate", { selector, update: { is_tax_inclusive: true } }, [after], updateEvidence, [event("a")]);
    await Effect.runPromise(policy.validateLogicalCall(update, updateEvidence));
    await refused(update, { ...updateEvidence, relationalReads: [read(selector, ["a"]), read({ $or: [{ id: "z" }] }, ["z"])] });
    await refused(update, { ...updateEvidence, mutations: [patch(z, { ...z, is_tax_inclusive: true, updated_at: changed })] });
    await refused({ ...update, result: [after, z] }, updateEvidence);
  });

  it("returns mixed unchanged and dirty rows while authenticating only actual patches and events", async () => {
    const a = row("a", { is_tax_inclusive: true }), z = row("z"), after = { ...z, is_tax_inclusive: true, updated_at: changed };
    const selector = { attribute: { $ilike: "Raw-%" } }, ids = { $or: [{ id: "a" }, { id: "z" }] };
    const evidence = activity([a, after], [read(selector, ["a", "z"]), read(ids, ["a", "z"])], [patch(z, after)]);
    const call = receipt("pricingPreferenceUpdate", { selector, update: { is_tax_inclusive: true } }, [a, after], evidence, [event("z")]);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [after] }, evidence);
    await refused({ ...call, events: [event(["a", "z"])] }, evidence);
    await refused({ ...call, events: [] }, evidence);
    await refused(call, { ...evidence, relationalReads: [read(selector, ["a", "z"]), read({ $or: [{ id: "z" }] }, ["z"])] });
    await refused(call, { ...evidence, mutations: [patch(z, { ...after, value: "unrequested" })] });
    await refused(call, { ...evidence, mutations: [patch(z, { ...after, created_at: changed })] });
    await refused(call, { ...evidence, mutations: [patch(z, after, 1)] });
    const superset = { ...evidence, observedRows: [...evidence.observedRows, { table: "price_preference", row: row("protected") }] };
    await Effect.runPromise(policy.validateLogicalCall(call, superset));
    await refused(call, { ...superset, mutations: [patch(row("protected"), { ...row("protected"), is_tax_inclusive: true, updated_at: changed })] });
  });

  it("admits empty and same-valued updates without advancing timestamps or emitting events", async () => {
    const before = row("p"), selector = { id: "p" }, ids = { $or: [{ id: "p" }] };
    const evidence = activity([before], [read(selector, ["p"]), read(ids, ["p"])]);
    const updates: JsonObject[] = [{}, { value: null }, { is_tax_inclusive: false }, { attribute: "Raw-CaFÉ" }];
    for (const update of updates) {
      const call = receipt("pricingPreferenceUpdate", { selector, update }, [before], evidence);
      await Effect.runPromise(policy.validateLogicalCall(call, evidence));
      await refused({ ...call, events: [event("p")] }, evidence);
      await refused({ ...call, result: [{ ...before, updated_at: changed }] }, evidence);
      await refused(call, { ...evidence, mutations: [patch(before, { ...before, updated_at: changed })] });
    }
    const empty = activity([row("candidate")], [read(selector, [])]);
    await Effect.runPromise(policy.validateLogicalCall(receipt("pricingPreferenceUpdate", { selector, update: {} }, [], empty), empty));
  });

  it("shares native equal-value dirty detection with the existing Store upsert owner", async () => {
    const before = row("p", { attribute: "currency_code", value: "USD" });
    const evidence = activity([before], []);
    const call = receipt("pricingStorePreferenceUpsert", [{ id: "p", value: "USD", is_tax_inclusive: false }], [before], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, events: [event("p")] }, evidence);
    await refused({ ...call, result: [{ ...before, updated_at: changed }] }, evidence);
    await refused(call, { ...evidence, mutations: [patch(before, { ...before, updated_at: changed })] });
  });

  it("authenticates sparse inverse upserts, last repeated-ID assignment and ascending results", async () => {
    const a = row("a", { is_tax_inclusive: true }), z = row("z", { value: "changed" });
    const after = { ...a, is_tax_inclusive: false, updated_at: changed };
    const input = [{ id: "a", is_tax_inclusive: true }, { id: "z" }, { id: "a", is_tax_inclusive: false }];
    const ids = { $or: input.map(value => ({ id: value.id })) };
    const evidence = activity([z, after], [read(ids, ["a", "z"])], [patch(a, after)]);
    const call = receipt("pricingPreferenceUpdateUpsert", input, [after, z], evidence, [event("a")]);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [z, after] }, evidence);
    await refused({ ...call, input: [{ id: "a", updated_at: stamp }] }, evidence);
    await refused({ ...call, input: [{ id: "a", attribute: "Raw-CaFÉ" }] }, evidence);
    await refused(call, { ...evidence, mutations: [patch(a, { ...after, value: null })], relationalReads: [] });
    const idOnly = activity([z], [read({ $or: [{ id: "z" }] }, ["z"])]);
    await Effect.runPromise(policy.validateLogicalCall(receipt("pricingPreferenceUpdateUpsert", [{ id: "z" }], [z], idOnly), idOnly));
    const empty = activity([], []);
    await Effect.runPromise(policy.validateLogicalCall(receipt("pricingPreferenceUpdateUpsert", [], [], empty), empty));
  });

  it("refuses effects outside the preference patch closure and corrupt complete outputs", async () => {
    const before = row("p"), after = { ...before, value: "", updated_at: changed }, selector = { id: "p" };
    const evidence = activity([after], [read(selector, ["p"]), read({ $or: [{ id: "p" }] }, ["p"])], [patch(before, after)]);
    const call = receipt("pricingPreferenceUpdate", { selector, update: { value: "" } }, [after], evidence, [event("p")]);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, commandName: "pricingUnrelatedUpdate" }, evidence);
    await refused({ ...call, mode: "read" }, evidence);
    await refused(call, { ...evidence, mutations: [{ ...patch(before, after), table: "price_set" }] });
    await refused(call, { ...evidence, mutations: [{ ...patch(before, after), operation: "insert", before: null }] });
    await refused(call, { ...evidence, mutations: [{ ...patch(before, after), operation: "delete", after: null }] });
    await refused(call, { ...evidence, observedRows: [{ table: "price_set", row: after }] });
    await refused(call, { ...evidence, observedRows: [] });
    await refused({ ...call, result: [{ ...after, extra: true }] }, evidence);
    await refused({ ...call, result: [{ id: "p", value: "" }] }, evidence);
    await refused({ ...call, events: [event(["p", "p"])] }, evidence);
  });
});

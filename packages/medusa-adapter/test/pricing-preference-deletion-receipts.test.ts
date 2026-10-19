import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePricePreferenceContracts, decodePricePreferenceDeletionArguments,
  decodePricePreferenceDeletionIds } from "../src/modules/pricing/preference-input";
import { pricingPreferencePolicy } from "../src/modules/pricing/preference-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof pricingPreferencePolicy>;
const stamp = "2026-10-20T04:00:00.000Z", changed = "2026-10-20T05:00:00.000Z";
const row = (id: string, deleted_at: string | null = null): JsonObject => ({ id, attribute: "Raw-CaFÉ", value: null,
  is_tax_inclusive: false, created_at: stamp, updated_at: stamp, deleted_at });
const event = (id: string | readonly string[], action = "deleted"): Json => ({ name: `pricing.price-preference.${action}`,
  metadata: { source: "pricing", object: "price_preference", action }, data: { id } });
const read = (ids: readonly string[], count: number): Activity["relationalReads"][number] => ({ table: "price_preference",
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids }), total: count, returned: count });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (ids: Json, result: Json, evidence: Activity, events: readonly Json[] = [], restore = false): Call => ({
  commandName: restore ? "pricingPreferenceRestoreForWorkflow" : "pricingPreferenceSoftDeleteForWorkflow", mode: "write", input: ids, result, events,
  fromAttempt: 0, toAttempt: evidence.mutations.length, fromLifecycle: 0, toLifecycle: evidence.lifecycle.length,
});
const deletion = (requested: readonly string[], active: readonly string[], historical: readonly string[] = []): Activity => {
  const before = active.map(id => row(id)), after = before.map(value => ({ ...value, deleted_at: changed, updated_at: changed }));
  return { ...empty(), observedRows: [...after, ...historical.map(id => row(id, stamp))].map(value => ({ table: "price_preference", row: value })),
    mutations: after.map((value, ordinal) => ({ ordinal, table: "price_preference", operation: "patch", before: before[ordinal] ?? null, after: value })),
    lifecycle: active.map((id, attemptOrdinal) => ({ table: "price_preference", operation: "softDelete", key: { id },
      beforeDeletedAt: null, afterDeletedAt: changed, attemptOrdinal, rowAtOperation: null })),
    relationalReads: requested.length ? [read(requested, active.length + historical.length)] : [] };
};
const refused = async (receipt: Call, evidence: Activity) => {
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
};

beforeAll(async () => {
  const contracts = Result.getOrThrow(compilePricePreferenceContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingPreferencePolicy(contracts);
});

describe("native Price Preference deletion receipts", () => {
  it("retains bounded raw IDs including empty strings, duplicate positions and original order", () => {
    for (const ids of [[], [""], ["z", "a", "a", "missing"], ["a", "b", "c", "d"]]) {
      expect(Result.getOrThrow(decodePricePreferenceDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodePricePreferenceDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const input of [null, "a", [null], { id: ["a"] }, ["a", "b", "c", "d", "e"], ["x".repeat(257)]])
      expect(Result.isFailure(decodePricePreferenceDeletionIds(input))).toBe(true);
    expect(Result.isFailure(decodePricePreferenceDeletionArguments([["a"], {}]))).toBe(true);
  });

  it("binds raw historical reads to deduplicated active transitions, native maps and ordered deletion messages", async () => {
    const ids = ["b", "a", "a", "history"], evidence = deletion(ids, ["a", "b"], ["history"]);
    const receipt = call(ids, { price_preference_id: ["a", "b"] }, evidence, [event("a"), event("b")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const result of [{}, { price_preference_id: ["b", "a"] }, { price_preference_id: ["a", "a", "b"] },
      { price_preference_id: ["a", "b", "history"] }, { other_id: ["a", "b"] }]) await refused({ ...receipt, result }, evidence);
    await refused({ ...receipt, events: [event("a")] }, evidence);
    await refused({ ...receipt, events: [event(["b", "a"])] }, evidence);
    await refused({ ...receipt, events: [event(["a", "b", "history"])] }, evidence);
    await refused(receipt, { ...evidence, relationalReads: [read(["a", "b", "history"], 3)] });
    await refused(receipt, { ...evidence, relationalReads: [read(ids, 2)] });
    await refused(receipt, { ...evidence, relationalReads: [...evidence.relationalReads, read(ids, 3)] });
  });

  it("requires real empty/history reads while leaving historical and missing rows unchanged", async () => {
    for (const ids of [[], [""], ["missing"], ["history"]]) {
      const evidence = deletion(ids, [], ids.includes("history") ? ["history"] : []);
      const receipt = call(ids, {}, evidence);
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      await refused({ ...receipt, result: { price_preference_id: [] } }, evidence);
      await refused({ ...receipt, events: [event("history")] }, evidence);
      if (ids.length) await refused(receipt, { ...evidence, relationalReads: [] });
    }
    const evidence = deletion(["active"], ["active"]);
    await refused(call(["active"], {}, evidence), { ...evidence, observedRows: [{ table: "price_preference", row: row("active") }], mutations: [], lifecycle: [] });
  });

  it("restores historical and already-active rows with selected result maps and zero events", async () => {
    const before = row("a", stamp), after = { ...before, deleted_at: null, updated_at: changed }, active = row("b");
    const ids = ["b", "a", "missing"];
    const evidence: Activity = { ...empty(), observedRows: [{ table: "price_preference", row: after }, { table: "price_preference", row: active }],
      mutations: [{ ordinal: 0, table: "price_preference", operation: "patch", before, after }],
      lifecycle: [
        { table: "price_preference", operation: "restore", key: { id: "a" }, beforeDeletedAt: stamp, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
        { table: "price_preference", operation: "restore", key: { id: "b" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
      ], relationalReads: [read(ids, 2)] };
    const receipt = call(ids, { price_preference_id: ["a", "b"] }, evidence, [], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: { price_preference_id: ["a"] } }, evidence);
    await refused({ ...receipt, events: [event("a", "restored")] }, evidence);
    await refused({ ...receipt, events: [event("a")] }, evidence);
    const first = evidence.lifecycle[0], second = evidence.lifecycle[1], mutation = evidence.mutations[0];
    if (first === undefined || second === undefined || mutation === undefined) throw new Error("Missing lifecycle fixture");
    await refused(receipt, { ...evidence, mutations: [...evidence.mutations, { ordinal: 1, table: "price_preference", operation: "patch", before: active,
      after: { ...active, updated_at: changed } }], lifecycle: [first, { ...second, attemptOrdinal: 1, rowAtOperation: null }] });
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...after, is_tax_inclusive: true } }] });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.capture(event("a", "restored")))))).toBe(true);
  });

  it("admits raw inverse requests with no matches without inventing restoration rows or events", async () => {
    for (const ids of [[], [""], ["missing", "missing"]]) {
      const evidence: Activity = { ...empty(), relationalReads: ids.length ? [read(ids, 0)] : [] };
      const receipt = call(ids, {}, evidence, [], true);
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      await refused({ ...receipt, events: [event("missing")] }, evidence);
      await refused({ ...receipt, result: { price_preference_id: ["missing"] } }, evidence);
    }
  });

  it("refuses foreign effects, malformed rows and mutations outside the bound lifecycle transition", async () => {
    const evidence = deletion(["a"], ["a"]), receipt = call(["a"], { price_preference_id: ["a"] }, evidence, [event("a")]);
    const mutation = evidence.mutations[0];
    if (mutation === undefined || mutation.after === null) throw new Error("Missing preference deletion fixture");
    for (const changes of [{ value: "unrequested" }, { is_tax_inclusive: true }, { created_at: changed }, { extra: true }])
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...mutation.after, ...changes } }] });
    const incomplete = { ...mutation.after }; delete incomplete.attribute;
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: incomplete }] });
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, table: "price_set" }] });
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, operation: "delete", after: null }] });
    await refused(receipt, { ...evidence, observedRows: [{ table: "price_preference", row: row("protected") }] });
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, key: { id: "protected" } })) });
    await refused({ ...receipt, mode: "read" }, evidence);
    await refused({ ...receipt, commandName: "pricingUnadmittedPreferenceLifecycle" }, evidence);
  });
});

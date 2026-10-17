import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compileStorePreferenceContracts, decodeStorePreferenceFilters } from "../src/modules/pricing/preference-input";
import { pricingStorePreferencePolicy } from "../src/modules/pricing/preference-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Contracts = Result.Result.Success<ReturnType<typeof compileStorePreferenceContracts>>;
let contracts: Contracts;
let policy: ReturnType<typeof pricingStorePreferencePolicy>;
const stamp = "2026-10-17T01:00:00.000Z", changed = "2026-10-17T02:00:00.000Z";
const row = (id: string, value: string, flag = false, fields: JsonObject = {}): JsonObject => ({ id,
  attribute: "currency_code", value, is_tax_inclusive: flag, created_at: stamp, updated_at: stamp, deleted_at: null, ...fields });
const activity = (mutations: Activity["mutations"] = [], observed: readonly JsonObject[] = []): Activity => ({
  mutations, observedRows: observed.map(row => ({ table: "price_preference", row })), lifecycle: [], setNull: [], referenceReplacements: [],
});
const receipt = (commandName: string, input: Json, result: Json, events: Json[], evidence: Activity): Receipt => ({
  commandName, mode: commandName === "pricingStorePreferenceList" ? "read" : "write", input, result, events,
  fromAttempt: 0, toAttempt: evidence.mutations.length, fromLifecycle: 0, toLifecycle: 0,
});
const event = (action: "created" | "updated" | "deleted", id: string | string[]): Json => ({
  name: "pricing.price-preference." + action, metadata: { source: "pricing", object: "price_preference", action }, data: { id },
});
const refused = async (call: Receipt, evidence: Activity) =>
  expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, evidence))))).toBe(true);

beforeAll(async () => {
  contracts = Result.getOrThrow(compileStorePreferenceContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingStorePreferencePolicy(contracts);
});

describe("named Store Pricing preference admission", () => {
  it("admits four raw pair filters and refuses overflow without normalizing case", () => {
    const pairs = ["USD", "usd", "EUR", "eur"].map(value => ({ attribute: "currency_code", value }));
    expect(Result.getOrThrow(decodeStorePreferenceFilters({ $or: pairs }))).toEqual({ $or: pairs });
    expect(Result.isFailure(decodeStorePreferenceFilters({ $or: [...pairs, pairs[0]] }))).toBe(true);
    expect(Result.isFailure(decodeStorePreferenceFilters({ $or: [{ attribute: "currency_code", value: "" }] }))).toBe(true);
  });

  it("requires all checked native DTO fields and refuses unknown or mistyped values", () => {
    const full = row("p", "USD"); expect(Result.getOrThrow(contracts.decodeOutput([full]))).toEqual([full]);
    for (const field of Object.keys(full)) {
      const incomplete = { ...full }; delete incomplete[field];
      expect(Result.isFailure(contracts.decodeOutput([incomplete]))).toBe(true);
    }
    for (const corrupted of [{ ...full, arbitrary: true }, { ...full, is_tax_inclusive: "false" }, { ...full, created_at: null }])
      expect(Result.isFailure(contracts.decodeOutput([corrupted]))).toBe(true);
  });

  it("authenticates empty lookup/upsert/physical-delete with exactly empty effects", async () => {
    const empty = activity();
    const cases: Array<readonly [string, Json, Json]> = [["pricingStorePreferenceList", { $or: [] }, []],
      ["pricingStorePreferenceUpsert", [], []], ["pricingStorePreferenceDelete", [], null]];
    for (const [name, input, output] of cases) {
      const call = receipt(name, input, output, [], empty); await Effect.runPromise(policy.validateLogicalCall(call, empty));
      await refused({ ...call, events: [event("created", "invented")] }, empty);
    }
  });

  it("authenticates complete pair lookup membership and binary native ID order", async () => {
    const first = row("a", "USD", true), last = row("z", "usd"), evidence = activity([], [last, first]);
    const call = receipt("pricingStorePreferenceList", { $or: [{ attribute: "currency_code", value: "usd" },
      { attribute: "currency_code", value: "USD" }] }, [first, last], [], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [last, first] }, evidence);
    await refused({ ...call, result: [first] }, evidence);
    await refused({ ...call, result: [{ ...first, is_tax_inclusive: false }, last] }, evidence);
    await refused(call, activity([], [first, last, row("unrelated", "JPY")]));
    await refused(call, activity([], [{ ...first, deleted_at: stamp }, last]));
  });

  it("preserves native create-then-update output and events when request order starts with an update", async () => {
    const previous = row("prior", "EUR"), created = row("generated", "USD"), updated = { ...previous, is_tax_inclusive: true, updated_at: changed };
    const evidence = activity([
      { ordinal: 0, table: "price_preference", operation: "insert", before: null, after: created },
      { ordinal: 1, table: "price_preference", operation: "patch", before: previous, after: updated },
    ], [updated]);
    const call = receipt("pricingStorePreferenceUpsert", [{ id: "prior", is_tax_inclusive: true },
      { attribute: "currency_code", value: "USD" }], [created, updated], [event("created", "generated"), event("updated", "prior")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [updated, created] }, evidence);
    await refused({ ...call, events: [...call.events].reverse() }, evidence);
    await refused({ ...call, events: [event("created", "generated")] }, evidence);
    await refused({ ...call, result: [{ ...created, value: "usd" }, updated] }, evidence);
    await refused({ ...call, result: [created, { ...updated, created_at: changed }] }, evidence);
    await refused(call, { ...evidence, mutations: [...evidence.mutations].reverse().map((value, ordinal) => ({ ...value, ordinal })) });
  });

  it("binds omitted creation defaults and every complete persisted scalar", async () => {
    const created = row("new", "USD"), evidence = activity([{ ordinal: 0, table: "price_preference", operation: "insert", before: null, after: created }]);
    const call = receipt("pricingStorePreferenceUpsert", [{ attribute: "currency_code", value: "USD" }], [created], [event("created", "new")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    const incorrect = { ...created, is_tax_inclusive: true };
    await refused({ ...call, result: [incorrect] }, activity([{ ...evidence.mutations[0]!, after: incorrect }]));
    await refused(call, { ...evidence, mutations: [...evidence.mutations, { ...evidence.mutations[0]!, ordinal: 1 }] });
  });

  it("uses the last repeated-ID update and retains the complete row for a native ID-only no-op", async () => {
    const previous = row("p", "USD"), updated = { ...previous, is_tax_inclusive: true, updated_at: changed };
    const evidence = activity([{ ordinal: 0, table: "price_preference", operation: "patch", before: previous, after: updated }], [updated]);
    const call = receipt("pricingStorePreferenceUpsert", [{ id: "p", is_tax_inclusive: false }, { id: "p", is_tax_inclusive: true }],
      [updated], [event("updated", "p")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [updated, updated] }, evidence);
    const noChange = activity([], [previous]), noop = receipt("pricingStorePreferenceUpsert", [{ id: "p" }], [previous], [], noChange);
    await Effect.runPromise(policy.validateLogicalCall(noop, noChange));
    await refused({ ...noop, events: [event("updated", "p")] }, noChange);
  });

  it("retains native primary-key OR filter order within the updated group, including last duplicate positions", async () => {
    const a = row("a", "USD"), z = row("z", "EUR"), aAfter = { ...a, is_tax_inclusive: true, updated_at: changed },
      zAfter = { ...z, is_tax_inclusive: true, updated_at: changed };
    const evidence = activity([
      { ordinal: 0, table: "price_preference", operation: "patch", before: z, after: zAfter },
      { ordinal: 1, table: "price_preference", operation: "patch", before: a, after: aAfter },
    ], [aAfter, zAfter]);
    const call = receipt("pricingStorePreferenceUpsert", [{ id: "a", is_tax_inclusive: false },
      { id: "z", is_tax_inclusive: true }, { id: "a", is_tax_inclusive: true }], [zAfter, aAfter],
    [event("updated", "z"), event("updated", "a")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [aAfter, zAfter] }, evidence);
    await refused({ ...call, events: [...call.events].reverse() }, evidence);
  });

  it("consumes the retained full previous DTO timestamp while preserving immutable managed fields", async () => {
    // Pinned core/dal metadata.applyModelDefaults unconditionally renews
    // updated_at; an inverse's earlier timestamp is never a persistence write.
    const previous = row("p", "USD"), current = { ...previous, is_tax_inclusive: true, updated_at: changed };
    const restored = { ...previous, updated_at: "2026-10-17T03:00:00.000Z" };
    const evidence = activity([{ ordinal: 0, table: "price_preference", operation: "patch", before: current, after: restored }], [restored]);
    const call = receipt("pricingStorePreferenceUpsert", [previous], [restored], [event("updated", "p")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, input: [{ ...previous, created_at: changed }] }, evidence);
    await refused({ ...call, input: [{ ...previous, deleted_at: changed }] }, evidence);
    await refused({ ...call, result: [previous] }, evidence);
  });

  it("authenticates every actual physical deletion including missing/duplicate requests and predeleted rows", async () => {
    const first = row("a", "USD"), deleted = row("z", "EUR", true, { deleted_at: stamp });
    const evidence = activity([
      { ordinal: 0, table: "price_preference", operation: "delete", before: first, after: null },
      { ordinal: 1, table: "price_preference", operation: "delete", before: deleted, after: null },
    ], [first, deleted]);
    const call = receipt("pricingStorePreferenceDelete", ["z", "missing", "a", "a"], null,
      [event("deleted", "a"), event("deleted", "z")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, input: ["a"] }, evidence);
    await refused({ ...call, result: ["a", "z"] }, evidence);
    await refused({ ...call, events: [event("deleted", "a")] }, evidence);
    await refused(call, { ...evidence, mutations: evidence.mutations.slice(0, 1) });
  });

  it("refuses foreign tables, public methods, wrong actions and mismatched event provenance", async () => {
    const created = row("new", "USD"), evidence = activity([{ ordinal: 0, table: "price_preference", operation: "insert", before: null, after: created }]);
    const call = receipt("pricingStorePreferenceUpsert", [{ attribute: "currency_code", value: "USD" }], [created], [event("created", "new")], evidence);
    await refused({ ...call, commandName: "pricingCreatePreference" }, evidence);
    await refused({ ...call, events: [event("updated", "new")] }, evidence);
    await refused({ ...call, events: [event("created", ["new", "new"])] }, evidence);
    await refused(call, { ...evidence, mutations: [{ ...evidence.mutations[0]!, table: "price_set" }] });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.capture({ name: "wrong", metadata: {
      source: "pricing", object: "price_preference", action: "created" }, data: { id: "new" } }))))).toBe(true);
  });
});

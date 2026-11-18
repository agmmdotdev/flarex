import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionTypeUpdateRepository } from "../src/modules/fulfillment/shipping-option-type-update-repository";
import { commerceRelationReadQuery } from "../src/query/relations";
import { shippingOptionTypeUpdatePolicy } from "../src/modules/fulfillment/shipping-option-type-update-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingOptionTypeUpdatePolicy>;
const stamp = "2026-10-18T00:00:00.000Z", changed = "2026-10-18T01:00:00.000Z";
const row = (id: string, extra: JsonObject = {}): JsonObject => ({ id, label: id, code: "custom", description: null,
  created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const activity = (before: readonly JsonObject[] = [], mutations: Activity["mutations"] = [], relationalReads: Activity["relationalReads"] = []): Activity => ({
  observedRows: before.map(row => ({ table: "shipping_option_type", row })), mutations, lifecycle: [], setNull: [], relationalReads, referenceReplacements: [],
});
// These explicit read shapes provide fixture evidence only. They do not infer
// selections, ordering, retargets or counts from the receipt under test.
const read = (predicate: JsonObject, count: number): Activity["relationalReads"][number] => ({ table: "shipping_option_type",
  query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
const activeRead = (ids: readonly string[], count: number) => read({ kind: "and", children: [
  { kind: "and", children: [{ kind: "in", column: "id", values: ids }] }, { kind: "isNull", column: "deleted_at" },
] }, count);
const physicalRead = (id: string, count: number) => read({ kind: "in", column: "id", values: [id] }, count);
const patch = (before: JsonObject, after: JsonObject, ordinal = 0): Activity["mutations"][number] =>
  ({ ordinal, table: "shipping_option_type", operation: "patch", before, after });
const insert = (after: JsonObject, ordinal = 0): Activity["mutations"][number] =>
  ({ ordinal, table: "shipping_option_type", operation: "insert", before: null, after });
const event = (id: string | string[], action = "updated"): Json => ({ name: `fulfillment.shipping-option-type.${action}`,
  metadata: { source: "fulfillment", object: "shipping_option_type", action }, data: { id } });
const call = (commandName: string, input: Json, result: Json, events: Json[] = [], evidence = activity()): Call => ({
  commandName, mode: commandName === "shippingOptionTypeListForUpdate" ? "read" : "write", input, result, events,
  fromAttempt: 0, toAttempt: evidence.mutations.length, fromLifecycle: 0, toLifecycle: 0,
});
const refused = async (receipt: Call, evidence: Activity) => {
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
};
beforeAll(async () => {
  policy = shippingOptionTypeUpdatePolicy(Result.getOrThrow(prepareShippingOptionTypeUpdateRepository(
    (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame)));
});

describe("native ShippingOptionType update receipt correlation", () => {
  it("refuses a skipped nonempty selector lookup even when the forged result is empty", async () => {
    for (const [commandName, input] of [
      ["shippingOptionTypeListForUpdate", { filters: { id: "existing" }, config: { select: ["label"], relations: [] } }],
      ["shippingOptionTypeUpdateForWorkflow", { selector: { id: "existing" }, update: { label: "changed" } }],
    ] as const) await refused(call(commandName, input, []), activity());
  });
  it("refuses partial, missing retarget, foreign-table and extra selector reads", async () => {
    const a = row("a"), b = row("b"), after = { ...b, label: "changed", updated_at: changed };
    const reads = [activeRead(["a"], 1), activeRead(["b"], 1)];
    const evidence = activity([a, b], [patch(b, after)], reads);
    const receipt = call("shippingOptionTypeUpdateForWorkflow", { selector: { id: "a" }, update: { id: "b", label: "changed" } }, [after], [event("b")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const relationalReads of [[], [activeRead(["a"], 1)], [activeRead(["b"], 1)], [...reads, activeRead(["a"], 1)],
      [activeRead(["a"], 1), activeRead(["unrequested"], 1)],
      [activeRead(["a"], 1), { ...activeRead(["b"], 1), table: "shipping_option" }],
      [activeRead(["a"], 0), activeRead(["b"], 1)],
      [activeRead(["a"], 1), { ...activeRead(["b"], 1), returned: 0 }],
    ]) await refused(receipt, { ...evidence, relationalReads });
    const listReceipt = call("shippingOptionTypeListForUpdate", { filters: { id: "a" }, config: { select: ["label"], relations: [] } }, [{ id: "a", label: "a" }]);
    const listEvidence = activity([a], [], [activeRead(["a"], 1)]);
    await Effect.runPromise(policy.validateLogicalCall(listReceipt, listEvidence));
    await refused(listReceipt, { ...listEvidence, relationalReads: [activeRead(["b"], 1)] });
    await refused(listReceipt, { ...listEvidence, relationalReads: [activeRead(["a"], 1), activeRead(["a"], 1)] });
    // Empty/missing original cohorts still make one authenticated lookup, with
    // no target lookup. Claiming a target read changes the native empty path.
    for (const ids of [[], ["missing"]]) {
      const emptyReceipt = call("shippingOptionTypeUpdateForWorkflow", { selector: { id: ids }, update: { id: "b" } }, []);
      const emptyEvidence = activity([], [], [activeRead(ids, 0)]);
      await Effect.runPromise(policy.validateLogicalCall(emptyReceipt, emptyEvidence));
      await refused(emptyReceipt, activity());
      await refused(emptyReceipt, { ...emptyEvidence, relationalReads: [activeRead(ids, 0), activeRead(["b"], 0)] });
    }
  });
  it("requires every sequential physical upsert lookup with its current existence count", async () => {
    const before = row("a"), first = { ...before, label: "first", updated_at: changed }, last = { ...first, label: "last" };
    const evidence = activity([before, first], [patch(before, first), patch(first, last, 1)], [physicalRead("a", 1), physicalRead("a", 1)]);
    const receipt = call("shippingOptionTypeUpsertForUpdateInverse", [{ id: "a", label: "first" }, { id: "a", label: "last" }], [first, last], [event("a")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const relationalReads of [[], [physicalRead("a", 1)], [physicalRead("a", 1), physicalRead("b", 1)],
      [physicalRead("a", 1), physicalRead("a", 0)], [physicalRead("a", 1), activeRead(["a"], 1)],
      [physicalRead("a", 1), physicalRead("a", 1), physicalRead("a", 1)],
    ]) await refused(receipt, { ...evidence, relationalReads });
  });
  // Scripted activities establish adversarial correlation; connected DB cases
  // establish the authenticated native service and storage evidence separately.
  it("authenticates raw selector order and exact projected original preimages", async () => {
    const a = row("a"), b = row("b"), deleted = row("deleted", { deleted_at: stamp });
    const receipt = call("shippingOptionTypeListForUpdate", { filters: { id: ["b", "a", "b", "deleted"] }, config: { select: ["label"], relations: [] } },
      [{ id: "b", label: "b" }, { id: "a", label: "a" }]);
    for (const rows of [[a, deleted, b], [b, a, deleted]]) await Effect.runPromise(policy.validateLogicalCall(receipt, activity(rows, [], [activeRead(["b", "a", "deleted"], 2)])));
    await refused({ ...receipt, result: [{ id: "a", label: "a" }, { id: "b", label: "b" }] }, activity([a, b], [], [activeRead(["b", "a", "deleted"], 2)]));
    await refused({ ...receipt, result: [b, a] }, activity([a, b], [], [activeRead(["b", "a", "deleted"], 2)]));
    await refused(receipt, activity([a, b, row("outside")], [], [activeRead(["b", "a", "deleted"], 2)]));
  });
  it("preserves a five-identity original cohort and outside ID retarget collapse", async () => {
    const original = ["d", "c", "b", "a"].map(id => row(id)), outside = row("outside"), after = { ...outside, label: "changed", updated_at: changed };
    const evidence = activity([...original, outside], [patch(outside, after)], [activeRead(["d", "c", "b", "a"], 4), activeRead(["outside"], 1)]);
    const receipt = call("shippingOptionTypeUpdateForWorkflow", { selector: { id: ["d", "c", "b", "a"] }, update: { id: "outside", label: "changed" } }, [after], [event("outside")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: original }, evidence);
    await refused({ ...receipt, events: [event("d")] }, evidence);
    await refused(receipt, activity([...original, outside, row("unrequested")], [patch(outside, after)], evidence.relationalReads));
    const forged = { ...after, description: "unrequested" };
    await refused({ ...receipt, result: [forged] }, activity([...original, outside], [patch(outside, forged)], evidence.relationalReads));
  });
  it("distinguishes forward ID-only no-op from nonempty same-value writes", async () => {
    const a = row("a"), b = row("b"), evidence = activity([a, b], [], [activeRead(["a"], 1), activeRead(["b"], 1)]);
    const noop = call("shippingOptionTypeUpdateForWorkflow", { selector: { id: "a" }, update: { id: "b" } }, [b]);
    await Effect.runPromise(policy.validateLogicalCall(noop, evidence));
    await refused({ ...noop, result: [{ ...b, updated_at: changed }] }, evidence);
    await refused({ ...noop, events: [event("b")] }, evidence);
    const after = { ...b, updated_at: changed }, writes = activity([a, b], [patch(b, after)], evidence.relationalReads);
    await Effect.runPromise(policy.validateLogicalCall(call("shippingOptionTypeUpdateForWorkflow", { selector: { id: "a" }, update: { id: "b", code: "custom" } }, [after], [event("b")], writes), writes));
  });
  it("requires ID-only inverse writes and preserves tombstones without restoration", async () => {
    for (const before of [row("a"), row("deleted", { deleted_at: stamp })]) {
      const after = { ...before, updated_at: changed }, evidence = activity([before], [patch(before, after)], [physicalRead(String(before.id), 1)]);
      const receipt = call("shippingOptionTypeUpsertForUpdateInverse", [{ id: before.id ?? "" }], [after], [event(String(before.id))], evidence);
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      await refused({ ...receipt, result: [before], events: [] }, activity([before], [], evidence.relationalReads));
      await refused({ ...receipt, events: [] }, evidence);
      if (before.deleted_at !== null) {
        const restored = { ...after, deleted_at: null };
        await refused({ ...receipt, result: [restored] }, activity([before], [patch(before, restored)], evidence.relationalReads));
      }
    }
  });
  it("authenticates missing-row recreation defaults and created event classification", async () => {
    const after = row("missing", { label: "New", code: "NEW", created_at: changed, updated_at: changed });
    const evidence = activity([], [insert(after)], [physicalRead("missing", 0)]);
    const receipt = call("shippingOptionTypeUpsertForUpdateInverse", [{ id: "missing", label: "New", code: "NEW" }], [after], [event("missing", "created")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, events: [event("missing")] }, evidence);
    await refused({ ...receipt, input: [{ id: "missing", label: "New" }] }, evidence);
    const forged = { ...after, description: "unrequested" };
    await refused({ ...receipt, result: [forged] }, activity([], [insert(forged)], evidence.relationalReads));
  });
  it("retains intermediate duplicate upsert results and native event deduplication", async () => {
    const before = row("a"), first = { ...before, label: "first", updated_at: changed }, second = { ...first, label: "last" };
    const evidence = activity([before, first], [patch(before, first), patch(first, second, 1)], [physicalRead("a", 1), physicalRead("a", 1)]);
    const receipt = call("shippingOptionTypeUpsertForUpdateInverse", [{ id: "a", label: "first" }, { id: "a", label: "last" }], [first, second], [event("a")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: [second] }, evidence);
    await refused({ ...receipt, result: [second, first] }, evidence);
    await refused({ ...receipt, events: [event("a"), event("a")] }, evidence);
    await refused(receipt, { ...evidence, mutations: [patch(before, first), patch(before, second, 1)] });
  });
  it("preserves empty original selection before retarget lookup and refuses foreign authority", async () => {
    for (const [ids, rows] of [[[], []], [["missing"], []], [["deleted"], [row("deleted", { deleted_at: stamp })]]] as const) {
      const evidence = activity(rows, [], [activeRead(ids, 0)]), receipt = call("shippingOptionTypeUpdateForWorkflow", { selector: { id: [...ids] }, update: { id: "outside", label: "changed" } }, []);
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      await refused({ ...receipt, result: [row("outside")] }, evidence);
    }
    const before = row("a"), after = { ...before, code: "CHANGED", updated_at: changed }, evidence = activity([before], [patch(before, after)], [activeRead(["a"], 1), activeRead(["a"], 1)]);
    const receipt = call("shippingOptionTypeUpdateForWorkflow", { selector: { id: "a" }, update: { code: "CHANGED" } }, [after], [event("a")], evidence);
    await refused({ ...receipt, commandName: "shippingOptionTypeCreateForWorkflow" }, evidence);
    await refused({ ...receipt, mode: "read" }, evidence);
    await refused(receipt, { ...evidence, observedRows: [{ table: "shipping_option", row: before }] });
    await refused(receipt, activity([{ id: "a" }]));
    await Effect.runPromise(policy.validateLogicalCall(call("shippingOptionTypeUpsertForUpdateInverse", [], []), activity()));
  });
});

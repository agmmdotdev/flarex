import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureShippingProfileMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingProfileUpdateRepository } from "../src/modules/fulfillment/shipping-profile-update-repository";
import { shippingProfileUpdatePolicy } from "../src/modules/fulfillment/shipping-profile-update-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingProfileUpdatePolicy>;
const stamp = "2026-10-17T00:00:00.000Z", changed = "2026-10-17T01:00:00.000Z";
const row = (id: string, extra: JsonObject = {}): JsonObject => ({ id, name: id, type: "custom", metadata: null,
  created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const activity = (before: readonly JsonObject[] = [], mutations: Activity["mutations"] = []): Activity => ({
  observedRows: before.map(row => ({ table: "shipping_profile", row })), mutations, lifecycle: [], setNull: [], referenceReplacements: [],
});
const patch = (before: JsonObject, after: JsonObject, ordinal = 0): Activity["mutations"][number] =>
  ({ ordinal, table: "shipping_profile", operation: "patch", before, after });
const event = (id: string | string[]): Json => ({ name: "fulfillment.shipping-profile.updated",
  metadata: { source: "fulfillment", object: "shipping_profile", action: "updated" }, data: { id } });
const call = (commandName: string, input: Json, result: Json, events: Json[] = [], evidence = activity()): Call => ({
  commandName, mode: commandName === "shippingProfileListForUpdate" ? "read" : "write", input, result, events,
  fromAttempt: 0, toAttempt: evidence.mutations.length, fromLifecycle: 0, toLifecycle: 0,
});
const refused = async (receipt: Call, evidence: Activity) => {
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
};
beforeAll(async () => {
  policy = shippingProfileUpdatePolicy(Result.getOrThrow(prepareShippingProfileUpdateRepository(
    (await Effect.runPromise(captureShippingProfileMetadata())).frame)));
});

describe("native ShippingProfile update receipt correlation", () => {
  // Scripted activities prove presentation/effect correlation only. The
  // connected workflow fixture separately proves authenticated storage evidence.
  it("orders raw duplicate selectors after native deduplication across permuted candidates", async () => {
    const a = row("a"), b = row("b"), deleted = row("deleted", { deleted_at: stamp });
    const receipt = call("shippingProfileListForUpdate", { filters: { id: ["b", "a", "b", "deleted"] },
      config: { select: ["type"], relations: [] } }, [{ id: "b", type: "custom" }, { id: "a", type: "custom" }]);
    for (const rows of [[a, deleted, b], [b, a, deleted]]) await Effect.runPromise(policy.validateLogicalCall(receipt, activity(rows)));
    await refused({ ...receipt, result: [{ id: "a", type: "custom" }, { id: "b", type: "custom" }] }, activity([a, b]));
    await refused({ ...receipt, result: [{ id: "b", type: "forged" }, { id: "a", type: "custom" }] }, activity([a, b]));
    await refused(receipt, activity([a, b, row("outside")]));
  });
  it("authenticates metadata-only native dotted preimages as identity-only", async () => {
    const before = row("a", { metadata: { keep: true } }), evidence = activity([before]);
    const receipt = call("shippingProfileListForUpdate", { filters: { id: "a" },
      config: { select: ["metadata.keep"], relations: [] } }, [{ id: "a" }]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: [{ id: "a", metadata: { keep: true } }] }, evidence);
  });
  it("authenticates complete four-row results and native mutation/event order", async () => {
    const before = ["d", "b", "c", "a"].map(id => row(id));
    const after = before.map(value => ({ ...value, type: " CuStOm ", updated_at: changed }));
    const evidence = activity([...before].reverse(), after.map((value, index) => patch(before[index] ?? {}, value, index)));
    const receipt = call("shippingProfileUpdateForWorkflow", { selector: { id: ["d", "b", "c", "a"] }, update: { type: " CuStOm " } },
      after, [event(["d", "b", "c", "a"])], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: [...after].reverse() }, evidence);
    await refused({ ...receipt, result: after.slice(0, 3) }, evidence);
    await refused({ ...receipt, events: [event(["a", "b", "c", "d"])] }, evidence);
    await refused({ ...receipt, events: [] }, evidence);
    await refused(receipt, { ...evidence, mutations: evidence.mutations.slice(0, 3) });
  });
  it("preserves true no-op timestamps and requires a write for nonempty same-value patches", async () => {
    const before = row("a"), evidence = activity([before]);
    const noop = call("shippingProfileUpdateForWorkflow", { selector: { id: "a" }, update: {} }, [before]);
    await Effect.runPromise(policy.validateLogicalCall(noop, evidence));
    await refused({ ...noop, result: [{ ...before, updated_at: changed }] }, evidence);
    await refused({ ...noop, events: [event("a")] }, evidence);
    const after = { ...before, updated_at: changed }, changedEvidence = activity([before], [patch(before, after)]);
    const same = call("shippingProfileUpdateForWorkflow", { selector: { id: "a" }, update: { type: "custom" } }, [after], [event("a")], changedEvidence);
    await Effect.runPromise(policy.validateLogicalCall(same, changedEvidence));
    await refused({ ...same, result: [before], events: [] }, evidence);
  });
  it("uses native shallow metadata merge, key deletion, and explicit empty/null clearing", async () => {
    const before = row("a", { metadata: { keep: true, drop: "old", nested: { old: true } } });
    for (const [incoming, wanted] of [[{ drop: "", nested: { replace: true } }, { keep: true, nested: { replace: true } }], [{}, {}], [null, null]] as const) {
      const after = { ...before, metadata: wanted, updated_at: changed }, evidence = activity([before], [patch(before, after)]);
      const receipt = call("shippingProfileUpdateForWorkflow", { selector: { id: "a" }, update: { metadata: incoming } }, [after], [event("a")], evidence);
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      const forged = { ...after, metadata: { forged: true } };
      await refused({ ...receipt, result: [forged] }, activity([before], [patch(before, forged)]));
    }
  });
  it("retains native inverse last-ID Map and id-only no-op rows", async () => {
    const a = row("a"), b = row("b"), afterA = { ...a, type: "last", updated_at: changed };
    const evidence = activity([a, b], [patch(a, afterA)]);
    const receipt = call("shippingProfileUpsertForUpdateInverse", [{ id: "a", type: "ignored" }, { id: "b" }, { id: "a", type: "last" }],
      [b, afterA], [event("a")], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: [afterA, b] }, evidence);
    await refused({ ...receipt, input: [{ id: "a", type: "ignored" }, { id: "b" }, { id: "missing", type: "last" }] }, evidence);
  });
  it("accepts genuinely empty/missing/deleted matches with exactly empty outputs/effects", async () => {
    for (const [ids, rows] of [[[], []], [["missing"], []], [["deleted"], [row("deleted", { deleted_at: stamp })]]] as const) {
      const evidence = activity(rows), receipt = call("shippingProfileUpdateForWorkflow", { selector: { id: [...ids] }, update: { type: "custom" } }, []);
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      await refused({ ...receipt, result: [row("invented")] }, evidence);
    }
    await Effect.runPromise(policy.validateLogicalCall(call("shippingProfileUpsertForUpdateInverse", [], []), activity()));
  });
  it("refuses unexpected authority, incomplete stored rows and changed unrelated fields", async () => {
    const before = row("a"), after = { ...before, type: "changed", updated_at: changed }, evidence = activity([before], [patch(before, after)]);
    const receipt = call("shippingProfileUpdateForWorkflow", { selector: { id: "a" }, update: { type: "changed" } }, [after], [event("a")], evidence);
    await refused({ ...receipt, commandName: "shippingProfileCreate" }, evidence);
    await refused({ ...receipt, mode: "read" }, evidence);
    await refused(receipt, { ...evidence, observedRows: [{ table: "shipping_option", row: before }] });
    const forged = { ...after, name: "unrequested" };
    await refused({ ...receipt, result: [forged] }, activity([before], [patch(before, forged)]));
    await refused(receipt, activity([{ id: "a" }]));
    await refused(receipt, { ...evidence, mutations: [{ ...patch(before, after), operation: "insert", before: null }] });
  });
});

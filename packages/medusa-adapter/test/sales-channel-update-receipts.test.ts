import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { salesChannelSelectorUpdatePolicy } from "../src/modules/sales-channel/update-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const policy = salesChannelSelectorUpdatePolicy();
const row = (id: string): JsonObject => ({ id, name: "Original", description: null, is_disabled: false,
  metadata: { keep: true }, created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null });
const event = (id: string) => ({ name: "sales_channel.sales-channel.updated",
  metadata: { source: "sales_channel", object: "sales_channel", action: "updated" }, data: { id } });
const activity = (before: readonly JsonObject[], after: readonly JsonObject[]): Activity => ({
  observedRows: before.map(row => ({ table: "sales_channel", row })),
  mutations: after.map((row, index) => ({ ordinal: index, table: "sales_channel", operation: "patch", before: before[index] ?? null, after: row })),
  lifecycle: [], setNull: [], referenceReplacements: [],
});
const call = (input: JsonObject, result: Call["result"], events: Call["events"]): Call => ({
  commandName: "salesChannelUpdateBySelector", mode: "write", input, result, events,
  fromAttempt: 0, toAttempt: events.length, fromLifecycle: 0, toLifecycle: 0,
});
const refused = async (receipt: Call, evidence: Activity) => {
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
};

describe("native Sales Channel scalar selector receipts", () => {
  it("binds the first native ID-filter row while authenticating every actual mutation", async () => {
    const before = [row("b"), row("a")], after = before.map(value => ({ ...value, name: "Updated", updated_at: "2026-10-16T00:01:00.000Z" }));
    const evidence = activity(before, after);
    const input = { selector: { id: ["b", "a", "b"] }, update: { name: "Updated" } };
    const receipt = call(input, { kind: "present", value: after[0]! }, [event("b"), event("a")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const result of [{ kind: "present", value: after[1]! }, { kind: "present", value: { ...after[0]!, name: "Forged" } },
      { kind: "present", value: { ...after[0]!, id: "outside" } }, { kind: "absent" }])
      await refused({ ...receipt, result }, evidence);
    await refused(receipt, { ...evidence, mutations: evidence.mutations.slice(0, 1) });
    await refused({ ...receipt, events: [event("a"), event("b")] }, evidence);
    await refused({ ...receipt, events: [] }, evidence);
  });

  it("uses real unchanged read rows for empty updates and forbids fabricated writes/events", async () => {
    const before = [row("a"), row("b")], evidence = activity(before, []);
    const receipt = call({ selector: { id: ["b", "a"] }, update: {} }, { kind: "present", value: before[1]! }, []);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: { kind: "present", value: before[0]! } }, evidence);
    await refused({ ...receipt, result: { kind: "present", value: { ...before[1]!, updated_at: "Invented timestamp" } } }, evidence);
    await refused({ ...receipt, events: [event("b")] }, evidence);
    await refused(receipt, activity(before, [{ ...before[0]! }]));
  });

  it("permits genuine zero selection only with native absent output", async () => {
    const evidence = activity([], []), receipt = call({ selector: { id: "missing" }, update: { name: "Never written" } }, { kind: "absent" }, []);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: { kind: "present", value: row("missing") } }, evidence);
    await refused(call({ selector: {}, update: {} }, { kind: "absent" }, []), activity([row("actual")], []));
  });

  it("retains native metadata merge and refuses unrequested scalar changes", async () => {
    const before: JsonObject = { ...row("a"), metadata: { keep: true, drop: "remove", nested: { old: true } } };
    const after: JsonObject = { ...before, metadata: { keep: true, nested: { current: true } }, updated_at: "2026-10-16T00:01:00.000Z" };
    const receipt = call({ selector: { name: "Original", is_disabled: false },
      update: { metadata: { drop: "", nested: { current: true } } } }, { kind: "present", value: after }, [event("a")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity([before], [after])));
    const forged: JsonObject = { ...after, description: "Unrequested" };
    await refused({ ...receipt, result: { kind: "present", value: forged } }, activity([before], [forged]));
  });
});

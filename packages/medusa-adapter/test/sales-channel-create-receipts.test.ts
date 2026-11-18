import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { salesChannelLogicalEventPolicy } from "../src/modules/sales-channel/events";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const policy = salesChannelLogicalEventPolicy();
const time = "2026-10-22T00:00:00.000Z";
const row = (id: string, changes: JsonObject = {}): JsonObject => ({ id, name: "First", description: null, metadata: null,
  is_disabled: false, created_at: time, updated_at: time, deleted_at: null, ...changes });
const event = (id: string): Json => ({ name: "sales_channel.sales-channel.created", metadata: {
  source: "sales_channel", object: "sales_channel", action: "created" }, data: { id } });
const call = (input: Json, result: Json, ids: string[]): Call => ({ input, result, events: ids.map(event),
  commandName: "salesChannelCreate", mode: "write", fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const activity = (rows: JsonObject[]): Activity => ({ observedRows: [], mutations: rows.map((after, ordinal) => ({
  ordinal, operation: "insert", table: "sales_channel", before: null, after })), lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const refuse = async (receipt: Call, writes: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, writes))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("Sales Channel create identity receipts", () => {
  it("correlates every result position with the complete unique write and event cohort", async () => {
    const shared = row("shared", { description: "Filled", metadata: { filled: true }, is_disabled: true }), other = row("other", { name: "Other" });
    const inputs = [{ id: "shared", name: "First", description: null, metadata: null }, { id: "other", name: "Other" },
      { id: "shared", name: "Ignored", description: "Filled", metadata: { filled: true }, is_disabled: true }];
    const receipt = call(inputs, [shared, other, shared], ["shared", "other"]), writes = activity([shared, other]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, writes));
    await refuse({ ...receipt, result: [shared, other, { ...shared, description: "forged" }] }, writes);
    await refuse({ ...receipt, input: [{ name: "First" }, { id: "other", name: "Other" }, { name: "First" }] }, writes);
    await refuse({ ...receipt, events: [...receipt.events, event("shared")] }, writes);
    await refuse(receipt, activity([shared]));
    const forged = { ...shared, name: "Ignored" };
    await refuse({ ...receipt, result: [forged, other, forged] }, activity([forged, other]));
    await refuse({ ...receipt, result: [shared, other] }, writes);
  });

  it("preserves explicit false and empty JSON while generated IDs remain distinct", async () => {
    const shared = row("shared", { metadata: {} });
    await Effect.runPromise(policy.validateLogicalCall(call([{ id: "shared", name: "First", is_disabled: false, metadata: {} },
      { id: "shared", name: "Later", is_disabled: true, metadata: { later: true } }], [shared, shared], ["shared"]), activity([shared])));
    await Effect.runPromise(policy.validateLogicalCall(call([], [], []), activity([])));
    const first = row("one"), second = row("two");
    await Effect.runPromise(policy.validateLogicalCall(call([{ name: "First" }, { name: "First" }], [first, second], ["one", "two"]), activity([first, second])));
    await refuse(call([{ name: "First" }, { name: "First" }], [first, first], ["one"]), activity([first]));
  });
});

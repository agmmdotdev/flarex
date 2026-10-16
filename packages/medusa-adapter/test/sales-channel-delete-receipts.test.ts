import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureSalesChannelMetadata } from "../src/modules/sales-channel/schema";
import { compileSalesChannelDeletionContracts, decodeSalesChannelDeletionArguments, decodeSalesChannelDeletionIds } from "../src/modules/sales-channel/delete-input";
import { salesChannelDeletionPolicy } from "../src/modules/sales-channel/delete-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof salesChannelDeletionPolicy>;
let contracts: Result.Result.Success<ReturnType<typeof compileSalesChannelDeletionContracts>>;
const time = "2026-10-16T00:00:00.000Z", later = "2026-10-16T00:01:00.000Z";
const row = (id: string, deleted_at: string | null = null): JsonObject => ({ id, name: "Original", description: null, is_disabled: false,
  metadata: { keep: true }, created_at: time, updated_at: time, deleted_at });
const event = (id: string, action: "deleted" | "restored"): Json => ({ name: `sales_channel.sales-channel.${action}`,
  metadata: { source: "sales_channel", object: "sales_channel", action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const call = (input: Json, result: Json, events: readonly Json[] = [], restore = false): Call => ({
  commandName: restore ? "salesChannelRestoreForWorkflow" : "salesChannelSoftDeleteForWorkflow", mode: "write", input, result, events,
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const deletion = (ids: readonly string[]): Activity => {
  const before = ids.map(id => row(id)), after = before.map(value => ({ ...value, deleted_at: later, updated_at: later }));
  return { ...empty(), observedRows: after.map(row => ({ table: "sales_channel", row })),
    mutations: after.map((row, ordinal) => ({ ordinal, table: "sales_channel", operation: "patch", before: before[ordinal] ?? null, after: row })),
    lifecycle: ids.map((id, attemptOrdinal) => ({ table: "sales_channel", operation: "softDelete", key: { id },
      beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal, rowAtOperation: null })) };
};
const refused = async (receipt: Call, evidence: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureSalesChannelMetadata()), table = metadata.frame.tables[0];
  if (table === undefined) throw new Error("Missing native Sales Channel model");
  contracts = Result.getOrThrow(compileSalesChannelDeletionContracts(table));
  policy = salesChannelDeletionPolicy(contracts);
});

describe("native Sales Channel lifecycle receipts", () => {
  it("retains zero to four requested IDs and repeats, refusing selectors/configuration and malformed IDs", () => {
    for (const ids of [[], ["a", "a", "missing"], ["a", "b", "c", "d"]]) {
      expect(Result.getOrThrow(decodeSalesChannelDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodeSalesChannelDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const input of ["a", [""], [null], { id: ["a"] }, ["a", "b", "c", "d", "e"]])
      expect(Result.isFailure(decodeSalesChannelDeletionIds(input))).toBe(true);
    expect(Result.isFailure(decodeSalesChannelDeletionArguments([["a"], {}]))).toBe(true);
  });

  it("authenticates membership selection without inventing missing or repeated transitions", async () => {
    const evidence = deletion(["a", "b"]), receipt = call(["b", "a", "a", "missing"], { sales_channel_id: ["a", "b"] },
      [event("a", "deleted"), event("b", "deleted")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const result of [{}, { sales_channel_id: ["b", "a"] }, { sales_channel_id: ["a", "a", "b"] },
      { sales_channel_id: ["a", "b", "missing"] }, { other_id: ["a", "b"] }]) await refused({ ...receipt, result }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.slice(0, 1) });
    await refused({ ...receipt, events: [event("a", "deleted")] }, evidence);
    await refused({ ...receipt, events: [event("b", "deleted"), event("a", "deleted")] }, evidence);
    await refused({ ...receipt, events: [event("a", "restored"), event("b", "restored")] }, evidence);
  });

  it("retains empty, missing and already-deleted soft deletion as genuine empty results", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([], {}), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"], {}), empty()));
    const evidence: Activity = { ...empty(), observedRows: [{ table: "sales_channel", row: row("deleted", time) }] };
    await Effect.runPromise(policy.validateLogicalCall(call(["deleted"], {}), evidence));
    await refused(call(["deleted"], { sales_channel_id: [] }), evidence);
    await refused(call(["deleted"], {}, [event("deleted", "deleted")]), evidence);
    await refused(call(["active"], {}), { ...empty(), observedRows: [{ table: "sales_channel", row: row("active") }] });
  });

  it("authenticates changed and already-active restores, including cached operation rows", async () => {
    const before = row("a", time), after = { ...before, deleted_at: null, updated_at: later }, active = row("b");
    const evidence: Activity = { ...empty(),
      observedRows: [{ table: "sales_channel", row: after }],
      mutations: [{ ordinal: 0, table: "sales_channel", operation: "patch", before, after }],
      lifecycle: [
        { table: "sales_channel", operation: "restore", key: { id: "a" }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
        { table: "sales_channel", operation: "restore", key: { id: "b" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
      ] };
    const receipt = call(["b", "a", "missing"], { sales_channel_id: ["a", "b"] }, [event("a", "restored"), event("b", "restored")], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, events: [event("a", "restored")] }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, attemptOrdinal: null })) });
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
    await Effect.runPromise(policy.validateLogicalCall(call([], {}, [], true), empty()));
  });

  it("projects exactly core document metadata before strict native lifecycle row checks", async () => {
    const document = (value: JsonObject): JsonObject => ({ ...value, _id: "document-" + value.id, _creationTime: 1_760_572_800_000 });
    const original = deletion(["a"]);
    const evidence: Activity = { ...original,
      observedRows: original.observedRows.map(value => ({ ...value, row: document(value.row) })),
      mutations: original.mutations.map(value => ({ ...value,
        before: value.before === null ? null : document(value.before), after: value.after === null ? null : document(value.after) })),
    };
    const receipt = call(["a"], { sales_channel_id: ["a"] }, [event("a", "deleted")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    // The public/native decoder remains exact. Only the trusted receipt's
    // document-to-native representation boundary removes these two fields.
    expect(contracts.decodeRow(document(row("a")))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    const observation = evidence.observedRows[0], mutation = evidence.mutations[0];
    if (observation === undefined || mutation?.before === null || mutation?.before === undefined || mutation.after === null)
      throw new Error("Missing document-backed lifecycle fixture");
    for (const changes of [{ _revision: "unadmitted metadata" }, { unknown_native_field: true }, { is_disabled: "false" }]) {
      await refused(receipt, { ...evidence, observedRows: [{ ...observation, row: { ...observation.row, ...changes } }] });
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, before: { ...mutation.before, ...changes } }] });
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...mutation.after, ...changes } }] });
    }
    const active = document(row("a"));
    const unchanged: Activity = { ...empty(), lifecycle: [{ table: "sales_channel", operation: "restore", key: { id: "a" },
      beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active }] };
    const restored = call(["a"], { sales_channel_id: ["a"] }, [event("a", "restored")], true);
    await Effect.runPromise(policy.validateLogicalCall(restored, unchanged));
    for (const changes of [{ _revision: "unadmitted metadata" }, { is_disabled: "false" }])
      await refused(restored, { ...unchanged, lifecycle: unchanged.lifecycle.map(value => ({ ...value, rowAtOperation: { ...active, ...changes } })) });
  });

  it("refuses malformed complete rows, unrelated writes and unbound lifecycle activity", async () => {
    const evidence = deletion(["a"]), receipt = call(["a"], { sales_channel_id: ["a"] }, [event("a", "deleted")]);
    const mutation = evidence.mutations[0];
    if (mutation === undefined || mutation.after === null) throw new Error("Missing mutation fixture");
    for (const changes of [{ name: "Forged" }, { metadata: null }, { is_disabled: "false" }, { extra: true }])
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...mutation.after, ...changes } }] });
    const incomplete = { ...mutation.after }; delete incomplete.created_at;
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: incomplete }] });
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, operation: "delete", after: null }] });
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, key: { id: "outside" } })) });
    await refused({ ...receipt, mode: "read" }, evidence);
    await refused({ ...receipt, commandName: "salesChannelDelete" }, evidence);
  });
});

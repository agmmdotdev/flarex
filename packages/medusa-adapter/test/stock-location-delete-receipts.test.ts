import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStockLocationMetadata } from "../src/modules/stock-location/schema";
import { compileStockLocationDeletionContracts, decodeStockLocationDeletionArguments,
  decodeStockLocationDeletionIds, decodeStockLocationDeletionOutput } from "../src/modules/stock-location/delete-input";
import { stockLocationDeletionPolicy } from "../src/modules/stock-location/delete-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof stockLocationDeletionPolicy>;
let contracts: Result.Result.Success<ReturnType<typeof compileStockLocationDeletionContracts>>;
const time = "2026-10-16T00:00:00.000Z", later = "2026-10-16T00:01:00.000Z";
const row = (id: string, deleted_at: string | null = null): JsonObject => ({ id, name: "Original", address_id: "address-kept",
  metadata: { keep: true }, created_at: time, updated_at: time, deleted_at });
const output = (ids: readonly string[]): Json => ({ stock_location_id: [...ids], location_id: [...ids] });
const event = (id: string, action: "deleted" | "restored"): Json => ({ name: `${action === "deleted" ? "stock_location" : "stock"}.stock-location.${action}`,
  metadata: { source: action === "deleted" ? "stock_location" : "stock", object: "stock_location", action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (input: Json, result: Json, events: readonly Json[] = [], restore = false): Call => ({
  commandName: restore ? "stockLocationRestoreForWorkflow" : "stockLocationSoftDeleteForWorkflow", mode: "write", input, result, events,
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const deletion = (ids: readonly string[]): Activity => {
  const before = ids.map(id => row(id)), after = before.map(value => ({ ...value, deleted_at: later, updated_at: later }));
  return { ...empty(), observedRows: after.map(row => ({ table: "stock_location", row })),
    mutations: after.map((row, ordinal) => ({ ordinal, table: "stock_location", operation: "patch", before: before[ordinal] ?? null, after: row })),
    lifecycle: ids.map((id, attemptOrdinal) => ({ table: "stock_location", operation: "softDelete", key: { id },
      beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal, rowAtOperation: null })) };
};
const refused = async (receipt: Call, evidence: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureStockLocationMetadata());
  const table = metadata.frame.tables.find(table => table.name === "stock_location");
  const address = metadata.frame.tables.find(table => table.name === "stock_location_address");
  if (table === undefined || address === undefined) throw new Error("Missing native Stock Location models");
  contracts = Result.getOrThrow(compileStockLocationDeletionContracts(table, address));
  policy = stockLocationDeletionPolicy(contracts);
});

describe("native Stock Location lifecycle receipts", () => {
  it("refuses invented source spellings for subscribed deletion and conventional restoration", async () => {
    for (const [name, source, action] of [["stock.stock-location.deleted", "stock", "deleted"],
      ["stock_location.stock-location.restored", "stock_location", "restored"]])
      expect(await Effect.runPromise(Effect.result(policy.capture({ name,
        metadata: { source, object: "stock_location", action }, data: { id: "a" } }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });
  it("retains zero to four raw IDs and authenticates both agreeing native aliases", () => {
    for (const ids of [[], ["a", "a", "missing"], ["a", "b", "c", "d"]]) {
      expect(Result.getOrThrow(decodeStockLocationDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodeStockLocationDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const input of ["a", [""], [null], { id: ["a"] }, ["a", "b", "c", "d", "e"]])
      expect(Result.isFailure(decodeStockLocationDeletionIds(input))).toBe(true);
    expect(Result.isFailure(decodeStockLocationDeletionArguments([["a"], {}]))).toBe(true);
    expect(Result.getOrThrow(decodeStockLocationDeletionOutput({}))).toEqual({});
    expect(Result.getOrThrow(decodeStockLocationDeletionOutput(output(["a", "b"])))).toEqual(output(["a", "b"]));
    for (const input of [{ stock_location_id: ["a"] }, { location_id: ["a"] },
      { stock_location_id: ["a"], location_id: ["b"] }, { stock_location_id: ["a"], location_id: ["a", "b"] },
      { stock_location_id: ["a"], location_id: ["a"], address_id: ["address-kept"] }])
      expect(Result.isFailure(decodeStockLocationDeletionOutput(input))).toBe(true);
  });

  it("binds actual selected rows, both aliases and module messages without requested-ID invention", async () => {
    const evidence = deletion(["a", "b"]), receipt = call(["b", "a", "a", "missing"], output(["a", "b"]),
      [event("a", "deleted"), event("b", "deleted")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const result of [{}, output(["b", "a"]), output(["a", "a", "b"]), output(["a", "b", "missing"]),
      { stock_location_id: ["a", "b"] }, { stock_location_id: ["a", "b"], location_id: ["b", "a"] }])
      await refused({ ...receipt, result }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.slice(0, 1) });
    await refused({ ...receipt, events: [event("a", "deleted")] }, evidence);
    await refused({ ...receipt, events: [event("b", "deleted"), event("a", "deleted")] }, evidence);
    await refused({ ...receipt, events: [event("a", "restored"), event("b", "restored")] }, evidence);
  });

  it("keeps empty, missing and already-deleted inputs as empty maps without Address cleanup", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([], {}), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"], {}), empty()));
    const evidence: Activity = { ...empty(), observedRows: [{ table: "stock_location", row: row("deleted", time) }] };
    await Effect.runPromise(policy.validateLogicalCall(call(["deleted"], {}), evidence));
    await refused(call(["deleted"], output([])), evidence);
    await refused(call(["deleted"], {}, [event("deleted", "deleted")]), evidence);
    await refused(call(["active"], {}), { ...empty(), observedRows: [{ table: "stock_location", row: row("active") }] });
  });

  it("authenticates changed and active restores including cached full operation rows", async () => {
    const before = row("a", time), after = { ...before, deleted_at: null, updated_at: later }, active = row("b");
    const evidence: Activity = { ...empty(), observedRows: [{ table: "stock_location", row: after }],
      mutations: [{ ordinal: 0, table: "stock_location", operation: "patch", before, after }],
      lifecycle: [
        { table: "stock_location", operation: "restore", key: { id: "a" }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
        { table: "stock_location", operation: "restore", key: { id: "b" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
      ] };
    const receipt = call(["b", "a", "missing"], output(["a", "b"]), [event("a", "restored"), event("b", "restored")], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, events: [event("a", "restored")] }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
    await Effect.runPromise(policy.validateLogicalCall(call([], {}, [], true), empty()));
  });

  it("preserves every Location scalar and Address FK and refuses Address activity", async () => {
    const evidence = deletion(["a"]), receipt = call(["a"], output(["a"]), [event("a", "deleted")]);
    const mutation = evidence.mutations[0];
    if (mutation === undefined || mutation.after === null) throw new Error("Missing mutation fixture");
    for (const changes of [{ name: "Forged" }, { metadata: null }, { address_id: null }, { address_id: "other-address" }, { extra: true }])
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...mutation.after, ...changes } }] });
    const incomplete = { ...mutation.after }; delete incomplete.created_at;
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: incomplete }] });
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, table: "stock_location_address" }] });
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, table: "stock_location_address" })) });
    await refused(receipt, { ...evidence, mutations: [{ ...mutation, operation: "delete", after: null }] });
    await refused({ ...receipt, mode: "read" }, evidence);
    await refused({ ...receipt, commandName: "stockLocationCreate" }, evidence);
  });

  it("projects only document metadata before strict native Location row checks", async () => {
    const document = (value: JsonObject): JsonObject => ({ ...value, _id: "document-" + value.id, _creationTime: 1_760_572_800_000 });
    const original = deletion(["a"]);
    const evidence: Activity = { ...original, observedRows: original.observedRows.map(value => ({ ...value, row: document(value.row) })),
      mutations: original.mutations.map(value => ({ ...value,
        before: value.before === null ? null : document(value.before), after: value.after === null ? null : document(value.after) })),
    };
    const receipt = call(["a"], output(["a"]), [event("a", "deleted")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    expect(Result.isFailure(contracts.decodeRow(document(row("a"))))).toBe(true);
    const observation = evidence.observedRows[0];
    if (observation === undefined) throw new Error("Missing Location observation");
    for (const changes of [{ _revision: "unadmitted" }, { address_id: false }, { unknown_native_field: true }])
      await refused(receipt, { ...evidence, observedRows: [{ ...observation, row: { ...observation.row, ...changes } }] });
  });
});

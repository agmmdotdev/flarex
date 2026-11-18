import { describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { scalarLifecycleReceipt } from "../src/repository/scalar-lifecycle-receipt";
import { commerceDecoder } from "../src/value/decoder";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const Id = Schema.String.check(Schema.isMinLength(1));
const decodeRow = commerceDecoder(Schema.Struct({ id: Id, content: Schema.Json,
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) }), "storedCorruption");
const decodeIds = commerceDecoder(Schema.Array(Id), "invalidInput");
const decodeResult = commerceDecoder(Schema.Struct({ ids: Schema.Array(Id) }), "storedCorruption");
const validator = (activeRestoreUpdates?: true) => scalarLifecycleReceipt({ table: "fixture",
  softDeleteCommand: "fixtureSoftDelete", restoreCommand: "fixtureRestore", maximumRoots: 2,
  ...(activeRestoreUpdates === true ? { activeRestoreUpdates } : {}), decodeIds, decodeRow,
  decodeResult: value => decodeResult(value).pipe(Result.map(result => ({ empty: result.ids.length === 0, ids: result.ids }))) });
const stamp = "2026-10-21T00:00:00.000Z", later = "2026-10-22T00:00:00.000Z";
const active = { id: "fixture-a", content: { retained: [1, null] }, created_at: stamp, updated_at: stamp, deleted_at: null };
function noOp(): { call: Call; activity: Activity } {
  return { call: { commandName: "fixtureRestore", mode: "write", input: [active.id], result: { ids: [active.id] }, events: [],
    fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 1 },
  activity: { mutations: [], observedRows: [{ table: "fixture", row: active }], relationalReads: [], setNull: [], referenceReplacements: [],
    lifecycle: [{ table: "fixture", operation: "restore", key: { id: active.id }, beforeDeletedAt: null, afterDeletedAt: null,
      attemptOrdinal: null, rowAtOperation: active }] } };
}

describe("shared scalar lifecycle operation-row correlation", () => {
  it("accepts matching complete active no-op evidence", async () => {
    const { call, activity } = noOp();
    const requestedIds = [active.id, "missing", active.id];
    expect(await Effect.runPromise(validator()({ ...call, input: requestedIds }, activity))).toEqual({
      operation: "restore", ids: [active.id], requestedIds, rows: new Map([[active.id, active]]),
    });
  });
  it("preserves complete operation rows when closed-child observations omit unchanged identities", async () => {
    const { call, activity } = noOp();
    expect(await Effect.runPromise(validator()(call, { ...activity, observedRows: [] }))).toEqual({
      operation: "restore", ids: [active.id], requestedIds: [active.id], rows: new Map([[active.id, active]]),
    });
  });
  it.each([
    ["business content", { ...active, content: { retained: [2, null] } }],
    ["managed timestamp", { ...active, updated_at: later }],
    ["deletion state", { ...active, deleted_at: stamp }],
    ["identity", { ...active, id: "foreign" }],
  ])("refuses altered %s against the independent final observation", async (_name, rowAtOperation) => {
    const { call, activity } = noOp();
    expect(await Effect.runPromise(Effect.result(validator()(call, { ...activity,
      lifecycle: activity.lifecycle.map(transition => ({ ...transition, rowAtOperation })) }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
  it.each(["restore", "softDelete"] as const)("keeps mutation preimages distinct from final %s observations", async operation => {
    const { call, activity } = noOp();
    const before = { ...active, deleted_at: operation === "restore" ? stamp : null },
      after = { ...active, deleted_at: operation === "restore" ? null : later, updated_at: later };
    const changed: Activity = { ...activity, observedRows: [{ table: "fixture", row: after }],
      mutations: [{ ordinal: 0, table: "fixture", operation: "patch", before, after }],
      lifecycle: [{ table: "fixture", operation, key: { id: active.id }, beforeDeletedAt: before.deleted_at,
        afterDeletedAt: after.deleted_at, attemptOrdinal: 0, rowAtOperation: null }] };
    expect(await Effect.runPromise(validator()({ ...call, commandName: operation === "restore" ? "fixtureRestore" : "fixtureSoftDelete", toAttempt: 1 }, changed)))
      .toEqual({ operation, ids: [active.id], requestedIds: [active.id], rows: new Map([[active.id, before]]) });
  });
  it("preserves explicit native active-restore update profiles", async () => {
    const { call, activity } = noOp(), after = { ...active, updated_at: later };
    const changed: Activity = { ...activity, observedRows: [{ table: "fixture", row: after }],
      mutations: [{ ordinal: 0, table: "fixture", operation: "patch", before: active, after }],
      lifecycle: activity.lifecycle.map(transition => ({ ...transition, attemptOrdinal: 0, rowAtOperation: null })) };
    expect(await Effect.runPromise(validator(true)({ ...call, toAttempt: 1 }, changed))).toEqual({
      operation: "restore", ids: [active.id], requestedIds: [active.id], rows: new Map([[active.id, active]]),
    });
  });
});

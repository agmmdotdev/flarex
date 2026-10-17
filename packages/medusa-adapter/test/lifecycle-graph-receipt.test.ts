import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { correlateLifecycleGraphReceipt } from "../src/repository/lifecycle-graph-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceDecoder } from "../src/value/decoder";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Input = Parameters<typeof correlateLifecycleGraphReceipt>[0];
const before: JsonObject = { id: "root-a", title: "Retained", created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z", deleted_at: null };
const later = "2026-10-18T01:00:00.000Z";
const decode = commerceDecoder(Schema.Struct({ id: Schema.String, title: Schema.String, created_at: Schema.String, updated_at: Schema.String,
  deleted_at: Schema.NullOr(Schema.String) }), "receiptMismatch");
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const base = (): Input => ({ entities: [{ table: { name: "root" }, maximum: 1, linkableKey: "root_id", decodeRow: decode }], rootTable: "root", operation: "restore",
  activity: { ...empty(), lifecycle: [{ table: "root", operation: "restore", key: { id: "root-a" }, beforeDeletedAt: null, afterDeletedAt: null,
    attemptOrdinal: null, rowAtOperation: before }] }, evidence: new Map([["root", new Map([["root-a", before]])]]),
  selected: new Map([["root", new Set(["root-a"])]]), result: { root_id: ["root-a"] } });
const activeUpdate = (): Input => ({ ...base(), activeRestoreUpdates: true, activity: { ...empty(),
  mutations: [{ ordinal: 0, table: "root", operation: "patch", before, after: { ...before, updated_at: later } }],
  lifecycle: [{ table: "root", operation: "restore", key: { id: "root-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null }],
} });

describe("module-neutral lifecycle graph receipt correlation", () => {
  it("preserves default active-restore no-op while requiring a real patch for the explicitly selected mode", () => {
    expect(Result.getOrThrow(correlateLifecycleGraphReceipt(base())).events).toEqual([{ object: "root", id: "root-a" }]);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...base(), activeRestoreUpdates: true }))).toBe(true);
    const selected = activeUpdate(); expect(Result.getOrThrow(correlateLifecycleGraphReceipt(selected)).events).toEqual([{ object: "root", id: "root-a" }]);
    const { activeRestoreUpdates: _selection, ...ordinary } = selected;
    expect(Result.isFailure(correlateLifecycleGraphReceipt(ordinary))).toBe(true);
  });

  it("requires every selected identity, unique transition ordinal and unchanged scalar fields", () => {
    const input = activeUpdate();
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: empty() }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity, lifecycle: [...input.activity.lifecycle, ...input.activity.lifecycle] } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity, mutations: input.activity.mutations.map(mutation =>
      ({ ...mutation, after: { ...before, title: "forged", updated_at: later } })) } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, result: { root_id: ["outside"] } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, result: { root_id: ["root-a"], foreign_id: [] } }))).toBe(true);
  });

  it("retains historical descendant re-deletion without admitting an already-deleted soft root", () => {
    const historical: JsonObject = { ...before, id: "child-a", deleted_at: before.updated_at ?? null };
    const input: Input = { ...base(), operation: "softDelete", entities: [{ table: { name: "child" }, maximum: 1, linkableKey: "child_id", decodeRow: decode }],
      evidence: new Map([["child", new Map([["child-a", historical]])]]), selected: new Map([["child", new Set(["child-a"])]]), result: { child_id: ["child-a"] },
      activity: { ...empty(), mutations: [{ ordinal: 0, table: "child", operation: "patch", before: historical, after: { ...historical, deleted_at: later, updated_at: later } }],
        lifecycle: [{ table: "child", operation: "softDelete", key: { id: "child-a" }, beforeDeletedAt: String(historical.deleted_at), afterDeletedAt: later, attemptOrdinal: 0, rowAtOperation: null }] } };
    expect(Result.getOrThrow(correlateLifecycleGraphReceipt(input)).events).toEqual([{ object: "child", id: "child-a" }]);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, rootTable: "child" }))).toBe(true);
  });
});

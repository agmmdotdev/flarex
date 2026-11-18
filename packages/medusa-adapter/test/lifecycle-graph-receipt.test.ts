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
const base = (): Input => ({ entities: [{ table: { name: "root" }, maximum: 1, linkableKey: "root_id", decodeRow: decode }], rootTable: "root", selectedRootIds: new Set(["root-a"]), operation: "restore",
  activity: { ...empty(), lifecycle: [{ table: "root", operation: "restore", key: { id: "root-a" }, beforeDeletedAt: null, afterDeletedAt: null,
    attemptOrdinal: null, rowAtOperation: before }] }, evidence: new Map([["root", new Map([["root-a", before]])]]),
  selected: new Map([["root", new Set(["root-a"])]]), result: { root_id: ["root-a"] } });
const activeUpdate = (): Input => ({ ...base(), activeRestoreUpdates: true, activity: { ...empty(),
  mutations: [{ ordinal: 0, table: "root", operation: "patch", before, after: { ...before, updated_at: later } }],
  lifecycle: [{ table: "root", operation: "restore", key: { id: "root-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null }],
} });

const sameTableCascade = (): Input => {
  const historical = { ...before, id: "child-a", deleted_at: "2026-10-18T00:00:00.000Z" };
  const rows = [{ ...before, id: "root-a", deleted_at: null }, historical];
  return { ...base(), operation: "softDelete", selectedRootIds: new Set(["root-a"]),
    entities: [{ table: { name: "root" }, maximum: 2, linkableKey: "root_id", decodeRow: decode }],
    evidence: new Map([["root", new Map(rows.map(row => [String(row.id), row]))]]),
    selected: new Map([["root", new Set(["root-a", "child-a"])]]), result: { root_id: ["root-a", "child-a"] },
    activity: { ...empty(), mutations: rows.map((row, ordinal) => ({ ordinal, table: "root", operation: "patch",
      before: row, after: { ...row, deleted_at: later, updated_at: later } })),
    lifecycle: rows.map((row, attemptOrdinal) => ({ table: "root", operation: "softDelete", key: { id: row.id },
      beforeDeletedAt: row.deleted_at ?? null, afterDeletedAt: later, attemptOrdinal, rowAtOperation: null })) },
  };
};

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
    const sameTable = sameTableCascade(), historical = sameTable.evidence.get("root")?.get("child-a");
    if (historical === undefined) throw new Error("Incomplete historical child fixture");
    const input: Input = { ...sameTable,
      entities: [...base().entities, { table: { name: "child" }, maximum: 1, linkableKey: "child_id", decodeRow: decode }],
      evidence: new Map([["root", new Map([["root-a", before]])], ["child", new Map([["child-a", historical]])]]),
      selected: new Map([["root", new Set(["root-a"])], ["child", new Set(["child-a"])]]),
      result: { root_id: ["root-a"], child_id: ["child-a"] },
      activity: { ...sameTable.activity,
        mutations: sameTable.activity.mutations.map(mutation => ({ ...mutation, table: mutation.before?.id === "child-a" ? "child" : "root" })),
        lifecycle: sameTable.activity.lifecycle.map(transition => ({ ...transition, table: transition.key.id === "child-a" ? "child" : "root" })),
      } };
    expect(Result.getOrThrow(correlateLifecycleGraphReceipt(input)).events).toEqual([{ object: "root", id: "root-a" }, { object: "child", id: "child-a" }]);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, rootTable: "child", selectedRootIds: new Set(["child-a"]) }))).toBe(true);
  });

  it("allows a historical descendant in the root table beside an explicitly selected active parent", () => {
    expect(Result.getOrThrow(correlateLifecycleGraphReceipt(sameTableCascade())).events).toEqual([
      { object: "root", id: "root-a" }, { object: "root", id: "child-a" },
    ]);
  });

  it("refuses historical explicit roots even when they are also descendants of an active selected parent", () => {
    const input = sameTableCascade();
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, selectedRootIds: new Set(["root-a", "child-a"]) }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, selectedRootIds: new Set(["child-a"]) }))).toBe(true);
  });

  it("requires explicit roots for a nonempty closure while preserving genuine empty lifecycle calls", () => {
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...sameTableCascade(), selectedRootIds: new Set() }))).toBe(true);
    for (const operation of ["softDelete", "restore"] as const) {
      expect(Result.getOrThrow(correlateLifecycleGraphReceipt({ ...base(), operation, selectedRootIds: new Set(),
        selected: new Map(), evidence: new Map(), activity: empty(), result: {} })).events).toEqual([]);
    }
  });

  it("requires each explicit root to belong to the selected closure and its exact evidence identity", () => {
    const input = sameTableCascade();
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, selectedRootIds: new Set(["outside"]) }))).toBe(true);
    const rows = new Map(input.evidence.get("root"));
    rows.set("outside", { ...before, id: "outside" });
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, evidence: new Map([["root", rows]]), selectedRootIds: new Set(["outside"]) }))).toBe(true);
    rows.delete("root-a");
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, evidence: new Map([["root", rows]]) }))).toBe(true);
    rows.set("root-a", { ...before, id: "foreign" });
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, evidence: new Map([["root", rows]]) }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, rootTable: "outside" }))).toBe(true);
  });

  it("keeps same-table descendant transitions, mutations and affected maps complete and unique", () => {
    const input = sameTableCascade(), [parent, child] = input.activity.lifecycle;
    if (parent === undefined || child === undefined) throw new Error("Incomplete cascade test fixture");
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity, lifecycle: [parent] } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity, lifecycle: [parent, child, child] } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity, lifecycle: [parent, { ...child, attemptOrdinal: 0 }] } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity, mutations: input.activity.mutations.slice(0, 1) } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, result: { root_id: ["root-a"] } }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, selected: new Map([["root", new Set(["root-a"])]]) }))).toBe(true);
    expect(Result.isFailure(correlateLifecycleGraphReceipt({ ...input, activity: { ...input.activity,
      mutations: input.activity.mutations.map(mutation => mutation.before?.id === "child-a"
        ? { ...mutation, after: { ...mutation.after, title: "forged" } } : mutation) } }))).toBe(true);
  });
});

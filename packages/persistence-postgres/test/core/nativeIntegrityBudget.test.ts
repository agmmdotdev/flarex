import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "../../src/core/accounting";
import type { CoreIndexDefinition } from "../../src/core/api";
import { CoreNativeIntegrityBudget } from "../../src/core/nativeIntegrityBudget";
import { initialRegistry } from "../../src/core/registry";

const index: CoreIndexDefinition = { name: "by_native_id", fields: ["id"], ref: { id: new Uint8Array(16).fill(1) } };
const interval = (start: number, end: number) => ({ start: Uint8Array.of(start), end: Uint8Array.of(end) });

describe("native integrity query accounting", () => {
  it("merges closure and frozen-integrity probes into the source's already charged index intervals", () => {
    const limits = { ...CORE_TRANSACTION_REFERENCE_LIMITS, databaseQueries: 2 };
    const owner = new CoreAccounting(limits);
    Result.getOrThrow(owner.query(index.ref.id, interval(10, 20)));
    Result.getOrThrow(owner.query(index.ref.id, interval(30, 40)));
    const budget = new CoreNativeIntegrityBudget({ namespace: null, timestamp: 1n, reads: [], queryReads: owner.queryReads(), changes: [],
      registry: Result.getOrThrow(initialRegistry([])), limits, usage: owner.snapshot() });
    expect(Result.isSuccess(budget.query(index, interval(10, 20)))).toBe(true);
    expect(Result.isSuccess(budget.query(index, interval(12, 18)))).toBe(true);
    expect(Result.isSuccess(budget.query(index, interval(30, 40)))).toBe(true);
    expect(budget.query(index, interval(50, 60))).toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
  });

  it("keeps different index identities distinct and retains an opaque prior charge when provenance is absent", () => {
    const limits = { ...CORE_TRANSACTION_REFERENCE_LIMITS, databaseQueries: 1 };
    const owner = new CoreAccounting(limits);
    Result.getOrThrow(owner.query(index.ref.id, interval(10, 20)));
    const state = { namespace: null, timestamp: 1n, reads: [], changes: [], registry: Result.getOrThrow(initialRegistry([])), limits, usage: owner.snapshot() };
    const budget = new CoreNativeIntegrityBudget({ ...state, queryReads: owner.queryReads() });
    expect(budget.query({ ...index, ref: { id: new Uint8Array(16).fill(2) } }, interval(10, 20)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    expect(new CoreNativeIntegrityBudget(state).query(index, interval(10, 20)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
  });
});

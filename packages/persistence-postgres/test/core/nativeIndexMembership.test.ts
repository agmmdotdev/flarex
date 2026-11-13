import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreTableDefinition } from "../../src/core/api";
import type { CoreIndexRecord } from "../../src/core/indexState";
import { checkCoreNativeTableIndexes } from "../../src/core/nativePolicy";
import { initialRegistry } from "../../src/core/registry";
import { serializeCoreSchema } from "../../src/core/schemaJson";
import { CoreSchemaRegistry } from "../../src/core/schemaRegistry";
import { captureCoreSchema, CoreSchemaError, type CoreSchemaDefinition } from "../../src/core/schemaTypes";
import type { CoreSystemDocument } from "../../src/core/transaction";

const id = (n: number) => { const value = new Uint8Array(16); value[15] = n; return value; };
const table: CoreTableDefinition = { name: "items", number: 10001, tabletId: id(1), namespace: null, state: "active",
  indexes: [{ name: "by_id", fields: [], ref: { id: id(11) } },
    { name: "by_creation_time", fields: ["_creationTime"], ref: { id: id(12) } },
    { name: "by_name", fields: ["name"], ref: { id: id(13) } }] };
const schema = (fields: readonly string[] = ["name"]) => Result.getOrThrow(captureCoreSchema({ schemaValidation: false,
  tables: [{ tableName: "items", indexes: [{ indexDescriptor: "by_name", fields }], stagedDbIndexes: [] }] }));
const document = (state: "active" | "pending" | "validated", definition: CoreSchemaDefinition, n: number): CoreSystemDocument => ({
  id: Result.getOrThrow(encodeDocumentId(532, id(n))), creationTime: 0,
  value: { state: { state }, schema: Result.getOrThrow(serializeCoreSchema(definition)), native: `trusted-fixture-${n}` },
});
const schemas = (...documents: CoreSystemDocument[]) => Result.getOrThrow(CoreSchemaRegistry.bootstrap(
  documents.map(document => ({ namespace: null, document }))));
const pending: CoreIndexRecord = { name: "by_name", fields: ["other"], tableId: table.tabletId, ref: { id: id(14) }, ts: 1n,
  state: { type: "Backfilling", backfillState: { indexCreatedLowerBound: 0n, retentionStarted: false, staged: false } } };
const base = () => Result.getOrThrow(initialRegistry([table]));

// Exercise membership over the actual COW registries. Authentication of the
// stored native proof remains covered by the paired native lifecycle suites.
describe("native index generation membership", () => {
  it.each(["pending", "validated"] as const)("keeps same-name ordered specifications distinct during %s", state => {
    const old = schema(), next = schema(["other"]);
    const registry = Result.getOrThrow(base().withIndex(pending)).withSchemas(
      schemas(document("active", old, 21), document(state, next, 22)));
    expect(Result.isSuccess(checkCoreNativeTableIndexes(registry, table, { schema: old }, true))).toBe(true);
    expect(Result.isSuccess(checkCoreNativeTableIndexes(registry, table, { schema: next }, false))).toBe(true);
    expect(Result.isFailure(checkCoreNativeTableIndexes(registry, table, { schema: next }, true))).toBe(true);
  });

  it("refuses candidate-only specifications that are prematurely enabled", () => {
    const old = schema();
    const next = Result.getOrThrow(captureCoreSchema({ ...old, tables: [{ ...old.tables[0], indexes: [
      { indexDescriptor: "by_name", fields: ["name"] }, { indexDescriptor: "by_other", fields: ["other"] },
    ] }] }));
    const registry = Result.getOrThrow(base().withIndex({ ...pending, name: "by_other", state: { type: "Enabled" } }))
      .withSchemas(schemas(document("active", old, 21), document("pending", next, 22)));
    expect(Result.isFailure(checkCoreNativeTableIndexes(registry, table, { schema: next }, false))).toBe(true);
  });

  it.each([
    { type: "Backfilling", backfillState: { indexCreatedLowerBound: 0n, retentionStarted: false, staged: true } },
    { type: "Backfilled2", staged: true },
  ] satisfies CoreIndexRecord["state"][])("refuses staged candidate state $type", state => {
    const old = schema(), next = schema(["other"]);
    const registry = Result.getOrThrow(base().withIndex({ ...pending, state })).withSchemas(
      schemas(document("active", old, 21), document("pending", next, 22)));
    expect(Result.isFailure(checkCoreNativeTableIndexes(registry, table, { schema: next }, false))).toBe(true);
  });

  it("retains physical and expected list cardinality when specifications repeat", () => {
    const old = schema();
    const registry = base().withSchemas(schemas(document("active", old, 21)));
    const duplicatePhysical = Result.getOrThrow(registry.withIndex({ ...pending, fields: ["name"] }));
    expect(Result.isFailure(checkCoreNativeTableIndexes(duplicatePhysical, table, { schema: old }, false))).toBe(true);
    const duplicateExpected = { ...old, tables: old.tables.map(selected => ({ ...selected, indexes: [
      ...selected.indexes, ...selected.indexes,
    ] })) };
    expect(Result.isFailure(checkCoreNativeTableIndexes(registry, table, { schema: duplicateExpected }, true))).toBe(true);
  });

  it("refuses missing intrinsic indexes and changed ordered fields at equal cardinality", () => {
    const old = schema(["name", "other"]);
    const registry = Result.getOrThrow(initialRegistry([{ ...table, indexes: table.indexes.map(index =>
      index.name === "by_name" ? { ...index, fields: ["name", "other"] } : index) }]))
      .withSchemas(schemas(document("active", old, 21)));
    expect(Result.isSuccess(checkCoreNativeTableIndexes(registry, table, { schema: old }, true))).toBe(true);
    expect(Result.isFailure(checkCoreNativeTableIndexes(registry.withoutIndex(id(12)), table, { schema: old }, true))).toBe(true);
    const reversed = Result.getOrThrow(registry.withoutIndex(id(13)).withIndex({ name: "by_name", fields: ["other", "name"],
      tableId: table.tabletId, ref: { id: id(15) }, ts: 2n, state: { type: "Enabled" } }));
    expect(Result.isFailure(checkCoreNativeTableIndexes(reversed, table, { schema: old }, true))).toBe(true);
  });

  it.each(["pending", "validated"] as const)("parses %s before refusing a physical count mismatch", state => {
    const old = schema(), broken = document(state, old, 22);
    const selected = schemas(document("active", old, 21), { ...broken, value: { ...broken.value, schema: "{" } });
    const reads = vi.spyOn(selected, "nativeByState");
    try {
      const result = checkCoreNativeTableIndexes(base().withoutIndex(id(12)).withSchemas(selected), table, { schema: old }, true);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.cause).toBeInstanceOf(CoreSchemaError);
      expect(reads.mock.calls.map(call => call[1])).toEqual(state === "pending" ? ["active", "pending"] : ["active", "pending", "validated"]);
    } finally { reads.mockRestore(); }
  });

  it("uses the current active schema root after a successful earlier validation", () => {
    const old = schema(), active = document("active", old, 21);
    const selected = schemas(active);
    const registry = base().withSchemas(selected);
    expect(Result.isSuccess(checkCoreNativeTableIndexes(registry, table, { schema: old }, true))).toBe(true);
    const removed = Result.getOrThrow(captureCoreSchema({ ...old, tables: [{ ...old.tables[0], indexes: [] }] }));
    const changed = Result.getOrThrow(selected.withDocument(null, active, document("active", removed, 21)));
    expect(Result.isFailure(checkCoreNativeTableIndexes(registry.withSchemas(changed), table, { schema: old }, true))).toBe(true);
    expect(Result.isSuccess(checkCoreNativeTableIndexes(registry, table, { schema: old }, true))).toBe(true);
  });
});

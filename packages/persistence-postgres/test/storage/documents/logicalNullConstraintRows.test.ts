import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { prepareLogicalRelationalRows } from "../../../src/storage/documents/logicalDocuments/relationalRows";

const origin = { kind: "synthetic", sourceId: "neutral.null-row-mechanics" };
const normalized = Result.getOrThrow(normalizeRelationalSchema({ owner: "system", lineageId: "neutral-null-row", capabilities: [],
  tables: [{ tableId: "entry", origin, columns: ["id", "parent", "provider", "province", "retired"].map(columnId => ({
    columnId, type: "text", nullable: columnId !== "id", default: { kind: "none" }, origin,
  })), keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], relationships: [], constraints: [
    { constraintId: "entry.provider", kind: "nullImplication", nonNullColumnId: "parent", requiredColumnId: "provider", required: "null", origin },
    { constraintId: "entry.province", kind: "nullImplication", nonNullColumnId: "parent", requiredColumnId: "province", required: "notNull", origin },
  ] }] }));
const table = normalized.tables[0];
if (table === undefined) throw new Error("Missing neutral row table");
const policy = Result.getOrThrow(prepareLogicalRelationalRows(table, [], (reason, cause) => ({ reason, cause })));
const time = "2026-10-22T00:00:00.000Z";

describe("complete-row null constraints", () => {
  it("applies nullable defaults before checking a newly initialized row", () => {
    expect(Result.getOrThrow(policy.normalize({ id: "root", provider: "provider" }, null, time)))
      .toEqual({ id: "root", parent: null, provider: "provider", province: null, retired: null });
    expect(policy.normalize({ id: "child", parent: "parent" }, null, time))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid", cause: { reason: "constraintViolation", column: "province" } } });
  });

  it("validates the merged row, allowing a complete simultaneous transition", () => {
    const previous = Result.getOrThrow(policy.normalize({ id: "row", provider: "provider" }, null, time));
    expect(policy.normalize({ parent: "parent", province: "province" }, previous, time))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid", cause: { column: "provider" } } });
    expect(Result.getOrThrow(policy.normalize({ parent: "parent", province: "province", provider: null }, previous, time)))
      .toEqual({ id: "row", parent: "parent", province: "province", provider: null, retired: null });
    expect(previous.provider).toBe("provider");
    expect(previous.parent).toBeNull();
  });

  it("keeps deleted preimages and reconstruction subject to the same checks", () => {
    const previous = Result.getOrThrow(policy.normalize({ id: "row", parent: "parent", province: "province", retired: time }, null, time));
    expect(Result.getOrThrow(policy.normalize({ retired: null }, previous, time))).toEqual({ ...previous, retired: null });
    expect(policy.normalize({ provider: "provider" }, previous, time))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid", cause: { column: "provider" } } });
    expect(policy.normalize({ ...previous, province: null }, null, time, "preserve"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid", cause: { column: "province" } } });
  });

  it("classifies an invalid complete stored row as corruption", () => {
    const invalid = { id: "row", parent: "parent", provider: "provider", province: "province", retired: time };
    expect(policy.validate(invalid, "storedCorruption"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption", cause: { reason: "constraintViolation", column: "provider" } } });
  });
});

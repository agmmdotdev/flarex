import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CompiledCheckConstraint, lowerCompiledCheckConstraint } from "../src/schema/check-constraint";
import { CompiledIndexWhere, lowerCompiledIndexWhere } from "../src/schema/index-predicate";

const decodeCheck = Schema.decodeUnknownResult(CompiledCheckConstraint, { onExcessProperty: "error" });
const decodeWhere = Schema.decodeUnknownResult(CompiledIndexWhere);

describe("checked native DML null and Boolean spellings", () => {
  it.each([
    ["owner_id IS NULL OR delegate_id IS NULL", "null"],
    ["owner_id IS NULL OR area_code IS NOT NULL", "notNull"],
  ] as const)("preserves and lowers %s", (expression, required) => {
    const input = { name: "neutral_check", expression };
    const checked = Result.getOrThrow(decodeCheck(input));
    expect(checked).toEqual(input);
    expect(lowerCompiledCheckConstraint(checked)).toEqual({
      constraintId: input.name, kind: "nullImplication", nonNullColumnId: "owner_id",
      requiredColumnId: required === "null" ? "delegate_id" : "area_code", required,
    });
  });

  it.each([
    "owner_id IS NULL AND delegate_id IS NULL",
    "owner_id IS NOT NULL OR delegate_id IS NULL",
    '"owner_id" IS NULL OR delegate_id IS NULL',
    "owner.id IS NULL OR delegate_id IS NULL",
    "owner-id IS NULL OR delegate_id IS NULL",
    "owner_id is null OR delegate_id IS NULL",
    "owner_id IS NULL OR  delegate_id IS NULL",
    "owner_id IS NULL OR delegate_id IS NULL\n",
    "owner_id IS NULL OR delegate_id IS NULL; SELECT 1",
    "owner_id IS NULL OR delegate_id IS NULL /* active */",
    "owner_id IS NULL OR delegate_id IS NULL OR other_id IS NULL",
    `${"x".repeat(257)} IS NULL OR delegate_id IS NULL`,
  ])("refuses an unadmitted check expression: %s", expression => {
    expect(Result.isFailure(decodeCheck({ name: "neutral_check", expression }))).toBe(true);
  });

  it("refuses unknown check properties and non-string predicates", () => {
    for (const input of [
      { name: "check", expression: false },
      { name: "check", expression: "owner_id IS NULL OR delegate_id IS NULL", sql: "true" },
    ]) expect(Result.isFailure(decodeCheck(input))).toBe(true);
  });

  it.each([
    ['"enabled" = true AND deleted_at IS NULL', true],
    ['"enabled" = false AND deleted_at IS NULL', false],
    ["enabled = true AND deleted_at IS NULL", true],
    ["enabled = false AND deleted_at IS NULL", false],
  ] as const)("retains Boolean meaning for %s", (where, value) => {
    const checked = Result.getOrThrow(decodeWhere(where));
    expect(checked).toBe(where);
    expect(lowerCompiledIndexWhere(checked)).toEqual({ kind: "isNullAndBooleanEquals",
      nullColumnId: "deleted_at", booleanColumnId: "enabled", value });
  });

  it("lowers exactly the native two-null active conjunction", () => {
    const where = "area_code IS NULL AND deleted_at IS NULL";
    expect(lowerCompiledIndexWhere(Result.getOrThrow(decodeWhere(where))))
      .toEqual({ kind: "allNull", columnIds: ["area_code", "deleted_at"] });
    expect(lowerCompiledIndexWhere("deleted_at IS NULL")).toEqual({ kind: "isNull", columnId: "deleted_at" });
    expect(lowerCompiledIndexWhere("deleted_at IS NULL AND status = 'active'"))
      .toEqual({ kind: "isNullAndTextEquals", nullColumnId: "deleted_at", textColumnId: "status", value: "active" });
    expect(lowerCompiledIndexWhere(undefined)).toBeNull();
  });

  it("preserves native not-null spellings and canonicalizes both mixed operand orders", () => {
    for (const where of ["parent_id IS NOT NULL AND deleted_at IS NULL", "deleted_at IS NULL AND parent_id IS NOT NULL"])
      expect(lowerCompiledIndexWhere(Result.getOrThrow(decodeWhere(where))))
        .toEqual({ kind: "isNullAndNotNull", nullColumnId: "deleted_at", notNullColumnId: "parent_id" });
    expect(lowerCompiledIndexWhere(Result.getOrThrow(decodeWhere("deleted_at IS NOT NULL"))))
      .toEqual({ kind: "isNotNull", columnId: "deleted_at" });
  });

  it.each([
    "enabled = TRUE AND deleted_at IS NULL",
    "enabled = true OR deleted_at IS NULL",
    "enabled = true AND deleted_at IS NULL\n",
    "owner.enabled = true AND deleted_at IS NULL",
    "enabled-name = true AND deleted_at IS NULL",
    "enabled = true AND deleted_at IS NULL; SELECT 1",
    "area_code IS NOT NULL OR deleted_at IS NULL",
    "deleted_at IS NOT NULL\n",
    "deleted_at IS NOT NULL; SELECT 1",
    '"deleted_at" IS NOT NULL',
    "deleted_at IS NULL AND area_code IS NOT NULL AND other_id IS NULL",
    "area_code IS NULL OR deleted_at IS NULL",
    "area.code IS NULL AND deleted_at IS NULL",
    '"area_code" IS NULL AND deleted_at IS NULL',
    "area_code IS NULL AND deleted_at IS NULL\n",
    "area_code IS NULL AND deleted_at IS NULL AND other_id IS NULL",
    `${"x".repeat(257)} IS NULL AND deleted_at IS NULL`,
  ])("refuses an unadmitted index predicate: %s", where => {
    expect(Result.isFailure(decodeWhere(where))).toBe(true);
  });
});

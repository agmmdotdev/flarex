import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, validateRelationalRowValues } from "flarex-protocol/internal/relational-schema";
import { bindPreparedLogicalRelationalRows, prepareLogicalRelationalRowValues, prepareLogicalRelationalTableMechanics } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { inspectLogicalRelationalFailure } from "../../../src/storage/documents/logicalDocuments/relationalFailure";
import { logicalCommerceError } from "../../../src/frameworks/commerceTransaction/model";

const origin = { kind: "synthetic", sourceId: "logical-constraint-failure" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "system", lineageId: origin.sourceId, capabilities: [], tables: [
  { tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type: "integer", nullable: true, default: { kind: "none" }, origin },
    { columnId: "code", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "parent", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "label", type: "text", nullable: false, default: { kind: "textLiteral", value: "default" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [
    { constraintId: "a.amount", kind: "integerRange", columnId: "amount", minimum: 0, maximum: 100, origin },
    { constraintId: "b.code", kind: "textSet", columnId: "code", values: ["allowed"], origin },
    { constraintId: "c.parent", kind: "nullImplication", nonNullColumnId: "code", requiredColumnId: "parent", required: "notNull", origin },
  ], relationships: [] },
] }));
const table = schema.tables[0];
if (table === undefined) throw new Error("Missing CHECK test table");
const identity = table.identity;
const policy = Result.getOrThrow(bindPreparedLogicalRelationalRows(prepareLogicalRelationalTableMechanics(table, []), logicalCommerceError));

describe("CHECK evidence from the actual ordered relational row verdict", () => {
  it.each([
    [{ id: "row", amount: -1, code: "invalid" }, "a.amount", "amount"],
    [{ id: "row", amount: null, code: "invalid" }, "b.code", "code"],
    [{ id: "row", amount: null, code: "allowed" }, "c.parent", "parent"],
  ] as const)("retains selected constraint %s without re-evaluating later checks", (input, constraintId, column) => {
    const rejected = policy.normalize(input, null, "2026-10-24T00:00:00.000Z");
    if (Result.isSuccess(rejected)) throw new Error("Expected CHECK rejection");
    const constraint = table.constraints.find(item => item.identity.constraintId === constraintId);
    if (constraint === undefined) throw new Error("Missing selected constraint");
    expect(rejected.failure).toMatchObject({ reason: "invalidInput", cause: { reason: "constraintViolation", column, constraint: constraint.identity } });
    const evidence = inspectLogicalRelationalFailure(rejected.failure);
    expect(evidence).toEqual({ origin: "row", kind: "check", table: identity, column, constraint: constraint.identity,
      candidate: { ...input, parent: null, label: "default" } });
    expect(Object.isFrozen(evidence)).toBe(true);
    if (evidence?.kind !== "check") throw new Error("Expected CHECK evidence");
    expect(Object.isFrozen(evidence.constraint)).toBe(true);
    expect(Object.isFrozen(evidence.candidate)).toBe(true);
    expect(inspectLogicalRelationalFailure({ ...rejected.failure })).toBeUndefined();
  });

  it("retains the protocol's actual constraint identity while stored failures stay unissued", () => {
    const row = { id: "row", amount: -1, code: null, parent: null, label: "default" };
    const direct = validateRelationalRowValues(table, row);
    if (Result.isSuccess(direct)) throw new Error("Expected protocol CHECK failure");
    expect(direct.failure).toMatchObject({ reason: "constraintViolation", column: "amount", constraint: table.constraints[0]?.identity });
    const rejected = prepareLogicalRelationalRowValues(table, [], logicalCommerceError)(row, "storedCorruption");
    if (Result.isSuccess(rejected)) throw new Error("Expected stored corruption");
    expect(rejected.failure.reason).toBe("storedCorruption");
    expect(inspectLogicalRelationalFailure(rejected.failure)).toBeUndefined();
  });

  it("keeps NULL CHECK semantics, required fields and successful defaults unchanged", () => {
    expect(Result.getOrThrow(policy.normalize({ id: "row" }, null, "2026-10-24T00:00:00.000Z")))
      .toEqual({ id: "row", amount: null, code: null, parent: null, label: "default" });
    const failed = policy.normalize({ id: null }, null, "2026-10-24T00:00:00.000Z");
    if (Result.isSuccess(failed)) throw new Error("Expected required failure before CHECK");
    expect(inspectLogicalRelationalFailure(failed.failure)).toMatchObject({ kind: "null", origin: "input", column: "id" });
  });
});

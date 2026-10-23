import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileLogicalRelationalRead, logicalRelationalSelectionValues } from "../../../src/storage/documents/logicalDocuments/relationalQuery";

const origin = { kind: "synthetic", sourceId: "neutral-timestamp-comparison" } as const;
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-timestamp-comparison",
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "revoked_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: "entry.revoked", kind: "btree", columns: ["revoked_at"], predicate: null, origin }],
  constraints: [], relationships: [] }], capabilities: [] }));
const table = schema.tables[0];
if (table === undefined) throw new Error("Missing neutral timestamp table");
const boundary = "2026-10-23T00:00:00.000Z";
const compile = (kind: string, column = "revoked_at", value = boundary, indexes = table.indexes) => compileLogicalRelationalRead({ ...table, indexes }, schema.capabilities, {
  fields: ["id"], order: { column: "id", direction: "asc" }, predicate: {
    kind, column, value,
  },
}, 4, reason => new Error(reason));

describe("indexed timestamp comparison admission", () => {
  it("retains the existing greater-than timestamp contract", () => {
    expect(Result.isSuccess(compile("greaterThan"))).toBe(true);
  });

  it("admits the less-than timestamp predicate required by native revocation", () => {
    const query = Result.getOrThrow(compile("lessThan"));
    expect(query.selections).toEqual([{ column: "revoked_at", value: { gt: null, lt: boundary } }]);
    const selected = query.selections?.[0];
    if (selected === undefined) throw new Error("Missing timestamp range selection");
    expect(logicalRelationalSelectionValues(selected).value("revoked_at")).toEqual({ gt: null, lt: boundary });
    for (const [revoked_at, matches] of [["2026-10-22T23:59:59.999Z", true], [boundary, false],
      ["2026-10-23T00:00:00.001Z", false], [null, false]] as const)
      expect(Result.getOrThrow(query.inspect({ id: "entry", revoked_at })).matches).toBe(matches);
  });

  it("preserves indexed admission and timestamp-only operands", () => {
    for (const result of [compile("lessThan", "id"), compile("lessThan", "missing"),
      compile("lessThan", "revoked_at", "not-a-date"), compile("lessThan", "revoked_at", "2026-10-23T00:00:00+00:00"),
      compile("lessThan", "revoked_at", boundary, [])])
      expect(result).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  });
});

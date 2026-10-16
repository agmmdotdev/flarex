import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileLogicalRelationalRead, prepareLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { prepareLogicalRelationalTableMechanics } from "../../../src/storage/documents/logicalDocuments/relationalRows";

const failure = (reason: string) => new Error(reason);
const origin = { kind: "synthetic", sourceId: "neutral.conjunctive-point-planner" };
const tableFor = (columns = ["left_id", "right_id"], allRows = false) => {
  const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-conjunctive-point-planner", capabilities: [], tables: [{
    tableId: "pair", origin, columns: ["id", "left_id", "right_id", "third", "fourth", "label", "deleted_at"].map(columnId => ({
      columnId, type: "text", nullable: columnId === "deleted_at", default: { kind: "none" }, origin,
    })), keys: [{ keyId: "pair.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "pair.left-active", kind: "btree", columns: ["left_id"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
      { indexId: "pair.right-active", kind: "btree", columns: ["right_id"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
      { indexId: "pair.active", kind: "uniqueBtree", columns, predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
      ...(allRows ? [{ indexId: "pair.all", kind: "uniqueBtree", columns, predicate: null, origin }] : []),
    ], constraints: [], relationships: [],
  }] }));
  const table = schema.tables[0]; if (table === undefined) throw new Error("Missing neutral tuple table"); return table;
};
const membership = (column: string, values: readonly (string | boolean)[]) => ({ kind: "in", column, values });
const active = { kind: "isNull", column: "deleted_at" };
const query = (children: readonly unknown[]) => ({ order: { column: "id", direction: "asc" }, predicate: { kind: "and", children } });
const row = { id: "pair-a", left_id: "a", right_id: "r", third: "t", fourth: "f", label: "retained", deleted_at: null };

describe("conjunctive complete-point planning", () => {
  it("derives the existing index order independently of conjunct order and compact metadata", () => {
    const table = tableFor();
    for (const children of [[membership("left_id", ["a"]), membership("right_id", ["r"])],
      [membership("right_id", ["r"]), membership("left_id", ["a"])]]) {
      const input = query([...children, active]), compact = { ...table, indexes: [] };
      const full = Result.getOrThrow(prepareLogicalRelationalRead(table, [], input, 8, failure));
      expect(full.demand).toEqual({ fields: ["left_id", "right_id"], nulls: ["deleted_at"], points: [["left_id", "right_id"]] });
      const prepared = Result.getOrThrow(prepareLogicalRelationalRead(compact, [], input, 8, failure,
        prepareLogicalRelationalTableMechanics(compact, [])));
      expect(prepared.demand.points).toEqual([]);
      const access = { indexes: table.indexes, keys: table.keys, scalarColumns: [] };
      expect(prepared.pointDemand(access)).toEqual(full.demand);
      const selected = Result.getOrThrow(prepared.compile(access)), direct = Result.getOrThrow(full.compile());
      expect(selected.selections).toEqual(direct.selections);
      expect(selected.selections).toEqual([{ kind: "point", columns: ["left_id", "right_id"], values: ["a", "r"], nullColumn: "deleted_at" }]);
      expect(Result.getOrThrow(selected.inspect(row)).matches).toBe(true);
      expect(Result.getOrThrow(selected.inspect({ ...row, left_id: "neighbor" })).matches).toBe(false);
      expect(Result.getOrThrow(selected.inspect({ ...row, deleted_at: "deleted" })).matches).toBe(false);
    }
  });

  it("retains native OR tuples, empty ID branches, residual checks and nested ANDs", () => {
    const table = tableFor();
    const input = query([{ kind: "or", children: [membership("id", []),
      { kind: "and", children: [membership("right_id", ["r"]), { kind: "and", children: [membership("left_id", ["a"])] }] },
      { kind: "and", children: [membership("left_id", ["b"]), membership("right_id", ["s"])] },
    ] }, active, { kind: "textNotEqual", column: "label", value: "hidden" }]);
    const prepared = Result.getOrThrow(prepareLogicalRelationalRead(table, [], input, 8, failure));
    expect(prepared.demand.points).toEqual([["left_id", "right_id"]]);
    const plan = Result.getOrThrow(prepared.compile());
    expect(plan.selections).toEqual([
      { kind: "point", columns: ["left_id", "right_id"], values: ["a", "r"], nullColumn: "deleted_at" },
      { kind: "point", columns: ["left_id", "right_id"], values: ["b", "s"], nullColumn: "deleted_at" },
    ]);
    expect(Result.getOrThrow(plan.inspect({ ...row, label: "hidden" })).matches).toBe(false);
    expect(Result.getOrThrow(plan.inspect({ ...row, right_id: "s" })).matches).toBe(false);
  });

  it("preserves unrelated scalar equalities as residual checks outside the indexed tuple envelope", () => {
    const table = tableFor(), input = query([membership("right_id", ["r"]), membership("left_id", ["a"]),
      membership("label", Array.from({ length: 17 }, (_, index) => "label-" + index)), membership("third", ["t"]),
      membership("fourth", ["f"]), active]);
    const prepared = Result.getOrThrow(prepareLogicalRelationalRead(table, [], input, 8, failure));
    expect(prepared.demand.points).toEqual([["left_id", "right_id"]]);
    const plan = Result.getOrThrow(prepared.compile());
    expect(plan.selections).toEqual([{ kind: "point", columns: ["left_id", "right_id"], values: ["a", "r"], nullColumn: "deleted_at" }]);
    expect(Result.getOrThrow(plan.inspect({ ...row, label: "label-1" })).matches).toBe(true);
    expect(Result.getOrThrow(plan.inspect(row)).matches).toBe(false);
    expect(Result.getOrThrow(plan.inspect({ ...row, label: "label-1", third: "wrong" })).matches).toBe(false);
  });

  it("retains primary unique points and contradictory or empty constraints", () => {
    const table = tableFor(), pair = [membership("right_id", ["r"]), membership("left_id", ["a"])];
    expect(Result.getOrThrow(compileLogicalRelationalRead(table, [], query([...pair, membership("id", ["pair-a"]), active]), 8, failure)).selections)
      .toEqual([{ column: "id", value: "pair-a" }]);
    for (const children of [[...pair, membership("left_id", ["other"]), active], [membership("left_id", []), membership("right_id", ["r"]), active]])
      expect(Result.getOrThrow(compileLogicalRelationalRead(table, [], query(children), 8, failure)).selections).toEqual([]);
    expect(Result.getOrThrow(compileLogicalRelationalRead(table, [], query([
      membership("left_id", ["a", "b", "a"]), membership("left_id", ["a"]), membership("right_id", ["r"]), active,
    ]), 8, failure)).selections).toEqual([{ kind: "point", columns: ["left_id", "right_id"], values: ["a", "r"], nullColumn: "deleted_at" }]);
  });

  it("uses only eligible partial indexes and retains all-row semantics", () => {
    const table = tableFor(), children = [membership("right_id", ["r"]), membership("left_id", ["a"])];
    const all = Result.getOrThrow(compileLogicalRelationalRead(tableFor(undefined, true), [], query(children), 8, failure));
    expect(all.selections).toEqual([{ kind: "point", columns: ["left_id", "right_id"], values: ["a", "r"] }]);
    const activePlan = Result.getOrThrow(compileLogicalRelationalRead(tableFor(undefined, true), [], query([...children, active]), 8, failure));
    expect(activePlan.selections).toEqual([{ kind: "point", columns: ["left_id", "right_id"], values: ["a", "r"], nullColumn: "deleted_at" }]);
    expect(compileLogicalRelationalRead(table, [], query(children), 8, failure)).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  });

  it("keeps bounded scalar planning when a later descriptor is hidden by existing scalar facets", () => {
    const table = tableFor(), compact = { ...table, indexes: [] };
    const prepared = Result.getOrThrow(prepareLogicalRelationalRead(compact, [], query([membership("right_id", ["r"]), membership("left_id", ["a"]), active]), 8, failure));
    const scalarOnly = { indexes: table.indexes.filter(index => index.kind === "btree"), keys: table.keys, scalarColumns: [] };
    expect(prepared.pointDemand(scalarOnly)).toBe(prepared.demand);
    expect(Result.getOrThrow(prepared.compile(scalarOnly)).selections).toEqual([{ column: "right_id", value: "r", nullColumn: "deleted_at" }]);
  });

  it("does not combine OR alternatives into invented tuples or collapse residual predicates", () => {
    const table = tableFor(), input = query([{ kind: "or", children: [membership("left_id", ["a"]), membership("right_id", ["r"])] }, active]);
    const prepared = Result.getOrThrow(prepareLogicalRelationalRead(table, [], input, 8, failure));
    expect(prepared.demand.points).toEqual([]);
    expect(Result.getOrThrow(prepared.compile()).selections?.every(selection => selection.kind !== "point")).toBe(true);
    const residual = Result.getOrThrow(compileLogicalRelationalRead(table, [], query([
      membership("left_id", ["a"]), { kind: "textNotEqual", column: "right_id", value: "s" }, active,
    ]), 8, failure));
    expect(residual.selections).toEqual([{ column: "left_id", value: "a", nullColumn: "deleted_at" }]);
    expect(Result.getOrThrow(residual.inspect({ ...row, right_id: "s" })).matches).toBe(false);
  });

  it("keeps the existing sixteen-point envelope for inferred two-through-four-field keys", () => {
    for (const columns of [["left_id", "right_id"], ["left_id", "right_id", "third"], ["left_id", "right_id", "third", "fourth"]]) {
      const table = tableFor(columns), children = columns.toReversed().map(column => membership(column, ["a", "b"]));
      const plan = Result.getOrThrow(compileLogicalRelationalRead(table, [], query([...children, active]), 8, failure));
      expect(plan.selections).toHaveLength(2 ** columns.length);
      expect(plan.selections?.every(selection => selection.kind === "point" && JSON.stringify(selection.columns) === JSON.stringify(columns))).toBe(true);
    }
    const table = tableFor(), prepared = Result.getOrThrow(prepareLogicalRelationalRead(table, [], query([
      membership("left_id", Array.from({ length: 17 }, (_, index) => "left-" + index)), membership("right_id", ["r"]), active,
    ]), 8, failure));
    expect(prepared.demand.points).toEqual([]);
    expect(Result.getOrThrow(prepared.compile()).selections).toEqual([{ column: "right_id", value: "r", nullColumn: "deleted_at" }]);
  });
});

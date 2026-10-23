import { Result } from "effect";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { compileLogicalRelationalRead, relationalReadLimits } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { buildPostgresRelationalPredicateBody, preparePostgresRelationalBatch } from "../../../src/storage/documents/logicalDocuments/postgresRelationalPredicate";
import { numberMembershipSchema } from "../relationalSchema/numberMembershipSchema";

const table = numberMembershipSchema.tables[0];
if (table === undefined) throw new Error("Missing neutral number membership table");
const failure = (reason: string) => new Error(reason);
const order = { column: "id", direction: "asc" };
const anchor = { kind: "in", column: "cohort", values: ["selected"] };
const membership = (column: string, values: readonly unknown[]) => ({ kind: "numberIn", column, values });
const compile = (column: string, values: readonly unknown[], postgres = false) => compileLogicalRelationalRead(table, [], {
  fields: ["id"], order, predicate: { kind: "and", children: [anchor, membership(column, values),
    ...(postgres ? [{ kind: "postgresText", column: "id", operator: "like", value: "%" }] : [])] },
}, 8, failure);
const row = { id: "a", cohort: "selected", version: 1, measure: 1e-7, amount: "1.0000", real_measure: null };

describe("finite integer and binary64 terminal membership", () => {
  it("retains the indexed parent cohort and native signed integer equality", () => {
    const query = Result.getOrThrow(compile("version", [1, 1, -2147483648, 2147483647]));
    expect(query.selections).toEqual([{ column: "cohort", value: "selected" }]);
    expect(Result.getOrThrow(query.inspect(row)).matches).toBe(true);
    expect(Result.getOrThrow(query.inspect({ ...row, version: 2 })).matches).toBe(false);
    expect(Result.getOrThrow(query.inspect({ ...row, version: -2147483648 })).matches).toBe(true);
    expect(Result.getOrThrow(query.inspect({ ...row, version: 2147483647 })).matches).toBe(true);
  });

  it("uses binary64 equality for exponent spellings, extrema, signed zero and absence", () => {
    const values = [1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE, -0];
    const query = Result.getOrThrow(compile("measure", values));
    values.splice(0, values.length, 17);
    for (const measure of [1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE, 0])
      expect(Result.getOrThrow(query.inspect({ ...row, measure })).matches).toBe(true);
    for (const measure of [null, 17, 1.0000000000000002])
      expect(Result.getOrThrow(query.inspect({ ...row, measure })).matches).toBe(false);
  });

  it("refuses coercion, nonfinite numbers, wrong numeric owners and invalid int32 values", () => {
    for (const [column, value] of [
      ["measure", null], ["measure", "1"], ["measure", true], ["measure", {}],
      ["measure", Number.NaN], ["measure", Number.POSITIVE_INFINITY], ["measure", Number.NEGATIVE_INFINITY],
      ["version", 1.5], ["version", -2147483649], ["version", 2147483648],
      ["amount", 1], ["real_measure", 1], ["cohort", 1], ["missing", 1],
    ] as const) expect(compile(column, [value])).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    expect(compileLogicalRelationalRead(table, [], { order, predicate: { ...membership("measure", [1]), extra: true } }, 8, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  });

  it("keeps exact-decimal and ordinary membership contracts unchanged", () => {
    for (const predicate of [
      { kind: "in", column: "version", values: [1] },
      { kind: "numericIn", column: "measure", values: [1] },
    ]) expect(compileLogicalRelationalRead(table, [], { order, predicate }, 8, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    const exact = Result.getOrThrow(compileLogicalRelationalRead(table, [], { order,
      predicate: { kind: "and", children: [anchor, { kind: "numericIn", column: "amount", values: ["1.0000000000000000001"] }] } }, 8, failure));
    expect(Result.getOrThrow(exact.inspect(row)).matches).toBe(false);
  });

  it("charges duplicate raw operands and preserves empty membership without a numeric access path", () => {
    const limit = relationalReadLimits.filterOperands;
    expect(compile("version", Array.from({ length: limit }, () => 1)))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
    expect(compile("version", Array.from({ length: limit - 1 }, () => 1))).toMatchObject({ _tag: "Success" });
    expect(Result.getOrThrow(compile("version", [])).selections).toEqual([]);
    const terminal = Result.getOrThrow(compileLogicalRelationalRead(table, [], { order, predicate: membership("version", [1]) }, 8, failure));
    expect(terminal.selections).toBeNull();
  });

  it("validates complete persisted rows before sparse projection or an empty result", () => {
    for (const query of [Result.getOrThrow(compile("version", [2])), Result.getOrThrow(compile("version", [], true))]) {
      expect(query.inspectRow({ ...row, version: 1.5 })).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      expect(query.inspectRow({ ...row, measure: "1e-7" })).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    }
  });

  it("lowers the entire mixed PostgreSQL tree with binary64 casts and detached operands", () => {
    const values = [1e-7, 1e21, -0], query = Result.getOrThrow(compile("measure", values, true));
    values.splice(0, values.length, 77);
    if (query.postgresPredicate === undefined) throw new Error("Missing genuine PostgreSQL predicate program");
    const tableId = decodeCatalogTableId(1), batch = Result.getOrThrow(preparePostgresRelationalBatch(query.postgresPredicate,
      table, tableId, [row], { rows: 8, bytes: 8192 }, failure));
    const statement = new PgDialect().sqlToQuery(Result.getOrThrow(buildPostgresRelationalPredicateBody(batch, tableId, failure)));
    expect(statement.sql).toContain("::double precision in (");
    expect(statement.sql).toContain(" like ");
    expect(statement.params).toEqual(expect.arrayContaining(["1e-7", "1e+21", "0"]));
    expect(statement.params).not.toContain("77");
    expect(query.selections).toEqual([{ column: "cohort", value: "selected" }]);
  });
});

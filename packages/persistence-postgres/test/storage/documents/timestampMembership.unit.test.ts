import { Result } from "effect";
import { it, expect } from "vitest";
import { compileLogicalRelationalRead, prepareLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { timestampMembershipSchema as schema, timestampMembershipBoundary as boundary, timestampMembershipQuery } from "./timestampMembership.schema";
const table = schema.tables[0];
if (table === undefined) throw new Error("Missing neutral timestamp membership table");
const failure = (reason: string) => new Error(reason);
const membership = (values: unknown, column = "starts_at") => ({ kind: "in", column, values });
const compile = (predicate: unknown) => compileLogicalRelationalRead(table, schema.capabilities, timestampMembershipQuery(predicate), 8, failure);
const row = (starts_at: string | null) => ({ id: "selected", cohort: "bounded", starts_at, unindexed_at: starts_at, partial_at: starts_at, deleted_at: null });

it("admits only canonical UTC-millisecond timestamp literals, including supported year endpoints", () => {
  for (const stamp of ["0001-01-01T00:00:00.000Z", boundary, "9999-12-31T23:59:59.999Z"])
    expect(Result.getOrThrow(compile(membership([stamp]))).selections).toEqual([{ column: "starts_at", value: stamp }]);
  for (const value of ["0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "2026-02-30T00:00:00.000Z",
    "2026-10-29T10:00:00Z", "2026-10-29T10:00:00.000+00:00", "2026-10-29t10:00:00.000z", " " + boundary,
    "2026-10-29T10:00:00.0001Z", "infinity", "NaN", true, 1, new Date(boundary)])
    expect(compile(membership([value]))).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
});

it("retains native timestamp equality, NULL, empty and duplicate membership semantics", () => {
  const values: Array<string | null> = [boundary, null, boundary];
  const query = Result.getOrThrow(compile(membership(values)));
  expect(query.selections).toEqual([{ column: "starts_at", value: boundary }]);
  values[0] = "2026-10-29T10:00:00.001Z";
  expect(Result.getOrThrow(query.inspect(row(boundary))).matches).toBe(true);
  expect(Result.getOrThrow(query.inspect(row(null))).matches).toBe(false);
  expect(Result.getOrThrow(query.inspect(row("2026-10-29T10:00:00.001Z"))).matches).toBe(false);
  expect(Result.getOrThrow(compile(membership([]))).selections).toEqual([]);
  expect(Result.getOrThrow(compile(membership([null]))).selections).toEqual([]);
  expect(compile(membership(Array.from({ length: 257 }, () => boundary))))
    .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
});

it("requires an eligible timestamp equality index or existing bounded anchor and preserves partial-index qualification", () => {
  expect(compile(membership([boundary], "unindexed_at")))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  for (const anchor of [{ kind: "in", column: "id", values: ["selected"] }, { kind: "in", column: "cohort", values: ["bounded"] }]) {
    const query = Result.getOrThrow(compile({ kind: "and", children: [anchor, membership([boundary], "unindexed_at")] }));
    expect(query.selections).toEqual([{ column: anchor.column, value: anchor.values[0] }]);
    expect(Result.getOrThrow(query.inspect(row(boundary))).matches).toBe(true);
  }
  expect(compile(membership([boundary], "partial_at")))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  expect(Result.getOrThrow(compile({ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, membership([boundary], "partial_at")] })).selections)
    .toEqual([{ column: "partial_at", value: boundary, nullColumn: "deleted_at" }]);
  const prepared = Result.getOrThrow(prepareLogicalRelationalRead(table, [], timestampMembershipQuery(membership([boundary], "unindexed_at")), 8, failure));
  expect(prepared.demand.fields).toContain("unindexed_at");
  expect(prepared.compile({ indexes: [], keys: table.keys, scalarColumns: [] }))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
});

it("retains the native inclusive start boundary as less-than OR exact equality", () => {
  const query = Result.getOrThrow(compile({ kind: "or", children: [
    { kind: "lessThan", column: "starts_at", value: boundary }, membership([boundary]),
  ] }));
  expect(query.selections).toHaveLength(2);
  for (const [stamp, expected] of [["2026-10-29T09:59:59.999Z", true], [boundary, true], ["2026-10-29T10:00:00.001Z", false], [null, false]] as const)
    expect(Result.getOrThrow(query.inspect(row(stamp))).matches).toBe(expected);
});

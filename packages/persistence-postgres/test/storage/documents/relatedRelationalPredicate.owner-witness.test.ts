import { Result } from "effect";
import { PgDialect } from "drizzle-orm/pg-core";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { expect, it } from "vitest";
import { compileLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { prepareRelatedRelationalPredicate, decodeRelatedRelationalQuery } from "../../../src/storage/documents/logicalDocuments/relatedRelationalPredicate";
import { preparePostgresRelationalBatch, decodePostgresRelationalMatches, inspectPostgresRelationalBatch } from "../../../src/values/postgresRelationalPredicate";
import { buildPostgresRelationalPredicateBody } from "../../../src/database/postgresRelationalPredicate";
import { relatedPredicateParent, relatedPredicateChild, numericRelatedPredicate, relatedQuery } from "./relatedRelationalPredicate.schema";
const parent = relatedPredicateParent, child = relatedPredicateChild;
if (parent === undefined || child === undefined) throw new Error("Missing genuine neutral tables");
const failure = (reason: string) => new Error(reason);
const tableId = decodeCatalogTableId(1), childId = decodeCatalogTableId(2);
const prepare = (predicate: unknown = numericRelatedPredicate, foreignKey = "child.parent") =>
  prepareRelatedRelationalPredicate(parent, child, childId, [],
    Result.getOrThrow(decodeRelatedRelationalQuery({ ...relatedQuery(predicate), foreignKey })), 8, failure);

it("admits a checked parent/child program while preserving scalar dotted-column refusal", () => {
  expect(compileLogicalRelationalRead(parent, [], { fields: ["id"], order: { column: "id", direction: "asc" },
    predicate: { kind: "and", children: [
      { kind: "in", column: "id", values: ["selected"] },
      { kind: "postgresNumericCast", column: "children.value", operator: "gt", value: 2 },
    ] } }, 8, failure)).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  const prepared = Result.getOrThrow(prepare());
  const batch = Result.getOrThrow(preparePostgresRelationalBatch(prepared.program, parent, tableId,
    [{ id: "selected", attribute: "threshold", operator: "gte" }], { rows: 8, bytes: 8192 }, failure,
    { table: child, tableId: childId, rows: [{ id: "v", parent_id: "selected", value: "bad" }] }));
  expect(Result.getOrThrow(inspectPostgresRelationalBatch(batch, tableId, failure)).child).toEqual({ table: child, tableId: childId });
  const sql = new PgDialect().sqlToQuery(Result.getOrThrow(buildPostgresRelationalPredicateBody(batch, tableId, failure)));
  expect(sql.sql).toContain("left join child_rows child");
  expect(sql.sql).toContain("not in ("); expect(sql.sql).toContain("::numeric");
  expect(sql.params).toContain("value"); expect(sql.params).toContain("bad");
  expect(sql.sql).not.toContain("bad");
});

it("retains exact program and pair identity and refuses omitted, copied or mismatched authority", () => {
  const prepared = Result.getOrThrow(prepare());
  const args = [prepared.program, parent, tableId, [], { rows: 8, bytes: 8192 }, failure] as const;
  expect(preparePostgresRelationalBatch(...args)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  expect(preparePostgresRelationalBatch(...args, { table: { ...child }, tableId: childId, rows: [] }))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  expect(preparePostgresRelationalBatch(...args, { table: child, tableId, rows: [] }))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  expect(preparePostgresRelationalBatch({ ...prepared.program }, parent, tableId, [], { rows: 8, bytes: 8192 }, failure,
    { table: child, tableId: childId, rows: [] })).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  const batch = Result.getOrThrow(preparePostgresRelationalBatch(...args, { table: child, tableId: childId, rows: [] }));
  expect(buildPostgresRelationalPredicateBody({ ...batch }, tableId, failure))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  expect(decodePostgresRelationalMatches(batch, tableId, [], failure)).toMatchObject({ _tag: "Success", success: { matches: [] } });
  expect(prepare(undefined, "missing")).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
});

it("applies one node/depth/operand budget across every scalar wrapper", () => {
  for (const predicate of [
    { kind: "and", children: Array.from({ length: 33 }, () => ({ kind: "parent", predicate: { kind: "and", children: [] } })) },
    { kind: "and", children: [0, 1].map(() => ({ kind: "child", predicate: { kind: "in", column: "value", values: Array.from({ length: 129 }, () => "v") } })) },
  ]) expect(prepare(predicate)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  let predicate: unknown = { kind: "child", predicate: { kind: "isNull", column: "value" } };
  for (let depth = 0; depth < 9; depth++) predicate = { kind: "and", children: [predicate] };
  expect(prepare(predicate)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
});

it("bounds combined cohorts and bytes, validates exact root vectors and rejects corrupt FK or duplicate root keys", () => {
  const prepared = Result.getOrThrow(prepare());
  const parents = [{ id: "p", attribute: "threshold", operator: "gte" }];
  const childRows = [{ id: "v", parent_id: "p", value: "4" }];
  const batch = Result.getOrThrow(preparePostgresRelationalBatch(prepared.program, parent, tableId, parents,
    { rows: 2, bytes: 8192 }, failure, { table: child, tableId: childId, rows: childRows }));
  parents[0]!.attribute = "mutated"; childRows[0]!.value = "bad";
  const sql = new PgDialect().sqlToQuery(Result.getOrThrow(buildPostgresRelationalPredicateBody(batch, tableId, failure)));
  expect(sql.params.some(value => typeof value === "string" && value.includes('"value":"4"'))).toBe(true);
  for (const rows of [[], [{ ordinal: 1, matched: true }], [{ ordinal: 0, matched: 1 }], [{ ordinal: 0, matched: true, extra: 1 }]])
    expect(decodePostgresRelationalMatches(batch, tableId, rows, failure)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  expect(decodePostgresRelationalMatches(batch, tableId, [{ ordinal: 0, matched: null }], failure))
    .toMatchObject({ _tag: "Success", success: { matches: [null] } });
  for (const bounds of [{ rows: 1, bytes: 8192 }, { rows: 2, bytes: 1 }])
    expect(preparePostgresRelationalBatch(prepared.program, parent, tableId, parents, bounds, failure, { table: child, tableId: childId, rows: childRows }))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  for (const rows of [[{ id: "v", parent_id: null, value: "4" }], [{ id: "v", value: "4" }]])
    expect(preparePostgresRelationalBatch(prepared.program, parent, tableId, parents, { rows: 8, bytes: 8192 }, failure, { table: child, tableId: childId, rows }))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  expect(preparePostgresRelationalBatch(prepared.program, parent, tableId, [...parents, ...parents], { rows: 8, bytes: 8192 }, failure,
    { table: child, tableId: childId, rows: [] })).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  const roots = Array.from({ length: 4 }, (_, index) => ({ ...parents[0], id: "p" + index }));
  const values = Array.from({ length: 4 }, (_, index) => ({ id: "c" + index, parent_id: "p0", value: "4" }));
  expect(preparePostgresRelationalBatch(prepared.program, parent, tableId, roots, { rows: 8, bytes: 8192 }, failure,
    { table: child, tableId: childId, rows: values })).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  const vectorBatch = Result.getOrThrow(preparePostgresRelationalBatch(prepared.program, parent, tableId, roots.slice(0, 2),
    { rows: 8, bytes: 8192 }, failure, { table: child, tableId: childId, rows: [] }));
  for (const vector of [[{ ordinal: 0, matched: true }, { ordinal: 0, matched: false }],
    [{ ordinal: 1, matched: true }, { ordinal: 0, matched: false }]])
    expect(decodePostgresRelationalMatches(vectorBatch, tableId, vector, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });

});

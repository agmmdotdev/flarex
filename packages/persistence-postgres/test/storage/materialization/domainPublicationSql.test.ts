import { sql } from "drizzle-orm";
import { PgDialect, pgTable, timestamp } from "drizzle-orm/pg-core";
import { CasingCache } from "drizzle-orm/casing";
import { Client } from "pg";
import { expect, it, vi } from "vitest";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { fxAppRowRevisions } from "../../../src/database/schema";
import { buildApplicationPublicationStatement } from "../../../src/storage/materialization/domainPublicationSql";
import { makePhysicalSessionAccess } from "../../../src/database/physicalSession/drizzle";
import { observeDrizzleRawQuery } from "../../../src/database/drizzleQueryObservation";
import { nativeTail, row, values } from "./domainPublicationSqlFixture";

const dialect = new PgDialect();

it("uses bounded column parameters as ordinary tuple row counts grow", () => {
  const compile = (count: number) => dialect.sqlToQuery(buildApplicationPublicationStatement('quoted"publication', sql`${1}`, sql`${2}`, null, values(count)));
  const first = compile(1); const many = compile(64);
  const nativeFirst = dialect.sqlToQuery(nativeTail(values(1), 'quoted"publication'));
  const nativeMany = dialect.sqlToQuery(nativeTail(values(64), 'quoted"publication'));
  expect(many.params).toHaveLength(first.params.length);
  expect(many.sql).toBe(first.sql);
  expect(nativeMany.params.length).toBeGreaterThan(nativeFirst.params.length);
  expect(first.sql).toContain('"quoted""publication"."fx_app_row_write"');
  expect(first.sql).toContain("with ordinality");
  expect(first.sql).toContain("order by tuples.ordinal");
});

it("retains null tuple positions and fresh parameters on every complete invocation", () => {
  const first = values(1); const second = { ...values(0), commitSeq: CommitSeqSchema.make(10n) };
  const withNull = { ...first, unique: { owners: [], previous: [null], next: [null] } };
  const compiled = dialect.sqlToQuery(buildApplicationPublicationStatement("first", sql`${1}`, sql`${2}`, null, withNull));
  expect(compiled.sql).toContain('else null::"first"."fx_app_unique_write"');
  expect(compiled.params).toContain('{"false"}');
  expect(compiled.params.slice(0, 3)).toEqual([1, 2, null]);
  const next = dialect.sqlToQuery(buildApplicationPublicationStatement("second", sql`${3}`, sql`${4}`, null, second));
  expect(next.params).toEqual([3, 4, null, 10n, row.scopeUuid]);
  expect(next.sql).not.toContain('"first"');
  expect(compiled.params).toContain(row.commitSeq);
});

it("preserves first native encoder failure before intrinsic and later tuple work", () => {
  const probe = pgTable("publication_codec_probe", { time: timestamp({ withTimezone: true }) });
  const prefixFailure = new Error("prefix encoder failure"); const rowFailure = new Error("row encoder failure");
  const time = vi.spyOn(probe.time, "mapToDriverValue").mockImplementation(() => { throw prefixFailure; });
  const bytes = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockImplementation(() => { throw rowFailure; });
  try {
    expect(() => dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${sql.param(new Date(), probe.time)}`, sql`${2}`, null, values(2)))).toThrow(prefixFailure);
    expect(bytes).not.toHaveBeenCalled();
    expect(() => dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${1}`, sql`${2}`, null, values(2)))).toThrow(rowFailure);
    expect(bytes).toHaveBeenCalledTimes(1);
  } finally { time.mockRestore(); bytes.mockRestore(); }
});

it("preserves native row and field encoder order before transposing tuple columns", () => {
  const value = { ...values(2), rows: [{ ...row, rowId: new Uint8Array(16).fill(1) }, { ...row, rowId: new Uint8Array(16).fill(2) }] };
  const fieldFailure = new Error("first row field failure");
  const visits: string[] = [];
  const id = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockImplementation(value => {
    visits.push("rowId"); return value;
  });
  const sequence = vi.spyOn(fxAppRowRevisions.commitSeq, "mapToDriverValue").mockImplementation(() => {
    visits.push("commitSeq"); throw fieldFailure;
  });
  try {
    expect(() => dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${1}`, sql`${2}`, null, value))).toThrow(fieldFailure);
    expect(visits).toEqual(["rowId", "commitSeq"]);
    visits.length = 0;
    expect(() => dialect.sqlToQuery(nativeTail(value, "public"))).toThrow(fieldFailure);
    expect(visits).toEqual(["rowId", "commitSeq"]);
  } finally { id.mockRestore(); sequence.mockRestore(); }
});

it("renders an expression-returning codec before later fields or rows", () => {
  const probe = pgTable("publication_expression_probe", { time: timestamp({ withTimezone: true }) });
  const expressionFailure = new Error("native SQL expression failure");
  const expression = vi.spyOn(probe.time, "mapToDriverValue").mockImplementation(() => { throw expressionFailure; });
  const bytes = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockReturnValue(sql`${sql.param(new Date(), probe.time)}`);
  const later = vi.spyOn(fxAppRowRevisions.valueBytes, "mapToDriverValue");
  try {
    expect(() => dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${1}`, sql`${2}`, null, values(2)))).toThrow(expressionFailure);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(expression).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    bytes.mockClear(); expression.mockClear();
    expect(() => dialect.sqlToQuery(nativeTail(values(2), "public"))).toThrow(expressionFailure);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(expression).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  } finally { expression.mockRestore(); bytes.mockRestore(); later.mockRestore(); }
});

it("preserves native timestamp prefix and SQL-valued tuple codecs", () => {
  const probe = pgTable("publication_codec_probe", { time: timestamp({ withTimezone: true }) });
  const date = new Date("2026-10-10T01:02:03.456Z");
  const prefix = sql`${sql.param(date, probe.time)}::timestamptz`;
  const bytes = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockReturnValue(sql`decode(${"0404"},'hex')`);
  try {
    const actual = dialect.sqlToQuery(buildApplicationPublicationStatement("public", prefix, sql`${2}`, null, values(1)));
    expect(actual.params[0]).toBe(date.toISOString());
    expect(actual.params).toContain("0404");
    expect(actual.sql).toMatch(/array\[decode\(\$\d+,'hex'\)::bytea\]::bytea\[\]/);
  } finally { bytes.mockRestore(); }
});

it("uses the actual dialect's initial positional offset through complete publication values", () => {
  const offset = { value: 17 };
  const statement = buildApplicationPublicationStatement("public", sql`${1}::integer`, sql`${2}::integer`, null, values(0));
  const actual = statement.toQuery({ casing: new CasingCache(), escapeName: name => dialect.escapeName(name),
    escapeParam: index => dialect.escapeParam(index), escapeString: value => dialect.escapeString(value), paramStartIndex: offset });
  expect(actual.sql).toContain("($18::integer,$19::integer,$20::text,");
  expect(actual.sql).toContain("$21::bigint, $22::uuid");
  expect(actual.params).toEqual([1, 2, null, row.commitSeq, row.scopeUuid]);
  expect(offset.value).toBe(22);
});

it("preserves undefined through the native codec and skips native encoding for null", () => {
  const codec = vi.spyOn(fxAppRowRevisions.valueBytes, "mapToDriverValue");
  try {
    const value = { ...values(0), rows: [{ ...row, valueBytes: undefined }, { ...row, valueBytes: null }] };
    dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${1}`, sql`${2}`, null, value));
    expect(codec.mock.calls).toEqual([[undefined]]);
    dialect.sqlToQuery(nativeTail(value, "public"));
    expect(codec.mock.calls).toEqual([[undefined], [undefined]]);
  } finally { codec.mockRestore(); }
});

it("routes the complete compiled statement through native tx.execute and detached observation", () => {
  const tx = makePhysicalSessionAccess({})(new Client()).transaction;
  const statement = tx.execute(buildApplicationPublicationStatement("public", sql`${row.rowId}::bytea`, sql`${2}`, null, values(0)));
  const observer = vi.fn();
  observeDrizzleRawQuery("applyPublication", statement, observer);
  const query = statement.getQuery();
  expect(query.sql).toContain('from "public".fx_apply_app_publication($1::bytea,$2,$3::text,');
  expect(query.params).toEqual([row.rowId, 2, null, row.commitSeq, row.scopeUuid]);
  expect(observer).toHaveBeenCalledOnce();
  expect(observer.mock.calls[0]?.[0]).toEqual({ name: "applyPublication", sql: query.sql, params: query.params });
  expect(observer.mock.calls[0]?.[0].params[0]).not.toBe(row.rowId);
});

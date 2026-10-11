import { sql, type SQL } from "drizzle-orm";
import { PgDialect, pgTable, timestamp, type PreparedQueryConfig } from "drizzle-orm/pg-core";
import { expect, vi } from "vitest";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { fxAppRowRevisions, fxSystemInstallation } from "../../../src/database/schema";
import type { ApplicationMaterializationValues } from "../../../src/storage/materialization/domainApplication";
import { buildApplicationPublicationStatement } from "../../../src/storage/materialization/domainPublicationSql";
import { nativeTail, row, values } from "./domainPublicationSqlFixture";

const dialect = new PgDialect();

/** Project the actual function arguments without invoking publication. Both
 * representations use the installed tuple types and native driver preparation;
 * this fixture supplies no alternate admission or publication behavior. */
async function compareTransport(database: FlarexMetadataDatabase, value: ApplicationMaterializationValues,
  prefix: SQL = sql`${1}::integer`, intrinsic: SQL = sql`${2}::integer`) {
  const schema = (await database.select({ name: sql<string>`current_schema()` }).from(fxSystemInstallation).limit(1))[0]?.name;
  if (schema === undefined) throw new Error("Publication transport fixture has no installed namespace");
  const rendered = dialect.sqlToQuery(buildApplicationPublicationStatement(schema, prefix, intrinsic, null, value));
  const marker = ".fx_apply_app_publication(";
  const start = rendered.sql.indexOf(marker);
  if (start < 0 || !rendered.sql.endsWith(")")) throw new Error("Missing complete native publication invocation");
  const argumentsSql = rendered.sql.slice(start + marker.length, -1);
  const packetField = sql<string>`jsonb_build_array(${prefix},${intrinsic},${null}::text,${nativeTail(value, schema)})::text`;
  const reference = database.select({ packet: packetField })
    .from(fxSystemInstallation).limit(1);
  const command = database._.session.prepareQuery<PreparedQueryConfig & { execute: typeof reference._.result }>(
    { ...rendered, sql: `select jsonb_build_array(${argumentsSql})::text as "packet"` },
    [{ path: ["packet"], field: packetField }], undefined, true,
  );
  const actual = await command.execute();
  const expected = await reference;
  // Compare server text directly: parsing JSON here would round bigint >2^53.
  expect(actual).toEqual(expected);
  expect(actual).toHaveLength(1);
  expect(actual[0]?.packet).toContain(row.commitSeq.toString());
  return actual[0]?.packet;
}

function nullableTuples(): ApplicationMaterializationValues {
  const value = values(3);
  const next = value.unique.next[0];
  if (next === undefined || next === null) throw new Error("Missing native unique tuple fixture");
  return { ...value, rows: [row, { ...row, isTombstone: true, valueBytes: null, valueSha256: null },
    { ...row, rowId: new Uint8Array([0, 255, 34, 92, 123, 125, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
    unique: { ...value.unique, previous: [null, next, null], next: [next, null, next] } };
}

function quotedText(): ApplicationMaterializationValues {
  const value = values(1);
  return { ...value, unique: { ...value.unique,
    owners: value.unique.owners.map(owner => ({ ...owner, localeKey: "locale ' \" \\ { } , NULL Ω\nline" })),
    next: value.unique.next.map(owner => owner === null ? null : ({ ...owner, localeKey: "NULL" })),
  }, search: value.search.map(search => ({ ...search,
    textPages: search.textPages.map(page => page.map(entry => ({ ...entry, foldedText: "text ' \" \\ { } , NULL Ω\nline" }))),
    jsonPages: search.jsonPages.map(page => page.map(entry => ({ ...entry, valueJson: {
      quote: "a'\"b\\c", text: "NULL", empty: "", nested: [null, true, { brace: "{}," }], unicode: "Ω\nline",
    } }))),
  })) };
}

export const publicationTransportCases = [
  { name: "empty tuple and scalar arrays", run: (database: FlarexMetadataDatabase) => compareTransport(database, values(0)) },
  { name: "dense typed column arrays and exact bigint", run: (database: FlarexMetadataDatabase) => compareTransport(database, values(64)) },
  { name: "null tuple positions, tombstone fields and bytea", run: (database: FlarexMetadataDatabase) => compareTransport(database, nullableTuples()) },
  { name: "quoted text, JSON, unicode and literal NULL", run: (database: FlarexMetadataDatabase) => compareTransport(database, quotedText()) },
  { name: "native timestamp prefix and SQL-returning tuple codec", run: async (database: FlarexMetadataDatabase) => {
    const probe = pgTable("publication_transport_timestamp", { time: timestamp({ withTimezone: true }) });
    const bytes = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockReturnValue(sql`decode(${"00ff225c7b7d00010203040506070809ff"},'hex')`);
    try {
      return await compareTransport(database, values(2),
        sql`${sql.param(new Date("2026-10-11T01:02:03.456Z"), probe.time)}::timestamptz`);
    } finally { bytes.mockRestore(); }
  } },
] as const;

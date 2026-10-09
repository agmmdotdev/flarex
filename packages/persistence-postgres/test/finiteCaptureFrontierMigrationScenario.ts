import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { FlarexSqlClient } from "../src";
import { fxAppRowRevisions, fxSystemTransactionSessions } from "../src/schema";
import { SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID, insertSessionTestScope,
  insertTransactionSessionFixture, transactionSessionFixture, transactionSessionIdAt } from "./sessionAuthorityTestSupport";

const MigrationJournal = Schema.Struct({ version: Schema.String, dialect: Schema.String,
  entries: Schema.Array(Schema.Struct({ idx: Schema.Int, version: Schema.String, when: Schema.Number,
    tag: Schema.String, breakpoints: Schema.Boolean })) });
const decodeJournal = Schema.decodeUnknownSync(MigrationJournal);

/** The authentic populated predecessor is installed through 137. The caller
 * owns bootstrap and maintenance; no current verifier blesses an old structure. */
export async function withFiniteFrontierPredecessor(
  work: (folder: string, restoreCurrentJournal: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const temporary = await mkdtemp(resolve(tmpdir(), "flarex-finite-frontier-"));
  const folder = resolve(temporary, "drizzle");
  try {
    await cp(resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle"), folder, { recursive: true });
    const journalPath = resolve(folder, "meta/_journal.json");
    const current = await readFile(journalPath, "utf8");
    const decoded = decodeJournal(JSON.parse(current));
    await writeFile(journalPath, JSON.stringify({ ...decoded, entries: decoded.entries.filter(entry => entry.idx < 138) }));
    await work(folder, () => writeFile(journalPath, current));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function finiteFrontierPopulatedMigration(
  predecessor: Pick<FlarexSqlClient, "query" | "execute">,
  migrate: () => Promise<void>,
): Promise<void> {
  // Owner-only predecessor fixtures deliberately make stored data writable;
  // they do not issue a serving installation capability before the new proof.
  await predecessor.query("update fx_system_installation set state='active' where singleton_id=1");
  await insertSessionTestScope(predecessor);
  await insertTransactionSessionFixture(predecessor, transactionSessionFixture(transactionSessionIdAt(138), { lifecycle: "running" }));
  await predecessor.query(`update fx_system_tx_session set lifecycle='aborted',
    validated_args_json=null,validated_args_canonical_bytes=null,
    authorization_grant_json=null,authorization_grant_canonical_bytes=null where session_id=$1::uuid`, [transactionSessionIdAt(138)]);
  // Historical tombstone bytes/identity are retained as well as session data.
  // This is intentional stored-fixture DML through the real table/column owner.
  await predecessor.execute(sql`insert into ${fxAppRowRevisions}
    (${sql.identifier(fxAppRowRevisions.scopeUuid.name)},${sql.identifier(fxAppRowRevisions.tableId.name)},
      ${sql.identifier(fxAppRowRevisions.rowId.name)},${sql.identifier(fxAppRowRevisions.commitSeq.name)},
      ${sql.identifier(fxAppRowRevisions.writeEpochUuid.name)},${sql.identifier(fxAppRowRevisions.schemaVersionId.name)},
      ${sql.identifier(fxAppRowRevisions.creationTime.name)},${sql.identifier(fxAppRowRevisions.valueCodecVersion.name)},
      ${sql.identifier(fxAppRowRevisions.isTombstone.name)})
    values (${SESSION_TEST_SCOPE_UUID}::uuid,138,decode('61380000000040008000000000000001','hex'),1,
      ${SESSION_TEST_EPOCH_UUID}::uuid,'finite-frontier-predecessor',1,1,true)`);
  const stored = () => predecessor.execute(sql`select ${fxSystemTransactionSessions.scopeUuid}::text,
    ${fxSystemTransactionSessions.sessionId}::text,${fxSystemTransactionSessions.lifecycle},
    encode(${fxSystemTransactionSessions.requestSha256},'hex') as request_digest,
    ${fxSystemTransactionSessions.requestKey} from ${fxSystemTransactionSessions}`);
  const history = () => predecessor.execute(sql`select ${fxAppRowRevisions.scopeUuid}::text,
    ${fxAppRowRevisions.tableId},encode(${fxAppRowRevisions.rowId},'hex') as row_id,
    ${fxAppRowRevisions.commitSeq}::text,${fxAppRowRevisions.writeEpochUuid}::text,
    ${fxAppRowRevisions.schemaVersionId},${fxAppRowRevisions.isTombstone} from ${fxAppRowRevisions}`);
  const before = (await stored()).rows;
  const previousHistory = (await history()).rows;
  await migrate();
  expect((await stored()).rows).toEqual(before);
  expect((await history()).rows).toEqual(previousHistory);
  expect((await predecessor.query(`select i.state,not p.proretset as scalar,
    t.typname as result from fx_system_installation i,pg_catalog.pg_proc p,pg_catalog.pg_type t
    where p.pronamespace=current_schema()::pg_catalog.regnamespace and p.proname='fx_accept_finite_storage_capture'
      and t.oid=p.prorettype`)).rows)
    .toEqual([{ state: "active", scalar: true, result: "fx_finite_capture_frontier" }]);
}

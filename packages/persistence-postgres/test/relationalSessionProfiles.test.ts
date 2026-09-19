import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { makePostgresRelationalSession, runRelationalSession, type RelationalSession } from "../src/relationalTransaction/session";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { runEffect } from "./effectTestRuntime";

async function profiles(session: RelationalSession) {
  for (const profile of ["command", "snapshotRead", "command"] as const) {
    const rows = await runEffect(runRelationalSession(session, profile, tx => runDrizzleStatementEffect(
      tx.select({ isolation: sql<string>`current_setting('transaction_isolation')` }).from(sql`(select 1) as probe`),
      cause => new Error("Could not inspect session isolation", { cause }),
    )));
    expect(rows).toEqual([{ isolation: profile === "snapshotRead" ? "repeatable read" : "read committed" }]);
  }
}
it("selects each named PGlite test session profile without leaking it to the next command", async () => {
  const fixture = await createRelationalPGliteFixture();
  await profiles(fixture.session);
}, 120_000);
it.skipIf(postgresUrl === null)("selects each named PostgreSQL session profile without leaking it to the next command", async () => {
  await withTemporaryPostgresPersistence(persistence => profiles(makePostgresRelationalSession(persistence)));
}, 120_000);

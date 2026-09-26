import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { makePostgresRelationalSession, runRelationalSession, type RelationalSession } from "../src/relationalTransaction/session";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { runEffect } from "./effectTestRuntime";
import { Effect } from "effect";
import { frameworkTransactionTimeouts, maximumFrameworkCommandMs } from "../src/frameworkExecutionPolicy";

async function profiles(session: RelationalSession) {
  let callbacks = 0;
  for (const commandMs of [0, frameworkTransactionTimeouts.commandMs - 1, maximumFrameworkCommandMs + 1, 10_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(await runEffect(Effect.result(runRelationalSession(session, "command", Effect.fn(() => {
      callbacks += 1; return Effect.void;
    }), commandMs)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  }
  expect(await runEffect(Effect.result(runRelationalSession(session, "snapshotRead", () => {
    callbacks += 1; return Effect.void;
  }, maximumFrameworkCommandMs)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(callbacks).toBe(0);
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

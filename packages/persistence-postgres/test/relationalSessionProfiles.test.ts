import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { makePostgresRelationalSession, runRelationalSession, startRelationalRequestDeadline,
  boundRelationalRequestDeadline, type RelationalSession } from "../src/relationalTransaction/session";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { runEffect } from "./effectTestRuntime";
import { Cause, Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
import { PhysicalSessionDeadlineIssue } from "../src/physicalSession/errors";
import { frameworkTransactionTimeouts, maximumFrameworkCommandMs } from "../src/frameworkExecutionPolicy";

it("keeps the original ordinary request deadline across drained entry work and recovery", async () => {
  await runEffect(Effect.gen(function* () {
    const deadline = yield* startRelationalRequestDeadline(frameworkTransactionTimeouts.commandMs);
    yield* TestClock.adjust("9 seconds");
    expect(yield* boundRelationalRequestDeadline(deadline, Effect.succeed("first drained entry"))).toBe("first drained entry");
    const defect = new Error("Original entry defect");
    const original = Cause.combine(Cause.fail("original entry failure"), Cause.die(defect));
    const failed = yield* Effect.exit(boundRelationalRequestDeadline(deadline, Effect.failCause(original)));
    if (Exit.isSuccess(failed)) throw new Error("Expected original entry Cause");
    expect(failed.cause).toBe(original);
    yield* TestClock.adjust("1 second");
    let callbacks = 0;
    const expired = yield* Effect.result(boundRelationalRequestDeadline(deadline, Effect.sync(() => { callbacks++; })));
    if (expired._tag !== "Failure") throw new Error("Original request deadline was restarted");
    expect(expired.failure).toBeInstanceOf(PhysicalSessionDeadlineIssue);
    expect(callbacks).toBe(0);
  }).pipe(Effect.provide(TestClock.layer())));
});

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

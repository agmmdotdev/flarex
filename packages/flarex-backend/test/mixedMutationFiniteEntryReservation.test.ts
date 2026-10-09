import { count, eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createPostgresPersistence } from "../../persistence-postgres/src/database/postgres";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { fxAppRowRevisions, fxSystemCommits, fxSystemTransactionSessions } from
  "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { createMixedMutationProductFixture, type MixedMutationFinalEntryTestContext } from
  "./support/mixedMutationWorkerdFixture";

const drivers = postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function inventory(context: MixedMutationFinalEntryTestContext) {
  const db = context.currency.persistence.drizzle;
  return Promise.all([fxSystemTransactionSessions, fxAppRowRevisions, fxSystemCommits, fxSystemCommitEvents]
    .map(async table => (await db.select({ count: count() }).from(table))[0]?.count ?? 0));
}

async function installReservationReturnedRowTamper(context: MixedMutationFinalEntryTestContext,
  phase: "before" | "after", field: string, value: string) {
  const target = context.currency.persistence;
  const schema = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
  if (schema === undefined || !/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error("Invalid isolated test schema");
  const owner = context.currency.resource.kind === "postgres" && postgresUrl !== null
    ? await createPostgresPersistence({ connectionString: postgresUrl }) : undefined;
  try {
    // Controlled DDL injects real BEFORE/AFTER INSERT corruption into the
    // complete anchor; AFTER changes cannot be proved by INSERT RETURNING.
    // The actual finite entry continues under the restricted runtime login.
    const statements = [
      `create function "${schema}".tamper_reserved_entry() returns trigger language plpgsql as $function$
        begin
          ${phase === "before" ? `new.${field} := ${value};` : `update "${schema}".fx_system_tx_session set ${field} = ${value}
            where scope_uuid = new.scope_uuid and session_id = new.session_id;`}
          return new;
        end $function$`,
      `create trigger tamper_reserved_entry ${phase} insert on "${schema}".fx_system_tx_session
        for each row execute function "${schema}".tamper_reserved_entry()`,
    ];
    for (const statement of statements) {
      if (owner === undefined) await target.query(statement);
      else await owner.query(statement);
    }
  } finally { await owner?.close(); }
}

describe.each(drivers)("same-transaction finite entry reservation on %s", driver => {
  it("inserts one complete anchor after preparation without reservation or continuation updates", async () => {
    const statements: string[] = [];
    let watching = false;
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `entry-reservation-${driver}`, hooks: {
      beforeFinalEntry: async () => { watching = true; },
      observeSql: (_phase, statement) => { if (watching) statements.push(statement); },
    } });
    try {
      if (driver === "pglite") {
        // The PGlite fixture owns the query observer; the PostgreSQL lane proves
        // actual storage/correlation below without inventing a tracer there.
        expect(statements.filter(statement => /fx_complete_finite_entry/i.test(statement))).toHaveLength(1);
        expect(statements.some(statement => /^(insert into|update) (?:"[^"]+"\.)?"fx_system_tx_session"/i.test(statement))).toBe(false);
        expect(statements.some(statement => /fx_observe_finite_entry/i.test(statement))).toBe(true);
      }
      const [row] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.selector.sessionId));
      if (row === undefined) throw new Error("Missing actual admitted anchor");
      const stored = await Effect.runPromise(readFiniteAttemptAnchorRow(row));
      expect(stored.reservation).toMatchObject({ sessionId: fixture.selector.sessionId,
        attemptFence: fixture.selector.attemptFence, scopeId: fixture.selector.scopeId });
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { await fixture.close(); }
  }, 240_000);

  it.each([
    ["before", "function_path", "'users:tampered'"],
    ["before", "request_key", "new.request_key || '-tampered'"],
    ["before", "validated_args_json", "'{\"tampered\":true}'::jsonb"],
    ["before", "authorization_grant_json", "'{\"tampered\":true}'::jsonb"],
    ["after", "application_execution_authority_json", "'{\"tampered\":true}'::jsonb"],
    ["after", "finite_snapshot_commit_seq", "new.finite_snapshot_commit_seq + 1"],
    ["after", "finite_metadata_watermark", "new.finite_metadata_watermark + 1"],
    ["after", "finite_claim_owner", "'00000000-0000-4000-8000-000000000099'::uuid"],
    ["after", "finite_claim_fence", "new.finite_claim_fence + 1"],
    ["after", "finite_claim_expires_at", "new.finite_claim_expires_at - interval '1 millisecond'"],
  ] as const)("rolls back a real %s INSERT %s tamper before confirming the entry", async (phase, field, value) => {
    let before: readonly number[] = [];
    let refused = false;
    const failure = await createMixedMutationProductFixture({ driver, suffix: `entry-${phase}-${field}-${driver}`, hooks: {
      beforeFinalEntry: async context => {
        before = await inventory(context);
        await installReservationReturnedRowTamper(context, phase, field, value);
      },
      onFinalEntryFailure: async (context, exit) => {
        expect(Exit.isFailure(exit)).toBe(true);
        expect(String(exit)).toContain("sessionRecordInvalid");
        expect(await inventory(context)).toEqual(before);
        refused = true;
      },
    } }).then(async fixture => { await fixture.close(); throw new Error("Expected actual returned-row refusal"); }, cause => cause);
    expect(refused, String(failure)).toBe(true);
  }, 240_000);
});

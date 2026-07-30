import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "primary",
  schemaName: "public",
});

describePostgres("real Postgres inactive application revision registration V1", () => {
  it("registers concurrently, cold-reloads, and replays DB time", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const {
        makeRegistrationTestContext,
        registrationFixtureForPersistence,
      } = await loadRegistrationFixture();
      const constraints = await persistence.query<{
        constraint_name: string;
        constraint_type: string;
        key_columns: number;
      }>(`
        select
          con.conname as constraint_name,
          con.contype::text as constraint_type,
          cardinality(con.conkey)::int as key_columns
        from pg_constraint as con
        where con.conname in (
          'fx_application_revision_v1_receipt_target_unique',
          'fx_application_revision_request_v1_revision_fk',
          'fx_application_revision_v1_inactive_check'
        )
        order by con.conname
      `);
      expect(constraints.rows).toEqual([
        {
          constraint_name:
            "fx_application_revision_request_v1_revision_fk",
          constraint_type: "f",
          key_columns: 3,
        },
        {
          constraint_name:
            "fx_application_revision_v1_inactive_check",
          constraint_type: "c",
          key_columns: 1,
        },
        {
          constraint_name:
            "fx_application_revision_v1_receipt_target_unique",
          constraint_type: "u",
          key_columns: 3,
        },
      ]);
      const defaultClock = await persistence.query<{
        column_default: string | null;
      }>(`
        select column_default
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_application_revision_v1'
          and column_name = 'registered_at'
      `);
      expect(defaultClock.rows[0]?.column_default).toMatch(/now\(\)/i);

      const target =
        createPostgresLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          LOCATOR,
        );
      const result = await runEffect(Effect.scoped(Effect.gen(function* () {
        const fixture = yield* registrationFixtureForPersistence(
          persistence,
          target,
        );
        const concurrent = yield* Effect.all([
          fixture.context.register(fixture.analysis, "postgres:first"),
          fixture.context.register(fixture.analysis, "postgres:second"),
        ], { concurrency: 2 });
        const cold = makeRegistrationTestContext(
          persistence,
          target,
          fixture.evidenceAuthority.authority,
        );
        const coldPreparation = yield* cold.prepareAnalysis({
          preparedDefinition: fixture.preparedDefinition,
          authenticatedEvidence: fixture.candidateAuthority,
          attemptCeilings: fixture.attemptCeilings,
        });
        yield* cold.correlateAnalysis(
          coldPreparation,
          fixture.analysis,
          fixture.evidenceAuthority.issueCommand(
            coldPreparation,
            fixture.commandReceipt,
          ),
        );
        const replay = yield* cold.register(
          fixture.analysis,
          "postgres:first",
        );
        return { concurrent, replay };
      })));
      expect(result.concurrent.map(value => value.kind).sort())
        .toEqual(["registered", "replayed"]);
      expect(result.concurrent[0].registeredAt.getTime())
        .toBe(result.concurrent[1].registeredAt.getTime());
      expect(result.replay.kind).toBe("replayed");
      expect(result.replay.registeredAt.getTime())
        .toBe(result.concurrent[0].registeredAt.getTime());
      const rows = await persistence.query<{
        revisions: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text
           from fx_system_application_revision_v1) as revisions,
          (select count(*)::text
           from fx_system_application_revision_request_v1) as receipts
      `);
      expect(rows.rows).toEqual([{ revisions: "1", receipts: "2" }]);
    });
  }, 60_000);

  it("rolls schema, revision, and receipt publication back together", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const { registrationFixtureForPersistence } =
        await loadRegistrationFixture();
      const target =
        createPostgresLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          LOCATOR,
        );
      const failure = await runEffect(Effect.scoped(Effect.gen(function* () {
        const fixture = yield* registrationFixtureForPersistence(
          persistence,
          target,
        );
        yield* Effect.promise(() => persistence.query(`
          create function fx_test_reject_revision_request_v1()
          returns trigger language plpgsql as $$
          begin
            raise exception 'forced request receipt failure';
          end;
          $$;
          create trigger fx_test_reject_revision_request_v1
          before insert on fx_system_application_revision_request_v1
          for each row execute function fx_test_reject_revision_request_v1()
        `));
        return yield* Effect.flip(fixture.context.register(
          fixture.analysis,
          "postgres:rollback",
        ));
      })));
      expect(failure).toMatchObject({
        _tag: "ApplicationRevisionRegistrationConfirmedRollbackV1Error",
      });
      const rows = await persistence.query<{
        revisions: string;
        receipts: string;
        schemas: string;
      }>(`
        select
          (select count(*)::text
           from fx_system_application_revision_v1) as revisions,
          (select count(*)::text
           from fx_system_application_revision_request_v1) as receipts,
          (select count(*)::text
           from fx_control_schema_version) as schemas
      `);
      expect(rows.rows).toEqual([{
        revisions: "0",
        receipts: "0",
        schemas: "0",
      }]);
    });
  }, 60_000);
});

async function loadRegistrationFixture() {
  const state = globalThis as typeof globalThis & {
    __flarexRegistrationFixtureOnlyV1?: boolean;
  };
  state.__flarexRegistrationFixtureOnlyV1 = true;
  return import("./applicationRevisionRegistrationV1.test");
}

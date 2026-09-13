import { Cause, Effect, Exit } from "effect";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import {
  frameworkMigrationTransactionSessionIdentity,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
  type FrameworkMigrationTarget,
} from "../src/migrationCoordination/targetSession";
import { sql } from "drizzle-orm";
import { runEffect } from "./effectTestRuntime";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";

const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
const request = {
  kind: "ordinary",
  lockTimeoutMilliseconds: 1_000,
  statementTimeoutMilliseconds: 5_000,
} as const;

describe.skipIf(postgresUrl === null || !provisioningUrl)(
  "protected native installer execution",
  () => {
    it.each(["owner", "set role", "set session authorization"] as const)(
      "refuses %s credentials on the acquired connection before work",
      async (mode) => {
        await withNativeCoordinator(async (fixture) => {
          const pool = new Pool({
            ...fixture.persistence.pool.options,
            connectionString:
              mode === "owner" ? (postgresUrl ?? undefined) : provisioningUrl,
            max: 1,
          });
          try {
            const client = await pool.connect();
            try {
              if (mode !== "owner")
                await client.query(
                  `${mode} ${quote(fixture.migrationPool.options.user ?? "")}`,
                );
            } finally {
              client.release();
            }
            const target = await runEffect(
              makePostgresFrameworkMigrationTargetEffect({
                persistence: { drizzle: fixture.persistence.drizzle, pool },
                deploymentId: "deployment-a",
                canonicalPhysicalDatabaseIdentity:
                  "native-framework-test/database",
                physicalLocator: {
                  kind: "shared_database",
                  databaseKey: "primary",
                  schemaName: fixture.physicalSchema,
                },
              }),
            );
            await expectRefused(target);
          } finally {
            await pool.end();
          }
        });
      },
      180_000,
    );

    it("pins metadata before a pooled temporary lookalike and reveals the real login", async () => {
      await withNativeCoordinator(async (fixture) => {
        const client = await fixture.migrationPool.connect();
        try {
          await client.query(
            "create temp table fx_system_framework_migration_plan (fake integer)",
          );
        } finally {
          client.release();
        }
        const rows = await runEffect(
          runFrameworkMigrationTargetTransactionEffect(
            fixture.target,
            request,
            (tx) =>
              withFrameworkMigrationRawTransactionEffect(
                tx,
                fixture.target,
                (raw) =>
                  Effect.tryPromise(() =>
                    raw.execute(sql`
          select current_user = session_user as login,
            to_regclass('fx_system_framework_migration_plan') =
              to_regclass((current_schemas(false))[2] || '.fx_system_framework_migration_plan') as metadata
        `),
                  ),
              ),
          ),
        );
        expect(rows).toMatchObject({ rows: [{ login: true, metadata: true }] });
      });
    }, 180_000);

    it.each([
      ["fx_system_framework_migration_plan", "fx_framework_history_immutable"],
      [
        "fx_system_framework_migration_plan",
        "fx_framework_history_no_truncate",
      ],
      [
        "fx_system_framework_migration_plan",
        "fx_framework_creation_transaction",
      ],
      [
        "fx_system_framework_migration_plan_step",
        "fx_framework_children_sealed",
      ],
    ])(
      "rechecks disabled %s/%s on the same target",
      async (table, trigger) => {
        await withNativeCoordinator(async (fixture) => {
          expect(
            await runEffect(
              runFrameworkMigrationTargetTransactionEffect(
                fixture.target,
                request,
                () => Effect.succeed("ready"),
              ),
            ),
          ).toBe("ready");
          await fixture.persistence.query(
            `alter table ${quote(table)} disable trigger ${quote(trigger)}`,
          );
          try {
            await expectRefused(fixture.target);
          } finally {
            await fixture.persistence.query(
              `alter table ${quote(table)} enable trigger ${quote(trigger)}`,
            );
          }
          expect(
            await runEffect(
              runFrameworkMigrationTargetTransactionEffect(
                fixture.target,
                request,
                () => Effect.succeed("restored"),
              ),
            ),
          ).toBe("restored");
        });
      },
      180_000,
    );

    it("rejects a guard body replaced under the same function and trigger identities", async () => {
      await withNativeCoordinator(async (fixture) => {
        const original = (
          await fixture.persistence.query<{ definition: string }>(
            "select pg_get_functiondef('fx_framework_stamp_creation_transaction()'::regprocedure) as definition",
          )
        ).rows[0]?.definition;
        if (original === undefined) throw new Error("Missing guard function");
        await fixture.persistence
          .query(`create or replace function fx_framework_stamp_creation_transaction() returns trigger
        language plpgsql set search_path=pg_catalog as $$ begin return new; end; $$`);
        try {
          await expectRefused(fixture.target);
        } finally {
          await fixture.persistence.query(original);
        }
      });
    }, 180_000);

    it("rejects changed sealing arguments even when all guard names and counts match", async () => {
      await withNativeCoordinator(async (fixture) => {
        const original = (
          await fixture.persistence.query<{
            definition: string;
          }>(`select pg_get_triggerdef(oid) as definition
        from pg_trigger where tgrelid='fx_system_framework_migration_plan_step'::regclass and tgname='fx_framework_children_sealed'`)
        ).rows[0]?.definition;
        if (original === undefined) throw new Error("Missing sealing trigger");
        await fixture.persistence.query(
          "drop trigger fx_framework_children_sealed on fx_system_framework_migration_plan_step",
        );
        try {
          await fixture.persistence
            .query(`create trigger fx_framework_children_sealed after insert on fx_system_framework_migration_plan_step
          for each row execute function fx_framework_require_creation_transaction('fx_system_framework_migration_plan', 'step_storage_id')`);
          await expectRefused(fixture.target);
        } finally {
          await fixture.persistence.query(
            "drop trigger if exists fx_framework_children_sealed on fx_system_framework_migration_plan_step",
          );
          await fixture.persistence.query(original);
        }
      });
    }, 180_000);

    it.each(["table", "function", "schema"] as const)(
      "refuses metadata %s ownership",
      async (kind) => {
        await withNativeCoordinator(async (fixture) => {
          const coordinates = (
            await fixture.persistence.query<{ name: string; owner: string }>(
              "select current_schema() as name, current_user as owner",
            )
          ).rows[0];
          if (coordinates === undefined)
            throw new Error("Missing owner coordinates");
          const schema = quote(coordinates.name);
          const object =
            kind === "table"
              ? `table ${schema}.fx_system_framework_migration_plan`
              : kind === "function"
                ? `function ${schema}.fx_framework_stamp_creation_transaction()`
                : `schema ${schema}`;
          const admin = new Pool({ connectionString: provisioningUrl });
          try {
            await admin.query(
              `alter ${object} owner to ${quote(fixture.migrationPool.options.user ?? "")}`,
            );
            await expectRefused(fixture.target);
          } finally {
            try {
              await admin.query(
                `alter ${object} owner to ${quote(coordinates.owner)}`,
              );
              // Ownership transfer folds the grantee's ACL into owner privileges;
              // transferring it back does not restore the earlier explicit USAGE.
              if (kind === "schema")
                await fixture.persistence.query(
                  `grant usage on schema ${schema} to ${quote(fixture.migrationPool.options.user ?? "")}`,
                );
            } finally {
              await admin.end();
            }
          }
          expect(
            await runEffect(
              runFrameworkMigrationTargetTransactionEffect(
                fixture.target,
                request,
                () => Effect.succeed("restored"),
              ),
            ),
          ).toBe("restored");
        });
      },
      180_000,
    );

    it.each([
      "membership",
      "replication setting",
      "trigger privilege",
    ] as const)(
      "refuses newly granted %s authority, including on recovery",
      async (grant) => {
        await withNativeCoordinator(async (fixture) => {
          const previous = await runEffect(
            runFrameworkMigrationTargetTransactionEffect(
              fixture.target,
              request,
              (tx) =>
                Effect.succeed(
                  frameworkMigrationTransactionSessionIdentity(tx),
                ),
            ),
          );
          if (previous === undefined)
            throw new Error("Missing previous session");
          const admin = new Pool({ connectionString: provisioningUrl });
          const role = quote(fixture.migrationPool.options.user ?? "");
          const coordinates = (
            await fixture.persistence.query<{ name: string; owner: string }>(
              "select current_schema() as name, current_user as owner",
            )
          ).rows[0];
          if (coordinates === undefined)
            throw new Error("Missing owner coordinates");
          const object = `${quote(coordinates.name)}.fx_system_framework_migration_plan`;
          const [enable, disable] =
            grant === "membership"
              ? [
                  `grant ${quote(coordinates.owner)} to ${role}`,
                  `revoke ${quote(coordinates.owner)} from ${role}`,
                ]
              : grant === "replication setting"
                ? [
                    `grant set on parameter session_replication_role to ${role}`,
                    `revoke set on parameter session_replication_role from ${role}`,
                  ]
                : [
                    `grant trigger on ${object} to ${role}`,
                    `revoke trigger on ${object} from ${role}`,
                  ];
          try {
            await admin.query(enable);
            await expectRefused(fixture.target);
            let ran = false;
            const outcome = await Effect.runPromiseExit(
              runFrameworkMigrationTargetTransactionEffect(
                fixture.target,
                {
                  ...request,
                  kind: "recovery",
                  excludedSessionIdentity: previous,
                },
                () =>
                  Effect.sync(() => {
                    ran = true;
                  }),
              ),
            );
            expect(Exit.isFailure(outcome)).toBe(true);
            expect(ran).toBe(false);
          } finally {
            try {
              await admin.query(disable);
            } finally {
              await admin.end();
            }
          }
        });
      },
      180_000,
    );
  },
);

async function expectRefused(target: FrameworkMigrationTarget): Promise<void> {
  let ran = false;
  const result = await Effect.runPromiseExit(
    runFrameworkMigrationTargetTransactionEffect(target, request, () =>
      Effect.sync(() => {
        ran = true;
      }),
    ),
  );
  expect(ran).toBe(false);
  expect(
    Exit.isFailure(result) && Cause.findErrorOption(result.cause),
  ).toMatchObject({
    _tag: "Some",
    value: {
      _tag: "FrameworkMigrationSessionResourceIssue",
      phase: "beginOrConfigure",
    },
  });
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

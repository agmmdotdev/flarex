import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit } from "effect";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import {
  runFrameworkMigrationTargetTransactionEffect,
  type FrameworkMigrationTarget,
} from "../src/migrationCoordination/targetSession";
import { runEffect } from "./effectTestRuntime";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import {
  createFileScopedPostgresFixture,
  postgresUrl,
} from "./postgresHelpers";
import {
  makePostgresFrameworkMigrationFixtureTarget,
  frameworkMigrationFixturePool,
} from "./frameworkMigrationPostgresFixture";

const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
const request = {
  kind: "ordinary",
  lockTimeoutMilliseconds: 1_000,
  statementTimeoutMilliseconds: 5_000,
} as const;

describe.skipIf(postgresUrl === null || !provisioningUrl)(
  "native installer reachable authority",
  () => {
    it("does not invoke a shadowed setup function before refusing an owner pool", async () => {
      await withNativeCoordinator(async (fixture) => {
        await fixture.persistence
          .query(`create function "${fixture.physicalSchema}".set_config(text, text, boolean) returns text
        language plpgsql as $$ begin raise exception 'unsafe setup lookup'; end; $$`);
        const pool = new Pool({
          ...fixture.persistence.pool.options,
          options: `-c search_path=${fixture.physicalSchema},pg_catalog`,
          max: 1,
        });
        try {
          await expect(
            pool.query("select set_config('lock_timeout', '1s', true)"),
          ).rejects.toThrow("unsafe setup lookup");
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
          await expectLoginRefusal(target);
        } finally {
          await pool.end();
        }
      });
    }, 180_000);

    it.each(["pg_catalog", "physical"] as const)(
      "rejects executable privileged functions in %s",
      async (namespace) => {
        await withNativeCoordinator(async (fixture) => {
          const admin = new Pool({ connectionString: provisioningUrl });
          const name = `${namespace === "physical" ? fixture.physicalSchema : "pg_catalog"}.fx_guard_probe_${randomUUID().replaceAll("-", "")}`;
          const role = fixture.migrationPool.options.user;
          if (role === undefined) throw new Error("Missing installer role");
          let created = false;
          try {
            // The body is harmless; EXECUTE nevertheless grants the owner's authority.
            await admin.query(
              `create function ${name}() returns integer language sql security definer set search_path=pg_catalog as 'select 1'`,
            );
            created = true;
            await admin.query(`revoke all on function ${name}() from public`);
            await admin.query(
              `grant execute on function ${name}() to "${role}"`,
            );
            expect(
              (await fixture.migrationPool.query(`select ${name}() as value`))
                .rows,
            ).toEqual([{ value: 1 }]);
            await expectLoginRefusal(fixture.target);
          } finally {
            try {
              if (created) await admin.query(`drop function ${name}()`);
            } finally {
              await admin.end();
            }
          }
        });
      },
      180_000,
    );

    it("rejects a privileged EXECUTE grant even when schema lookup is refused", async () => {
      await withNativeCoordinator(async (fixture) => {
        const admin = new Pool({ connectionString: provisioningUrl });
        const role = fixture.migrationPool.options.user;
        if (role === undefined) throw new Error("Missing installer role");
        const name = `${fixture.physicalSchema}.fx_resolved_guard_probe`;
        const client = await fixture.migrationPool.connect();
        try {
          await admin.query(
            `create function ${name}() returns integer language sql security definer set search_path=pg_catalog as 'select 1'`,
          );
          await admin.query(`revoke all on function ${name}() from public`);
          await admin.query(`grant execute on function ${name}() to "${role}"`);
          await client.query(
            `prepare resolved_guard_probe as select ${name}() as value`,
          );
          // Establish that the granted function is usable before revocation.
          expect((await client.query("execute resolved_guard_probe")).rows)
            .toEqual([{ value: 1 }]);
          await fixture.persistence.query(
            `revoke usage on schema "${fixture.physicalSchema}" from "${role}"`,
          );
          await expect(client.query("execute resolved_guard_probe"))
            .rejects.toMatchObject({ code: "42501" });
          // The strict profile checks EXECUTE authority independently of schema
          // lookup, including when this server invalidates the prepared plan.
          await expectLoginRefusal(fixture.target);
        } finally {
          try {
            await fixture.persistence.query(
              `grant usage on schema "${fixture.physicalSchema}" to "${role}"`,
            );
          } finally {
            client.release();
            try {
              await admin.query(`drop function if exists ${name}()`);
            } finally {
              await admin.end();
            }
          }
        }
      });
    }, 180_000);

    it.each(["table", "column", "revoked"] as const)("rejects %s REFERENCES authority that can invoke a cast as a setup owner", async (grant) => {
      await withNativeCoordinator(async (fixture) => {
        const role = fixture.migrationPool.options.user;
        const owner = (
          await fixture.persistence.query<{ name: string }>(
            "select current_user as name",
          )
        ).rows[0]?.name;
        if (role === undefined || owner === undefined)
          throw new Error("Missing fixture roles");
        const physical = `"${fixture.physicalSchema}"`;
        const expected = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
        await fixture.persistence.query(
          `create table ${physical}.owner_reference_probe (id uuid unique not null)`,
        );
        await fixture.persistence.query(
          `insert into ${physical}.owner_reference_probe(id) values ($1)`,
          [expected],
        );
        await fixture.persistence.query(
          `grant references${grant === "column" ? " (id)" : ""} on ${physical}.owner_reference_probe to "${role}"`,
        );
        await fixture.migrationPool.query(
          `create type ${physical}.reference_probe_value as enum ('${expected}')`,
        );
        await fixture.migrationPool.query(
          `create function ${physical}.reference_probe_to_uuid(${physical}.reference_probe_value) returns uuid
            language sql immutable as $$ select case when current_user='${owner}' then $1::text::uuid
              else 'cccccccc-cccc-4ccc-cccc-cccccccccccc'::uuid end $$`,
        );
        await fixture.migrationPool.query(
          `create cast (${physical}.reference_probe_value as uuid) with function
            ${physical}.reference_probe_to_uuid(${physical}.reference_probe_value) as implicit`,
        );
        await fixture.migrationPool.query(
          `create table ${physical}.reference_probe (value ${physical}.reference_probe_value
            references ${physical}.owner_reference_probe(id))`,
        );
        if (grant === "revoked") {
          await fixture.persistence.query(
            `revoke references on ${physical}.owner_reference_probe from "${role}"`,
          );
        }
        // Success proves the invoker cast ran as the referenced table's owner;
        // the same path could invoke that owner's metadata privileges.
        await fixture.migrationPool.query(
          `insert into ${physical}.reference_probe(value) values ($1)`,
          [expected],
        );
        await expectLoginRefusal(fixture.target);
      });
    }, 180_000);

    it("rejects a reverse foreign key that invokes an installer cast as the child owner", async () => {
      await withNativeCoordinator(async (fixture) => {
        const owner = (await fixture.persistence.query<{ name: string }>(
          "select current_user as name",
        )).rows[0]?.name;
        if (owner === undefined) throw new Error("Missing setup owner");
        const physical = `"${fixture.physicalSchema}"`;
        const expected = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
        await fixture.migrationPool.query(
          `create table ${physical}.reverse_parent (id uuid unique not null)`,
        );
        await fixture.migrationPool.query(
          `insert into ${physical}.reverse_parent(id) values ($1)`, [expected],
        );
        await fixture.migrationPool.query(
          `create type ${physical}.reverse_value as enum ('${expected}')`,
        );
        await fixture.migrationPool.query(
          `create function ${physical}.reverse_to_uuid(${physical}.reverse_value) returns uuid
            language sql immutable as $$ select $1::text::uuid $$`,
        );
        await fixture.migrationPool.query(
          `create cast (${physical}.reverse_value as uuid) with function
            ${physical}.reverse_to_uuid(${physical}.reverse_value) as implicit`,
        );
        await fixture.persistence.query(
          `create table ${physical}.reverse_child (value ${physical}.reverse_value
            references ${physical}.reverse_parent(id))`,
        );
        await fixture.persistence.query(
          `insert into ${physical}.reverse_child(value) values ($1)`, [expected],
        );
        await fixture.migrationPool.query(
          `create or replace function ${physical}.reverse_to_uuid(${physical}.reverse_value) returns uuid
            language sql immutable as $$ select case when current_user='${owner}' then $1::text::uuid
              else 'cccccccc-cccc-4ccc-cccc-cccccccccccc'::uuid end $$`,
        );
        // The installer would convert to a different UUID. The matching child
        // blocks DELETE only because RI invokes its cast as the setup owner.
        await expect(fixture.migrationPool.query(
          `delete from ${physical}.reverse_parent where id=$1`, [expected],
        )).rejects.toMatchObject({ code: "23503" });
        await expectLoginRefusal(fixture.target);
      });
    }, 180_000);

    it("refuses ownership of the guard language extension without metadata or language ownership", async () => {
      await withNativeCoordinator(async (fixture) => {
        if (postgresUrl === null || provisioningUrl === undefined)
          throw new Error("Missing native fixture URLs");
        const database = `fx_guard_language_${randomUUID().replaceAll("-", "")}`;
        const admin = new Pool({ connectionString: provisioningUrl });
        const role = fixture.migrationPool.options.user;
        const ownerRole = (
          await fixture.persistence.query<{ name: string }>(
            "select current_user as name",
          )
        ).rows[0]?.name;
        const installerUrl = fixture.migrationPool.options.connectionString;
        if (
          role === undefined ||
          ownerRole === undefined ||
          installerUrl === undefined
        )
          throw new Error("Missing fixture credentials");
        const databaseUrl = (connectionString: string) => {
          const url = new URL(connectionString);
          url.pathname = "/" + database;
          return url.toString();
        };
        let created = false;
        try {
          await admin.query(
            `create database "${database}" template template0 owner "${ownerRole}"`,
          );
          created = true;
          const setup = new Pool({
            connectionString: databaseUrl(provisioningUrl),
          });
          const installer = new Pool({
            connectionString: databaseUrl(installerUrl),
          });
          const owner = await createPostgresPersistence({
            connectionString: databaseUrl(postgresUrl),
          });
          try {
            // Only this empty disposable database loses its stock PL/pgSQL extension.
            await setup.query("drop extension plpgsql");
            await admin.query(
              `grant create on database "${database}" to "${role}"`,
            );
            await installer.query("create extension plpgsql");
            await admin.query(
              `revoke create on database "${database}" from "${role}"`,
            );
            // Separate direct language ownership from the extension owner's
            // remaining indirect DROP ... CASCADE authority before admission.
            await setup.query(`alter language plpgsql owner to "${ownerRole}"`);
            expect(
              (
                await installer.query(`select e.extowner = r.oid as owns_extension,
            l.lanowner <> r.oid as nonowner_language from pg_extension e
            join pg_language l on l.lanname=e.extname join pg_roles r on r.rolname=current_user
            where e.extname='plpgsql'`)
              ).rows,
            ).toEqual([{ owns_extension: true, nonowner_language: true }]);
            await owner.migrate();
            const target = await runEffect(
              makePostgresFrameworkMigrationTargetEffect({
                persistence: { drizzle: owner.drizzle, pool: installer },
                deploymentId: "extension-probe",
                canonicalPhysicalDatabaseIdentity: "extension-probe/database",
                physicalLocator: {
                  kind: "shared_database",
                  databaseKey: "primary",
                  schemaName: "public",
                },
              }),
            );
            await expectLoginRefusal(target);
          } finally {
            try {
              await installer.end();
            } finally {
              try {
                await owner.close();
              } finally {
                await setup.end();
              }
            }
          }
        } finally {
          try {
            if (created) await admin.query(`drop database "${database}"`);
          } finally {
            await admin.end();
          }
        }
      });
    }, 180_000);

    it("refuses administrative reset while an installer client remains borrowed", async () => {
      const fixture = await createFileScopedPostgresFixture();
      try {
        const schema = (
          await fixture.persistence.query<{ name: string }>(
            "select current_schema() as name",
          )
        ).rows[0]?.name;
        if (schema === undefined) throw new Error("Missing fixture schema");
        await makePostgresFrameworkMigrationFixtureTarget({
          persistence: fixture.persistence,
          deploymentId: "leak-probe",
          canonicalPhysicalDatabaseIdentity: "leak-probe/database",
          physicalLocator: {
            kind: "shared_database",
            databaseKey: "primary",
            schemaName: schema,
          },
        });
        const installer = await frameworkMigrationFixturePool(
          fixture.persistence,
        );
        const held = await installer.connect();
        try {
          await expect(fixture.reset()).rejects.toThrow(
            "installer pool client",
          );
        } finally {
          held.release();
        }
        await fixture.reset();
      } finally {
        await fixture.dispose();
      }
    }, 180_000);
  },
);

async function expectLoginRefusal(
  target: FrameworkMigrationTarget,
): Promise<void> {
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
      cause: {
        message: expect.stringContaining("restricted authenticated login"),
      },
    },
  });
}

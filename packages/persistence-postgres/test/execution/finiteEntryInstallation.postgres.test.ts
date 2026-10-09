import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { verifyManagedRuntimePrivileges } from "../../src/installation/installationLifecycle";
import { finiteEntryInstallationScenario } from "./finiteEntryInstallationScenario";
import { createCoLocatedReadInstallationFixture, createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture, postgresUrl } from "../support/postgresHelpers";

describe.skipIf(postgresUrl === null)("finite entry installed owner PostgreSQL", () => {
  it("refuses actual function and private expected-type faults before reopening", async () => {
    const fixture = await createFileScopedPostgresFixture();
    try { await finiteEntryInstallationScenario(fixture.persistence, fixture.schemaName, () => fixture.persistence.migrate()); }
    finally { await fixture.dispose(); }
  }, 180_000);
});

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("finite entry ordinary-role profiles", () => {
  it("requires private execution and materialization functions and denies them to the actual co-located control reader", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const targetOwner = await createFileScopedPostgresFixture(); cleanup.push(targetOwner.dispose);
      const target = await createProtectedFileScopedPostgresFixture("managed", targetOwner); cleanup.push(target.dispose);
      const controlOwner = await createFileScopedPostgresFixture(); cleanup.push(controlOwner.dispose);
      const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner); cleanup.push(control.dispose);
      await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
      const [login] = (await target.persistence.query<{ login: string; superuser: boolean; createRole: boolean; bypassRls: boolean }>(`
        select session_user as login, r.rolsuper as superuser, r.rolcreaterole as "createRole", r.rolbypassrls as "bypassRls"
        from pg_catalog.pg_roles r where r.rolname = session_user`)).rows;
      if (login === undefined) throw new Error("Missing actual runtime role");
      expect(login).toMatchObject({ superuser: false, createRole: false, bypassRls: false });
      const functions = async (owner: typeof targetOwner) => (await owner.persistence.execute<{ name: string; signature: string; oid: string }>(sql`
        select p.proname as name, p.oid::pg_catalog.regprocedure::text as signature, p.oid::text as oid
        from pg_catalog.pg_proc p where p.pronamespace = ${owner.schemaName}::pg_catalog.regnamespace
          and p.proname in ('fx_observe_finite_entry','fx_complete_finite_entry','fx_compare_finite_metadata',
            'fx_accept_app_index_transitions','fx_accept_app_unique_owners',
            'fx_apply_app_unique_mutations','fx_reset_app_index_validation','fx_apply_app_materialization')
        order by p.proname`)).rows;
      const targetFunctions = await functions(targetOwner), controlFunctions = await functions(controlOwner);
      expect(targetFunctions).toHaveLength(8); expect(controlFunctions).toHaveLength(8);
      for (const [selected, allowed] of [[targetFunctions, true], [controlFunctions, false]] as const) {
        for (const fn of selected) {
          const [privilege] = (await target.persistence.execute<{ allowed: boolean; publicExecute: boolean }>(sql`
            select pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE') as allowed,
              exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
                where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as "publicExecute"
            from pg_catalog.pg_proc p where p.oid = ${fn.oid}::oid`)).rows;
          expect(privilege, fn.name).toEqual({ allowed, publicExecute: false });
        }
      }
      const verifyData = () => Effect.runPromise(verifyManagedRuntimePrivileges(target.persistence.drizzle, targetOwner.schemaName,
        { schemaName: targetOwner.migrationsSchema, tableName: targetOwner.migrationsTable }));
      const verifyControl = () => target.persistence.drizzle.transaction(async tx => {
        await tx.execute(sql`select pg_catalog.set_config('search_path',
          pg_catalog.quote_ident(${controlOwner.schemaName}) || ', pg_temp', true)`);
        await Effect.runPromise(verifyManagedRuntimePrivileges(tx, controlOwner.schemaName,
          { schemaName: controlOwner.migrationsSchema, tableName: controlOwner.migrationsTable }, "controlRead"));
      });
      await verifyData(); await verifyControl();
      const requiredFunctions = targetFunctions.filter(fn => fn.name === "fx_compare_finite_metadata" ||
        fn.name === "fx_accept_app_index_transitions" || fn.name === "fx_accept_app_unique_owners" ||
        fn.name === "fx_apply_app_unique_mutations" || fn.name === "fx_reset_app_index_validation" ||
        fn.name === "fx_apply_app_materialization");
      expect(requiredFunctions).toHaveLength(6);
      for (const required of requiredFunctions) {
        await targetOwner.persistence.execute(sql`revoke execute on function ${sql.raw(required.signature)} from ${sql.identifier(login.login)}`);
        try { await expect(verifyData(), required.name).rejects.toMatchObject({ reason: "invalidInstallation" }); }
        finally { await targetOwner.persistence.execute(sql`grant execute on function ${sql.raw(required.signature)} to ${sql.identifier(login.login)}`); }
        await verifyData();
      }
      // Verify each actual unexpected privilege before any installer could
      // reset grants and conceal the refusal witness.
      for (const fn of controlFunctions) {
        await controlOwner.persistence.execute(sql`grant execute on function ${sql.raw(fn.signature)} to ${sql.identifier(login.login)}`);
        try { await expect(verifyControl(), fn.name).rejects.toMatchObject({ reason: "invalidInstallation" }); }
        finally { await controlOwner.persistence.execute(sql`revoke execute on function ${sql.raw(fn.signature)} from ${sql.identifier(login.login)}`); }
        await verifyControl();
      }
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 180_000);
});

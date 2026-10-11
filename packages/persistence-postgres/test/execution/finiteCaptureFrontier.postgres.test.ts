import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { prepareInstalledFiniteCaptureSource, prepareInstalledAttemptScopeAuthority, prepareInstalledPairAuthority } from "../../src/scope/scopeAuthorityControlRead";
import { closeInstallationAdmission, getCoLocatedReadInstallationReferencesResult, managedInstallationIdentity, verifyManagedRuntimePrivileges } from "../../src/installation/installationLifecycle";
import { fxControlScopes } from "../../src/database/schema";
import { createPostgresPersistence } from "../../src/database/postgres";
import { bootstrapInstallationMigrations, publishVerifiedInstallation, withInstallationMaintenance } from "../../src/database/postgresInstallationMaintenance";
import { finiteFrontierPopulatedMigration, withFiniteFrontierPredecessor } from "./finiteCaptureFrontierMigrationScenario";
import { finiteAcceptingReadinessScenario } from "./finiteAcceptingReadinessScenario";
import { finiteCaptureFrontierScenario } from "./finiteCaptureFrontierScenario";
import { createCoLocatedReadInstallationFixture, createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture, postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";

describe.skipIf(postgresUrl === null)("finite scalar frontier PostgreSQL installation", () => {
  it.each([140, 141, 142, 143] as const)("replaces populated predecessor %i through actual maintenance without changing sessions or history", async through => {
    await withFiniteFrontierPredecessor(async (migrationsFolder, restoreCurrentJournal) => {
      await withTemporaryPostgresSchema(async options => {
        const persistence = await createPostgresPersistence({ ...options, migrationsFolder });
        try {
          const [location] = (await persistence.query<{ schema_name: string }>("select current_schema() schema_name")).rows;
          if (location === undefined) throw new Error("Missing actual predecessor namespace");
          await Effect.runPromise(bootstrapInstallationMigrations(persistence.pool.options, location.schema_name,
            { migrationsFolder, migrationsSchema: options.migrationsSchema }));
          await restoreCurrentJournal();
          await finiteFrontierPopulatedMigration(persistence, () => persistence.migrate(),through===143);
        } finally { await persistence.close(); }
      });
    }, through);
  }, 180_000);
  it("accepts complete fresh native build evidence and observes changes after the actual build wait", async () => {
    const fixture = await createFileScopedPostgresFixture();
    try {
      await finiteAcceptingReadinessScenario(fixture.persistence, fixture.persistence.drizzle, fixture.schemaName,
        async (scopeId, read) => {
          const writer = await fixture.persistence.pool.connect();
          let pending: ReturnType<typeof read> | undefined;
          try {
            await writer.query("begin");
            await writer.query("select 1 from fx_system_scope_execution_authority where scope_id=$1 for share", [scopeId]);
            await writer.query("select 1 from fx_system_scope_clock where scope_id=$1 for update", [scopeId]);
            await writer.query("select 1 from fx_system_index_build_state where scope_id=$1 and index_definition_id=141 for update", [scopeId]);
            const pid = (await writer.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
            if (pid === undefined) throw new Error("Missing finite readiness writer PID");
            pending = read();
            const deadline = Date.now() + 5_000;
            let blocked = false;
            while (Date.now() < deadline) {
              const state = (await fixture.persistence.query<{ blocked: boolean }>(`select exists(
                select 1 from pg_catalog.pg_stat_activity where $1::int=any(pg_blocking_pids(pid))
                  and wait_event_type='Lock') as blocked`, [pid])).rows[0];
              if (state?.blocked) { blocked = true; break; }
              await new Promise<void>(resolve => { setTimeout(resolve, 5); });
            }
            expect(blocked).toBe(true);
            await writer.query("update fx_system_index_build_state set covered_through_commit_seq=3,maintenance_activation_sequence=null where scope_id=$1", [scopeId]);
            await writer.query("update fx_system_scope_clock set last_commit_seq=5 where scope_id=$1", [scopeId]);
            await writer.query("commit");
            expect(await pending).toMatchObject([{ reason: "accepted", serving: "5" }]);
          } finally {
            await writer.query("rollback"); writer.release();
            await Promise.allSettled([pending]);
          }
        });
    } finally { await fixture.dispose(); }
  }, 180_000);
  it("refuses actual scalar routine, privilege and identity/result type faults before reopening", async () => {
    const fixture = await createFileScopedPostgresFixture();
    try { await finiteCaptureFrontierScenario(fixture.persistence, fixture.schemaName, () => fixture.persistence.migrate()); }
    finally { await fixture.dispose(); }
  }, 180_000);
});

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("finite scalar frontier ordinary-role acceptance", () => {
  it.each(["target", "control"] as const)("authenticates the actual pair with %s first, confines placement and observes changes", async first => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const firstOwner = await createFileScopedPostgresFixture(); cleanup.push(firstOwner.dispose);
      const secondOwner = await createFileScopedPostgresFixture(); cleanup.push(secondOwner.dispose);
      const lower = firstOwner.schemaName < secondOwner.schemaName ? firstOwner : secondOwner;
      const higher = lower === firstOwner ? secondOwner : firstOwner;
      const targetOwner = first === "target" ? lower : higher;
      const controlOwner = first === "control" ? lower : higher;
      const target = await createProtectedFileScopedPostgresFixture("managed", targetOwner); cleanup.push(target.dispose);
      const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner); cleanup.push(control.dispose);
      const pair = await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
      const database = target.persistence.drizzle;
      const locator = { kind: "shared_database" as const, databaseKey: "finite-frontier", schemaName: targetOwner.schemaName };
      const scopeId = ScopeIdSchema.make("scope_61380000-0000-4000-8000-000000000001");
      const deploymentId = "finite-frontier-deployment";
      await controlOwner.persistence.insertDeploymentMetadata({ deploymentId, projectId: "finite-frontier-project" });
      await controlOwner.persistence.insertScopeMetadata({ scopeId, deploymentId, physicalLocator: locator });
      let source = Result.getOrThrow(prepareInstalledFiniteCaptureSource(pair.installation, database, locator));
      const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, database));
      const accept = async (selection = { deploymentId, scopeId }) => database.transaction(async tx => {
        await tx.execute(sql`select pg_catalog.set_config('statement_timeout','30000',true)`);
        await tx.execute(sql`select pg_catalog.set_config('application_name',${`frontier-${targetOwner.schemaName}`},true)`);
        return tx.select({ scope: source.acceptedScope, targetEpoch: source.targetMetadataEpoch,
          controlEpoch: source.controlMetadataEpoch }).from(source.source).execute(selection);
      });
      const [login] = (await target.persistence.query<{ login: string; privileged: boolean }>(`select session_user as login,
        r.rolsuper or r.rolcreaterole or r.rolbypassrls as privileged from pg_catalog.pg_roles r where r.rolname=session_user`)).rows;
      if (login === undefined) throw new Error("Missing actual runtime login");
      expect(login.privileged).toBe(false);
      // Instrument the complete actual helper bodies; the original owner still
      // authenticates every field and acquires its real installation latch.
      // Transactional entry facts distinguish ordered serving gates from the
      // locking helper's independent admission. Restore before catalog checks.
      const audit = sql`${sql.identifier(controlOwner.schemaName)}.frontier_invocations`;
      await controlOwner.persistence.execute(sql`create table ${audit} (ordinal bigint generated always as identity, namespace text not null)`);
      const restoreGates: Array<() => Promise<void>> = [];
      const restoreAudit = async () => {
        for (const restore of restoreGates) await restore();
        await controlOwner.persistence.execute(sql`drop table if exists ${audit}`);
      };
      cleanup.push(restoreAudit);
      for (const owner of [targetOwner, controlOwner]) {
        const [native] = (await owner.persistence.execute<{ definition: string }>(sql`select pg_catalog.pg_get_functiondef(p.oid) as definition
          from pg_catalog.pg_proc p where p.pronamespace=${owner.schemaName}::pg_catalog.regnamespace
            and p.proname='fx_lock_installation_frontier'`)).rows;
        if (native === undefined) throw new Error("Missing native installation frontier body");
        const insertion = `BEGIN\n  INSERT INTO "${controlOwner.schemaName}".frontier_invocations(namespace) VALUES ('${owner.schemaName}');`;
        await owner.persistence.query(native.definition.replace("BEGIN", insertion));
        restoreGates.push(async () => { await owner.persistence.query(native.definition); });
      }
      const observedGates = async () => (await controlOwner.persistence.execute<{ namespace: string }>(
        sql`select namespace from ${audit} order by ordinal`)).rows.map(entry => entry.namespace);
      const clearGates = () => controlOwner.persistence.execute(sql`delete from ${audit}`);
      expect(await accept()).toEqual([{ scope: scopeId, targetEpoch: expect.stringMatching(/^[1-9][0-9]*$/),
        controlEpoch: expect.stringMatching(/^[1-9][0-9]*$/) }]);
      expect(await observedGates()).toEqual([lower.schemaName, higher.schemaName]);
      await clearGates();
      expect(await accept({ deploymentId, scopeId: ScopeIdSchema.make("scope_61380000-0000-4000-8000-000000000002") }))
        .toEqual([{ scope: null, targetEpoch: null, controlEpoch: null }]);
      expect(await accept({ deploymentId: "foreign-deployment", scopeId })).toMatchObject([{ scope: null }]);
      expect(await observedGates()).toEqual([]);
      // A fresh first-gate runtime-policy refusal must leave the second gate
      // unexecuted while retaining one complete refusal header.
      const firstNamespace = sql.identifier(lower.schemaName);
      const [firstPolicy] = (await lower.persistence.execute<{ endpoint: string }>(sql`select endpoint_policy as endpoint
        from ${firstNamespace}.fx_system_installation_runtime where login=${login.login}`)).rows;
      if (firstPolicy === undefined) throw new Error("Missing first native runtime policy");
      await lower.persistence.execute(sql`update ${firstNamespace}.fx_system_installation_runtime
        set endpoint_policy='refused-first-frontier' where login=${login.login}`);
      try {
        expect(await accept()).toEqual([{ scope: null, targetEpoch: null, controlEpoch: null }]);
        expect(await observedGates()).toEqual([lower.schemaName]);
      } finally {
        await lower.persistence.execute(sql`update ${firstNamespace}.fx_system_installation_runtime
          set endpoint_policy=${firstPolicy.endpoint} where login=${login.login}`);
      }
      const pairAuthority = Result.getOrThrow(prepareInstalledPairAuthority(pair.installation, database));
      const scopeAuthority = Result.getOrThrow(prepareInstalledAttemptScopeAuthority(pair.installation, database, locator));
      const targetIdentity = managedInstallationIdentity(refs.targetInstallation, database);
      if (targetIdentity === undefined) throw new Error("Missing genuine target identity");
      // Scoped scalar resource refusals survive the gated nullable clock joins.
      // Scope-less admission retains its separate existing timeout contract.
      for (const timeout of ["0", "31000"]) await database.transaction(async tx => {
        try {
          await tx.execute(sql`select pg_catalog.set_config('statement_timeout',${timeout},true)`);
          await expect(Effect.runPromise(scopeAuthority.lock(tx, { deploymentId, scopeId }, "share")))
            .rejects.toMatchObject({ reason: "resourceFailure" });
          const [row] = await tx.select(pairAuthority.fields).from(pairAuthority.source);
          if (row === undefined) throw new Error("Missing direct pair frontier");
          const evidence = await Effect.runPromise(pairAuthority.accept(tx, row));
          expect(evidence.target.epoch).toMatchObject({ databaseName: targetIdentity.databaseName,
            namespaceOid: BigInt(targetIdentity.namespaceOid), login: targetIdentity.login });
          expect(evidence.target.epoch.generation).toBeGreaterThan(0n);
          expect(evidence.control.epoch.generation).toBeGreaterThan(0n);
          expect(evidence.control.epoch.namespaceOid).not.toBe(evidence.target.epoch.namespaceOid);
        } finally { scopeAuthority.closeAcceptedTransaction(tx); closeInstallationAdmission(tx); }
      });
      const controlNamespace = sql.identifier(controlOwner.schemaName);
      const targetNamespace = sql.identifier(targetOwner.schemaName);
      const helper = sql`${targetNamespace}.fx_lock_installation_frontier(${targetNamespace}.fx_installation_frontier_expected)`;
      const placement = sql`${controlNamespace}.fx_lock_control_scope_placement(${controlNamespace}.fx_installation_frontier_expected,text,text,text)`;
      // Exercise SET ROLE with an actual separately issued ordinary login. It
      // has the required parse/read privileges; original-login authentication,
      // rather than a missing grant, must reject before either gate executes.
      const [foreignLogin] = (await control.persistence.query<{ login: string }>("select session_user as login")).rows;
      const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
      if (foreignLogin === undefined || provisioningUrl === undefined) throw new Error("Missing ordinary-role membership fixture");
      const foreignRole = sql.identifier(foreignLogin.login), runtimeRole = sql.identifier(login.login);
      await controlOwner.persistence.execute(sql`grant select on ${controlNamespace}.fx_control_scope to ${foreignRole}`);
      await targetOwner.persistence.execute(sql`grant usage on schema ${targetNamespace} to ${foreignRole}`);
      await targetOwner.persistence.execute(sql`grant usage on type ${targetNamespace}.fx_installation_frontier_expected,
        ${targetNamespace}.fx_installation_frontier to ${foreignRole}`);
      await targetOwner.persistence.execute(sql`grant execute on function ${helper} to ${foreignRole}`);
      await controlOwner.persistence.execute(sql`grant usage on type ${controlNamespace}.fx_control_scope_placement to ${foreignRole}`);
      await controlOwner.persistence.execute(sql`grant execute on function ${placement} to ${foreignRole}`);
      const membershipOwner = new Pool({ connectionString: provisioningUrl });
      try {
        await clearGates();
        await drizzle(membershipOwner).execute(sql`grant ${foreignRole} to ${runtimeRole}`);
        await database.transaction(async tx => {
          await tx.execute(sql`select pg_catalog.set_config('statement_timeout','30000',true)`);
          await tx.execute(sql`set local role ${foreignRole}`);
          const [identity] = await tx.select({ original: sql<string>`session_user`, active: sql<string>`current_user` })
            .from(sql`(select 1) actual_identity`);
          expect(identity).toEqual({ original: login.login, active: foreignLogin.login });
          expect(await tx.select({ scope: source.acceptedScope, targetEpoch: source.targetMetadataEpoch,
            controlEpoch: source.controlMetadataEpoch }).from(source.source).execute({ deploymentId, scopeId }))
            .toEqual([{ scope: null, targetEpoch: null, controlEpoch: null }]);
        });
        expect(await observedGates()).toEqual([]);
      } finally {
        try { await drizzle(membershipOwner).execute(sql`revoke ${foreignRole} from ${runtimeRole}`); }
        finally { await membershipOwner.end(); }
      }
      await restoreAudit();
      cleanup.pop();
      // Static invocation enforces the real runtime's exact target EXECUTE
      // privilege through the native backend failure boundary.
      await targetOwner.persistence.execute(sql`revoke execute on function ${helper} from ${sql.identifier(login.login)}`);
      try { await expect(accept()).rejects.toMatchObject({ cause: { code: "42501" } }); }
      finally { await targetOwner.persistence.execute(sql`grant execute on function ${helper} to ${sql.identifier(login.login)}`); }
      expect(await accept()).toMatchObject([{ scope: scopeId }]);
      await controlOwner.persistence.execute(sql`revoke execute on function ${placement} from ${sql.identifier(login.login)}`);
      try { await expect(accept()).rejects.toMatchObject({ cause: { code: "42501" } }); }
      finally { await controlOwner.persistence.execute(sql`grant execute on function ${placement} to ${sql.identifier(login.login)}`); }
      // A caller-chosen target string cannot make the control locking helper
      // invoke a same-named counterfeit under elevated authority.
      const counterfeitSchema = `${targetOwner.schemaName}_counterfeit`;
      const counterfeit = sql.identifier(counterfeitSchema);
      await targetOwner.persistence.execute(sql`create schema ${counterfeit}`);
      cleanup.push(async () => { await targetOwner.persistence.execute(sql`drop schema if exists ${counterfeit} cascade`); });
      await targetOwner.persistence.execute(sql`create type ${counterfeit}.fx_installation_frontier_expected as (
        database_name text,schema_name text,namespace_oid bigint,incarnation uuid,structural_generation bigint,
        login text,endpoint_policy text,access_profile text,metadata_incarnation uuid)`);
      await targetOwner.persistence.execute(sql`create table ${counterfeit}.invocations (invoker text)`);
      await targetOwner.persistence.execute(sql`create function ${counterfeit}.fx_lock_installation_frontier(
        expected ${counterfeit}.fx_installation_frontier_expected) returns ${controlNamespace}.fx_installation_frontier
        language plpgsql security invoker as $counterfeit$ BEGIN
          INSERT INTO ${counterfeit}.invocations VALUES(current_user);
          RETURN ROW(true,1::bigint); END; $counterfeit$`);
      await targetOwner.persistence.execute(sql`grant usage on schema ${counterfeit} to ${sql.identifier(login.login)}`);
      await targetOwner.persistence.execute(sql`grant usage on type ${counterfeit}.fx_installation_frontier_expected to ${sql.identifier(login.login)}`);
      await targetOwner.persistence.execute(sql`grant execute on function ${counterfeit}.fx_lock_installation_frontier(
        ${counterfeit}.fx_installation_frontier_expected) to ${sql.identifier(login.login)}`);
      const foreign = database.select({ scope: sql`(frontier).scope_id`.as("scope") }).from(sql`(select
        ${controlNamespace}.fx_lock_control_scope_placement(
          ${refs.control.localFrontierExpected},${deploymentId},${scopeId},${counterfeitSchema}) as frontier) foreign_request`);
      await database.transaction(async tx => {
        await tx.execute(sql`select pg_catalog.set_config('statement_timeout','30000',true)`);
        expect(await tx.execute(foreign)).toMatchObject({ rows: [{ scope: null }] });
      });
      expect((await targetOwner.persistence.execute(sql`select * from ${counterfeit}.invocations`)).rows).toEqual([]);
      // The unlocked namespace preauthorization is not the final verdict. A
      // real writer changes placement while the accepting scope lock waits.
      const writer = await controlOwner.persistence.pool.connect();
      let waiting: ReturnType<typeof accept> | undefined;
      try {
        await writer.query("begin");
        await drizzle(writer).update(fxControlScopes).set({ physicalLocator: { ...locator, schemaName: counterfeitSchema } })
          .where(eq(fxControlScopes.scopeId, scopeId));
        waiting = accept();
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const state = (await target.persistence.query<{ blocked: boolean }>(`select exists(
            select 1 from pg_catalog.pg_stat_activity where application_name=$1 and wait_event_type='Lock') as blocked`,
            [`frontier-${targetOwner.schemaName}`])).rows[0];
          if (state?.blocked) { blocked = true; break; }
          await new Promise<void>(resolve => { setTimeout(resolve, 5); });
        }
        expect(blocked).toBe(true);
        await writer.query("commit");
        expect(await waiting).toMatchObject([{ scope: null }]);
      } finally {
        await writer.query("rollback"); writer.release();
        await Promise.allSettled([waiting]);
      }
      expect((await targetOwner.persistence.execute(sql`select * from ${counterfeit}.invocations`)).rows).toEqual([]);
      await controlOwner.persistence.drizzle.update(fxControlScopes).set({ physicalLocator: locator })
        .where(eq(fxControlScopes.scopeId, scopeId));
      // Current placement is never inferred from the retained preparation.
      await controlOwner.persistence.drizzle.update(fxControlScopes).set({ physicalLocator: { ...locator, databaseKey: "moved" } })
        .where(eq(fxControlScopes.scopeId, scopeId));
      expect(await accept()).toMatchObject([{ scope: null }]);
      await controlOwner.persistence.drizzle.update(fxControlScopes).set({ physicalLocator: locator }).where(eq(fxControlScopes.scopeId, scopeId));
      expect(await accept()).toMatchObject([{ scope: scopeId }]);
      await Effect.runPromise(verifyManagedRuntimePrivileges(database, targetOwner.schemaName,
        { schemaName: targetOwner.migrationsSchema, tableName: targetOwner.migrationsTable }));
      await database.transaction(async tx => {
        await tx.execute(sql`select pg_catalog.set_config('search_path',pg_catalog.quote_ident(${controlOwner.schemaName}) || ', pg_temp',true)`);
        await Effect.runPromise(verifyManagedRuntimePrivileges(tx, controlOwner.schemaName,
          { schemaName: controlOwner.migrationsSchema, tableName: controlOwner.migrationsTable }, "controlRead"));
      });
      // These scalar gates still borrow the real installation latches. A
      // maintenance writer must drain the accepting transaction before it
      // changes identity, and an old preparation must then fail closed.
      let entered = () => {}, release = () => {};
      const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
      const releasePromise = new Promise<void>(resolve => { release = resolve; });
      let maintaining: Promise<void> | undefined;
      const reading = database.transaction(async tx => {
        await tx.execute(sql`select pg_catalog.set_config('statement_timeout','30000',true)`);
        expect(await tx.select({ scope: source.acceptedScope }).from(source.source).execute({ deploymentId, scopeId }))
          .toEqual([{ scope: scopeId }]);
        entered();
        await releasePromise;
      });
      void reading.then(entered, entered);
      try {
        await enteredPromise;
        maintaining = Effect.runPromise(withInstallationMaintenance({ ...controlOwner.persistence.pool.options,
          application_name: `frontier-drain-${controlOwner.schemaName}` }, controlOwner.schemaName, handle =>
          publishVerifiedInstallation(handle, [
            { database: control.persistence.drizzle, endpointPolicy: "protected-postgres-fixture" },
            { database, endpointPolicy: "colocated-control-read-fixture", accessProfile: "controlRead" },
          ], { migrationsSchema: controlOwner.migrationsSchema, migrationsTable: controlOwner.migrationsTable })));
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const state = (await controlOwner.persistence.query<{ blocked: boolean }>(`select exists(
            select 1 from pg_catalog.pg_stat_activity where application_name=$1 and wait_event_type='Lock') as blocked`,
            [`frontier-drain-${controlOwner.schemaName}`])).rows[0];
          if (state?.blocked) { blocked = true; break; }
          await new Promise<void>(resolve => { setTimeout(resolve, 5); });
        }
        expect(blocked).toBe(true);
        release();
        await reading; await maintaining;
      } finally { release(); await Promise.allSettled([reading, maintaining]); }
      expect(await accept()).toMatchObject([{ scope: null }]);
      const replacement = await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
      source = Result.getOrThrow(prepareInstalledFiniteCaptureSource(replacement.installation, database, locator));
      expect(await accept()).toMatchObject([{ scope: scopeId }]);
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 180_000);
});

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";
import { prepareInstalledFiniteCaptureSource, prepareInstalledAttemptScopeAuthority, prepareInstalledPairAuthority } from "../../src/scope/scopeAuthorityControlRead";
import { closeInstallationAdmission, getCoLocatedReadInstallationReferencesResult, managedInstallationIdentity, verifyManagedRuntimePrivileges } from "../../src/installation/installationLifecycle";
import { fxControlScopes } from "../../src/database/schema";
import { createPostgresPersistence } from "../../src/database/postgres";
import { bootstrapInstallationMigrations, publishVerifiedInstallation, withInstallationMaintenance } from "../../src/database/postgresInstallationMaintenance";
import { finiteFrontierPopulatedMigration, withFiniteFrontierPredecessor } from "./finiteCaptureFrontierMigrationScenario";
import { finiteCaptureFrontierScenario } from "./finiteCaptureFrontierScenario";
import { createCoLocatedReadInstallationFixture, createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture, postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";

describe.skipIf(postgresUrl === null)("finite scalar frontier PostgreSQL installation", () => {
  it("replaces the populated predecessor through actual maintenance without changing sessions or history", async () => {
    await withFiniteFrontierPredecessor(async (migrationsFolder, restoreCurrentJournal) => {
      await withTemporaryPostgresSchema(async options => {
        const persistence = await createPostgresPersistence({ ...options, migrationsFolder });
        try {
          const [location] = (await persistence.query<{ schema_name: string }>("select current_schema() schema_name")).rows;
          if (location === undefined) throw new Error("Missing actual predecessor namespace");
          await Effect.runPromise(bootstrapInstallationMigrations(persistence.pool.options, location.schema_name,
            { migrationsFolder, migrationsSchema: options.migrationsSchema }));
          await restoreCurrentJournal();
          await finiteFrontierPopulatedMigration(persistence, () => persistence.migrate());
        } finally { await persistence.close(); }
      });
    });
  }, 180_000);
  it("refuses actual scalar routine, privilege and identity/result type faults before reopening", async () => {
    const fixture = await createFileScopedPostgresFixture();
    try { await finiteCaptureFrontierScenario(fixture.persistence, fixture.schemaName, () => fixture.persistence.migrate()); }
    finally { await fixture.dispose(); }
  }, 180_000);
});

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("finite scalar frontier ordinary-role acceptance", () => {
  it("authenticates the actual pair, confines placement, observes changes and requires only the exact helper grants", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const targetOwner = await createFileScopedPostgresFixture(); cleanup.push(targetOwner.dispose);
      const target = await createProtectedFileScopedPostgresFixture("managed", targetOwner); cleanup.push(target.dispose);
      const controlOwner = await createFileScopedPostgresFixture(); cleanup.push(controlOwner.dispose);
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
      expect(await accept()).toEqual([{ scope: scopeId, targetEpoch: expect.stringMatching(/^[1-9][0-9]*$/),
        controlEpoch: expect.stringMatching(/^[1-9][0-9]*$/) }]);
      expect(await accept({ deploymentId: "foreign-deployment", scopeId })).toMatchObject([{ scope: null }]);
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
      const placement = sql`${controlNamespace}.fx_accept_finite_placement_frontier(${controlNamespace}.fx_installation_frontier_expected,
        ${controlNamespace}.fx_installation_frontier_expected,text,text)`;
      // The privileged control owner still authenticates the real runtime role's
      // EXECUTE grant before invoking a target's fixed helper on its behalf.
      await targetOwner.persistence.execute(sql`revoke execute on function ${helper} from ${sql.identifier(login.login)}`);
      try { expect(await accept()).toMatchObject([{ scope: null }]); }
      finally { await targetOwner.persistence.execute(sql`grant execute on function ${helper} to ${sql.identifier(login.login)}`); }
      expect(await accept()).toMatchObject([{ scope: scopeId }]);
      await controlOwner.persistence.execute(sql`revoke execute on function ${placement} from ${sql.identifier(login.login)}`);
      try { await expect(accept()).rejects.toMatchObject({ cause: { code: "42501" } }); }
      finally { await controlOwner.persistence.execute(sql`grant execute on function ${placement} to ${sql.identifier(login.login)}`); }
      // Grant an actual same-named counterfeit. Its invoker body would inherit
      // the privileged control owner if namespace authorization were absent.
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
        ${controlNamespace}.fx_accept_finite_placement_frontier(
          row(current_database(),${counterfeitSchema},${counterfeitSchema}::pg_catalog.regnamespace::oid::bigint,gen_random_uuid(),1::bigint,session_user,
            'foreign','dataRuntime',gen_random_uuid())::${controlNamespace}.fx_installation_frontier_expected,
          ${refs.control.frontierExpected},${deploymentId},${scopeId}) as frontier) foreign_request`);
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

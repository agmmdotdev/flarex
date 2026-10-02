import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { acquireInstallationAdmission, acceptCoLocatedInstallationAdmission, closeInstallationAdmission,
  getCoLocatedReadInstallationReferences, loadManagedInstallation, requireCoLocatedInstallationAdmission } from "../../persistence-postgres/src/installationLifecycle";
import { acceptProtectedMetadataFinalGuardBatch, captureProtectedMetadataEpoch, closeProtectedMetadataFinalGuardScope,
  openProtectedMetadataFinalGuardScope, prepareProtectedMetadata, prepareProtectedMetadataFinalGuardBatch,
  recordManagedMetadataEpochSnapshot, registerProtectedMetadataFinalGuard } from "../../persistence-postgres/src/preparedMetadataEpoch";
import { publishVerifiedInstallation, withInstallationMaintenance } from "../../persistence-postgres/src/postgresInstallationMaintenance";
import { fxControlScopes, fxControlScopeProvisioning, fxSystemPreparedMetadataEpoch } from "../../persistence-postgres/src/schema";
import { getScopeMetadata, decodeScopeMetadataRecord } from "../../persistence-postgres/src/scopeMetadata";
import { getScopeAuthorityProvisioningReceipt, decodeScopeAuthorityProvisioningReceipt } from "../../persistence-postgres/src/scopeAuthorityProvisioningReceipt";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { createCoLocatedReadInstallationFixture, createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/postgresHelpers";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
const endpointPolicy = "protected-postgres-fixture";
const controlEndpointPolicy = "colocated-control-read-fixture";

function signal() {
  let release: () => void = () => { throw new Error("Uninitialized barrier"); };
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const gateSelection = (alias: string) => {
  const name = sql.identifier(alias);
  return { databaseName: sql<string>`${name}.database_name`, schemaName: sql<string>`${name}.schema_name`,
    namespaceOid: sql<string>`${name}.namespace_oid::text`, incarnation: sql<string>`${name}.incarnation::text`,
    structuralGeneration: sql<string>`${name}.structural_generation::text`, login: sql<string>`${name}.login`,
    sameLogin: sql<boolean>`${name}.same_login`, actualDatabase: sql<string>`${name}.actual_database`,
    sameSchema: sql<boolean>`${name}.same_schema` };
};
const epochSelection = (alias: string) => {
  const name = sql.identifier(alias);
  return { databaseName: sql<string>`${name}.database_name`,
    namespaceOid: sql`${name}.namespace_oid`.mapWith(fxSystemPreparedMetadataEpoch.namespaceOid),
    incarnation: sql<string>`${name}.incarnation`,
    generation: sql`${name}.generation`.mapWith(fxSystemPreparedMetadataEpoch.generation), login: sql<string>`session_user` };
};

native("colocated installation authority", () => {
  it("attests one actual login, locks current placement without control DML and fences both original epochs", async () => {
    const cleanups: Array<() => Promise<void>> = [];
    try {
      const controlOwner = await createFileScopedPostgresFixture(); cleanups.push(controlOwner.dispose);
      const targetOwner = await createFileScopedPostgresFixture(); cleanups.push(targetOwner.dispose);
      const seeded = await logicalCurrencyFixture("postgres", cleanup => { cleanups.push(cleanup); }, {
        resource: { kind: "postgres", control: controlOwner.persistence, target: targetOwner.persistence },
        fixtureIdentity: { deploymentId: "installation_colocated_scope", projectId: "installation_colocated_scope", uuidOffset: 7000 },
      });
      const target = await createProtectedFileScopedPostgresFixture("managed", targetOwner); cleanups.push(target.dispose);
      const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner); cleanups.push(control.dispose);
      if (control.installation === undefined) throw new Error("Missing source control installation");
      const pair = (await createCoLocatedReadInstallationFixture({ target, control, controlOwner })).installation;
      const database = target.persistence.drizzle;
      const refs = await Effect.runPromise(getCoLocatedReadInstallationReferences(pair, database));
      const targetProtection = await Effect.runPromise(prepareProtectedMetadata(database, refs.targetInstallation));
      const controlProtection = await Effect.runPromise(prepareProtectedMetadata(database, refs.controlInstallation));
      const scopeId = seeded.application.authority.scopeId, deploymentId = seeded.deploymentId;
      const originalScope = await getScopeMetadata(controlOwner.persistence.drizzle, scopeId);
      const originalReceipt = await getScopeAuthorityProvisioningReceipt(controlOwner.persistence.drizzle, scopeId);
      expect(originalScope).not.toBeNull(); expect(originalReceipt?.state).toBe("ready");

      for (const statement of [
        `update "${controlOwner.schemaName}".fx_control_scope set active_schema_version_id = active_schema_version_id where false`,
        `insert into "${controlOwner.schemaName}".fx_control_scope select * from "${controlOwner.schemaName}".fx_control_scope where false`,
        `select * from "${controlOwner.schemaName}".fx_control_scope where id = '${scopeId}' for share`,
      ]) await expect(target.persistence.query(statement)).rejects.toMatchObject({ code: "42501" });
      await expect(Effect.runPromise(prepareProtectedMetadata(database, control.installation)))
        .rejects.toMatchObject({ reason: "unprotectedRuntime" });

      const admit = async (tx: FlarexMetadataTransaction) => {
        const [row] = await tx.select({ target: gateSelection("t"), control: gateSelection("c") })
          .from(sql`${refs.target.gate} t cross join ${refs.control.gate} c`);
        if (row === undefined) throw new Error("Pair gate returned no row");
        await Effect.runPromise(acceptCoLocatedInstallationAdmission(pair, database, tx, row));
        await Effect.runPromise(requireCoLocatedInstallationAdmission(pair, database, tx));
      };
      await database.transaction(async tx => {
        try {
          await Effect.runPromise(acquireInstallationAdmission(refs.targetInstallation, database, tx));
          const targetEpoch = await captureEpochRows(tx);
          await expect(Effect.runPromise(recordManagedMetadataEpochSnapshot(tx, database, refs.targetInstallation, targetEpoch.target)))
            .rejects.toMatchObject({ reason: "unprotectedRuntime" });
        } finally { closeInstallationAdmission(tx); closeProtectedMetadataFinalGuardScope(tx); }
      });

      const entered = signal(), release = signal();
      let reading: Promise<void> | undefined;
      const updater = await controlOwner.persistence.pool.connect();
      let updating: Promise<unknown> | undefined;
      try {
        const pid = (await updater.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("No updater backend");
        reading = database.transaction(async tx => {
          openProtectedMetadataFinalGuardScope(tx);
          try {
            // A temporary shadow must not affect the qualified control function.
            await tx.execute(sql`create temporary table fx_control_scope (id text, deployment_id text)`);
            await admit(tx);
            const placement = await tx.select({
              scope: { scopeId: sql`p.scope_id`.mapWith(fxControlScopes.scopeId), deploymentId: sql`p.deployment_id`.mapWith(fxControlScopes.deploymentId),
                activeSchemaVersionId: sql`p.active_schema_version_id`.mapWith(fxControlScopes.activeSchemaVersionId),
                isolationKind: sql`p.isolation_kind`.mapWith(fxControlScopes.isolationKind), physicalLocator: sql`p.physical_locator_json`.mapWith(fxControlScopes.physicalLocator),
                createdAt: sql`p.created_at`.mapWith(fxControlScopes.createdAt) },
              receipt: { scopeId: sql`p.receipt_scope_id`.mapWith(fxControlScopeProvisioning.scopeId),
                protocolVersion: sql`p.receipt_protocol_version`.mapWith(fxControlScopeProvisioning.protocolVersion),
                state: sql`p.receipt_state`.mapWith(fxControlScopeProvisioning.state), physicalLocator: sql`p.receipt_physical_locator_json`.mapWith(fxControlScopeProvisioning.physicalLocator),
                initialEpoch: sql`p.receipt_initial_epoch`.mapWith(fxControlScopeProvisioning.initialEpoch),
                reservedAt: sql`p.receipt_reserved_at`.mapWith(fxControlScopeProvisioning.reservedAt), readyAt: sql`p.receipt_ready_at`.mapWith(fxControlScopeProvisioning.readyAt) },
            }).from(sql`${sql.identifier(refs.control.schemaName)}.fx_lock_read_scope_placement(${deploymentId},${scopeId}) p`);
            const [placementRow] = placement;
            if (placementRow === undefined) throw new Error("No placement row");
            expect(decodeScopeMetadataRecord(placementRow.scope)).toEqual(originalScope);
            expect(decodeScopeAuthorityProvisioningReceipt(placementRow.receipt)).toEqual(originalReceipt);
            expect(await tx.select({ scope: sql<string>`p.scope_id` }).from(sql`${sql.identifier(refs.control.schemaName)}.
              fx_lock_read_scope_placement(${"wrong-deployment"},${scopeId}) p`)).toEqual([]);
            const observed = await captureEpochRows(tx);
            await Effect.runPromise(recordManagedMetadataEpochSnapshot(tx, database, refs.targetInstallation, observed.target));
            await Effect.runPromise(recordManagedMetadataEpochSnapshot(tx, database, refs.controlInstallation, observed.control));
            const targetEpoch = await Effect.runPromise(captureProtectedMetadataEpoch(targetProtection, database, tx));
            const controlEpoch = await Effect.runPromise(captureProtectedMetadataEpoch(controlProtection, database, tx));
            expect(targetEpoch.namespaceOid).not.toBe(controlEpoch.namespaceOid);
            await Effect.runPromise(registerProtectedMetadataFinalGuard(tx, targetProtection, database, targetEpoch));
            await Effect.runPromise(registerProtectedMetadataFinalGuard(tx, controlProtection, database, controlEpoch));
            entered.release();
            await release.promise;
            const batch = await Effect.runPromise(prepareProtectedMetadataFinalGuardBatch(tx));
            const finalRows = await tx.select({ valid: sql<boolean>`g.valid` }).from(sql`${batch.source} g`);
            await Effect.runPromise(acceptProtectedMetadataFinalGuardBatch(tx, finalRows));
          } finally { closeInstallationAdmission(tx); closeProtectedMetadataFinalGuardScope(tx); }
        }, { isolationLevel: "repeatable read" });
        await Promise.race([entered.promise, reading]);
        updating = updater.query(`update "${controlOwner.schemaName}".fx_control_scope
          set active_schema_version_id = active_schema_version_id where id = $1`, [scopeId]);
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const waiting = await controlOwner.persistence.pool.query<{ blocked: boolean }>(
            "select cardinality(pg_catalog.pg_blocking_pids($1)) > 0 as blocked", [pid]);
          if (waiting.rows[0]?.blocked === true) { blocked = true; break; }
          await new Promise<void>(resolve => { setTimeout(resolve, 5); });
        }
        expect(blocked).toBe(true);
        release.release(); await reading; await updating;
      } finally {
        release.release(); await Promise.allSettled([reading, updating]); updater.release();
      }

      const controlJournal = { migrationsSchema: controlOwner.migrationsSchema, migrationsTable: controlOwner.migrationsTable };
      const controlPolicies = [{ database: control.persistence.drizzle, endpointPolicy },
        { database, endpointPolicy: controlEndpointPolicy, accessProfile: "controlRead" as const }];
      // A restore missing the exact receipt PK cannot issue the function's
      // installed single-row proof, even though its present rows look valid.
      await controlOwner.persistence.query(`alter table "${controlOwner.schemaName}".fx_control_scope_provisioning
        drop constraint fx_control_scope_provisioning_pkey`);
      await expect(Effect.runPromise(withInstallationMaintenance(controlOwner.persistence.pool.options, controlOwner.schemaName,
        handle => publishVerifiedInstallation(handle, controlPolicies, controlJournal))))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
      expect((await controlOwner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      await controlOwner.persistence.query(`alter table "${controlOwner.schemaName}".fx_control_scope_provisioning
        add primary key (scope_id)`);
      await Effect.runPromise(withInstallationMaintenance(controlOwner.persistence.pool.options, controlOwner.schemaName,
        handle => publishVerifiedInstallation(handle, controlPolicies, controlJournal)));
      await controlOwner.persistence.query(`grant update (active_schema_version_id) on
        "${controlOwner.schemaName}".fx_control_scope to public`);
      await expect(Effect.runPromise(withInstallationMaintenance(controlOwner.persistence.pool.options, controlOwner.schemaName,
        handle => publishVerifiedInstallation(handle, controlPolicies, controlJournal))))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
      expect((await controlOwner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      await controlOwner.persistence.query(`revoke update (active_schema_version_id) on
        "${controlOwner.schemaName}".fx_control_scope from public`);
      await Effect.runPromise(withInstallationMaintenance(controlOwner.persistence.pool.options, controlOwner.schemaName,
        handle => publishVerifiedInstallation(handle, controlPolicies, controlJournal)));
      await expect(database.transaction(admit)).rejects.toThrow("Pair gate returned no row");
      const replacementPair = (await createCoLocatedReadInstallationFixture({ target, control, controlOwner })).installation;
      const replacementRefs = await Effect.runPromise(getCoLocatedReadInstallationReferences(replacementPair, database));
      await Effect.runPromise(withInstallationMaintenance(targetOwner.persistence.pool.options, targetOwner.schemaName,
        handle => publishVerifiedInstallation(handle, [{ database, endpointPolicy }], {
          migrationsSchema: targetOwner.migrationsSchema, migrationsTable: targetOwner.migrationsTable })));
      await expect(database.transaction(async tx => {
        try {
          const [row] = await tx.select({ target: gateSelection("t"), control: gateSelection("c") })
            .from(sql`${replacementRefs.target.gate} t cross join ${replacementRefs.control.gate} c`);
          if (row === undefined) throw new Error("No replacement gate row");
          await Effect.runPromise(acceptCoLocatedInstallationAdmission(replacementPair, database, tx, row));
        } finally { closeInstallationAdmission(tx); }
      })).rejects.toThrow("No replacement gate row");
      const currentTarget = await Effect.runPromise(loadManagedInstallation(database, endpointPolicy, targetOwner.schemaName));
      expect(currentTarget).not.toBe(refs.targetInstallation);

      async function captureEpochRows(tx: FlarexMetadataTransaction) {
        const [row] = await tx.select({ target: epochSelection("t"), control: epochSelection("c") }).from(sql`
          ${sql.identifier(refs.target.schemaName)}.fx_system_prepared_metadata_epoch t cross join
          ${sql.identifier(refs.control.schemaName)}.fx_system_prepared_metadata_epoch c`);
        if (row === undefined) throw new Error("No epoch row");
        return row;
      }
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
    }
  }, 240_000);
});

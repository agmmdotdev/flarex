import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { fxSystemApplicationActiveHeads, fxSystemApplicationActivations, fxSystemApplicationReadBindings } from "../../persistence-postgres/src/applicationActivationSchema";
import { fxSystemApplicationReadiness } from "../../persistence-postgres/src/applicationRelationSchema";
import { fxControlSchemaVersions, fxSystemApplicationReadinessV1,
  fxControlLogicalReadSources, fxControlLogicalReadTables, fxControlLogicalReadAccess,
  fxSystemMetadataContractObservations, fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { acquireInstallationAdmission, loadManagedInstallation } from "../../persistence-postgres/src/installationLifecycle";
import { captureProtectedMetadataEpoch, prepareProtectedMetadata,
  type ProtectedMetadataEpochIdentity, type PreparedMetadataEpochError } from "../../persistence-postgres/src/preparedMetadataEpoch";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import { backfillInstallationMetadataBindings, backfillInstallationLogicalReadProjections,
  publishVerifiedInstallation, runInstallationMigrations, withInstallationMaintenance } from "../../persistence-postgres/src/postgresInstallationMaintenance";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/postgresHelpers";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
const endpointPolicy = "protected-postgres-fixture";

native("existing installation derived-metadata restoration", () => {
  it("rebuilds real Application heads and logical sources without changing their durable roots", async () => {
    const cleanups: Array<() => Promise<void>> = [];
    try {
      const controlOwner = await createFileScopedPostgresFixture();
      cleanups.push(controlOwner.dispose);
      const targetOwner = await createFileScopedPostgresFixture();
      cleanups.push(targetOwner.dispose);
      // The real fixture publishes canonical readiness, activates the Application,
      // admits the composed logical schema and installs its real definitions.
      await logicalCurrencyFixture("postgres", cleanup => { cleanups.push(cleanup); }, {
        resource: { kind: "postgres", control: controlOwner.persistence, target: targetOwner.persistence, testOwner: targetOwner.persistence },
        fixtureIdentity: { deploymentId: "installation_existing_roots", projectId: "installation_existing_roots", uuidOffset: 6000 },
        includeUserNameIndex: true,
      });
      const target = targetOwner.persistence.drizzle, control = controlOwner.persistence.drizzle;
      const primary = async () => ({
        heads: await target.select().from(fxSystemApplicationActiveHeads).orderBy(fxSystemApplicationActiveHeads.scopeId),
        activations: await target.select().from(fxSystemApplicationActivations).orderBy(fxSystemApplicationActivations.activationSequence),
        readiness: await target.select().from(fxSystemApplicationReadiness).orderBy(fxSystemApplicationReadiness.scopeId),
        readinessV1: await target.select().from(fxSystemApplicationReadinessV1).orderBy(fxSystemApplicationReadinessV1.scopeId),
        artifacts: await control.select().from(fxControlSchemaVersions).orderBy(fxControlSchemaVersions.deploymentId, fxControlSchemaVersions.schemaVersionId),
      });
      const derived = async () => ({
        bindings: await target.select().from(fxSystemApplicationReadBindings).orderBy(fxSystemApplicationReadBindings.scopeId, fxSystemApplicationReadBindings.activationSequence),
        sources: await control.select().from(fxControlLogicalReadSources).orderBy(fxControlLogicalReadSources.sourceKey),
        tables: await control.select().from(fxControlLogicalReadTables).orderBy(fxControlLogicalReadTables.sourceKey, fxControlLogicalReadTables.localName),
        access: await control.select().from(fxControlLogicalReadAccess).orderBy(fxControlLogicalReadAccess.sourceKey, fxControlLogicalReadAccess.localName,
          fxControlLogicalReadAccess.selectorKind, fxControlLogicalReadAccess.selectorKey),
      });
      const beforePrimary = await primary(), beforeDerived = await derived();
      expect(beforePrimary.heads).toHaveLength(1);
      expect(beforePrimary.activations).toHaveLength(1);
      expect(beforePrimary.readiness.length + beforePrimary.readinessV1.length).toBeGreaterThan(0);
      expect(beforePrimary.artifacts.length).toBeGreaterThan(0);
      expect(beforeDerived.bindings).toHaveLength(1);
      expect(beforeDerived.sources.length).toBeGreaterThan(0);
      expect(beforeDerived.tables.length).toBeGreaterThan(0);
      expect(beforeDerived.access.length).toBeGreaterThan(0);

      const targetReader = await createProtectedFileScopedPostgresFixture("managed", targetOwner);
      cleanups.push(targetReader.dispose);
      const controlReader = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
      cleanups.push(controlReader.dispose);
      const migrationsFolder = await mkdtemp(join(tmpdir(), "flarex-installation-restore-"));
      cleanups.push(() => rm(migrationsFolder, { recursive: true, force: true }));
      await mkdir(join(migrationsFolder, "meta"));
      await writeFile(join(migrationsFolder, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1, tag: "0000_missing_derived_metadata", breakpoints: true }] }));
      // Simulate a restored installation missing only derived metadata. This is
      // not a historical-code compatibility proof and never deletes primary roots.
      await writeFile(join(migrationsFolder, "0000_missing_derived_metadata.sql"), `truncate table
        fx_system_application_read_binding, fx_control_logical_read_access,
        fx_control_logical_read_table, fx_control_logical_read_source`);

      for (const [owner, reader] of [[targetOwner, targetReader], [controlOwner, controlReader]] as const) {
        await Effect.runPromise(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle => Effect.gen(function* () {
          yield* runInstallationMigrations(handle, { migrationsFolder, migrationsSchema: owner.migrationsSchema,
            migrationsTable: "installation_restore_migrations" });
          expect(yield* Effect.promise(primary)).toEqual(beforePrimary);
          const missing = yield* Effect.promise(() => owner.persistence.query<{ total: number }>(`select
            ((select count(*) from fx_system_application_read_binding) + (select count(*) from fx_control_logical_read_access)
            + (select count(*) from fx_control_logical_read_table) + (select count(*) from fx_control_logical_read_source))::integer as total`));
          expect(missing.rows).toEqual([{ total: 0 }]);
          if (owner === targetOwner) {
            const metadata = () => Promise.all([target.select().from(fxSystemMetadataContractObservations),
              target.select().from(fxSystemScopeClocks)]);
            const before = yield* Effect.promise(metadata);
            // The data installation is a genuine database but has no control
            // catalog. A missing catalog must fail before any derived write.
            const refused = yield* backfillInstallationMetadataBindings(handle, targetOwner.persistence.drizzle).pipe(Effect.result);
            expect(Result.isFailure(refused)).toBe(true);
            if (Result.isFailure(refused)) expect(refused.failure.reason).toBe("invalidInstallation");
            expect(yield* Effect.promise(metadata)).toEqual(before);
            expect(yield* Effect.promise(() => target.select().from(fxSystemApplicationReadBindings))).toEqual([]);
          }
          for (let replay = 0; replay < 2; replay++) {
            yield* backfillInstallationMetadataBindings(handle, controlOwner.persistence.drizzle);
            yield* backfillInstallationLogicalReadProjections(handle);
          }
          yield* publishVerifiedInstallation(handle, [{ database: reader.persistence.drizzle, endpointPolicy }], {
            migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable,
          });
        })));
        const database = reader.persistence.drizzle;
        const oldInstallation = reader.installation;
        if (oldInstallation === undefined) throw new Error("Managed fixture did not issue an installation");
        await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(oldInstallation, database, tx))))
          .rejects.toMatchObject({ reason: "changed" });
        const installation = await Effect.runPromise(loadManagedInstallation(database, endpointPolicy, owner.schemaName));
        const protection = await Effect.runPromise(prepareProtectedMetadata(database, installation));
        const epoch = await Effect.runPromise(runEffectTransaction<ProtectedMetadataEpochIdentity,
          PreparedMetadataEpochError, Error, FlarexMetadataTransaction>(work => database.transaction(work), "Restored metadata capture",
          tx => captureProtectedMetadataEpoch(protection, database, tx), cause => new Error("Restored capture failed", { cause }),
          { token: installation, database }));
        expect(epoch.generation).toBeGreaterThan(0n);
      }
      expect(await primary()).toEqual(beforePrimary);
      expect(await derived()).toEqual(beforeDerived);
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
    }
  }, 240_000);
});

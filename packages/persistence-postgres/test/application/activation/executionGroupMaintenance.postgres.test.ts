import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { acquireInstallationAdmission, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { createApplicationNativeMutationPostgresFixture } from "../applicationNativeMutationTestFixture";
import { EXECUTION_GROUP_MAINTENANCE_OPTIONS, executionGroupMaintenanceScenario } from "./executionGroupMaintenanceScenario";
import { runEffect } from "../../support/effectTestRuntime";

describe.skipIf(postgresUrl === null || process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL === undefined)("execution-group maintenance on ordinary PostgreSQL", () => {
  it("reconciles through public migrate and expires installed capabilities without terminalizing logical attempts", async () => {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const control = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture()),
          fixture => Effect.tryPromise(fixture.dispose).pipe(Effect.orDie));
      const owner = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({},
        { immutableCatalog: control.persistence.drizzle }, "finiteCapture")),
        fixture => Effect.tryPromise(fixture.dispose).pipe(Effect.orDie));
      const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createProtectedFileScopedPostgresFixture("managed", owner, "finiteCapture")),
          fixture => Effect.tryPromise(fixture.dispose).pipe(Effect.orDie));
      const installation = target.installation;
      if (installation === undefined) throw new Error("Missing genuine installed capability");
      expect((yield* Effect.tryPromise(() => target.persistence.query<{ superuser: boolean; bypass: boolean }>(
        "select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user"))).rows)
        .toEqual([{ superuser: false, bypass: false }]);
      expect((yield* Effect.tryPromise(() => owner.persistence.query<{ superuser: boolean; bypass: boolean; ownsSchema: boolean }>(
        `select r.rolsuper as superuser,r.rolbypassrls as bypass,n.nspowner=r.oid as "ownsSchema"
         from pg_roles r join pg_namespace n on n.nspname=current_schema() where r.rolname=current_user`))).rows)
        .toEqual([{ superuser: false, bypass: false, ownsSchema: true }]);
      // The native graph uses the ordinary schema owner's fullProof profile.
      // The separate restricted target witnesses installed-capability expiry.
      const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPostgresFixture(EXECUTION_GROUP_MAINTENANCE_OPTIONS,
        { control: control.persistence, target: owner.persistence }));
      // Public migrate owns the actual dedicated maintenance lifecycle and
      // republishes this exact restricted runtime policy after reconciliation.
      const maintenance = yield* Effect.tryPromise(() => createPostgresPersistence({ pool: owner.persistence.pool,
        migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable,
        immutableCatalog: control.persistence.drizzle,
        installation: { kind: "managed", runtimePolicies: [{ database: target.persistence.drizzle,
          endpointPolicy: "protected-postgres-fixture" }] } }));
      const admit = () => target.persistence.drizzle.transaction(async tx => {
        try { await runEffect(acquireInstallationAdmission(installation, target.persistence.drizzle, tx)); }
        finally { closeInstallationAdmission(tx); }
      });
      yield* Effect.tryPromise(admit);
      yield* executionGroupMaintenanceScenario(native, { writer: owner.persistence,
        migrate: () => maintenance.migrate(), assertStaleInstalledCapability: async () => {
          await expect(admit()).rejects.toMatchObject({ reason: "changed" });
        } });
    })));
  }, 180_000);
});

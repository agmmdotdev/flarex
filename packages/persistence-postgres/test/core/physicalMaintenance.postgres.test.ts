import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { makeCorePostgresDriver } from "../../src/database/corePersistence/driver";
import { installManagedPreviousLayout, registerCorePhysicalMaintenanceScenarios } from "./physicalMaintenanceScenarios";
import { upgradeCorePersistenceAfterDrain } from "../../src/database/corePersistence/target";
import { readCorePhysicalBaseline } from "../../src/database/corePersistence/physicalMaintenance";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));
const Role = Schema.Array(Schema.Struct({ role_name: Schema.String, rolsuper: Schema.Boolean,
  rolbypassrls: Schema.Boolean, rolcreatedb: Schema.Boolean, rolcreaterole: Schema.Boolean }));

describe.runIf(endpoints !== undefined)("ordinary-role physical maintenance", () => {
  it("refuses an undrained indexes writer before lease locking and upgrades only after its actual SQL drain", async () => {
    if (endpoints === undefined) throw new Error("PostgreSQL maintenance endpoints were not selected");
    const namespace = `physical_${randomUUID().replaceAll("-", "")}`;
    const management = new Pool({ connectionString: endpoints.provisioningConnectionString, max: 2,
      statement_timeout: 5_000 });
    const maintenance = makeCorePostgresDriver(management);
    try {
      await Effect.runPromise(installManagedPreviousLayout({ namespace, maintenance }));
      await management.query(`INSERT INTO "${namespace}".leases VALUES ('app',41)`);
      const before = await Effect.runPromise(readCorePhysicalBaseline(maintenance, namespace));
      const blocker = await management.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(`LOCK TABLE "${namespace}".indexes IN ROW EXCLUSIVE MODE`);
        const outcome = await Effect.runPromise(Effect.result(upgradeCorePersistenceAfterDrain(maintenance, namespace)));
        expect(outcome).toMatchObject({ failure: { reason: "unavailable", cause: { code: "55P03" } } });
        expect(await management.query(`SELECT ts::text AS token FROM "${namespace}".leases WHERE instance_name='app'`))
          .toMatchObject({ rows: [{ token: "41" }] });
        expect(await Effect.runPromise(readCorePhysicalBaseline(maintenance, namespace))).toEqual(before);
      } finally {
        try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      }
      await Effect.runPromise(upgradeCorePersistenceAfterDrain(maintenance, namespace));
      expect(await management.query(`SELECT ts::text AS token FROM "${namespace}".leases WHERE instance_name='app'`))
        .toMatchObject({ rows: [{ token: "42" }] });
    } finally {
      try { await management.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); } finally { await management.end(); }
    }
  }, 30_000);

  if (endpoints !== undefined) registerCorePhysicalMaintenanceScenarios("PostgreSQL", async () => {
    const namespace = `physical_${randomUUID().replaceAll("-", "")}`;
    const management = new Pool({ connectionString: endpoints.provisioningConnectionString, max: 2 });
    const runtime = new Pool({ connectionString: endpoints.connectionString, max: 2, statement_timeout: 30_000 });
    const maintenance = makeCorePostgresDriver(management); const serving = makeCorePostgresDriver(runtime);
    try {
      const roles = Schema.decodeUnknownSync(Role)(await Effect.runPromise(serving.query(`SELECT current_user::text AS role_name,
        rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`)));
      const role = roles[0];
      if (role === undefined || roles.length !== 1 || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole)
        throw new Error("Physical serving proof requires the existing ordinary PostgreSQL role");
      const quotedRole = `"${role.role_name.replaceAll('"', '""')}"`;
      return { namespace, maintenance, serving, ordinaryServingRole: true,
        grantServing: () => Effect.gen(function* () {
          yield* maintenance.query(`GRANT USAGE ON SCHEMA "${namespace}" TO ${quotedRole}`);
          yield* maintenance.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${namespace}" TO ${quotedRole}`);
        }),
        close: async () => {
          const failures: unknown[] = [];
          try { await runtime.end(); } catch (cause: unknown) { failures.push(cause); }
          try { await management.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); } catch (cause: unknown) { failures.push(cause); }
          try { await management.end(); } catch (cause: unknown) { failures.push(cause); }
          if (failures.length > 0) throw new AggregateError(failures, "Physical maintenance fixture cleanup failed");
        },
      };
    } catch (cause: unknown) {
      const cleanup = await Promise.allSettled([runtime.end(), management.end()]);
      const failures = cleanup.filter(result => result.status === "rejected").map(result => result.reason);
      throw failures.length === 0 ? cause : new AggregateError([cause, ...failures], "Physical fixture setup/cleanup failed");
    }
  });
});

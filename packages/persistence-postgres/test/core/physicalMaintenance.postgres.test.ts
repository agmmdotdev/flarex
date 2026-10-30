import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { describe } from "vitest";
import { Pool } from "pg";
import { makeCorePostgresDriver } from "../../src/database/corePersistence/driver";
import { registerCorePhysicalMaintenanceScenarios } from "./physicalMaintenanceScenarios";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));
const Role = Schema.Array(Schema.Struct({ role_name: Schema.String, rolsuper: Schema.Boolean,
  rolbypassrls: Schema.Boolean, rolcreatedb: Schema.Boolean, rolcreaterole: Schema.Boolean }));

describe.runIf(endpoints !== undefined)("ordinary-role physical maintenance", () => {
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

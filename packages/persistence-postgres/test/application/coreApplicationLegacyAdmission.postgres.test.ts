import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Schema } from "effect";
import { Client, Pool } from "pg";
import { describe } from "vitest";
import { withReadyDeploymentAuthority } from "../../../executor/src/index";
import { getDeploymentMetadata } from "../../src/application/deployments";
import { CoreApplicationLegacyDeploymentError, makeCoreApplicationLegacyAdmission } from "../../src/application/coreApplicationLegacyAdmission";
import { makeCorePostgresDriver } from "../../src/database/corePersistence/driver";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import { installCorePersistence, loadCorePersistenceTarget } from "../../src/database/corePersistence/target";
import { createPostgresClientPersistence } from "../../src/database/postgresClient";
import { flarexSchema } from "../../src/database/schema";
import { registerCoreApplicationLegacyAdmissionScenarios } from "./coreApplicationLegacyAdmissionScenarios";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));
const Role = Schema.Tuple([Schema.Struct({ role: Schema.String, privileged: Schema.Boolean })]);

describe.runIf(endpoints !== undefined)("ordinary-role legacy deployment exclusion", () => {
  if (endpoints !== undefined) registerCoreApplicationLegacyAdmissionScenarios("PostgreSQL", async () => {
    const suffix = randomUUID().replaceAll("-", ""), namespace = `legacy_admission_${suffix}`, coreNamespace = `core_admission_${suffix}`;
    const maintenance = new Pool({ connectionString: endpoints.provisioningConnectionString, max: 1 });
    const pool = new Pool({ connectionString: endpoints.connectionString, max: 4, statement_timeout: 30_000,
      options: `-c search_path=${namespace}` });
    let checkout: Client | undefined;
    try {
      const [role] = Schema.decodeUnknownSync(Role)((await pool.query(`SELECT current_user::text AS role,
        rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole AS privileged FROM pg_roles WHERE rolname=current_user`)).rows);
      if (role.privileged) throw new Error("Legacy admission proof requires an ordinary role");
      await maintenance.query(`CREATE SCHEMA "${namespace}"`);
      const target = await Effect.runPromise(installCorePersistence(makeCorePostgresDriver(maintenance), coreNamespace));
      const quotedRole = `"${role.role.replaceAll('"', '""')}"`;
      await maintenance.query(`GRANT USAGE, CREATE ON SCHEMA "${namespace}" TO ${quotedRole}`);
      await maintenance.query(`GRANT USAGE ON SCHEMA "${coreNamespace}" TO ${quotedRole}`);
      await maintenance.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${coreNamespace}" TO ${quotedRole}`);
      const driver = makeCorePostgresDriver(pool);
      await Effect.runPromise(createCorePersistence(await Effect.runPromise(loadCorePersistenceTarget(driver, target.namespace)), "application"));
      checkout = new Client({ connectionString: endpoints.connectionString, options: `-c search_path=${namespace}` });
      await checkout.connect();
      const metadata = drizzle(pool, { schema: flarexSchema });
      const reader = { query: driver.query, getDeploymentMetadata: (id: string) => Effect.tryPromise({
        try: () => getDeploymentMetadata(metadata, id),
        catch: cause => new CoreApplicationLegacyDeploymentError({ reason: "metadataReadFailed", cause }),
      }) };
      const persistence = withReadyDeploymentAuthority(createPostgresClientPersistence(checkout), {
        ensure: async () => { throw new Error("Legacy provisioning is excluded by this fixture"); },
      });
      const close = async () => {
        const failures: unknown[] = [];
        try { await checkout?.end(); } catch (cause) { failures.push(cause); }
        checkout = undefined;
        try { await pool.end(); } catch (cause) { failures.push(cause); }
        for (const owned of [namespace, coreNamespace]) try { await maintenance.query(`DROP SCHEMA IF EXISTS "${owned}" CASCADE`); }
        catch (cause) { failures.push(cause); }
        try { await maintenance.end(); } catch (cause) { failures.push(cause); }
        if (failures.length > 0) throw new AggregateError(failures, "Legacy admission fixture cleanup failed");
      };
      return { metadata, persistence, query: driver.query, reader, namespace, coreNamespace,
        admit: makeCoreApplicationLegacyAdmission(pool, namespace), close };
    } catch (cause) {
      const cleanup = await Promise.allSettled([checkout?.end(), pool.end(),
        ...[namespace, coreNamespace].map(owned => maintenance.query(`DROP SCHEMA IF EXISTS "${owned}" CASCADE`))]);
      await maintenance.end();
      const failed = cleanup.filter(result => result.status === "rejected").map(result => result.reason);
      throw failed.length === 0 ? cause : new AggregateError([cause, ...failed], "Legacy admission fixture setup failed");
    }
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { makeFrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import { createActivationServingFileScopedPostgresFixture, createFileScopedPostgresFixture,
  postgresUrl } from "../../support/postgresHelpers";
import { installPayloadPreferenceFixture } from "../../frameworks/payloadPreferences/payloadPreferenceFixture";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("retained preference runtime profiles", () => {
  it("preserves actual serving, activation and control-read privileges during installation", async () => {
    const owner = await createFileScopedPostgresFixture();
    let runtimes: Awaited<ReturnType<typeof createActivationServingFileScopedPostgresFixture>> | undefined;
    try {
      runtimes = await createActivationServingFileScopedPostgresFixture(owner);
      await owner.persistence.query("insert into deployments (deployment_id, project_id) values ($1, $2)",
        ["preference-runtime-profiles", "preference-runtime-profiles"]);
      const target = await Effect.runPromise(makeFrameworkSchemaTarget({ database: runtimes.serving.persistence.drizzle,
        deploymentId: "preference-runtime-profiles", canonicalPhysicalDatabaseIdentity: "preference-runtime-profiles/database",
        physicalLocator: { kind: "shared_database", databaseKey: "primary", schemaName: owner.schemaName } }));
      const installed = await installPayloadPreferenceFixture(runtimes.serving.persistence, target, "preference-runtime-profiles");
      const relation = `"${owner.schemaName}"."${getTableName(installed.table)}"`;
      for (const [member, writable] of [[runtimes.serving, true], [runtimes.activation, true], [runtimes.controlRead, false]] as const) {
        const actual = await member.persistence.query(`select
          current_user = session_user as "sameLogin",
          (select rolsuper from pg_roles where rolname = current_user) as superuser,
          pg_catalog.has_table_privilege(session_user, $1, 'SELECT') as readable,
          pg_catalog.has_table_privilege(session_user, $1, 'INSERT') as insertable,
          pg_catalog.has_table_privilege(session_user, $1, 'UPDATE') as updatable,
          pg_catalog.has_table_privilege(session_user, $1, 'DELETE') as deletable,
          pg_catalog.has_table_privilege(session_user, $1, 'TRUNCATE,TRIGGER,REFERENCES') as dangerous`, [relation]);
        expect(actual.rows).toEqual([{ sameLogin: true, superuser: false, readable: writable,
          insertable: writable, updatable: writable, deletable: writable, dangerous: false }]);
      }
      // Maintenance invalidates old proofs. Genuine reload issues new installed
      // serving/activation authority; no stale capability is patched in place.
      const reloaded = await runtimes.reload();
      expect(reloaded.serving.installation).not.toBe(runtimes.serving.installation);
      expect(reloaded.activation.installation).not.toBe(runtimes.activation.installation);
    } finally { try { await runtimes?.dispose(); } finally { await owner.dispose(); } }
  }, 180_000);
});

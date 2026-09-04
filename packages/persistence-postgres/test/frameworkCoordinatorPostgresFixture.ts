import { randomUUID } from "node:crypto";
import { Result } from "effect";

import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { makeFrameworkSchemaArtifactRepository, prepareFrameworkSchemaArtifactAdmission } from "../src/frameworkSchema/artifact/repository";
import { makePostgresFrameworkMigrationTargetEffect, type PostgresFrameworkMigrationOptions } from "../src/migrationCoordination/postgresTarget";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { runEffect } from "./effectTestRuntime";
import { syntheticSchemaInput } from "./frameworkMigrationValueFixtures";
import { useFileScopedPostgresPersistence, withTemporaryPostgresPersistence } from "./postgresHelpers";

// Reuse the migrated catalog while clearing all rows between cases. Rebuilding
// hundreds of unrelated tables per case distorts DDL and catalog timing. Child
// restart workers reconnect to their parent's schema and need no new catalog.
const withPersistence = process.env.FLAREX_FRAMEWORK_RESTART_MODE === undefined
  ? useFileScopedPostgresPersistence() : withTemporaryPostgresPersistence;

export async function createNativeCoordinatorFixture(
  persistence: PostgresFlarexPersistence,
  physicalSchema: string,
  options: PostgresFrameworkMigrationOptions = {},
  extraTables = 0,
) {
  const schema = syntheticSchemaInput();
  const template = schema.tables[1];
  if (template === undefined) throw new Error("Missing parent table fixture");
  const captured = await runEffect(captureRelationalSchemaArtifact({
    deploymentId: "deployment-a",
    provenance: { kind: "synthetic", fixtureId: `native-relational-system-${extraTables}` },
    schema: { ...schema, tables: [...schema.tables, ...Array.from({ length: extraTables }, (_, index) => ({
      ...template, tableId: `extra_${index}`, indexes: [], constraints: [],
    }))] },
  }));
  const repositoryResult = makeFrameworkSchemaArtifactRepository({
    controlDb: persistence.drizzle,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb: persistence.drizzle,
      driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(persistence.pool),
    }),
    readTimeoutMilliseconds: 10_000, attemptTimeoutMilliseconds: 10_000,
    recoveryTimeoutMilliseconds: 10_000, lockTimeoutMilliseconds: 2_000,
  });
  if (Result.isFailure(repositoryResult)) throw repositoryResult.failure;
  const prepared = prepareFrameworkSchemaArtifactAdmission(captured.artifact);
  if (Result.isFailure(prepared)) throw prepared.failure;
  await runEffect(admitFrameworkSchemaArtifactEffect(repositoryResult.success, prepared.success));
  const target = await runEffect(makePostgresFrameworkMigrationTargetEffect({
    persistence, deploymentId: "deployment-a",
    canonicalPhysicalDatabaseIdentity: "native-framework-test/database",
    physicalLocator: { kind: "shared_database", databaseKey: "primary", schemaName: physicalSchema },
    options,
  }));
  return { persistence, target, physicalSchema, captured,
    input: {
      target, artifactRepository: repositoryResult.success, artifactIdentity: captured.artifact.identity,
      attemptId: "attempt-a", leaseOwnerId: "worker-a", leaseDurationMilliseconds: 120_000,
      lockTimeoutMilliseconds: 2_000, statementTimeoutMilliseconds: 10_000,
      maximumStepsPerRun: 16,
    },
  };
}
export type NativeCoordinatorFixture = Awaited<ReturnType<typeof createNativeCoordinatorFixture>>;

export async function withNativeCoordinator(
  run: (fixture: NativeCoordinatorFixture) => Promise<void>,
  options: PostgresFrameworkMigrationOptions = {},
  extraTables = 0,
) {
  await withPersistence(async persistence => {
    const physicalSchema = `fx_native_${randomUUID().replaceAll("-", "")}`;
    await persistence.query("insert into deployments (deployment_id, project_id) values ('deployment-a', 'project-a')");
    await persistence.query(`create schema "${physicalSchema}"`);
    try {
      await persistence.query(`create table "${physicalSchema}".fx_system_scope_clock (
        scope_uuid uuid not null, constraint fx_system_scope_clock_scope_uuid_unique unique (scope_uuid))`);
      await run(await createNativeCoordinatorFixture(persistence, physicalSchema, options, extraTables));
    } finally { await persistence.query(`drop schema "${physicalSchema}" cascade`); }
  });
}

export async function countNativeRows(fixture: NativeCoordinatorFixture, table: string) {
  if (!/^fx_system_framework_[a-z_]+$/.test(table)) throw new Error("Unexpected test table");
  const rows = await fixture.persistence.query<{ count: number }>(`select count(*)::int as count from ${table}`);
  return rows.rows[0]?.count;
}

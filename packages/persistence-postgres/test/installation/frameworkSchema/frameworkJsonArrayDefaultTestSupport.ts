import { Result } from "effect";
import { expect } from "vitest";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { makeFrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import { makeFrameworkSchemaArtifactRepository, prepareFrameworkSchemaArtifactAdmission } from "../../../src/installation/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../../../src/installation/frameworkSchema/artifact/admission";
import { makeCatalogControlSessionStarter } from "../../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../src/database/postgresCatalogControlSession";
import { makeFrameworkInstaller } from "../../../src/installation/migrationCoordination/installer";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { installPostgresPhysicalProfileFixture } from "./frameworkMigrationPostgresFixture";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { runEffect } from "../../support/effectTestRuntime";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const origin = (sourceId: string) => ({ kind: "synthetic", sourceId });
const policy = { leaseDurationMilliseconds: 120_000, lockTimeoutMilliseconds: 5_000,
  statementTimeoutMilliseconds: 30_000, runTimeoutMilliseconds: 120_000, maximumStepsPerCall: 16 };

/** One neutral profile using the existing installer, artifact and scope fixtures. */
export async function installJsonArrayDefaultFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing array-default fixture namespace");
  const deploymentId = "array-default-test";
  await persistence.query("insert into deployments (deployment_id, project_id) values ($1, 'array-default-project')", [deploymentId]);
  const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId,
    provenance: { kind: "synthetic", fixtureId: "json-array-default" }, schema: {
      owner: "system", lineageId: "json-array-default", capabilities: [], tables: [{
        tableId: "messages", origin: origin("array-default.table"),
        columns: [
          { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin: origin("array-default.id") },
          { columnId: "messages", type: "jsonb", nullable: false, default: { kind: "emptyJsonArray" }, origin: origin("array-default.messages") },
        ], keys: [{ keyId: "messages.primary", kind: "primary", columns: ["id"], origin: origin("array-default.primary") }],
        indexes: [], constraints: [], relationships: [],
      }],
    } }));
  const targetInput = { database: persistence.drizzle, deploymentId,
    canonicalPhysicalDatabaseIdentity: "array-default-fixture/database",
    physicalLocator: { kind: "shared_database" as const, databaseKey: "primary", schemaName } };
  const target = await runEffect(makeFrameworkSchemaTarget(targetInput));
  const repository = "pool" in persistence
    ? Result.getOrThrow(makeFrameworkSchemaArtifactRepository({ controlDb: persistence.drizzle,
      controlSessionStarter: makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool) }),
      readTimeoutMilliseconds: 10_000, attemptTimeoutMilliseconds: 10_000,
      recoveryTimeoutMilliseconds: 10_000, lockTimeoutMilliseconds: 5_000 }))
    : makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).repository;
  await runEffect(admitFrameworkSchemaArtifactEffect(repository, Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact.artifact))));
  const request = { artifactIdentity: artifact.artifact.identity, attemptId: "array-default-install", leaseOwnerId: "array-default-owner" };
  const migrationTarget = "pool" in persistence ? undefined : await runEffect(makePGliteFrameworkMigrationTargetEffect({
    persistence, ...targetInput,
  }));
  const install = async () => {
    if ("pool" in persistence) return runEffect(installPostgresPhysicalProfileFixture({
      persistence, target, artifactRepository: repository, requests: [request], policy,
    }));
    if (migrationTarget === undefined) throw new Error("Missing PGlite migration target");
    const installer = Result.getOrThrow(makeFrameworkInstaller({ target: migrationTarget, artifactRepository: repository, policy }));
    const result = await runEffect(installer.installFresh(request));
    if (result.kind !== "ready") throw new Error("Array-default installation did not finish");
    return result.availability;
  };
  const installed = await install();
  const verify = async () => {
    if (migrationTarget === undefined) return install();
    const installer = Result.getOrThrow(makeFrameworkInstaller({ target: migrationTarget, artifactRepository: repository, policy }));
    return runEffect(installer.verify(request));
  };
  await verify();
  const table = installed.installation.plan.plan.physicalLayout.frame.tables[0];
  const id = table?.columns.find(column => column.identity.columnId === "id")?.name;
  const messages = table?.columns.find(column => column.identity.columnId === "messages")?.name;
  if (table === undefined || id === undefined || messages === undefined) throw new Error("Missing installed array-default columns");
  const relation = `${quote(schemaName)}.${quote(table.name)}`;
  const scopeUuid = "10900000-0000-0000-0000-000000000001";
  await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId: `scope_${scopeUuid}`,
    epoch: "epoch_10900000-0000-0000-0000-000000000002" });
  const insertDefault = `insert into ${relation} (scope_uuid, ${quote(id)}) values ($1, $2) returning ${quote(messages)} as messages`;
  expect((await persistence.query(insertDefault, [scopeUuid, "omitted-first"])).rows).toEqual([{ messages: [] }]);
  expect((await persistence.query(insertDefault, [scopeUuid, "omitted-second"])).rows).toEqual([{ messages: [] }]);
  expect((await persistence.query(`insert into ${relation} (scope_uuid, ${quote(id)}, ${quote(messages)})
    values ($1, 'explicit', $2::jsonb) returning ${quote(messages)} as messages`, [scopeUuid, '["preserved"]'])).rows)
    .toEqual([{ messages: ["preserved"] }]);
  await install();
  return { relation, id, messages, insertDefault, scopeUuid, schemaName, install, verify,
    alterDefault: `alter table ${relation} alter column ${quote(messages)} set default '{}'::jsonb` };
}

export async function assertJsonArrayDefaultDriftRefused(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof installJsonArrayDefaultFixture>>) {
  await persistence.query(fixture.alterDefault);
  await expect(fixture.verify()).rejects.toMatchObject({ _tag: "RelationalStructuralRunnerError", reason: "catalogMismatch" });
  expect((await persistence.query(`select ${quote(fixture.messages)} as messages from ${fixture.relation}
    where ${quote(fixture.id)}='explicit'`)).rows).toEqual([{ messages: ["preserved"] }]);
}

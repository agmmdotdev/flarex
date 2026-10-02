import { randomUUID } from "node:crypto";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect, Result } from "effect";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { captureFrameworkSchemaTargetNamespace } from "../src/migrationCoordination/targetNamespace";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { installPostgresPhysicalProfileFixture } from "./frameworkMigrationPostgresFixture";
import { makeFrameworkSchemaTarget } from "../src/frameworkSchema/target";
import { makeCatalogControlSessionStarter } from "../src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../src/postgresCatalogControlSession";
import { makeFrameworkSchemaArtifactRepository, prepareFrameworkSchemaArtifactAdmission } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import {
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "../src/migrationCoordination/targetSession";
import {
  executeRelationalStructuralStepEffect,
  observeRelationalStructuralStepEffect,
  issueRelationalStructuralRunnerTokenEffect,
} from "../src/migrationCoordination/relationalStructuralRunner";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { syntheticSchemaInput } from "./frameworkMigrationValueFixtures";
import { deployments } from "../src/schema";

const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const release of cleanup.reverse()) await release();
});

it("verifies text-set backslashes and apostrophes and rejects changed membership", async () => {
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres")
    throw new Error("Unknown driver");
  const persistence =
    driver === "postgres"
      ? await (async () => {
          const fixture = await createFileScopedPostgresFixture({}, { standardConformingStrings: "off" });
          cleanup.push(fixture.dispose);
          return fixture.persistence;
        })()
      : await createMigratedPGlitePersistence((task) => cleanup.push(task));
  const schemaName = "pool" in persistence
    ? (await persistence.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema
    : "text_set_" + randomUUID().replaceAll("-", "");
  if (schemaName === undefined) throw new Error("Missing text-set namespace");
  if (!("pool" in persistence)) {
    await persistence.query('create schema "' + schemaName + '"');
    cleanup.push(() => persistence.query('drop schema "' + schemaName + '" cascade').then(() => undefined));
    await persistence.query('create table "' + schemaName +
      '".fx_system_scope_clock (scope_uuid uuid not null, constraint fx_system_scope_clock_scope_uuid_unique unique(scope_uuid))');
  }
  const source = syntheticSchemaInput();
  const artifact = await Effect.runPromise(
    captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      provenance: { kind: "synthetic", fixtureId: "text-set-literals" },
      schema: {
        ...source,
        tables: source.tables.map((table) =>
          table.tableId === "parent"
            ? {
                ...table,
                constraints: [
                  {
                    kind: "textSet",
                    constraintId: "slug-values",
                    columnId: "slug",
                    values: ["a\\b", "quote'foo", "line\nfeed"],
                    origin: table.origin,
                  },
                ],
              }
            : table,
        ),
      },
    }),
  );
  const physicalLocator = {
    kind: "shared_database",
    databaseKey: "primary",
    schemaName,
  } as const;
  const namespace = await Effect.runPromise(
    captureFrameworkSchemaTargetNamespace({
      deploymentId: "deployment-a",
      physicalDatabaseIdentity: "text-set/database",
      schemaName,
    }),
  );
  const layout = await Effect.runPromise(
    captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator,
      targetNamespace: namespace,
    }),
  );
  const plan = await Effect.runPromise(
    captureFreshRelationalMigrationPlan({
      artifact: artifact.artifact,
      physicalLayout: layout,
    }),
  );
  const input = {
    deploymentId: "deployment-a",
    canonicalPhysicalDatabaseIdentity: "text-set/database",
    physicalLocator,
  };
  if ("pool" in persistence) {
    const target = await Effect.runPromise(makeFrameworkSchemaTarget({ ...input, database: persistence.drizzle }));
    const repository = Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
      controlDb: persistence.drizzle,
      controlSessionStarter: makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool) }),
      readTimeoutMilliseconds: 10_000, attemptTimeoutMilliseconds: 10_000,
      recoveryTimeoutMilliseconds: 10_000, lockTimeoutMilliseconds: 2_000,
    }));
    await persistence.drizzle.insert(deployments).values({ deploymentId: "deployment-a", projectId: "text-set-project" });
    await Effect.runPromise(admitFrameworkSchemaArtifactEffect(repository,
      Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact.artifact))));
    const request = { artifactIdentity: artifact.artifact.identity,
      attemptId: "text-set-native", leaseOwnerId: "text-set-native" };
    let configuredBackends = 0;
    const install = () => Effect.runPromise(installPostgresPhysicalProfileFixture({ persistence, target,
      artifactRepository: repository, requests: [request], policy: { leaseDurationMilliseconds: 120_000,
        lockTimeoutMilliseconds: 5_000, statementTimeoutMilliseconds: 10_000,
        runTimeoutMilliseconds: 120_000, maximumStepsPerCall: 16 },
      observeStartup: observed => {
        expect(observed.dedicated).toBe(true);
        expect(observed.options).toContain("-c standard_conforming_strings=off");
        configuredBackends += 1;
      },
    }));
    const installed = await install();
    expect(configuredBackends).toBeGreaterThan(0);
    expect(installed.installation.plan.plan.physicalLayout).toEqual(layout);
    expect((await install()).installation.installation.sha256).toBe(installed.installation.installation.sha256);
    const table = layout.frame.tables.find(table => table.identity.tableId === "parent");
    const check = table?.checks.find(check => check.kind === "textSet");
    if (table === undefined || check === undefined) throw new Error("Missing native text-set check");
    await changeTextSetMembership(persistence, schemaName, table.name, check.name, check.column);
    await expect(install()).rejects.toMatchObject({ reason: "catalogMismatch" });
    expect((await persistence.query<{ state: string }>(
      "select state from fx_system_installation where singleton_id = 1",
    )).rows[0]?.state).toBe("draining");
    return;
  }
  const target = await Effect.runPromise(makePGliteFrameworkMigrationTargetEffect({ ...input, persistence }));
  const token = await Effect.runPromise(
    issueRelationalStructuralRunnerTokenEffect(target, plan),
  );
  const request = {
    kind: "ordinary",
    lockTimeoutMilliseconds: 5000,
    statementTimeoutMilliseconds: 10000,
  } as const;
  await Effect.runPromise(
    runFrameworkMigrationTargetTransactionEffect(
      target,
      request,
      (transaction) =>
        Effect.gen(function* () {
          for (const step of plan.frame.steps)
            yield* executeRelationalStructuralStepEffect(
              token,
              transaction,
              step,
            );
        }),
    ),
  );
  const table = layout.frame.tables.find(
    (table) => table.identity.tableId === "parent",
  );
  const step = plan.frame.steps.find((step) => {
    const value = step.operation.table;
    return isNonArrayRecord(value) && value.name === table?.name;
  });
  if (table === undefined || step === undefined)
    throw new Error("Missing parent table");
  const check = table.checks.find((check) => check.kind === "textSet");
  if (check === undefined) throw new Error("Missing text-set check");
  expect(
    await Effect.runPromise(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        request,
        (transaction) =>
          observeRelationalStructuralStepEffect(token, transaction, step),
      ),
    ),
  ).toBe("exact");
  expect(
    await Effect.runPromise(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        request,
        (transaction) =>
          withFrameworkMigrationRawTransactionEffect(
            transaction,
            target,
            (raw) =>
              Effect.gen(function* () {
                yield* Effect.promise(() =>
                  raw.execute(sql`set local standard_conforming_strings = off`),
                );
                return yield* observeRelationalStructuralStepEffect(
                  token,
                  transaction,
                  step,
                );
              }),
          ),
      ),
    ),
  ).toBe("exact");
  await changeTextSetMembership(persistence, schemaName, table.name, check.name, check.column);
  await expect(
    Effect.runPromise(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        request,
        (transaction) =>
          observeRelationalStructuralStepEffect(token, transaction, step),
      ),
    ),
  ).rejects.toMatchObject({ reason: "catalogMismatch" });
}, 30000);

async function changeTextSetMembership(
  persistence: Readonly<{ query: (text: string) => Promise<unknown> }>,
  schemaName: string, tableName: string, checkName: string, columnName: string,
): Promise<void> {
  const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const relation = identifier(schemaName) + '.' + identifier(tableName);
  await persistence.query('alter table ' + relation + ' drop constraint ' + identifier(checkName));
  await persistence.query('alter table ' + relation + ' add constraint ' + identifier(checkName) +
    ' check (' + identifier(columnName) + ' = $value$changed$value$::text)');
}

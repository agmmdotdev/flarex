import { randomUUID } from "node:crypto";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { captureFrameworkSchemaTargetNamespace } from "../src/migrationCoordination/targetNamespace";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { makePostgresFrameworkMigrationFixtureTarget } from "./frameworkMigrationPostgresFixture";
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
          const fixture = await createFileScopedPostgresFixture();
          cleanup.push(fixture.dispose);
          return fixture.persistence;
        })()
      : await createMigratedPGlitePersistence((task) => cleanup.push(task));
  const schemaName = "text_set_" + randomUUID().replaceAll("-", "");
  await persistence.query('create schema "' + schemaName + '"');
  cleanup.push(() =>
    persistence
      .query('drop schema "' + schemaName + '" cascade')
      .then(() => undefined),
  );
  await persistence.query(
    'create table "' +
      schemaName +
      '".fx_system_scope_clock (scope_uuid uuid not null, constraint fx_system_scope_clock_scope_uuid_unique unique(scope_uuid))',
  );
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
  const target = await ("pool" in persistence
      ? makePostgresFrameworkMigrationFixtureTarget({ ...input, persistence })
      : Effect.runPromise(makePGliteFrameworkMigrationTargetEffect({ ...input, persistence })));
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
  await persistence.query(
    'alter table "' +
      schemaName +
      '"."' +
      table.name +
      '" drop constraint "' +
      check.name +
      '"',
  );
  await persistence.query(
    'alter table "' +
      schemaName +
      '"."' +
      table.name +
      '" add constraint "' +
      check.name +
      '" check ("' +
      check.column +
      '" = $value$changed$value$::text)',
  );
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

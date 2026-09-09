import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Effect, Result } from "effect";
import { prepareProductSchemaProfile } from "../src/product-schema";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/frameworkSchemaArtifactAdmissionTestSupport";
import {
  makeFrameworkSchemaArtifactRepository,
  prepareFrameworkSchemaArtifactAdmission,
} from "../../persistence-postgres/src/frameworkSchema/artifact/repository";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../../persistence-postgres/src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../../persistence-postgres/src/frameworkSchema/artifact/postgresControlSession";
import { admitFrameworkSchemaArtifactEffect } from "../../persistence-postgres/src/frameworkSchema/artifact/admission";
import { makePGliteFrameworkMigrationTargetEffect } from "../../persistence-postgres/src/migrationCoordination/pgliteTarget";
import { makePostgresFrameworkMigrationTargetEffect } from "../../persistence-postgres/src/migrationCoordination/postgresTarget";
import { frameworkMigrationTargetSnapshot } from "../../persistence-postgres/src/migrationCoordination/targetSession";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../../persistence-postgres/src/migrationCoordination/freshCoordinator";
import {
  registerCommerceProfile,
  requireCommerceProfile,
  type CommerceProfile,
} from "../../persistence-postgres/src/commerceTransaction/profile";
import { isStoredRelationalPhysicalLayoutFrame } from "../../persistence-postgres/src/relationalSchema/physical/storedValidation";

const measureOnly = process.env.FLAREX_PRODUCT_MEASURE_STEPS === "1";
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
const scopeA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const scopeB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const cleanup: Array<() => Promise<void>> = [];
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';

async function createFixture() {
  const schemaName = "product_" + randomUUID().replaceAll("-", "");
  if (driver !== "pglite" && driver !== "postgres")
    throw new Error("Unknown Product test driver");
  const persistence =
    driver === "pglite"
      ? await createMigratedPGlitePersistence((task) => cleanup.push(task))
      : await (async () => {
          const fixture = await createFileScopedPostgresFixture();
          cleanup.push(fixture.dispose);
          return fixture.persistence;
        })();
  await persistence.query(
    "insert into deployments (deployment_id, project_id) values ('product-schema-test', 'product-schema-project')",
  );
  await persistence.query("create schema " + quote(schemaName));
  cleanup.push(() =>
    persistence
      .query("drop schema if exists " + quote(schemaName) + " cascade")
      .then(() => undefined),
  );
  await persistence.query(
    "create table " +
      quote(schemaName) +
      ".fx_system_scope_clock (scope_uuid uuid not null, constraint fx_system_scope_clock_scope_uuid_unique unique (scope_uuid))",
  );
  await persistence.query(
    "insert into " +
      quote(schemaName) +
      ".fx_system_scope_clock (scope_uuid) values ($1), ($2)",
    [scopeA, scopeB],
  );
  const targetInput = {
    persistence,
    deploymentId: "product-schema-test",
    canonicalPhysicalDatabaseIdentity: "product-schema-test/database",
    physicalLocator: {
      kind: "shared_database",
      databaseKey: "primary",
      schemaName,
    },
  } as const;
  const target = await Effect.runPromise(
    "pool" in persistence
      ? makePostgresFrameworkMigrationTargetEffect({
          ...targetInput,
          persistence,
        })
      : makePGliteFrameworkMigrationTargetEffect({
          ...targetInput,
          persistence,
        }),
  );
  const snapshot = frameworkMigrationTargetSnapshot(target);
  if (snapshot === undefined) throw new Error("Missing target authority");
  const prepare = () =>
    Effect.runPromise(
      prepareProductSchemaProfile("product-schema-test", {
        physicalLocator: snapshot.physicalLocator,
        targetNamespace: snapshot.namespace,
      }),
    );
  const prepared = await prepare();
  const repository =
    "pool" in persistence
      ? Result.getOrThrow(
          makeFrameworkSchemaArtifactRepository({
            controlDb: persistence.drizzle,
            controlSessionStarter:
              makeFrameworkSchemaArtifactControlSessionStarter({
                controlDb: persistence.drizzle,
                driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(
                  persistence.pool,
                ),
              }),
            readTimeoutMilliseconds: 10000,
            attemptTimeoutMilliseconds: 10000,
            recoveryTimeoutMilliseconds: 10000,
            lockTimeoutMilliseconds: 2000,
          }),
        )
      : makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence)
          .repository;
  await Effect.runPromise(
    admitFrameworkSchemaArtifactEffect(
      repository,
      Result.getOrThrow(
        prepareFrameworkSchemaArtifactAdmission(prepared.artifact),
      ),
    ),
  );
  const migration = {
    target,
    artifactRepository: repository,
    artifactIdentity: prepared.artifact.identity,
    commerceProfile: prepared.profile,
    attemptId: "product-install",
    leaseOwnerId: "product-test",
    leaseDurationMilliseconds: 120000,
    lockTimeoutMilliseconds: 5000,
    statementTimeoutMilliseconds: 30000,
    maximumStepsPerRun: 16,
  };
  const table = (name: string) => {
    const found = prepared.layout.frame.tables.find(
      (value) => value.identity.tableId === name,
    );
    if (found === undefined) throw new Error("Unknown test table " + name);
    return found;
  };
  const tableName = (name: string) =>
    quote(schemaName) + "." + quote(table(name).name);
  const column = (name: string, field: string) => {
    const found = table(name).columns.find(
      (value) => value.identity.columnId === field,
    );
    if (found === undefined) throw new Error("Unknown test column " + field);
    return quote(found.name);
  };
  const insert = (
    name: string,
    values: Readonly<Record<string, string | number | boolean | null>>,
    scope = scopeA,
  ) => {
    const entries = Object.entries(values);
    return persistence.query(
      `insert into ${tableName(name)} (scope_uuid, ${entries.map(([field]) => column(name, field)).join(", ")}) values ($1, ${entries.map((_, i) => "$" + (i + 2)).join(", ")})`,
      [scope, ...entries.map(([, value]) => value)],
    );
  };
  return {
    persistence,
    schemaName,
    prepared,
    prepare,
    migration,
    table,
    tableName,
    column,
    insert,
  };
}

describe("Product fresh schema on " + driver, () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fixture = await createFixture();
  });
  afterAll(async () => {
    for (const release of cleanup.reverse()) await release();
  });

  beforeAll(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const runMigration = (
      input: Parameters<typeof runFreshFrameworkMigrationCoordinatorEffect>[0],
    ) =>
      Effect.runPromise(runFreshFrameworkMigrationCoordinatorEffect(input), {
        signal: controller.signal,
      });
    try {
      const started = performance.now();
      const partial = await runMigration({
        ...fixture.migration,
        maximumStepsPerRun: 1,
      });
      expect(partial.kind).not.toBe("ready");
      if (measureOnly) {
        const resumed = performance.now();
        const second = await runMigration({
          ...fixture.migration,
          maximumStepsPerRun: 1,
        });
        process.stdout.write(
          JSON.stringify({
            firstMs: Math.round(resumed - started),
            secondMs: Math.round(performance.now() - resumed),
            progress:
              second.kind === "pending"
                ? [second.completedStepCount, second.requiredStepCount]
                : second.kind,
          }) + "\n",
        );
        return;
      }
      let ready = partial;
      for (let run = 0; run < 16 && ready.kind !== "ready"; run++) {
        const batchStarted = performance.now();
        ready = await runMigration(fixture.migration);
        if (process.env.FLAREX_PRODUCT_TIMINGS === "1")
          process.stdout.write(
            JSON.stringify({
              batchMs: Math.round(performance.now() - batchStarted),
              progress:
                ready.kind === "pending"
                  ? [ready.completedStepCount, ready.requiredStepCount]
                  : ready.kind,
            }) + "\n",
          );
      }
      expect(ready.kind).toBe("ready");
      const fresh = await fixture.prepare();
      expect(
        (
          await runMigration({
            ...fixture.migration,
            commerceProfile: fresh.profile,
          })
        ).kind,
      ).toBe("ready");
    } finally {
      clearTimeout(timeout);
    }
  }, 120000); // Allow the 90-second migration owner to cancel and finish cleanup.

  it.skipIf(!measureOnly)("measures two installation steps", () => {});

  it.skipIf(measureOnly)(
    "restores the complete thirteen-table installed catalog",
    async () => {
      expect(
        isStoredRelationalPhysicalLayoutFrame(fixture.prepared.layout.frame),
      ).toBe(true);
      const result = await fixture.persistence.query<{ count: number }>(
        "select count(*)::integer as count from information_schema.tables where table_schema = $1 and table_name like 'fxrt_%'",
        [fixture.schemaName],
      );
      expect(result.rows[0]?.count).toBe(13);
    },
  );

  it.skipIf(measureOnly)(
    "does not grant a Product runtime host or initialization authority",
    async () => {
      expect(
        Result.isFailure(
          await Effect.runPromise(
            Effect.result(
              registerCommerceProfile(
                fixture.prepared.artifact,
                fixture.prepared.layout,
                "medusa.product",
                {
                  stepId: "empty",
                  datasetSha256: "0".repeat(64),
                  expectedRowCount: 0,
                },
              ),
            ),
          ),
        ),
      ).toBe(true);
      // SAFETY: deliberately bypass the brand to prove schema tokens cannot authenticate a host.
      expect(
        Result.isFailure(
          await Effect.runPromise(
            Effect.result(
              requireCommerceProfile(
                fixture.prepared.profile as unknown as CommerceProfile,
              ),
            ),
          ),
        ),
      ).toBe(true);
    },
  );

  it.skipIf(measureOnly)(
    "enforces booleans, enum membership, active uniqueness and scoped FK targets",
    async () => {
      const { insert, persistence, tableName, column } = fixture;
      await insert("product_type", { id: "type-a", value: "type" });
      await insert("product", {
        id: "prod-a",
        title: "One",
        handle: "one",
        type_id: "type-a",
      });
      await expect(
        insert("product", {
          id: "prod-duplicate",
          title: "Two",
          handle: "one",
        }),
      ).rejects.toThrow();
      await expect(
        insert("product", {
          id: "prod-enum",
          title: "Two",
          handle: "enum",
          status: "invalid",
        }),
      ).rejects.toThrow();
      await expect(
        insert(
          "product",
          {
            id: "prod-cross",
            title: "Two",
            handle: "cross",
            type_id: "type-a",
          },
          scopeB,
        ),
      ).rejects.toThrow();
      const rows = await persistence.query<{
        status: string;
        discountable: boolean;
        gift: boolean;
      }>(
        `select ${column("product", "status")} as status, ${column("product", "discountable")} as discountable, ${column("product", "is_giftcard")} as gift from ${tableName("product")} where scope_uuid = $1`,
        [scopeA],
      );
      expect(rows.rows).toEqual([
        { status: "draft", discountable: true, gift: false },
      ]);
      await persistence.query(
        `update ${tableName("product")} set ${column("product", "deleted_at")} = now() where scope_uuid = $1`,
        [scopeA],
      );
      await insert("product", { id: "prod-new", title: "New", handle: "one" });
      await expect(
        persistence.query(
          `update ${tableName("product")} set ${column("product", "deleted_at")} = null where ${column("product", "id")} = $1`,
          ["prod-a"],
        ),
      ).rejects.toThrow();
      await insert(
        "product",
        { id: "prod-new", title: "Other scope", handle: "one" },
        scopeB,
      );
    },
  );

  it.skipIf(measureOnly)(
    "keeps nullable unique values and implicit/explicit pivot lifecycles distinct",
    async () => {
      const { insert, persistence, tableName, column } = fixture;
      await insert("product", {
        id: "pivot-product",
        title: "Pivot fixture",
        handle: "pivot-fixture",
      });
      await insert("product_variant", {
        id: "variant-a",
        title: "A",
        product_id: "pivot-product",
      });
      await insert("product_variant", {
        id: "variant-b",
        title: "B",
        product_id: "pivot-product",
      });
      await insert("image", {
        id: "image-a",
        url: "image",
        product_id: "pivot-product",
      });
      await insert("product_variant_product_image", {
        id: "pivot-a",
        variant_id: "variant-a",
        image_id: "image-a",
      });
      await insert("product_variant_product_image", {
        id: "pivot-b",
        variant_id: "variant-a",
        image_id: "image-a",
      });
      await insert("product_option", {
        id: "option-a",
        title: "Size",
        product_id: "pivot-product",
      });
      await insert("product_option_value", {
        id: "value-a",
        value: "Small",
        option_id: "option-a",
      });
      await insert("product_variant_option", {
        variant_id: "variant-a",
        option_value_id: "value-a",
      });
      await expect(
        insert("product_variant_option", {
          variant_id: "variant-a",
          option_value_id: "value-a",
        }),
      ).rejects.toThrow();
      // Explicit pivot FKs use NO ACTION; detach those entities before hard delete.
      await expect(
        persistence.query(
          `delete from ${tableName("product_variant")} where ${column("product_variant", "id")} = $1`,
          ["variant-a"],
        ),
      ).rejects.toThrow();
      await persistence.query(
        `delete from ${tableName("product_variant_product_image")}`,
      );
      await persistence.query(
        `delete from ${tableName("product_variant")} where ${column("product_variant", "id")} = $1`,
        ["variant-a"],
      );
      expect(
        (
          await persistence.query(
            `select * from ${tableName("product_variant_option")}`,
          )
        ).rows,
      ).toHaveLength(0);
      await insert("product_category", {
        id: "cat-root",
        name: "Root",
        handle: "root",
        mpath: "cat-root",
      });
      await insert("product_category", {
        id: "cat-child",
        name: "Child",
        handle: "child",
        mpath: "cat-root.cat-child",
        parent_category_id: "cat-root",
      });
      await persistence.query(
        `delete from ${tableName("product_category")} where ${column("product_category", "id")} = $1`,
        ["cat-root"],
      );
      expect(
        (
          await persistence.query(
            `select * from ${tableName("product_category")}`,
          )
        ).rows,
      ).toHaveLength(0);
    },
  );

  it.skipIf(measureOnly || driver !== "postgres")(
    "arbitrates concurrent active-handle inserts in PostgreSQL",
    async () => {
      const results = await Promise.allSettled([
        fixture.insert("product", {
          id: "race-a",
          title: "A",
          handle: "concurrent-handle",
        }),
        fixture.insert("product", {
          id: "race-b",
          title: "B",
          handle: "concurrent-handle",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { code: "23505" },
      });
    },
  );
});

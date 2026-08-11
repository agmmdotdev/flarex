import { isNonArrayRecord } from "@flarex/utils/records";
import { Result } from "effect";
import {
  replacementScopeIdV1FromUuid,
} from "flarex-protocol/storage-authority";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import {
  createPostgresPersistence,
} from "../src/postgres";
import {
  createPostgresTaskComputeDeliveryControlDirectoryResource,
} from "../src/postgresTaskComputeDeliveryControlDirectory";
import {
  makeTaskComputeDeliveryControlDirectory,
} from "../src/taskComputeDeliveryControlDirectory";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 250,
  lockTimeoutMilliseconds: 150,
  statementTimeoutMilliseconds: 500,
  transactionTimeoutMilliseconds: 1_000,
  settlementReserveMilliseconds: 1_500,
});
const SCOPE_ID = replacementScopeIdV1FromUuid(
  "94000000-0000-4000-8000-000000000001",
);
const DEPLOYMENT_ID = "deployment_dte06_c3_control_directory_pg";
const LOCATOR = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "dte06-c3-control-directory-pg",
  schemaName: "public",
});

class ControlDirectorySqlError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("control directory sql failed");
    this.cause = cause;
  }
}

describe("DTE06-C3 PostgreSQL control-directory acceptance environment", () => {
  it("requires an authenticated ordinary-role PostgreSQL 18 URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the DTE06-C3 control directory.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL DTE06-C3 deadline-owned control directory", () => {
  it("settles a server-side lock timeout before returning and safely reuses its pool", async () => {
    await withTemporaryPostgresSchema(async (databaseOptions) => {
      const persistence = await createPostgresPersistence({
        migrationsSchema: databaseOptions.migrationsSchema,
        poolConfig: {
          ...databaseOptions.poolConfig,
          connectionString: databaseOptions.connectionString,
        },
      });
      const resource = Result.getOrThrow(
        createPostgresTaskComputeDeliveryControlDirectoryResource({
          ...databaseOptions.poolConfig,
          connectionString: databaseOptions.connectionString,
          max: 1,
        }, DEADLINE_POLICY),
      );
      try {
        await persistence.migrate();
        const role = await persistence.query<{
          role_name: string;
          is_superuser: boolean;
          can_create_database: boolean;
          can_create_role: boolean;
        }>(`
          select current_user as role_name,
                 rolsuper as is_superuser,
                 rolcreatedb as can_create_database,
                 rolcreaterole as can_create_role
          from pg_roles
          where rolname = current_user
        `);
        expect(role.rows[0]).toMatchObject({
          is_superuser: false,
          can_create_database: false,
          can_create_role: false,
        });
        const version = await persistence.query<{ server_version: string }>(
          "show server_version",
        );
        expect(version.rows[0]?.server_version).toMatch(/^18\./);
        await persistence.insertDeploymentMetadata({
          deploymentId: DEPLOYMENT_ID,
          projectId: `project_${DEPLOYMENT_ID}`,
        });
        await persistence.insertScopeMetadata({
          scopeId: SCOPE_ID,
          deploymentId: DEPLOYMENT_ID,
          physicalLocator: LOCATOR,
        });
        const directory = Result.getOrThrow(
          makeTaskComputeDeliveryControlDirectory(resource.target, {
            operationName: "DTE06C3.controlDirectoryPostgres",
            input: (reason) => new Error(`input:${reason}`),
            corruption: (reason) => new Error(`corruption:${reason}`),
            sql: (cause) => new ControlDirectorySqlError(cause),
            decodeDeploymentId: (value) =>
              typeof value === "string" && value.length > 0
                ? Result.succeed(value)
                : Result.fail(new Error("deployment_invalid")),
          }),
        );
        const blocker = new Client({
          connectionString: databaseOptions.connectionString,
          options: databaseOptions.poolConfig.options,
        });
        await blocker.connect();
        try {
          await blocker.query("begin");
          await blocker.query("lock table fx_control_scope in access exclusive mode");
          const startedAt = performance.now();
          const failure = await runEffectFailure(
            directory.discoverEffect({ limit: 1 }),
          );
          expect(performance.now() - startedAt).toBeLessThan(1_500);
          expect(failure).toBeInstanceOf(ControlDirectorySqlError);
          expect(postgresCode(failure)).toBe("55P03");
          expect(resource.pool.waitingCount).toBe(0);
          expect(resource.pool.totalCount).toBe(1);
          expect(resource.pool.idleCount).toBe(1);
        } finally {
          await blocker.query("rollback").catch(() => undefined);
          await blocker.end();
        }

        await expect(
          runEffect(directory.discoverEffect({ limit: 1 })),
        ).resolves.toMatchObject({
          candidates: [expect.objectContaining({
            deploymentId: DEPLOYMENT_ID,
            scopeId: SCOPE_ID,
          })],
          continuation: null,
        });
      } finally {
        await resource.close();
        await persistence.close();
      }
    });
  }, 60_000);
});

function postgresCode(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (!isNonArrayRecord(current)) return undefined;
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

import {
  decodeDeploymentProjectScopeLookupResponseV1,
  deploymentProjectScopeLookupBudgetHeaderV1,
  deploymentProjectScopeLookupMediaTypeV1,
  encodeDeploymentProjectScopeLookupBudgetHeaderV1,
  encodeDeploymentProjectScopeLookupRequestV1,
  type DeploymentProjectScopeLookupBudgetV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { trimToNonBlankOrNull } from "@flarex/utils/strings";
import { Result } from "effect";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { makeDeploymentProjectScopeLookupHostV1 } from "../src/deploymentProjectScopeLookup";

const postgresUrl = trimToNonBlankOrNull(process.env.FLAREX_POSTGRES_DATABASE_URL);
const budget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 4_096,
  maximumBodyBytes: 4_096,
  maximumCanonicalBytes: 4_096,
  maximumFrameBytes: 4_096,
  maximumElapsedMilliseconds: 5_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;

describe("deployment project-scope lookup on isolated PostgreSQL", { timeout: 120_000 }, () => {
  it("performs concurrent exact reads without mutating the relationship row", async () => {
    await withTemporaryPostgres(async (persistence, admin, schemaName) => {
      const target = await persistence.insertDeploymentMetadata({
        deploymentId: "deployment-postgres-scope",
        projectId: "project-postgres-scope",
      });
      const before = await targetEvidence(admin, schemaName, target.deploymentId);
      const host = makeDeploymentProjectScopeLookupHostV1(persistence);

      const lookups = Array.from({ length: 24 }, (_, index) => host(request(
        target.deploymentId,
        index % 3 === 0 ? "wrong-project" : target.projectId,
      )));
      const concurrentWrites = Array.from({ length: 12 }, (_, index) =>
        persistence.insertDeploymentMetadata({
          deploymentId: `deployment-postgres-decoy-${index}`,
          projectId: "project-postgres-decoy",
        })
      );
      const [responses] = await Promise.all([
        Promise.all(lookups),
        Promise.all(concurrentWrites),
      ]);
      expect(responses.filter((response) => response.status === 200)).toHaveLength(16);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(8);
      const matched = responses.find((response) => response.status === 200);
      if (matched === undefined) throw new Error("Expected one matched response.");
      expect(unwrap(decodeDeploymentProjectScopeLookupResponseV1(
        new Uint8Array(await matched.arrayBuffer()),
        budget,
      )).value).toEqual({
        codecVersion: 1,
        kind: "matched",
        deploymentId: target.deploymentId,
        projectId: target.projectId,
        deploymentCreatedAt: target.createdAt.toISOString(),
      });
      expect(await targetEvidence(admin, schemaName, target.deploymentId)).toEqual(before);
      expect(await persistence.getDeploymentMetadata("deployment-postgres-missing")).toBeNull();
    });
  });
});

async function withTemporaryPostgres(
  run: (
    persistence: PostgresFlarexPersistence,
    admin: Pool,
    schemaName: string,
  ) => Promise<void>,
): Promise<void> {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required; this proof never skips.");
  }
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const schemaName = `flarex_scope_lookup_${suffix}`;
  const migrationsSchema = `flarex_scope_lookup_migrations_${suffix}`;
  const admin = new Pool({ connectionString: postgresUrl });
  let persistence: PostgresFlarexPersistence | undefined;
  let primaryError: unknown;
  try {
    await admin.query(`create schema ${quoteIdentifier(schemaName)}`);
    await admin.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
    persistence = await createPostgresPersistence({
      connectionString: postgresUrl,
      migrationsSchema,
      poolConfig: { options: `-c search_path=${schemaName}` },
    });
    await persistence.migrate();
    await run(persistence, admin, schemaName);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (persistence !== undefined) {
      try {
        await persistence.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const name of [schemaName, migrationsSchema]) {
      try {
        await admin.query(`drop schema if exists ${quoteIdentifier(name)} cascade`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await admin.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "PostgreSQL scope-lookup cleanup failed.");
    }
  }
}

async function targetEvidence(
  pool: Pool,
  schemaName: string,
  deploymentId: string,
): Promise<unknown> {
  const result = await pool.query(
    `select xmin::text as xmin, deployment_id, project_id, active_package_id,
            active_schema_version, created_at
       from ${quoteIdentifier(schemaName)}.deployments
      where deployment_id = $1`,
    [deploymentId],
  );
  return result.rows;
}

function request(deploymentId: string, projectId: string): Request {
  const encoded = unwrap(encodeDeploymentProjectScopeLookupRequestV1({
    codecVersion: 1,
    deploymentId,
    projectId,
  }, budget));
  return new Request("https://executor.test/internal/v1/deployment-project-scope/lookup", {
    method: "POST",
    headers: {
      "content-type": deploymentProjectScopeLookupMediaTypeV1,
      [deploymentProjectScopeLookupBudgetHeaderV1]: unwrap(
        encodeDeploymentProjectScopeLookupBudgetHeaderV1(budget),
      ),
    },
    body: copyBytesToArrayBuffer(encoded.bytes),
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

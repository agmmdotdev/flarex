import { PgDialect } from "drizzle-orm/pg-core";
import { asNonArrayRecord } from "@flarex/utils/records";
import {
  replacementScopeIdV1FromUuid,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  buildPointMutationRedeliveryScopeDiscoveryStatementV1,
  createPointMutationRedeliveryScopeDiscoveryV1,
} from "@flarex/persistence-postgres/point-mutation-redelivery-scope-discovery";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const LIMIT = 100;
const CANONICAL_SCOPE_COUNT = 2_000;
const LEGACY_SCOPE_COUNT = 3_000;
const describePostgres = postgresUrl === null ? describe.skip : describe;

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "redelivery-scope-directory-postgres-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describePostgres("real Postgres O08-B2b2b2b1b2b1 scope discovery", () => {
  it("gives duplicate scanners inert pages and defers scopes above the captured high water", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedScopeDirectory(persistence);
      const repository = createPointMutationRedeliveryScopeDiscoveryV1(
        persistence.drizzle,
      );

      const [left, right] = await Promise.all([
        runEffect(repository.discoverEffect({ limit: LIMIT })),
        runEffect(repository.discoverEffect({ limit: LIMIT })),
      ]);
      expect(right).toEqual(left);
      expect(left.candidates.length).toBeGreaterThan(0);
      expect(left.candidates.length).toBeLessThanOrEqual(LIMIT);
      expect(left.continuation).not.toBeNull();

      const deferred = replacementScopeIdV1FromUuid(
        "89000000-0000-0000-0000-000000000001",
      );
      await insertScope(persistence, deferred);
      const next = await runEffect(repository.discoverEffect({
        limit: LIMIT,
        continuation: left.continuation,
      }));
      expect(next.candidates.some((candidate) =>
        candidate.scopeId === deferred
      )).toBe(false);
      expect(left.continuation?.highWaterScopeId).toBe(
        legacyScopeIdAt(LEGACY_SCOPE_COUNT),
      );
    });
  }, 60_000);

  it("uses bounded primary-key scans without a full-relation sort", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedScopeDirectory(persistence);
      await persistence.query("analyze fx_control_scope");
      const statement = buildPointMutationRedeliveryScopeDiscoveryStatementV1({
        limitPlusOne: LIMIT + 1,
      });
      const compiled = new PgDialect().sqlToQuery(statement);

      await withPostgresSequentialScansDisabled(persistence, async (client) => {
        const explained = await client.query<{
          readonly "QUERY PLAN": unknown;
        }>(
          `explain (analyze, buffers, format json) ${compiled.sql}`,
          compiled.params,
        );
        const nodes = collectPlanNodes(explained.rows[0]?.["QUERY PLAN"]);
        const scopeIndexNodes = nodes.filter((node) =>
          node["Index Name"] === "fx_control_scope_pkey"
        );
        const indexDiagnostics = scopeIndexNodes.map((node) => ({
          nodeType: node["Node Type"],
          actualRows: node["Actual Rows"],
          scanDirection: node["Scan Direction"],
        }));
        const planDiagnostics = nodes.map((node) => ({
          nodeType: node["Node Type"],
          indexName: node["Index Name"],
          relationName: node["Relation Name"],
          actualRows: node["Actual Rows"],
        }));
        expect(
          scopeIndexNodes.length,
          JSON.stringify(planDiagnostics),
        ).toBeGreaterThanOrEqual(2);
        expect(
          scopeIndexNodes.every((node) =>
            typeof node["Node Type"] === "string" &&
            /^Index( Only)? Scan$/.test(node["Node Type"])
          ),
          JSON.stringify(indexDiagnostics),
        ).toBe(true);
        expect(scopeIndexNodes.some((node) =>
          boundedPlanCount(node["Actual Rows"], 1)
        )).toBe(true);
        expect(scopeIndexNodes.some((node) =>
          boundedPlanCount(node["Actual Rows"], LIMIT + 1)
        )).toBe(true);
        expect(nodes.some((node) =>
          node["Node Type"] === "Seq Scan" &&
          node["Relation Name"] === "fx_control_scope"
        )).toBe(false);
        const sorts = nodes.filter((node) => node["Node Type"] === "Sort");
        expect(sorts.every((node) =>
          boundedPlanCount(node["Actual Rows"], LIMIT + 1)
        )).toBe(true);
      });
    });
  }, 60_000);
});

async function seedScopeDirectory(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `
      insert into deployments (deployment_id, project_id)
      select
        'deployment_redelivery_' ||
          '88000000-0000-0000-0000-' || lpad(value::text, 12, '0'),
        'project_redelivery_' || value::text
      from generate_series(1, $1::int) as value
    `,
    [CANONICAL_SCOPE_COUNT],
  );
  await persistence.query(
    `
      insert into fx_control_scope (
        id,
        deployment_id,
        isolation_kind,
        physical_locator_json
      )
      select
        'scope_88000000-0000-0000-0000-' || lpad(value::text, 12, '0'),
        'deployment_redelivery_' ||
          '88000000-0000-0000-0000-' || lpad(value::text, 12, '0'),
        'shared_database',
        $2::jsonb
      from generate_series(1, $1::int) as value
    `,
    [CANONICAL_SCOPE_COUNT, JSON.stringify(sharedLocator)],
  );
  await persistence.query(
    `
      insert into deployments (deployment_id, project_id)
      select
        'deployment_legacy_redelivery_' || value::text,
        'project_legacy_redelivery_' || value::text
      from generate_series(1, $1::int) as value
    `,
    [LEGACY_SCOPE_COUNT],
  );
  await persistence.query(
    `
      insert into fx_control_scope (
        id,
        deployment_id,
        isolation_kind,
        physical_locator_json
      )
      select
        'scope_88000000-0000-0000-0000-' ||
          lpad(value::text, 12, '0') || 'x',
        'deployment_legacy_redelivery_' || value::text,
        'shared_database',
        $2::jsonb
      from generate_series(1, $1::int) as value
    `,
    [LEGACY_SCOPE_COUNT, JSON.stringify(sharedLocator)],
  );
}

function legacyScopeIdAt(sequence: number): string {
  return `scope_88000000-0000-0000-0000-${
    sequence.toString().padStart(12, "0")
  }x`;
}

async function insertScope(
  persistence: PostgresFlarexPersistence,
  scopeId: ReplacementScopeIdV1,
): Promise<void> {
  const deploymentId = `deployment_redelivery_${scopeId.slice(6)}`;
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: sharedLocator,
  });
}

function scopeIdAt(sequence: number): ReplacementScopeIdV1 {
  return replacementScopeIdV1FromUuid(
    `88000000-0000-0000-0000-${sequence.toString().padStart(12, "0")}`,
  );
}

function collectPlanNodes(value: unknown): ReadonlyArray<Record<string, unknown>> {
  const nodes: Record<string, unknown>[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    const record = asNonArrayRecord(candidate);
    if (record === null) return;
    if (typeof record["Node Type"] === "string") nodes.push(record);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return nodes;
}

function boundedPlanCount(value: unknown, maximum: number): boolean {
  return typeof value === "number" && value >= 0 && value <= maximum;
}

import { asNonArrayRecord } from "@flarex/utils/records";
import { PgDialect } from "drizzle-orm/pg-core";
import { ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  buildPointMutationAttemptDiscoveryStatementV1,
  createPointMutationAttemptDiscoveryV1,
} from "../src/pointMutationAttemptDiscovery";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  insertOpenTransactionJournalFixture,
  insertTransactionSessionFixture,
  transactionSessionFixture,
} from "./sessionAuthorityTestSupport";

const SCOPE_UUID = "87100000-0000-0000-0000-000000000001";
const OTHER_SCOPE_UUID = "87100000-0000-0000-0000-000000000002";
const EPOCH_UUID = "87100000-0000-0000-0000-000000000003";
const OTHER_EPOCH_UUID = "87100000-0000-0000-0000-000000000004";
const SCOPE_ID = `scope_${SCOPE_UUID}`;
const OTHER_SCOPE_ID = `scope_${OTHER_SCOPE_UUID}`;
const DEPLOYMENT_ID = "deployment_attempt_discovery_postgres_v1";
const EXPIRED_TEMPLATE_ID = sessionIdAt(1);
const FINISHING_TEMPLATE_ID = sessionIdAt(2);
const LIMIT = 100;
const TARGET_SCOPE_ROWS_PER_SOURCE = 300;
const OTHER_SCOPE_ROWS_PER_SOURCE = 3_000;

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "attempt-discovery-postgres-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O08-B2b2b1 attempt discovery", () => {
  it("returns duplicate inert scans, preserves one horizon, and stays scope-local", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await installAuthority(persistence);
      await seedPlanPopulation(persistence);
      const repository = discovery(persistence);
      const before = await candidateStateCounts(persistence, SCOPE_UUID);

      const [left, right] = await Promise.all([
        runEffect(repository.discoverEffect({
          deploymentId: DEPLOYMENT_ID,
          scopeId: SCOPE_ID,
          limit: LIMIT,
        })),
        runEffect(repository.discoverEffect({
          deploymentId: DEPLOYMENT_ID,
          scopeId: SCOPE_ID,
          limit: LIMIT,
        })),
      ]);

      expect(right.candidates).toEqual(left.candidates);
      expect(left.candidates).toHaveLength(LIMIT);
      expect(left.continuation).not.toBeNull();
      expect(left.candidates.every(
        (candidate) => candidate.selector.scopeId === SCOPE_ID,
      )).toBe(true);
      expect(left.candidates.every(
        (candidate) => candidate.selector.sessionId !== FINISHING_TEMPLATE_ID ||
          candidate.source === "finishingSession",
      )).toBe(true);
      await expect(candidateStateCounts(persistence, SCOPE_UUID))
        .resolves.toEqual(before);

      if (left.continuation === null) {
        throw new Error("Expected a continuation from the bounded first page.");
      }
      const deferredId = sessionIdAt(9_001);
      await insertCandidate(persistence, {
        scopeUuid: SCOPE_UUID,
        sessionId: deferredId,
        source: "finishingSession",
        eligibleAt: new Date(Date.parse(left.horizon) + 60_000).toISOString(),
      });
      const next = await runEffect(repository.discoverEffect({
        deploymentId: DEPLOYMENT_ID,
        scopeId: SCOPE_ID,
        limit: LIMIT,
        continuation: left.continuation,
      }));
      expect(next.horizon).toBe(left.horizon);
      expect(next.candidates.some(
        (candidate) => candidate.selector.sessionId === deferredId,
      )).toBe(false);
    });
  }, 60_000);

  it("uses both bounded discovery indexes without relation scans or full sorts", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await installAuthority(persistence);
      await seedPlanPopulation(persistence);
      await persistence.query("analyze fx_system_tx_session");
      await persistence.query("analyze fx_system_tx_execution_claim");

      const statement = buildPointMutationAttemptDiscoveryStatementV1({
        scopeUuid: ScopeUuidV1Schema.make(SCOPE_UUID),
        limitPlusOne: LIMIT + 1,
        continuation: undefined,
      });
      const compiled = new PgDialect().sqlToQuery(statement);
      const client = await persistence.pool.connect();
      try {
        const explained = await client.query<{
          readonly "QUERY PLAN": unknown;
        }>(
          `explain (analyze, buffers, format json) ${compiled.sql}`,
          compiled.params,
        );
        const rawPlan = explained.rows[0]?.["QUERY PLAN"];
        const nodes = collectPlanNodes(rawPlan);
        const indexNames = new Set(nodes.flatMap((node) =>
          typeof node["Index Name"] === "string"
            ? [node["Index Name"]]
            : []
        ));
        const observedIndexNames = [...indexNames].sort();
        expect(
          observedIndexNames,
          `observed indexes: ${observedIndexNames.join(", ")}`,
        ).toContain(
          "fx_system_tx_execution_claim_expiry_idx",
        );
        expect(
          observedIndexNames,
          `observed indexes: ${observedIndexNames.join(", ")}`,
        ).toContain(
          "fx_system_tx_session_finishing_discovery_idx",
        );
        for (const requiredIndexName of [
          "fx_system_tx_execution_claim_expiry_idx",
          "fx_system_tx_session_finishing_discovery_idx",
        ]) {
          const matchingNodes = nodes.filter((node) =>
            node["Index Name"] === requiredIndexName
          );
          const diagnostic = matchingNodes.map((node) => ({
            nodeType: node["Node Type"],
            actualRows: node["Actual Rows"],
            actualLoops: node["Actual Loops"],
          }));
          expect(
            matchingNodes.some((node) =>
              typeof node["Node Type"] === "string" &&
              /^Index( Only)? Scan$/.test(node["Node Type"]) &&
              isBoundedPlanCount(node["Actual Rows"], LIMIT + 1)
            ),
            `${requiredIndexName}: ${JSON.stringify(diagnostic)}`,
          ).toBe(true);
        }
        expect(nodes.some((node) =>
          typeof node["Shared Hit Blocks"] === "number" ||
          typeof node["Shared Read Blocks"] === "number"
        )).toBe(true);

        const forbiddenScans = nodes.filter((node) =>
          node["Node Type"] === "Seq Scan" &&
          (
            node["Relation Name"] === "fx_system_tx_session" ||
            node["Relation Name"] === "fx_system_tx_execution_claim"
          )
        );
        expect(forbiddenScans).toEqual([]);

        const sorts = nodes.filter((node) => node["Node Type"] === "Sort");
        expect(sorts.every((node) =>
          isBoundedPlanCount(node["Actual Rows"], 2 * (LIMIT + 1))
        )).toBe(true);
        const limits = nodes.filter((node) => node["Node Type"] === "Limit");
        expect(limits.length).toBeGreaterThanOrEqual(3);
        expect(limits.every((node) =>
          isBoundedPlanCount(node["Actual Rows"], LIMIT + 1)
        )).toBe(true);
      } finally {
        client.release();
      }
    });
  }, 60_000);
});

function discovery(persistence: PostgresFlarexPersistence) {
  return createPointMutationAttemptDiscoveryV1({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared discovery must not read split receipts.");
      },
    },
    scopeDiscoveryTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  });
}

async function installAuthority(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, 'project_attempt_discovery_postgres_v1')`,
    [DEPLOYMENT_ID],
  );
  await persistence.query(
    `insert into fx_control_scope
       (id, deployment_id, isolation_kind, physical_locator_json)
     values ($1, $2, 'shared_database', $3::jsonb)`,
    [SCOPE_ID, DEPLOYMENT_ID, JSON.stringify(sharedLocator)],
  );
  for (const [scopeId, epochUuid] of [
    [SCOPE_ID, EPOCH_UUID],
    [OTHER_SCOPE_ID, OTHER_EPOCH_UUID],
  ] as const) {
    await persistence.query(
      `insert into fx_system_scope_clock
         (scope_id, storage_generation, storage_generation_fence,
          last_commit_seq, last_outbox_seq, epoch)
       values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
      [scopeId, `epoch_${epochUuid}`],
    );
  }
}

async function seedPlanPopulation(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await insertCandidate(persistence, {
    scopeUuid: SCOPE_UUID,
    sessionId: EXPIRED_TEMPLATE_ID,
    source: "expiredClaim",
    eligibleAt: "2025-01-01T00:00:00.000Z",
  });
  await insertCandidate(persistence, {
    scopeUuid: SCOPE_UUID,
    sessionId: FINISHING_TEMPLATE_ID,
    source: "finishingSession",
    eligibleAt: "2025-01-01T00:00:00.001Z",
  });
  await cloneCandidatePopulation(persistence, {
    sourceScopeUuid: SCOPE_UUID,
    destinationScopeUuid: SCOPE_UUID,
    expiredTemplateId: EXPIRED_TEMPLATE_ID,
    finishingTemplateId: FINISHING_TEMPLATE_ID,
    ordinalBase: 100,
    count: TARGET_SCOPE_ROWS_PER_SOURCE,
  });
  await cloneCandidatePopulation(persistence, {
    sourceScopeUuid: SCOPE_UUID,
    destinationScopeUuid: OTHER_SCOPE_UUID,
    expiredTemplateId: EXPIRED_TEMPLATE_ID,
    finishingTemplateId: FINISHING_TEMPLATE_ID,
    ordinalBase: 1_000,
    count: OTHER_SCOPE_ROWS_PER_SOURCE,
  });
}

async function cloneCandidatePopulation(
  persistence: PostgresFlarexPersistence,
  input: Readonly<{
    sourceScopeUuid: string;
    destinationScopeUuid: string;
    expiredTemplateId: string;
    finishingTemplateId: string;
    ordinalBase: number;
    count: number;
  }>,
): Promise<void> {
  const cloneSessions = async (
    templateId: string,
    sequenceOffset: number,
  ): Promise<void> => {
    await persistence.query(
      `insert into fx_system_tx_session
       select (jsonb_populate_record(
         null::fx_system_tx_session,
         to_jsonb(template) || jsonb_build_object(
           'scope_uuid', $2::text,
           'session_id',
             '87100000-0000-0000-0000-' ||
             lpad(($4::int + series.ordinal)::text, 12, '0')
         )
       )).*
       from fx_system_tx_session as template
       cross join generate_series(1, $5::int) as series(ordinal)
       where template.scope_uuid = $1::uuid
         and template.session_id = $3::uuid`,
      [
        input.sourceScopeUuid,
        input.destinationScopeUuid,
        templateId,
        input.ordinalBase + sequenceOffset,
        input.count,
      ],
    );
  };
  await cloneSessions(input.expiredTemplateId, 0);
  await cloneSessions(input.finishingTemplateId, input.count);

  await persistence.query(
    `insert into fx_system_tx_journal
     select (jsonb_populate_record(
       null::fx_system_tx_journal,
       to_jsonb(template) || jsonb_build_object(
         'scope_uuid', $2::text,
         'session_id',
           '87100000-0000-0000-0000-' ||
           lpad(($4::int + series.ordinal)::text, 12, '0')
       )
     )).*
     from fx_system_tx_journal as template
     cross join generate_series(1, $5::int) as series(ordinal)
     where template.scope_uuid = $1::uuid
       and template.session_id = $3::uuid`,
    [
      input.sourceScopeUuid,
      input.destinationScopeUuid,
      input.expiredTemplateId,
      input.ordinalBase,
      input.count,
    ],
  );
  await persistence.query(
    `insert into fx_system_tx_execution_claim
     select (jsonb_populate_record(
       null::fx_system_tx_execution_claim,
       to_jsonb(template) || jsonb_build_object(
         'scope_uuid', $2::text,
         'session_id',
           '87100000-0000-0000-0000-' ||
           lpad(($4::int + series.ordinal)::text, 12, '0')
       )
     )).*
     from fx_system_tx_execution_claim as template
     cross join generate_series(1, $5::int) as series(ordinal)
     where template.scope_uuid = $1::uuid
       and template.session_id = $3::uuid`,
    [
      input.sourceScopeUuid,
      input.destinationScopeUuid,
      input.expiredTemplateId,
      input.ordinalBase,
      input.count,
    ],
  );
}

async function insertCandidate(
  persistence: PostgresFlarexPersistence,
  input: Readonly<{
    scopeUuid: string;
    sessionId: string;
    source: "expiredClaim" | "finishingSession";
    eligibleAt: string;
  }>,
): Promise<void> {
  await insertTransactionSessionFixture(
    persistence,
    transactionSessionFixture(input.sessionId, {
      scopeUuid: input.scopeUuid,
      lifecycle: input.source === "expiredClaim" ? "running" : "finishing",
      createdAt: input.eligibleAt,
      updatedAt: input.eligibleAt,
    }),
  );
  if (input.source === "finishingSession") return;
  await insertOpenTransactionJournalFixture(persistence, {
    scopeUuid: input.scopeUuid,
    sessionId: input.sessionId,
    createdAt: input.eligibleAt,
  });
  await persistence.query(
    `insert into fx_system_tx_execution_claim
       (scope_uuid, session_id, attempt_fence, claim_fence, claim_owner,
        claimed_at, claim_expires_at)
     values ($1::uuid, $2::uuid, 1, 1,
             '87100000-0000-4000-8000-000000009999'::uuid,
             $3::timestamptz - interval '1 second', $3::timestamptz)`,
    [input.scopeUuid, input.sessionId, input.eligibleAt],
  );
}

async function candidateStateCounts(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
): Promise<Readonly<{ sessions: number; claims: number }>> {
  const result = await persistence.query<{
    sessions: number;
    claims: number;
  }>(
    `select
       (select count(*)::int from fx_system_tx_session
        where scope_uuid = $1::uuid) as sessions,
       (select count(*)::int from fx_system_tx_execution_claim
        where scope_uuid = $1::uuid) as claims`,
    [scopeUuid],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected candidate-state counts.");
  return Object.freeze(row);
}

function collectPlanNodes(value: unknown): ReadonlyArray<Readonly<Record<
  string,
  unknown
>>> {
  const nodes: Readonly<Record<string, unknown>>[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const member of current) visit(member);
      return;
    }
    const record = asNonArrayRecord(current);
    if (record === null) return;
    if (typeof record["Node Type"] === "string") nodes.push(record);
    for (const member of Object.values(record)) visit(member);
  };
  visit(value);
  return Object.freeze(nodes);
}

function isBoundedPlanCount(value: unknown, maximum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= maximum;
}

function sessionIdAt(sequence: number): string {
  return `87100000-0000-0000-0000-${sequence.toString().padStart(12, "0")}`;
}

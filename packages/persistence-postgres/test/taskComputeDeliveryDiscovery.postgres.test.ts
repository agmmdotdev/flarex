import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  createPostgresPersistence,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../src/postgresLocatedReadCommitted";
import {
  buildTaskComputeCancellationDiscoveryStatement,
  buildTaskComputeDispatchDiscoveryStatement,
  makeTaskComputeDeliveryCandidateDiscovery,
  TaskComputeDeliveryDiscoverySqlError,
} from "../src/taskComputeDeliveryDiscovery";
import {
  createLocatedTaskComputeDeliveryTargetV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import {
  applyTaskRepairPostgresDeadlinePolicyV1,
} from "../src/taskRepairPostgresDeadlinePolicyV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import {
  seedTaskComputeDeliverySchemaV1,
  settleTaskComputeDeliverySchemaV1,
} from "./taskComputeDeliverySchemaV1TestSupport";
import {
  TASK_LOCATOR,
  locatedTaskAuthorityV1,
} from "./taskSystemRunAttemptStoreTestSupport";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const DISCOVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 250,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 30_000,
});

describe("DTE06-C3 PostgreSQL discovery acceptance environment", () => {
  it("requires an authenticated PostgreSQL 18 URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-C3 discovery.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL DTE06-C3 compute-delivery discovery", () => {
  it("runs under an ordinary role and discovers both operation checkpoints", async () => {
    await withTemporaryPostgresSchema(async (databaseOptions) => {
      const persistence = await createPostgresPersistence({
        migrationsSchema: databaseOptions.migrationsSchema,
        poolConfig: Result.getOrThrow(
          applyTaskRepairPostgresDeadlinePolicyV1({
            ...databaseOptions.poolConfig,
            connectionString: databaseOptions.connectionString,
            max: 2,
          }, DISCOVERY_DEADLINE_POLICY),
        ),
      });
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

        const parent = await seedRegisteredTaskSystemParentV1(
          persistence,
          "dte06-c3:compute-delivery-discovery",
        );
        const seeded = await seedTaskComputeDeliverySchemaV1(
          persistence,
          parent,
        );
        const lifecycleTarget =
          createPostgresLocatedTaskSystemRunAttemptTargetV1(
            persistence,
            TASK_LOCATOR,
          );
        const lifecycleLocated = await locatedTaskAuthorityV1(
          persistence.drizzle,
          lifecycleTarget,
          seeded.scopeId,
          seeded.deploymentId,
        );
        const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
          persistence.drizzle,
          TASK_LOCATOR,
          createPostgresLocatedReadCommittedTransactionRunnerV1(
            persistence.pool,
          ),
        );
        const discovery = Result.getOrThrow(
          makeTaskComputeDeliveryCandidateDiscovery(Object.freeze({
            authority: lifecycleLocated.authority,
            target: deliveryTarget,
          }), DISCOVERY_DEADLINE_POLICY),
        );

        const [dispatch, cancellation] = await Promise.all([
          runEffect(discovery.discoverDispatchCandidates({ limit: 10 })),
          runEffect(discovery.discoverCancellationCandidates({ limit: 10 })),
        ]);
        expect(dispatch.candidates).toHaveLength(1);
        expect(dispatch.candidates[0]).toMatchObject({
          operation: "dispatch",
          runId: seeded.runId,
        });
        expect(cancellation.candidates).toHaveLength(1);
        expect(cancellation.candidates[0]).toMatchObject({
          operation: "cancellation",
          runId: seeded.runId,
        });
        expect(dispatch.databaseTimeBound).toMatch(/\.\d{3}Z$/);
        expect(cancellation.databaseTimeBound).toMatch(/\.\d{3}Z$/);

        const locker = await persistence.pool.connect();
        try {
          await locker.query("begin");
          await locker.query(`
            select scope_id
            from fx_system_scope_clock
            where scope_id = $1
            for update
          `, [seeded.scopeId]);
          const startedAt = performance.now();
          const lockFailure = await runEffectFailure(
            discovery.discoverDispatchCandidates({ limit: 1 }),
          );
          expect(performance.now() - startedAt).toBeLessThan(5_000);
          expect(lockFailure).toBeInstanceOf(
            TaskComputeDeliveryDiscoverySqlError,
          );
          expect(lockFailure).toMatchObject({
            operation: "dispatch",
            phase: "transaction",
          });
        } finally {
          await locker.query("rollback");
          locker.release();
        }
        expect((await runEffect(
          discovery.discoverDispatchCandidates({ limit: 10 }),
        )).candidates).toHaveLength(1);

        await settleTaskComputeDeliverySchemaV1(
          persistence,
          seeded.evidence,
        );
        await seedLargeComputeDeliveryHistory(persistence, seeded);
        await persistence.query(
          "analyze fx_system_durable_task_compute_pending_v1",
        );
        await persistence.query(
          "analyze fx_system_durable_task_compute_dispatch_v1",
        );
        await persistence.query(
          "analyze fx_system_durable_task_compute_cancellation_v1",
        );
        const scopeId = ReplacementScopeIdV1Schema.make(seeded.scopeId);
        const dialect = new PgDialect();
        const plans = await Promise.all([
          explainAnalyze(persistence, dialect.sqlToQuery(
            buildTaskComputeDispatchDiscoveryStatement({
              scopeId,
              limitPlusOne: 11,
              continuation: undefined,
            }),
          )),
          explainAnalyze(persistence, dialect.sqlToQuery(
            buildTaskComputeCancellationDiscoveryStatement({
              scopeId,
              limitPlusOne: 11,
              continuation: undefined,
            }),
          )),
        ]);
        assertBoundedIndexScan(
          plans[0],
          "fx_task_compute_pending_v1_discovery_idx",
          11,
        );
        assertBoundedIndexScan(
          plans[0],
          "fx_task_compute_dispatch_v1_due_idx",
          11,
        );
        assertBoundedIndexScan(
          plans[0],
          "fx_task_compute_dispatch_v1_claim_idx",
          11,
        );
        assertBoundedIndexScan(
          plans[1],
          "fx_task_compute_pending_v1_discovery_idx",
          11,
        );
        assertBoundedIndexScan(
          plans[1],
          "fx_task_compute_cancel_v1_due_idx",
          11,
        );
        assertBoundedIndexScan(
          plans[1],
          "fx_task_compute_cancel_v1_claim_idx",
          11,
        );
        expect(JSON.stringify(plans)).not.toContain(
          "fx_task_requested_effect_v1_kind_idx",
        );
      } finally {
        await persistence.close();
      }
    });
  }, 120_000);
});

async function explainAnalyze(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  compiled: Readonly<{ readonly sql: string; readonly params: unknown[] }>,
): Promise<unknown> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const explained = await client.query<{ readonly "QUERY PLAN": unknown }>(
      `explain (analyze, buffers, costs off, format json) ${compiled.sql}`,
      compiled.params,
    );
    return explained.rows[0]?.["QUERY PLAN"];
  } finally {
    client.release();
  }
}

async function seedLargeComputeDeliveryHistory(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  seeded: Readonly<{
    readonly scopeId: string;
    readonly runId: string;
  }>,
): Promise<void> {
  await persistence.query(`
    with generated as materialized (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      ) as run_id
      from generate_series(1, 2000) as value
    )
    insert into fx_system_durable_task_run_v1 (
      scope_id, run_id, definition_generation, task_definition_revision_id, created_at_ms,
      input_codec, input_store, input_value_codec, input_object_key,
      input_byte_length, input_sha256, input_retention,
      creation_authority_codec_version, creation_authority_byte_length,
      creation_authority_sha256, creation_authority_bytes,
      aggregate_codec_version, aggregate_byte_length, aggregate_json,
      run_version, phase, due_kind, due_at_ms, current_attempt_id,
      execution_fence_basis, current_lease_version,
      current_lease_expires_at_ms, cancellation_generation,
      requested_effect_sequence
    )
    select source.scope_id, generated.run_id, source.definition_generation,
           source.task_definition_revision_id, source.created_at_ms,
           source.input_codec, source.input_store, source.input_value_codec,
           source.input_object_key, source.input_byte_length,
           source.input_sha256, source.input_retention,
           source.creation_authority_codec_version,
           source.creation_authority_byte_length,
           source.creation_authority_sha256, source.creation_authority_bytes,
           source.aggregate_codec_version, source.aggregate_byte_length,
           source.aggregate_json, source.run_version, source.phase,
           source.due_kind, source.due_at_ms, source.current_attempt_id,
           source.execution_fence_basis, source.current_lease_version,
           source.current_lease_expires_at_ms,
           source.cancellation_generation, source.requested_effect_sequence
    from fx_system_durable_task_run_v1 as source
    cross join generated
    where source.scope_id = $1 and source.run_id = $2
  `, [seeded.scopeId, seeded.runId]);
  const classifyDispatchHistory = () => persistence.query(`
    with generated as materialized (
      select value,
             format(
               'run_%s-0000-4000-8000-%s',
               lpad(to_hex(value), 8, '0'),
               lpad(to_hex(value), 12, '0')
             ) as run_id
      from generate_series(1, 1997) as value
    )
    update fx_system_durable_task_compute_dispatch_v1 as checkpoint
    set delivery_state = case
          when generated.value between 501 and 1000 then 'retry_wait'
          else 'prepared'
        end,
        claim_owner = case
          when generated.value >= 1001
            then '73000000-0000-4000-8000-000000000099'::uuid
          else null
        end,
        claim_fence = case when generated.value >= 1001 then 1 else 0 end,
        claimed_at = case
          when generated.value between 1001 and 1500
            then statement_timestamp() - interval '1 minute'
          when generated.value >= 1501
            then statement_timestamp() - interval '2 minutes'
          else null
        end,
        claim_expires_at = case
          when generated.value between 1001 and 1500
            then statement_timestamp() + interval '1 hour'
          when generated.value >= 1501
            then statement_timestamp() - interval '1 minute'
          else null
        end,
        delivery_attempt_count = case
          when generated.value between 501 and 1000 then 1 else 0
        end,
        delivery_started_at = case
          when generated.value between 501 and 1000
            then checkpoint.created_at
          else null
        end,
        next_attempt_at = case
          when generated.value between 501 and 1000
            then checkpoint.created_at + interval '1 millisecond'
          else null
        end,
        reason_code = case
          when generated.value between 501 and 1000 then 'retryable'
          else null
        end,
        acceptance_codec_version = null,
        acceptance_byte_length = null,
        acceptance_sha256 = null,
        acceptance_bytes = null,
        settled_at = null,
        updated_at = statement_timestamp()
    from generated
    where checkpoint.scope_id = $1
      and checkpoint.run_id = generated.run_id
  `, [seeded.scopeId]);
  const classifyCancellationHistory = () => persistence.query(`
    with generated as materialized (
      select value,
             format(
               'run_%s-0000-4000-8000-%s',
               lpad(to_hex(value), 8, '0'),
               lpad(to_hex(value), 12, '0')
             ) as run_id
      from generate_series(1, 1997) as value
    )
    update fx_system_durable_task_compute_cancellation_v1 as checkpoint
    set delivery_state = case
          when generated.value between 501 and 1000 then 'retry_wait'
          else 'prepared'
        end,
        claim_owner = case
          when generated.value >= 1001
            then '73000000-0000-4000-8000-000000000099'::uuid
          else null
        end,
        claim_fence = case when generated.value >= 1001 then 1 else 0 end,
        claimed_at = case
          when generated.value between 1001 and 1500
            then statement_timestamp() - interval '1 minute'
          when generated.value >= 1501
            then statement_timestamp() - interval '2 minutes'
          else null
        end,
        claim_expires_at = case
          when generated.value between 1001 and 1500
            then statement_timestamp() + interval '1 hour'
          when generated.value >= 1501
            then statement_timestamp() - interval '1 minute'
          else null
        end,
        delivery_attempt_count = case
          when generated.value between 501 and 1000 then 1 else 0
        end,
        delivery_started_at = case
          when generated.value between 501 and 1000
            then checkpoint.created_at
          else null
        end,
        next_attempt_at = case
          when generated.value between 501 and 1000
            then checkpoint.created_at + interval '1 millisecond'
          else null
        end,
        reason_code = case
          when generated.value between 501 and 1000 then 'retryable'
          else null
        end,
        receipt_codec_version = null,
        receipt_byte_length = null,
        receipt_sha256 = null,
        receipt_bytes = null,
        settled_at = null,
        updated_at = statement_timestamp()
    from generated
    where checkpoint.scope_id = $1
      and checkpoint.run_id = generated.run_id
  `, [seeded.scopeId]);
  await persistence.query(`
    with generated as materialized (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      ) as run_id
      from generate_series(1, 2000) as value
    )
    insert into fx_system_durable_task_requested_effect_v1 (
      scope_id, run_id, sequence, accepted_run_version, kind,
      payload_codec_version, payload_byte_length, payload_json, not_before_ms
    )
    select source.scope_id, generated.run_id, source.sequence,
           source.accepted_run_version, source.kind,
           source.payload_codec_version, source.payload_byte_length,
           source.payload_json, source.not_before_ms
    from fx_system_durable_task_requested_effect_v1 as source
    cross join generated
    where source.scope_id = $1 and source.run_id = $2
  `, [seeded.scopeId, seeded.runId]);
  await persistence.query(`
    with generated as materialized (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      ) as run_id
      from generate_series(1, 2000) as value
    )
    insert into fx_system_durable_task_compute_dispatch_v1
    select (
      jsonb_populate_record(
        null::fx_system_durable_task_compute_dispatch_v1,
        to_jsonb(source) || jsonb_build_object('run_id', generated.run_id)
      )
    ).*
    from fx_system_durable_task_compute_dispatch_v1 as source
    cross join generated
    where source.scope_id = $1 and source.run_id = $2
  `, [seeded.scopeId, seeded.runId]);
  await persistence.query(`
    with generated as materialized (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      ) as run_id
      from generate_series(1, 2000) as value
    )
    insert into fx_system_durable_task_compute_cancellation_v1
    select (
      jsonb_populate_record(
        null::fx_system_durable_task_compute_cancellation_v1,
        to_jsonb(source) || jsonb_build_object('run_id', generated.run_id)
      )
    ).*
    from fx_system_durable_task_compute_cancellation_v1 as source
    cross join generated
    where source.scope_id = $1 and source.run_id = $2
  `, [seeded.scopeId, seeded.runId]);
  await classifyDispatchHistory();
  await classifyCancellationHistory();
  await persistence.query(`
    with pending_runs as materialized (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      ) as run_id
      from generate_series(1998, 2000) as value
    )
    delete from fx_system_durable_task_compute_cancellation_v1
    where scope_id = $1 and run_id in (select run_id from pending_runs)
  `, [seeded.scopeId]);
  await persistence.query(`
    with pending_runs as materialized (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      ) as run_id
      from generate_series(1998, 2000) as value
    )
    delete from fx_system_durable_task_compute_dispatch_v1
    where scope_id = $1 and run_id in (select run_id from pending_runs)
  `, [seeded.scopeId]);
  await persistence.query(`
    insert into fx_system_durable_task_compute_pending_v1 (
      scope_id, run_id, requested_effect_sequence, kind, eligible_at
    )
    select scope_id, run_id, sequence, kind,
           date_trunc('milliseconds', statement_timestamp())
    from fx_system_durable_task_requested_effect_v1
    where scope_id = $1 and run_id in (
      select format(
        'run_%s-0000-4000-8000-%s',
        lpad(to_hex(value), 8, '0'),
        lpad(to_hex(value), 12, '0')
      )
      from generate_series(1998, 2000) as value
    )
      and kind in (
        'dispatch_attempt',
        'request_execution_cancellation'
      )
  `, [seeded.scopeId]);
}

function assertBoundedIndexScan(
  plan: unknown,
  indexName: string,
  maximumRows: number,
): void {
  const scans = collectIndexScans(plan, indexName);
  expect(scans.length, `expected ${indexName} in plan`).toBeGreaterThan(0);
  expect(
    scans.some((scan) => scan.actualRows > 0),
    `expected nonempty ${indexName} scan`,
  ).toBe(true);
  for (const scan of scans) {
    expect(scan.actualLoops).toBe(1);
    expect(
      (scan.actualRows + scan.rowsRemovedByFilter) * scan.actualLoops,
      `${indexName}: ${JSON.stringify(scan)}`,
    ).toBeLessThanOrEqual(maximumRows);
    expect(scan.bufferBlocks).toBeLessThanOrEqual(256);
  }
}

function collectIndexScans(
  value: unknown,
  indexName: string,
): ReadonlyArray<Readonly<{
  readonly actualRows: number;
  readonly actualLoops: number;
  readonly rowsRemovedByFilter: number;
  readonly bufferBlocks: number;
  readonly indexCondition: unknown;
  readonly scanDirection: unknown;
}>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectIndexScans(item, indexName));
  }
  if (!isNonArrayRecord(value)) return [];
  const nested = Object.values(value).flatMap(
    (item) => collectIndexScans(item, indexName),
  );
  if (value["Index Name"] !== indexName) return nested;
  const actualRows = value["Actual Rows"];
  const actualLoops = value["Actual Loops"];
  const rowsRemovedByFilter = value["Rows Removed by Filter"] ?? 0;
  const sharedHitBlocks = value["Shared Hit Blocks"];
  const sharedReadBlocks = value["Shared Read Blocks"];
  if (
    typeof actualRows !== "number"
    || typeof actualLoops !== "number"
    || typeof rowsRemovedByFilter !== "number"
    || typeof sharedHitBlocks !== "number"
    || typeof sharedReadBlocks !== "number"
  ) {
    throw new Error(`PostgreSQL omitted ANALYZE metrics for ${indexName}.`);
  }
  return [{
    actualRows,
    actualLoops,
    rowsRemovedByFilter,
    bufferBlocks: sharedHitBlocks + sharedReadBlocks,
    indexCondition: value["Index Cond"],
    scanDirection: value["Scan Direction"],
  }, ...nested];
}

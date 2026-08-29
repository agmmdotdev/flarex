import {
  decodeTaskDurationMsV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { makeStandardApplicationTaskSha256V1 } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeApplicationTaskRunListStore } from
  "../src/applicationTaskRunListStore";
import { makeApplicationTaskSystemRunCreationStore } from
  "../src/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../src/applicationTaskSelection";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from
  "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import { createApplicationNativeMutationPostgresFixture } from
  "./fixtures/applicationNativeMutationTestFixture";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const RUNTIME_HOST_IDENTITY = "flarex.test/dte07-task-run-list-postgres";
const COMPATIBILITY_DATE = "2026-08-30";
const CREATED_AT_MS = 5_000;
const RUN_UUIDS = [
  "73000000-0000-4000-8000-000000000001",
  "73000000-0000-4000-8000-000000000002",
  "73000000-0000-4000-8000-000000000003",
] as const;
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

describePostgres("DTE07 located Application Task-run list store - PostgreSQL", {
  timeout: 300_000,
}, () => {
  it("matches C-collated keyset order and owns the indexed access path", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        includeTask: true,
      }, { control, target });
      const selected = await runEffect(selectApplicationTask(
        fixture.active.selection,
        "tasks.users.task",
        {
          deploymentId: fixture.deploymentId,
          runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
          authority: fixture.authorityPorts,
        },
      ));
      const located = Object.freeze({
        authority: fixture.active.basis.authority,
        target: createPostgresLocatedTaskSystemRunAttemptTargetV1(
          target,
          fixture.active.basis.authority.physicalLocator,
        ),
      });
      for (const [index, runUuid] of RUN_UUIDS.entries()) {
        const creation = makeApplicationTaskSystemRunCreationStore(located, {
          sha256,
          leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
          immediateRetryThresholdMs:
            Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
          randomUuid: () => runUuid,
        });
        await runEffect(creation.createRun(
          selected.selection,
          Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
            version: 1,
            requestKey: `dte07-postgres-${index}`,
            applicationTaskRuntimeTargetSha256:
              selected.metadata.runtimeTargetSha256,
            input: Result.getOrThrow(makeTaskInputReferenceV1(
              new Uint8Array(32).fill(0x60 + index),
              19,
            )),
            principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
              new Uint8Array(32).fill(0x70 + index),
              23,
            )),
          })),
        ));
      }
      await target.query(`
        update fx_system_durable_task_run_v1
        set created_at_ms = $1,
            aggregate_json = jsonb_set(
              jsonb_set(
                aggregate_json,
                '{aggregate,createdAtMs}',
                to_jsonb($1::bigint)
              ),
              '{aggregate,ready,eligibleAtMs}',
              to_jsonb($1::bigint)
            )
        where scope_id = $2
          and definition_generation = 'application_v1'
      `, [CREATED_AT_MS, located.authority.scopeId]);

      const store = makeApplicationTaskRunListStore(located);
      const first = await runEffect(store.listRuns({
        pageSize: 2,
        cursor: null,
      }));
      expect(first.runs.map(run => run.runId)).toEqual([
        `run_${RUN_UUIDS[2]}`,
        `run_${RUN_UUIDS[1]}`,
      ]);
      expect(first.hasMore).toBe(true);

      const client = await target.pool.connect();
      try {
        await client.query("set enable_seqscan = off");
        const plan = await client.query<{ "QUERY PLAN": string }>(`
          explain (costs off)
          select run_id, created_at_ms
          from fx_system_durable_task_run_v1
          where scope_id = $1
            and definition_generation = 'application_v1'
          order by created_at_ms desc, run_id collate "C" desc
          limit 2
        `, [located.authority.scopeId]);
        expect(plan.rows.map(row => row["QUERY PLAN"]).join("\n"))
          .toContain("fx_task_run_v1_application_list_idx");
      } finally {
        client.release();
      }
    });
  });
});

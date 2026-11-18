import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decideApplicationStartAttemptV1,
  decodeTaskDurationMsV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { makeStandardApplicationTaskSha256V1 } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeApplicationTaskReadStore } from
  "../../../src/application/tasks/applicationTaskAttemptHistoryStore";
import { makeApplicationTaskSystemRunCreationStore } from
  "../../../src/application/tasks/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../../../src/application/tasks/applicationTaskSelection";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from
  "../../../src/database/postgres";
import { makeApplicationTaskSystemRunAttemptStoreV1 } from
  "../../../src/tasks/taskSystemRunAttemptStoreV1";
import { runEffect } from "../../support/effectTestRuntime";
import { createApplicationNativeMutationPostgresFixture } from
  "../applicationNativeMutationTestFixture";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "../../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const RUN_UUID = "76000000-0000-4000-8000-000000000001";
const ATTEMPT_UUID = "76000000-0000-4000-8000-000000000002";
const RUNTIME_HOST_IDENTITY = "flarex.test/dte07-attempt-history-postgres";
const COMPATIBILITY_DATE = "2026-08-30";
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

const decodeExplainResponse = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ Plan: Schema.Unknown })),
);
const decodePlanNode = Schema.decodeUnknownSync(Schema.Struct({
  "Node Type": Schema.String,
  "Relation Name": Schema.optional(Schema.String),
  "Index Name": Schema.optional(Schema.String),
  "Index Cond": Schema.optional(Schema.String),
  Plans: Schema.optional(Schema.Array(Schema.Unknown)),
}));

function planNodes(value: unknown): readonly ReturnType<typeof decodePlanNode>[] {
  const node = decodePlanNode(value);
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

describePostgres("DTE07 located Task attempt-history store - PostgreSQL", {
  timeout: 300_000,
}, () => {
  it("reads one atomic run-and-attempt snapshot through owned indexes", async () => {
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
      const creation = makeApplicationTaskSystemRunCreationStore(located, {
        sha256,
        leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
        immediateRetryThresholdMs:
          Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
        randomUuid: () => RUN_UUID,
      });
      const receipt = await runEffect(creation.createRun(
        selected.selection,
        Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
          version: 1,
          requestKey: `dte07-postgres-${RUN_UUID}`,
          applicationTaskRuntimeTargetSha256:
            selected.metadata.runtimeTargetSha256,
          input: Result.getOrThrow(makeTaskInputReferenceV1(
            new Uint8Array(32).fill(0x61),
            19,
          )),
          principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
            new Uint8Array(32).fill(0x62),
            23,
          )),
        })),
      ));
      const attempts = makeApplicationTaskSystemRunAttemptStoreV1(located, {
        randomUuid: () => ATTEMPT_UUID,
      });
      const started = await runEffect(attempts.transactRunAttempt({
        operation: "start_attempt",
        runId: receipt.runId,
        decide: input => decideApplicationStartAttemptV1({
          type: "start_attempt",
          runId: receipt.runId,
          expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
        }, input),
      }));
      expect(started.outcome.kind).toBe("attempt_granted");

      const history = await runEffect(
        makeApplicationTaskReadStore(located)
          .listAttempts(receipt.runId),
      );
      expect(history.runVersion).toBe(2n);
      expect(history.attempts).toEqual([{
        attemptId: `attempt_${ATTEMPT_UUID}`,
        attemptNumber: 1,
        acceptedRunVersion: 2n,
      }]);

      const events = await runEffect(
        makeApplicationTaskReadStore(located).listEvents(receipt.runId),
      );
      expect(events.runVersion).toBe(2n);
      expect(events.events.map(item => item.event.kind)).toEqual([
        "attempt_granted",
      ]);

      const client = await target.pool.connect();
      try {
        await client.query("set enable_seqscan = off");
        const ordinalIndex = await client.query<{
          unique: boolean; valid: boolean; ready: boolean;
          method: string; keys: readonly string[];
        }>(`
          select i.indisunique as unique, i.indisvalid as valid,
                 i.indisready as ready, am.amname as method,
                 array(select pg_get_indexdef(i.indexrelid, ordinal, true)
                       from generate_series(1, i.indnkeyatts) ordinal) as keys
          from pg_index i
          join pg_class c on c.oid = i.indexrelid
          join pg_am am on am.oid = c.relam
          where i.indexrelid = 'fx_task_attempt_identity_v1_ordinal_unique'::regclass
            and i.indrelid = 'fx_system_durable_task_attempt_identity_v1'::regclass
        `);
        expect(ordinalIndex.rows).toEqual([{
          unique: true, valid: true, ready: true, method: "btree",
          keys: ["scope_id", "run_id", "attempt_number"],
        }]);

        const plan = await client.query<{
          "QUERY PLAN": unknown;
        }>(`
          explain (costs off, format json)
          select r.run_version, a.attempt_id, a.attempt_number,
                 a.accepted_run_version
          from fx_system_durable_task_run_v1 r
          left join fx_system_durable_task_attempt_identity_v1 a
            on a.scope_id = r.scope_id and a.run_id = r.run_id
          where r.scope_id = $1 and r.run_id = $2
            and r.definition_generation = 'application_v1'
          order by a.attempt_number asc
          limit 251
        `, [located.authority.scopeId, receipt.runId]);
        // Either scoped unique index bounds this join to at most 250 attempts;
        // the one-row fixture does not determine the planner's index choice.
        const attemptScans = plan.rows.flatMap(row => decodeExplainResponse(row["QUERY PLAN"])
          .flatMap(entry => planNodes(entry.Plan)))
          .filter(node => node["Relation Name"] === "fx_system_durable_task_attempt_identity_v1");
        expect(attemptScans).toHaveLength(1);
        expect(attemptScans[0]).toMatchObject({
          "Node Type": expect.stringMatching(/^Index (Only )?Scan$/),
          "Index Name": expect.stringMatching(/^fx_task_attempt_identity_v1_(ordinal|fence)_unique$/),
        });
        expect(attemptScans[0]?.["Index Cond"])
          .toContain(`(scope_id = '${located.authority.scopeId}'::text)`);
        expect(attemptScans[0]?.["Index Cond"])
          .toContain(`(run_id = '${receipt.runId}'::text)`);

        const eventPlan = await client.query<{ "QUERY PLAN": string }>(`
          explain (costs off)
          select r.run_version, e.sequence, e.payload_json
          from fx_system_durable_task_run_v1 r
          left join fx_system_durable_task_requested_effect_v1 e
            on e.scope_id = r.scope_id and e.run_id = r.run_id
           and e.kind = 'publish_lifecycle_event'
          where r.scope_id = $1 and r.run_id = $2
            and r.definition_generation = 'application_v1'
          order by e.sequence asc
          limit 752
        `, [located.authority.scopeId, receipt.runId]);
        const eventPlanText = eventPlan.rows
          .map(row => row["QUERY PLAN"])
          .join("\n");
        expect(eventPlanText).toContain("fx_task_requested_effect_v1_kind_idx");
      } finally {
        client.release();
      }
    });
  });
});

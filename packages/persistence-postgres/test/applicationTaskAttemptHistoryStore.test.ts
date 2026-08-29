import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decideApplicationCompleteAttemptV1,
  decideApplicationStartAttemptV1,
  decodeTaskDurationMsV1,
  decodeTaskExecutionDurationMsV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { makeStandardApplicationTaskSha256V1 } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { ScopeEpochSchema } from "flarex-protocol/storage-authority";
import { eq } from "drizzle-orm";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeApplicationTaskAttemptHistoryStore } from
  "../src/applicationTaskAttemptHistoryStore";
import { makeApplicationTaskSystemRunCreationStore } from
  "../src/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../src/applicationTaskSelection";
import { createPGliteLocatedTaskSystemRunAttemptTargetV1 } from
  "../src/pglite";
import { fxSystemScopeClocks } from "../src/schema";
import { makeApplicationTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createApplicationNativeMutationPGliteFixture } from
  "./fixtures/applicationNativeMutationTestFixture";

const RUN_UUID = "75000000-0000-4000-8000-000000000001";
const FIRST_ATTEMPT_UUID = "75000000-0000-4000-8000-000000000002";
const SECOND_ATTEMPT_UUID = "75000000-0000-4000-8000-000000000003";
const RUNTIME_HOST_IDENTITY = "flarex.test/dte07-task-attempt-history";
const COMPATIBILITY_DATE = "2026-08-30";
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const leaseDurationMs = Result.getOrThrow(decodeTaskDurationMsV1(30_000));
const immediateRetryThresholdMs = Result.getOrThrow(
  decodeTaskDurationMsV1(5_000),
);

describe("DTE07 located Application Task attempt-history store - PGlite", () => {
  it("reads immutable attempt admissions in ascending attempt order", async () => {
    await withFixture(async fixture => {
      const runId = await createRun(fixture);
      const firstStore = makeApplicationTaskSystemRunAttemptStoreV1(
        fixture.located,
        { randomUuid: () => FIRST_ATTEMPT_UUID },
      );
      const first = await runEffect(firstStore.transactRunAttempt({
        operation: "start_attempt",
        runId,
        decide: input => decideApplicationStartAttemptV1({
          type: "start_attempt",
          runId,
          expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
        }, input),
      }));
      if (first.outcome.kind !== "attempt_granted") {
        throw new Error("Expected the first attempt to be admitted.");
      }
      const firstGrant = first.outcome.grant;
      await runEffect(firstStore.transactRunAttempt({
        operation: "complete_attempt",
        runId,
        decide: input => decideApplicationCompleteAttemptV1({
          type: "complete_attempt",
          runId,
          attemptId: firstGrant.attempt.attemptId,
          executionFence: firstGrant.attempt.executionFence,
          completion: {
            kind: "failed",
            failure: {
              kind: "task_failure",
              code: "handler_failed",
              message: null,
            },
            retry: {
              kind: "override_delay",
              delayMs: Result.getOrThrow(decodeTaskDurationMsV1(1)),
            },
            executionDurationMs: Result.getOrThrow(
              decodeTaskExecutionDurationMsV1(12),
            ),
          },
        }, input),
      }));

      const secondStore = makeApplicationTaskSystemRunAttemptStoreV1(
        fixture.located,
        { randomUuid: () => SECOND_ATTEMPT_UUID },
      );
      const second = await runEffect(secondStore.transactRunAttempt({
        operation: "start_attempt",
        runId,
        decide: input => decideApplicationStartAttemptV1({
          type: "start_attempt",
          runId,
          expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("3")),
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)),
        }, input),
      }));
      if (second.outcome.kind !== "attempt_granted") {
        throw new Error("Expected the second attempt to be admitted.");
      }

      const history = await runEffect(
        makeApplicationTaskAttemptHistoryStore(fixture.located)
          .listAttempts(runId),
      );

      expect(history.runVersion).toBe(4n);
      expect(history.attempts).toEqual([
        {
          attemptId: `attempt_${FIRST_ATTEMPT_UUID}`,
          attemptNumber: 1,
          acceptedRunVersion: 2n,
        },
        {
          attemptId: `attempt_${SECOND_ATTEMPT_UUID}`,
          attemptNumber: 2,
          acceptedRunVersion: 4n,
        },
      ]);
      expect(Object.isFrozen(history)).toBe(true);
      expect(Object.isFrozen(history.attempts)).toBe(true);
    });
  });

  it("returns an empty bounded history for a run with no attempts", async () => {
    await withFixture(async fixture => {
      const runId = await createRun(fixture);
      const history = await runEffect(
        makeApplicationTaskAttemptHistoryStore(fixture.located)
          .listAttempts(runId),
      );

      expect(history.runVersion).toBe(1n);
      expect(history.attempts).toEqual([]);
    });
  });

  it("maps missing runs and stale scope authority to typed failures", async () => {
    await withFixture(async fixture => {
      const missing = Result.getOrThrow(decodeTaskRunIdV1(
        "run_75000000-0000-4000-8000-000000000099",
      ));
      const store = makeApplicationTaskAttemptHistoryStore(fixture.located);
      await expect(runEffectFailure(store.listAttempts(missing))).resolves
        .toMatchObject({
          _tag: "TaskAttemptHistoryStoreError",
          operation: "list_task_attempts",
          runId: missing,
          reason: "run_not_found",
        });

      const runId = await createRun(fixture);
      await fixture.persistence.drizzle.update(fxSystemScopeClocks).set({
        epoch: ScopeEpochSchema.make(
          "epoch_75000000-0000-4000-8000-000000000098",
        ),
      }).where(eq(
        fxSystemScopeClocks.scopeId,
        fixture.located.authority.scopeId,
      ));
      await expect(runEffectFailure(store.listAttempts(runId))).resolves
        .toMatchObject({
          _tag: "TaskAttemptHistoryStoreError",
          reason: "stale_scope_authority",
        });
    });
  });
});

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  await run(await makeFixture());
}

async function makeFixture() {
  const fixture = await createApplicationNativeMutationPGliteFixture({
    runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
    compatibilityDate: COMPATIBILITY_DATE,
    includeTask: true,
  });
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
  const target = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    fixture.target,
    fixture.active.basis.authority.physicalLocator,
  );
  return Object.freeze({
    host: fixture,
    persistence: fixture.target,
    located: Object.freeze({
      authority: fixture.active.basis.authority,
      target,
    }),
    selected,
  });
}

async function createRun(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
) {
  const store = makeApplicationTaskSystemRunCreationStore(fixture.located, {
    sha256,
    leaseDurationMs,
    immediateRetryThresholdMs,
    randomUuid: () => RUN_UUID,
  });
  const receipt = await runEffect(store.createRun(
    fixture.selected.selection,
    Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
      version: 1,
      requestKey: `request-${RUN_UUID}`,
      applicationTaskRuntimeTargetSha256:
        fixture.selected.metadata.runtimeTargetSha256,
      input: Result.getOrThrow(makeTaskInputReferenceV1(
        new Uint8Array(32).fill(0x51),
        19,
      )),
      principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
        new Uint8Array(32).fill(0x52),
        23,
      )),
    })),
  ));
  return receipt.runId;
}

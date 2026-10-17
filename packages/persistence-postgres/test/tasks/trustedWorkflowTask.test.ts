import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { inspectTrustedWorkflowTaskBinding, makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1,
  prepareTrustedWorkflowTaskBinding, type TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decideTrustedWorkflowRequestCancellation, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "../../src/tasks/taskSystemRunAttemptStoreV1";
import { fxSystemDurableTaskRunsV1, fxSystemScopeExecutionAuthorities, fxSystemTrustedWorkflowTaskBindings } from "../../src/database/schema";
import { createPGlitePersistence, createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGliteDeadlineOwnedTaskPersistenceTarget } from "../../src/database/pglite";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from "../../src/database/postgres";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../src/tasks/postgresTaskExternalEffectAuthority";
import type { DeadlineOwnedTaskPersistenceTarget } from "../../src/tasks/taskPersistenceTransaction";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../support/pgliteTestFixture";
import { withTemporaryPostgresPersistence } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";
import { locatedTaskAuthorityV1, readyTaskRunAggregateV1, TASK_LOCATOR } from "./taskSystemRunAttemptStoreTestSupport";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
beforeAll(async () => { if (driver !== "postgres") await migratedPGliteDataDir(); }, 120_000);
const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
  statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
describe(`trusted workflow Task creation and existing lifecycle - ${driver}`, () => {
  it("creates without Application metadata, converges replay, refuses conflicts and persists fenced lifecycle", async () => {
    await withFixture(async ({ db, target, transactionTarget }) => {
      const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
      await insertCurrentScopeClockFixture(db, { scopeId, epoch: `epoch_${randomUUID()}` });
      const located = await locatedTaskAuthorityV1(db, target, scopeId, "trusted-workflow-fixture");
      const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(new Uint8Array(32).fill(0x11), 1));
      const input = Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x22), 1));
      const binding = await runEffect(prepareTrustedWorkflowTaskBinding({ scopeId, workflowRevision: "a".repeat(64),
        adapterRevision: "b".repeat(64), executionProfile: "neutral-child", executionPolicy: { commands: ["one-child"] },
        principalSha256: encodeBytesToLowercaseHex(principal.sha256), boundPolicy: readyTaskRunAggregateV1().boundPolicy }, hash));
      const state = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(binding));
      const make = (selected = binding, randomUuid?: () => string) => makeTrustedWorkflowTaskRunCreationStore({ authority: located.authority,
        target: transactionTarget, binding: selected, sha256: hash, ...(randomUuid === undefined ? {} : { randomUuid }) });
      const request = { requestKey: "one", input, principal };
      const created = await runEffect(make().createRun(request));
      const noAllocation = make(binding, () => { throw new Error("Replay allocated another run"); });
      expect(await runEffect(noAllocation.createRun(request))).toEqual(created);
      const [raceA, raceB] = await Promise.all([runEffect(make().createRun({ ...request, requestKey: "race" })),
        runEffect(make().createRun({ ...request, requestKey: "race" }))]);
      expect(raceA).toEqual(raceB);
      const changedInput = Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x23), 1));
      const conflict = await runEffect(Effect.result(make().createRun({ ...request, input: changedInput })));
      expect(Result.isFailure(conflict) && conflict.failure).toMatchObject({ reason: "requestConflict" });
      const wrongPrincipal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(new Uint8Array(32).fill(0x12), 1));
      const refusedPrincipal = await runEffect(Effect.result(make().createRun({ ...request, principal: wrongPrincipal })));
      expect(Result.isFailure(refusedPrincipal) && refusedPrincipal.failure).toMatchObject({ reason: "invalidBinding" });
      const foreignBinding = await runEffect(prepareTrustedWorkflowTaskBinding({ ...state.definition,
        scopeId: ScopeIdSchema.make(`scope_${randomUUID()}`) }, hash));
      const refusedScope = await runEffect(Effect.result(make(foreignBinding).createRun(request)));
      expect(Result.isFailure(refusedScope) && refusedScope.failure).toMatchObject({ reason: "staleAuthority" });
      const changedBinding = await runEffect(prepareTrustedWorkflowTaskBinding({ ...state.definition,
        adapterRevision: "c".repeat(64) }, hash));
      const refusedRevision = await runEffect(Effect.result(make(changedBinding).createRun(request)));
      expect(Result.isFailure(refusedRevision) && refusedRevision.failure).toMatchObject({ reason: "requestConflict" });
      expect(await db.select().from(fxSystemTrustedWorkflowTaskBindings)
        .where(eq(fxSystemTrustedWorkflowTaskBindings.scopeId, scopeId))).toHaveLength(1);
      // A deliberate forged handle must fail before any row access.
      const forged = await runEffect(Effect.result(make({} as TrustedWorkflowTaskBinding).createRun(request)));
      expect(Result.isFailure(forged) && forged.failure).toMatchObject({ reason: "invalidBinding" });
      const rows = await db.select().from(fxSystemDurableTaskRunsV1).where(eq(fxSystemDurableTaskRunsV1.scopeId, scopeId));
      expect(rows).toHaveLength(2);
      expect(rows.every(row => row.applicationRevisionId === null && row.applicationTaskRuntimeTargetSha256 === null && row.taskDefinitionRevisionId === null)).toBe(true);

      const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
      const initial = await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
      const started = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
        decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
          expectedRunVersion: initial.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
      if (started.outcome.kind !== "attempt_granted") throw new Error("Expected genuine attempt grant");
      const attempt = started.outcome.grant.attempt;
      const heartbeat = await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
        decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: created.runId,
          attemptId: attempt.attemptId, executionFence: attempt.executionFence,
          heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
      expect(heartbeat.disposition).toBe("accepted");
      const complete = () => lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: created.runId,
        decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId: created.runId,
          attemptId: attempt.attemptId, executionFence: attempt.executionFence,
          completion: { kind: "succeeded", result: null, executionDurationMs: null } }, value) });
      expect((await runEffect(complete())).disposition).toBe("accepted");
      expect((await runEffect(complete())).disposition).toBe("idempotent");
      expect((await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }))).current.phase).toBe("terminal");
      const other = await runEffect(make().createRun({ ...request, requestKey: "cancel" }));
      const cancelled = await runEffect(lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: other.runId,
        decide: value => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: other.runId,
          reason: { code: "requested", message: null } }, value) }));
      expect(cancelled.disposition).toBe("accepted");
      expect((await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: other.runId }))).current.phase).toBe("terminal");

      const corruptedBytes = state.canonicalBytes.slice();
      corruptedBytes[0] = 0;
      await db.update(fxSystemTrustedWorkflowTaskBindings).set({ canonicalBytes: corruptedBytes }).where(eq(fxSystemTrustedWorkflowTaskBindings.scopeId, scopeId));
      const corrupt = await runEffect(Effect.result(make().createRun(request)));
      expect(Result.isFailure(corrupt) && corrupt.failure).toMatchObject({ reason: "storedCorruption" });
      await db.update(fxSystemScopeExecutionAuthorities).set({ epoch: ScopeEpochSchema.make(`epoch_${randomUUID()}`) })
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
      const stale = await runEffect(Effect.result(make().createRun({ ...request, requestKey: "after-epoch-change" })));
      expect(Result.isFailure(stale) && stale.failure).toMatchObject({ reason: "staleAuthority" });
    });
  }, 480_000);
});

async function withFixture(run: (fixture: { readonly db: FlarexMetadataDatabase; readonly target: LocatedTaskSystemRunAttemptTargetV1;
  readonly transactionTarget: DeadlineOwnedTaskPersistenceTarget }) => Promise<void>) {
  if (driver === "postgres") return withTemporaryPostgresPersistence(async persistence => {
    const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
      connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 2,
    }, TASK_LOCATOR, deadlines));
    try { return await run({ db: persistence.drizzle, target: createPostgresLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR),
      transactionTarget: resource.target }); } finally { await resource.close(); }
  });
  const raw = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
  try {
    const persistence = await createPGlitePersistence({ db: raw });
    return await run({ db: persistence.drizzle, target: createPGliteLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR),
      transactionTarget: Result.getOrThrow(createPGliteDeadlineOwnedTaskPersistenceTarget(persistence, TASK_LOCATOR, deadlines)) });
  } finally { await raw.close(); }
}

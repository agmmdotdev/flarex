import { PGlite } from "@electric-sql/pglite";
import { Effect, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  encodeTaskComputeProfileStorageBytesV1,
} from "../src/taskComputeDeliveryEvidenceV1";
import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  TaskComputeDeliveryContinuationV1Error,
  TaskComputeDeliveryDiscoveryCorruptionError,
  TaskComputeDeliveryDiscoveryInputError,
  TaskComputeDeliveryDiscoverySqlError,
  decodeTaskComputeDeliveryContinuationV1,
  encodeTaskComputeDeliveryContinuationV1,
  makeTaskComputeDeliveryCandidateDiscovery,
  type TaskComputeDeliveryCandidateDiscovery,
  type TaskComputeDeliveryCandidatePage,
  type TaskComputeDeliveryDiscoveryError,
} from "../src/taskComputeDeliveryDiscovery";
import {
  createLocatedTaskComputeDeliveryTargetV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import type { AppRowTransaction } from "../src/appRows";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../src/transactionSessionActivation";
import type { RunLocatedReadCommittedTransactionV1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  seedTaskComputeDeliverySchemaV1,
  settleTaskComputeDeliverySchemaV1,
} from "./taskComputeDeliverySchemaV1TestSupport";
import {
  TASK_LOCATOR,
  TASK_RUN_ID,
  locatedTaskAuthorityV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const RUN_BEFORE = "run_71000000-0000-4000-8000-000000000001";
const RUN_AFTER = "run_73000000-0000-4000-8000-000000000001";
const RUN_AFTER_HIGH_WATER =
  "run_74000000-0000-4000-8000-000000000001";
const DISCOVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 250,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 30_000,
});

describe("DTE06-C3 compute-delivery persistence discovery - PGlite", () => {
  it("exposes exact operation-specific Effect channels", () => {
    expectTypeOf<ReturnType<
      TaskComputeDeliveryCandidateDiscovery["discoverDispatchCandidates"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDeliveryCandidatePage<"dispatch">,
      TaskComputeDeliveryDiscoveryError<"dispatch">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryCandidateDiscovery[
        "discoverCancellationCandidates"
      ]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDeliveryCandidatePage<"cancellation">,
      TaskComputeDeliveryDiscoveryError<"cancellation">
    >>();
  });

  it("captures authority once and preserves the transaction receiver", async () => {
    await withFixture(async ({ persistence, locatedAuthority }) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        persistence.drizzle,
      );
      let observedReceiver: unknown;
      const receiverRunner: RunLocatedReadCommittedTransactionV1 = function <
        Value,
      >(
        this: unknown,
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> {
        observedReceiver = this;
        return base(work);
      };
      const targetOwner = createLocatedTaskComputeDeliveryTargetV1(
        persistence.drizzle,
        TASK_LOCATOR,
        receiverRunner,
      );
      const target = new Proxy(targetOwner, {});
      let authorityReads = 0;
      const located = {
        get authority() {
          authorityReads += 1;
          return locatedAuthority;
        },
        target,
      };
      const discovery = success(makeTaskComputeDeliveryCandidateDiscovery(
        located,
        DISCOVERY_DEADLINE_POLICY,
      ));
      expect(authorityReads).toBe(1);
      await runEffect(discovery.discoverDispatchCandidates({ limit: 1 }));
      expect(observedReceiver).toBe(target);
    });
  });

  it("strictly owns and correlates the V1 continuation contract", async () => {
    const valid = {
      codecVersion: 1,
      operation: "dispatch",
      databaseTimeBound: "2026-08-11T00:00:00.000Z",
      highWater: {
        eligibleAt: "2026-08-10T00:00:00.000Z",
        runId: RUN_AFTER,
        requestedEffectSequence: "2",
      },
      last: {
        eligibleAt: "2026-08-10T00:00:00.000Z",
        runId: TASK_RUN_ID,
        requestedEffectSequence: "1",
      },
    } as const;
    const decoded = success(decodeTaskComputeDeliveryContinuationV1(valid));
    const encoded = success(encodeTaskComputeDeliveryContinuationV1(decoded));
    expect(encoded).toEqual(valid);
    expect(encoded).not.toBe(valid);
    expect(encoded.highWater).not.toBe(valid.highWater);
    expect(Object.isFrozen(encoded)).toBe(true);
    expect(Object.isFrozen(encoded.highWater)).toBe(true);

    const excess = decodeTaskComputeDeliveryContinuationV1({
      ...valid,
      excess: true,
    });
    expect(Result.isFailure(excess)).toBe(true);
    if (Result.isSuccess(excess)) throw new Error("excess cursor accepted");
    expect(excess.failure).toBeInstanceOf(
      TaskComputeDeliveryContinuationV1Error,
    );
    expect(excess.failure).toMatchObject({
      operation: "decode",
      issue: "invalid_shape",
    });

    const protoExcess = Object.defineProperty({ ...valid }, "__proto__", {
      value: Object.freeze({ admitted: true }),
      enumerable: true,
    });
    expect(Result.isFailure(
      decodeTaskComputeDeliveryContinuationV1(protoExcess),
    )).toBe(true);

    const backward = decodeTaskComputeDeliveryContinuationV1({
      ...valid,
      last: {
        ...valid.last,
        runId: RUN_AFTER_HIGH_WATER,
      },
    });
    expect(Result.isFailure(backward)).toBe(true);
    if (Result.isSuccess(backward)) throw new Error("backward cursor accepted");
    expect(backward.failure).toMatchObject({ issue: "invalid_ordering" });

    let getterInvoked = false;
    const hostile = Object.defineProperty({}, "codecVersion", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 1;
      },
    });
    expect(Result.isFailure(
      decodeTaskComputeDeliveryContinuationV1(hostile),
    )).toBe(true);
    expect(getterInvoked).toBe(false);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => decodeTaskComputeDeliveryContinuationV1(revoked.proxy))
      .not.toThrow();

    await withFixture(async ({ discovery }) => {
      const failure = await runEffectFailure(
        discovery.discoverCancellationCandidates({
          limit: 1,
          continuation: valid,
        }),
      );
      expect(failure).toBeInstanceOf(TaskComputeDeliveryDiscoveryInputError);
      expect(failure).toMatchObject({
        operation: "cancellation",
        reason: "continuation_operation_mismatch",
      });
    });
  });

  it("discovers unseen, initial, retry-due, and expired-claim candidates separately", async () => {
    await withFixture(async ({ persistence, discovery, seeded }) => {
      const initialDispatch = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      const waitingCancellation = await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      );
      expect(candidateKeys(initialDispatch)).toEqual([
        `dispatch:${seeded.runId}:1`,
      ]);
      expect(candidateKeys(waitingCancellation)).toEqual([
        `cancellation:${seeded.runId}:2`,
      ]);

      await persistence.query(
        "delete from fx_system_durable_task_compute_cancellation_v1",
      );
      await persistence.query(
        "delete from fx_system_durable_task_compute_dispatch_v1",
      );
      await seedPendingComputeEffects(persistence, seeded.scopeId);
      expect(candidateKeys(await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);
      expect(candidateKeys(await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      ))).toEqual([`cancellation:${seeded.runId}:2`]);

      await seedDispatchCheckpointFromEvidence(persistence, seeded);
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set delivery_state = 'retry_wait',
            delivery_attempt_count = 1,
            created_at = statement_timestamp() - interval '10 seconds',
            delivery_started_at = statement_timestamp() - interval '5 seconds',
            next_attempt_at = statement_timestamp() + interval '1 hour',
            reason_code = 'provider_transport',
            updated_at = statement_timestamp()
      `);
      expect((await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      )).candidates).toEqual([]);
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set next_attempt_at = statement_timestamp() - interval '1 second'
      `);
      expect(candidateKeys(await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);

      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set next_attempt_at =
          date_trunc('milliseconds', statement_timestamp())
          - interval '1 second' + interval '1 microsecond'
      `);
      const alignmentFailure = await runEffectFailure(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      expect(alignmentFailure).toBeInstanceOf(
        TaskComputeDeliveryDiscoveryCorruptionError,
      );

      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set delivery_state = 'prepared',
            delivery_attempt_count = 0,
            delivery_started_at = null,
            next_attempt_at = null,
            reason_code = null,
            claim_owner = '75000000-0000-4000-8000-000000000001',
            claim_fence = 1,
            claimed_at = statement_timestamp(),
            claim_expires_at = statement_timestamp() + interval '1 hour'
      `);
      expect((await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      )).candidates).toEqual([]);
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set claimed_at = statement_timestamp() - interval '2 seconds',
            claim_expires_at = statement_timestamp() - interval '1 second'
      `);
      expect(candidateKeys(await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);
    });
  });

  it("excludes terminal checkpoints and returns an exact empty page", async () => {
    await withFixture(async ({ persistence, discovery, seeded }) => {
      await settleTaskComputeDeliverySchemaV1(
        persistence,
        seeded.evidence,
      );
      const dispatch = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      const cancellation = await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      );
      expect(dispatch.candidates).toEqual([]);
      expect(dispatch.continuation).toBeNull();
      expect(cancellation.candidates).toEqual([]);
      expect(cancellation.continuation).toBeNull();
      expect(dispatch.databaseTimeBound).toMatch(/\.\d{3}Z$/);
    });
  });

  it("fails closed on a malformed driver result", async () => {
    await withFixture(async ({ persistence, locatedAuthority }) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        persistence.drizzle,
      );
      const runnerFor = (
        driverResult: unknown,
      ): RunLocatedReadCommittedTransactionV1 =>
        <Value>(work: (tx: AppRowTransaction) => Promise<Value>) =>
          base((tx) => work(new Proxy(tx, {
            get: (owner, property) => {
              if (property === "execute") {
                return () => Promise.resolve(driverResult);
              }
              const member: unknown = Reflect.get(owner, property, owner);
              return typeof member === "function"
                ? member.bind(owner)
                : member;
            },
          })));
      const discoveryFor = (driverResult: unknown) => {
        const target = createLocatedTaskComputeDeliveryTargetV1(
          persistence.drizzle,
          TASK_LOCATOR,
          runnerFor(driverResult),
        );
        return success(makeTaskComputeDeliveryCandidateDiscovery(
          Object.freeze({ authority: locatedAuthority, target }),
          DISCOVERY_DEADLINE_POLICY,
        ));
      };
      const emptyRow = Object.freeze({
        databaseNowEpochMillisecondsText: "0",
        databaseTimeBoundEpochMillisecondsText: "0",
        continuationFuture: false,
        highWaterEligibleAtEpochMillisecondsText: null,
        highWaterTimestampAligned: true,
        highWaterRunId: null,
        highWaterRequestedEffectSequenceText: null,
        candidateEligibleAtEpochMillisecondsText: null,
        candidateTimestampAligned: true,
        candidateRunId: null,
        candidateRequestedEffectSequenceText: null,
      });
      const scenarios = Object.freeze([
        Object.freeze({ rows: Object.freeze([]), reason: "metadata_invalid" }),
        Object.freeze({
          rows: Object.freeze([emptyRow, emptyRow]),
          reason: "candidate_invalid",
        }),
      ] as const);
      for (const scenario of scenarios) {
        const failure = await runEffectFailure(
          discoveryFor({ rows: scenario.rows })
            .discoverDispatchCandidates({ limit: 1 }),
        );
        expect(failure).toBeInstanceOf(
          TaskComputeDeliveryDiscoveryCorruptionError,
        );
        expect(failure).toMatchObject({
          operation: "dispatch",
          reason: scenario.reason,
        });
      }

      const foreignCause = new Error("hostile rows getter");
      const hostileResult = Object.defineProperty({}, "rows", {
        enumerable: true,
        get: () => {
          throw foreignCause;
        },
      });
      const foreignFailure = await runEffectFailure(
        discoveryFor(hostileResult).discoverDispatchCandidates({ limit: 1 }),
      );
      expect(foreignFailure).toBeInstanceOf(
        TaskComputeDeliveryDiscoverySqlError,
      );
      expect(foreignFailure).toMatchObject({
        operation: "dispatch",
        phase: "transaction",
      });
    });
  });

  it("paginates by exact high water and defers later work to a fresh cycle", async () => {
    await withFixture(async ({ persistence, discovery, seeded }) => {
      await persistence.query(
        "delete from fx_system_durable_task_compute_cancellation_v1",
      );
      await persistence.query(
        "delete from fx_system_durable_task_compute_dispatch_v1",
      );
      await persistence.query(`
        delete from fx_system_durable_task_requested_effect_v1
        where kind = 'request_execution_cancellation'
      `);
      await seedPendingComputeEffects(persistence, seeded.scopeId);
      await cloneRunAndDispatchEffect(persistence, seeded.runId, RUN_BEFORE);
      await cloneRunAndDispatchEffect(persistence, seeded.runId, RUN_AFTER);

      const first = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 1 }),
      );
      expect(first.candidates.map((candidate) => candidate.runId)).toEqual([
        RUN_BEFORE,
      ]);
      expect(first.continuation?.highWater.runId).toBe(RUN_AFTER);

      await cloneRunAndDispatchEffect(
        persistence,
        seeded.runId,
        RUN_AFTER_HIGH_WATER,
      );
      const resumed: string[] = [];
      let continuation = first.continuation;
      while (continuation !== null) {
        const page = await runEffect(
          discovery.discoverDispatchCandidates({ limit: 1, continuation }),
        );
        resumed.push(...page.candidates.map((candidate) => candidate.runId));
        continuation = page.continuation;
      }
      expect(resumed).toEqual([TASK_RUN_ID, RUN_AFTER]);

      const fresh = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      expect(fresh.candidates.map((candidate) => candidate.runId)).toEqual([
        RUN_BEFORE,
        TASK_RUN_ID,
        RUN_AFTER,
        RUN_AFTER_HIGH_WATER,
      ]);
    });
  });
});

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    await run(await makeFixture(raw));
  } finally {
    await raw.close();
  }
}

async function makeFixture(raw: PGlite) {
  const persistence = await createPGlitePersistence({ db: raw });
  await persistence.migrate();
  const seeded = await seedTaskComputeDeliverySchemaV1(persistence);
  const target = createLocatedTaskComputeDeliveryTargetV1(
    persistence.drizzle,
    TASK_LOCATOR,
  );
  const lifecycleTarget = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const lifecycleLocated = await locatedTaskAuthorityV1(
    persistence.drizzle,
    lifecycleTarget,
  );
  const discovery = success(makeTaskComputeDeliveryCandidateDiscovery(
    Object.freeze({ authority: lifecycleLocated.authority, target }),
    DISCOVERY_DEADLINE_POLICY,
  ));
  return Object.freeze({
    persistence,
    seeded,
    discovery,
    locatedAuthority: lifecycleLocated.authority,
  });
}

function candidateKeys(page: TaskComputeDeliveryCandidatePage): string[] {
  return page.candidates.map((candidate) =>
    `${candidate.operation}:${candidate.runId}:${candidate.requestedEffectSequence}`
  );
}

async function seedDispatchCheckpointFromEvidence(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  seeded: Awaited<ReturnType<typeof seedTaskComputeDeliverySchemaV1>>,
): Promise<void> {
  const envelope = seeded.evidence.dispatchRequest;
  const bytes = success(encodeTaskComputeProfileStorageBytesV1(
    "compute-small",
  ));
  await persistence.query(`
    insert into fx_system_durable_task_compute_dispatch_v1 (
      scope_id, run_id, requested_effect_sequence, accepted_run_version,
      task_definition_revision_id, attempt_id, attempt_number,
      execution_fence, lease_version, compute_profile_codec_version,
      compute_profile_byte_length, compute_profile_bytes, cancellation_kind,
      cancellation_generation, maximum_duration_ms,
      request_codec_version, request_byte_length, request_sha256,
      request_bytes, delivery_state, claim_fence, delivery_attempt_count
    ) values (
      $1, $2, 1, 1,
      'taskdef_72000000-0000-4000-8000-000000000002',
      'attempt_72000000-0000-4000-8000-000000000005', 1,
      1, 1, 1, $3, $4, 'not_requested', 0, 300000,
      $5, $6, $7, $8, 'prepared', 0, 0
    )
  `, [
    seeded.scopeId,
    seeded.runId,
    bytes.byteLength,
    bytes,
    envelope.codecVersion,
    envelope.byteLength,
    envelope.sha256,
    envelope.canonicalBytes,
  ]);
  await persistence.query(`
    delete from fx_system_durable_task_compute_pending_v1
    where scope_id = $1
      and run_id = $2
      and requested_effect_sequence = 1
  `, [seeded.scopeId, seeded.runId]);
}

async function seedPendingComputeEffects(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  scopeId: string,
): Promise<void> {
  await persistence.query(`
    insert into fx_system_durable_task_compute_pending_v1 (
      scope_id, run_id, requested_effect_sequence, kind, eligible_at
    )
    select
      scope_id,
      run_id,
      sequence,
      kind,
      date_trunc('milliseconds', statement_timestamp())
    from fx_system_durable_task_requested_effect_v1
    where scope_id = $1
      and kind in (
        'dispatch_attempt',
        'request_execution_cancellation'
      )
    on conflict (scope_id, run_id, requested_effect_sequence) do nothing
  `, [scopeId]);
}

async function cloneRunAndDispatchEffect(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  sourceRunId: string,
  targetRunId: string,
): Promise<void> {
  await persistence.query(`
    insert into fx_system_durable_task_run_v1 (
      scope_id, run_id, task_definition_revision_id, created_at_ms,
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
    select
      scope_id, $2, task_definition_revision_id, created_at_ms,
      input_codec, input_store, input_value_codec, input_object_key,
      input_byte_length, input_sha256, input_retention,
      creation_authority_codec_version, creation_authority_byte_length,
      creation_authority_sha256, creation_authority_bytes,
      aggregate_codec_version, aggregate_byte_length, aggregate_json,
      run_version, phase, due_kind, due_at_ms, current_attempt_id,
      execution_fence_basis, current_lease_version,
      current_lease_expires_at_ms, cancellation_generation,
      requested_effect_sequence
    from fx_system_durable_task_run_v1
    where run_id = $1
  `, [sourceRunId, targetRunId]);
  await persistence.query(`
    insert into fx_system_durable_task_requested_effect_v1 (
      scope_id, run_id, sequence, accepted_run_version, kind,
      payload_codec_version, payload_byte_length, payload_json, not_before_ms
    )
    select
      scope_id, $2, sequence, accepted_run_version, kind,
      payload_codec_version, payload_byte_length, payload_json, not_before_ms
    from fx_system_durable_task_requested_effect_v1
    where run_id = $1 and kind = 'dispatch_attempt'
  `, [sourceRunId, targetRunId]);
  await persistence.query(`
    insert into fx_system_durable_task_compute_pending_v1 (
      scope_id, run_id, requested_effect_sequence, kind, eligible_at
    )
    select
      scope_id, $2, requested_effect_sequence, kind, eligible_at
    from fx_system_durable_task_compute_pending_v1
    where run_id = $1 and kind = 'dispatch_attempt'
  `, [sourceRunId, targetRunId]);
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

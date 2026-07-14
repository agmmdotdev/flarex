import { DurableObject } from "cloudflare:workers";

import {
  newProbeClaimToken,
  probeRunActorId,
  ProbeOrdinalSchema,
  type ProbeOrdinal,
} from "./identity";
import {
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
  probeSampleIdentityV1,
  type ProbeRunRequestV1,
  type ProbeSamplePhase,
} from "./protocol";
import {
  canonicalProbeRunRequestV1,
  decodeProbeControlledGatewaySampleV1OrNull,
  decodeProbePublicSampleRequestV1OrNull,
  decodeProbeRunRequestV1OrNull,
  decodeProbeRunStatusRequestV1OrNull,
  decodeProbeSampleFinalizeRequestV1OrNull,
  probeRunBudgetPlanV1,
  PROBE_RUN_BUDGET_LIMITS_V1,
  ProbeRunBudgetsV1Schema,
  ProbeRunCountersV1Schema,
  ProbeRunRegistrationReceiptV1Schema,
  ProbeRunSampleStatusV1Schema,
  ProbeRunStatusReceiptV1Schema,
  ProbeRunStatusV1Schema,
  ProbeSampleClaimReceiptV1Schema,
  ProbeSampleFinalizeReceiptV1Schema,
  type ProbeRunBudgetValuesV1,
  type ProbeRunRegistrationReceiptV1,
  type ProbeRunSampleStatusV1,
  type ProbeRunStateErrorCode,
  type ProbeRunStatusReceiptV1,
  type ProbeRunStatusV1,
  type ProbeSampleClaimReceiptV1,
  type ProbeSampleFinalizeReceiptV1,
} from "./runProtocol";
import {
  controlledProbeGatewaySampleV1,
  decodeProbeSyncWakeObservationV1OrNull,
  probeSyncWakeRelationshipIssueV1,
  ProbeSampleControlV1Schema,
  type ProbeMeasurementDisposition,
  type ProbeSyncWakeObservationV1,
} from "./runtimeProtocol";

interface RunRow {
  readonly [key: string]: SqlStorageValue;
  readonly config_json: string;
  readonly total_samples: number;
  readonly configured_concurrency: number;
  readonly payload_bytes_per_sample: number;
  readonly journal_entries_per_sample: number;
  readonly planned_unique_code_ids: number;
  readonly claimed_count: number;
  readonly terminal_count: number;
  readonly completed_count: number;
  readonly failed_count: number;
  readonly outstanding_count: number;
  readonly high_water_outstanding: number;
  readonly consumed_payload_bytes: number;
  readonly consumed_journal_entries: number;
  readonly consumed_unique_code_ids: number;
  readonly eligible_count: number;
  readonly excluded_warmup_count: number;
  readonly excluded_duplicate_wake_count: number;
  readonly next_ordered_ordinal: number;
}

interface SampleRow {
  readonly [key: string]: SqlStorageValue;
  readonly sample_ordinal: number;
  readonly phase: string;
  readonly lifecycle_state: string;
  readonly claim_token: string;
  readonly observed_outstanding_claims: number;
  readonly finalization_json: string | null;
  readonly controlled_sample_json: string | null;
  readonly measurement_disposition: string | null;
  readonly sync_wake_json: string | null;
}

type ClaimTransactionResult =
  | {
      readonly kind: "claimed";
      readonly run: ProbeRunRequestV1;
      readonly phase: ProbeSamplePhase;
      readonly observedOutstandingClaims: number;
    }
  | { readonly kind: "rejected"; readonly code: ProbeRunStateErrorCode };

type FinalizeTransactionResult =
  | {
      readonly kind: "finalized";
      readonly idempotent: boolean;
      readonly sample: NonNullable<
        ReturnType<typeof decodeProbeControlledGatewaySampleV1OrNull>
      >;
    }
  | { readonly kind: "rejected"; readonly code: ProbeRunStateErrorCode };

export class ProbeRunDO extends DurableObject<Record<string, never>> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    initializeRunStorage(this.sql);
  }

  async register(value: unknown): Promise<ProbeRunRegistrationReceiptV1> {
    const run = decodeProbeRunRequestV1OrNull(value);
    if (run === null) return rejectedRegistration("invalid-request");
    if (!this.hasRunIdentity(run.runId)) {
      return rejectedRegistration("identity-mismatch");
    }
    const canonical = canonicalProbeRunRequestV1(run);
    const plan = probeRunBudgetPlanV1(run);
    if (!withinRunBudgetLimits(plan)) {
      return rejectedRegistration(budgetError(plan));
    }

    const result = this.ctx.storage.transactionSync(() => {
      const existing = readRunRowOrNull(this.sql);
      if (existing !== null) {
        return existing.config_json === canonical
          ? { kind: "registered" as const, created: false }
          : { kind: "rejected" as const };
      }
      this.sql.exec(
        `INSERT INTO probe_run_v1 (
          singleton,
          config_json,
          total_samples,
          configured_concurrency,
          payload_bytes_per_sample,
          journal_entries_per_sample,
          planned_unique_code_ids
        ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
        canonical,
        plan.sampleClaims,
        run.dimensions.concurrency,
        run.dimensions.payloadBytes,
        run.dimensions.journalEntries,
        plan.uniqueCodeIds,
      );
      return { kind: "registered" as const, created: true };
    });
    if (result.kind === "rejected") {
      return rejectedRegistration("registration-conflict");
    }
    return ProbeRunRegistrationReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "registered",
      created: result.created,
      status: this.readStatus(),
    });
  }

  async claim(value: unknown): Promise<ProbeSampleClaimReceiptV1> {
    const request = decodeProbePublicSampleRequestV1OrNull(value);
    if (request === null) return rejectedClaim("invalid-request");
    if (!this.hasRunIdentity(request.runId)) {
      return rejectedClaim("identity-mismatch");
    }
    const claimToken = newProbeClaimToken();
    const result = this.ctx.storage.transactionSync<ClaimTransactionResult>(
      () => {
        const row = readRunRowOrNull(this.sql);
        if (row === null) {
          return { kind: "rejected", code: "run-not-registered" };
        }
        const run = decodeStoredRun(row.config_json);
        if (request.sampleOrdinal >= row.total_samples) {
          return { kind: "rejected", code: "sample-out-of-range" };
        }
        const existing = readSampleRowOrNull(this.sql, request.sampleOrdinal);
        if (existing !== null) {
          return {
            kind: "rejected",
            code: existing.lifecycle_state === "claimed"
              ? "sample-already-claimed"
              : "sample-already-finalized",
          };
        }
        if (
          isOrderedWakeScenario(run) &&
          request.sampleOrdinal !== row.next_ordered_ordinal
        ) {
          return { kind: "rejected", code: "sample-order-blocked" };
        }
        if (row.outstanding_count >= row.configured_concurrency) {
          return { kind: "rejected", code: "concurrency-limit" };
        }
        if (row.claimed_count >= row.total_samples) {
          return { kind: "rejected", code: "sample-budget-exhausted" };
        }
        if (
          row.consumed_payload_bytes + row.payload_bytes_per_sample >
            PROBE_RUN_BUDGET_LIMITS_V1.payloadBytes
        ) {
          return { kind: "rejected", code: "payload-budget-exhausted" };
        }
        if (
          row.consumed_journal_entries + row.journal_entries_per_sample >
            PROBE_RUN_BUDGET_LIMITS_V1.journalEntries
        ) {
          return { kind: "rejected", code: "journal-budget-exhausted" };
        }

        const identity = probeSampleIdentityV1(
          run.runId,
          run.scenario,
          run.dimensions,
          request.sampleOrdinal,
        );
        const codeId = identity.codeId;
        const addsCodeId = codeId !== null &&
          this.sql.exec<{ code_id: string }>(
              `SELECT code_id FROM probe_run_code_ids_v1 WHERE code_id = ?`,
              codeId,
            ).toArray().length === 0;
        if (
          addsCodeId &&
          row.consumed_unique_code_ids >= row.planned_unique_code_ids
        ) {
          return { kind: "rejected", code: "code-budget-exhausted" };
        }

        const phase: ProbeSamplePhase =
          request.sampleOrdinal < run.warmupRepetitions
            ? "warmup"
            : "measurement";
        const outstanding = row.outstanding_count + 1;
        this.sql.exec(
          `INSERT INTO probe_run_samples_v1 (
            sample_ordinal,
            phase,
            lifecycle_state,
            claim_token,
            observed_outstanding_claims
          ) VALUES (?, ?, 'claimed', ?, ?)`,
          request.sampleOrdinal,
          phase,
          claimToken,
          outstanding,
        );
        this.sql.exec(
          `UPDATE probe_run_samples_v1
           SET observed_outstanding_claims = MAX(
             observed_outstanding_claims,
             ?
           )
           WHERE lifecycle_state = 'claimed'`,
          outstanding,
        );
        if (addsCodeId && codeId !== null) {
          this.sql.exec(
            `INSERT INTO probe_run_code_ids_v1 (code_id, first_sample_ordinal)
             VALUES (?, ?)`,
            codeId,
            request.sampleOrdinal,
          );
        }
        this.sql.exec(
          `UPDATE probe_run_v1
           SET claimed_count = claimed_count + 1,
               outstanding_count = ?,
               high_water_outstanding = MAX(high_water_outstanding, ?),
               consumed_payload_bytes = consumed_payload_bytes + ?,
               consumed_journal_entries = consumed_journal_entries + ?,
               consumed_unique_code_ids = consumed_unique_code_ids + ?
           WHERE singleton = 1`,
          outstanding,
          outstanding,
          row.payload_bytes_per_sample,
          row.journal_entries_per_sample,
          addsCodeId ? 1 : 0,
        );
        return {
          kind: "claimed",
          run,
          phase,
          observedOutstandingClaims: outstanding,
        };
      },
    );
    if (result.kind === "rejected") {
      return rejectedClaim(result.code);
    }
    return ProbeSampleClaimReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "claimed",
      claimToken,
      run: result.run,
      sampleOrdinal: request.sampleOrdinal,
      phase: result.phase,
      observedOutstandingClaims: result.observedOutstandingClaims,
    });
  }

  async finalize(value: unknown): Promise<ProbeSampleFinalizeReceiptV1> {
    const request = decodeProbeSampleFinalizeRequestV1OrNull(value);
    if (request === null) return rejectedFinalize("invalid-request");
    if (!this.hasRunIdentity(request.runId)) {
      return rejectedFinalize("identity-mismatch");
    }
    const result = this.ctx.storage.transactionSync<FinalizeTransactionResult>(
      () => {
        const row = readRunRowOrNull(this.sql);
        if (row === null) {
          return { kind: "rejected", code: "run-not-registered" };
        }
        if (request.sampleOrdinal >= row.total_samples) {
          return { kind: "rejected", code: "sample-out-of-range" };
        }
        const run = decodeStoredRun(row.config_json);
        const sample = readSampleRowOrNull(this.sql, request.sampleOrdinal);
        if (sample === null) {
          return { kind: "rejected", code: "sample-not-claimed" };
        }
        if (sample.claim_token !== request.claimToken) {
          return { kind: "rejected", code: "claim-token-mismatch" };
        }
        if (
          !fragmentMatchesRegistration(
            request.fragment,
            run,
            request.sampleOrdinal,
          ) ||
          probeSyncWakeRelationshipIssueV1(
              request.fragment,
              request.syncWake,
            ) !== undefined
        ) {
          return { kind: "rejected", code: "identity-mismatch" };
        }
        const canonicalFinalization = canonicalFinalizeRequest(request);
        if (sample.lifecycle_state !== "claimed") {
          if (sample.finalization_json !== canonicalFinalization) {
            return { kind: "rejected", code: "finalization-conflict" };
          }
          const stored = decodeStoredControlledSample(
            sample.controlled_sample_json,
          );
          return { kind: "finalized", idempotent: true, sample: stored };
        }

        const phase = decodeStoredPhase(sample.phase);
        const disposition = measurementDisposition(phase, request.syncWake);
        const terminalState = request.fragment.outcome.kind === "ok"
          ? "completed"
          : "failed";
        const control = ProbeSampleControlV1Schema.make({
          phase,
          terminalState,
          measurementDisposition: disposition,
          configuredConcurrency: row.configured_concurrency,
          observedOutstandingClaims: sample.observed_outstanding_claims,
          scenarioWindowDurationMs: ProbeDurationMsSchema.make(
            request.scenarioWindowDurationMs,
          ),
          syncWake: request.syncWake,
          externalRequestIncludesControlPlane: true,
        });
        const controlled = controlledProbeGatewaySampleV1(
          request.fragment,
          control,
        );
        const controlledJson = JSON.stringify(controlled);
        this.sql.exec(
          `UPDATE probe_run_samples_v1
           SET lifecycle_state = ?,
               finalization_json = ?,
               controlled_sample_json = ?,
               measurement_disposition = ?,
               sync_wake_json = ?
           WHERE sample_ordinal = ? AND lifecycle_state = 'claimed'`,
          terminalState,
          canonicalFinalization,
          controlledJson,
          disposition,
          JSON.stringify(request.syncWake),
          request.sampleOrdinal,
        );
        const advanceOrderedOrdinal = isOrderedWakeScenario(run) &&
          request.syncWake.kind === "observed" &&
          (request.syncWake.disposition === "applied" ||
            request.syncWake.disposition === "duplicate");
        this.sql.exec(
          `UPDATE probe_run_v1
           SET terminal_count = terminal_count + 1,
               completed_count = completed_count + ?,
               failed_count = failed_count + ?,
               outstanding_count = outstanding_count - 1,
               eligible_count = eligible_count + ?,
               excluded_warmup_count = excluded_warmup_count + ?,
               excluded_duplicate_wake_count =
                 excluded_duplicate_wake_count + ?,
               next_ordered_ordinal = CASE WHEN ? = 1
                 THEN ?
                 ELSE next_ordered_ordinal
               END
           WHERE singleton = 1`,
          terminalState === "completed" ? 1 : 0,
          terminalState === "failed" ? 1 : 0,
          disposition === "eligible" ? 1 : 0,
          disposition === "excluded-warmup" ? 1 : 0,
          disposition === "excluded-duplicate-wake" ? 1 : 0,
          advanceOrderedOrdinal ? 1 : 0,
          request.sampleOrdinal + 1,
        );
        return { kind: "finalized", idempotent: false, sample: controlled };
      },
    );
    if (result.kind === "rejected") {
      return rejectedFinalize(result.code);
    }
    return ProbeSampleFinalizeReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      ...result,
    });
  }

  async status(value: unknown): Promise<ProbeRunStatusReceiptV1> {
    const request = decodeProbeRunStatusRequestV1OrNull(value);
    if (request === null || !this.hasRunIdentity(request.runId)) {
      return ProbeRunStatusReceiptV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        kind: "not-found",
      });
    }
    return readRunRowOrNull(this.sql) === null
      ? ProbeRunStatusReceiptV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          kind: "not-found",
        })
      : ProbeRunStatusReceiptV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          kind: "found",
          status: this.readStatus(),
        });
  }

  private hasRunIdentity(runId: ProbeRunRequestV1["runId"]): boolean {
    return this.ctx.id.name === probeRunActorId(runId);
  }

  private readStatus(): ProbeRunStatusV1 {
    const row = readRunRowOrNull(this.sql);
    if (row === null) throw new Error("probe run is not registered");
    const run = decodeStoredRun(row.config_json);
    const samples = this.sql.exec<SampleRow>(
      `SELECT sample_ordinal,
              phase,
              lifecycle_state,
              claim_token,
              observed_outstanding_claims,
              finalization_json,
              controlled_sample_json,
              measurement_disposition,
              sync_wake_json
       FROM probe_run_samples_v1
       ORDER BY sample_ordinal`,
    ).toArray().map(sampleStatusFromRow);
    const planned = probeRunBudgetPlanV1(run);
    return ProbeRunStatusV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      run,
      state: runState(row),
      budgets: ProbeRunBudgetsV1Schema.make({
        limits: PROBE_RUN_BUDGET_LIMITS_V1,
        planned,
        consumed: {
          sampleClaims: row.claimed_count,
          payloadBytes: row.consumed_payload_bytes,
          journalEntries: row.consumed_journal_entries,
          uniqueCodeIds: row.consumed_unique_code_ids,
        },
      }),
      counters: ProbeRunCountersV1Schema.make({
        claimed: row.claimed_count,
        terminal: row.terminal_count,
        completed: row.completed_count,
        failed: row.failed_count,
        outstanding: row.outstanding_count,
        highWaterOutstandingClaims: row.high_water_outstanding,
        eligible: row.eligible_count,
        excludedWarmup: row.excluded_warmup_count,
        excludedDuplicateWake: row.excluded_duplicate_wake_count,
      }),
      samples,
    });
  }
}

function initializeRunStorage(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_run_v1 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    config_json TEXT NOT NULL,
    total_samples INTEGER NOT NULL CHECK (total_samples > 0),
    configured_concurrency INTEGER NOT NULL
      CHECK (configured_concurrency > 0),
    payload_bytes_per_sample INTEGER NOT NULL
      CHECK (payload_bytes_per_sample >= 0),
    journal_entries_per_sample INTEGER NOT NULL
      CHECK (journal_entries_per_sample >= 0),
    planned_unique_code_ids INTEGER NOT NULL
      CHECK (planned_unique_code_ids >= 0),
    claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (claimed_count >= 0),
    terminal_count INTEGER NOT NULL DEFAULT 0 CHECK (terminal_count >= 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    outstanding_count INTEGER NOT NULL DEFAULT 0
      CHECK (outstanding_count >= 0),
    high_water_outstanding INTEGER NOT NULL DEFAULT 0
      CHECK (high_water_outstanding >= 0),
    consumed_payload_bytes INTEGER NOT NULL DEFAULT 0
      CHECK (consumed_payload_bytes >= 0),
    consumed_journal_entries INTEGER NOT NULL DEFAULT 0
      CHECK (consumed_journal_entries >= 0),
    consumed_unique_code_ids INTEGER NOT NULL DEFAULT 0
      CHECK (consumed_unique_code_ids >= 0),
    eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
    excluded_warmup_count INTEGER NOT NULL DEFAULT 0
      CHECK (excluded_warmup_count >= 0),
    excluded_duplicate_wake_count INTEGER NOT NULL DEFAULT 0
      CHECK (excluded_duplicate_wake_count >= 0),
    next_ordered_ordinal INTEGER NOT NULL DEFAULT 0
      CHECK (next_ordered_ordinal >= 0)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_run_samples_v1 (
    sample_ordinal INTEGER PRIMARY KEY CHECK (sample_ordinal >= 0),
    phase TEXT NOT NULL CHECK (phase IN ('warmup', 'measurement')),
    lifecycle_state TEXT NOT NULL
      CHECK (lifecycle_state IN ('claimed', 'completed', 'failed')),
    claim_token TEXT NOT NULL UNIQUE,
    observed_outstanding_claims INTEGER NOT NULL
      CHECK (observed_outstanding_claims > 0),
    finalization_json TEXT,
    controlled_sample_json TEXT,
    measurement_disposition TEXT
      CHECK (measurement_disposition IS NULL OR measurement_disposition IN (
        'eligible',
        'excluded-warmup',
        'excluded-duplicate-wake'
      )),
    sync_wake_json TEXT,
    CHECK (
      (lifecycle_state = 'claimed' AND
        finalization_json IS NULL AND
        controlled_sample_json IS NULL AND
        measurement_disposition IS NULL AND
        sync_wake_json IS NULL)
      OR
      (lifecycle_state IN ('completed', 'failed') AND
        finalization_json IS NOT NULL AND
        controlled_sample_json IS NOT NULL AND
        measurement_disposition IS NOT NULL AND
        sync_wake_json IS NOT NULL)
    )
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_run_code_ids_v1 (
    code_id TEXT PRIMARY KEY,
    first_sample_ordinal INTEGER NOT NULL CHECK (first_sample_ordinal >= 0)
  )`);
}

function readRunRowOrNull(sql: SqlStorage): RunRow | null {
  return sql.exec<RunRow>(
    `SELECT config_json,
            total_samples,
            configured_concurrency,
            payload_bytes_per_sample,
            journal_entries_per_sample,
            planned_unique_code_ids,
            claimed_count,
            terminal_count,
            completed_count,
            failed_count,
            outstanding_count,
            high_water_outstanding,
            consumed_payload_bytes,
            consumed_journal_entries,
            consumed_unique_code_ids,
            eligible_count,
            excluded_warmup_count,
            excluded_duplicate_wake_count,
            next_ordered_ordinal
     FROM probe_run_v1
     WHERE singleton = 1`,
  ).toArray()[0] ?? null;
}

function readSampleRowOrNull(
  sql: SqlStorage,
  sampleOrdinal: ProbeOrdinal,
): SampleRow | null {
  return sql.exec<SampleRow>(
    `SELECT sample_ordinal,
            phase,
            lifecycle_state,
            claim_token,
            observed_outstanding_claims,
            finalization_json,
            controlled_sample_json,
            measurement_disposition,
            sync_wake_json
     FROM probe_run_samples_v1
     WHERE sample_ordinal = ?`,
    sampleOrdinal,
  ).toArray()[0] ?? null;
}

function decodeStoredRun(configJson: string): ProbeRunRequestV1 {
  const decoded = decodeProbeRunRequestV1OrNull(JSON.parse(configJson));
  if (decoded === null) throw new Error("stored probe run is invalid");
  return decoded;
}

function decodeStoredControlledSample(value: string | null) {
  if (value === null) throw new Error("terminal probe sample is missing");
  const decoded = decodeProbeControlledGatewaySampleV1OrNull(JSON.parse(value));
  if (decoded === null) throw new Error("stored controlled sample is invalid");
  return decoded;
}

function decodeStoredPhase(value: string): ProbeSamplePhase {
  if (value === "warmup" || value === "measurement") return value;
  throw new Error("stored probe sample phase is invalid");
}

function decodeStoredDisposition(value: string): ProbeMeasurementDisposition {
  if (
    value === "eligible" ||
    value === "excluded-warmup" ||
    value === "excluded-duplicate-wake"
  ) {
    return value;
  }
  throw new Error("stored probe measurement disposition is invalid");
}

function decodeStoredSyncWake(value: string): ProbeSyncWakeObservationV1 {
  const decoded = decodeProbeSyncWakeObservationV1OrNull(JSON.parse(value));
  if (decoded === null) {
    throw new Error("stored sync wake observation is invalid");
  }
  return decoded;
}

function sampleStatusFromRow(row: SampleRow): ProbeRunSampleStatusV1 {
  const sampleOrdinal = ProbeOrdinalSchema.make(row.sample_ordinal);
  const phase = decodeStoredPhase(row.phase);
  if (row.lifecycle_state === "claimed") {
    return ProbeRunSampleStatusV1Schema.make({
      sampleOrdinal,
      phase,
      state: "claimed",
      observedOutstandingClaims: row.observed_outstanding_claims,
      measurementDisposition: null,
      syncWake: null,
    });
  }
  if (
    (row.lifecycle_state !== "completed" && row.lifecycle_state !== "failed") ||
    row.measurement_disposition === null ||
    row.sync_wake_json === null
  ) {
    throw new Error("stored terminal probe sample is invalid");
  }
  return ProbeRunSampleStatusV1Schema.make({
    sampleOrdinal,
    phase,
    state: row.lifecycle_state,
    observedOutstandingClaims: row.observed_outstanding_claims,
    measurementDisposition: decodeStoredDisposition(
      row.measurement_disposition,
    ),
    syncWake: decodeStoredSyncWake(row.sync_wake_json),
  });
}

function fragmentMatchesRegistration(
  fragment: Parameters<typeof controlledProbeGatewaySampleV1>[0],
  run: ProbeRunRequestV1,
  sampleOrdinal: ProbeOrdinal,
): boolean {
  return fragment.protocolVersion === run.protocolVersion &&
    fragment.runId === run.runId &&
    fragment.scenario === run.scenario &&
    fragment.identity.sampleOrdinal === sampleOrdinal &&
    canonicalDimensions(fragment.dimensions) ===
      canonicalDimensions(run.dimensions);
}

function canonicalDimensions(dimensions: ProbeRunRequestV1["dimensions"]): string {
  return JSON.stringify([
    dimensions.codeMode,
    dimensions.concurrency,
    dimensions.journalEntries,
    dimensions.payloadBytes,
    dimensions.sessionMode,
  ]);
}

function canonicalFinalizeRequest(
  request: NonNullable<
    ReturnType<typeof decodeProbeSampleFinalizeRequestV1OrNull>
  >,
): string {
  return JSON.stringify({
    protocolVersion: request.protocolVersion,
    runId: request.runId,
    sampleOrdinal: request.sampleOrdinal,
    claimToken: request.claimToken,
    fragment: request.fragment,
    scenarioWindowDurationMs: request.scenarioWindowDurationMs,
    syncWake: request.syncWake,
  });
}

function measurementDisposition(
  phase: ProbeSamplePhase,
  syncWake: ProbeSyncWakeObservationV1,
): ProbeMeasurementDisposition {
  if (phase === "warmup") return "excluded-warmup";
  return syncWake.kind === "observed" &&
      syncWake.disposition === "duplicate"
    ? "excluded-duplicate-wake"
    : "eligible";
}

function isOrderedWakeScenario(run: ProbeRunRequestV1): boolean {
  return run.scenario === "commit_wake" || run.scenario === "full_invoke";
}

function runState(row: RunRow): ProbeRunStatusV1["state"] {
  if (row.claimed_count === 0) return "registered";
  if (row.terminal_count === row.total_samples) return "complete";
  if (row.outstanding_count > 0) return "outstanding-claims";
  return "partial";
}

function withinRunBudgetLimits(plan: ProbeRunBudgetValuesV1): boolean {
  return plan.sampleClaims <= PROBE_RUN_BUDGET_LIMITS_V1.sampleClaims &&
    plan.payloadBytes <= PROBE_RUN_BUDGET_LIMITS_V1.payloadBytes &&
    plan.journalEntries <= PROBE_RUN_BUDGET_LIMITS_V1.journalEntries &&
    plan.uniqueCodeIds <= PROBE_RUN_BUDGET_LIMITS_V1.uniqueCodeIds;
}

function budgetError(plan: ProbeRunBudgetValuesV1): ProbeRunStateErrorCode {
  if (plan.sampleClaims > PROBE_RUN_BUDGET_LIMITS_V1.sampleClaims) {
    return "sample-budget-exhausted";
  }
  if (plan.payloadBytes > PROBE_RUN_BUDGET_LIMITS_V1.payloadBytes) {
    return "payload-budget-exhausted";
  }
  if (plan.journalEntries > PROBE_RUN_BUDGET_LIMITS_V1.journalEntries) {
    return "journal-budget-exhausted";
  }
  return "code-budget-exhausted";
}

function retryableStateError(code: ProbeRunStateErrorCode): boolean {
  return code === "concurrency-limit";
}

function rejectedRegistration(
  code: ProbeRunStateErrorCode,
): ProbeRunRegistrationReceiptV1 {
  return ProbeRunRegistrationReceiptV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    kind: "rejected",
    error: { code, retryable: retryableStateError(code) },
  });
}

function rejectedClaim(code: ProbeRunStateErrorCode): ProbeSampleClaimReceiptV1 {
  return ProbeSampleClaimReceiptV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    kind: "rejected",
    error: { code, retryable: retryableStateError(code) },
  });
}

function rejectedFinalize(
  code: ProbeRunStateErrorCode,
): ProbeSampleFinalizeReceiptV1 {
  return ProbeSampleFinalizeReceiptV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    kind: "rejected",
    error: { code, retryable: retryableStateError(code) },
  });
}

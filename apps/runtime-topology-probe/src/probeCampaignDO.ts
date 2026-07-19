import { DurableObject } from "cloudflare:workers";
import { compareUtf16Strings } from "@flarex/utils/strings";

import {
  canonicalProbeCampaignManifestV1,
  decodeProbeCampaignControlRequestV1OrNull,
  decodeProbeCampaignManifestV1OrNull,
  decodeProbeCampaignPurgeRequestV1OrNull,
  probeCampaignBudgetPlanV1,
  PROBE_CAMPAIGN_BUDGET_LIMIT_VALUES_V1,
  ProbeCampaignBudgetsV1Schema,
  ProbeCampaignControlReceiptV1Schema,
  ProbeCampaignProgressV1Schema,
  ProbeCampaignRegistrationReceiptV1Schema,
  ProbeCampaignStatusReceiptV1Schema,
  ProbeCampaignStatusV1Schema,
  type ProbeCampaignControlReceiptV1,
  type ProbeCampaignErrorCodeV1,
  type ProbeCampaignManifestV1,
  type ProbeCampaignRegistrationReceiptV1,
  type ProbeCampaignStateV1,
  type ProbeCampaignStatusReceiptV1,
  type ProbeCampaignStatusV1,
} from "./campaignProtocol";
import { copyCloudflareRpcRecord } from "./effectBoundary";
import { sha256Hex } from "./sha256";
import {
  PROBE_CAMPAIGN_ACTOR_NAME,
  probeRunActorId,
  probeScopeId,
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeOrdinalSchema,
  ProbeSessionIdSchema,
  ProbeScopeIdSchema,
  type ProbeAttemptId,
  type ProbeCodeId,
  type ProbeRunId,
  type ProbeSessionId,
  type ProbeScopeId,
} from "./identity";
import type { MockPurgeEntrypoint } from "./mockCommitWorker";
import {
  PROBE_PROTOCOL_VERSION_V1,
  probeSampleIdentityV1,
  type ProbeScenario,
} from "./protocol";
import type { ProbeRunDO } from "./probeRunDO";
import {
  decodeProbeRunControlReceiptV1OrNull,
  decodeProbeRunEvidencePageReceiptV1OrNull,
  decodeProbeRunRegistrationReceiptV1OrNull,
  probeRunEvidencePageReceiptMatchesRequestV1,
  ProbeRunControlRequestV1Schema,
  ProbeRunEvidencePageRequestV1Schema,
  type ProbeRunEvidenceRecordV1,
} from "./runProtocol";
import type { ProbeSessionDO } from "./sessionDO";
import {
  decodeProbeRunPurgeReceiptV1OrNull,
  decodeProbeSessionPurgeReceiptV1OrNull,
  decodeProbeSyncPurgeReceiptV1OrNull,
  ProbeRunPurgeRequestV1Schema,
  ProbeSessionPurgeRequestV1Schema,
  ProbeSyncPurgeRequestV1Schema,
} from "./purgeProtocol";

interface CampaignRow {
  readonly [key: string]: SqlStorageValue;
  readonly manifest_json: string;
  readonly manifest_sha256: string;
  readonly state: string;
  readonly evidence_record_count: number | null;
  readonly evidence_sha256: string | null;
}

interface CampaignRunRow {
  readonly [key: string]: SqlStorageValue;
  readonly run_id: string;
  readonly run_json: string;
  readonly registered: number;
  readonly sealed: number;
  readonly reconciled: number;
  readonly evidence_frozen: number;
}

interface PurgeTaskRow {
  readonly [key: string]: SqlStorageValue;
  readonly task_order: number;
  readonly target_kind: string;
  readonly target_id: string;
  readonly request_json: string;
  readonly task_state: string;
}

type PurgeTargetKind = "run" | "session" | "sync";
type PurgeTaskOutcome = "done" | "failed" | "pending";

export interface ProbeCampaignEnv {
  readonly PROBE_RUNS: DurableObjectNamespace<ProbeRunDO>;
  readonly PROBE_SESSIONS: DurableObjectNamespace<ProbeSessionDO>;
  readonly MOCK_PURGE?: Service<typeof MockPurgeEntrypoint>;
}

export class ProbeCampaignDO extends DurableObject<ProbeCampaignEnv> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: ProbeCampaignEnv) {
    super(ctx, env);
    initializeCampaignStorage(this.sql);
  }

  async register(
    value: unknown,
  ): Promise<ProbeCampaignRegistrationReceiptV1> {
    const manifest = decodeProbeCampaignManifestV1OrNull(value);
    if (manifest === null) return rejectedRegistration("invalid-request");
    if (!this.hasFixedIdentity()) {
      return rejectedRegistration("identity-mismatch");
    }
    const canonical = canonicalProbeCampaignManifestV1(manifest);
    const digest = await sha256Hex(canonical);
    const creation = this.ctx.storage.transactionSync(() => {
      const existing = readCampaignRowOrNull(this.sql);
      if (existing !== null) {
        return existing.manifest_json === canonical &&
            existing.manifest_sha256 === digest
          ? "existing" as const
          : "conflict" as const;
      }
      this.sql.exec(
        `INSERT INTO probe_campaign_v1 (
          singleton, manifest_json, manifest_sha256, state
        ) VALUES (1, ?, ?, 'registering')`,
        canonical,
        digest,
      );
      for (const run of manifest.runs) {
        this.sql.exec(
          `INSERT INTO probe_campaign_runs_v1 (run_id, run_json)
           VALUES (?, ?)`,
          run.runId,
          JSON.stringify(run),
        );
      }
      insertPurgeTasks(this.sql, manifest);
      return "created" as const;
    });
    if (creation === "conflict") {
      return rejectedRegistration("manifest-conflict");
    }
    const state = readCampaignState(this.sql);
    const registrationsComplete = campaignRegistrationsComplete(this.sql);
    if (
      creation === "existing" &&
      state !== "registering" &&
      registrationsComplete
    ) {
      return ProbeCampaignRegistrationReceiptV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        kind: "registered",
        created: false,
        status: this.readStatus(),
      });
    }
    const registered = await this.drainRegistrations(manifest);
    if (!registered) {
      return rejectedRegistration("registration-incomplete");
    }
    await this.ctx.storage.sync();
    return ProbeCampaignRegistrationReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "registered",
      created: creation === "created",
      status: this.readStatus(),
    });
  }

  async status(value: unknown): Promise<ProbeCampaignStatusReceiptV1> {
    const request = decodeProbeCampaignControlRequestV1OrNull(value);
    const row = readCampaignRowOrNull(this.sql);
    if (
      request === null ||
      row === null ||
      !this.hasFixedIdentity() ||
      decodeStoredManifest(row.manifest_json).campaignId !== request.campaignId
    ) {
      return ProbeCampaignStatusReceiptV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        kind: "not-found",
      });
    }
    return ProbeCampaignStatusReceiptV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      kind: "found",
      status: this.readStatus(),
    });
  }

  async reconcile(value: unknown): Promise<ProbeCampaignControlReceiptV1> {
    const request = decodeProbeCampaignControlRequestV1OrNull(value);
    const manifest = this.validatedManifestFor(request?.campaignId);
    if (request === null) return rejectedControl("invalid-request");
    if (manifest === null) return rejectedControl("campaign-not-registered");
    const state = readCampaignState(this.sql);
    if (state === "purging" || state === "purged") {
      return rejectedControl("campaign-not-running");
    }
    if (state === "evidence-sealed") {
      return acceptedControl(this.readStatus());
    }
    if (
      !campaignRegistrationsComplete(this.sql) &&
      !(await this.drainRegistrations(manifest))
    ) {
      return rejectedControl("reconciliation-incomplete");
    }
    if (!(await this.drainRunControl(manifest, "seal"))) {
      return rejectedControl("reconciliation-incomplete");
    }
    if (!(await this.drainRunControl(manifest, "reconcile"))) {
      return rejectedControl("reconciliation-incomplete");
    }
    await this.ctx.storage.sync();
    return acceptedControl(this.readStatus());
  }

  async sealEvidence(value: unknown): Promise<ProbeCampaignControlReceiptV1> {
    const request = decodeProbeCampaignControlRequestV1OrNull(value);
    const manifest = this.validatedManifestFor(request?.campaignId);
    if (request === null) return rejectedControl("invalid-request");
    if (manifest === null) return rejectedControl("campaign-not-registered");
    const state = readCampaignState(this.sql);
    if (state === "evidence-sealed") {
      return acceptedControl(this.readStatus());
    }
    if (state !== "reconciled") {
      return rejectedControl("campaign-not-reconciled");
    }
    if (!(await this.drainRunControl(manifest, "freeze-evidence"))) {
      return rejectedControl("reconciliation-incomplete");
    }
    const evidence = await this.readAllEvidence(manifest);
    if (evidence === null) return rejectedControl("target-rejected");
    const digest = await sha256Hex(JSON.stringify(evidence));
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE probe_campaign_v1
         SET state = 'evidence-sealed',
             evidence_record_count = ?,
             evidence_sha256 = ?
         WHERE singleton = 1`,
        evidence.length,
        digest,
      );
    });
    await this.ctx.storage.sync();
    return acceptedControl(this.readStatus());
  }

  async purge(value: unknown): Promise<ProbeCampaignControlReceiptV1> {
    const request = decodeProbeCampaignPurgeRequestV1OrNull(value);
    const manifest = this.validatedManifestFor(request?.campaignId);
    if (request === null) return rejectedControl("invalid-request");
    if (manifest === null) return rejectedControl("campaign-not-registered");
    const state = readCampaignState(this.sql);
    if (state === "purged") return acceptedControl(this.readStatus());
    if (state !== "evidence-sealed" && state !== "purging") {
      return rejectedControl("evidence-not-sealed");
    }
    this.sql.exec(
      "UPDATE probe_campaign_v1 SET state = 'purging' WHERE singleton = 1",
    );
    const tasks = this.sql.exec<PurgeTaskRow>(
      `SELECT task_order, target_kind, target_id, request_json, task_state
       FROM probe_campaign_purge_tasks_v1
       WHERE task_state <> 'done'
       ORDER BY task_order
       LIMIT ?`,
      request.maxTasks,
    ).toArray();
    for (const task of tasks) {
      this.sql.exec(
        `UPDATE probe_campaign_purge_tasks_v1
         SET task_state = 'in-progress'
         WHERE task_order = ? AND task_state <> 'done'`,
        task.task_order,
      );
      const outcome = await this.executePurgeTask(task);
      if (outcome === "failed") {
        await this.ctx.storage.sync();
        return rejectedControl("purge-incomplete");
      }
      if (outcome === "pending") {
        await this.ctx.storage.sync();
        return acceptedControl(this.readStatus());
      }
      this.sql.exec(
        `UPDATE probe_campaign_purge_tasks_v1
         SET task_state = 'done'
         WHERE task_order = ?`,
        task.task_order,
      );
      await this.ctx.storage.sync();
    }
    const remaining = this.sql.exec<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM probe_campaign_purge_tasks_v1
       WHERE task_state <> 'done'`,
    ).one().count;
    if (remaining === 0) {
      this.sql.exec(
        "UPDATE probe_campaign_v1 SET state = 'purged' WHERE singleton = 1",
      );
      await this.ctx.storage.sync();
    }
    return acceptedControl(this.readStatus());
  }

  private hasFixedIdentity(): boolean {
    return this.ctx.id.name === PROBE_CAMPAIGN_ACTOR_NAME;
  }

  private validatedManifestFor(
    campaignId: ProbeCampaignManifestV1["campaignId"] | undefined,
  ): ProbeCampaignManifestV1 | null {
    if (!this.hasFixedIdentity() || campaignId === undefined) return null;
    const row = readCampaignRowOrNull(this.sql);
    if (row === null) return null;
    const manifest = decodeStoredManifest(row.manifest_json);
    return manifest.campaignId === campaignId ? manifest : null;
  }

  private async drainRegistrations(
    manifest: ProbeCampaignManifestV1,
  ): Promise<boolean> {
    const pending = readCampaignRunRows(this.sql)
      .filter(row => row.registered !== 1);
    for (const row of pending) {
      const run = manifest.runs.find(candidate => candidate.runId === row.run_id);
      if (run === undefined) return false;
      try {
        const raw = await this.env.PROBE_RUNS.getByName(
          probeRunActorId(run.runId),
        ).register(run);
        const receipt = decodeProbeRunRegistrationReceiptV1OrNull(
          copyCloudflareRpcRecord(raw),
        );
        if (
          receipt === null ||
          receipt.kind !== "registered" ||
          receipt.status.run.runId !== run.runId
        ) {
          return false;
        }
      } catch {
        return false;
      }
      this.sql.exec(
        `UPDATE probe_campaign_runs_v1 SET registered = 1 WHERE run_id = ?`,
        run.runId,
      );
      await this.ctx.storage.sync();
    }
    this.sql.exec(
      `UPDATE probe_campaign_v1
       SET state = 'running'
       WHERE singleton = 1 AND state = 'registering'`,
    );
    return true;
  }

  private async drainRunControl(
    manifest: ProbeCampaignManifestV1,
    operation: "freeze-evidence" | "reconcile" | "seal",
  ): Promise<boolean> {
    const column = operation === "seal"
      ? "sealed"
      : operation === "reconcile"
      ? "reconciled"
      : "evidence_frozen";
    const state: ProbeCampaignStateV1 = operation === "seal"
      ? "sealing"
      : operation === "reconcile"
      ? "reconciling"
      : "reconciled";
    this.sql.exec(
      "UPDATE probe_campaign_v1 SET state = ? WHERE singleton = 1",
      state,
    );
    const pending = readCampaignRunRows(this.sql)
      .filter(row => row[column] !== 1);
    for (const row of pending) {
      const run = manifest.runs.find(candidate => candidate.runId === row.run_id);
      if (run === undefined) return false;
      const controlRequest = ProbeRunControlRequestV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId: run.runId,
        operation,
      });
      try {
        const raw = await this.env.PROBE_RUNS.getByName(
          probeRunActorId(run.runId),
        ).control(controlRequest);
        const receipt = decodeProbeRunControlReceiptV1OrNull(
          copyCloudflareRpcRecord(raw),
        );
        if (
          receipt === null ||
          receipt.kind !== "accepted" ||
          receipt.status.run.runId !== run.runId
        ) {
          return false;
        }
      } catch {
        return false;
      }
      this.sql.exec(
        `UPDATE probe_campaign_runs_v1 SET ${column} = 1 WHERE run_id = ?`,
        run.runId,
      );
      await this.ctx.storage.sync();
    }
    if (operation === "reconcile") {
      this.sql.exec(
        "UPDATE probe_campaign_v1 SET state = 'reconciled' WHERE singleton = 1",
      );
    }
    return true;
  }

  private async readAllEvidence(
    manifest: ProbeCampaignManifestV1,
  ): Promise<readonly ProbeRunEvidenceRecordV1[] | null> {
    const records: ProbeRunEvidenceRecordV1[] = [];
    for (const run of manifest.runs) {
      let cursor = ProbeOrdinalSchema.make(0);
      while (true) {
        const request = ProbeRunEvidencePageRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
          cursor,
          limit: 100,
        });
        let receipt;
        try {
          const raw = await this.env.PROBE_RUNS.getByName(
            probeRunActorId(run.runId),
          ).evidencePage(request);
          receipt = decodeProbeRunEvidencePageReceiptV1OrNull(
            copyCloudflareRpcRecord(raw),
          );
        } catch {
          return null;
        }
        if (
          receipt === null ||
          receipt.kind !== "page" ||
          !probeRunEvidencePageReceiptMatchesRequestV1(receipt, request, run)
        ) {
          return null;
        }
        records.push(...receipt.records);
        if (receipt.nextCursor === null) break;
        cursor = receipt.nextCursor;
      }
    }
    return records;
  }

  private async executePurgeTask(
    task: PurgeTaskRow,
  ): Promise<PurgeTaskOutcome> {
    const kind = decodePurgeTargetKind(task.target_kind);
    try {
      switch (kind) {
        case "session": {
          const request = ProbeSessionPurgeRequestV1Schema.make(
            JSON.parse(task.request_json),
          );
          const raw = await this.env.PROBE_SESSIONS.getByName(request.sessionId)
            .purge(request);
          const receipt = decodeProbeSessionPurgeReceiptV1OrNull(
            copyCloudflareRpcRecord(raw),
          );
          if (receipt === null || receipt.sessionId !== request.sessionId) {
            return "failed";
          }
          return receipt.kind === "in-progress" ? "pending" : "done";
        }
        case "sync": {
          const mockPurge = this.env.MOCK_PURGE;
          if (mockPurge === undefined) return "failed";
          const request = ProbeSyncPurgeRequestV1Schema.make(
            JSON.parse(task.request_json),
          );
          const raw = await mockPurge.purge(request);
          const receipt = decodeProbeSyncPurgeReceiptV1OrNull(
            copyCloudflareRpcRecord(raw),
          );
          return receipt !== null &&
            receipt.scopeId === request.scopeId &&
            receipt.probeDataCleared === true &&
            receipt.completionTombstoneRetained === true
            ? "done"
            : "failed";
        }
        case "run": {
          const request = ProbeRunPurgeRequestV1Schema.make(
            JSON.parse(task.request_json),
          );
          const raw = await this.env.PROBE_RUNS.getByName(
            probeRunActorId(request.runId),
          ).purge(request);
          const receipt = decodeProbeRunPurgeReceiptV1OrNull(
            copyCloudflareRpcRecord(raw),
          );
          return receipt !== null && receipt.runId === request.runId &&
              receipt.storageCleared === true
            ? "done"
            : "failed";
        }
      }
    } catch {
      return "failed";
    }
  }

  private readStatus(): ProbeCampaignStatusV1 {
    const row = readCampaignRowOrNull(this.sql);
    if (row === null) throw new Error("probe campaign is not registered");
    const manifest = decodeStoredManifest(row.manifest_json);
    const runs = readCampaignRunRows(this.sql);
    const purge = this.sql.exec<{ total: number; completed: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN task_state = 'done' THEN 1 ELSE 0 END) AS completed
       FROM probe_campaign_purge_tasks_v1`,
    ).one();
    const planned = probeCampaignBudgetPlanV1(manifest);
    return ProbeCampaignStatusV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      manifest,
      manifestSha256: row.manifest_sha256,
      state: decodeCampaignState(row.state),
      budgets: ProbeCampaignBudgetsV1Schema.make({
        limits: PROBE_CAMPAIGN_BUDGET_LIMIT_VALUES_V1,
        planned,
      }),
      progress: ProbeCampaignProgressV1Schema.make({
        totalRegistrationTasks: runs.length,
        completedRegistrationTasks: runs.filter(run => run.registered === 1)
          .length,
        totalReconciliationTasks: runs.length,
        completedReconciliationTasks: runs.filter(
          run => run.reconciled === 1,
        ).length,
        totalPurgeTasks: purge.total,
        completedPurgeTasks: purge.completed ?? 0,
      }),
      evidence: row.evidence_record_count === null ||
          row.evidence_sha256 === null
        ? null
        : {
            recordCount: row.evidence_record_count,
            sha256: row.evidence_sha256,
          },
    });
  }
}

function initializeCampaignStorage(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_campaign_v1 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    manifest_json TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'registering', 'running', 'sealing', 'reconciling', 'reconciled',
      'evidence-sealed', 'purging', 'purged'
    )),
    evidence_record_count INTEGER CHECK (
      evidence_record_count IS NULL OR evidence_record_count >= 0
    ),
    evidence_sha256 TEXT
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_campaign_runs_v1 (
    run_id TEXT PRIMARY KEY,
    run_json TEXT NOT NULL,
    registered INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0, 1)),
    sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
    reconciled INTEGER NOT NULL DEFAULT 0 CHECK (reconciled IN (0, 1)),
    evidence_frozen INTEGER NOT NULL DEFAULT 0
      CHECK (evidence_frozen IN (0, 1))
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_campaign_purge_tasks_v1 (
    task_order INTEGER PRIMARY KEY CHECK (task_order >= 0),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('session', 'sync', 'run')),
    target_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    task_state TEXT NOT NULL DEFAULT 'pending'
      CHECK (task_state IN ('pending', 'in-progress', 'done')),
    UNIQUE (target_kind, target_id)
  )`);
}

function insertPurgeTasks(
  sql: SqlStorage,
  manifest: ProbeCampaignManifestV1,
): void {
  const sessions = new Map<
    ProbeSessionId,
    Map<
      ProbeAttemptId,
      { readonly codeId: ProbeCodeId; readonly scenario: ProbeScenario }
    >
  >();
  const syncScopes = new Set<ProbeScopeId>();
  for (const run of manifest.runs) {
    const total = run.warmupRepetitions + run.repetitions;
    for (let value = 0; value < total; value += 1) {
      const identity = probeSampleIdentityV1(
        run.runId,
        run.scenario,
        run.dimensions,
        ProbeOrdinalSchema.make(value),
      );
      if (identity.sessionId !== null) {
        const attempts = sessions.get(identity.sessionId) ??
          new Map<
            ProbeAttemptId,
            { readonly codeId: ProbeCodeId; readonly scenario: ProbeScenario }
          >();
        if (identity.attemptId !== null && identity.codeId !== null) {
          const facetId = identity.facetId ?? identity.attemptId;
          attempts.set(facetId, {
            codeId: identity.codeId,
            scenario: run.scenario,
          });
        }
        sessions.set(identity.sessionId, attempts);
      }
    }
    if (
      run.scenario === "commit_wake" ||
      run.scenario === "full_invoke" ||
      run.scenario === "executor_worker_invoke" ||
      run.scenario === "facet_executor_invoke" ||
      run.scenario === "facet_finalizer_invoke" ||
      run.scenario === "facet_finalizer_warm_invoke" ||
      run.scenario === "facet_finalizer_postgres_warm_invoke" ||
      run.scenario === "session_executor_invoke" ||
      run.scenario === "sync_rerun"
    ) {
      syncScopes.add(probeScopeId(run.runId));
    }
  }

  let order = 0;
  const sortedSessions = [...sessions.entries()]
    .sort(([left], [right]) => compareUtf16Strings(left, right));
  for (const [sessionId, attempts] of sortedSessions) {
    const facets = [...attempts.entries()]
      .sort(([left], [right]) => compareUtf16Strings(left, right))
      .map(([attemptId, facet]) => ({
        attemptId: ProbeAttemptIdSchema.make(attemptId),
        codeId: ProbeCodeIdSchema.make(facet.codeId),
        scenario: facet.scenario,
      }));
    const request = ProbeSessionPurgeRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      sessionId: ProbeSessionIdSchema.make(sessionId),
      facets,
    });
    insertPurgeTask(sql, order, "session", sessionId, request);
    order += 1;
  }
  for (const scopeId of [...syncScopes].sort(compareUtf16Strings)) {
    const request = ProbeSyncPurgeRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      scopeId: ProbeScopeIdSchema.make(scopeId),
    });
    insertPurgeTask(sql, order, "sync", scopeId, request);
    order += 1;
  }
  for (const run of manifest.runs) {
    const request = ProbeRunPurgeRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
    });
    insertPurgeTask(sql, order, "run", run.runId, request);
    order += 1;
  }
}

function insertPurgeTask(
  sql: SqlStorage,
  order: number,
  kind: PurgeTargetKind,
  targetId: string,
  request: object,
): void {
  sql.exec(
    `INSERT INTO probe_campaign_purge_tasks_v1 (
      task_order, target_kind, target_id, request_json
    ) VALUES (?, ?, ?, ?)`,
    order,
    kind,
    targetId,
    JSON.stringify(request),
  );
}

function readCampaignRowOrNull(sql: SqlStorage): CampaignRow | null {
  return sql.exec<CampaignRow>(
    `SELECT manifest_json, manifest_sha256, state,
            evidence_record_count, evidence_sha256
     FROM probe_campaign_v1
     WHERE singleton = 1`,
  ).toArray()[0] ?? null;
}

function readCampaignRunRows(sql: SqlStorage): readonly CampaignRunRow[] {
  return sql.exec<CampaignRunRow>(
    `SELECT run_id, run_json, registered, sealed, reconciled, evidence_frozen
     FROM probe_campaign_runs_v1
     ORDER BY run_id`,
  ).toArray();
}

function campaignRegistrationsComplete(sql: SqlStorage): boolean {
  return readCampaignRunRows(sql).every(row => row.registered === 1);
}

function decodeStoredManifest(value: string): ProbeCampaignManifestV1 {
  const manifest = decodeProbeCampaignManifestV1OrNull(JSON.parse(value));
  if (manifest === null) throw new Error("stored probe campaign is invalid");
  return manifest;
}

function readCampaignState(sql: SqlStorage): ProbeCampaignStateV1 {
  const row = readCampaignRowOrNull(sql);
  if (row === null) throw new Error("probe campaign is not registered");
  return decodeCampaignState(row.state);
}

function decodeCampaignState(value: string): ProbeCampaignStateV1 {
  switch (value) {
    case "registering":
    case "running":
    case "sealing":
    case "reconciling":
    case "reconciled":
    case "evidence-sealed":
    case "purging":
    case "purged":
      return value;
    default:
      throw new Error("stored probe campaign state is invalid");
  }
}

function decodePurgeTargetKind(value: string): PurgeTargetKind {
  if (value === "session" || value === "sync" || value === "run") {
    return value;
  }
  throw new Error("stored purge target kind is invalid");
}

function retryableCampaignError(code: ProbeCampaignErrorCodeV1): boolean {
  return code === "registration-incomplete" ||
    code === "reconciliation-incomplete" ||
    code === "purge-incomplete";
}

function rejectedRegistration(
  code: ProbeCampaignErrorCodeV1,
): ProbeCampaignRegistrationReceiptV1 {
  return ProbeCampaignRegistrationReceiptV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    kind: "rejected",
    error: { code, retryable: retryableCampaignError(code) },
  });
}

function rejectedControl(
  code: ProbeCampaignErrorCodeV1,
): ProbeCampaignControlReceiptV1 {
  return ProbeCampaignControlReceiptV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    kind: "rejected",
    error: { code, retryable: retryableCampaignError(code) },
  });
}

function acceptedControl(
  status: ProbeCampaignStatusV1,
): ProbeCampaignControlReceiptV1 {
  return ProbeCampaignControlReceiptV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    kind: "accepted",
    status,
  });
}

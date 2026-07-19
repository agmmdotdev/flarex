import { DurableObject } from "cloudflare:workers";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Effect, Result } from "effect";

import {
  copyCloudflareRpcRecord,
  protocolValueOrNull,
} from "./effectBoundary";
import {
  decodeProbeMockFinishResponseV1OrNull,
  decodeProbeMockReadRequestV1OrNull,
  decodeProbeMockReadResponseV1OrNull,
  decodeProbeSyncWakeReceiptV1OrNull,
  ProbeMockFinishRequestV1Schema,
  ProbeMockFinishResponseV1Schema,
  ProbeMockReadResponseV1Schema,
  ProbeSyntheticCursorSchema,
  ProbeSyncWakeRequestV1Schema,
  type ProbeMockFinishRequestV1,
  type ProbeMockFinishResponseV1,
  type ProbeMockReadRequestV1,
  type ProbeMockReadResponseV1,
} from "./commitProtocol";
import {
  decodeProbeFacetInvokeRequestV1Effect,
  decodeProbeFacetLifecycleRequestV1Effect,
  decodeProbeFacetLifecycleWorkerResponseV1Effect,
  decodeProbeFacetWorkerResponseV1Effect,
  probeFacetReceiptMatchesRequest,
  probeFacetWorkerCode,
  PROBE_FACET_CLASS_NAME,
  ProbeFacetLifecycleSessionResponseV1Schema,
  ProbeFacetSessionResponseV1Schema,
  type ProbeFacetInvokeRequestV1,
  type ProbeFacetLifecycleRequestV1,
  type ProbeFacetLifecycleWorkerResponseV1,
  type ProbeFacetWorkerResponseV1,
} from "./facetProtocol";
import {
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeSessionIdSchema,
  type ProbeSessionId,
} from "./identity";
import {
  isJsonContentType,
  noStoreJson,
  readBoundedJson,
} from "./http";
import { elapsedPerformanceDurationSince } from "./performanceDuration";
import {
  decodeProbeInvokeFacetRequestV1OrNull,
  decodeProbeInvokeFacetWorkerResponseV1OrNull,
  decodeProbeFullInvokeSessionFailureV1OrNull,
  probeMockReadRequestFromInvoke,
  probeMockReadReceiptMatchesRequestV1,
  probeFacetFinalizerWorkerCode,
  probeInvokeFacetReceiptMatchesRequestV1,
  probeInvokeWorkerCode,
  probeSessionInvokeWorkerCode,
  probeSnapshotInvokeWorkerCode,
  PROBE_INVOKE_FACET_CLASS_NAME,
  ProbeFullInvokeSessionFailureV1Schema,
  ProbeFullInvokeSessionResponseV1Schema,
  ProbeFacetFinalizerOutcomeUncertainV1Schema,
  ProbeInvokeFacetExecutionRequestV1Schema,
  type ProbeInvokeSessionReadCapability,
  type ProbeInvokeFacetRequestV1,
  type ProbeInvokeFacetExecutionRequestV1,
  type ProbeInvokeFacetWorkerResponseV1,
} from "./invokeProtocol";
import type {
  MockFinishEntrypoint,
  MockReadEntrypoint,
} from "./mockCommitWorker";
import type { ProbeSyncDO } from "./probeSyncDO";
import type { ProbePostgresOperationError } from "./postgresCommitWorker";
import {
  decodeProbeSessionExecutorReadEnvelope,
  newProbeSessionExecutorReadEnvelope,
  type ProbeSessionExecutorReadEnvelope,
  type ProbeSessionExecutorReadEntrypoint,
} from "./sessionExecutorReadEntrypoint";
import {
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
  probeWorkerLoaderIdentityV1,
  type ProbeScenario,
} from "./protocol";
import {
  decodeProbeSessionPurgeRequestV1OrNull,
  ProbeSessionPurgeReceiptV1Schema,
  type ProbeSessionPurgeRequestV1,
  type ProbeSessionPurgeReceiptV1,
} from "./purgeProtocol";
import {
  decodeProbeSessionEchoRequestV1Effect,
  ProbeSessionControlResponseV1Schema,
  ProbeSessionEchoResponseV1Schema,
  type ProbeSessionEchoRequestV1,
} from "./sessionProtocol";
import {
  decodeProbeRerunFacetResponseV1OrNull,
  decodeProbeRuntimeRerunRequestV1OrNull,
  probeRerunFacetReceiptMatchesRequest,
  probeRerunWorkerCode,
  PROBE_RERUN_FACET_CLASS_NAME,
  ProbeRerunSessionResponseV1Schema,
  type ProbeRuntimeRerunRequestV1,
} from "./rerunProtocol";

const INTERNAL_BODY_OVERHEAD_BYTES = 8_192;
const MAX_INTERNAL_BODY_BYTES =
  PROBE_LIMITS_V1.maxPayloadBytes + INTERNAL_BODY_OVERHEAD_BYTES;
const MAX_INTERNAL_RESPONSE_BYTES = 8_192;

const sessionRoutes = {
  echo: "/v1/echo",
  facet: "/v1/facet",
  facetLifecycle: "/v1/facet-lifecycle",
  fullInvoke: "/v1/full-invoke",
  rerun: "/v1/rerun",
  controlIncrement: "/v1/control/increment",
  controlRead: "/v1/control/read",
  controlReset: "/v1/control/reset",
} as const;

export interface ProbeSessionEnv {
  readonly HYPERDRIVE_CACHE_DISABLED?: Pick<Hyperdrive, "connectionString">;
  readonly LOADER?: WorkerLoader;
  readonly MOCK_FINISH?: Service<typeof MockFinishEntrypoint>;
  readonly MOCK_READ?: Service<typeof MockReadEntrypoint>;
  readonly PROBE_SYNC?: DurableObjectNamespace<ProbeSyncDO>;
  readonly SESSION_EXECUTOR_READ?: Service<
    typeof ProbeSessionExecutorReadEntrypoint
  >;
}

interface TrackedFacetIdentity {
  readonly attemptId: string;
  readonly facetId?: string | undefined;
  readonly codeId: string;
  readonly runId: string;
  readonly sampleId: string;
  readonly scenario: ProbeScenario;
}

interface FacetCallbackObservations {
  facetStartupCallbackRan: boolean;
  workerLoaderCallbackRan: boolean;
}

type TrackFacetResult = "identity-conflict" | "storage-failure" | "tracked";
type TrackedFacetIdentityResult =
  | "absent"
  | "identity-conflict"
  | "match"
  | "storage-failure";

type InvokeExecutorHost =
  | {
      readonly kind: "external-worker";
      readonly finish: Service<typeof MockFinishEntrypoint>;
      readonly read: Service<typeof MockReadEntrypoint>;
    }
  | {
      readonly kind: "facet-do";
      readonly finish: Service<typeof MockFinishEntrypoint>;
      readonly snapshot: ProbeMockReadResponseV1;
      readonly snapshotReadDurationMs: number;
    }
  | {
      readonly kind: "facet-finalizer";
      readonly finish: Service<typeof MockFinishEntrypoint>;
      readonly snapshot: ProbeMockReadResponseV1;
      readonly snapshotReadDurationMs: number;
    }
  | {
      readonly kind: "session-postgres";
      readonly operation: "finish" | "resolve";
      readonly postgres: ProbeSessionPostgresEnv;
      readonly snapshot: ProbeMockReadResponseV1;
      readonly snapshotReadDurationMs: number;
    }
  | {
      readonly kind: "session-do";
      readonly capability: ProbeSessionExecutorReadEnvelope;
      readonly read: ProbeInvokeSessionReadCapability;
      readonly sync: DurableObjectNamespace<ProbeSyncDO>;
    };

export interface ProbeSessionPostgresEnv {
  readonly HYPERDRIVE_CACHE_DISABLED: Pick<Hyperdrive, "connectionString">;
  readonly PROBE_SYNC: DurableObjectNamespace<ProbeSyncDO>;
}

export interface ProbeSessionPostgresOperations {
  readonly read: (
    env: ProbeSessionPostgresEnv,
    value: unknown,
  ) => Effect.Effect<ProbeMockReadResponseV1, ProbePostgresOperationError>;
  readonly finish: (
    env: ProbeSessionPostgresEnv,
    value: unknown,
    operation: "finish" | "resolve",
  ) => Effect.Effect<ProbeMockFinishResponseV1, ProbePostgresOperationError>;
}

export class ProbeSessionDOBase extends DurableObject<ProbeSessionEnv> {
  private readonly sql = this.ctx.storage.sql;
  private storageInitialized = true;
  private activeOperations = 0;
  private purgeTail: Promise<void> = Promise.resolve();
  private hasHandledWarmFinalizer = false;

  constructor(
    ctx: DurableObjectState,
    env: ProbeSessionEnv,
    private readonly postgresOperations: ProbeSessionPostgresOperations | null,
  ) {
    super(ctx, env);
    initializeSessionStorage(this.sql);
  }

  async executorRead(
    envelopeValue: unknown,
    value: unknown,
  ): Promise<ProbeMockReadResponseV1> {
    this.ensureStorage();
    if (sessionPurgeStarted(this.sql)) {
      throw new Error("session executor read after purge started");
    }
    this.activeOperations += 1;
    try {
      const sessionId = decodeObjectSessionId(this.ctx.id.name);
      const envelope = decodeProbeSessionExecutorReadEnvelope(envelopeValue);
      const request = decodeProbeMockReadRequestV1OrNull(value);
      if (
        sessionId === null ||
        envelope === null ||
        request === null ||
        envelope.expected.sessionId !== sessionId ||
        !sameMockReadRequest(request, envelope.expected) ||
        !recordSessionExecutorRead(this.ctx.storage, this.sql, envelope)
      ) {
        throw new Error("session executor read capability rejected");
      }
      await this.ctx.storage.sync();
      return ProbeMockReadResponseV1Schema.make({
        ...request,
        syntheticRevision: ProbeSyntheticCursorSchema.make(
          request.commitSeq - 1,
        ),
      });
    } finally {
      this.activeOperations -= 1;
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureStorage();
    if (sessionPurgeStarted(this.sql)) {
      return internalError("session_purge_started", 409);
    }
    this.activeOperations += 1;
    try {
      const sessionId = decodeObjectSessionId(this.ctx.id.name);
      if (sessionId === null) {
        return internalError("invalid_session_object", 409);
      }

      const pathname = new URL(request.url).pathname;
      if (pathname === sessionRoutes.echo) {
        return await this.echo(request, sessionId);
      }
      if (pathname === sessionRoutes.facet) {
        return await this.facet(request, sessionId);
      }
      if (pathname === sessionRoutes.facetLifecycle) {
        return await this.facetLifecycle(request, sessionId);
      }
      if (pathname === sessionRoutes.fullInvoke) {
        return await this.fullInvoke(request, sessionId);
      }
      if (pathname === sessionRoutes.rerun) {
        return await this.rerun(request, sessionId);
      }
      if (pathname === sessionRoutes.controlRead) {
        return this.control(request, sessionId, "read");
      }
      if (pathname === sessionRoutes.controlIncrement) {
        return await this.control(request, sessionId, "increment");
      }
      if (pathname === sessionRoutes.controlReset) {
        return await this.control(request, sessionId, "reset");
      }
      return internalError("not_found", 404);
    } finally {
      this.activeOperations -= 1;
    }
  }

  async purge(value: unknown): Promise<ProbeSessionPurgeReceiptV1> {
    const previous = this.purgeTail;
    let release: () => void = () => {};
    this.purgeTail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await this.purgeSerial(value);
    } finally {
      release();
    }
  }

  private async purgeSerial(
    value: unknown,
  ): Promise<ProbeSessionPurgeReceiptV1> {
    if (this.activeOperations !== 0) {
      throw new Error("probe session purge is busy");
    }
    this.ensureStorage();
    const request = decodeProbeSessionPurgeRequestV1OrNull(value);
    if (request === null || this.ctx.id.name !== request.sessionId) {
      throw new Error("invalid probe session purge identity");
    }
    const canonicalRequest = JSON.stringify(request);
    const completion = this.sql.exec<{
      request_json: string;
      deleted_facets: number;
    }>(
      `SELECT request_json, deleted_facets
       FROM probe_session_purge_completion
       WHERE singleton = 1`,
    ).toArray()[0];
    if (completion !== undefined) {
      if (completion.request_json !== canonicalRequest) {
        throw new Error("probe session purge request conflicts with completion");
      }
      assertExactSessionPurgeTombstone(this.sql);
      return ProbeSessionPurgeReceiptV1Schema.make({
        protocolVersion: request.protocolVersion,
        kind: "probe-data-cleared",
        sessionId: request.sessionId,
        deletedFacets: completion.deleted_facets,
        probeDataCleared: true,
        completionTombstoneRetained: true,
      });
    }
    const existingPlan = this.sql.exec<{ request_json: string }>(
      `SELECT request_json FROM probe_session_purge_plan
       WHERE singleton = 1`,
    ).toArray()[0];
    if (
      existingPlan !== undefined &&
      existingPlan.request_json !== canonicalRequest
    ) {
      throw new Error("probe session purge request conflicts with active plan");
    }
    const facets = new Map<string, ProbeSessionPurgeRequestV1["facets"][number]>();
    for (const facet of request.facets) facets.set(facet.attemptId, facet);
    const tracked = this.sql.exec<{
      facet_name: string;
      code_id: string;
      scenario: ProbeScenario;
    }>(
      `SELECT facet_name, code_id, scenario
       FROM probe_active_facets ORDER BY facet_name`,
    ).toArray();
    for (const row of tracked) {
      const trackedFacet = {
        attemptId: ProbeAttemptIdSchema.make(row.facet_name),
        codeId: ProbeCodeIdSchema.make(row.code_id),
        scenario: row.scenario,
      };
      const existing = facets.get(row.facet_name);
      if (
        existing !== undefined &&
        (existing.codeId !== trackedFacet.codeId ||
          existing.scenario !== trackedFacet.scenario)
      ) {
        throw new Error("probe session purge facet identity conflict");
      }
      facets.set(row.facet_name, trackedFacet);
    }
    const orderedFacets = [...facets.values()].sort((left, right) =>
      compareUtf16Strings(left.attemptId, right.attemptId)
    );
    if (orderedFacets.length > 600) {
      throw new Error("probe session purge facet budget exceeded");
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT OR IGNORE INTO probe_session_purge_plan
           (singleton, request_json)
         VALUES (1, ?)`,
        canonicalRequest,
      );
      for (const facet of orderedFacets) {
        const existing = this.sql.exec<{ code_id: string; scenario: string }>(
          `SELECT code_id, scenario FROM probe_session_purge_facets
           WHERE facet_name = ?`,
          facet.attemptId,
        ).toArray()[0];
        if (
          existing !== undefined &&
          (existing.code_id !== facet.codeId ||
            existing.scenario !== facet.scenario)
        ) {
          throw new Error("probe session purge facet identity conflict");
        }
        this.sql.exec(
          `INSERT OR IGNORE INTO probe_session_purge_facets
             (facet_name, code_id, scenario, phase)
           VALUES (?, ?, ?, 'pending')`,
          facet.attemptId,
          facet.codeId,
          facet.scenario,
        );
      }
    });
    const next = this.sql.exec<{
      facet_name: string;
      code_id: string;
      scenario: ProbeScenario;
      phase: "pending" | "prepared";
    }>(
      `SELECT facet_name, code_id, scenario, phase
       FROM probe_session_purge_facets
       WHERE phase NOT IN ('absent', 'deleted')
       ORDER BY facet_name
       LIMIT 1`,
    ).toArray()[0];
    if (next?.phase === "pending") {
      const preparation = await this.ensurePurgeFacet(this.env.LOADER, {
        attemptId: ProbeAttemptIdSchema.make(next.facet_name),
        codeId: ProbeCodeIdSchema.make(next.code_id),
        scenario: next.scenario,
      });
      if (preparation === "absent") {
        this.sql.exec(
          `UPDATE probe_session_purge_facets SET phase = 'absent'
           WHERE facet_name = ?`,
          next.facet_name,
        );
        await this.ctx.storage.sync();
        return ProbeSessionPurgeReceiptV1Schema.make({
          protocolVersion: request.protocolVersion,
          kind: "in-progress",
          sessionId: request.sessionId,
          pendingFacets: countPendingPurgeFacets(this.sql),
          probeDataCleared: false,
        });
      }
      this.ctx.facets.abort(next.facet_name, "probe campaign purge");
      this.sql.exec(
        `UPDATE probe_session_purge_facets SET phase = 'prepared'
         WHERE facet_name = ?`,
        next.facet_name,
      );
      await this.ctx.storage.sync();
      return ProbeSessionPurgeReceiptV1Schema.make({
        protocolVersion: request.protocolVersion,
        kind: "in-progress",
        sessionId: request.sessionId,
        pendingFacets: countPendingPurgeFacets(this.sql),
        probeDataCleared: false,
      });
    }
    if (next?.phase === "prepared") {
      try {
        this.ctx.facets.delete(next.facet_name);
      } catch {
        this.sql.exec(
          `UPDATE probe_session_purge_facets SET phase = 'pending'
           WHERE facet_name = ?`,
          next.facet_name,
        );
        await this.ctx.storage.sync();
        return ProbeSessionPurgeReceiptV1Schema.make({
          protocolVersion: request.protocolVersion,
          kind: "in-progress",
          sessionId: request.sessionId,
          pendingFacets: countPendingPurgeFacets(this.sql),
          probeDataCleared: false,
        });
      }
      this.sql.exec(
        `UPDATE probe_session_purge_facets SET phase = 'deleted'
         WHERE facet_name = ?`,
        next.facet_name,
      );
      this.sql.exec(
        "DELETE FROM probe_active_facets WHERE facet_name = ?",
        next.facet_name,
      );
      await this.ctx.storage.sync();
      const pendingFacets = countPendingPurgeFacets(this.sql);
      if (pendingFacets > 0) {
        return ProbeSessionPurgeReceiptV1Schema.make({
          protocolVersion: request.protocolVersion,
          kind: "in-progress",
          sessionId: request.sessionId,
          pendingFacets,
          probeDataCleared: false,
        });
      }
    }
    const deletedFacets = this.sql.exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM probe_session_purge_facets
       WHERE phase = 'deleted'`,
    ).one().count;
    const planRequest = this.sql.exec<{ request_json: string }>(
      `SELECT request_json FROM probe_session_purge_plan
       WHERE singleton = 1`,
    ).one().request_json;
    if (planRequest !== canonicalRequest) {
      throw new Error("probe session purge plan identity changed");
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM probe_active_facets");
      this.sql.exec("DELETE FROM probe_session_purge_facets");
      this.sql.exec("DELETE FROM probe_session_control");
      this.sql.exec("DELETE FROM probe_session_executor_attempts");
      this.sql.exec(
        `INSERT INTO probe_session_purge_completion
           (singleton, request_json, deleted_facets)
         VALUES (1, ?, ?)`,
        planRequest,
        deletedFacets,
      );
      this.sql.exec("DELETE FROM probe_session_purge_plan");
    });
    assertExactSessionPurgeTombstone(this.sql);
    await this.ctx.storage.sync();
    return ProbeSessionPurgeReceiptV1Schema.make({
      protocolVersion: request.protocolVersion,
      kind: "probe-data-cleared",
      sessionId: request.sessionId,
      deletedFacets,
      probeDataCleared: true,
      completionTombstoneRetained: true,
    });
  }

  private ensureStorage(): void {
    if (this.storageInitialized) return;
    initializeSessionStorage(this.sql);
    this.storageInitialized = true;
  }

  private async ensurePurgeFacet(
    loader: WorkerLoader | undefined,
    facet: ProbeSessionPurgeRequestV1["facets"][number],
  ): Promise<"absent" | "prepared"> {
    let stub: Fetcher;
    if (isProbeCodeProfile(facet.codeId, "facet")) {
      if (loader === undefined) {
        throw new Error("probe facet purge requires Worker Loader");
      }
      const worker = loader.get(facet.codeId, () => probeFacetWorkerCode());
      stub = this.ctx.facets.get(facet.attemptId, () => ({
        id: facet.attemptId,
        class: worker.getDurableObjectClass(PROBE_FACET_CLASS_NAME),
      }));
    } else if (
      isProbeCodeProfile(facet.codeId, "invoke") ||
      isProbeCodeProfile(facet.codeId, "invoke-finalizer") ||
      isProbeCodeProfile(facet.codeId, "invoke-finalizer-warm") ||
      isProbeCodeProfile(facet.codeId, "invoke-finalizer-postgres-warm") ||
      isProbeCodeProfile(facet.codeId, "invoke-session-postgres-warm")
    ) {
      let workerCode: WorkerLoaderWorkerCode;
      if (
        facet.scenario === "session_executor_invoke" ||
        facet.scenario === "facet_executor_invoke" ||
        facet.scenario === "facet_finalizer_invoke" ||
        facet.scenario === "facet_finalizer_warm_invoke" ||
        facet.scenario === "facet_finalizer_postgres_warm_invoke" ||
        facet.scenario === "session_postgres_warm_invoke" ||
        facet.scenario === "executor_worker_invoke"
      ) {
        const attempt = this.sql.exec<{
          capability_token: string | null;
          request_json: string;
        }>(
          `SELECT capability_token, request_json
           FROM probe_session_executor_attempts
           WHERE attempt_id = ?`,
          facet.attemptId,
        ).toArray()[0];
        if (attempt === undefined) {
          const tracked = this.sql.exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM probe_active_facets
             WHERE facet_name = ?`,
            facet.attemptId,
          ).one().count;
          if (tracked === 0) return "absent";
          throw new Error("tracked invoke purge requires attempt evidence");
        }
        const invoke = decodeProbeInvokeFacetRequestV1OrNull(
          JSON.parse(attempt.request_json),
        );
        if (
          invoke === null ||
          invoke.facetId !== facet.attemptId ||
          invoke.codeId !== facet.codeId ||
          invoke.scenario !== facet.scenario
        ) {
          throw new Error("probe invoke purge attempt evidence conflicts");
        }
        if (facet.scenario === "session_executor_invoke") {
          const read = this.env.SESSION_EXECUTOR_READ;
          if (read === undefined || attempt.capability_token === null) {
            throw new Error("probe invoke purge requires session read binding");
          }
          workerCode = probeSessionInvokeWorkerCode(
            read,
            {
              capabilityToken: attempt.capability_token,
              expected: probeMockReadRequestFromInvoke(invoke),
            } satisfies ProbeSessionExecutorReadEnvelope,
          );
        } else if (facet.scenario === "facet_executor_invoke") {
          if (attempt.capability_token !== null) {
            throw new Error("facet executor purge capability evidence conflicts");
          }
          workerCode = probeSnapshotInvokeWorkerCode();
        } else if (facet.scenario === "session_postgres_warm_invoke") {
          if (attempt.capability_token !== null) {
            throw new Error("session postgres purge capability evidence conflicts");
          }
          workerCode = probeSnapshotInvokeWorkerCode();
        } else if (
          facet.scenario === "facet_finalizer_invoke" ||
          facet.scenario === "facet_finalizer_warm_invoke" ||
          facet.scenario === "facet_finalizer_postgres_warm_invoke"
        ) {
          const finish = this.env.MOCK_FINISH;
          if (finish === undefined || attempt.capability_token !== null) {
            throw new Error("facet finalizer purge capability evidence conflicts");
          }
          workerCode = probeFacetFinalizerWorkerCode(finish);
        } else {
          const read = this.env.MOCK_READ;
          if (read === undefined || attempt.capability_token !== null) {
            throw new Error("external executor purge capability evidence conflicts");
          }
          workerCode = probeInvokeWorkerCode(read);
        }
      } else if (facet.scenario === "full_invoke") {
        const read = this.env.MOCK_READ;
        if (read === undefined) {
          throw new Error("probe invoke purge requires mock-read binding");
        }
        workerCode = probeInvokeWorkerCode(read);
      } else {
        throw new Error("probe invoke purge scenario is incompatible");
      }
      if (loader === undefined) {
        throw new Error("probe invoke purge requires Worker Loader");
      }
      const runtimeCodeId = probeWorkerLoaderIdentityV1(
        facet.scenario,
        facet,
      );
      if (runtimeCodeId === null) {
        throw new Error("probe invoke purge requires a loader identity");
      }
      const worker = loader.get(
        runtimeCodeId,
        () => workerCode,
      );
      stub = this.ctx.facets.get(facet.attemptId, () => ({
        id: facet.attemptId,
        class: worker.getDurableObjectClass(PROBE_INVOKE_FACET_CLASS_NAME),
      }));
    } else if (isProbeCodeProfile(facet.codeId, "rerun")) {
      if (loader === undefined) {
        throw new Error("probe rerun purge requires Worker Loader");
      }
      const worker = loader.get(facet.codeId, () => probeRerunWorkerCode());
      stub = this.ctx.facets.get(facet.attemptId, () => ({
        id: facet.attemptId,
        class: worker.getDurableObjectClass(PROBE_RERUN_FACET_CLASS_NAME),
      }));
    } else {
      throw new Error("probe session purge received an unsupported code profile");
    }
    const response = await stub.fetch(
      new Request("https://probe-facet.internal/v1/purge-ensure", {
        method: "POST",
      }),
    );
    await response.arrayBuffer();
    if (!response.ok) {
      throw new Error("probe facet purge preparation failed");
    }
    return "prepared";
  }

  private async echo(
    request: Request,
    sessionId: ProbeSessionId,
  ): Promise<Response> {
    const body = await readInternalPost(request);
    if (body instanceof Response) return body;
    const decoded = await decodeEchoRequest(body);
    if (decoded === null) {
      return internalError("invalid_request", 400);
    }
    if (decoded.sessionId !== sessionId) {
      return internalError("session_identity_mismatch", 409);
    }

    return noStoreJson(
      ProbeSessionEchoResponseV1Schema.make({
        protocolVersion: decoded.protocolVersion,
        runId: decoded.runId,
        sampleId: decoded.sampleId,
        sampleOrdinal: decoded.sampleOrdinal,
        sessionId,
        sessionMode: decoded.sessionMode,
        payloadBytes: decoded.payload.length,
      }),
    );
  }

  private async facet(
    request: Request,
    sessionId: ProbeSessionId,
  ): Promise<Response> {
    const body = await readInternalPost(request);
    if (body instanceof Response) return body;
    const decoded = await decodeFacetRequest(body);
    if (decoded === null) return internalError("invalid_request", 400);
    if (decoded.sessionId !== sessionId) {
      return internalError("session_identity_mismatch", 409);
    }
    const loader = this.env.LOADER;
    if (loader === undefined) return internalError("loader_unavailable", 500);
    const tracking = await this.trackFacet(decoded);
    if (tracking === "identity-conflict") {
      return internalError("facet_identity_conflict", 409);
    }
    if (tracking === "storage-failure") {
      return internalError("facet_tracking_failed", 500);
    }

    let invocation:
      | { readonly kind: "response"; readonly response: Response }
      | { readonly kind: "defect"; readonly cause: unknown };
    try {
      invocation = {
        kind: "response",
        response: await this.invokeFacet(loader, decoded),
      };
    } catch (cause) {
      invocation = { kind: "defect", cause };
    }
    if (!(await this.deleteTrackedFacet(decoded.attemptId))) {
      return internalError("facet_cleanup_failed", 500);
    }
    if (invocation.kind === "defect") throw invocation.cause;
    return invocation.response;
  }

  private async invokeFacet(
    loader: WorkerLoader,
    request: ProbeFacetInvokeRequestV1,
  ): Promise<Response> {
    const observations: FacetCallbackObservations = {
      facetStartupCallbackRan: false,
      workerLoaderCallbackRan: false,
    };
    const startedAt = performance.now();
    let response: Response;
    try {
      const facet = this.facetStub(loader, request, observations);
      response = await facet.fetch(
        new Request("https://probe-facet.internal/v1/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
    } catch {
      return internalError("facet_transport_failure", 502);
    }
    if (!response.ok) {
      return internalError("facet_response_failure", 502);
    }
    const body = await readBoundedJson(response, MAX_INTERNAL_RESPONSE_BYTES);
    const decoded = body.ok
      ? await decodeFacetWorkerResponse(body.value)
      : null;
    if (
      decoded === null ||
      !(await probeFacetReceiptMatchesRequest(decoded, request))
    ) {
      return internalError("facet_receipt_mismatch", 502);
    }
    const facetDurationMs = elapsedPerformanceDurationSince(startedAt);

    return noStoreJson(
      ProbeFacetSessionResponseV1Schema.make({
        protocolVersion: decoded.protocolVersion,
        runId: decoded.runId,
        sampleId: decoded.sampleId,
        sampleOrdinal: decoded.sampleOrdinal,
        scenario: decoded.scenario,
        sessionId: decoded.sessionId,
        sessionMode: decoded.sessionMode,
        attemptId: decoded.attemptId,
        codeMode: decoded.codeMode,
        codeId: decoded.codeId,
        journalEntries: decoded.journalEntries,
        payloadBytes: decoded.payloadBytes,
        facetDurationMs: ProbeDurationMsSchema.make(facetDurationMs),
        journalDurationMs: decoded.journalDurationMs,
        sealDigest: decoded.sealDigest,
        workerLoaderCallbackRan: observations.workerLoaderCallbackRan,
        facetStartupCallbackRan: observations.facetStartupCallbackRan,
      }),
    );
  }

  private async fullInvoke(
    request: Request,
    sessionId: ProbeSessionId,
  ): Promise<Response> {
    const body = await readInternalPost(request);
    if (body instanceof Response) return body;
    const decoded = decodeFullInvokeRequest(body);
    if (decoded === null) return internalError("invalid_request", 400);
    return await this.fullInvokeDecoded(decoded, sessionId);
  }

  private async fullInvokeDecoded(
    decoded: ProbeInvokeFacetRequestV1,
    sessionId: ProbeSessionId,
  ): Promise<Response> {
    if (decoded.sessionId !== sessionId) {
      return internalError("session_identity_mismatch", 409);
    }
    const loader = this.env.LOADER;
    if (loader === undefined) return internalError("loader_unavailable", 500);
    const sessionHosted = decoded.scenario === "session_executor_invoke";
    const facetHosted = decoded.scenario === "facet_executor_invoke";
    const facetFinalizer = decoded.scenario === "facet_finalizer_invoke" ||
      decoded.scenario === "facet_finalizer_warm_invoke" ||
      decoded.scenario === "facet_finalizer_postgres_warm_invoke";
    const sessionPostgres = decoded.scenario ===
      "session_postgres_warm_invoke";
    const warmFinalizer = decoded.scenario === "facet_finalizer_warm_invoke" ||
      decoded.scenario === "facet_finalizer_postgres_warm_invoke" ||
      sessionPostgres;
    const sessionActivationObserved = warmFinalizer &&
      !this.hasHandledWarmFinalizer;
    if (warmFinalizer) this.hasHandledWarmFinalizer = true;
    const externalControl = decoded.scenario === "executor_worker_invoke";
    const attemptFenced = sessionHosted || facetHosted || facetFinalizer ||
      sessionPostgres || externalControl;
    let executorHost: InvokeExecutorHost;
    if (sessionHosted) {
      const sync = this.env.PROBE_SYNC;
      const read = this.env.SESSION_EXECUTOR_READ;
      if (sync === undefined || read === undefined) {
        return internalError("session_executor_capability_unavailable", 500);
      }
      const capability = newProbeSessionExecutorReadEnvelope(
        probeMockReadRequestFromInvoke(decoded),
      );
      const admission = beginInvokeAttempt(
        this.sql,
        decoded,
        capability.capabilityToken,
      );
      if (admission.kind === "replay") return admission.response;
      if (admission.kind === "busy") {
        return internalError("session_executor_attempt_busy", 409);
      }
      if (admission.kind === "conflict") {
        return internalError("session_executor_attempt_conflict", 409);
      }
      if (admission.kind === "storage-failure") {
        return internalError("session_executor_state_failure", 500);
      }
      try {
        await this.ctx.storage.sync();
      } catch {
        return internalError("session_executor_state_failure", 500);
      }
      executorHost = {
        kind: "session-do",
        capability,
        read,
        sync,
      };
    } else if (facetHosted || facetFinalizer || sessionPostgres) {
      if (
        sessionPostgres
          ? sessionPostgresEnvOrNull(this.env) === null
          : this.env.MOCK_READ === undefined ||
            this.env.MOCK_FINISH === undefined
      ) {
        return internalError("invoke_capability_unavailable", 500);
      }
      const admission = beginInvokeAttempt(this.sql, decoded, null);
      if (admission.kind === "replay") return admission.response;
      const recoveringFinalizer =
        admission.kind === "busy" && (facetFinalizer || sessionPostgres);
      if (
        admission.kind === "busy" &&
        !facetFinalizer &&
        !sessionPostgres
      ) {
        return internalError(
          facetFinalizer || sessionPostgres
            ? "facet_finalizer_attempt_busy"
            : "facet_executor_attempt_busy",
          409,
        );
      }
      if (admission.kind === "conflict") {
        return internalError(
          facetFinalizer || sessionPostgres
            ? "facet_finalizer_attempt_conflict"
            : "facet_executor_attempt_conflict",
          409,
        );
      }
      if (admission.kind === "storage-failure") {
        return internalError(
          facetFinalizer || sessionPostgres
            ? "facet_finalizer_state_failure"
            : "facet_executor_state_failure",
          500,
        );
      }
      try {
        await this.ctx.storage.sync();
      } catch {
        return internalError("facet_executor_state_failure", 500);
      }
      const readRequest = probeMockReadRequestFromInvoke(decoded);
      const snapshotStartedAt = performance.now();
      let snapshot: ProbeMockReadResponseV1 | null;
      if (recoveringFinalizer) {
        snapshot = ProbeMockReadResponseV1Schema.make({
          ...readRequest,
          syntheticRevision: ProbeSyntheticCursorSchema.make(
            readRequest.commitSeq - 1,
          ),
        });
      } else {
        try {
          let rawSnapshot: ProbeMockReadResponseV1;
          if (sessionPostgres) {
            const postgres = sessionPostgresEnvOrNull(this.env);
            if (postgres === null) {
              return internalError("invoke_capability_unavailable", 500);
            }
            if (this.postgresOperations === null) {
              return internalError("invoke_capability_unavailable", 500);
            }
            const result = await Effect.runPromise(
              Effect.result(
                this.postgresOperations.read(postgres, readRequest),
              ),
            );
            if (Result.isFailure(result)) {
              return await completeInvokeResponse(
                this.ctx.storage,
                this.sql,
                decoded,
                internalError("snapshot_read_transport_failure", 502),
              );
            }
            rawSnapshot = result.success;
          } else {
            const read = this.env.MOCK_READ;
            if (read === undefined) {
              return internalError("invoke_capability_unavailable", 500);
            }
            rawSnapshot = await read.read(readRequest);
          }
          snapshot = decodeProbeMockReadResponseV1OrNull(
            copyCloudflareRpcRecord(rawSnapshot),
          );
        } catch {
          return await completeInvokeResponse(
            this.ctx.storage,
            this.sql,
            decoded,
            internalError("snapshot_read_transport_failure", 502),
          );
        }
      }
      if (
        snapshot === null ||
        !probeMockReadReceiptMatchesRequestV1(snapshot, readRequest)
      ) {
        return await completeInvokeResponse(
          this.ctx.storage,
          this.sql,
          decoded,
          internalError("snapshot_read_receipt_mismatch", 502),
        );
      }
      const snapshotReadDurationMs = elapsedPerformanceDurationSince(
        snapshotStartedAt,
      );
      if (sessionPostgres) {
        const postgres = sessionPostgresEnvOrNull(this.env);
        if (postgres === null) {
          return internalError("invoke_capability_unavailable", 500);
        }
        executorHost = {
            kind: "session-postgres",
            operation: recoveringFinalizer ? "resolve" : "finish",
            postgres,
            snapshot,
            snapshotReadDurationMs,
          };
      } else {
        const finish = this.env.MOCK_FINISH;
        if (finish === undefined) {
          return internalError("invoke_capability_unavailable", 500);
        }
        executorHost = {
            kind: facetFinalizer ? "facet-finalizer" : "facet-do",
            finish,
            snapshot,
            snapshotReadDurationMs,
          };
      }
    } else {
      const read = this.env.MOCK_READ;
      const finish = this.env.MOCK_FINISH;
      if (read === undefined || finish === undefined) {
        return internalError("invoke_capability_unavailable", 500);
      }
      if (externalControl) {
        const admission = beginInvokeAttempt(this.sql, decoded, null);
        if (admission.kind === "replay") return admission.response;
        if (admission.kind === "busy") {
          return internalError("executor_worker_attempt_busy", 409);
        }
        if (admission.kind === "conflict") {
          return internalError("executor_worker_attempt_conflict", 409);
        }
        if (admission.kind === "storage-failure") {
          return internalError("executor_worker_state_failure", 500);
        }
        try {
          await this.ctx.storage.sync();
        } catch {
          return internalError("executor_worker_state_failure", 500);
        }
      }
      executorHost = { kind: "external-worker", read, finish };
    }
    const tracking = await this.trackFacet(decoded);
    if (tracking === "identity-conflict") {
      const response = internalError("facet_identity_conflict", 409);
      return attemptFenced
        ? await completeInvokeResponse(
            this.ctx.storage,
            this.sql,
            decoded,
            response,
          )
        : response;
    }
    if (tracking === "storage-failure") {
      const response = internalError("facet_tracking_failed", 500);
      return attemptFenced
        ? await completeInvokeResponse(
            this.ctx.storage,
            this.sql,
            decoded,
            response,
          )
        : response;
    }

    let invocation:
      | { readonly kind: "response"; readonly response: Response }
      | { readonly kind: "defect"; readonly cause: unknown };
    try {
      invocation = {
        kind: "response",
        response: await this.executeFullInvoke(
          loader,
          executorHost,
          decoded,
          sessionActivationObserved,
        ),
      };
    } catch (cause) {
      invocation = { kind: "defect", cause };
    }
    if (facetFinalizer || sessionPostgres) {
      const settledResponse = invocation.kind === "response" &&
          (invocation.response.ok ||
            await isKnownSettledFinalizationFailure(invocation.response))
        ? invocation.response
        : null;
      if (settledResponse === null) {
        const markedUncertain = markInvokeAttemptFinishing(this.sql, decoded);
        if (markedUncertain) {
          try {
            await this.ctx.storage.sync();
          } catch {
            return internalError("facet_finalizer_uncertain_state_failure", 500);
          }
        }
        return markedUncertain
          ? noStoreJson(
              ProbeFacetFinalizerOutcomeUncertainV1Schema.make({
                protocolVersion: decoded.protocolVersion,
                sessionId: decoded.sessionId,
                attemptId: decoded.attemptId,
                error: "facet_finalizer_outcome_uncertain",
              }),
              502,
            )
          : internalError("facet_finalizer_uncertain_state_failure", 500);
      }
      const completed = await completeInvokeResponse(
        this.ctx.storage,
        this.sql,
        decoded,
        settledResponse,
      );
      if (!completed.ok) return completed;
      if (!warmFinalizer) await this.deleteTrackedFacet(decoded.facetId);
      return completed;
    }
    const facetDeleted = await this.deleteTrackedFacet(decoded.facetId);
    if (!attemptFenced) {
      if (!facetDeleted) return internalError("facet_cleanup_failed", 500);
      if (invocation.kind === "defect") throw invocation.cause;
      return invocation.response;
    }
    const response = !facetDeleted
      ? internalError("facet_cleanup_failed", 500)
      : invocation.kind === "defect"
      ? internalError(
          facetHosted || facetFinalizer || sessionPostgres
            ? facetFinalizer || sessionPostgres
              ? "facet_finalizer_defect"
              : "facet_executor_defect"
            : externalControl
            ? "executor_worker_defect"
            : "session_executor_defect",
          500,
        )
      : invocation.response;
    return await completeInvokeResponse(
      this.ctx.storage,
      this.sql,
      decoded,
      response,
    );
  }

  private async executeFullInvoke(
    loader: WorkerLoader,
    executorHost: InvokeExecutorHost,
    request: ProbeInvokeFacetRequestV1,
    sessionActivationObserved: boolean,
  ): Promise<Response> {
    const facetRequest: ProbeInvokeFacetExecutionRequestV1 =
      ProbeInvokeFacetExecutionRequestV1Schema.make({
        ...request,
        prefetchedRead: executorHost.kind === "facet-do" ||
            executorHost.kind === "facet-finalizer" ||
            executorHost.kind === "session-postgres"
          ? executorHost.snapshot
          : null,
      });
    const observations: FacetCallbackObservations = {
      facetStartupCallbackRan: false,
      workerLoaderCallbackRan: false,
    };
    const facetStartedAt = performance.now();
    let facetResponse: Response;
    try {
      const facet = this.ctx.facets.get(request.facetId, () => {
        observations.facetStartupCallbackRan = true;
        const runtimeCodeId = probeWorkerLoaderIdentityV1(
          request.scenario,
          request,
        );
        if (runtimeCodeId === null) {
          throw new Error("invoke request requires a Worker Loader identity");
        }
        const worker = loader.get(runtimeCodeId, () => {
          observations.workerLoaderCallbackRan = true;
          return executorHost.kind === "session-do"
            ? probeSessionInvokeWorkerCode(
                executorHost.read,
                executorHost.capability,
              )
            : executorHost.kind === "facet-do"
            ? probeSnapshotInvokeWorkerCode()
            : executorHost.kind === "session-postgres"
            ? probeSnapshotInvokeWorkerCode()
            : executorHost.kind === "facet-finalizer"
            ? probeFacetFinalizerWorkerCode(executorHost.finish)
            : probeInvokeWorkerCode(executorHost.read);
        });
        return {
          id: request.facetId,
          class: worker.getDurableObjectClass(PROBE_INVOKE_FACET_CLASS_NAME),
        };
      });
      facetResponse = await facet.fetch(
        new Request("https://probe-facet.internal/v1/full-invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(facetRequest),
        }),
      );
    } catch {
      return internalError("facet_transport_failure", 502);
    }
    if (!facetResponse.ok) {
      return internalError("facet_response_failure", 502);
    }
    const facetBody = await readBoundedJson(
      facetResponse,
      MAX_INTERNAL_RESPONSE_BYTES,
    );
    const facetReceipt = facetBody.ok
      ? decodeFullInvokeWorkerResponse(facetBody.value)
      : null;
    if (
      facetReceipt === null ||
      !(await sameFullInvokeFacetReceipt(facetReceipt, request))
    ) {
      return internalError("facet_receipt_mismatch", 502);
    }
    const facetDurationMs = elapsedPerformanceDurationSince(facetStartedAt);

    const finishRequest = ProbeMockFinishRequestV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
      sessionId: request.sessionId,
      sessionMode: request.sessionMode,
      attemptId: request.attemptId,
      codeMode: request.codeMode,
      codeId: request.codeId,
      journalEntries: request.journalEntries,
      sealDigest: facetReceipt.sealDigest,
      snapshotRevision: facetReceipt.syntheticRevision,
      resultDigest: facetReceipt.resultDigest,
      commitIntentDigest: facetReceipt.commitIntent.digest,
    });
    const finishStartedAt = performance.now();
    let finish: ProbeMockFinishResponseV1 | null;
    if (executorHost.kind === "facet-finalizer") {
      finish = facetReceipt.finish;
    } else if (executorHost.kind === "session-postgres") {
      if (!markInvokeAttemptFinishing(this.sql, request)) {
        return internalError("session_postgres_state_failure", 500);
      }
      try {
        await this.ctx.storage.sync();
        if (this.postgresOperations === null) {
          return internalError("invoke_capability_unavailable", 500);
        }
        const result = await Effect.runPromise(
          Effect.result(this.postgresOperations.finish(
            executorHost.postgres,
            finishRequest,
            executorHost.operation,
          )),
        );
        if (Result.isFailure(result)) {
          return internalError("session_postgres_transport_failure", 502);
        }
        finish = result.success;
      } catch {
        return internalError("session_postgres_transport_failure", 502);
      }
    } else if (executorHost.kind !== "session-do") {
      const externallyFinishedAttemptFenced =
        request.scenario === "facet_executor_invoke" ||
        request.scenario === "executor_worker_invoke";
      if (
        externallyFinishedAttemptFenced &&
        !markInvokeAttemptFinishing(this.sql, request)
      ) {
        return internalError(invokeAttemptError(request, "state_failure"), 500);
      }
      if (externallyFinishedAttemptFenced) {
        try {
          await this.ctx.storage.sync();
        } catch {
          return internalError(invokeAttemptError(request, "state_failure"), 500);
        }
      }
      try {
        const rawFinish = await executorHost.finish.finish(finishRequest);
        finish = decodeMockFinishResponse(copyCloudflareRpcRecord(rawFinish));
      } catch {
        return internalError("mock_finish_transport_failure", 502);
      }
    } else {
      const readCapabilityCalls = sessionExecutorReadCalls(this.sql, request);
      if (readCapabilityCalls !== 1) {
        return internalError("session_executor_read_count_mismatch", 502);
      }
      if (!markInvokeAttemptFinishing(this.sql, request)) {
        return internalError("session_executor_state_failure", 500);
      }
      try {
        await this.ctx.storage.sync();
      } catch {
        return internalError("session_executor_state_failure", 500);
      }
      const syncRequest = ProbeSyncWakeRequestV1Schema.make({
        protocolVersion: finishRequest.protocolVersion,
        runId: finishRequest.runId,
        sampleId: finishRequest.sampleId,
        sampleOrdinal: finishRequest.sampleOrdinal,
        scopeId: finishRequest.scopeId,
        scenario: finishRequest.scenario,
        commitSeq: finishRequest.commitSeq,
      });
      const wakeStartedAt = performance.now();
      try {
        const rawReceipt = await executorHost.sync
          .getByName(finishRequest.scopeId)
          .wake(syncRequest);
        const receipt = decodeProbeSyncWakeReceiptV1OrNull(
          copyCloudflareRpcRecord(rawReceipt),
        );
        finish = receipt === null
          ? null
          : ProbeMockFinishResponseV1Schema.make({
              request: finishRequest,
              commitAuthority: "mock",
              finishDisposition: "committed",
              commitTransactionDurationMs: ProbeDurationMsSchema.make(0),
              outcomeResolutionDurationMs: ProbeDurationMsSchema.make(0),
              syncWakeDurationMs: ProbeDurationMsSchema.make(
                elapsedPerformanceDurationSince(wakeStartedAt),
              ),
              sync: receipt,
            });
      } catch {
        return internalError("session_sync_wake_failure", 502);
      }
    }
    if (finish === null || !sameMockFinishReceipt(finish, finishRequest)) {
      return internalError("mock_finish_receipt_mismatch", 502);
    }
    const sessionMockFinishDurationMs = executorHost.kind === "facet-finalizer"
      ? 0
      : elapsedPerformanceDurationSince(finishStartedAt);
    const observation = {
      facet: facetReceipt,
      facetDurationMs: ProbeDurationMsSchema.make(facetDurationMs),
      workerLoaderCallbackRan: observations.workerLoaderCallbackRan,
      facetStartupCallbackRan: observations.facetStartupCallbackRan,
      sessionActivationObserved,
      executorHost: executorHost.kind,
      readCapabilityCalls: executorHost.kind === "session-do"
        ? sessionExecutorReadCalls(this.sql, request) ?? 0
        : 0,
      snapshotReadDurationMs: executorHost.kind === "facet-do" ||
          executorHost.kind === "facet-finalizer" ||
          executorHost.kind === "session-postgres"
        ? ProbeDurationMsSchema.make(executorHost.snapshotReadDurationMs)
        : null,
      sessionMockFinishDurationMs: ProbeDurationMsSchema.make(
        sessionMockFinishDurationMs,
      ),
      finish,
    } as const;
    if (
      finish.sync.disposition !== "applied" &&
      finish.sync.disposition !== "duplicate"
    ) {
      return noStoreJson(
        ProbeFullInvokeSessionFailureV1Schema.make({
          ...observation,
          error: {
            code: "runtime_failure",
            retryable: false,
            stage: "sync_cursor_io",
          },
        }),
        409,
      );
    }

    return noStoreJson(
      ProbeFullInvokeSessionResponseV1Schema.make({
        ...observation,
      }),
    );
  }

  private async rerun(
    request: Request,
    sessionId: ProbeSessionId,
  ): Promise<Response> {
    const body = await readInternalPost(request);
    if (body instanceof Response) return body;
    const decoded = decodeProbeRuntimeRerunRequestV1OrNull(body);
    if (decoded === null) return internalError("invalid_request", 400);
    if (decoded.sessionId !== sessionId) {
      return internalError("session_identity_mismatch", 409);
    }
    const loader = this.env.LOADER;
    if (loader === undefined) return internalError("loader_unavailable", 500);
    const tracking = await this.trackFacet(decoded);
    if (tracking === "identity-conflict") {
      return internalError("facet_identity_conflict", 409);
    }
    if (tracking === "storage-failure") {
      return internalError("facet_tracking_failed", 500);
    }

    let invocation:
      | { readonly kind: "response"; readonly response: Response }
      | { readonly kind: "defect"; readonly cause: unknown };
    try {
      invocation = {
        kind: "response",
        response: await this.executeRerun(loader, decoded),
      };
    } catch (cause) {
      invocation = { kind: "defect", cause };
    }
    if (!(await this.deleteTrackedFacet(decoded.attemptId))) {
      return internalError("facet_cleanup_failed", 500);
    }
    if (invocation.kind === "defect") throw invocation.cause;
    return invocation.response;
  }

  private async executeRerun(
    loader: WorkerLoader,
    request: ProbeRuntimeRerunRequestV1,
  ): Promise<Response> {
    const observations: FacetCallbackObservations = {
      facetStartupCallbackRan: false,
      workerLoaderCallbackRan: false,
    };
    const startedAt = performance.now();
    let facetResponse: Response;
    try {
      const facet = this.ctx.facets.get(request.attemptId, () => {
        observations.facetStartupCallbackRan = true;
        const worker = loader.get(request.codeId, () => {
          observations.workerLoaderCallbackRan = true;
          return probeRerunWorkerCode();
        });
        return {
          id: request.attemptId,
          class: worker.getDurableObjectClass(PROBE_RERUN_FACET_CLASS_NAME),
        };
      });
      facetResponse = await facet.fetch(
        new Request("https://probe-facet.internal/v1/rerun", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
    } catch {
      return internalError("facet_transport_failure", 502);
    }
    if (!facetResponse.ok) {
      return internalError("facet_response_failure", 502);
    }
    const body = await readBoundedJson(
      facetResponse,
      MAX_INTERNAL_RESPONSE_BYTES,
    );
    const facetReceipt = body.ok
      ? decodeProbeRerunFacetResponseV1OrNull(body.value)
      : null;
    if (
      facetReceipt === null ||
      !probeRerunFacetReceiptMatchesRequest(facetReceipt, request)
    ) {
      return internalError("facet_receipt_mismatch", 502);
    }
    return noStoreJson(
      ProbeRerunSessionResponseV1Schema.make({
        facet: facetReceipt,
        facetDurationMs: ProbeDurationMsSchema.make(
          elapsedPerformanceDurationSince(startedAt),
        ),
        workerLoaderCallbackRan: observations.workerLoaderCallbackRan,
        facetStartupCallbackRan: observations.facetStartupCallbackRan,
      }),
    );
  }

  private async facetLifecycle(
    request: Request,
    sessionId: ProbeSessionId,
  ): Promise<Response> {
    const body = await readInternalPost(request);
    if (body instanceof Response) return body;
    const decoded = await decodeFacetLifecycleRequest(body);
    if (decoded === null) return internalError("invalid_request", 400);
    if (decoded.sessionId !== sessionId) {
      return internalError("session_identity_mismatch", 409);
    }

    if (decoded.operation === "abort" || decoded.operation === "delete") {
      const identity = this.trackedFacetIdentity(decoded);
      if (identity === "identity-conflict") {
        return internalError("facet_identity_conflict", 409);
      }
      if (identity === "storage-failure") {
        return internalError("facet_tracking_failed", 500);
      }
    }
    if (decoded.operation === "abort") {
      try {
        this.ctx.facets.abort(decoded.attemptId, "probe lifecycle abort");
      } catch {
        return internalError("facet_abort_failed", 500);
      }
      return this.lifecycleResponse(decoded, null, false, false);
    }
    if (decoded.operation === "delete") {
      if (!(await this.deleteTrackedFacet(decoded.attemptId))) {
        return internalError("facet_cleanup_failed", 500);
      }
      return this.lifecycleResponse(decoded, null, false, false);
    }

    const loader = this.env.LOADER;
    if (loader === undefined) return internalError("loader_unavailable", 500);
    const tracking = await this.trackFacet(decoded);
    if (tracking === "identity-conflict") {
      return internalError("facet_identity_conflict", 409);
    }
    if (tracking === "storage-failure") {
      return internalError("facet_tracking_failed", 500);
    }
    const observations: FacetCallbackObservations = {
      facetStartupCallbackRan: false,
      workerLoaderCallbackRan: false,
    };
    let response: Response;
    try {
      const facet = this.facetStub(loader, decoded, observations);
      response = await facet.fetch(
        new Request("https://probe-facet.internal/v1/lifecycle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attemptId: decoded.attemptId,
            codeId: decoded.codeId,
            operation: decoded.operation,
          }),
        }),
      );
    } catch {
      return internalError("facet_transport_failure", 502);
    }
    if (!response.ok) return internalError("facet_response_failure", 502);
    const responseBody = await readBoundedJson(
      response,
      MAX_INTERNAL_RESPONSE_BYTES,
    );
    const receipt = responseBody.ok
      ? await decodeFacetLifecycleWorkerResponse(responseBody.value)
      : null;
    if (
      receipt === null ||
      receipt.operation !== decoded.operation ||
      receipt.attemptId !== decoded.attemptId ||
      receipt.codeId !== decoded.codeId
    ) {
      return internalError("facet_receipt_mismatch", 502);
    }
    return this.lifecycleResponse(
      decoded,
      receipt.value,
      observations.workerLoaderCallbackRan,
      observations.facetStartupCallbackRan,
    );
  }

  private facetStub(
    loader: WorkerLoader,
    request: ProbeFacetInvokeRequestV1 | ProbeFacetLifecycleRequestV1,
    observations: FacetCallbackObservations,
  ): Fetcher {
    return this.ctx.facets.get(request.attemptId, () => {
      observations.facetStartupCallbackRan = true;
      const worker = loader.get(request.codeId, () => {
        observations.workerLoaderCallbackRan = true;
        return probeFacetWorkerCode();
      });
      return {
        id: request.attemptId,
        class: worker.getDurableObjectClass(PROBE_FACET_CLASS_NAME),
      };
    });
  }

  private lifecycleResponse(
    request: ProbeFacetLifecycleRequestV1,
    value: number | null,
    workerLoaderCallbackRan: boolean,
    facetStartupCallbackRan: boolean,
  ): Response {
    return noStoreJson(
      ProbeFacetLifecycleSessionResponseV1Schema.make({
        protocolVersion: request.protocolVersion,
        runId: request.runId,
        sampleId: request.sampleId,
        sampleOrdinal: request.sampleOrdinal,
        scenario: request.scenario,
        sessionId: request.sessionId,
        sessionMode: request.sessionMode,
        attemptId: request.attemptId,
        codeMode: request.codeMode,
        codeId: request.codeId,
        journalEntries: request.journalEntries,
        operation: request.operation,
        value,
        workerLoaderCallbackRan,
        facetStartupCallbackRan,
      }),
    );
  }

  private async trackFacet(
    request: TrackedFacetIdentity,
  ): Promise<TrackFacetResult> {
    try {
      const facetName = request.facetId ?? request.attemptId;
      const outcome = this.ctx.storage.transactionSync(() => {
        const existing = this.sql.exec<{
          code_id: string;
          run_id: string;
          sample_id: string;
          scenario: string;
        }>(
          `SELECT code_id, run_id, sample_id, scenario
           FROM probe_active_facets
           WHERE facet_name = ?`,
          facetName,
        ).toArray()[0];
        if (existing !== undefined) {
          return existing.code_id === request.codeId &&
              existing.run_id === request.runId &&
              (existing.sample_id === request.sampleId ||
                request.scenario === "facet_finalizer_warm_invoke" ||
                request.scenario === "facet_finalizer_postgres_warm_invoke" ||
                request.scenario === "session_postgres_warm_invoke") &&
              existing.scenario === request.scenario
            ? "existing"
            : "identity-conflict";
        }
        this.sql.exec(
          `INSERT INTO probe_active_facets
             (facet_name, code_id, run_id, sample_id, scenario)
           VALUES (?, ?, ?, ?, ?)`,
          facetName,
          request.codeId,
          request.runId,
          request.sampleId,
          request.scenario,
        );
        return "inserted";
      });
      if (outcome === "identity-conflict") return "identity-conflict";
      if (outcome === "inserted") await this.ctx.storage.sync();
      return "tracked";
    } catch {
      return "storage-failure";
    }
  }

  private trackedFacetIdentity(
    request: ProbeFacetLifecycleRequestV1,
  ): TrackedFacetIdentityResult {
    try {
      const existing = this.sql.exec<{
        code_id: string;
        run_id: string;
        sample_id: string;
        scenario: string;
      }>(
        `SELECT code_id, run_id, sample_id, scenario
         FROM probe_active_facets
         WHERE facet_name = ?`,
        request.attemptId,
      ).toArray()[0];
      if (existing === undefined) return "absent";
      return existing.code_id === request.codeId &&
          existing.run_id === request.runId &&
          existing.sample_id === request.sampleId &&
          existing.scenario === request.scenario
        ? "match"
        : "identity-conflict";
    } catch {
      return "storage-failure";
    }
  }

  private async deleteTrackedFacet(attemptId: string): Promise<boolean> {
    try {
      this.ctx.facets.delete(attemptId);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "DELETE FROM probe_active_facets WHERE facet_name = ?",
          attemptId,
        );
      });
      await this.ctx.storage.sync();
      return true;
    } catch {
      return false;
    }
  }

  private control(
    request: Request,
    sessionId: ProbeSessionId,
    operation: "increment" | "read" | "reset",
  ): Response | Promise<Response> {
    if (
      (operation === "read" && request.method !== "GET") ||
      (operation !== "read" && request.method !== "POST")
    ) {
      return internalError("method_not_allowed", 405);
    }

    const value = this.ctx.storage.transactionSync(() => {
      switch (operation) {
        case "read":
          return readControlValue(this.sql);
        case "increment":
          return this.sql.exec<{ value: number }>(
            `UPDATE probe_session_control
             SET value = value + 1
             WHERE key = 'counter'
             RETURNING value`,
          ).one().value;
        case "reset":
          return this.sql.exec<{ value: number }>(
            `UPDATE probe_session_control
             SET value = 0
             WHERE key = 'counter'
             RETURNING value`,
          ).one().value;
      }
    });
    const response = noStoreJson(
      ProbeSessionControlResponseV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        sessionId,
        value,
      }),
    );
    if (operation === "read") return response;
    return this.ctx.storage.sync().then(() => response);
  }
}

export class ProbeSessionDO extends ProbeSessionDOBase {
  constructor(ctx: DurableObjectState, env: ProbeSessionEnv) {
    super(ctx, env, null);
  }
}

async function isKnownSettledFinalizationFailure(
  response: Response,
): Promise<boolean> {
  if (response.status !== 409) return false;
  try {
    const failure = decodeProbeFullInvokeSessionFailureV1OrNull(
      await response.clone().json(),
    );
    return failure?.executorHost === "facet-finalizer" ||
      failure?.executorHost === "session-postgres";
  } catch {
    return false;
  }
}

function sessionPostgresEnvOrNull(
  env: ProbeSessionEnv,
): ProbeSessionPostgresEnv | null {
  const hyperdrive = env.HYPERDRIVE_CACHE_DISABLED;
  const sync = env.PROBE_SYNC;
  return hyperdrive === undefined || sync === undefined
    ? null
    : {
        HYPERDRIVE_CACHE_DISABLED: hyperdrive,
        PROBE_SYNC: sync,
      };
}

async function readInternalPost(
  request: Request,
): Promise<unknown | Response> {
  if (request.method !== "POST") {
    return internalError("method_not_allowed", 405);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return internalError("invalid_content_type", 415);
  }
  const body = await readBoundedJson(request, MAX_INTERNAL_BODY_BYTES);
  if (!body.ok) {
    return internalError(
      body.reason,
      body.reason === "body_too_large" ? 413 : 400,
    );
  }
  return body.value;
}

async function decodeEchoRequest(
  value: unknown,
): Promise<ProbeSessionEchoRequestV1 | null> {
  return await protocolValueOrNull(
    decodeProbeSessionEchoRequestV1Effect(value),
  );
}

async function decodeFacetRequest(
  value: unknown,
): Promise<ProbeFacetInvokeRequestV1 | null> {
  return await protocolValueOrNull(
    decodeProbeFacetInvokeRequestV1Effect(value),
  );
}

async function decodeFacetWorkerResponse(
  value: unknown,
): Promise<ProbeFacetWorkerResponseV1 | null> {
  return await protocolValueOrNull(
    decodeProbeFacetWorkerResponseV1Effect(value),
  );
}

async function decodeFacetLifecycleRequest(
  value: unknown,
): Promise<ProbeFacetLifecycleRequestV1 | null> {
  return await protocolValueOrNull(
    decodeProbeFacetLifecycleRequestV1Effect(value),
  );
}

async function decodeFacetLifecycleWorkerResponse(
  value: unknown,
): Promise<ProbeFacetLifecycleWorkerResponseV1 | null> {
  return await protocolValueOrNull(
    decodeProbeFacetLifecycleWorkerResponseV1Effect(value),
  );
}

function decodeFullInvokeRequest(
  value: unknown,
): ProbeInvokeFacetRequestV1 | null {
  return decodeProbeInvokeFacetRequestV1OrNull(value);
}

function decodeFullInvokeWorkerResponse(
  value: unknown,
): ProbeInvokeFacetWorkerResponseV1 | null {
  return decodeProbeInvokeFacetWorkerResponseV1OrNull(value);
}

function decodeMockFinishResponse(
  value: unknown,
): ProbeMockFinishResponseV1 | null {
  return decodeProbeMockFinishResponseV1OrNull(value);
}

async function sameFullInvokeFacetReceipt(
  response: ProbeInvokeFacetWorkerResponseV1,
  request: ProbeInvokeFacetRequestV1,
): Promise<boolean> {
  return await probeInvokeFacetReceiptMatchesRequestV1(response, request);
}

function sameMockFinishReceipt(
  response: ProbeMockFinishResponseV1,
  request: ProbeMockFinishRequestV1,
): boolean {
  const receipt = response.request;
  if (
    receipt.scenario === "commit_wake" ||
    request.scenario === "commit_wake" ||
    receipt.scenario !== request.scenario
  ) {
    return false;
  }
  return receipt.protocolVersion === request.protocolVersion &&
    receipt.runId === request.runId &&
    receipt.sampleId === request.sampleId &&
    receipt.sampleOrdinal === request.sampleOrdinal &&
    receipt.scopeId === request.scopeId &&
    receipt.commitSeq === request.commitSeq &&
    receipt.sessionId === request.sessionId &&
    receipt.sessionMode === request.sessionMode &&
    receipt.attemptId === request.attemptId &&
    receipt.codeMode === request.codeMode &&
    receipt.codeId === request.codeId &&
    receipt.journalEntries === request.journalEntries &&
    receipt.sealDigest === request.sealDigest &&
    receipt.snapshotRevision === request.snapshotRevision &&
    receipt.resultDigest === request.resultDigest &&
    receipt.commitIntentDigest === request.commitIntentDigest;
}

function sameMockReadRequest(
  left: ProbeMockReadRequestV1,
  right: ProbeMockReadRequestV1,
): boolean {
  return left.protocolVersion === right.protocolVersion &&
    left.runId === right.runId &&
    left.sampleId === right.sampleId &&
    left.sampleOrdinal === right.sampleOrdinal &&
    left.scopeId === right.scopeId &&
    left.scenario === right.scenario &&
    left.commitSeq === right.commitSeq &&
    left.sessionId === right.sessionId &&
    left.sessionMode === right.sessionMode &&
    left.attemptId === right.attemptId &&
    left.codeMode === right.codeMode &&
    left.codeId === right.codeId &&
    left.payloadBytes === right.payloadBytes;
}

type InvokeAttemptAdmission =
  | { readonly kind: "start" }
  | { readonly kind: "replay"; readonly response: Response }
  | { readonly kind: "busy" }
  | { readonly kind: "conflict" }
  | { readonly kind: "storage-failure" };

function beginInvokeAttempt(
  sql: SqlStorage,
  request: ProbeInvokeFacetRequestV1,
  capabilityToken: string | null,
): InvokeAttemptAdmission {
  const requestJson = JSON.stringify(request);
  try {
    const existing = sql.exec<{
      phase: "running" | "finishing" | "completed";
      request_json: string;
      response_body: string | null;
      response_status: number | null;
    }>(
      `SELECT phase, request_json, response_status, response_body
       FROM probe_session_executor_attempts
       WHERE attempt_id = ?`,
      request.attemptId,
    ).toArray()[0];
    if (existing === undefined) {
      sql.exec(
        `INSERT INTO probe_session_executor_attempts
           (attempt_id, request_json, capability_token, phase,
            response_status, response_body)
         VALUES (?, ?, ?, 'running', NULL, NULL)`,
        request.attemptId,
        requestJson,
        capabilityToken,
      );
      return { kind: "start" };
    }
    if (existing.request_json !== requestJson) return { kind: "conflict" };
    if (existing.phase !== "completed") return { kind: "busy" };
    if (
      existing.response_status === null ||
      existing.response_body === null
    ) {
      return { kind: "storage-failure" };
    }
    return {
      kind: "replay",
      response: storedInvokeResponse(
        existing.response_body,
        existing.response_status,
      ),
    };
  } catch {
    return { kind: "storage-failure" };
  }
}

function recordSessionExecutorRead(
  storage: DurableObjectStorage,
  sql: SqlStorage,
  envelope: ProbeSessionExecutorReadEnvelope,
): boolean {
  try {
    return storage.transactionSync(() => {
      const row = sql.exec<{
        phase: string;
        read_calls: number;
        request_json: string;
        capability_token: string;
      }>(
        `SELECT phase, read_calls, request_json, capability_token
         FROM probe_session_executor_attempts
         WHERE attempt_id = ?`,
        envelope.expected.attemptId,
      ).toArray()[0];
      if (
        row?.phase !== "running" ||
        row.read_calls !== 0 ||
        row.capability_token !== envelope.capabilityToken
      ) {
        return false;
      }
      const invoke = decodeFullInvokeRequest(JSON.parse(row.request_json));
      if (
        invoke === null ||
        invoke.scenario !== "session_executor_invoke" ||
        !sameMockReadRequest(
          probeMockReadRequestFromInvoke(invoke),
          envelope.expected,
        )
      ) {
        return false;
      }
      sql.exec(
        `UPDATE probe_session_executor_attempts
         SET read_calls = 1
         WHERE attempt_id = ? AND phase = 'running' AND read_calls = 0`,
        envelope.expected.attemptId,
      );
      return true;
    });
  } catch {
    return false;
  }
}

function sessionExecutorReadCalls(
  sql: SqlStorage,
  request: ProbeInvokeFacetRequestV1,
): number | null {
  try {
    const row = sql.exec<{ read_calls: number; request_json: string }>(
      `SELECT read_calls, request_json
       FROM probe_session_executor_attempts
       WHERE attempt_id = ?`,
      request.attemptId,
    ).toArray()[0];
    return row?.request_json === JSON.stringify(request)
      ? row.read_calls
      : null;
  } catch {
    return null;
  }
}

function markInvokeAttemptFinishing(
  sql: SqlStorage,
  request: ProbeInvokeFacetRequestV1,
): boolean {
  try {
    const row = sql.exec<{ phase: string; request_json: string }>(
      `SELECT phase, request_json
       FROM probe_session_executor_attempts
       WHERE attempt_id = ?`,
      request.attemptId,
    ).toArray()[0];
    if (row?.request_json !== JSON.stringify(request)) {
      return false;
    }
    if (row.phase === "finishing") return true;
    if (row.phase !== "running") return false;
    sql.exec(
      `UPDATE probe_session_executor_attempts
       SET phase = 'finishing'
       WHERE attempt_id = ? AND phase = 'running'`,
      request.attemptId,
    );
    return true;
  } catch {
    return false;
  }
}

async function completeInvokeResponse(
  storage: DurableObjectStorage,
  sql: SqlStorage,
  request: ProbeInvokeFacetRequestV1,
  response: Response,
): Promise<Response> {
  const body = await response.clone().text();
  if (new TextEncoder().encode(body).byteLength > MAX_INTERNAL_RESPONSE_BYTES) {
    return internalError(invokeAttemptError(request, "response_too_large"), 500);
  }
  try {
    const row = sql.exec<{ phase: string; request_json: string }>(
      `SELECT phase, request_json
       FROM probe_session_executor_attempts
       WHERE attempt_id = ?`,
      request.attemptId,
    ).toArray()[0];
    if (
      row === undefined ||
      row.request_json !== JSON.stringify(request) ||
      (row.phase !== "running" && row.phase !== "finishing")
    ) {
      return internalError(invokeAttemptError(request, "state_failure"), 500);
    }
    sql.exec(
      `UPDATE probe_session_executor_attempts
       SET phase = 'completed', response_status = ?, response_body = ?
       WHERE attempt_id = ?`,
      response.status,
      body,
      request.attemptId,
    );
    await storage.sync();
    return response;
  } catch {
    return internalError(invokeAttemptError(request, "state_failure"), 500);
  }
}

function storedInvokeResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function invokeAttemptError(
  request: ProbeInvokeFacetRequestV1,
  suffix: "response_too_large" | "state_failure",
): string {
  return request.scenario === "facet_executor_invoke"
    ? `facet_executor_${suffix}`
    : request.scenario === "facet_finalizer_invoke" ||
        request.scenario === "facet_finalizer_warm_invoke" ||
        request.scenario === "facet_finalizer_postgres_warm_invoke"
    ? `facet_finalizer_${suffix}`
    : request.scenario === "executor_worker_invoke"
    ? `executor_worker_${suffix}`
    : `session_executor_${suffix}`;
}

function initializeSessionStorage(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_control (
    key TEXT PRIMARY KEY CHECK (key = 'counter'),
    value INTEGER NOT NULL CHECK (value >= 0)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_active_facets (
    facet_name TEXT PRIMARY KEY,
    code_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sample_id TEXT NOT NULL,
    scenario TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_executor_attempts (
    attempt_id TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    capability_token TEXT,
    phase TEXT NOT NULL CHECK (phase IN ('running', 'finishing', 'completed')),
    read_calls INTEGER NOT NULL DEFAULT 0 CHECK (read_calls BETWEEN 0 AND 1),
    response_status INTEGER,
    response_body TEXT,
    CHECK (
      (phase = 'completed' AND response_status BETWEEN 100 AND 599 AND response_body IS NOT NULL)
      OR
      (phase <> 'completed' AND response_status IS NULL AND response_body IS NULL)
    )
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_purge_facets (
    facet_name TEXT PRIMARY KEY,
    code_id TEXT NOT NULL,
    scenario TEXT NOT NULL,
    phase TEXT NOT NULL
      CHECK (phase IN ('pending', 'prepared', 'absent', 'deleted'))
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_purge_plan (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    request_json TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_purge_completion (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    request_json TEXT NOT NULL,
    deleted_facets INTEGER NOT NULL CHECK (deleted_facets >= 0)
  )`);
  sql.exec(
    `INSERT OR IGNORE INTO probe_session_control (key, value)
     SELECT 'counter', 0
     WHERE NOT EXISTS (
       SELECT 1 FROM probe_session_purge_completion WHERE singleton = 1
     )`,
  );
}

function assertExactSessionPurgeTombstone(sql: SqlStorage): void {
  const rows = sql.exec<{
    active_facets: number;
    control_rows: number;
    executor_attempts: number;
    purge_facets: number;
    purge_plans: number;
    purge_tombstones: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM probe_active_facets) AS active_facets,
       (SELECT COUNT(*) FROM probe_session_control) AS control_rows,
       (SELECT COUNT(*) FROM probe_session_executor_attempts)
         AS executor_attempts,
       (SELECT COUNT(*) FROM probe_session_purge_facets) AS purge_facets,
       (SELECT COUNT(*) FROM probe_session_purge_plan) AS purge_plans,
       (SELECT COUNT(*) FROM probe_session_purge_completion)
         AS purge_tombstones`,
  ).one();
  if (
    rows.active_facets !== 0 ||
    rows.control_rows !== 0 ||
    rows.executor_attempts !== 0 ||
    rows.purge_facets !== 0 ||
    rows.purge_plans !== 0 ||
    rows.purge_tombstones !== 1
  ) {
    throw new Error("probe session purge tombstone is not exact");
  }
}

function countPendingPurgeFacets(sql: SqlStorage): number {
  return sql.exec<{ count: number }>(
    `SELECT COUNT(*) AS count FROM probe_session_purge_facets
     WHERE phase NOT IN ('absent', 'deleted')`,
  ).one().count;
}

function sessionPurgeStarted(sql: SqlStorage): boolean {
  return sql.exec<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM probe_session_purge_facets) +
       (SELECT COUNT(*) FROM probe_session_purge_plan) +
       (SELECT COUNT(*) FROM probe_session_purge_completion)
     ) AS count`,
  ).one().count > 0;
}

function readControlValue(sql: SqlStorage): number {
  return sql.exec<{ value: number }>(
    `SELECT value
     FROM probe_session_control
     WHERE key = 'counter'`,
  ).one().value;
}

function decodeObjectSessionId(value: string | undefined): ProbeSessionId | null {
  if (value === undefined) return null;
  try {
    return ProbeSessionIdSchema.make(value);
  } catch {
    return null;
  }
}

function isProbeCodeProfile(codeId: string, profile: string): boolean {
  return codeId.startsWith(`rtp-code-${profile}-v2-`);
}

function internalError(error: string, status: number): Response {
  return noStoreJson({ error }, status);
}

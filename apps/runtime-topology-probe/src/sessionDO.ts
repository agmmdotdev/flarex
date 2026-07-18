import { DurableObject } from "cloudflare:workers";
import { compareUtf16Strings } from "@flarex/utils/strings";

import {
  copyCloudflareRpcRecord,
  protocolValueOrNull,
} from "./effectBoundary";
import {
  decodeProbeMockFinishResponseV1OrNull,
  ProbeMockFinishRequestV1Schema,
  type ProbeMockFinishRequestV1,
  type ProbeMockFinishResponseV1,
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
  probeInvokeJournalSealDigest,
  probeInvokeWorkerCode,
  PROBE_INVOKE_FACET_CLASS_NAME,
  ProbeFullInvokeSessionFailureV1Schema,
  ProbeFullInvokeSessionResponseV1Schema,
  type ProbeInvokeFacetRequestV1,
  type ProbeInvokeFacetWorkerResponseV1,
} from "./invokeProtocol";
import type {
  MockFinishEntrypoint,
  MockReadEntrypoint,
} from "./mockCommitWorker";
import {
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
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
  readonly LOADER?: WorkerLoader;
  readonly MOCK_FINISH?: Service<typeof MockFinishEntrypoint>;
  readonly MOCK_READ?: Service<typeof MockReadEntrypoint>;
}

interface TrackedFacetIdentity {
  readonly attemptId: string;
  readonly codeId: string;
  readonly runId: string;
  readonly sampleId: string;
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

export class ProbeSessionDO extends DurableObject<ProbeSessionEnv> {
  private readonly sql = this.ctx.storage.sql;
  private storageInitialized = true;
  private activeOperations = 0;
  private purgeTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: ProbeSessionEnv) {
    super(ctx, env);
    initializeSessionStorage(this.sql);
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
    const tracked = this.sql.exec<{ facet_name: string; code_id: string }>(
      `SELECT facet_name, code_id FROM probe_active_facets ORDER BY facet_name`,
    ).toArray();
    for (const row of tracked) {
      const trackedFacet = {
        attemptId: ProbeAttemptIdSchema.make(row.facet_name),
        codeId: ProbeCodeIdSchema.make(row.code_id),
      };
      const existing = facets.get(row.facet_name);
      if (existing !== undefined && existing.codeId !== trackedFacet.codeId) {
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
        const existing = this.sql.exec<{ code_id: string }>(
          `SELECT code_id FROM probe_session_purge_facets
           WHERE facet_name = ?`,
          facet.attemptId,
        ).toArray()[0];
        if (existing !== undefined && existing.code_id !== facet.codeId) {
          throw new Error("probe session purge facet identity conflict");
        }
        this.sql.exec(
          `INSERT OR IGNORE INTO probe_session_purge_facets
             (facet_name, code_id, phase)
           VALUES (?, ?, 'pending')`,
          facet.attemptId,
          facet.codeId,
        );
      }
    });
    const next = this.sql.exec<{
      facet_name: string;
      code_id: string;
      phase: "pending" | "prepared";
    }>(
      `SELECT facet_name, code_id, phase
       FROM probe_session_purge_facets
       WHERE phase <> 'deleted'
       ORDER BY facet_name
       LIMIT 1`,
    ).toArray()[0];
    if (next?.phase === "pending") {
      const loader = this.env.LOADER;
      if (loader === undefined) {
        throw new Error("probe session purge requires Worker Loader");
      }
      await this.ensurePurgeFacet(loader, {
        attemptId: ProbeAttemptIdSchema.make(next.facet_name),
        codeId: ProbeCodeIdSchema.make(next.code_id),
      });
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
    loader: WorkerLoader,
    facet: ProbeSessionPurgeRequestV1["facets"][number],
  ): Promise<void> {
    let stub: Fetcher;
    if (facet.codeId.startsWith("rtp-code-facet-v1-")) {
      const worker = loader.get(facet.codeId, () => probeFacetWorkerCode());
      stub = this.ctx.facets.get(facet.attemptId, () => ({
        id: facet.attemptId,
        class: worker.getDurableObjectClass(PROBE_FACET_CLASS_NAME),
      }));
    } else if (facet.codeId.startsWith("rtp-code-invoke-v1-")) {
      const mockRead = this.env.MOCK_READ;
      if (mockRead === undefined) {
        throw new Error("probe invoke purge requires mock-read capability");
      }
      const worker = loader.get(
        facet.codeId,
        () => probeInvokeWorkerCode(mockRead),
      );
      stub = this.ctx.facets.get(facet.attemptId, () => ({
        id: facet.attemptId,
        class: worker.getDurableObjectClass(PROBE_INVOKE_FACET_CLASS_NAME),
      }));
    } else if (facet.codeId.startsWith("rtp-code-rerun-v1-")) {
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
    if (decoded.sessionId !== sessionId) {
      return internalError("session_identity_mismatch", 409);
    }
    const loader = this.env.LOADER;
    const mockRead = this.env.MOCK_READ;
    const mockFinish = this.env.MOCK_FINISH;
    if (loader === undefined || mockRead === undefined || mockFinish === undefined) {
      return internalError("invoke_capability_unavailable", 500);
    }
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
        response: await this.executeFullInvoke(
          loader,
          mockRead,
          mockFinish,
          decoded,
        ),
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

  private async executeFullInvoke(
    loader: WorkerLoader,
    mockRead: Service<typeof MockReadEntrypoint>,
    mockFinish: Service<typeof MockFinishEntrypoint>,
    request: ProbeInvokeFacetRequestV1,
  ): Promise<Response> {
    const observations: FacetCallbackObservations = {
      facetStartupCallbackRan: false,
      workerLoaderCallbackRan: false,
    };
    const facetStartedAt = performance.now();
    let facetResponse: Response;
    try {
      const facet = this.ctx.facets.get(request.attemptId, () => {
        observations.facetStartupCallbackRan = true;
        const worker = loader.get(request.codeId, () => {
          observations.workerLoaderCallbackRan = true;
          return probeInvokeWorkerCode(mockRead);
        });
        return {
          id: request.attemptId,
          class: worker.getDurableObjectClass(PROBE_INVOKE_FACET_CLASS_NAME),
        };
      });
      facetResponse = await facet.fetch(
        new Request("https://probe-facet.internal/v1/full-invoke", {
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
    });
    const finishStartedAt = performance.now();
    let finish: ProbeMockFinishResponseV1 | null;
    try {
      const rawFinish = await mockFinish.finish(finishRequest);
      finish = decodeMockFinishResponse(
        copyCloudflareRpcRecord(rawFinish),
      );
    } catch {
      return internalError("mock_finish_transport_failure", 502);
    }
    if (finish === null || !sameMockFinishReceipt(finish, finishRequest)) {
      return internalError("mock_finish_receipt_mismatch", 502);
    }
    const sessionMockFinishDurationMs =
      elapsedPerformanceDurationSince(finishStartedAt);
    const observation = {
      facet: facetReceipt,
      facetDurationMs: ProbeDurationMsSchema.make(facetDurationMs),
      workerLoaderCallbackRan: observations.workerLoaderCallbackRan,
      facetStartupCallbackRan: observations.facetStartupCallbackRan,
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
      const outcome = this.ctx.storage.transactionSync(() => {
        const existing = this.sql.exec<{
          code_id: string;
          run_id: string;
          sample_id: string;
        }>(
          `SELECT code_id, run_id, sample_id
           FROM probe_active_facets
           WHERE facet_name = ?`,
          request.attemptId,
        ).toArray()[0];
        if (existing !== undefined) {
          return existing.code_id === request.codeId &&
              existing.run_id === request.runId &&
              existing.sample_id === request.sampleId
            ? "existing"
            : "identity-conflict";
        }
        this.sql.exec(
          `INSERT INTO probe_active_facets
             (facet_name, code_id, run_id, sample_id)
           VALUES (?, ?, ?, ?)`,
          request.attemptId,
          request.codeId,
          request.runId,
          request.sampleId,
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
      }>(
        `SELECT code_id, run_id, sample_id
         FROM probe_active_facets
         WHERE facet_name = ?`,
        request.attemptId,
      ).toArray()[0];
      if (existing === undefined) return "absent";
      return existing.code_id === request.codeId &&
          existing.run_id === request.runId &&
          existing.sample_id === request.sampleId
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
  return response.protocolVersion === request.protocolVersion &&
    response.runId === request.runId &&
    response.sampleId === request.sampleId &&
    response.sampleOrdinal === request.sampleOrdinal &&
    response.scopeId === request.scopeId &&
    response.scenario === request.scenario &&
    response.commitSeq === request.commitSeq &&
    response.sessionId === request.sessionId &&
    response.sessionMode === request.sessionMode &&
    response.attemptId === request.attemptId &&
    response.codeMode === request.codeMode &&
    response.codeId === request.codeId &&
    response.journalEntries === request.journalEntries &&
    response.payloadBytes === request.payload.length &&
    response.syntheticRevision === request.commitSeq - 1 &&
    response.sealDigest === await probeInvokeJournalSealDigest(request);
}

function sameMockFinishReceipt(
  response: ProbeMockFinishResponseV1,
  request: ProbeMockFinishRequestV1,
): boolean {
  const receipt = response.request;
  if (receipt.scenario !== "full_invoke" || request.scenario !== "full_invoke") {
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
    receipt.sealDigest === request.sealDigest;
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
    sample_id TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_purge_facets (
    facet_name TEXT PRIMARY KEY,
    code_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('pending', 'prepared', 'deleted'))
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
    purge_facets: number;
    purge_plans: number;
    purge_tombstones: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM probe_active_facets) AS active_facets,
       (SELECT COUNT(*) FROM probe_session_control) AS control_rows,
       (SELECT COUNT(*) FROM probe_session_purge_facets) AS purge_facets,
       (SELECT COUNT(*) FROM probe_session_purge_plan) AS purge_plans,
       (SELECT COUNT(*) FROM probe_session_purge_completion)
         AS purge_tombstones`,
  ).one();
  if (
    rows.active_facets !== 0 ||
    rows.control_rows !== 0 ||
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
     WHERE phase <> 'deleted'`,
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

function internalError(error: string, status: number): Response {
  return noStoreJson({ error }, status);
}

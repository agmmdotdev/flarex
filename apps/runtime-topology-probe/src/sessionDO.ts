import { DurableObject } from "cloudflare:workers";

import { protocolValueOrNull } from "./effectBoundary";
import {
  decodeProbeFacetInvokeRequestV1Effect,
  decodeProbeFacetLifecycleRequestV1Effect,
  decodeProbeFacetLifecycleWorkerResponseV1Effect,
  decodeProbeFacetWorkerResponseV1Effect,
  probeFacetJournalSealDigest,
  probeFacetWorkerCode,
  PROBE_FACET_CLASS_NAME,
  ProbeFacetLifecycleSessionResponseV1Schema,
  ProbeFacetSessionResponseV1Schema,
  type ProbeFacetInvokeRequestV1,
  type ProbeFacetLifecycleRequestV1,
  type ProbeFacetLifecycleWorkerResponseV1,
  type ProbeFacetWorkerResponseV1,
} from "./facetProtocol";
import { ProbeSessionIdSchema, type ProbeSessionId } from "./identity";
import { noStoreJson, readBoundedJson } from "./http";
import {
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
} from "./protocol";
import {
  decodeProbeSessionEchoRequestV1Effect,
  ProbeSessionControlResponseV1Schema,
  ProbeSessionEchoResponseV1Schema,
  type ProbeSessionEchoRequestV1,
} from "./sessionProtocol";

const INTERNAL_BODY_OVERHEAD_BYTES = 8_192;
const MAX_INTERNAL_BODY_BYTES =
  PROBE_LIMITS_V1.maxPayloadBytes + INTERNAL_BODY_OVERHEAD_BYTES;
const MAX_INTERNAL_RESPONSE_BYTES = 8_192;

const sessionRoutes = {
  echo: "/v1/echo",
  facet: "/v1/facet",
  facetLifecycle: "/v1/facet-lifecycle",
  controlIncrement: "/v1/control/increment",
  controlRead: "/v1/control/read",
  controlReset: "/v1/control/reset",
} as const;

export interface ProbeSessionEnv {
  readonly LOADER?: WorkerLoader;
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

  constructor(ctx: DurableObjectState, env: ProbeSessionEnv) {
    super(ctx, env);
    initializeSessionStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
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
      !(await sameFacetReceipt(decoded, request))
    ) {
      return internalError("facet_receipt_mismatch", 502);
    }
    const facetDurationMs = elapsedSince(startedAt);

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
    request: ProbeFacetInvokeRequestV1 | ProbeFacetLifecycleRequestV1,
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

async function sameFacetReceipt(
  response: ProbeFacetWorkerResponseV1,
  request: ProbeFacetInvokeRequestV1,
): Promise<boolean> {
  return response.protocolVersion === request.protocolVersion &&
    response.runId === request.runId &&
    response.sampleId === request.sampleId &&
    response.sampleOrdinal === request.sampleOrdinal &&
    response.scenario === request.scenario &&
    response.sessionId === request.sessionId &&
    response.sessionMode === request.sessionMode &&
    response.attemptId === request.attemptId &&
    response.codeMode === request.codeMode &&
    response.codeId === request.codeId &&
    response.journalEntries === request.journalEntries &&
    response.payloadBytes === request.payload.length &&
    response.sealDigest === await probeFacetJournalSealDigest(request);
}

function initializeSessionStorage(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_session_control (
    key TEXT PRIMARY KEY CHECK (key = 'counter'),
    value INTEGER NOT NULL CHECK (value >= 0)
  )`);
  sql.exec(
    `INSERT OR IGNORE INTO probe_session_control (key, value)
     VALUES ('counter', 0)`,
  );
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_active_facets (
    facet_name TEXT PRIMARY KEY,
    code_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sample_id TEXT NOT NULL
  )`);
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

function elapsedSince(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function isJsonContentType(value: string | null): boolean {
  return value !== null &&
    value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function internalError(error: string, status: number): Response {
  return noStoreJson({ error }, status);
}

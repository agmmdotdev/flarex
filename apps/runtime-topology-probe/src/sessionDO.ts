import { DurableObject } from "cloudflare:workers";
import { protocolValueOrNull } from "./effectBoundary";
import { ProbeSessionIdSchema, type ProbeSessionId } from "./identity";
import { noStoreJson, readBoundedJson } from "./http";
import {
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
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

const sessionRoutes = {
  echo: "/v1/echo",
  controlIncrement: "/v1/control/increment",
  controlRead: "/v1/control/read",
  controlReset: "/v1/control/reset",
} as const;

export class ProbeSessionDO extends DurableObject<Cloudflare.Env> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
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
    if (request.method !== "POST") {
      return internalError("method_not_allowed", 405);
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return internalError("invalid_content_type", 415);
    }
    const body = await readBoundedJson(request, MAX_INTERNAL_BODY_BYTES);
    if (!body.ok) {
      return internalError(body.reason, body.reason === "body_too_large" ? 413 : 400);
    }
    const decoded = await decodeEchoRequest(body.value);
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

async function decodeEchoRequest(
  value: unknown,
): Promise<ProbeSessionEchoRequestV1 | null> {
  return await protocolValueOrNull(
    decodeProbeSessionEchoRequestV1Effect(value),
  );
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

function isJsonContentType(value: string | null): boolean {
  return value !== null &&
    value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function internalError(error: string, status: number): Response {
  return noStoreJson({ error }, status);
}

import { Data, Effect, Schema } from "effect";

import {
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeSessionId,
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeCodeModeSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  ProbeSessionIdSchema,
  PROBE_ORDINAL_ZERO,
} from "./identity";
import {
  PROBE_LIMITS_V1,
  ProbeDurationMsSchema,
  ProbeProtocolVersionV1Schema,
  ProbeSessionModeSchema,
} from "./protocol";
import { sha256Hex } from "./sha256";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

const FacetScenarioSchema = Schema.Literals(["facet_echo", "facet_journal"]);
const SyntheticPayloadSchema = Schema.String.check(Schema.isPattern(/^x*$/));
const PayloadBytesSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= PROBE_LIMITS_V1.maxPayloadBytes
      ? undefined
      : "payloadBytes exceeds the protocol limit"
  ),
);
const JournalEntriesSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= PROBE_LIMITS_V1.maxJournalEntries
      ? undefined
      : "journalEntries exceeds the protocol limit"
  ),
);
const SealDigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

const FacetIdentityShape = {
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  scenario: FacetScenarioSchema,
  sessionId: ProbeSessionIdSchema,
  sessionMode: ProbeSessionModeSchema,
  attemptId: ProbeAttemptIdSchema,
  codeMode: ProbeCodeModeSchema,
  codeId: ProbeCodeIdSchema,
  journalEntries: JournalEntriesSchema,
} as const;

const ProbeFacetInvokeRequestV1Shape = Schema.Struct({
  ...FacetIdentityShape,
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeFacetInvokeRequestV1Schema =
  ProbeFacetInvokeRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = facetIdentityIssue(request);
      if (identityIssue !== undefined) return identityIssue;
      if (request.payload.length > PROBE_LIMITS_V1.maxPayloadBytes) {
        return "payload exceeds the protocol byte limit";
      }
      return request.scenario === "facet_echo" && request.journalEntries !== 0
        ? "facet_echo requires zero journal entries"
        : undefined;
    }),
  );
export type ProbeFacetInvokeRequestV1 =
  typeof ProbeFacetInvokeRequestV1Schema.Type;

const ProbeFacetWorkerResponseV1Shape = Schema.Struct({
  ...FacetIdentityShape,
  payloadBytes: PayloadBytesSchema,
  journalDurationMs: Schema.Union([ProbeDurationMsSchema, Schema.Null]),
  sealDigest: Schema.Union([SealDigestSchema, Schema.Null]),
}).annotate(StrictStructOptions);

export const ProbeFacetWorkerResponseV1Schema =
  ProbeFacetWorkerResponseV1Shape.check(
    Schema.makeFilter(response => {
      const identityIssue = facetIdentityIssue(response);
      if (identityIssue !== undefined) return identityIssue;
      return facetJournalReceiptIssue(response);
    }),
  );
export type ProbeFacetWorkerResponseV1 =
  typeof ProbeFacetWorkerResponseV1Schema.Type;

const ProbeFacetSessionResponseV1Shape = Schema.Struct({
  ...FacetIdentityShape,
  payloadBytes: PayloadBytesSchema,
  facetDurationMs: ProbeDurationMsSchema,
  journalDurationMs: Schema.Union([ProbeDurationMsSchema, Schema.Null]),
  sealDigest: Schema.Union([SealDigestSchema, Schema.Null]),
  workerLoaderCallbackRan: Schema.Boolean,
  facetStartupCallbackRan: Schema.Boolean,
}).annotate(StrictStructOptions);

export const ProbeFacetSessionResponseV1Schema =
  ProbeFacetSessionResponseV1Shape.check(
    Schema.makeFilter(response => {
      const identityIssue = facetIdentityIssue(response);
      if (identityIssue !== undefined) return identityIssue;
      const journalIssue = facetJournalReceiptIssue(response);
      if (journalIssue !== undefined) return journalIssue;
      return response.workerLoaderCallbackRan &&
          !response.facetStartupCallbackRan
        ? "Worker Loader callback cannot run without facet startup"
        : undefined;
    }),
  );
export type ProbeFacetSessionResponseV1 =
  typeof ProbeFacetSessionResponseV1Schema.Type;

export async function probeFacetJournalSealDigest(
  request: ProbeFacetInvokeRequestV1,
): Promise<string | null> {
  if (request.scenario !== "facet_journal") return null;
  const payloadDigest = await sha256Hex(request.payload);
  return await sha256Hex(canonicalJournalSeal(request, payloadDigest));
}

export async function probeFacetReceiptMatchesRequest(
  response: ProbeFacetWorkerResponseV1 | ProbeFacetSessionResponseV1,
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

export const ProbeFacetLifecycleOperationSchema = Schema.Literals([
  "abort",
  "append",
  "delete",
  "read",
]);
export type ProbeFacetLifecycleOperation =
  typeof ProbeFacetLifecycleOperationSchema.Type;

const ProbeFacetLifecycleRequestV1Shape = Schema.Struct({
  ...FacetIdentityShape,
  operation: ProbeFacetLifecycleOperationSchema,
}).annotate(StrictStructOptions);

export const ProbeFacetLifecycleRequestV1Schema =
  ProbeFacetLifecycleRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = facetIdentityIssue(request);
      if (identityIssue !== undefined) return identityIssue;
      return request.scenario === "facet_echo" && request.journalEntries === 0
        ? undefined
        : "lifecycle controls use the canonical facet_echo dimensions";
    }),
  );
export type ProbeFacetLifecycleRequestV1 =
  typeof ProbeFacetLifecycleRequestV1Schema.Type;

export const ProbeFacetLifecycleWorkerResponseV1Schema = Schema.Struct({
  attemptId: ProbeAttemptIdSchema,
  codeId: ProbeCodeIdSchema,
  operation: Schema.Literals(["append", "read"]),
  value: Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value >= 0 ? undefined : "lifecycle value must be non-negative"
    ),
  ),
}).annotate(StrictStructOptions);
export type ProbeFacetLifecycleWorkerResponseV1 =
  typeof ProbeFacetLifecycleWorkerResponseV1Schema.Type;

const ProbeFacetLifecycleSessionResponseV1Shape = Schema.Struct({
  ...FacetIdentityShape,
  operation: ProbeFacetLifecycleOperationSchema,
  value: Schema.Union([
    Schema.Int.check(
      Schema.makeFilter((value: number) =>
        value >= 0 ? undefined : "lifecycle value must be non-negative"
      ),
    ),
    Schema.Null,
  ]),
  workerLoaderCallbackRan: Schema.Boolean,
  facetStartupCallbackRan: Schema.Boolean,
}).annotate(StrictStructOptions);

export const ProbeFacetLifecycleSessionResponseV1Schema =
  ProbeFacetLifecycleSessionResponseV1Shape.check(
    Schema.makeFilter(response => {
      const identityIssue = facetIdentityIssue(response);
      if (identityIssue !== undefined) return identityIssue;
      if (
        response.scenario !== "facet_echo" ||
        response.journalEntries !== 0
      ) {
        return "lifecycle responses use the canonical facet_echo dimensions";
      }
      const invokesFacet = response.operation === "append" ||
        response.operation === "read";
      if ((response.value !== null) !== invokesFacet) {
        return "only append and read lifecycle operations return a value";
      }
      if (
        !invokesFacet &&
        (response.workerLoaderCallbackRan || response.facetStartupCallbackRan)
      ) {
        return "abort and delete do not start a Worker or facet";
      }
      return response.workerLoaderCallbackRan &&
          !response.facetStartupCallbackRan
        ? "Worker Loader callback cannot run without facet startup"
        : undefined;
    }),
  );
export type ProbeFacetLifecycleSessionResponseV1 =
  typeof ProbeFacetLifecycleSessionResponseV1Schema.Type;

export class ProbeFacetProtocolValidationError extends Data.TaggedError(
  "ProbeFacetProtocolValidationError",
)<{
  readonly boundary:
    | "invoke-request"
    | "worker-response"
    | "session-response"
    | "lifecycle-request"
    | "lifecycle-worker-response"
    | "lifecycle-session-response";
  readonly cause: unknown;
}> {}

const decodeUnknownFacetInvokeRequest = Schema.decodeUnknownEffect(
  ProbeFacetInvokeRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownFacetWorkerResponse = Schema.decodeUnknownEffect(
  ProbeFacetWorkerResponseV1Schema,
  StrictParseOptions,
);
const decodeUnknownFacetSessionResponse = Schema.decodeUnknownEffect(
  ProbeFacetSessionResponseV1Schema,
  StrictParseOptions,
);
const decodeUnknownFacetLifecycleRequest = Schema.decodeUnknownEffect(
  ProbeFacetLifecycleRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownFacetLifecycleWorkerResponse = Schema.decodeUnknownEffect(
  ProbeFacetLifecycleWorkerResponseV1Schema,
  StrictParseOptions,
);
const decodeUnknownFacetLifecycleSessionResponse = Schema.decodeUnknownEffect(
  ProbeFacetLifecycleSessionResponseV1Schema,
  StrictParseOptions,
);

function mapFacetValidationError(
  boundary: ProbeFacetProtocolValidationError["boundary"],
) {
  return (cause: unknown) =>
    new ProbeFacetProtocolValidationError({ boundary, cause });
}

export const decodeProbeFacetInvokeRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFacetInvokeRequestV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeFacetInvokeRequestV1,
  ProbeFacetProtocolValidationError
> {
  return yield* decodeUnknownFacetInvokeRequest(value).pipe(
    Effect.mapError(mapFacetValidationError("invoke-request")),
  );
});

export const decodeProbeFacetWorkerResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFacetWorkerResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeFacetWorkerResponseV1,
  ProbeFacetProtocolValidationError
> {
  return yield* decodeUnknownFacetWorkerResponse(value).pipe(
    Effect.mapError(mapFacetValidationError("worker-response")),
  );
});

export const decodeProbeFacetSessionResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFacetSessionResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeFacetSessionResponseV1,
  ProbeFacetProtocolValidationError
> {
  return yield* decodeUnknownFacetSessionResponse(value).pipe(
    Effect.mapError(mapFacetValidationError("session-response")),
  );
});

export const decodeProbeFacetLifecycleRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFacetLifecycleRequestV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeFacetLifecycleRequestV1,
  ProbeFacetProtocolValidationError
> {
  return yield* decodeUnknownFacetLifecycleRequest(value).pipe(
    Effect.mapError(mapFacetValidationError("lifecycle-request")),
  );
});

export const decodeProbeFacetLifecycleWorkerResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFacetLifecycleWorkerResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeFacetLifecycleWorkerResponseV1,
  ProbeFacetProtocolValidationError
> {
  return yield* decodeUnknownFacetLifecycleWorkerResponse(value).pipe(
    Effect.mapError(mapFacetValidationError("lifecycle-worker-response")),
  );
});

export const decodeProbeFacetLifecycleSessionResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFacetLifecycleSessionResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeFacetLifecycleSessionResponseV1,
  ProbeFacetProtocolValidationError
> {
  return yield* decodeUnknownFacetLifecycleSessionResponse(value).pipe(
    Effect.mapError(mapFacetValidationError("lifecycle-session-response")),
  );
});

function facetIdentityIssue(input: {
  readonly attemptId: typeof ProbeAttemptIdSchema.Type;
  readonly codeId: typeof ProbeCodeIdSchema.Type;
  readonly codeMode: typeof ProbeCodeModeSchema.Type;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleId: typeof ProbeSampleIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
  readonly sessionId: typeof ProbeSessionIdSchema.Type;
  readonly sessionMode: typeof ProbeSessionModeSchema.Type;
}): string | undefined {
  if (input.sampleId !== probeSampleId(input.runId, input.sampleOrdinal)) {
    return "sampleId must be derived from runId and sampleOrdinal";
  }
  const sessionOrdinal = input.sessionMode === "reuse-session"
    ? PROBE_ORDINAL_ZERO
    : input.sampleOrdinal;
  if (input.sessionId !== probeSessionId(input.runId, sessionOrdinal)) {
    return "sessionId must be derived from runId and sessionMode";
  }
  if (
    input.attemptId !== probeAttemptId(
      input.runId,
      sessionOrdinal,
      input.sampleOrdinal,
    )
  ) {
    return "attemptId must identify this exact session attempt";
  }
  const expectedCodeId = input.codeMode === "stable"
    ? probeCodeId({ mode: "stable", profile: "facet" })
    : probeCodeId({
        mode: "new-code",
        profile: "facet",
        runId: input.runId,
        version: input.sampleOrdinal,
      });
  return input.codeId === expectedCodeId
    ? undefined
    : "codeId must identify the facet-v2 source and code mode";
}

function facetJournalReceiptIssue(input: {
  readonly journalDurationMs: unknown;
  readonly journalEntries: number;
  readonly scenario: "facet_echo" | "facet_journal";
  readonly sealDigest: unknown;
}): string | undefined {
  if (input.scenario === "facet_echo") {
    return input.journalEntries === 0 &&
        input.journalDurationMs === null &&
        input.sealDigest === null
      ? undefined
      : "facet_echo cannot return journal evidence";
  }
  return input.journalDurationMs !== null && input.sealDigest !== null
    ? undefined
    : "facet_journal requires journal duration and seal evidence";
}

function canonicalJournalSeal(
  request: ProbeFacetInvokeRequestV1,
  payloadDigest: string,
): string {
  return JSON.stringify([
    1,
    request.runId,
    request.sampleId,
    request.sessionId,
    request.attemptId,
    request.codeId,
    request.journalEntries,
    request.payload.length,
    payloadDigest,
    Array.from({ length: request.journalEntries }, (_, sequence) => sequence),
  ]);
}

export const PROBE_FACET_WORKER_MAIN_MODULE = "probe-facet-worker.js";
export const PROBE_FACET_CLASS_NAME = "ProbeInvocationFacet";

export function probeFacetWorkerCode(): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: "2026-06-14",
    mainModule: PROBE_FACET_WORKER_MAIN_MODULE,
    modules: { [PROBE_FACET_WORKER_MAIN_MODULE]: PROBE_FACET_WORKER_SOURCE },
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 2 },
  };
}

const PROBE_FACET_WORKER_SOURCE = `
import { DurableObject } from "cloudflare:workers";

const MAX_BODY_BYTES = 73728;
const MAX_JOURNAL_ENTRIES = 256;
const MAX_PAYLOAD_BYTES = 65536;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const INVOKE_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "journalEntries",
  "payload",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "sessionId",
  "sessionMode"
];

export class ProbeInvocationFacet extends DurableObject {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method !== "POST") return json({ error: "not_found" }, 404);
    if (pathname === "/v1/purge-ensure") return await this.ensurePurgeStorage();
    if (pathname === "/v1/invoke") return await this.invoke(request);
    if (pathname === "/v1/lifecycle") return await this.lifecycle(request);
    return json({ error: "not_found" }, 404);
  }

  async ensurePurgeStorage() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS probe_purge_marker (singleton INTEGER PRIMARY KEY CHECK (singleton = 1))");
    sql.exec("INSERT OR IGNORE INTO probe_purge_marker (singleton) VALUES (1)");
    await this.ctx.storage.sync();
    return json({ kind: "purge-ready" }, 200);
  }

  async invoke(request) {
    const value = await readJson(request);
    if (!validInvoke(value)) return json({ error: "invalid_request" }, 400);
    if (this.ctx.id.toString() !== value.attemptId) {
      return json({ error: "attempt_identity_mismatch" }, 409);
    }
    if (value.scenario === "facet_echo") {
      return json(receipt(value, null, null), 200);
    }

    const startedAt = performance.now();
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS journal_entries (seq INTEGER PRIMARY KEY, payload_digest TEXT NOT NULL, payload TEXT NOT NULL, payload_bytes INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS journal_seal (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), digest TEXT NOT NULL)");
    const payloadDigest = await sha256Hex(value.payload);
    const expectedSeal = await sha256Hex(canonicalJournalSeal(value, payloadDigest));
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM journal_entries");
      sql.exec("DELETE FROM journal_seal");
      for (let sequence = 0; sequence < value.journalEntries; sequence += 1) {
        sql.exec(
          "INSERT INTO journal_entries (seq, payload_digest, payload, payload_bytes) VALUES (?, ?, ?, ?)",
          sequence,
          payloadDigest,
          value.payload,
          value.payload.length
        );
      }
      sql.exec(
        "INSERT INTO journal_seal (singleton, digest) VALUES (1, ?)",
        expectedSeal
      );
    });
    await this.ctx.storage.sync();
    const rows = sql.exec("SELECT seq, payload_digest, payload, payload_bytes FROM journal_entries ORDER BY seq").toArray();
    const storedSeal = sql.exec("SELECT digest FROM journal_seal WHERE singleton = 1").one().digest;
    if (!validReadback(rows, value.journalEntries, payloadDigest, value.payload)) {
      return json({ error: "journal_readback_failed" }, 500);
    }
    if (storedSeal !== expectedSeal) {
      return json({ error: "journal_seal_failed" }, 500);
    }
    const duration = performance.now() - startedAt;
    const durationMs = Number.isFinite(duration) && duration > 0 ? duration : 0;
    return json(receipt(value, durationMs, expectedSeal), 200);
  }

  async lifecycle(request) {
    const value = await readJson(request);
    if (!exactKeys(value, ["attemptId", "codeId", "operation"]) ||
        value.attemptId !== this.ctx.id.toString() ||
        typeof value.codeId !== "string" ||
        (value.operation !== "append" && value.operation !== "read")) {
      return json({ error: "invalid_request" }, 400);
    }
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS lifecycle_identity (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), attempt_id TEXT NOT NULL, code_id TEXT NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO lifecycle_identity (singleton, attempt_id, code_id) VALUES (1, ?, ?)", value.attemptId, value.codeId);
    const identity = sql.exec("SELECT attempt_id, code_id FROM lifecycle_identity WHERE singleton = 1").one();
    if (identity.attempt_id !== value.attemptId || identity.code_id !== value.codeId) {
      return json({ error: "lifecycle_identity_mismatch" }, 409);
    }
    sql.exec("CREATE TABLE IF NOT EXISTS lifecycle_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value INTEGER NOT NULL CHECK (value >= 0))");
    sql.exec("INSERT OR IGNORE INTO lifecycle_state (singleton, value) VALUES (1, 0)");
    let count;
    if (value.operation === "append") {
      count = sql.exec("UPDATE lifecycle_state SET value = value + 1 WHERE singleton = 1 RETURNING value").one().value;
    } else {
      count = sql.exec("SELECT value FROM lifecycle_state WHERE singleton = 1").one().value;
    }
    await this.ctx.storage.sync();
    return json({ attemptId: value.attemptId, codeId: value.codeId, operation: value.operation, value: count }, 200);
  }
}

function receipt(value, journalDurationMs, sealDigest) {
  return {
    protocolVersion: value.protocolVersion,
    runId: value.runId,
    sampleId: value.sampleId,
    sampleOrdinal: value.sampleOrdinal,
    scenario: value.scenario,
    sessionId: value.sessionId,
    sessionMode: value.sessionMode,
    attemptId: value.attemptId,
    codeMode: value.codeMode,
    codeId: value.codeId,
    journalEntries: value.journalEntries,
    payloadBytes: value.payload.length,
    journalDurationMs,
    sealDigest
  };
}

async function readJson(request) {
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function validInvoke(value) {
  if (!exactKeys(value, INVOKE_KEYS)) return false;
  if (value.protocolVersion !== 1 || typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) return false;
  if (!Number.isInteger(value.sampleOrdinal) || value.sampleOrdinal < 0 || value.sampleOrdinal > 999999) return false;
  if (value.sampleId !== "rtp-sample-" + value.runId + "-" + value.sampleOrdinal) return false;
  if (value.sessionMode !== "new-session" && value.sessionMode !== "reuse-session") return false;
  const sessionOrdinal = value.sessionMode === "reuse-session" ? 0 : value.sampleOrdinal;
  if (value.sessionId !== "rtp-session-" + value.runId + "-" + sessionOrdinal) return false;
  if (value.attemptId !== "rtp-attempt-" + value.runId + "-" + sessionOrdinal + "-" + value.sampleOrdinal) return false;
  if (value.codeMode !== "stable" && value.codeMode !== "new-code") return false;
  const expectedCodeId = value.codeMode === "stable"
    ? "rtp-code-facet-v2-stable"
    : "rtp-code-facet-v2-" + value.runId + "-" + value.sampleOrdinal;
  if (value.codeId !== expectedCodeId) return false;
  if (value.scenario !== "facet_echo" && value.scenario !== "facet_journal") return false;
  if (!Number.isInteger(value.journalEntries) || value.journalEntries < 0 || value.journalEntries > MAX_JOURNAL_ENTRIES) return false;
  if (value.scenario === "facet_echo" && value.journalEntries !== 0) return false;
  return typeof value.payload === "string" && value.payload.length <= MAX_PAYLOAD_BYTES && /^x*$/.test(value.payload);
}

function exactKeys(value, expected) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (keys[index] !== expected[index]) return false;
  }
  return true;
}

function validReadback(rows, expectedCount, payloadDigest, payload) {
  if (rows.length !== expectedCount) return false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.seq !== index || row.payload_digest !== payloadDigest || row.payload !== payload || row.payload_bytes !== payload.length) return false;
  }
  return true;
}

function canonicalJournalSeal(value, payloadDigest) {
  return JSON.stringify([
    1,
    value.runId,
    value.sampleId,
    value.sessionId,
    value.attemptId,
    value.codeId,
    value.journalEntries,
    value.payload.length,
    payloadDigest,
    Array.from({ length: value.journalEntries }, (_, sequence) => sequence)
  ]);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}
`;

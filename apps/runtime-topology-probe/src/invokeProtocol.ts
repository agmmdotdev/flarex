import { Data, Effect, Schema } from "effect";

import {
  probeCommitIdentityIssueV1,
  probeInvokeRuntimeIdentityIssueV1,
  ProbeCommitScenarioSchema,
  ProbeMockFinishResponseV1Schema,
  ProbeSyntheticCommitSeqSchema,
  ProbeSyntheticCursorSchema,
} from "./commitProtocol";
import {
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeCodeModeSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  ProbeScopeIdSchema,
  ProbeSessionIdSchema,
} from "./identity";
import type { MockReadEntrypoint } from "./mockCommitWorker";
import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  PROBE_LIMITS_V1,
  ProbeDurationMsSchema,
  ProbeNormalizedErrorV1Schema,
  ProbeProtocolVersionV1Schema,
  ProbeSessionModeSchema,
} from "./protocol";
import { sha256Hex } from "./sha256";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

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
const SealDigestSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
);

const InvokeIdentityShape = {
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  scopeId: ProbeScopeIdSchema,
  scenario: Schema.Literal("full_invoke"),
  commitSeq: ProbeSyntheticCommitSeqSchema,
  sessionId: ProbeSessionIdSchema,
  sessionMode: ProbeSessionModeSchema,
  attemptId: ProbeAttemptIdSchema,
  codeMode: ProbeCodeModeSchema,
  codeId: ProbeCodeIdSchema,
  journalEntries: JournalEntriesSchema,
} as const;

const ProbeInvokeFacetRequestV1Shape = Schema.Struct({
  ...InvokeIdentityShape,
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeInvokeFacetRequestV1Schema =
  ProbeInvokeFacetRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = invokeIdentityIssue(request);
      if (identityIssue !== undefined) return identityIssue;
      return request.payload.length <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payload exceeds the protocol byte limit";
    }),
  );
export type ProbeInvokeFacetRequestV1 =
  typeof ProbeInvokeFacetRequestV1Schema.Type;

const ProbeInvokeFacetWorkerResponseV1Shape = Schema.Struct({
  ...InvokeIdentityShape,
  payloadBytes: PayloadBytesSchema,
  syntheticRevision: ProbeSyntheticCursorSchema,
  mockReadDurationMs: ProbeDurationMsSchema,
  journalDurationMs: ProbeDurationMsSchema,
  sealDigest: SealDigestSchema,
}).annotate(StrictStructOptions);

export const ProbeInvokeFacetWorkerResponseV1Schema =
  ProbeInvokeFacetWorkerResponseV1Shape.check(
    Schema.makeFilter(response => {
      const identityIssue = invokeIdentityIssue(response);
      if (identityIssue !== undefined) return identityIssue;
      return response.syntheticRevision === response.commitSeq - 1
        ? undefined
        : "syntheticRevision must identify the pre-commit synthetic snapshot";
    }),
  );
export type ProbeInvokeFacetWorkerResponseV1 =
  typeof ProbeInvokeFacetWorkerResponseV1Schema.Type;

const FullInvokeSessionObservationShape = {
  facet: ProbeInvokeFacetWorkerResponseV1Schema,
  facetDurationMs: ProbeDurationMsSchema,
  workerLoaderCallbackRan: Schema.Boolean,
  facetStartupCallbackRan: Schema.Boolean,
  sessionMockFinishDurationMs: ProbeDurationMsSchema,
  finish: ProbeMockFinishResponseV1Schema,
} as const;

const ProbeFullInvokeSessionResponseV1Shape = Schema.Struct(
  FullInvokeSessionObservationShape,
).annotate(StrictStructOptions);

export const ProbeFullInvokeSessionResponseV1Schema =
  ProbeFullInvokeSessionResponseV1Shape.check(
    Schema.makeFilter(response => {
      const observationIssue = fullInvokeSessionObservationIssue(response);
      if (observationIssue !== undefined) return observationIssue;
      if (
        response.finish.sync.disposition !== "applied" &&
        response.finish.sync.disposition !== "duplicate"
      ) {
        return "successful full invoke requires an applied or duplicate wake";
      }
      return undefined;
    }),
  );
export type ProbeFullInvokeSessionResponseV1 =
  typeof ProbeFullInvokeSessionResponseV1Schema.Type;

const ProbeFullInvokeSessionFailureV1Shape = Schema.Struct({
  ...FullInvokeSessionObservationShape,
  error: ProbeNormalizedErrorV1Schema,
}).annotate(StrictStructOptions);

export const ProbeFullInvokeSessionFailureV1Schema =
  ProbeFullInvokeSessionFailureV1Shape.check(
    Schema.makeFilter(response => {
      const observationIssue = fullInvokeSessionObservationIssue(response);
      if (observationIssue !== undefined) return observationIssue;
      if (
        response.finish.sync.disposition !== "gap" &&
        response.finish.sync.disposition !== "stale"
      ) {
        return "failed full invoke requires a rejected gap or stale wake";
      }
      return response.error.code === "runtime_failure" &&
          response.error.stage === "sync_cursor_io" &&
          response.error.retryable === false
        ? undefined
        : "failed full invoke requires the canonical sync-cursor error";
    }),
  );
export type ProbeFullInvokeSessionFailureV1 =
  typeof ProbeFullInvokeSessionFailureV1Schema.Type;
export type ProbeFullInvokeSessionObservationV1 =
  | ProbeFullInvokeSessionFailureV1
  | ProbeFullInvokeSessionResponseV1;

export async function probeInvokeJournalSealDigest(
  request: ProbeInvokeFacetRequestV1,
): Promise<string> {
  const payloadDigest = await sha256Hex(request.payload);
  return await sha256Hex(canonicalJournalSeal(request, payloadDigest));
}

export class ProbeInvokeProtocolValidationError extends Data.TaggedError(
  "ProbeInvokeProtocolValidationError",
)<{
  readonly boundary:
    | "invoke-request"
    | "invoke-worker-response"
    | "invoke-session-response"
    | "invoke-session-failure";
  readonly cause: unknown;
}> {}

function decoder<S extends Schema.Top>(
  schema: S,
  boundary: ProbeInvokeProtocolValidationError["boundary"],
) {
  const decode = Schema.decodeUnknownEffect(schema, StrictParseOptions);
  return (value: unknown) =>
    decode(value).pipe(
      Effect.mapError(
        cause => new ProbeInvokeProtocolValidationError({ boundary, cause }),
      ),
    );
}

const decodeInvokeRequest = decoder(
  ProbeInvokeFacetRequestV1Schema,
  "invoke-request",
);
const decodeInvokeWorkerResponse = decoder(
  ProbeInvokeFacetWorkerResponseV1Schema,
  "invoke-worker-response",
);
const decodeInvokeSessionResponse = decoder(
  ProbeFullInvokeSessionResponseV1Schema,
  "invoke-session-response",
);
const decodeInvokeSessionFailure = decoder(
  ProbeFullInvokeSessionFailureV1Schema,
  "invoke-session-failure",
);

export const decodeProbeInvokeFacetRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeInvokeFacetRequestV1",
)(function* (value: unknown) {
  return yield* decodeInvokeRequest(value);
});
export const decodeProbeInvokeFacetWorkerResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeInvokeFacetWorkerResponseV1",
)(function* (value: unknown) {
  return yield* decodeInvokeWorkerResponse(value);
});
export const decodeProbeFullInvokeSessionResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFullInvokeSessionResponseV1",
)(function* (value: unknown) {
  return yield* decodeInvokeSessionResponse(value);
});
export const decodeProbeFullInvokeSessionFailureV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFullInvokeSessionFailureV1",
)(function* (value: unknown) {
  return yield* decodeInvokeSessionFailure(value);
});

export const decodeProbeInvokeFacetRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeInvokeFacetRequestV1Schema);
export const decodeProbeInvokeFacetWorkerResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeInvokeFacetWorkerResponseV1Schema);
export const decodeProbeFullInvokeSessionResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeFullInvokeSessionResponseV1Schema);
export const decodeProbeFullInvokeSessionFailureV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeFullInvokeSessionFailureV1Schema);

function fullInvokeSessionObservationIssue(response: {
  readonly facet: ProbeInvokeFacetWorkerResponseV1;
  readonly facetStartupCallbackRan: boolean;
  readonly finish: typeof ProbeMockFinishResponseV1Schema.Type;
  readonly workerLoaderCallbackRan: boolean;
}): string | undefined {
  if (
    response.workerLoaderCallbackRan &&
    !response.facetStartupCallbackRan
  ) {
    return "Worker Loader callback cannot run without facet startup";
  }
  const request = response.finish.request;
  if (request.scenario !== "full_invoke") {
    return "full invoke session observation requires a full-invoke finish";
  }
  return sameInvokeAndFinishIdentity(response.facet, request)
    ? undefined
    : "mock finish must match the exact facet invocation identity";
}

function invokeIdentityIssue(input: {
  readonly attemptId: typeof ProbeAttemptIdSchema.Type;
  readonly codeId: typeof ProbeCodeIdSchema.Type;
  readonly codeMode: typeof ProbeCodeModeSchema.Type;
  readonly commitSeq: typeof ProbeSyntheticCommitSeqSchema.Type;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleId: typeof ProbeSampleIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
  readonly scopeId: typeof ProbeScopeIdSchema.Type;
  readonly scenario: typeof ProbeCommitScenarioSchema.Type;
  readonly sessionId: typeof ProbeSessionIdSchema.Type;
  readonly sessionMode: typeof ProbeSessionModeSchema.Type;
}): string | undefined {
  const commitIssue = probeCommitIdentityIssueV1(input);
  return commitIssue ?? probeInvokeRuntimeIdentityIssueV1(input);
}

function sameInvokeAndFinishIdentity(
  facet: ProbeInvokeFacetWorkerResponseV1,
  finish: Extract<
    typeof ProbeMockFinishResponseV1Schema.Type["request"],
    { readonly scenario: "full_invoke" }
  >,
): boolean {
  return facet.protocolVersion === finish.protocolVersion &&
    facet.runId === finish.runId &&
    facet.sampleId === finish.sampleId &&
    facet.sampleOrdinal === finish.sampleOrdinal &&
    facet.scopeId === finish.scopeId &&
    facet.scenario === finish.scenario &&
    facet.commitSeq === finish.commitSeq &&
    facet.sessionId === finish.sessionId &&
    facet.sessionMode === finish.sessionMode &&
    facet.attemptId === finish.attemptId &&
    facet.codeMode === finish.codeMode &&
    facet.codeId === finish.codeId &&
    facet.journalEntries === finish.journalEntries &&
    facet.sealDigest === finish.sealDigest;
}

function canonicalJournalSeal(
  request: ProbeInvokeFacetRequestV1,
  payloadDigest: string,
): string {
  return JSON.stringify([
    1,
    request.runId,
    request.scopeId,
    request.sampleId,
    request.sessionId,
    request.attemptId,
    request.codeId,
    request.commitSeq,
    request.journalEntries,
    request.payload.length,
    payloadDigest,
    Array.from({ length: request.journalEntries }, (_, sequence) => sequence),
  ]);
}

export const PROBE_INVOKE_WORKER_MAIN_MODULE = "probe-invoke-worker.js";
export const PROBE_INVOKE_FACET_CLASS_NAME = "ProbeInvocationFacet";

export function probeInvokeWorkerCode(
  mockRead: Service<typeof MockReadEntrypoint>,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: "2026-06-14",
    mainModule: PROBE_INVOKE_WORKER_MAIN_MODULE,
    modules: {
      [PROBE_INVOKE_WORKER_MAIN_MODULE]: PROBE_INVOKE_WORKER_SOURCE,
    },
    env: { MOCK_READ: mockRead },
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 4 },
  };
}

const PROBE_INVOKE_WORKER_SOURCE = `
import { DurableObject } from "cloudflare:workers";

const MAX_BODY_BYTES = 73728;
const MAX_JOURNAL_ENTRIES = 256;
const MAX_PAYLOAD_BYTES = 65536;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const REQUEST_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "commitSeq",
  "journalEntries",
  "payload",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId",
  "sessionId",
  "sessionMode"
];
const READ_RECEIPT_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "commitSeq",
  "payloadBytes",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId",
  "sessionId",
  "sessionMode",
  "syntheticRevision"
];

export class ProbeInvocationFacet extends DurableObject {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method === "POST" && pathname === "/v1/purge-ensure") {
      return await this.ensurePurgeStorage();
    }
    if (request.method !== "POST" || pathname !== "/v1/full-invoke") {
      return json({ error: "not_found" }, 404);
    }
    const value = await readJson(request);
    if (!validRequest(value)) return json({ error: "invalid_request" }, 400);
    if (this.ctx.id.toString() !== value.attemptId) {
      return json({ error: "attempt_identity_mismatch" }, 409);
    }
    if (this.env.MOCK_READ === undefined || typeof this.env.MOCK_READ.read !== "function") {
      return json({ error: "mock_read_unavailable" }, 500);
    }

    const readRequest = mockReadRequest(value);
    const readStartedAt = performance.now();
    const rpcReadReceipt = await this.env.MOCK_READ.read(readRequest);
    const readReceipt = Object.fromEntries(Object.entries(rpcReadReceipt));
    if (!validReadReceipt(readReceipt, readRequest)) {
      return json({ error: "mock_read_receipt_mismatch" }, 502);
    }
    const mockReadDurationMs = elapsedSince(readStartedAt);

    const journalStartedAt = performance.now();
    const payloadDigest = await sha256Hex(value.payload);
    const sealDigest = await sha256Hex(canonicalJournalSeal(value, payloadDigest));
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_journal_entries (seq INTEGER PRIMARY KEY, payload_digest TEXT NOT NULL, payload TEXT NOT NULL, payload_bytes INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_journal_seal (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), digest TEXT NOT NULL)");
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM invoke_journal_entries");
      sql.exec("DELETE FROM invoke_journal_seal");
      for (let sequence = 0; sequence < value.journalEntries; sequence += 1) {
        sql.exec(
          "INSERT INTO invoke_journal_entries (seq, payload_digest, payload, payload_bytes) VALUES (?, ?, ?, ?)",
          sequence,
          payloadDigest,
          value.payload,
          value.payload.length
        );
      }
      sql.exec("INSERT INTO invoke_journal_seal (singleton, digest) VALUES (1, ?)", sealDigest);
    });
    await this.ctx.storage.sync();
    const rows = sql.exec("SELECT seq, payload_digest, payload, payload_bytes FROM invoke_journal_entries ORDER BY seq").toArray();
    const storedSeal = sql.exec("SELECT digest FROM invoke_journal_seal WHERE singleton = 1").one().digest;
    if (!validJournalReadback(rows, value.journalEntries, payloadDigest, value.payload) || storedSeal !== sealDigest) {
      return json({ error: "journal_readback_failed" }, 500);
    }
    const journalDurationMs = elapsedSince(journalStartedAt);

    return json({
      protocolVersion: value.protocolVersion,
      runId: value.runId,
      sampleId: value.sampleId,
      sampleOrdinal: value.sampleOrdinal,
      scopeId: value.scopeId,
      scenario: value.scenario,
      commitSeq: value.commitSeq,
      sessionId: value.sessionId,
      sessionMode: value.sessionMode,
      attemptId: value.attemptId,
      codeMode: value.codeMode,
      codeId: value.codeId,
      journalEntries: value.journalEntries,
      payloadBytes: value.payload.length,
      syntheticRevision: readReceipt.syntheticRevision,
      mockReadDurationMs,
      journalDurationMs,
      sealDigest
    }, 200);
  }

  async ensurePurgeStorage() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS probe_purge_marker (singleton INTEGER PRIMARY KEY CHECK (singleton = 1))");
    sql.exec("INSERT OR IGNORE INTO probe_purge_marker (singleton) VALUES (1)");
    await this.ctx.storage.sync();
    return json({ kind: "purge-ready" }, 200);
  }
}

function mockReadRequest(value) {
  return {
    protocolVersion: value.protocolVersion,
    runId: value.runId,
    sampleId: value.sampleId,
    sampleOrdinal: value.sampleOrdinal,
    scopeId: value.scopeId,
    scenario: value.scenario,
    commitSeq: value.commitSeq,
    sessionId: value.sessionId,
    sessionMode: value.sessionMode,
    attemptId: value.attemptId,
    codeMode: value.codeMode,
    codeId: value.codeId,
    payloadBytes: value.payload.length
  };
}

function validRequest(value) {
  if (!exactKeys(value, REQUEST_KEYS)) return false;
  if (value.protocolVersion !== 1 || typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) return false;
  if (!Number.isInteger(value.sampleOrdinal) || value.sampleOrdinal < 0 || value.sampleOrdinal > 999999) return false;
  if (value.sampleId !== "rtp-sample-" + value.runId + "-" + value.sampleOrdinal) return false;
  if (value.scopeId !== "rtp-scope-" + value.runId) return false;
  if (value.scenario !== "full_invoke" || value.commitSeq !== value.sampleOrdinal + 1) return false;
  if (value.sessionMode !== "new-session" && value.sessionMode !== "reuse-session") return false;
  const sessionOrdinal = value.sessionMode === "reuse-session" ? 0 : value.sampleOrdinal;
  if (value.sessionId !== "rtp-session-" + value.runId + "-" + sessionOrdinal) return false;
  if (value.attemptId !== "rtp-attempt-" + value.runId + "-" + sessionOrdinal + "-" + value.sampleOrdinal) return false;
  if (value.codeMode !== "stable" && value.codeMode !== "new-code") return false;
  const expectedCodeId = value.codeMode === "stable"
    ? "rtp-code-invoke-v1-stable"
    : "rtp-code-invoke-v1-" + value.runId + "-" + value.sampleOrdinal;
  if (value.codeId !== expectedCodeId) return false;
  if (!Number.isInteger(value.journalEntries) || value.journalEntries < 0 || value.journalEntries > MAX_JOURNAL_ENTRIES) return false;
  return typeof value.payload === "string" && value.payload.length <= MAX_PAYLOAD_BYTES && /^x*$/.test(value.payload);
}

function validReadReceipt(receipt, request) {
  if (!exactKeys(receipt, READ_RECEIPT_KEYS)) return false;
  for (const key of Object.keys(request)) {
    if (receipt[key] !== request[key]) return false;
  }
  return receipt.syntheticRevision === request.commitSeq - 1;
}

function validJournalReadback(rows, expectedCount, payloadDigest, payload) {
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
    value.scopeId,
    value.sampleId,
    value.sessionId,
    value.attemptId,
    value.codeId,
    value.commitSeq,
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

async function readJson(request) {
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
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

function elapsedSince(startedAt) {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
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

import { Data, Effect, Schema } from "effect";

import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeCodeModeSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  ProbeScopeIdSchema,
  ProbeSessionIdSchema,
} from "./identity";
import {
  PROBE_LIMITS_V1,
  ProbeDurationMsSchema,
  ProbeProtocolVersionV1Schema,
} from "./protocol";
import { ProbeSyntheticCursorSchema } from "./commitProtocol";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

const PayloadBytesSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= PROBE_LIMITS_V1.maxPayloadBytes
      ? undefined
      : "payloadBytes exceeds the protocol limit"
  ),
);
const SyntheticPayloadSchema = Schema.String.check(Schema.isPattern(/^x*$/));

const RerunIdentityShape = {
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  scopeId: ProbeScopeIdSchema,
  scenario: Schema.Literal("sync_rerun"),
  sessionId: ProbeSessionIdSchema,
  sessionMode: Schema.Literal("new-session"),
  attemptId: ProbeAttemptIdSchema,
  codeMode: ProbeCodeModeSchema,
  codeId: ProbeCodeIdSchema,
} as const;

const ProbeSyncRerunRequestV1Shape = Schema.Struct({
  ...RerunIdentityShape,
  reentryDepth: Schema.Literal(0),
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeSyncRerunRequestV1Schema =
  ProbeSyncRerunRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = probeRerunIdentityIssueV1(request);
      if (identityIssue !== undefined) return identityIssue;
      return request.payload.length <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payload exceeds the protocol byte limit";
    }),
  );
export type ProbeSyncRerunRequestV1 =
  typeof ProbeSyncRerunRequestV1Schema.Type;

const ProbeRuntimeRerunRequestV1Shape = Schema.Struct({
  ...RerunIdentityShape,
  reentryDepth: Schema.Literal(1),
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeRuntimeRerunRequestV1Schema =
  ProbeRuntimeRerunRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = probeRerunIdentityIssueV1(request);
      if (identityIssue !== undefined) return identityIssue;
      return request.payload.length <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payload exceeds the protocol byte limit";
    }),
  );
export type ProbeRuntimeRerunRequestV1 =
  typeof ProbeRuntimeRerunRequestV1Schema.Type;

const ProbeRerunFacetResponseV1Shape = Schema.Struct({
  ...RerunIdentityShape,
  reentryDepth: Schema.Literal(1),
  payloadBytes: PayloadBytesSchema,
}).annotate(StrictStructOptions);

export const ProbeRerunFacetResponseV1Schema =
  ProbeRerunFacetResponseV1Shape.check(
    Schema.makeFilter(response => probeRerunIdentityIssueV1(response)),
  );
export type ProbeRerunFacetResponseV1 =
  typeof ProbeRerunFacetResponseV1Schema.Type;

const ProbeRerunSessionResponseV1Shape = Schema.Struct({
  facet: ProbeRerunFacetResponseV1Schema,
  facetDurationMs: ProbeDurationMsSchema,
  workerLoaderCallbackRan: Schema.Boolean,
  facetStartupCallbackRan: Schema.Boolean,
}).annotate(StrictStructOptions);

export const ProbeRerunSessionResponseV1Schema =
  ProbeRerunSessionResponseV1Shape.check(
    Schema.makeFilter(response =>
      response.facetStartupCallbackRan
        ? undefined
        : "a successful rerun must start its fresh attempt facet"
    ),
  );
export type ProbeRerunSessionResponseV1 =
  typeof ProbeRerunSessionResponseV1Schema.Type;

const ProbeRuntimeRerunResponseV1Shape = Schema.Struct({
  session: ProbeRerunSessionResponseV1Schema,
  runtimeSessionDurationMs: ProbeDurationMsSchema,
  terminalAck: Schema.Literal(true),
}).annotate(StrictStructOptions);

export const ProbeRuntimeRerunResponseV1Schema =
  ProbeRuntimeRerunResponseV1Shape;
export type ProbeRuntimeRerunResponseV1 =
  typeof ProbeRuntimeRerunResponseV1Schema.Type;

const ProbeSyncRerunReceiptV1Shape = Schema.Struct({
  runtime: ProbeRuntimeRerunResponseV1Schema,
  syncRuntimeRerunDurationMs: ProbeDurationMsSchema,
  cursorBefore: ProbeSyntheticCursorSchema,
  cursorAfter: ProbeSyntheticCursorSchema,
  capabilityCallCount: Schema.Literal(1),
  terminalAck: Schema.Literal(true),
}).annotate(StrictStructOptions);

export const ProbeSyncRerunReceiptV1Schema =
  ProbeSyncRerunReceiptV1Shape.check(
    Schema.makeFilter(receipt =>
      receipt.cursorBefore === receipt.cursorAfter
        ? undefined
        : "sync_rerun must not change the synthetic sync cursor"
    ),
  );
export type ProbeSyncRerunReceiptV1 =
  typeof ProbeSyncRerunReceiptV1Schema.Type;

export class ProbeRerunProtocolValidationError extends Data.TaggedError(
  "ProbeRerunProtocolValidationError",
)<{
  readonly boundary:
    | "rerun-request"
    | "rerun-runtime-request"
    | "rerun-facet-response"
    | "rerun-session-response"
    | "rerun-runtime-response"
    | "rerun-sync-receipt";
  readonly cause: unknown;
}> {}

function decoder<S extends Schema.Top>(
  schema: S,
  boundary: ProbeRerunProtocolValidationError["boundary"],
) {
  const decode = Schema.decodeUnknownEffect(schema, StrictParseOptions);
  return (value: unknown) =>
    decode(value).pipe(
      Effect.mapError(
        cause => new ProbeRerunProtocolValidationError({ boundary, cause }),
      ),
    );
}

const decodeRerunRequest = decoder(
  ProbeSyncRerunRequestV1Schema,
  "rerun-request",
);
const decodeRuntimeRerunRequest = decoder(
  ProbeRuntimeRerunRequestV1Schema,
  "rerun-runtime-request",
);
const decodeRerunFacetResponse = decoder(
  ProbeRerunFacetResponseV1Schema,
  "rerun-facet-response",
);
const decodeRerunSessionResponse = decoder(
  ProbeRerunSessionResponseV1Schema,
  "rerun-session-response",
);
const decodeRuntimeRerunResponse = decoder(
  ProbeRuntimeRerunResponseV1Schema,
  "rerun-runtime-response",
);
const decodeSyncRerunReceipt = decoder(
  ProbeSyncRerunReceiptV1Schema,
  "rerun-sync-receipt",
);

export const decodeProbeSyncRerunRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSyncRerunRequestV1",
)((value: unknown) => decodeRerunRequest(value));
export const decodeProbeRuntimeRerunRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRuntimeRerunRequestV1",
)((value: unknown) => decodeRuntimeRerunRequest(value));
export const decodeProbeRerunFacetResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRerunFacetResponseV1",
)((value: unknown) => decodeRerunFacetResponse(value));
export const decodeProbeRerunSessionResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRerunSessionResponseV1",
)((value: unknown) => decodeRerunSessionResponse(value));
export const decodeProbeRuntimeRerunResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRuntimeRerunResponseV1",
)((value: unknown) => decodeRuntimeRerunResponse(value));
export const decodeProbeSyncRerunReceiptV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSyncRerunReceiptV1",
)((value: unknown) => decodeSyncRerunReceipt(value));

export const decodeProbeSyncRerunRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncRerunRequestV1Schema);
export const decodeProbeRuntimeRerunRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRuntimeRerunRequestV1Schema);
export const decodeProbeRerunFacetResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRerunFacetResponseV1Schema);
export const decodeProbeRerunSessionResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRerunSessionResponseV1Schema);
export const decodeProbeRuntimeRerunResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRuntimeRerunResponseV1Schema);
export const decodeProbeSyncRerunReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncRerunReceiptV1Schema);

export function probeRerunIdentityIssueV1(input: {
  readonly attemptId: typeof ProbeAttemptIdSchema.Type;
  readonly codeId: typeof ProbeCodeIdSchema.Type;
  readonly codeMode: typeof ProbeCodeModeSchema.Type;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleId: typeof ProbeSampleIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
  readonly scopeId: typeof ProbeScopeIdSchema.Type;
  readonly sessionId: typeof ProbeSessionIdSchema.Type;
  readonly sessionMode: "new-session";
}): string | undefined {
  if (input.sampleId !== probeSampleId(input.runId, input.sampleOrdinal)) {
    return "sampleId must be derived from runId and sampleOrdinal";
  }
  if (input.scopeId !== probeScopeId(input.runId)) {
    return "scopeId must be derived from runId";
  }
  if (input.sessionId !== probeSessionId(input.runId, input.sampleOrdinal)) {
    return "sync_rerun must use a fresh sample-scoped session";
  }
  if (
    input.attemptId !== probeAttemptId(
      input.runId,
      input.sampleOrdinal,
      input.sampleOrdinal,
    )
  ) {
    return "attemptId must identify the fresh rerun session attempt";
  }
  const expectedCodeId = input.codeMode === "stable"
    ? probeCodeId({ mode: "stable", profile: "rerun" })
    : probeCodeId({
        mode: "new-code",
        profile: "rerun",
        runId: input.runId,
        version: input.sampleOrdinal,
      });
  return input.codeId === expectedCodeId
    ? undefined
    : "codeId must identify the rerun-v1 source and code mode";
}

export const PROBE_RERUN_WORKER_MAIN_MODULE = "probe-rerun-worker.js";
export const PROBE_RERUN_FACET_CLASS_NAME = "ProbeRerunFacet";

export function probeRerunWorkerCode(): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: "2026-06-14",
    mainModule: PROBE_RERUN_WORKER_MAIN_MODULE,
    modules: {
      [PROBE_RERUN_WORKER_MAIN_MODULE]: PROBE_RERUN_WORKER_SOURCE,
    },
    env: {},
    globalOutbound: null,
    limits: { cpuMs: 25, subRequests: 0 },
  };
}

const PROBE_RERUN_WORKER_SOURCE = `
import { DurableObject } from "cloudflare:workers";

const MAX_BODY_BYTES = 73728;
const MAX_PAYLOAD_BYTES = 65536;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const REQUEST_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "payload",
  "protocolVersion",
  "reentryDepth",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId",
  "sessionId",
  "sessionMode"
];

export class ProbeRerunFacet extends DurableObject {
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/rerun") {
      return json({ error: "not_found" }, 404);
    }
    const value = await readJson(request);
    if (!validRequest(value)) return json({ error: "invalid_request" }, 400);
    if (this.ctx.id.toString() !== value.attemptId) {
      return json({ error: "attempt_identity_mismatch" }, 409);
    }
    return json({
      protocolVersion: value.protocolVersion,
      runId: value.runId,
      sampleId: value.sampleId,
      sampleOrdinal: value.sampleOrdinal,
      scopeId: value.scopeId,
      scenario: value.scenario,
      sessionId: value.sessionId,
      sessionMode: value.sessionMode,
      attemptId: value.attemptId,
      codeMode: value.codeMode,
      codeId: value.codeId,
      reentryDepth: value.reentryDepth,
      payloadBytes: value.payload.length
    }, 200);
  }
}

function validRequest(value) {
  if (!exactKeys(value, REQUEST_KEYS)) return false;
  if (value.protocolVersion !== 1 || typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) return false;
  if (!Number.isInteger(value.sampleOrdinal) || value.sampleOrdinal < 0 || value.sampleOrdinal > 999999) return false;
  if (value.sampleId !== "rtp-sample-" + value.runId + "-" + value.sampleOrdinal) return false;
  if (value.scopeId !== "rtp-scope-" + value.runId || value.scenario !== "sync_rerun") return false;
  if (value.sessionMode !== "new-session" || value.sessionId !== "rtp-session-" + value.runId + "-" + value.sampleOrdinal) return false;
  if (value.attemptId !== "rtp-attempt-" + value.runId + "-" + value.sampleOrdinal + "-" + value.sampleOrdinal) return false;
  if (value.codeMode !== "stable" && value.codeMode !== "new-code") return false;
  const expectedCodeId = value.codeMode === "stable"
    ? "rtp-code-rerun-v1-stable"
    : "rtp-code-rerun-v1-" + value.runId + "-" + value.sampleOrdinal;
  if (value.codeId !== expectedCodeId || value.reentryDepth !== 1) return false;
  return typeof value.payload === "string" && value.payload.length <= MAX_PAYLOAD_BYTES && /^x*$/.test(value.payload);
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

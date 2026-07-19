import { Data, Effect, Schema } from "effect";

import {
  probeCodeId,
  probeSampleId,
  ProbeCodeIdSchema,
  ProbeCodeModeSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
} from "./identity";
import {
  PROBE_LIMITS_V1,
  ProbeProtocolVersionV1Schema,
} from "./protocol";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

const SyntheticPayloadSchema = Schema.String.check(
  Schema.isPattern(/^x*$/),
);

const ProbeDirectEchoIdentityShape = {
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  codeMode: ProbeCodeModeSchema,
  codeId: ProbeCodeIdSchema,
} as const;

const ProbeDirectEchoRequestV1Shape = Schema.Struct({
  ...ProbeDirectEchoIdentityShape,
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeDirectEchoRequestV1Schema =
  ProbeDirectEchoRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = directIdentityIssue(request);
      if (identityIssue !== undefined) return identityIssue;
      return request.payload.length <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payload exceeds the protocol byte limit";
    }),
  );
export type ProbeDirectEchoRequestV1 =
  typeof ProbeDirectEchoRequestV1Schema.Type;

const ProbeDirectEchoResponseV1Shape = Schema.Struct({
  ...ProbeDirectEchoIdentityShape,
  payloadBytes: Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value >= 0 && value <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payloadBytes exceeds the protocol byte limit"
    ),
  ),
}).annotate(StrictStructOptions);

export const ProbeDirectEchoResponseV1Schema =
  ProbeDirectEchoResponseV1Shape.check(
    Schema.makeFilter(response => directIdentityIssue(response)),
  );
export type ProbeDirectEchoResponseV1 =
  typeof ProbeDirectEchoResponseV1Schema.Type;

export class ProbeDynamicProtocolValidationError extends Data.TaggedError(
  "ProbeDynamicProtocolValidationError",
)<{
  readonly boundary: "direct-request" | "direct-response";
  readonly cause: unknown;
}> {}

const decodeUnknownDirectRequest = Schema.decodeUnknownEffect(
  ProbeDirectEchoRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownDirectResponse = Schema.decodeUnknownEffect(
  ProbeDirectEchoResponseV1Schema,
  StrictParseOptions,
);

export const decodeProbeDirectEchoRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeDirectEchoRequestV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeDirectEchoRequestV1,
  ProbeDynamicProtocolValidationError
> {
  return yield* decodeUnknownDirectRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeDynamicProtocolValidationError({
          boundary: "direct-request",
          cause,
        }),
    ),
  );
});

export const decodeProbeDirectEchoResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeDirectEchoResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeDirectEchoResponseV1,
  ProbeDynamicProtocolValidationError
> {
  return yield* decodeUnknownDirectResponse(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeDynamicProtocolValidationError({
          boundary: "direct-response",
          cause,
        }),
    ),
  );
});

function directIdentityIssue(input: {
  readonly codeId: typeof ProbeCodeIdSchema.Type;
  readonly codeMode: typeof ProbeCodeModeSchema.Type;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleId: typeof ProbeSampleIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
}): string | undefined {
  if (input.sampleId !== probeSampleId(input.runId, input.sampleOrdinal)) {
    return "sampleId must be derived from runId and sampleOrdinal";
  }
  const expectedCodeId = input.codeMode === "stable"
    ? probeCodeId({ mode: "stable", profile: "direct" })
    : probeCodeId({
        mode: "new-code",
        profile: "direct",
        runId: input.runId,
        version: input.sampleOrdinal,
      });
  return input.codeId === expectedCodeId
    ? undefined
    : "codeId must identify the direct runtime source and code mode";
}

export const PROBE_DYNAMIC_WORKER_COMPATIBILITY_DATE = "2026-06-14";
export const PROBE_DIRECT_WORKER_MAIN_MODULE = "probe-direct-worker.js";

export function probeDirectWorkerCode(): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: PROBE_DYNAMIC_WORKER_COMPATIBILITY_DATE,
    mainModule: PROBE_DIRECT_WORKER_MAIN_MODULE,
    modules: {
      [PROBE_DIRECT_WORKER_MAIN_MODULE]: PROBE_DIRECT_WORKER_SOURCE,
    },
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 1 },
  };
}

const PROBE_DIRECT_WORKER_SOURCE = `
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SAMPLE_ID_PATTERN = /^rtp-sample-[a-z0-9][a-z0-9_-]{0,39}-[0-9]{1,6}$/;
const MAX_BODY_BYTES = 73728;
const MAX_PAYLOAD_BYTES = 65536;
const EXPECTED_KEYS = [
  "codeId",
  "codeMode",
  "payload",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal"
];

export default {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method !== "POST" || pathname !== "/v1/direct-echo") {
      return json({ error: "not_found" }, 404);
    }
    let value;
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_BODY_BYTES) {
        return json({ error: "limit_exceeded" }, 413);
      }
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (!validRequest(value)) {
      return json({ error: "invalid_request" }, 400);
    }
    return json({
      protocolVersion: value.protocolVersion,
      runId: value.runId,
      sampleId: value.sampleId,
      sampleOrdinal: value.sampleOrdinal,
      codeMode: value.codeMode,
      codeId: value.codeId,
      payloadBytes: value.payload.length
    }, 200);
  }
};

function validRequest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== EXPECTED_KEYS.length) return false;
  for (let index = 0; index < EXPECTED_KEYS.length; index += 1) {
    if (keys[index] !== EXPECTED_KEYS[index]) return false;
  }
  if (value.protocolVersion !== 1) return false;
  if (typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) return false;
  if (!Number.isInteger(value.sampleOrdinal) || value.sampleOrdinal < 0 || value.sampleOrdinal > 999999) return false;
  if (typeof value.sampleId !== "string" || !SAMPLE_ID_PATTERN.test(value.sampleId)) return false;
  if (value.sampleId !== "rtp-sample-" + value.runId + "-" + value.sampleOrdinal) return false;
  if (value.codeMode !== "stable" && value.codeMode !== "new-code") return false;
  const expectedCodeId = value.codeMode === "stable"
    ? "rtp-code-direct-v2-stable"
    : "rtp-code-direct-v2-" + value.runId + "-" + value.sampleOrdinal;
  if (value.codeId !== expectedCodeId) return false;
  return typeof value.payload === "string" &&
    value.payload.length <= MAX_PAYLOAD_BYTES &&
    /^x*$/.test(value.payload);
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

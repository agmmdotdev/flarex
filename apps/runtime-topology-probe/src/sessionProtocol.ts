import { Data, Effect, Schema } from "effect";

import {
  probeSampleId,
  probeSessionId,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  ProbeSessionIdSchema,
  PROBE_ORDINAL_ZERO,
} from "./identity";
import {
  PROBE_LIMITS_V1,
  ProbeProtocolVersionV1Schema,
  ProbeSessionModeSchema,
} from "./protocol";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

const SyntheticPayloadSchema = Schema.String.check(
  Schema.isPattern(/^x*$/),
);

const ProbeSessionEchoRequestV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  sessionId: ProbeSessionIdSchema,
  sessionMode: ProbeSessionModeSchema,
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeSessionEchoRequestV1Schema =
  ProbeSessionEchoRequestV1Shape.check(
    Schema.makeFilter(request => {
      if (
        request.sampleId !== probeSampleId(request.runId, request.sampleOrdinal)
      ) {
        return "sampleId must be derived from runId and sampleOrdinal";
      }
      if (
        request.sessionId !== expectedSessionId(
          request.runId,
          request.sampleOrdinal,
          request.sessionMode,
        )
      ) {
        return "sessionId must be derived from runId, sampleOrdinal, and sessionMode";
      }
      return request.payload.length <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payload exceeds the protocol byte limit";
    }),
  );
export type ProbeSessionEchoRequestV1 =
  typeof ProbeSessionEchoRequestV1Schema.Type;

const ProbeSessionEchoResponseV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  sessionId: ProbeSessionIdSchema,
  sessionMode: ProbeSessionModeSchema,
  payloadBytes: Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value >= 0 ? undefined : "payloadBytes must be non-negative"
    ),
  ),
}).annotate(StrictStructOptions);

export const ProbeSessionEchoResponseV1Schema =
  ProbeSessionEchoResponseV1Shape.check(
    Schema.makeFilter(response => {
      if (
        response.sampleId !== probeSampleId(
          response.runId,
          response.sampleOrdinal,
        )
      ) {
        return "sampleId must belong to runId";
      }
      return response.sessionId === expectedSessionId(
        response.runId,
        response.sampleOrdinal,
        response.sessionMode,
      )
        ? undefined
        : "sessionId must belong to the run and session mode";
    }),
  );
export type ProbeSessionEchoResponseV1 =
  typeof ProbeSessionEchoResponseV1Schema.Type;

const ControlValueSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 ? undefined : "control value must be non-negative"
  ),
);

export const ProbeSessionControlResponseV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  sessionId: ProbeSessionIdSchema,
  value: ControlValueSchema,
}).annotate(StrictStructOptions);
export type ProbeSessionControlResponseV1 =
  typeof ProbeSessionControlResponseV1Schema.Type;

export class ProbeSessionProtocolValidationError extends Data.TaggedError(
  "ProbeSessionProtocolValidationError",
)<{
  readonly boundary: "echo-request" | "echo-response" | "control-response";
  readonly cause: unknown;
}> {}

const decodeUnknownEchoRequest = Schema.decodeUnknownEffect(
  ProbeSessionEchoRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownEchoResponse = Schema.decodeUnknownEffect(
  ProbeSessionEchoResponseV1Schema,
  StrictParseOptions,
);
const decodeUnknownControlResponse = Schema.decodeUnknownEffect(
  ProbeSessionControlResponseV1Schema,
  StrictParseOptions,
);

export const decodeProbeSessionEchoRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSessionEchoRequestV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeSessionEchoRequestV1,
  ProbeSessionProtocolValidationError
> {
  return yield* decodeUnknownEchoRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeSessionProtocolValidationError({
          boundary: "echo-request",
          cause,
        }),
    ),
  );
});

export const decodeProbeSessionEchoResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSessionEchoResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeSessionEchoResponseV1,
  ProbeSessionProtocolValidationError
> {
  return yield* decodeUnknownEchoResponse(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeSessionProtocolValidationError({
          boundary: "echo-response",
          cause,
        }),
    ),
  );
});

export const decodeProbeSessionControlResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSessionControlResponseV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeSessionControlResponseV1,
  ProbeSessionProtocolValidationError
> {
  return yield* decodeUnknownControlResponse(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeSessionProtocolValidationError({
          boundary: "control-response",
          cause,
        }),
    ),
  );
});

function expectedSessionId(
  runId: typeof ProbeRunIdSchema.Type,
  sampleOrdinal: typeof ProbeOrdinalSchema.Type,
  sessionMode: typeof ProbeSessionModeSchema.Type,
) {
  return probeSessionId(
    runId,
    sessionMode === "reuse-session" ? PROBE_ORDINAL_ZERO : sampleOrdinal,
  );
}

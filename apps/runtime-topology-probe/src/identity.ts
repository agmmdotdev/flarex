import { Data, Effect, Schema } from "effect";

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_PROBE_ORDINAL = 999_999;

const boundedOrdinalFilter = Schema.makeFilter((value: number) =>
  value >= 0 && value <= MAX_PROBE_ORDINAL
    ? undefined
    : `Expected an integer from 0 through ${MAX_PROBE_ORDINAL}`
);

export const ProbeRunIdSchema = Schema.String.check(
  Schema.isPattern(RUN_ID_PATTERN),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeRunIdV1"));
export type ProbeRunId = typeof ProbeRunIdSchema.Type;

export const ProbeCampaignIdSchema = Schema.String.check(
  Schema.isPattern(RUN_ID_PATTERN),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeCampaignIdV1"));
export type ProbeCampaignId = typeof ProbeCampaignIdSchema.Type;

export const PROBE_CAMPAIGN_ACTOR_NAME = "rtp-campaign-control-v1" as const;

export const ProbeRunActorIdSchema = Schema.String.check(
  Schema.isPattern(/^rtp-run-[a-z0-9][a-z0-9_-]{0,39}$/),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeRunActorIdV1"));
export type ProbeRunActorId = typeof ProbeRunActorIdSchema.Type;

export const ProbeClaimTokenSchema = Schema.String.check(
  Schema.isPattern(
    /^rtp-claim-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeClaimTokenV1"));
export type ProbeClaimToken = typeof ProbeClaimTokenSchema.Type;

export const ProbeOrdinalSchema = Schema.Int.check(
  boundedOrdinalFilter,
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeOrdinalV1"));
export type ProbeOrdinal = typeof ProbeOrdinalSchema.Type;
export const PROBE_ORDINAL_ZERO = ProbeOrdinalSchema.make(0);

export const ProbeScopeIdSchema = Schema.String.check(
  Schema.isPattern(/^rtp-scope-[a-z0-9][a-z0-9_-]{0,39}$/),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeScopeIdV1"));
export type ProbeScopeId = typeof ProbeScopeIdSchema.Type;

export const ProbeSampleIdSchema = Schema.String.check(
  Schema.isPattern(/^rtp-sample-[a-z0-9][a-z0-9_-]{0,39}-[0-9]{1,6}$/),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeSampleIdV1"));
export type ProbeSampleId = typeof ProbeSampleIdSchema.Type;

export const ProbeSessionIdSchema = Schema.String.check(
  Schema.isPattern(/^rtp-session-[a-z0-9][a-z0-9_-]{0,39}-[0-9]{1,6}$/),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeSessionIdV1"));
export type ProbeSessionId = typeof ProbeSessionIdSchema.Type;

export const ProbeAttemptIdSchema = Schema.String.check(
  Schema.isPattern(
    /^rtp-attempt-[a-z0-9][a-z0-9_-]{0,39}-[0-9]{1,6}-[0-9]{1,6}$/,
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeAttemptIdV1"));
export type ProbeAttemptId = typeof ProbeAttemptIdSchema.Type;

export const ProbeCodeIdSchema = Schema.String.check(
  Schema.isPattern(
    /^rtp-code-(?:direct|facet|invoke|invoke-finalizer|invoke-finalizer-warm|rerun)-v1-(?:stable|[a-z0-9][a-z0-9_-]{0,39}-[0-9]{1,6})$/,
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeCodeIdV1"));
export type ProbeCodeId = typeof ProbeCodeIdSchema.Type;

export const ProbeSpanIdSchema = Schema.String.check(
  Schema.isPattern(/^rtp-span-[0-9]{1,6}$/),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeSpanIdV1"));
export type ProbeSpanId = typeof ProbeSpanIdSchema.Type;

export const ProbeCodeModeSchema = Schema.Literals(["stable", "new-code"]);
export type ProbeCodeMode = typeof ProbeCodeModeSchema.Type;

export const ProbeCodeProfileSchema = Schema.Literals([
  "direct",
  "facet",
  "invoke",
  "invoke-finalizer",
  "invoke-finalizer-warm",
  "rerun",
]);
export type ProbeCodeProfile = typeof ProbeCodeProfileSchema.Type;

export class ProbeIdentityValidationError extends Data.TaggedError(
  "ProbeIdentityValidationError",
)<{
  readonly field: "ordinal" | "runId";
  readonly cause: unknown;
}> {}

const decodeUnknownProbeRunId = Schema.decodeUnknownEffect(ProbeRunIdSchema);
const decodeUnknownProbeOrdinal = Schema.decodeUnknownEffect(
  ProbeOrdinalSchema,
);

export const decodeProbeRunIdEffect = Effect.fn(
  "RuntimeTopologyProbe.decodeProbeRunId",
)(function* (
  value: unknown,
): Effect.fn.Return<ProbeRunId, ProbeIdentityValidationError> {
  return yield* decodeUnknownProbeRunId(value).pipe(
    Effect.mapError(
      cause => new ProbeIdentityValidationError({ field: "runId", cause }),
    ),
  );
});

export const decodeProbeOrdinalEffect = Effect.fn(
  "RuntimeTopologyProbe.decodeProbeOrdinal",
)(function* (
  value: unknown,
): Effect.fn.Return<ProbeOrdinal, ProbeIdentityValidationError> {
  return yield* decodeUnknownProbeOrdinal(value).pipe(
    Effect.mapError(
      cause => new ProbeIdentityValidationError({ field: "ordinal", cause }),
    ),
  );
});

export function probeScopeId(runId: ProbeRunId): ProbeScopeId {
  return ProbeScopeIdSchema.make(`rtp-scope-${runId}`);
}

export function probeRunActorId(runId: ProbeRunId): ProbeRunActorId {
  return ProbeRunActorIdSchema.make(`rtp-run-${runId}`);
}

export function newProbeClaimToken(): ProbeClaimToken {
  return ProbeClaimTokenSchema.make(`rtp-claim-${crypto.randomUUID()}`);
}

export function probeSampleId(
  runId: ProbeRunId,
  sample: ProbeOrdinal,
): ProbeSampleId {
  return ProbeSampleIdSchema.make(`rtp-sample-${runId}-${sample}`);
}

export function probeSessionId(
  runId: ProbeRunId,
  session: ProbeOrdinal,
): ProbeSessionId {
  return ProbeSessionIdSchema.make(`rtp-session-${runId}-${session}`);
}

export function probeAttemptId(
  runId: ProbeRunId,
  session: ProbeOrdinal,
  attempt: ProbeOrdinal,
): ProbeAttemptId {
  return ProbeAttemptIdSchema.make(
    `rtp-attempt-${runId}-${session}-${attempt}`,
  );
}

export type ProbeCodeIdentityInput =
  | { readonly mode: "stable"; readonly profile: ProbeCodeProfile }
  | {
      readonly mode: "new-code";
      readonly profile: ProbeCodeProfile;
      readonly runId: ProbeRunId;
      readonly version: ProbeOrdinal;
    };

export function probeCodeId(input: ProbeCodeIdentityInput): ProbeCodeId {
  switch (input.mode) {
    case "stable":
      return ProbeCodeIdSchema.make(
        `rtp-code-${input.profile}-v1-stable`,
      );
    case "new-code":
      return ProbeCodeIdSchema.make(
        `rtp-code-${input.profile}-v1-${input.runId}-${input.version}`,
      );
  }
}

export function probeSpanId(span: ProbeOrdinal): ProbeSpanId {
  return ProbeSpanIdSchema.make(`rtp-span-${span}`);
}

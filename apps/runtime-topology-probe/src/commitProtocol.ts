import { Data, Effect, Schema } from "effect";

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
  PROBE_ORDINAL_ZERO,
  type ProbeOrdinal,
} from "./identity";
import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  PROBE_LIMITS_V1,
  ProbeDurationMsSchema,
  ProbeProtocolVersionV1Schema,
  ProbeSessionModeSchema,
} from "./protocol";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

export const ProbeInvokeCommitScenarioSchema = Schema.Literals([
  "full_invoke",
  "executor_worker_invoke",
  "session_executor_invoke",
]);
export type ProbeInvokeCommitScenario =
  typeof ProbeInvokeCommitScenarioSchema.Type;

export const ProbeCommitScenarioSchema = Schema.Union([
  Schema.Literal("commit_wake"),
  ProbeInvokeCommitScenarioSchema,
]);
export type ProbeCommitScenario = typeof ProbeCommitScenarioSchema.Type;

export const ProbeSyntheticCommitSeqSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 1 && value <= 1_000_000
      ? undefined
      : "synthetic commit sequence must be from 1 through 1000000"
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeSyntheticCommitSeqV1"));
export type ProbeSyntheticCommitSeq =
  typeof ProbeSyntheticCommitSeqSchema.Type;

export const ProbeSyntheticCursorSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= 1_000_000
      ? undefined
      : "synthetic cursor must be from 0 through 1000000"
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeSyntheticCursorV1"));
export type ProbeSyntheticCursor = typeof ProbeSyntheticCursorSchema.Type;

export function probeSyntheticCommitSeq(
  sampleOrdinal: ProbeOrdinal,
): ProbeSyntheticCommitSeq {
  return ProbeSyntheticCommitSeqSchema.make(sampleOrdinal + 1);
}

const CommitIdentityShape = {
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  scopeId: ProbeScopeIdSchema,
  scenario: ProbeCommitScenarioSchema,
  commitSeq: ProbeSyntheticCommitSeqSchema,
} as const;

const ProbeSyncWakeRequestV1Shape = Schema.Struct(
  CommitIdentityShape,
).annotate(StrictStructOptions);

export const ProbeSyncWakeRequestV1Schema =
  ProbeSyncWakeRequestV1Shape.check(
    Schema.makeFilter(request => probeCommitIdentityIssueV1(request)),
  );
export type ProbeSyncWakeRequestV1 =
  typeof ProbeSyncWakeRequestV1Schema.Type;

export const ProbeSyncDispositionSchema = Schema.Literals([
  "applied",
  "duplicate",
  "gap",
  "stale",
]);
export type ProbeSyncDisposition = typeof ProbeSyncDispositionSchema.Type;

const ProbeSyncWakeReceiptV1Shape = Schema.Struct({
  ...CommitIdentityShape,
  disposition: ProbeSyncDispositionSchema,
  previousCursor: ProbeSyntheticCursorSchema,
  cursor: ProbeSyntheticCursorSchema,
  cursorDurationMs: ProbeDurationMsSchema,
}).annotate(StrictStructOptions);

export const ProbeSyncWakeReceiptV1Schema =
  ProbeSyncWakeReceiptV1Shape.check(
    Schema.makeFilter(receipt => {
      const identityIssue = probeCommitIdentityIssueV1(receipt);
      return identityIssue ?? syncReceiptIssue(receipt);
    }),
  );
export type ProbeSyncWakeReceiptV1 =
  typeof ProbeSyncWakeReceiptV1Schema.Type;

export const ProbeSyncControlOperationSchema = Schema.Literals([
  "read",
  "reset",
]);
export type ProbeSyncControlOperation =
  typeof ProbeSyncControlOperationSchema.Type;

const ProbeSyncControlRequestV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  scopeId: ProbeScopeIdSchema,
  operation: ProbeSyncControlOperationSchema,
}).annotate(StrictStructOptions);

export const ProbeSyncControlRequestV1Schema =
  ProbeSyncControlRequestV1Shape.check(
    Schema.makeFilter(request =>
      request.scopeId === probeScopeId(request.runId)
        ? undefined
        : "scopeId must be derived from runId"
    ),
  );
export type ProbeSyncControlRequestV1 =
  typeof ProbeSyncControlRequestV1Schema.Type;

const ProbeSyncControlResponseV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  scopeId: ProbeScopeIdSchema,
  operation: ProbeSyncControlOperationSchema,
  cursor: ProbeSyntheticCursorSchema,
}).annotate(StrictStructOptions);

export const ProbeSyncControlResponseV1Schema =
  ProbeSyncControlResponseV1Shape.check(
    Schema.makeFilter(response =>
      response.scopeId === probeScopeId(response.runId)
        ? undefined
        : "scopeId must be derived from runId"
    ),
  );
export type ProbeSyncControlResponseV1 =
  typeof ProbeSyncControlResponseV1Schema.Type;

const RuntimeIdentityShape = {
  sessionId: ProbeSessionIdSchema,
  sessionMode: ProbeSessionModeSchema,
  attemptId: ProbeAttemptIdSchema,
  codeMode: ProbeCodeModeSchema,
  codeId: ProbeCodeIdSchema,
} as const;

const PayloadBytesSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= PROBE_LIMITS_V1.maxPayloadBytes
      ? undefined
      : "payloadBytes exceeds the protocol limit"
  ),
);

const ProbeMockReadRequestV1Shape = Schema.Struct({
  ...CommitIdentityShape,
  ...RuntimeIdentityShape,
  payloadBytes: PayloadBytesSchema,
}).annotate(StrictStructOptions);

export const ProbeMockReadRequestV1Schema =
  ProbeMockReadRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = probeCommitIdentityIssueV1(request);
      if (identityIssue !== undefined) return identityIssue;
      if (request.scenario === "commit_wake") {
        return "mock reads are only available to invoke scenarios";
      }
      return probeInvokeRuntimeIdentityIssueV1(request);
    }),
  );
export type ProbeMockReadRequestV1 =
  typeof ProbeMockReadRequestV1Schema.Type;

const ProbeMockReadResponseV1Shape = Schema.Struct({
  ...CommitIdentityShape,
  ...RuntimeIdentityShape,
  payloadBytes: PayloadBytesSchema,
  syntheticRevision: ProbeSyntheticCursorSchema,
}).annotate(StrictStructOptions);

export const ProbeMockReadResponseV1Schema =
  ProbeMockReadResponseV1Shape.check(
    Schema.makeFilter(response => {
      const identityIssue = probeCommitIdentityIssueV1(response);
      if (identityIssue !== undefined) return identityIssue;
      if (response.scenario === "commit_wake") {
        return "mock read receipts are only available to invoke scenarios";
      }
      const runtimeIssue = probeInvokeRuntimeIdentityIssueV1(response);
      if (runtimeIssue !== undefined) return runtimeIssue;
      return response.syntheticRevision === response.commitSeq - 1
        ? undefined
        : "syntheticRevision must identify the pre-commit synthetic snapshot";
    }),
  );
export type ProbeMockReadResponseV1 =
  typeof ProbeMockReadResponseV1Schema.Type;

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

const ProbeMockCommitWakeRequestV1Shape = Schema.Struct({
  ...CommitIdentityShape,
  scenario: Schema.Literal("commit_wake"),
}).annotate(StrictStructOptions).check(
  Schema.makeFilter(request => probeCommitIdentityIssueV1(request)),
);

const ProbeMockFullInvokeFinishRequestV1Shape = Schema.Struct({
  ...CommitIdentityShape,
  scenario: ProbeInvokeCommitScenarioSchema,
  ...RuntimeIdentityShape,
  journalEntries: JournalEntriesSchema,
  sealDigest: SealDigestSchema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter(request => {
    const identityIssue = probeCommitIdentityIssueV1(request);
    return identityIssue ?? probeInvokeRuntimeIdentityIssueV1(request);
  }),
);

export const ProbeMockFinishRequestV1Schema = Schema.Union([
  ProbeMockCommitWakeRequestV1Shape,
  ProbeMockFullInvokeFinishRequestV1Shape,
]);
export type ProbeMockFinishRequestV1 =
  typeof ProbeMockFinishRequestV1Schema.Type;

const ProbeMockFinishResponseV1Shape = Schema.Struct({
  request: ProbeMockFinishRequestV1Schema,
  mockSyncWakeDurationMs: ProbeDurationMsSchema,
  sync: ProbeSyncWakeReceiptV1Schema,
}).annotate(StrictStructOptions);

export const ProbeMockFinishResponseV1Schema =
  ProbeMockFinishResponseV1Shape.check(
    Schema.makeFilter(response =>
      sameCommitIdentity(response.request, response.sync)
        ? undefined
        : "sync receipt must match the exact mock-finish request identity"
    ),
  );
export type ProbeMockFinishResponseV1 =
  typeof ProbeMockFinishResponseV1Schema.Type;

export class ProbeCommitProtocolValidationError extends Data.TaggedError(
  "ProbeCommitProtocolValidationError",
)<{
  readonly boundary:
    | "sync-wake-request"
    | "sync-wake-receipt"
    | "sync-control-request"
    | "sync-control-response"
    | "mock-read-request"
    | "mock-read-response"
    | "mock-finish-request"
    | "mock-finish-response";
  readonly cause: unknown;
}> {}

function decoder<S extends Schema.Top>(
  schema: S,
  boundary: ProbeCommitProtocolValidationError["boundary"],
) {
  const decode = Schema.decodeUnknownEffect(schema, StrictParseOptions);
  return (value: unknown) =>
    decode(value).pipe(
      Effect.mapError(
        cause => new ProbeCommitProtocolValidationError({ boundary, cause }),
      ),
    );
}

const decodeSyncWakeRequest = decoder(
  ProbeSyncWakeRequestV1Schema,
  "sync-wake-request",
);
const decodeSyncWakeReceipt = decoder(
  ProbeSyncWakeReceiptV1Schema,
  "sync-wake-receipt",
);
const decodeSyncControlRequest = decoder(
  ProbeSyncControlRequestV1Schema,
  "sync-control-request",
);
const decodeSyncControlResponse = decoder(
  ProbeSyncControlResponseV1Schema,
  "sync-control-response",
);
const decodeMockReadRequest = decoder(
  ProbeMockReadRequestV1Schema,
  "mock-read-request",
);
const decodeMockReadResponse = decoder(
  ProbeMockReadResponseV1Schema,
  "mock-read-response",
);
const decodeMockFinishRequest = decoder(
  ProbeMockFinishRequestV1Schema,
  "mock-finish-request",
);
const decodeMockFinishResponse = decoder(
  ProbeMockFinishResponseV1Schema,
  "mock-finish-response",
);

export const decodeProbeSyncWakeRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSyncWakeRequestV1",
)(function* (value: unknown) {
  return yield* decodeSyncWakeRequest(value);
});
export const decodeProbeSyncWakeReceiptV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSyncWakeReceiptV1",
)(function* (value: unknown) {
  return yield* decodeSyncWakeReceipt(value);
});
export const decodeProbeSyncControlRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSyncControlRequestV1",
)(function* (value: unknown) {
  return yield* decodeSyncControlRequest(value);
});
export const decodeProbeSyncControlResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSyncControlResponseV1",
)(function* (value: unknown) {
  return yield* decodeSyncControlResponse(value);
});
export const decodeProbeMockReadRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeMockReadRequestV1",
)(function* (value: unknown) {
  return yield* decodeMockReadRequest(value);
});
export const decodeProbeMockReadResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeMockReadResponseV1",
)(function* (value: unknown) {
  return yield* decodeMockReadResponse(value);
});
export const decodeProbeMockFinishRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeMockFinishRequestV1",
)(function* (value: unknown) {
  return yield* decodeMockFinishRequest(value);
});
export const decodeProbeMockFinishResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeMockFinishResponseV1",
)(function* (value: unknown) {
  return yield* decodeMockFinishResponse(value);
});

export const decodeProbeSyncWakeRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncWakeRequestV1Schema);
export const decodeProbeSyncWakeReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncWakeReceiptV1Schema);
export const decodeProbeSyncControlRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncControlRequestV1Schema);
export const decodeProbeMockReadRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeMockReadRequestV1Schema);
export const decodeProbeMockReadResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeMockReadResponseV1Schema);
export const decodeProbeMockFinishRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeMockFinishRequestV1Schema);
export const decodeProbeMockFinishResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeMockFinishResponseV1Schema);

export function probeCommitIdentityIssueV1(input: {
  readonly commitSeq: number;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleId: typeof ProbeSampleIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
  readonly scopeId: typeof ProbeScopeIdSchema.Type;
}): string | undefined {
  if (input.sampleId !== probeSampleId(input.runId, input.sampleOrdinal)) {
    return "sampleId must be derived from runId and sampleOrdinal";
  }
  if (input.scopeId !== probeScopeId(input.runId)) {
    return "scopeId must be derived from runId";
  }
  return input.commitSeq === probeSyntheticCommitSeq(input.sampleOrdinal)
    ? undefined
    : "commitSeq must be one greater than sampleOrdinal";
}

export function probeInvokeRuntimeIdentityIssueV1(input: {
  readonly attemptId: typeof ProbeAttemptIdSchema.Type;
  readonly codeId: typeof ProbeCodeIdSchema.Type;
  readonly codeMode: typeof ProbeCodeModeSchema.Type;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
  readonly sessionId: typeof ProbeSessionIdSchema.Type;
  readonly sessionMode: typeof ProbeSessionModeSchema.Type;
}): string | undefined {
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
    ? probeCodeId({ mode: "stable", profile: "invoke" })
    : probeCodeId({
        mode: "new-code",
        profile: "invoke",
        runId: input.runId,
        version: input.sampleOrdinal,
      });
  return input.codeId === expectedCodeId
    ? undefined
    : "codeId must identify the invoke-v1 source and code mode";
}

function syncReceiptIssue(input: {
  readonly commitSeq: number;
  readonly cursor: number;
  readonly disposition: ProbeSyncDisposition;
  readonly previousCursor: number;
}): string | undefined {
  const unchanged = input.cursor === input.previousCursor;
  switch (input.disposition) {
    case "applied":
      return input.commitSeq === input.previousCursor + 1 &&
          input.cursor === input.commitSeq
        ? undefined
        : "applied wake must advance the cursor by exactly one";
    case "duplicate":
      return input.commitSeq === input.previousCursor && unchanged
        ? undefined
        : "duplicate wake must equal and preserve the current cursor";
    case "stale":
      return input.commitSeq < input.previousCursor && unchanged
        ? undefined
        : "stale wake must precede and preserve the current cursor";
    case "gap":
      return input.commitSeq > input.previousCursor + 1 && unchanged
        ? undefined
        : "gap wake must skip and preserve the current cursor";
  }
}

function sameCommitIdentity(
  left: ProbeMockFinishRequestV1,
  right: ProbeSyncWakeReceiptV1,
): boolean {
  return left.protocolVersion === right.protocolVersion &&
    left.runId === right.runId &&
    left.sampleId === right.sampleId &&
    left.sampleOrdinal === right.sampleOrdinal &&
    left.scopeId === right.scopeId &&
    left.scenario === right.scenario &&
    left.commitSeq === right.commitSeq;
}

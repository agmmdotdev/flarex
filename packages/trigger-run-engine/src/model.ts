// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
// Copyright (c) 2023 Trigger.dev.
import { Data, Schema } from "effect";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const NonNegativeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/** Data and correlation only: none of these schemas issues core authority. */
export const DatabaseTimeMsSchema = NonNegativeInteger;
export const ExecutionStatusSchema = Schema.Literals([
  "RUN_CREATED", "DELAYED", "QUEUED", "PENDING_EXECUTING", "EXECUTING",
  "EXECUTING_WITH_WAITPOINTS", "SUSPENDED", "QUEUED_EXECUTING", "PENDING_CANCEL", "FINISHED",
]);
export type ExecutionStatus = typeof ExecutionStatusSchema.Type;

export const CompletedWaitpointSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  index: Schema.optionalKey(NonNegativeInteger),
}).annotate(strict);
export const ExecutionSnapshotSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  executionStatus: ExecutionStatusSchema,
  attemptNumber: Schema.NullOr(NonNegativeInteger),
  createdAtMs: DatabaseTimeMsSchema,
  updatedAtMs: DatabaseTimeMsSchema,
  completedWaitpoints: Schema.Array(CompletedWaitpointSchema),
}).annotate(strict);
export type ExecutionSnapshot = typeof ExecutionSnapshotSchema.Type;

export const AttemptRunSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  attemptNumber: Schema.NullOr(NonNegativeInteger),
  lockedById: Schema.NullOr(Schema.NonEmptyString),
  ttl: Schema.NullOr(Schema.NonEmptyString),
}).annotate(strict);
export type AttemptRun = typeof AttemptRunSchema.Type;

export const StartedRunSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.Literal("EXECUTING"),
  attemptNumber: PositiveInteger,
  executedAtMs: Schema.NullOr(DatabaseTimeMsSchema),
}).annotate(strict);
export type StartedRun = typeof StartedRunSchema.Type;

export const MaxAttemptsRunErrorSchema = Schema.Struct({
  type: Schema.Literal("INTERNAL_ERROR"),
  code: Schema.Literal("TASK_RUN_CRASHED"),
  message: Schema.Literal("Max attempts reached."),
}).annotate(strict);
export type MaxAttemptsRunError = typeof MaxAttemptsRunErrorSchema.Type;

export const FailedRunSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.Literal("CRASHED"),
  attemptNumber: Schema.NullOr(NonNegativeInteger),
  completedAtMs: DatabaseTimeMsSchema,
  associatedWaitpointId: Schema.NullOr(Schema.NonEmptyString),
}).annotate(strict);
export type FailedRun = typeof FailedRunSchema.Type;

export const StartRunAttemptInputSchema = Schema.Struct({
  snapshotId: Schema.NonEmptyString,
  workerId: Schema.optionalKey(Schema.NonEmptyString),
  runnerId: Schema.optionalKey(Schema.NonEmptyString),
  isWarmStart: Schema.optionalKey(Schema.Boolean),
}).annotate(strict);
export type StartRunAttemptInput = typeof StartRunAttemptInputSchema.Type;

export const StartAttemptWriteSchema = Schema.Struct({
  attemptNumber: PositiveInteger,
  executedAtMs: Schema.optionalKey(DatabaseTimeMsSchema),
  isWarmStart: Schema.Boolean,
}).annotate(strict);
export type StartAttemptWrite = typeof StartAttemptWriteSchema.Type;

export const PermanentFailureWriteSchema = Schema.Struct({
  status: Schema.Literal("CRASHED"),
  completedAtMs: DatabaseTimeMsSchema,
  error: MaxAttemptsRunErrorSchema,
}).annotate(strict);
export type PermanentFailureWrite = typeof PermanentFailureWriteSchema.Type;

export const CreateExecutionSnapshotInputSchema = Schema.Struct({
  run: Schema.Struct({
    id: Schema.NonEmptyString,
    status: Schema.Literals(["EXECUTING", "CRASHED"]),
    attemptNumber: Schema.NullOr(NonNegativeInteger),
  }).annotate(strict),
  snapshot: Schema.Struct({
    executionStatus: ExecutionStatusSchema,
    description: Schema.String,
  }).annotate(strict),
  previousSnapshotId: Schema.optionalKey(Schema.NonEmptyString),
  workerId: Schema.optionalKey(Schema.NonEmptyString),
  runnerId: Schema.optionalKey(Schema.NonEmptyString),
  completedWaitpoints: Schema.optionalKey(Schema.Array(CompletedWaitpointSchema)),
  error: Schema.optionalKey(Schema.String),
}).annotate(strict);
export type CreateExecutionSnapshotInput = typeof CreateExecutionSnapshotInputSchema.Type;

export const HeartbeatTimeoutsSchema = Schema.Struct({
  PENDING_EXECUTING: PositiveInteger,
  PENDING_CANCEL: PositiveInteger,
  EXECUTING: PositiveInteger,
  EXECUTING_WITH_WAITPOINTS: PositiveInteger,
  SUSPENDED: PositiveInteger,
}).annotate(strict);
export type HeartbeatTimeouts = typeof HeartbeatTimeoutsSchema.Type;

/** Durable requests only. An outer owner must settle before dispatching notices. */
export const AttemptStartIntentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("heartbeatDue"), runId: Schema.NonEmptyString,
    snapshotId: Schema.NonEmptyString, availableAtMs: DatabaseTimeMsSchema }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("executionSnapshotCreated"), runId: Schema.NonEmptyString,
    snapshot: ExecutionSnapshotSchema, completedWaitpointIds: Schema.Array(Schema.NonEmptyString),
    atMs: DatabaseTimeMsSchema }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("expireRunRetirement"), runId: Schema.NonEmptyString }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("runAttemptStarted"), runId: Schema.NonEmptyString,
    snapshotId: Schema.NonEmptyString, attemptNumber: PositiveInteger, atMs: DatabaseTimeMsSchema }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("queueRelease"), runId: Schema.NonEmptyString,
    removeFromWorkerQueue: Schema.Literal(true) }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("completeAssociatedWaitpoint"), runId: Schema.NonEmptyString,
    waitpointId: Schema.NonEmptyString, output: Schema.Struct({
      value: Schema.String, isError: Schema.Literal(true),
    }).annotate(strict) }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("runFailed"), runId: Schema.NonEmptyString,
    status: Schema.Literal("CRASHED"), attemptNumber: PositiveInteger,
    error: MaxAttemptsRunErrorSchema, atMs: DatabaseTimeMsSchema }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("heartbeatRetirement"), runId: Schema.NonEmptyString }).annotate(strict),
]);
export type AttemptStartIntent = typeof AttemptStartIntentSchema.Type;

export class AttemptStartValidationError extends Data.TaggedError("AttemptStartValidationError")<{
  readonly reason: "snapshotChanged" | "runNotFound" | "alreadyFinished" | "runNotLocked";
  readonly statusCode: 400 | 404 | 409;
  readonly message: string;
  readonly runId: string;
  readonly snapshotId: string;
  readonly latestSnapshotId?: string;
}> {}

export const AttemptStartOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("started"), run: StartedRunSchema,
    snapshot: ExecutionSnapshotSchema }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("startRefusedAfterTerminalization"), run: FailedRunSchema,
    snapshot: ExecutionSnapshotSchema, refusal: Schema.Struct({
      reason: Schema.Literal("maxAttemptsReached"), message: Schema.Literal("Max attempts reached"),
      statusCode: Schema.Literal(400),
    }).annotate(strict) }).annotate(strict),
]);
export type AttemptStartOutcome = typeof AttemptStartOutcomeSchema.Type;

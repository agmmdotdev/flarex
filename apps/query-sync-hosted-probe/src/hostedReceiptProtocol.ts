import { Result, Schema } from "effect";

import { FX02B_PROBE_OBJECT_NAME } from "./fixture";

const StrictStructOptions = Object.freeze({
  parseOptions: { onExcessProperty: "error" as const },
});
const StrictParseOptions = Object.freeze({
  onExcessProperty: "error" as const,
});

const InitialOutcomeSchema = Schema.Struct({
  state: Schema.Literal("continuationRequired"),
  reason: Schema.Literal("admittedBatchLimitReached"),
  cursor: Schema.String,
}).annotate(StrictStructOptions);

const ResumeOutcomeSchema = Schema.Struct({
  state: Schema.Literal("caughtUp"),
  cursor: Schema.String,
}).annotate(StrictStructOptions);

export const Fx02bInitialHostedReceiptSchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  phase: Schema.Literal("initialize"),
  releaseMarker: Schema.NonEmptyString,
  workerVersionId: Schema.NonEmptyString,
  objectName: Schema.Literal(FX02B_PROBE_OBJECT_NAME),
  bootId: Schema.NonEmptyString,
  outcome: InitialOutcomeSchema,
}).annotate(StrictStructOptions);

export const Fx02bResumeHostedReceiptSchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  phase: Schema.Literal("resume"),
  releaseMarker: Schema.NonEmptyString,
  workerVersionId: Schema.NonEmptyString,
  objectName: Schema.Literal(FX02B_PROBE_OBJECT_NAME),
  bootId: Schema.NonEmptyString,
  outcome: ResumeOutcomeSchema,
}).annotate(StrictStructOptions);

export const Fx02bHostedIdentityReceiptSchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  phase: Schema.Literal("identity"),
  releaseMarker: Schema.NonEmptyString,
  workerVersionId: Schema.NonEmptyString,
  objectName: Schema.Literal(FX02B_PROBE_OBJECT_NAME),
  bootId: Schema.NonEmptyString,
}).annotate(StrictStructOptions);

export type Fx02bInitialHostedReceipt = Schema.Schema.Type<
  typeof Fx02bInitialHostedReceiptSchema
>;

export type Fx02bResumeHostedReceipt = Schema.Schema.Type<
  typeof Fx02bResumeHostedReceiptSchema
>;

export type Fx02bHostedIdentityReceipt = Schema.Schema.Type<
  typeof Fx02bHostedIdentityReceiptSchema
>;

export function decodeFx02bInitialHostedReceipt(
  value: unknown,
): Result.Result<Fx02bInitialHostedReceipt, Schema.SchemaError> {
  return Schema.decodeUnknownResult(
    Fx02bInitialHostedReceiptSchema,
    StrictParseOptions,
  )(value);
}

export function decodeFx02bResumeHostedReceipt(
  value: unknown,
): Result.Result<Fx02bResumeHostedReceipt, Schema.SchemaError> {
  return Schema.decodeUnknownResult(
    Fx02bResumeHostedReceiptSchema,
    StrictParseOptions,
  )(value);
}

export function decodeFx02bHostedIdentityReceipt(
  value: unknown,
): Result.Result<Fx02bHostedIdentityReceipt, Schema.SchemaError> {
  return Schema.decodeUnknownResult(
    Fx02bHostedIdentityReceiptSchema,
    StrictParseOptions,
  )(value);
}

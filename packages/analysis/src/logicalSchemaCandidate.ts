import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Schema } from "effect";
import {
  decodeLogicalSchemaCandidate,
  LogicalSchemaSourceSchema,
  MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
  type LogicalSchemaCandidate,
  type LogicalSchemaSource,
} from "flarex-protocol/internal/logical-schema-candidate";
import { encodeCanonicalJson, isJson, measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import { makeLivePrivateSha256V1 } from "./privateSha256V1";

export class LogicalSchemaCandidateError extends Data.TaggedError("LogicalSchemaCandidateError")<{
  readonly reason: "invalidInput" | "unsupportedPlacement" | "digestMismatch" | "limitExceeded" | "digestUnavailable" | "unpreparedCandidate";
  readonly cause?: unknown;
}> {}
const maximumBytes = MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES;
const utf8 = new TextEncoder();
const digest = makeLivePrivateSha256V1({
  invalidBudget: () => new LogicalSchemaCandidateError({ reason: "limitExceeded" }),
  invalidBytes: () => new LogicalSchemaCandidateError({ reason: "invalidInput" }),
  inputBytesExceeded: () => new LogicalSchemaCandidateError({ reason: "limitExceeded" }),
  unavailable: () => new LogicalSchemaCandidateError({ reason: "digestUnavailable" }),
  nativeRejected: (cause) => new LogicalSchemaCandidateError({ reason: "digestUnavailable", cause }),
  invalidDigestOutput: () => new Error("Logical schema digest lost SHA-256 contract"),
});

/** Content integrity only. The backend must invoke native compiler/source owners. */
export const captureLogicalSchemaSource = Effect.fn("LogicalSchema.captureSource")(function* (
  source: Omit<LogicalSchemaSource, "sourceSha256">,
) {
  const sourceSha256 = yield* digestSource(source);
  return yield* Schema.decodeUnknownEffect(LogicalSchemaSourceSchema)({ ...source, sourceSha256 }).pipe(
    Effect.mapError(cause => new LogicalSchemaCandidateError({ reason: "invalidInput", cause })),
  );
});

const preparedBrand: unique symbol = Symbol("Flarex/PreparedLogicalSchemaCandidate");
export interface PreparedLogicalSchemaCandidate {
  readonly [preparedBrand]: true;
}
const preparedCandidates = new WeakMap<PreparedLogicalSchemaCandidate, LogicalSchemaCandidate>();

/** Private trusted-composition seam; this never issues serving or function authority. */
export const prepareLogicalSchemaCandidate = Effect.fn("LogicalSchema.prepareCandidate")(function* (
  input: LogicalSchemaCandidate,
): Effect.fn.Return<PreparedLogicalSchemaCandidate, LogicalSchemaCandidateError> {
  const candidate = yield* Effect.fromResult(decodeLogicalSchemaCandidate(input)).pipe(
    Effect.mapError(cause => new LogicalSchemaCandidateError({ reason: "invalidInput", cause })),
  );
  yield* verifyLogicalSchemaCandidateDigests(candidate);
  const prepared = Object.freeze({ [preparedBrand]: true } satisfies PreparedLogicalSchemaCandidate);
  preparedCandidates.set(prepared, candidate);
  return prepared;
});

/** Established decoded candidate only; does not issue a preparation capability. */
export const verifyLogicalSchemaCandidateDigests = Effect.fn("LogicalSchema.verifyDigests")(function* (
  candidate: LogicalSchemaCandidate,
) {
  if (measureCanonicalJsonUtf8Bytes(candidate, maximumBytes).kind !== "success") {
    return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "limitExceeded" }));
  }
  for (const { sourceSha256, ...source } of candidate.sources) {
    if (yield* digestSource(source).pipe(Effect.map(actual => actual !== sourceSha256))) {
      return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "digestMismatch" }));
    }
  }
});

export const readPreparedLogicalSchemaCandidate = Effect.fn("LogicalSchema.readPrepared")(function* (
  prepared: PreparedLogicalSchemaCandidate,
) {
  const candidate = preparedCandidates.get(prepared);
  if (candidate === undefined) return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "unpreparedCandidate" }));
  return candidate;
});

const digestSource = Effect.fn("LogicalSchema.digestSource")(function* (value: Omit<LogicalSchemaSource, "sourceSha256">) {
  if (!isJson(value)) return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "invalidInput" }));
  if (measureCanonicalJsonUtf8Bytes(value, maximumBytes).kind !== "success") {
    return yield* Effect.fail(new LogicalSchemaCandidateError({ reason: "limitExceeded" }));
  }
  const text = encodeCanonicalJson(value, issue => { throw new Error(`Logical source JSON invariant: ${issue.reason}`); });
  return yield* digest(utf8.encode(text), { maximumInputBytes: maximumBytes }).pipe(Effect.map(encodeBytesToLowercaseHex));
});

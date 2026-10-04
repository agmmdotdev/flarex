import { bytesEqualFullScan, encodeBytesToLowercaseHex, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { and, eq, isNull } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema, SnapshotTokenSchema, StorageGenerationFenceSchema,
  projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { TransactionAttemptFenceSchema, TransactionSessionIdV1Schema } from "flarex-protocol/transaction-session";
import { capturePrivateCanonicalValue, verifyStoredPrivateCanonicalValue } from "./frameworkSchema/privateCanonicalValue";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { fxSystemSnapshotLeases } from "./schema";

export const MAX_FINITE_METADATA_RESERVATION_BYTES = 65_536;
const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const sequence = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));

/** An exact selector of immutable entry evidence, not a historical metadata
 * lookup API or a replacement for the live execution authority. */
export const FiniteMetadataReservationSchema = Schema.Struct({
  format: Schema.Literal("flarex.finite-metadata-reservation"), version: Schema.Literal(1),
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  sessionId: TransactionSessionIdV1Schema,
  attemptFence: TransactionAttemptFenceSchema,
  storageGeneration: Schema.Literal("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema,
  snapshotToken: SnapshotTokenSchema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  metadataWatermark: MetadataSequenceSchema,
  application: Schema.Struct({
    revisionId: Schema.NonEmptyString, activationSequence: sequence,
    headSha256: digest, activationSha256: digest,
    schemaVersionId: CatalogSchemaVersionIdSchema, manifestSha256: digest,
  }).annotate(strict),
  binding: Schema.NullOr(Schema.Struct({ sequence, sha256: digest,
    candidateSha256: digest, activationSha256: digest }).annotate(strict)),
}).annotate(strict);
export type FiniteMetadataReservation = typeof FiniteMetadataReservationSchema.Type;
export type FiniteMetadataReservationInput = Omit<FiniteMetadataReservation, "format" | "version">;

export class FiniteMetadataReservationError extends Data.TaggedError("FiniteMetadataReservationError")<{
  readonly reason: "invalidInput" | "storedCorruption" | "reservationMismatch" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: FiniteMetadataReservationError["reason"], cause?: unknown) =>
  new FiniteMetadataReservationError({ reason, ...(cause === undefined ? {} : { cause }) });
const encode = Schema.encodeSync(FiniteMetadataReservationSchema);
const decode = Schema.decodeUnknownEffect(FiniteMetadataReservationSchema, { onExcessProperty: "error" });
const decodeCapturedTypeEffect = Schema.decodeUnknownEffect(Schema.toType(FiniteMetadataReservationSchema));

declare const reservationBrand: unique symbol;
export interface CapturedFiniteMetadataReservation { readonly [reservationBrand]: true }
interface CapturedState {
  readonly value: FiniteMetadataReservation;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}
const reservations = new WeakMap<CapturedFiniteMetadataReservation, CapturedState>();

export const captureFiniteMetadataReservation = Effect.fn("FiniteMetadataReservation.capture")(function* (
  input: FiniteMetadataReservationInput,
) {
  const value = yield* decodeCapturedTypeEffect({
    format: "flarex.finite-metadata-reservation", version: 1, ...input,
  }).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
  if (value.snapshotToken.scopeId !== value.scopeId || value.application.schemaVersionId !== value.schemaVersionId)
    return yield* Effect.fail(failure("invalidInput"));
  const canonical = yield* capturePrivateCanonicalValue(encode(value), MAX_FINITE_METADATA_RESERVATION_BYTES, {
    invalidInput: () => failure("invalidInput"), hashFailure: cause => failure("resourceFailure", cause),
  });
  // SAFETY: only this module registers a captured canonical selector. A copied
  // or caller-authored object has no usable reservation evidence.
  const token = Object.freeze({}) as CapturedFiniteMetadataReservation;
  reservations.set(token, Object.freeze({ value: Object.freeze({ ...value,
    snapshotToken: Object.freeze({ ...value.snapshotToken }), application: Object.freeze({ ...value.application }),
    binding: value.binding === null ? null : Object.freeze({ ...value.binding }) }),
    canonicalBytes: canonical.copyCanonicalBytes(), sha256: canonical.copySha256Bytes() }));
  return token;
});

export const readCapturedFiniteMetadataReservation = (reservation: CapturedFiniteMetadataReservation) =>
  reservations.get(reservation)?.value ?? null;
export const getCapturedFiniteMetadataReservationSha256Hex = (reservation: CapturedFiniteMetadataReservation) => {
  const state = reservations.get(reservation);
  return state === undefined ? null : encodeBytesToLowercaseHex(state.sha256);
};

/** Entry writes once while the authentic session and lease are locked. The
 * enclosing transaction must confirm COMMIT before its owner can serve reads. */
export const persistFiniteMetadataReservationInTransaction = Effect.fn("FiniteMetadataReservation.persist")(function* (
  tx: FlarexMetadataTransaction, reservation: CapturedFiniteMetadataReservation,
) {
  const state = reservations.get(reservation);
  if (state === undefined) return yield* Effect.fail(failure("invalidInput"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.value.scopeId)
    .pipe(Result.mapError(cause => failure("invalidInput", cause))));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(state.value.snapshotToken.epoch)
    .pipe(Result.mapError(cause => failure("invalidInput", cause))));
  const rows = yield* runDrizzleStatementEffect(tx.update(fxSystemSnapshotLeases).set({
    metadataWatermark: state.value.metadataWatermark,
    finiteMetadataReservationBytes: state.canonicalBytes,
    finiteMetadataReservationSha256: state.sha256,
  }).where(and(eq(fxSystemSnapshotLeases.scopeUuid, scope.scopeUuid),
    eq(fxSystemSnapshotLeases.sessionId, state.value.sessionId),
    eq(fxSystemSnapshotLeases.attemptFence, state.value.attemptFence),
    eq(fxSystemSnapshotLeases.snapshotEpochUuid, epoch.epochUuid),
    eq(fxSystemSnapshotLeases.snapshotCommitSeq, state.value.snapshotToken.commitSeq),
    isNull(fxSystemSnapshotLeases.metadataWatermark),
    isNull(fxSystemSnapshotLeases.finiteMetadataReservationBytes),
    isNull(fxSystemSnapshotLeases.finiteMetadataReservationSha256),
  )).returning(), cause => failure("resourceFailure", cause));
  if (rows.length !== 1) return yield* Effect.fail(failure("reservationMismatch"));
  yield* Effect.fromResult(requireCapturedFiniteMetadataReservationRow(reservation, rows[0]!));
  return rows[0]!;
});

/** The finite runner already locks and authenticates this exact lease. Compare
 * its stored selector to the confirmed entry capture without rehashing it or
 * issuing another lease query at every read frontier. */
export const requireCapturedFiniteMetadataReservationRow = (
  reservation: CapturedFiniteMetadataReservation,
  row: typeof fxSystemSnapshotLeases.$inferSelect,
): Result.Result<void, FiniteMetadataReservationError> => Result.gen(function* () {
  const state = reservations.get(reservation);
  if (state === undefined) return yield* Result.fail(failure("invalidInput"));
  const scope = yield* projectScopeIdUuidV1Result(state.value.scopeId)
    .pipe(Result.mapError(() => failure("reservationMismatch")));
  if (row.scopeUuid !== scope.scopeUuid || row.sessionId !== state.value.sessionId)
    return yield* Result.fail(failure("reservationMismatch"));
  const epoch = yield* projectScopeEpochUuidV1Result(state.value.snapshotToken.epoch)
    .pipe(Result.mapError(() => failure("reservationMismatch")));
  if (row.attemptFence !== state.value.attemptFence || row.snapshotEpochUuid !== epoch.epochUuid ||
    row.snapshotCommitSeq !== state.value.snapshotToken.commitSeq || row.metadataWatermark !== state.value.metadataWatermark ||
    row.finiteMetadataReservationBytes === null || row.finiteMetadataReservationSha256 === null ||
    !bytesEqualFullScan(row.finiteMetadataReservationBytes, state.canonicalBytes) ||
    !bytesEqualFullScan(row.finiteMetadataReservationSha256, state.sha256))
    return yield* Result.fail(failure("reservationMismatch"));
});

/** Durable recovery and retirement authenticate the stored canonical selector;
 * absent evidence is never assigned an invented historical watermark. */
export const readStoredFiniteMetadataReservation = Effect.fn("FiniteMetadataReservation.readStored")(function* (
  row: typeof fxSystemSnapshotLeases.$inferSelect,
) {
  if (row.metadataWatermark === null || row.finiteMetadataReservationBytes === null ||
    !isUint8ArrayWithByteLength(row.finiteMetadataReservationSha256, 32))
    return yield* Effect.fail(failure("storedCorruption"));
  const frame = yield* verifyStoredPrivateCanonicalValue({ canonicalBytes: row.finiteMetadataReservationBytes,
    sha256Hex: encodeBytesToLowercaseHex(row.finiteMetadataReservationSha256),
    expectedFormat: "flarex.finite-metadata-reservation", expectedVersion: 1,
    maximumCanonicalBytes: MAX_FINITE_METADATA_RESERVATION_BYTES, expectedKeys: undefined,
  }, { storedCorruption: () => failure("storedCorruption"), hashFailure: cause => failure("resourceFailure", cause) });
  const value = yield* decode(frame).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(value.scopeId)
    .pipe(Result.mapError(cause => failure("storedCorruption", cause))));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(value.snapshotToken.epoch)
    .pipe(Result.mapError(cause => failure("storedCorruption", cause))));
  if (row.scopeUuid !== scope.scopeUuid || row.sessionId !== value.sessionId || row.attemptFence !== value.attemptFence ||
    row.snapshotEpochUuid !== epoch.epochUuid || row.snapshotCommitSeq !== value.snapshotToken.commitSeq ||
    row.metadataWatermark !== value.metadataWatermark || value.snapshotToken.scopeId !== value.scopeId ||
    value.application.schemaVersionId !== value.schemaVersionId)
    return yield* Effect.fail(failure("storedCorruption"));
  return value;
});

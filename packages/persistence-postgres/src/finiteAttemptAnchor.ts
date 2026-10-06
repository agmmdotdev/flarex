import { and, eq } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { bytesEqualFullScan, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { SnapshotTokenSchema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result,
  type SnapshotToken } from "flarex-protocol/storage-authority";
import { FiniteMetadataReservationSchema, readCapturedFiniteMetadataReservation,
  type CapturedFiniteMetadataReservation, type FiniteMetadataReservation } from "./finiteMetadataReservation";
import { capturePrivateCanonicalValue, verifyStoredPrivateCanonicalValue } from "./frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import type { AppRowTransaction } from "./appRows";
import { fxSystemTransactionSessions } from "./schema";
import { readOriginalFiniteExecutionAuthority, type OriginalFiniteExecutionEntry } from "./sessionJournalFiniteEntry";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "./storedCommitAuthority/postgresLoader";
import { decodeTransactionExecutionClaimFenceV1, decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimPinV1, type TransactionExecutionClaimObservationV1 } from "./transactionExecutionClaimModel";
import type { PointMutationSessionAttemptSelectorV1 } from "./transactionSessionActivation";
import { MAX_TRANSACTION_ATTEMPT_FENCE, TRANSACTION_SESSION_PROTOCOL_VERSION_V1, TransactionAttemptFenceSchema,
  TransactionSessionLifecycleV1Schema } from "flarex-protocol/transaction-session";
import type { TransactionExecutionClaimOwnerV1 } from "./transactionExecutionClaimModel";
import { TransactionExecutionClaimOwnerV1Schema, TransactionExecutionClaimFenceV1Schema } from "./transactionExecutionClaimModel";

const MAX_ANCHOR_BYTES = 131_072;
const AnchorSchema = Schema.Struct({ format: Schema.Literal("flarex.finite-attempt-anchor"), version: Schema.Literal(1),
  snapshotToken: SnapshotTokenSchema, reservation: Schema.NullOr(FiniteMetadataReservationSchema),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const encode = Schema.encodeSync(AnchorSchema);
const decode = Schema.decodeUnknownEffect(AnchorSchema, { onExcessProperty: "error" });
const decodeType = Schema.decodeUnknownEffect(Schema.toType(AnchorSchema));
type SessionRow = typeof fxSystemTransactionSessions.$inferSelect;

/** Exact live frontier envelope. Canonical anchor bytes and digest remain in
 * the projection; argument, grant and executable payloads belong to entry and
 * durable recovery, not each native storage demand. */
export type FiniteAttemptFrontierRow = Pick<SessionRow,
  | "scopeUuid"
  | "sessionId"
  | "attemptFence"
  | "executionProfile"
  | "policyVersion"
  | "protocolVersion"
  | "executionAuthorityGeneration"
  | "functionPath"
  | "functionKind"
  | "executionModule"
  | "schemaVersionId"
  | "packageId"
  | "artifactRuntime"
  | "artifactId"
  | "sourcePackageHash"
  | "validatedArgsValueCodecVersion"
  | "authorizationGrantValueCodecVersion"
  | "storageGeneration"
  | "storageGenerationFence"
  | "identityAccessPolicySha256"
  | "requestSha256"
  | "validatedArgsSha256"
  | "authorizationGrantId"
  | "authorizationGrantSha256"
  | "applicationExecutionAuthoritySha256"
  | "requestKey"
  | "lifecycle"
  | "authorizationRevocationEpoch"
  | "authorizationGrantExpiresAt"
  | "hardExpiresAt"
  | "createdAt"
  | "updatedAt"
  | "finiteAttemptBytes"
  | "finiteAttemptSha256"
  | "finiteSnapshotEpochUuid"
  | "finiteSnapshotCommitSeq"
  | "finiteMetadataWatermark"
  | "finiteLeaseExpiresAt"
  | "finiteClaimOwner"
  | "finiteClaimFence"
  | "finiteClaimedAt"
  | "finiteClaimExpiresAt"
>;

export class FiniteAttemptAnchorError extends Data.TaggedError("FiniteAttemptAnchorError")<{
  readonly reason: "invalidInput" | "storedCorruption" | "attemptMissing" | "attemptReplaced" |
    "ownershipChanged" | "expired" | "lifecycleChanged" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: FiniteAttemptAnchorError["reason"], cause?: unknown) =>
  new FiniteAttemptAnchorError({ reason, ...(cause === undefined ? {} : { cause }) });

declare const capturedBrand: unique symbol;
export interface CapturedFiniteAttemptAnchor { readonly [capturedBrand]: true }
interface CapturedState { readonly value: typeof AnchorSchema.Type; readonly bytes: Uint8Array; readonly digest: Uint8Array;
  readonly immutablePins?: ReturnType<typeof projectImmutableFrontierPins> }
const captured = new WeakMap<CapturedFiniteAttemptAnchor, CapturedState>();

/** Exact typed stored-column projection. Hashes are request pins alongside
 * the byte-for-byte canonical anchor witness, never a replacement for it. */
function projectImmutableFrontierPins(row: FiniteAttemptFrontierRow) {
  return Object.freeze({ scopeUuid: row.scopeUuid, sessionId: row.sessionId, attemptFence: row.attemptFence,
    policyVersion: row.policyVersion, protocolVersion: row.protocolVersion,
    executionProfile: row.executionProfile, executionAuthorityGeneration: row.executionAuthorityGeneration,
    functionPath: row.functionPath, functionKind: row.functionKind, executionModule: row.executionModule,
    packageId: row.packageId, artifactRuntime: row.artifactRuntime, artifactId: row.artifactId,
    sourcePackageHash: row.sourcePackageHash, validatedArgsValueCodecVersion: row.validatedArgsValueCodecVersion,
    authorizationGrantValueCodecVersion: row.authorizationGrantValueCodecVersion,
    schemaVersionId: row.schemaVersionId, storageGeneration: row.storageGeneration,
    storageGenerationFence: row.storageGenerationFence, requestKey: row.requestKey,
    authorizationRevocationEpoch: row.authorizationRevocationEpoch, authorizationGrantId: row.authorizationGrantId,
    authorizationGrantExpiresAt: row.authorizationGrantExpiresAt.getTime(), hardExpiresAt: row.hardExpiresAt.getTime(),
    createdAt: row.createdAt.getTime(), identityAccessPolicySha256: encodeBytesToLowercaseHex(row.identityAccessPolicySha256),
    requestSha256: encodeBytesToLowercaseHex(row.requestSha256), validatedArgsSha256: encodeBytesToLowercaseHex(row.validatedArgsSha256),
    authorizationGrantSha256: encodeBytesToLowercaseHex(row.authorizationGrantSha256),
    applicationExecutionAuthoritySha256: row.applicationExecutionAuthoritySha256 === null ? null :
      encodeBytesToLowercaseHex(row.applicationExecutionAuthoritySha256),
  });
}

/** The trusted entry owner first pins its complete row expectation. Initial
 * admission separately requires the installed command's full stored-row comparison
 * and entry COMMIT ACK before SessionJournal exposes an executable handle. Named
 * storage captures cannot authenticate a cold or caller-authored expectation. */
export function projectExpectedFiniteAttemptAnchor(handle: CapturedFiniteAttemptAnchor) {
  const state = captured.get(handle);
  if (state === undefined || state.immutablePins === undefined)
    return Result.fail(failure("invalidInput"));
  return Result.succeed(Object.freeze({ bytes: copyBytes(state.bytes), digest: copyBytes(state.digest),
    pins: state.immutablePins, snapshotToken: state.value.snapshotToken, reservation: state.value.reservation }));
}

/** Snapshot and selected metadata are immutable attempt evidence. Ownership
 * deadlines live in direct anchor columns and renew without reencoding this body. */
export const captureFiniteAttemptAnchor = Effect.fn("FiniteAttemptAnchor.capture")(function* (
  input: Readonly<{ snapshotToken: SnapshotToken; reservation?: CapturedFiniteMetadataReservation }>,
) {
  const reservation = input.reservation === undefined ? null : readCapturedFiniteMetadataReservation(input.reservation);
  if (input.reservation !== undefined && reservation === null) return yield* Effect.fail(failure("invalidInput"));
  const value = yield* decodeType({ format: "flarex.finite-attempt-anchor", version: 1,
    snapshotToken: input.snapshotToken, reservation }).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
  if (reservation !== null && (reservation.snapshotToken.scopeId !== value.snapshotToken.scopeId ||
    reservation.snapshotToken.epoch !== value.snapshotToken.epoch || reservation.snapshotToken.commitSeq !== value.snapshotToken.commitSeq))
    return yield* Effect.fail(failure("invalidInput"));
  const canonical = yield* capturePrivateCanonicalValue(encode(value), MAX_ANCHOR_BYTES, {
    invalidInput: () => failure("invalidInput"), hashFailure: cause => failure("resourceFailure", cause),
  });
  // SAFETY: only this codec issues the private capture of canonical entry facts.
  const handle = Object.freeze({}) as CapturedFiniteAttemptAnchor;
  captured.set(handle, { value, bytes: canonical.copyCanonicalBytes(), digest: canonical.copySha256Bytes() });
  return handle;
});

export const projectCapturedFiniteAttemptAnchor = (handle: CapturedFiniteAttemptAnchor) => Result.gen(function* () {
  const state = captured.get(handle);
  if (state === undefined) return yield* Result.fail(failure("invalidInput"));
  const epoch = yield* projectScopeEpochUuidV1Result(state.value.snapshotToken.epoch)
    .pipe(Result.mapError(cause => failure("invalidInput", cause)));
  return Object.freeze({ executionProfile: "finiteRoot" as const,
    finiteAttemptBytes: copyBytes(state.bytes), finiteAttemptSha256: copyBytes(state.digest),
    finiteSnapshotEpochUuid: epoch.epochUuid, finiteSnapshotCommitSeq: state.value.snapshotToken.commitSeq,
    finiteMetadataWatermark: state.value.reservation?.metadataWatermark ?? null });
});

export interface FiniteAttemptAnchorContext<Session extends FiniteAttemptFrontierRow = SessionRow> {
  readonly session: Readonly<Session>;
  readonly snapshotToken: SnapshotToken;
  readonly reservation: FiniteMetadataReservation | null;
  readonly leaseExpiresAt: Date;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
}

/** Durable resolution verifies stored bytes; healthy entry/frontier callers may
 * compare the exact issued capture instead, while every mutable column is fresh. */
export const readFiniteAttemptAnchorRow = Effect.fn("FiniteAttemptAnchor.readRow")(function* <Session extends FiniteAttemptFrontierRow>(
  row: Session, expected?: CapturedFiniteAttemptAnchor,
) {
  if (row.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    row.executionProfile !== "finiteRoot" || row.finiteAttemptBytes === null || row.finiteAttemptSha256 === null ||
    row.finiteSnapshotEpochUuid === null || row.finiteSnapshotCommitSeq === null || row.finiteLeaseExpiresAt === null ||
    row.finiteClaimOwner === null || row.finiteClaimFence === null || row.finiteClaimedAt === null || row.finiteClaimExpiresAt === null)
    return yield* Effect.fail(failure("storedCorruption"));
  const value = yield* Effect.gen(function* () {
    const original = expected === undefined ? undefined : captured.get(expected);
    if (expected !== undefined) {
      if (original === undefined || !bytesEqualFullScan(original.bytes, row.finiteAttemptBytes!) ||
        !bytesEqualFullScan(original.digest, row.finiteAttemptSha256!)) return yield* Effect.fail(failure("storedCorruption"));
      const pins = projectImmutableFrontierPins(row);
      if (original.immutablePins !== undefined) {
        const previous = original.immutablePins;
        if (Object.keys(previous).some(key => Reflect.get(previous, key) !== Reflect.get(pins, key)))
          return yield* Effect.fail(failure("storedCorruption"));
      }
      return original.value;
    }
    const body = yield* verifyStoredPrivateCanonicalValue({ canonicalBytes: row.finiteAttemptBytes,
      sha256Hex: encodeBytesToLowercaseHex(row.finiteAttemptSha256!), expectedFormat: "flarex.finite-attempt-anchor", expectedVersion: 1,
      maximumCanonicalBytes: MAX_ANCHOR_BYTES, expectedKeys: undefined }, {
      storedCorruption: () => failure("storedCorruption"), hashFailure: cause => failure("resourceFailure", cause),
    });
    return yield* decode(body).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
  });
  return yield* readFiniteAttemptAnchorContext(row, value, expected);
});

const readFiniteAttemptAnchorContext = Effect.fn("FiniteAttemptAnchor.readContext")(function* <Session extends FiniteAttemptFrontierRow>(
  row: Session, value: typeof AnchorSchema.Type, expected?: CapturedFiniteAttemptAnchor,
) {
  if (row.finiteSnapshotEpochUuid === null || row.finiteSnapshotCommitSeq === null || row.finiteLeaseExpiresAt === null ||
    row.finiteClaimOwner === null || row.finiteClaimFence === null || row.finiteClaimedAt === null || row.finiteClaimExpiresAt === null)
    return yield* Effect.fail(failure("storedCorruption"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(value.snapshotToken.scopeId)
    .pipe(Result.mapError(cause => failure("storedCorruption", cause))));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(value.snapshotToken.epoch)
    .pipe(Result.mapError(cause => failure("storedCorruption", cause))));
  const claimOwner = yield* Effect.fromResult(decodeTransactionExecutionClaimOwnerV1(row.finiteClaimOwner)
    .pipe(Result.mapError(cause => failure("storedCorruption", cause))));
  const claimFence = yield* Effect.fromResult(decodeTransactionExecutionClaimFenceV1(row.finiteClaimFence)
    .pipe(Result.mapError(cause => failure("storedCorruption", cause))));
  const reservation = value.reservation;
  if (scope.scopeUuid !== row.scopeUuid || epoch.epochUuid !== row.finiteSnapshotEpochUuid ||
    value.snapshotToken.commitSeq !== row.finiteSnapshotCommitSeq ||
    (reservation === null ? row.finiteMetadataWatermark !== null : reservation.sessionId !== row.sessionId ||
      reservation.attemptFence !== row.attemptFence || reservation.scopeId !== value.snapshotToken.scopeId ||
      reservation.storageGeneration !== row.storageGeneration || reservation.storageGenerationFence !== row.storageGenerationFence ||
      reservation.schemaVersionId !== row.schemaVersionId || reservation.metadataWatermark !== row.finiteMetadataWatermark ||
      reservation.snapshotToken.epoch !== value.snapshotToken.epoch || reservation.snapshotToken.commitSeq !== value.snapshotToken.commitSeq) ||
    !Number.isSafeInteger(row.finiteLeaseExpiresAt.getTime()) || !Number.isSafeInteger(row.finiteClaimedAt.getTime()) ||
    !Number.isSafeInteger(row.finiteClaimExpiresAt.getTime()) || row.finiteClaimExpiresAt <= row.finiteClaimedAt ||
    row.finiteClaimExpiresAt > row.finiteLeaseExpiresAt || row.finiteLeaseExpiresAt > row.hardExpiresAt)
    return yield* Effect.fail(failure("storedCorruption"));
  if (expected !== undefined) {
    const original = captured.get(expected);
    if (original !== undefined && original.immutablePins === undefined) {
      // The entry owner pins its complete expectation before storage admission;
      // stored-row comparison and COMMIT ACK remain separate admission proofs.
      // Live frontier callers never replace these pins during renewal.
      captured.set(expected, { ...original, immutablePins: projectImmutableFrontierPins(row) });
    }
  }
  return Object.freeze({ session: row, snapshotToken: value.snapshotToken, reservation,
    leaseExpiresAt: new Date(row.finiteLeaseExpiresAt), executionClaim: Object.freeze({ claimOwner, claimFence,
      claimedAt: row.finiteClaimedAt.toISOString(), claimExpiresAt: row.finiteClaimExpiresAt.toISOString() }) }) satisfies FiniteAttemptAnchorContext<Session>;
});

/** The publisher calls this only after its actual complete SQL comparison.
 * Mutable columns retain the same anchor/context decoder as stored recovery. */
const decodePublicationMutable = Schema.decodeUnknownEffect(Schema.Struct({
  lifecycle: TransactionSessionLifecycleV1Schema, updatedAt: Schema.Date,
  finiteLeaseExpiresAt: Schema.NullOr(Schema.Date),
  finiteClaimOwner: Schema.NullOr(TransactionExecutionClaimOwnerV1Schema),
  finiteClaimFence: Schema.NullOr(TransactionExecutionClaimFenceV1Schema),
  finiteClaimedAt: Schema.NullOr(Schema.Date), finiteClaimExpiresAt: Schema.NullOr(Schema.Date),
}).annotate({ parseOptions: { onExcessProperty: "error" } }));
export const lendComparedFinitePublicationAnchor = Effect.fn("FiniteAttemptAnchor.lendPublication")(function* (
  entry: OriginalFiniteExecutionEntry, issuer: StoredCommitAuthorityEvidenceLoaderPortsV1, input: unknown,
) {
  const original = readOriginalFiniteExecutionAuthority(entry, issuer);
  if (original === undefined) return yield* Effect.fail(failure("invalidInput"));
  const state = captured.get(original.anchorCapture);
  if (state?.immutablePins === undefined) return yield* Effect.fail(failure("invalidInput"));
  const mutable = yield* decodePublicationMutable(input).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
  return yield* readFiniteAttemptAnchorContext({ ...original.context.session, ...mutable }, state.value);
});

export const lockFiniteAttemptAnchorRowByIdentityInTransaction = Effect.fn("FiniteAttemptAnchor.lockStableRow")(function* (
  tx: AppRowTransaction, selector: Pick<PointMutationSessionAttemptSelectorV1, "scopeId" | "sessionId">,
  protection: "share" | "update" = "update",
) {
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(selector.scopeId)
    .pipe(Result.mapError(cause => failure("invalidInput", cause))));
  const rows = yield* runDrizzleStatementEffect(tx.select().from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, scope.scopeUuid), eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
  )).limit(2).for(protection), cause => failure("resourceFailure", cause));
  if (rows.length === 0) return yield* Effect.fail(failure("attemptMissing"));
  if (rows.length !== 1) return yield* Effect.fail(failure("storedCorruption"));
  return rows[0]!;
});

export const lockFiniteAttemptAnchorByIdentityInTransaction = Effect.fn("FiniteAttemptAnchor.lockStableIdentity")(function* (
  tx: AppRowTransaction, selector: Pick<PointMutationSessionAttemptSelectorV1, "scopeId" | "sessionId">,
  expected?: CapturedFiniteAttemptAnchor, protection: "share" | "update" = "update",
) {
  const row = yield* lockFiniteAttemptAnchorRowByIdentityInTransaction(tx, selector, protection);
  return yield* readFiniteAttemptAnchorRow(row, expected);
});

export const lockFiniteAttemptAnchorInTransaction = Effect.fn("FiniteAttemptAnchor.lockExactAttempt")(function* (
  tx: AppRowTransaction, selector: PointMutationSessionAttemptSelectorV1, claim?: TransactionExecutionClaimPinV1,
  expected?: CapturedFiniteAttemptAnchor, protection: "share" | "update" = "update",
) {
  const context = yield* lockFiniteAttemptAnchorByIdentityInTransaction(tx, selector, expected, protection);
  if (context.session.attemptFence !== selector.attemptFence) return yield* Effect.fail(failure("attemptReplaced"));
  if (claim !== undefined && (context.executionClaim.claimOwner !== claim.claimOwner || context.executionClaim.claimFence !== claim.claimFence))
    return yield* Effect.fail(failure("ownershipChanged"));
  return context;
});

export const requireFiniteAttemptIsLive = (context: FiniteAttemptAnchorContext<FiniteAttemptFrontierRow>, databaseNow: Date) => {
  const time = databaseNow.getTime();
  return !Number.isSafeInteger(time) ? Result.fail(failure("storedCorruption")) :
    context.session.lifecycle !== "running" ? Result.fail(failure("lifecycleChanged")) :
    time >= context.leaseExpiresAt.getTime() || time >= Date.parse(context.executionClaim.claimExpiresAt) ||
      time >= context.session.authorizationGrantExpiresAt.getTime() || time >= context.session.hardExpiresAt.getTime()
      ? Result.fail(failure("expired")) : Result.succeed(undefined);
};

declare const nonacceptanceBrand: unique symbol;
export interface FiniteAttemptNonacceptanceProof { readonly [nonacceptanceBrand]: true }
interface NonacceptanceState {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly fencedClaim: TransactionExecutionClaimPinV1;
  readonly session: Readonly<SessionRow>;
}
const nonacceptance = new WeakMap<FiniteAttemptNonacceptanceProof, NonacceptanceState>();
declare const pendingBrand: unique symbol;
export interface PendingFiniteAttemptNonacceptance { readonly [pendingBrand]: true }
const pendingNonacceptance = new WeakMap<PendingFiniteAttemptNonacceptance, NonacceptanceState>();

/** The terminal owner calls this only after the outcome-first lock wait has
 * established absence. The write excludes every earlier final publisher. */
export const fenceFiniteAttemptNonacceptanceInTransaction = Effect.fn("FiniteAttemptAnchor.fenceNonacceptance")(function* (
  tx: AppRowTransaction, selector: PointMutationSessionAttemptSelectorV1, context: FiniteAttemptAnchorContext,
) {
  if (context.session.lifecycle !== "running" || context.session.attemptFence !== selector.attemptFence)
    return yield* Effect.fail(failure("lifecycleChanged"));
  const fence = yield* Effect.fromResult(decodeTransactionExecutionClaimFenceV1(context.executionClaim.claimFence + 1n)
    .pipe(Result.mapError(() => failure("invalidInput"))));
  const rows = yield* runDrizzleStatementEffect(tx.update(fxSystemTransactionSessions).set({ lifecycle: "retrying", finiteClaimFence: fence })
    .where(and(eq(fxSystemTransactionSessions.scopeUuid, context.session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, selector.attemptFence), eq(fxSystemTransactionSessions.lifecycle, "running"),
      eq(fxSystemTransactionSessions.finiteClaimOwner, context.executionClaim.claimOwner),
      eq(fxSystemTransactionSessions.finiteClaimFence, context.executionClaim.claimFence))).returning(), cause => failure("resourceFailure", cause));
  if (rows.length !== 1) return yield* Effect.fail(failure("ownershipChanged"));
  // SAFETY: the pending capability is issued only from an exact locked CAS.
  const candidate = Object.freeze({}) as PendingFiniteAttemptNonacceptance;
  pendingNonacceptance.set(candidate, { selector, executionClaim: context.executionClaim,
    fencedClaim: { claimOwner: context.executionClaim.claimOwner, claimFence: fence }, session: rows[0]! });
  return candidate;
});

/** The trusted transaction decision owner invokes confirmation only after its
 * driver reports successful COMMIT, never from cleanup or a missing lookup. */
export const confirmFiniteAttemptNonacceptance = (candidate: PendingFiniteAttemptNonacceptance) => Result.gen(function* () {
  const state = pendingNonacceptance.get(candidate);
  if (state === undefined) return yield* Result.fail(failure("invalidInput"));
  pendingNonacceptance.delete(candidate);
  // SAFETY: this proof retains the issuer-authenticated post-COMMIT fenced row.
  const proof = Object.freeze({}) as FiniteAttemptNonacceptanceProof;
  nonacceptance.set(proof, state);
  return proof;
});

export const observeFencedFiniteAttemptNonacceptance = (selector: PointMutationSessionAttemptSelectorV1,
  executionClaim: TransactionExecutionClaimPinV1, context: FiniteAttemptAnchorContext) => Result.gen(function* () {
  if (context.session.lifecycle !== "retrying" || context.session.attemptFence !== selector.attemptFence ||
    context.executionClaim.claimOwner !== executionClaim.claimOwner || context.executionClaim.claimFence !== executionClaim.claimFence + 1n)
    return yield* Result.fail(failure("ownershipChanged"));
  // SAFETY: terminal resolution has locked and authenticated the persisted fence.
  const candidate = Object.freeze({}) as PendingFiniteAttemptNonacceptance;
  pendingNonacceptance.set(candidate, { selector, executionClaim, fencedClaim: context.executionClaim, session: context.session });
  return candidate;
});

export const readFiniteAttemptNonacceptanceProof = (proof: FiniteAttemptNonacceptanceProof) => {
  const state = nonacceptance.get(proof);
  return state === undefined ? Result.fail(failure("invalidInput")) : Result.succeed(state);
};

export const rejectFiniteAttemptNonacceptanceInTransaction = Effect.fn("FiniteAttemptAnchor.rejectNonacceptance")(function* (
  tx: AppRowTransaction, context: FiniteAttemptAnchorContext, lifecycle: "aborted" | "expired",
) {
  const fence = yield* Effect.fromResult(decodeTransactionExecutionClaimFenceV1(context.executionClaim.claimFence + 1n)
    .pipe(Result.mapError(() => failure("invalidInput"))));
  const rows = yield* runDrizzleStatementEffect(tx.update(fxSystemTransactionSessions).set({ lifecycle, finiteClaimFence: fence,
    validatedArgsJson: null, validatedArgsCanonicalBytes: null, authorizationGrantJson: null, authorizationGrantCanonicalBytes: null,
    applicationExecutionAuthorityJson: null, applicationExecutionAuthorityCanonicalBytes: null })
    .where(and(eq(fxSystemTransactionSessions.scopeUuid, context.session.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, context.session.sessionId), eq(fxSystemTransactionSessions.attemptFence, context.session.attemptFence),
      eq(fxSystemTransactionSessions.lifecycle, context.session.lifecycle), eq(fxSystemTransactionSessions.finiteClaimOwner, context.executionClaim.claimOwner),
      eq(fxSystemTransactionSessions.finiteClaimFence, context.executionClaim.claimFence))).returning({ sessionId: fxSystemTransactionSessions.sessionId }),
    cause => failure("resourceFailure", cause));
  if (rows.length !== 1) return yield* Effect.fail(failure("ownershipChanged"));
});

/** The activation owner holds authority and sequencer locks and rechecks the
 * exact stable outcome before replacing this same anchor. No journal is born. */
export const MAX_FINITE_ATTEMPT_COUNT = 5n;

export const replaceFiniteAttemptAnchorInTransaction = Effect.fn("FiniteAttemptAnchor.replace")(function* (
  tx: AppRowTransaction, proof: FiniteAttemptNonacceptanceProof,
  input: Readonly<{ snapshotToken: SnapshotToken; claimOwner: TransactionExecutionClaimOwnerV1;
    claimedAt: Date; claimExpiresAt: Date; leaseExpiresAt: Date }>,
) {
  const old = yield* Effect.fromResult(readFiniteAttemptNonacceptanceProof(proof));
  const current = yield* lockFiniteAttemptAnchorInTransaction(tx, old.selector, old.fencedClaim);
  if (current.session.lifecycle !== "retrying" || current.session.attemptFence >= MAX_TRANSACTION_ATTEMPT_FENCE ||
    current.session.attemptFence >= MAX_FINITE_ATTEMPT_COUNT)
    return yield* Effect.fail(failure("lifecycleChanged"));
  if (input.snapshotToken.scopeId !== old.selector.scopeId ||
    ![input.claimedAt, input.claimExpiresAt, input.leaseExpiresAt].every(date => Number.isSafeInteger(date.getTime())) ||
    input.claimExpiresAt <= input.claimedAt || input.claimExpiresAt > input.leaseExpiresAt ||
    input.leaseExpiresAt > current.session.hardExpiresAt || input.claimedAt >= current.session.authorizationGrantExpiresAt ||
    input.claimedAt >= current.session.hardExpiresAt) return yield* Effect.fail(failure("invalidInput"));
  const owner = yield* Effect.fromResult(decodeTransactionExecutionClaimOwnerV1(input.claimOwner)
    .pipe(Result.mapError(() => failure("invalidInput"))));
  const fence = yield* Effect.fromResult(decodeTransactionExecutionClaimFenceV1(old.fencedClaim.claimFence + 1n)
    .pipe(Result.mapError(() => failure("invalidInput"))));
  const anchor = yield* captureFiniteAttemptAnchor({ snapshotToken: input.snapshotToken });
  const values = yield* Effect.fromResult(projectCapturedFiniteAttemptAnchor(anchor));
  const rows = yield* runDrizzleStatementEffect(tx.update(fxSystemTransactionSessions).set({ ...values,
    attemptFence: TransactionAttemptFenceSchema.make(current.session.attemptFence + 1n), lifecycle: "running",
    updatedAt: input.claimedAt, finiteClaimOwner: owner, finiteClaimFence: fence, finiteClaimedAt: input.claimedAt,
    finiteClaimExpiresAt: input.claimExpiresAt, finiteLeaseExpiresAt: input.leaseExpiresAt }).where(and(
      eq(fxSystemTransactionSessions.scopeUuid, current.session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, old.selector.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, old.selector.attemptFence), eq(fxSystemTransactionSessions.lifecycle, "retrying"),
      eq(fxSystemTransactionSessions.finiteClaimOwner, old.fencedClaim.claimOwner), eq(fxSystemTransactionSessions.finiteClaimFence, old.fencedClaim.claimFence),
    )).returning(), cause => failure("resourceFailure", cause));
  if (rows.length !== 1) return yield* Effect.fail(failure("ownershipChanged"));
  return Object.freeze({ anchor, context: yield* readFiniteAttemptAnchorRow(rows[0]!, anchor) });
});

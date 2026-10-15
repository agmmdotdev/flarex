import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import { eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { expect, it } from "vitest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  SnapshotTokenSchema,
} from "flarex-protocol/storage-authority";
import {
  TransactionSessionIdV1Schema,
  TransactionPackageIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  TransactionExecutionClaimOwnerV1Schema,
  TransactionExecutionClaimFenceV1Schema,
} from "../../../src/execution/claims/transactionExecutionClaimModel";
import {
  captureFiniteAttemptAnchor,
  projectCapturedFiniteAttemptAnchor,
  projectExpectedFiniteAttemptAnchor,
  prepareFiniteAttemptStorageCaptureBasis,
  readFiniteAttemptAnchorRow,
  type CapturedFiniteAttemptAnchor,
} from "../../../src/execution/finiteAttemptAnchor";
import { createPGlitePersistence } from "../../../src/database/pglite";
import {
  captureFiniteMetadataReservation,
  FiniteMetadataReservationSchema,
  readCapturedFiniteMetadataReservation,
} from "../../../src/execution/finiteMetadataReservation";
import { fxSystemTransactionSessions } from "../../../src/database/schema";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import {
  insertSessionTestScope,
  insertTransactionSessionFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
  SESSION_TEST_SCOPE_UUID,
  SESSION_TEST_EPOCH_UUID,
} from "./support/sessionStorage";

it("projects exact expected pins only from a successfully validated persisted entry, with isolated byte buffers", async () => {
  const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
  const persistence = await createPGlitePersistence({ db });
  try {
    await insertSessionTestScope(persistence);
    const sessionId = TransactionSessionIdV1Schema.make(transactionSessionIdAt(130));
    const session = transactionSessionFixture(sessionId);
    await insertTransactionSessionFixture(persistence, session);
    const snapshotToken = SnapshotTokenSchema.make({
      scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
      epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`), commitSeq: CommitSeqSchema.make(0n),
    });
    const reservation = await Effect.runPromise(captureFiniteMetadataReservation(
      Schema.decodeUnknownSync(FiniteMetadataReservationSchema)({
        format: "flarex.finite-metadata-reservation", version: 1,
        deploymentId: "expected-projection", scopeId: snapshotToken.scopeId, sessionId,
        attemptFence: session.attemptFence.toString(), storageGeneration: "flarexdb_v1",
        storageGenerationFence: session.storageGenerationFence.toString(),
        snapshotToken: { ...snapshotToken, commitSeq: "0" }, schemaVersionId: session.schemaVersionId,
        metadataWatermark: "11", application: { revisionId: "expected-revision", activationSequence: "1",
          headSha256: "a".repeat(64), activationSha256: "b".repeat(64),
          schemaVersionId: session.schemaVersionId, manifestSha256: "c".repeat(64) },
        binding: { sequence: "1", sha256: "d".repeat(64), candidateSha256: "e".repeat(64), activationSha256: "f".repeat(64) },
      })));
    const anchor = await Effect.runPromise(captureFiniteAttemptAnchor({ snapshotToken, reservation }));
    Reflect.set(snapshotToken, "commitSeq", CommitSeqSchema.make(9n));
    expect(Result.isFailure(projectExpectedFiniteAttemptAnchor(anchor))).toBe(true);
    expect(Result.isFailure(prepareFiniteAttemptStorageCaptureBasis(anchor))).toBe(true);
    // SAFETY: this negative witness deliberately forges an opaque handle; the
    // private issuer registry must reject it without any database access.
    expect(Result.isFailure(projectExpectedFiniteAttemptAnchor(Object.freeze({}) as CapturedFiniteAttemptAnchor))).toBe(true);
    const columns = Result.getOrThrow(projectCapturedFiniteAttemptAnchor(anchor));
    // This is the real persisted frontier and the real transaction ACK. The
    // projection itself authenticates pins; COMMIT confirmation stays with entry.
    const row = await persistence.drizzle.transaction(async tx => {
      const [stored] = await tx.update(fxSystemTransactionSessions).set({ ...columns, lifecycle: "running",
        finiteLeaseExpiresAt: new Date("2030-01-01T23:59:00Z"),
        finiteClaimOwner: TransactionExecutionClaimOwnerV1Schema.make("61000000-0000-4000-8000-000000000130"),
        finiteClaimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
        finiteClaimedAt: new Date("2030-01-01T00:00:00Z"), finiteClaimExpiresAt: new Date("2030-01-01T00:05:00Z"),
      }).where(eq(fxSystemTransactionSessions.sessionId, sessionId)).returning();
      if (stored === undefined) throw new Error("Persisted finite entry missing");
      await Effect.runPromise(readFiniteAttemptAnchorRow(stored, anchor));
      return stored;
    });
    const projected = Result.getOrThrow(projectExpectedFiniteAttemptAnchor(anchor));
    const captureBasis = Result.getOrThrow(prepareFiniteAttemptStorageCaptureBasis(anchor));
    expect(projected.snapshotToken).not.toBe(snapshotToken);
    expect(Object.isFrozen(projected.snapshotToken)).toBe(true);
    expect(Reflect.set(projected.snapshotToken, "commitSeq", CommitSeqSchema.make(7n))).toBe(false);
    expect(captureBasis.expected.snapshotToken.commitSeq).toBe(0n);
    expect(Result.getOrThrow(projectCapturedFiniteAttemptAnchor(anchor)).finiteSnapshotCommitSeq).toBe(0n);
    expect(projected.reservation).toBe(readCapturedFiniteMetadataReservation(reservation));
    expect(projected.reservation).toBe(captureBasis.expected.reservation);
    expect(Reflect.set(projected.reservation!.application, "revisionId", "mutated")).toBe(false);
    expect(Reflect.set(projected.reservation!.snapshotToken, "commitSeq", CommitSeqSchema.make(7n))).toBe(false);
    expect(Reflect.set(projected.reservation!.binding!, "sequence", "7")).toBe(false);
    expect(captureBasis.expected.reservation?.application.revisionId).toBe("expected-revision");
    expect(Result.getOrThrow(prepareFiniteAttemptStorageCaptureBasis(anchor))).toBe(captureBasis);
    expect(Result.isFailure(prepareFiniteAttemptStorageCaptureBasis(new Proxy(anchor, {})))).toBe(true);
    expect(projected.pins).toMatchObject({ packageId: row.packageId, artifactRuntime: row.artifactRuntime,
      artifactId: row.artifactId, sourcePackageHash: row.sourcePackageHash,
      validatedArgsValueCodecVersion: row.validatedArgsValueCodecVersion,
      authorizationGrantValueCodecVersion: row.authorizationGrantValueCodecVersion,
      attemptFence: row.attemptFence, createdAt: row.createdAt.getTime(),
      hardExpiresAt: row.hardExpiresAt.getTime(), authorizationGrantExpiresAt: row.authorizationGrantExpiresAt.getTime() });
    expect(Object.keys(projected.pins)).toHaveLength(30);
    const originalBytes = projected.bytes.slice(), originalDigest = projected.digest.slice();
    projected.bytes.fill(0); projected.digest.fill(0);
    const fresh = Result.getOrThrow(projectExpectedFiniteAttemptAnchor(anchor));
    expect(fresh.bytes).toEqual(originalBytes); expect(fresh.digest).toEqual(originalDigest);
    expect(captureBasis.expected.bytes).toEqual(originalBytes);
    expect(captureBasis.expected.digest).toEqual(originalDigest);
    expect(captureBasis.expected.bytes).not.toBe(fresh.bytes);
    const mutated = await Effect.runPromise(Effect.result(readFiniteAttemptAnchorRow({ ...row, packageId: TransactionPackageIdV1Schema.make("different_package") }, anchor)));
    expect(Result.isFailure(mutated)).toBe(true);
    if (Result.isFailure(mutated)) expect(mutated.failure.reason).toBe("storedCorruption");
  } finally { await db.close(); }
});

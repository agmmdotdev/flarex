import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, SnapshotTokenSchema } from "flarex-protocol/storage-authority";
import { TransactionSessionIdV1Schema, TransactionPackageIdV1Schema } from "flarex-protocol/transaction-session";
import { TransactionExecutionClaimOwnerV1Schema, TransactionExecutionClaimFenceV1Schema } from "../src/transactionExecutionClaimModel";
import { captureFiniteAttemptAnchor, projectCapturedFiniteAttemptAnchor, projectExpectedFiniteAttemptAnchor,
  readFiniteAttemptAnchorRow, type CapturedFiniteAttemptAnchor } from "../src/finiteAttemptAnchor";
import { createPGlitePersistence } from "../src/pglite";
import { fxSystemTransactionSessions } from "../src/schema";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { insertSessionTestScope, insertTransactionSessionFixture, transactionSessionFixture, transactionSessionIdAt,
  SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID } from "./sessionAuthorityTestSupport";

it("projects exact expected pins only from a successfully validated persisted entry, with isolated byte buffers", async () => {
  const db = newTestPGlite();
  const persistence = await createPGlitePersistence({ db });
  try {
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const sessionId = TransactionSessionIdV1Schema.make(transactionSessionIdAt(130));
    await insertTransactionSessionFixture(persistence, transactionSessionFixture(sessionId));
    const anchor = await Effect.runPromise(captureFiniteAttemptAnchor({ snapshotToken: SnapshotTokenSchema.make({
      scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
      epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`), commitSeq: CommitSeqSchema.make(0n),
    }) }));
    expect(Result.isFailure(projectExpectedFiniteAttemptAnchor(anchor))).toBe(true);
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
    const mutated = await Effect.runPromise(Effect.result(readFiniteAttemptAnchorRow({ ...row, packageId: TransactionPackageIdV1Schema.make("different_package") }, anchor)));
    expect(Result.isFailure(mutated)).toBe(true);
    if (Result.isFailure(mutated)) expect(mutated.failure.reason).toBe("storedCorruption");
  } finally { await db.close(); }
});

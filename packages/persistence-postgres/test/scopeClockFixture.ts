import { eq } from "drizzle-orm";
import { Result } from "effect";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../src/schema";

/** Current-schema fixtures construct the same atomic owner pair as provisioning. */
type CurrentScopeClockFixtureInput = Readonly<{
  scopeId: string; epoch: string; lastCommitSeq?: bigint; oldestAvailableCommitSeq?: bigint;
}>;
export const insertCurrentScopeClockFixtureInTransaction = async (tx: FlarexMetadataTransaction, input: CurrentScopeClockFixtureInput) => {
  const scopeId = ScopeIdSchema.make(input.scopeId);
  Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, { scopeId, initialEpoch: ScopeEpochSchema.make(input.epoch) }));
  await tx.update(fxSystemScopeExecutionAuthorities).set({ storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    oldestAvailableCommitSeq: CommitSeqSchema.make(input.oldestAvailableCommitSeq ?? 0n) }).where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
  if (input.lastCommitSeq !== undefined) await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(input.lastCommitSeq) })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
};
export const insertCurrentScopeClockFixture = (db: FlarexMetadataDatabase, input: CurrentScopeClockFixtureInput) =>
  db.transaction(tx => insertCurrentScopeClockFixtureInTransaction(tx, input));

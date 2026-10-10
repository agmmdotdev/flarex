import { type ReplacementScopeIdV1, CommitSeqSchema, FlarexDbV1StorageGenerationSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { TransactionAuthorizationRevocationEpochSchema } from "flarex-protocol/transaction-session";
import { eq } from "drizzle-orm";
import { type FlarexMetadataDatabase } from "../../../../src/application/deployments";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../../../../src/database/schema";
import { type FlarexSqlClient } from "../../../../src";

export async function setFlarexActivationClock(
  persistence: Pick<FlarexSqlClient, "query"> & { readonly drizzle: FlarexMetadataDatabase },
  scopeId: ReplacementScopeIdV1,
  input: {
    readonly storageGenerationFence?: bigint;
    readonly lastCommitSeq?: bigint;
    readonly authorizationRevocationEpoch?: bigint;
  } = {},
): Promise<void> {
  await persistence.drizzle.transaction(async tx => {
    await tx.update(fxSystemScopeExecutionAuthorities).set({ storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(input.storageGenerationFence ?? 1n),
      authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(input.authorizationRevocationEpoch ?? 0n) })
      .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(input.lastCommitSeq ?? 0n), updatedAt: new Date() })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  });
}

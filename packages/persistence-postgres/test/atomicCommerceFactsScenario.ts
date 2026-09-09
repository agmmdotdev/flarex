import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { readRelationalCommitFactsInTransaction } from "../src/commitPublication/relationalFacts";
import { fxSystemCommitRelationalChanges } from "../src/commitPublication/relationalFactsSchema";
import { runEffectFailure } from "./effectTestRuntime";

/** Test-owned corruption in the persistence package's Drizzle type/runtime. */
export async function assertAtomicProjectionRejectsOtherParticipantCorruption(
  db: FlarexMetadataDatabase, query: Parameters<typeof readRelationalCommitFactsInTransaction>[1], installationSha256: string,
) {
  const rollback = new Error("Rollback test corruption");
  await db.transaction(async tx => {
    const changed = await tx.update(fxSystemCommitRelationalChanges).set({ keyBytes: new TextEncoder().encode('{"invalid":true}') }).where(and(
      eq(fxSystemCommitRelationalChanges.scopeUuid, query.scopeUuid), eq(fxSystemCommitRelationalChanges.commitSeq, query.commitSeq),
      eq(fxSystemCommitRelationalChanges.installationSha256, installationSha256))).returning();
    expect(changed.length).toBeGreaterThan(0);
    expect(await runEffectFailure(readRelationalCommitFactsInTransaction(tx, query))).toMatchObject({ reason: "storedCorruption" });
    throw rollback;
  }).catch(cause => { if (cause !== rollback) throw cause; });
}

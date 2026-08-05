import { eq } from "drizzle-orm";
import { Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import { decodeScopeClockRecordResult } from "./scopeClock";
import { fxSystemScopeClocks } from "./schema";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "./scopePhysicalLocator";
import type { LocatedReadCommittedAttemptTargetV1 } from
  "./transactionSessionAttemptKernel";

export type TaskSystemScopeAuthorityMismatchV1 =
  | "physical_locator"
  | "deployment_binding"
  | "epoch"
  | "storage_generation";

export function captureTaskSystemTrustedScopeAuthorityV1(
  authority: TrustedScopeAuthority,
): TrustedScopeAuthority {
  return Object.freeze({
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    physicalLocator: captureScopePhysicalLocator(authority.physicalLocator),
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
    lastCommitSeq: authority.lastCommitSeq,
    lastOutboxSeq: authority.lastOutboxSeq,
  });
}

export async function requireLockedTaskSystemScopeAuthorityV1(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  onMismatch: (mismatch: TaskSystemScopeAuthorityMismatchV1) => unknown,
): Promise<void> {
  if (!scopePhysicalLocatorsEqual(
    authority.physicalLocator,
    target.physicalLocator,
  )) {
    throw onMismatch("physical_locator");
  }
  const rows = await tx.select().from(fxSystemScopeClocks).where(
    eq(fxSystemScopeClocks.scopeId, authority.scopeId),
  ).limit(1).for("share");
  const row = rows[0];
  if (row === undefined) throw onMismatch("deployment_binding");
  const clock = Result.getOrThrowWith(
    decodeScopeClockRecordResult(row),
    () => onMismatch("deployment_binding"),
  );
  if (clock.scopeId !== authority.scopeId) {
    throw onMismatch("deployment_binding");
  }
  if (clock.epoch !== authority.epoch) throw onMismatch("epoch");
  if (
    clock.storageGeneration !== authority.storageGeneration
    || clock.storageGenerationFence !== authority.storageGenerationFence
  ) {
    throw onMismatch("storage_generation");
  }
}

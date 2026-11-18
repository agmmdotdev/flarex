import { fxSystemScopeExecutionAuthorities } from "../database/schema";
import { selectScopeClockRows } from "../scope/scopeClock";
import { eq } from "drizzle-orm";
import { Result } from "effect";

import type { AppRowTransaction } from "../storage/documents/appRows";
import { decodeScopeClockRecordResult } from "../scope/scopeClock";
import { fxSystemScopeClocks } from "../database/schema";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "../scope/scopePhysicalLocator";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../database/locatedTransactionIdentity";

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
  await tx.select({ scopeId: fxSystemScopeExecutionAuthorities.scopeId }).from(fxSystemScopeExecutionAuthorities)
    .where(eq(fxSystemScopeExecutionAuthorities.scopeId, authority.scopeId)).limit(1).for("share");
  const rows = await selectScopeClockRows(tx).where(
    eq(fxSystemScopeClocks.scopeId, authority.scopeId),
  ).limit(1).for("share", { of: fxSystemScopeClocks });
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

import type { TaskRuntimePublicationReceipt } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { bytesEqualFullScan } from "@flarex/utils/bytes";

import {
  fxSystemApplicationTaskRuntimeObjectsV1,
  fxSystemApplicationTaskRuntimePublicationsV1,
} from "./schema";

export function storedApplicationTaskRuntimePublicationMatches(
  row: typeof fxSystemApplicationTaskRuntimePublicationsV1.$inferSelect,
  rows: ReadonlyArray<
    typeof fxSystemApplicationTaskRuntimeObjectsV1.$inferSelect
  >,
  receipt: TaskRuntimePublicationReceipt,
): boolean {
  if (
    row.scopeId !== receipt.scopeId ||
    row.revisionId !== receipt.applicationRevisionId ||
    row.candidateId !== receipt.candidateId ||
    row.analysisId !== receipt.analysisId ||
    row.objectCount !== receipt.runtimeObjects.length ||
    !digestFieldsMatch(row, receipt) ||
    rows.length !== receipt.runtimeObjects.length
  ) return false;
  const byIdentity = new Map(rows.map(item => [
    `${item.role}\u0000${item.ordinal.toString(10)}`,
    item,
  ]));
  return receipt.runtimeObjects.every(expected => {
    const stored = byIdentity.get(
      `${expected.reference.role}\u0000${expected.ordinal.toString(10)}`,
    );
    return stored !== undefined &&
      bytesEqualFullScan(stored.receiptSha256, row.receiptSha256) &&
      stored.storeIdentity === expected.reference.storeIdentity &&
      stored.codecIdentity === expected.codecIdentity &&
      stored.objectKey === expected.reference.objectKey &&
      stored.byteLength === expected.reference.byteLength &&
      bytesEqualFullScan(stored.sha256, expected.reference.sha256);
  });
}

function digestFieldsMatch(
  row: typeof fxSystemApplicationTaskRuntimePublicationsV1.$inferSelect,
  receipt: TaskRuntimePublicationReceipt,
): boolean {
  const pairs: ReadonlyArray<readonly [Uint8Array | null, Uint8Array | null]> = [
    [row.taskCatalogSha256, receipt.taskCatalogSha256],
    [row.applicationTaskCatalogBindingSha256,
      receipt.applicationTaskCatalogBindingSha256],
    [row.applicationPublicationSha256,
      receipt.applicationPublicationSha256],
    [row.sourceArtifactRootSha256, receipt.sourceArtifactRootSha256],
    [row.applicationRevisionTaskBindingSha256,
      receipt.applicationRevisionTaskBindingSha256],
    [row.taskEntryRootSha256, receipt.taskEntryRootSha256],
    [row.taskRuntimeProjectionSha256, receipt.taskRuntimeProjectionSha256],
    [row.taskRuntimeGroupManifestSha256,
      receipt.taskRuntimeGroupManifestSha256],
    [row.taskRuntimeMaterializationSpecSha256,
      receipt.taskRuntimeMaterializationSpecSha256],
  ];
  return pairs.every(([left, right]) => left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right));
}

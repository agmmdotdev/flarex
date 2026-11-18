import {
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
} from "../../../../src/installation/installationLifecycle";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  openApplicationQuerySnapshot as openApplicationQuerySnapshotEffect,
} from "../../../../src/application/applicationQuerySnapshot";
import { ScopeExecutionLive } from "../../../../src/scope/execution/ScopeExecution";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../../../../src/storage/documents/appRows";
import {
  createAppDeveloperIndexDefinitionPortV1,
} from "../../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { runEffect } from "../../../support/effectTestRuntime";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../../src/scope/scopeClock";
import { fxSystemScopeClocks } from "../../../../src/database/schema";
import { readinessFixture } from "../../support/readinessFixture";

export const openApplicationQuerySnapshot = (
  ...args: Parameters<typeof openApplicationQuerySnapshotEffect>
) => openApplicationQuerySnapshotEffect(...args).pipe(
  Effect.provide(ScopeExecutionLive),
);

export function queryBudget() {
  return Object.freeze({
    maximumPointReads: 16,
    maximumIndexReads: 16,
    maximumDocuments: 64,
    maximumSemanticBytes: 1_048_576,
  });
}

export function queryDeveloperIndexes(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
) {
  return createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle);
}

export async function insertApplicationQueryRow(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
) {
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { name: "Ada" },
  });
  const clock = await fixture.target.getScopeClock(fixture.authority.scopeId);
  if (clock === null) throw new Error("Application query clock missing.");
  const commitSeq = CommitSeqSchema.make(1n);
  await fixture.target.drizzle.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId));
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: fixture.authority.scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId,
        creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      });
      await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
        eq(fxSystemScopeClocks.scopeId, fixture.authority.scopeId),
      );
    } finally {
      closeInstallationAdmission(tx);
    }
  });
  return document;
}

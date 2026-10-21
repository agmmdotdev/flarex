import { Effect } from "effect";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { cmsError, cmsLimits } from "../cmsTransaction/model";
import { fxSystemCommitPayloadPreferenceDeletions } from "./factsSchema";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";
import type { PayloadPreferenceDeletionEvidence } from "./cleanup";

export type PayloadPreferenceDeletionFact = Omit<typeof fxSystemCommitPayloadPreferenceDeletions.$inferInsert, "commitSeq" | "changeOrdinal">;

export const preparePayloadPreferenceDeletionFacts = Effect.fn("PayloadPreferences.prepareDeletionFacts")(function* (
  input: Pick<PayloadPreferenceDeletionFact, "scopeUuid" | "epochUuid" | "storageGeneration" | "artifactSha256"> &
    Readonly<{ changes: LogicalDocumentChanges["changes"]; evidence: readonly PayloadPreferenceDeletionEvidence[] }>,
) {
  const facts: PayloadPreferenceDeletionFact[] = [];
  for (const cleanup of input.evidence) {
    if (cleanup.preferenceIds.length === 0) continue;
    const deleted = input.changes.find(change => change.documentId === cleanup.documentId && change.kind === "deleted");
    // Retained facts require an actual tombstone at this commit, including when
    // a create-then-delete operation has no final row.
    if (deleted === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
    for (const preferenceId of cleanup.preferenceIds) facts.push({ scopeUuid: input.scopeUuid, epochUuid: input.epochUuid,
      storageGeneration: input.storageGeneration, artifactSha256: input.artifactSha256, codecVersion: 1,
      preferenceId, contentTableId: deleted.tableId, contentRowId: appRowIdHexV1ToBytes(deleted.rowId) });
  }
  return Object.freeze(facts);
});

export const writePayloadPreferenceDeletionFacts = Effect.fn("PayloadPreferences.writeDeletionFacts")(function* (
  tx: FlarexMetadataTransaction, commitSeq: CommitSeq, facts: readonly PayloadPreferenceDeletionFact[],
) {
  if (facts.length === 0) return;
  if (facts.length > cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
  const written = yield* runDrizzleStatementEffect(tx.insert(fxSystemCommitPayloadPreferenceDeletions)
    .values(facts.map((fact, changeOrdinal) => ({ ...fact, changeOrdinal, commitSeq })))
    .returning({ ordinal: fxSystemCommitPayloadPreferenceDeletions.changeOrdinal }), cause => cmsError("statementFailure", cause));
  if (written.length !== facts.length || new Set(written.map(row => row.ordinal)).size !== written.length ||
    written.some(row => row.ordinal < 0 || row.ordinal >= facts.length)) return yield* Effect.fail(cmsError("storedCorruption"));
});

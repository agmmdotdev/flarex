import { Data, Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { isJsonObject } from "flarex-protocol/json";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import type { CatalogIndexId, CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type { PreparedPointCommitRowIntentV1 } from "../applicationDocumentMaterialization/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { fxAppSearchEntryCurrent, fxSystemSearchBuildStates } from "../schema";

export interface LogicalSearchDefinition {
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly sourceSha256: string;
  readonly columns: readonly string[];
}

export class LogicalSearchMaintenanceError extends Data.TaggedError("LogicalSearchMaintenanceError")<{
  readonly reason: "invalidAuthority" | "storedCorruption" | "limitExceeded" | "statementFailure";
  readonly cause?: unknown;
}> {}

const failure = (reason: LogicalSearchMaintenanceError["reason"], cause?: unknown) =>
  new LogicalSearchMaintenanceError({ reason, ...(cause === undefined ? {} : { cause }) });
const foldAscii = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const searchWriteBudget = Object.freeze({ entries: 4096, textBytes: 4_194_304 });

/** Maintain only current search access, after the authoritative row revision
 * and pointer have been written by the same transaction. The caller owns
 * source admission, settlement and rollback. */
export const maintainLogicalSearchEntries = Effect.fn("LogicalSearchEntries.maintain")(function* (
  tx: FlarexMetadataTransaction, scopeUuid: ScopeUuidV1, commitSeq: CommitSeq,
  definitions: readonly LogicalSearchDefinition[], changes: readonly PreparedPointCommitRowIntentV1[],
) {
  let entryCount = 0;
  let textBytes = 0;
  for (const definition of definitions) {
    const selected = changes.filter(change => change.tableId === definition.tableId);
    if (selected.length === 0) continue;
    const ids = selected.map(change => appRowIdHexV1ToBytes(change.rowId));
    const entries: Array<typeof fxAppSearchEntryCurrent.$inferInsert> = [];
    for (const change of selected) {
      if (change.kind === "deleted") continue;
      const document = change.document.valueJson;
      if (!isJsonObject(document)) return yield* Effect.fail(failure("storedCorruption"));
      for (const fieldId of definition.columns) {
        const value = document[fieldId];
        if (value === null) continue;
        if (typeof value !== "string") return yield* Effect.fail(failure("storedCorruption"));
        const foldedText = foldAscii(value);
        entryCount++;
        textBytes += new TextEncoder().encode(foldedText).byteLength;
        if (entryCount > searchWriteBudget.entries || textBytes > searchWriteBudget.textBytes)
          return yield* Effect.fail(failure("limitExceeded"));
        entries.push({ scopeUuid, tableId: definition.tableId, logicalIndexId: definition.logicalIndexId,
          sourceSha256: definition.sourceSha256, fieldId, rowId: appRowIdHexV1ToBytes(change.rowId),
          commitSeq, foldedText });
      }
    }
    yield* runDrizzleStatementEffect(tx.delete(fxAppSearchEntryCurrent).where(and(
      eq(fxAppSearchEntryCurrent.scopeUuid, scopeUuid),
      eq(fxAppSearchEntryCurrent.tableId, definition.tableId),
      eq(fxAppSearchEntryCurrent.logicalIndexId, definition.logicalIndexId),
      inArray(fxAppSearchEntryCurrent.rowId, ids),
    )), cause => failure("statementFailure", cause));
    if (entries.length > 0) yield* runDrizzleStatementEffect(
      tx.insert(fxAppSearchEntryCurrent).values(entries), cause => failure("statementFailure", cause));
    const build = yield* runDrizzleStatementEffect(tx.select().from(fxSystemSearchBuildStates).where(and(
      eq(fxSystemSearchBuildStates.scopeUuid, scopeUuid),
      eq(fxSystemSearchBuildStates.tableId, definition.tableId),
      eq(fxSystemSearchBuildStates.logicalIndexId, definition.logicalIndexId),
    )).limit(1), cause => failure("statementFailure", cause));
    const state = build[0];
    if (state !== undefined) {
      if (state.lifecycle !== "ready" || state.sourceSha256 !== definition.sourceSha256 ||
        state.coveredThroughCommitSeq > commitSeq)
        return yield* Effect.fail(failure("invalidAuthority"));
      if (state.coveredThroughCommitSeq === commitSeq) continue;
      const advanced = yield* runDrizzleStatementEffect(tx.update(fxSystemSearchBuildStates)
        .set({ coveredThroughCommitSeq: commitSeq }).where(and(
          eq(fxSystemSearchBuildStates.scopeUuid, scopeUuid),
          eq(fxSystemSearchBuildStates.tableId, definition.tableId),
          eq(fxSystemSearchBuildStates.logicalIndexId, definition.logicalIndexId),
          eq(fxSystemSearchBuildStates.sourceSha256, definition.sourceSha256),
          eq(fxSystemSearchBuildStates.lifecycle, "ready"),
          eq(fxSystemSearchBuildStates.coveredThroughCommitSeq, state.coveredThroughCommitSeq),
        )).returning({ scopeUuid: fxSystemSearchBuildStates.scopeUuid }), cause => failure("statementFailure", cause));
      if (advanced.length !== 1) return yield* Effect.fail(failure("invalidAuthority"));
    }
  }
});

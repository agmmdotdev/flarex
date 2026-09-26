import { Effect } from "effect";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { appRowIdHexV1FromBytesResult, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1Result, type CommitSeq, type ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { fxAppSearchEntryCurrent } from "../schema";
import type { LogicalDocumentFailure } from "./model";
import type { LogicalSearchDefinition } from "./searchEntries";
import type { Json } from "flarex-protocol/json";

export interface LogicalSearchPattern { readonly column: string; readonly pattern: string }
export interface LogicalSearchMember {
  readonly rowId: AppRowIdHexV1;
  readonly fieldId: string;
  readonly commitSeq: CommitSeq;
}
export type LogicalSearchRead =
  | Readonly<{ kind: "text"; definition: LogicalSearchDefinition;
    patterns: readonly LogicalSearchPattern[]; entries: readonly LogicalSearchMember[] }>
  | Readonly<{ kind: "jsonContainment"; definition: LogicalSearchDefinition;
    column: string; value: Json; entries: readonly LogicalSearchMember[] }>;
const foldAscii = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** A required three-character word run gives pg_trgm a selective key. A
 * wildcard-only or shorter pattern must use a different indexed anchor. */
export const hasMandatorySearchTrigram = (pattern: string) => /[a-z0-9]{3,}/.test(foldAscii(pattern));

export const readLogicalSearchRange = Effect.fn("LogicalDocuments.readSearchRange")(function* <Failure>(
  tx: FlarexMetadataTransaction, scopeId: ScopeId, definition: LogicalSearchDefinition,
  patterns: readonly LogicalSearchPattern[], maximumRows: number, error: LogicalDocumentFailure<Failure>,
) {
  if (definition.kind !== "text" || patterns.length === 0 || patterns.length > 16 || maximumRows < 1 ||
    patterns.some(pattern => !definition.columns.includes(pattern.column) || !hasMandatorySearchTrigram(pattern.pattern)))
    return yield* Effect.fail(error("limitExceeded"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId))
    .pipe(Effect.mapError(cause => error("invalidAuthority", cause)));
  // A row contributes at most one entry per declared field. The extra entry
  // detects a complete-result overflow without returning a truncated page.
  const maximumEntries = Math.min(4096, maximumRows * definition.columns.length);
  const clauses = patterns.map(pattern => and(eq(fxAppSearchEntryCurrent.fieldId, pattern.column),
    sql`${fxAppSearchEntryCurrent.foldedText} LIKE ${foldAscii(pattern.pattern)} ESCAPE ''`));
  const raw = yield* runDrizzleStatementEffect(tx.select({ rowId: fxAppSearchEntryCurrent.rowId,
    fieldId: fxAppSearchEntryCurrent.fieldId, commitSeq: fxAppSearchEntryCurrent.commitSeq })
    .from(fxAppSearchEntryCurrent).where(and(
      eq(fxAppSearchEntryCurrent.scopeUuid, scope.scopeUuid),
      eq(fxAppSearchEntryCurrent.tableId, definition.tableId),
      eq(fxAppSearchEntryCurrent.logicalIndexId, definition.logicalIndexId),
      eq(fxAppSearchEntryCurrent.sourceSha256, definition.sourceSha256),
      or(...clauses),
    )).orderBy(asc(fxAppSearchEntryCurrent.rowId), asc(fxAppSearchEntryCurrent.fieldId))
    .limit(maximumEntries + 1), cause => error("statementFailure", cause));
  if (raw.length > maximumEntries) return yield* Effect.fail(error("limitExceeded"));
  const entries: LogicalSearchMember[] = [];
  const identities = new Set<AppRowIdHexV1>();
  for (const row of raw) {
    const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(row.rowId))
      .pipe(Effect.mapError(cause => error("storedCorruption", cause)));
    identities.add(rowId);
    if (identities.size > maximumRows) return yield* Effect.fail(error("limitExceeded"));
    entries.push(Object.freeze({ rowId, fieldId: row.fieldId, commitSeq: row.commitSeq }));
  }
  return Object.freeze(entries);
});

export const sameLogicalSearchMembership = (left: readonly LogicalSearchMember[], right: readonly LogicalSearchMember[]) =>
  left.length === right.length && left.every((member, index) => {
    const other = right[index];
    return other !== undefined && member.rowId === other.rowId && member.fieldId === other.fieldId &&
      member.commitSeq === other.commitSeq;
  });

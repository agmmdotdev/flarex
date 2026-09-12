import { asc, eq, getTableColumns, sql } from "drizzle-orm";
import { ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
} from "../src/schema";

/** Full tuple and xmin evidence detects redundant UPDATEs as well as new history. */
export async function readOrderedMembershipStorage(
  db: FlarexMetadataDatabase,
  scope: string,
) {
  const scopeUuid = ScopeUuidV1Schema.make(scope);
  const revisions = await db
    .select({
      ...getTableColumns(fxAppIndexEntryRevisions),
      xmin: sql<string>`${fxAppIndexEntryRevisions}.xmin::text`,
    })
    .from(fxAppIndexEntryRevisions)
    .where(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid))
    .orderBy(
      asc(fxAppIndexEntryRevisions.indexDefinitionId),
      asc(fxAppIndexEntryRevisions.encodedKey),
      asc(fxAppIndexEntryRevisions.rowId),
      asc(fxAppIndexEntryRevisions.commitSeq),
    );
  const current = await db
    .select({
      ...getTableColumns(fxAppIndexEntryCurrent),
      xmin: sql<string>`${fxAppIndexEntryCurrent}.xmin::text`,
    })
    .from(fxAppIndexEntryCurrent)
    .where(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid))
    .orderBy(
      asc(fxAppIndexEntryCurrent.indexDefinitionId),
      asc(fxAppIndexEntryCurrent.encodedKey),
      asc(fxAppIndexEntryCurrent.rowId),
    );
  return { revisions, current };
}

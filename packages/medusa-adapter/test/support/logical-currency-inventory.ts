import { fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppRowCurrent,
  fxAppRowRevisions, fxAppUniqueKeys, fxSystemCommitAppRowChanges, fxSystemCommits,
  fxSystemCommitWakes, fxSystemIdempotency, fxSystemIndexBuildStates,
  fxSystemScopeClocks, fxSystemUniqueConstraintBuilds } from "../../../persistence-postgres/src/schema";
import { fxSystemCommitRelationalChanges } from
  "../../../persistence-postgres/src/commitPublication/relationalFactsSchema";
import { fxSystemCommitEvents } from "../../../persistence-postgres/src/commitEvents/schema";
import { fxSystemLogicalSourceInitializations } from
  "../../../persistence-postgres/src/logicalStorageInitialization";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

/** The durable families a logical Currency request can change in this scope. */
export async function logicalCurrencyInventory(fixture: LogicalCurrencyFixture) {
  const db = fixture.persistence.drizzle;
  return {
    rows: await db.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
    revisions: await db.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId,
      fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    indexEntries: await db.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId,
      fxAppIndexEntryCurrent.encodedKey, fxAppIndexEntryCurrent.rowId),
    indexRevisions: await db.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId,
      fxAppIndexEntryRevisions.encodedKey, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    uniqueKeys: await db.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.encodedKey),
    indexBuilds: await db.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId),
    uniqueBuilds: await db.select().from(fxSystemUniqueConstraintBuilds)
      .orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId),
    commits: await db.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
    rowChanges: await db.select().from(fxSystemCommitAppRowChanges)
      .orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal),
    outcomes: await db.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey),
    wakes: await db.select().from(fxSystemCommitWakes).orderBy(fxSystemCommitWakes.commitSeq),
    clocks: await db.select().from(fxSystemScopeClocks),
    events: await db.select().from(fxSystemCommitEvents)
      .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
    physicalFacts: await db.select().from(fxSystemCommitRelationalChanges)
      .orderBy(fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal),
    initialization: await db.select().from(fxSystemLogicalSourceInitializations),
  };
}

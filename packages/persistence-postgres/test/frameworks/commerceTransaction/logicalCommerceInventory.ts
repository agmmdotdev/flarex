import { Effect } from "effect";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxAppEdgeCurrent, fxAppEdgeAdjacencyVersions, fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency,
  fxSystemCommitWakes, fxSystemScopeClocks, outbox } from "../../../src/database/schema";
import { fxSystemCommitRelationalChanges } from "../../../src/commit/publication/relationalFactsSchema";
import { fxSystemCommitEvents } from "../../../src/commit/events/schema";
import { fxSystemFrameworkInitializations } from "../../../src/installation/frameworkSchema/installation/initializationSchema";

/** Read the complete existing durable families used by neutral logical-host
 * rollback proofs. This inspector supplies no acceptance or settlement logic. */
export const logicalCommerceInventory = Effect.fn("LogicalCommerce.inventory")(function* (db: FlarexMetadataDatabase) {
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement,
    cause => commerceError("statementFailure", cause));
  return {
    rows: yield* query(db.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId)),
    revisions: yield* query(db.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq)),
    indexes: yield* query(db.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.encodedKey, fxAppIndexEntryCurrent.rowId)),
    indexRevisions: yield* query(db.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.encodedKey, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq)),
    unique: yield* query(db.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.canonicalKeySha256)),
    edges: yield* query(db.select().from(fxAppEdgeCurrent)), adjacency: yield* query(db.select().from(fxAppEdgeAdjacencyVersions)),
    commits: yield* query(db.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq)),
    appFacts: yield* query(db.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal)),
    relationalFacts: yield* query(db.select().from(fxSystemCommitRelationalChanges).orderBy(fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal)),
    outcomes: yield* query(db.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey)),
    wakes: yield* query(db.select().from(fxSystemCommitWakes).orderBy(fxSystemCommitWakes.commitSeq)),
    clocks: yield* query(db.select().from(fxSystemScopeClocks)), events: yield* query(db.select().from(fxSystemCommitEvents)),
    initializations: yield* query(db.select().from(fxSystemFrameworkInitializations)), outbox: yield* query(db.select().from(outbox)),
  };
});

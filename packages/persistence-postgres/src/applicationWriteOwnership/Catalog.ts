import { Effect } from "effect";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runEffectTransaction } from "../effectTransaction";
import { ApplicationWriteOwnershipError } from "./Model";

export interface ApplicationWriteOwnershipCatalog {
  readonly database: FlarexMetadataDatabase;
  readonly transaction: FlarexMetadataTransaction;
}

/** One bounded catalog acquisition for ownership history, sizes and closures.
 * A trusted outer owner borrows its already admitted transaction explicitly. */
export function withApplicationWriteOwnershipCatalog<Value>(
  database: FlarexMetadataDatabase,
  reader: FlarexMetadataTransaction | undefined,
  work: (catalog: ApplicationWriteOwnershipCatalog) => Effect.Effect<Value, ApplicationWriteOwnershipError>,
): Effect.Effect<Value, ApplicationWriteOwnershipError> {
  return reader === undefined
    ? runEffectTransaction<Value, ApplicationWriteOwnershipError, ApplicationWriteOwnershipError, FlarexMetadataTransaction>(
      callback => database.transaction(callback),
      "Application ownership catalog acquisition rolled back",
      tx => work({ database, transaction: tx }),
      cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }),
    )
    : Effect.suspend(() => work({ database, transaction: reader }));
}

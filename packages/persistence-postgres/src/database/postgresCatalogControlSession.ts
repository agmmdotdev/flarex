import {
  makePostgresPhysicalSessionDriver,
  type PhysicalPostgresPool,
  type PostgresPhysicalSessionOptions,
} from "./physicalSession/postgres";
import { makePhysicalSessionAccess } from "./physicalSession/drizzle";
import { flarexSchema } from "./schema";
import { Effect } from "effect";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { closeInstallationAdmission, lockInstallationForCurrentTransaction } from "../installation/installationLifecycle";
import { runEffectTransaction } from "./effectTransaction";
import {
  catalogControlPhysicalErrors,
  CatalogControlSessionResourceIssue,
  type CatalogControlSessionDriver,
} from "./catalogControlSession";
const access = makePhysicalSessionAccess(flarexSchema);
/** Catalog composition supplies schema and error policy, never physical settlement mechanics. */
export function makePostgresCatalogControlSessionDriver(
  pool: PhysicalPostgresPool,
  options: PostgresPhysicalSessionOptions = {},
): CatalogControlSessionDriver {
  const driver = makePostgresPhysicalSessionDriver(
    pool,
    { access, errors: catalogControlPhysicalErrors },
    options,
  );
  return {
    runInitialTransactionEffect: (input, restore, work) =>
      driver.runInitialTransactionEffect(input, restore, admit(work)),
    runRecoveryTransactionEffect: (input, work) =>
      driver.runRecoveryTransactionEffect(input, admit(work)),
    // Catalog resolution previously used independent autocommit reads. A
    // bounded read-committed transaction now protects their structural use
    // while preserving the physical owner's deadline, drain and cleanup.
    runReadEffect: (input, work) => driver.runReadEffect(input, database =>
      runEffectTransaction(
        callback => database.transaction(callback),
        "Installation-protected catalog read rolled back.",
        work,
        admissionIssue,
      )),
  };
}

function admit<Value, Failure>(
  work: (transaction: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
) {
  return (transaction: FlarexMetadataTransaction) =>
    lockInstallationForCurrentTransaction(transaction).pipe(
      Effect.mapError(admissionIssue),
      Effect.andThen(() => work(transaction)),
      Effect.ensuring(Effect.sync(() => closeInstallationAdmission(transaction))),
    );
}

function admissionIssue(cause: unknown): CatalogControlSessionResourceIssue {
  return new CatalogControlSessionResourceIssue({ phase: "callback", cause });
}

import { beforeAll, onTestFinished } from "vitest";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { createPGlitePersistence } from "../../src/database/pglite";
import { createReadCommittedTransactionRunner } from "../../src/database/readCommittedTransactionRunner";
import { RUN_LOCATED_READ_COMMITTED_V1 } from "../../src/database/locatedTransactionIdentity";
import { withHistoricalApplicationAnalysisMigrations } from "../../src/testing/systemTestHistoricalApplicationAnalysisMigrations";
import { buildMigratedPGliteDataDir } from "../support/pgliteMigrationBaseline";
import { newTestPGlite } from "../support/pgliteSearchExtensions";

/** Retired repository transactions carry no current execution or installation authority. */
export function historicalVerifierTarget(db: FlarexMetadataDatabase) {
  return Object.freeze({
    [RUN_LOCATED_READ_COMMITTED_V1]: createReadCommittedTransactionRunner(db, async () => {}),
  });
}

/** Migrate once per suite; corruption and concurrency witnesses keep independent databases. */
export function useHistoricalVerifierPGlite() {
  let baseline: Blob | File;
  beforeAll(async () => {
    baseline = await withHistoricalApplicationAnalysisMigrations(buildMigratedPGliteDataDir);
  });
  return async () => {
    const db = newTestPGlite({ loadDataDir: baseline });
    onTestFinished(() => db.close());
    return createPGlitePersistence({ db });
  };
}

import type { PgTransactionConfig } from "drizzle-orm/pg-core";

import type { FlarexMetadataDatabase } from "./deployments";

/** Transaction-only Drizzle capabilities unavailable on the top-level DB. */
export type FlarexMetadataTransaction = FlarexMetadataDatabase & {
  rollback(): never;
  setTransaction(config: PgTransactionConfig): Promise<void>;
};

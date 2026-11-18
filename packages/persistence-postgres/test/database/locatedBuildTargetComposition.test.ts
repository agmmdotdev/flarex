import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { flarexSchema } from "../../src/database/schema";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../src/database/locatedTransactionIdentity";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from "../../src/database/locatedReadCommittedRunner";
import {
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  createPostgresLocatedAppUniqueConstraintSetBuildTargetV1,
} from "../../src/database/postgres";
import { createLocatedIndexBuildReconciliationTargetV1 } from "../../src/storage/indexes/indexBuildReconciliation";
import { createLocatedAppUniqueConstraintSetBuildTargetV1 } from "../../src/storage/unique/appUniqueConstraintSetBuildV1";

const locator = { kind: "shared_database", databaseKey: "test", schemaName: "public" } as const;
const pools: Pool[] = [];
function nativeDatabase() {
  const pool = new Pool();
  pools.push(pool);
  return { pool, drizzle: drizzle(pool, { schema: flarexSchema }) };
}
afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.end();
});

it.each([
  { name: "index", construct: createLocatedIndexBuildReconciliationTargetV1 },
  { name: "unique", construct: createLocatedAppUniqueConstraintSetBuildTargetV1 },
])("issues exact database composition only for its owned default $name runner", ({ construct }) => {
  const persistence = nativeDatabase();
  const foreign = nativeDatabase();
  const connect = vi.spyOn(persistence.pool, "connect");
  const target = construct(persistence.drizzle, locator);
  expect(hasLocatedReadCommittedTargetDatabaseV1(target, persistence.drizzle)).toBe(true);
  expect(hasLocatedReadCommittedTargetDatabaseV1(target, foreign.drizzle)).toBe(false);
  expect(hasLocatedReadCommittedTargetDatabaseV1({ ...target }, persistence.drizzle)).toBe(false);
  const explicitDefault = construct(persistence.drizzle, locator, undefined);
  expect(hasLocatedReadCommittedTargetDatabaseV1(explicitDefault, persistence.drizzle)).toBe(true);

  // Even an actual default runner supplied from outside is opaque here. The
  // database argument alone cannot prove which transaction the runner lends.
  for (const runner of [
    createDefaultLocatedReadCommittedTransactionRunnerV1(persistence.drizzle),
    createDefaultLocatedReadCommittedTransactionRunnerV1(foreign.drizzle),
  ]) {
    const custom = construct(persistence.drizzle, locator, runner);
    expect(custom[RUN_LOCATED_READ_COMMITTED_V1]).toBe(runner);
    expect(hasLocatedReadCommittedTargetDatabaseV1(custom, persistence.drizzle)).toBe(false);
    expect(hasLocatedReadCommittedTargetDatabaseV1(custom, foreign.drizzle)).toBe(false);
  }
  expect(connect).not.toHaveBeenCalled();
});

it.each([
  { name: "index", construct: createPostgresLocatedIndexBuildReconciliationTargetV1 },
  { name: "unique", construct: createPostgresLocatedAppUniqueConstraintSetBuildTargetV1 },
])("correlates the native $name runner only with its exact Drizzle client/pool pair", ({ construct }) => {
  const persistence = nativeDatabase();
  const foreign = nativeDatabase();
  const connect = vi.spyOn(persistence.pool, "connect");
  const target = construct(persistence, locator);
  expect(hasLocatedReadCommittedTargetDatabaseV1(target, persistence.drizzle)).toBe(true);
  expect(hasLocatedReadCommittedTargetDatabaseV1(target, foreign.drizzle)).toBe(false);
  expect(hasLocatedReadCommittedTargetDatabaseV1({ ...target }, persistence.drizzle)).toBe(false);
  // Another Drizzle object using the same native pool is still a different
  // control-reader identity, so the target cannot lend that composition.
  const otherDatabase = drizzle(persistence.pool, { schema: flarexSchema });
  expect(hasLocatedReadCommittedTargetDatabaseV1(target, otherDatabase)).toBe(false);

  const mismatched = construct({ drizzle: persistence.drizzle, pool: foreign.pool }, locator);
  expect(hasLocatedReadCommittedTargetDatabaseV1(mismatched, persistence.drizzle)).toBe(false);
  expect(hasLocatedReadCommittedTargetDatabaseV1(mismatched, foreign.drizzle)).toBe(false);
  expect(connect).not.toHaveBeenCalled();
});

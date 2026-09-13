import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  frameworkSchemaTargetSnapshot,
  hasFrameworkSchemaTargetDatabase,
  type FrameworkSchemaTarget,
} from "../src/frameworkSchema/target";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { makePostgresFrameworkMigrationFixtureTarget } from "./frameworkMigrationPostgresFixture";
import { runEffect } from "./effectTestRuntime";

/** Test-only explicit migration composition. Ordinary data fixtures need no driver. */
export function makeFrameworkMigrationFixtureTarget(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  target: FrameworkSchemaTarget,
) {
  const snapshot = frameworkSchemaTargetSnapshot(target);
  if (
    snapshot === undefined ||
    !hasFrameworkSchemaTargetDatabase(target, persistence.drizzle)
  )
    throw new Error("Foreign fixture schema target");
  const input = {
    persistence,
    deploymentId: snapshot.namespace.frame.deploymentId,
    canonicalPhysicalDatabaseIdentity:
      snapshot.namespace.frame.physicalDatabaseIdentity,
    physicalLocator: snapshot.physicalLocator,
  };
  return "pool" in persistence
    ? makePostgresFrameworkMigrationFixtureTarget({ ...input, persistence })
    : runEffect(
        makePGliteFrameworkMigrationTargetEffect({ ...input, persistence }),
      );
}

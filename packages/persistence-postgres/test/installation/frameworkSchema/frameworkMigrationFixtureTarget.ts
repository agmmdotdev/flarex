import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import {
  frameworkSchemaTargetSnapshot,
  hasFrameworkSchemaTargetDatabase,
  type FrameworkSchemaTarget,
} from "../../../src/installation/frameworkSchema/target";
import { makePGliteFrameworkMigrationTargetEffect } from "./frameworkMigrationPGliteTarget";
import { runEffect } from "../../support/effectTestRuntime";

/** Test-only explicit migration composition. Ordinary data fixtures need no driver. */
export function makeFrameworkMigrationFixtureTarget(
  persistence: PGliteFlarexPersistence,
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
  return runEffect(makePGliteFrameworkMigrationTargetEffect({ ...input, persistence }));
}

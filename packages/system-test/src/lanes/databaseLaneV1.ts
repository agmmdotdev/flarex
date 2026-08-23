import {
  type ApplicationNativeMutationFixtureOptions,
  createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres";

import type {
  StandardApplicationSystemTestLaneV1,
} from "../environment/standardApplicationEnvironmentV1";

export function makePGliteStandardApplicationSystemTestLaneV1(
  persistence: Readonly<{
    readonly control: PGliteFlarexPersistence;
    readonly target: PGliteFlarexPersistence;
  }>,
): StandardApplicationSystemTestLaneV1 {
  return Object.freeze({
    name: "pglite",
    ...persistence,
    createFixture: (options: ApplicationNativeMutationFixtureOptions) =>
      createApplicationNativeMutationPGliteFixtureWithPersistence(
        options,
        persistence,
      ),
    locateTaskRunCreationTarget: (physicalLocator: ScopePhysicalLocator) =>
      createPGliteLocatedTaskSystemRunAttemptTargetV1(
        persistence.target,
        physicalLocator,
      ),
  });
}

export function makePostgresStandardApplicationSystemTestLaneV1(
  persistence: Readonly<{
    readonly control: PostgresFlarexPersistence;
    readonly target: PostgresFlarexPersistence;
  }>,
): StandardApplicationSystemTestLaneV1 {
  return Object.freeze({
    name: "postgres",
    ...persistence,
    createFixture: (options: ApplicationNativeMutationFixtureOptions) =>
      createApplicationNativeMutationPostgresFixture(options, persistence),
    locateTaskRunCreationTarget: (physicalLocator: ScopePhysicalLocator) =>
      createPostgresLocatedTaskSystemRunAttemptTargetV1(
        persistence.target,
        physicalLocator,
      ),
  });
}

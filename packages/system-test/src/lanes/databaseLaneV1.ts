import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import type {
  StandardApplicationSystemTestLaneV1,
} from "../environment/standardApplicationEnvironmentV1";

type PGliteRegistrationTargetV1 = ReturnType<
  typeof createPGliteLocatedApplicationRevisionRegistrationTargetV1
>;

export function makePGliteStandardApplicationSystemTestLaneV1(
  persistence: PGliteFlarexPersistence,
  registrationTarget: PGliteRegistrationTargetV1 =
    createPGliteLocatedApplicationRevisionRegistrationTargetV1(
      persistence,
      FSV05_SUPPORTED_LOCATOR,
    ),
): StandardApplicationSystemTestLaneV1 {
  return {
    name: "pglite",
    persistence,
    registrationTarget,
    makeActivationTarget: () =>
      createPGliteLocatedApplicationRevisionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeDecisionUncertainTarget: () => {
      throw new Error(
        "The Standard Application system-test lane does not inject activation uncertainty.",
      );
    },
    makeSessionTarget: () =>
      createPGliteLocatedPointMutationSessionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeEpochTarget: () =>
      createPGliteLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
  };
}

export function makePostgresStandardApplicationSystemTestLaneV1(
  persistence: PostgresFlarexPersistence,
): StandardApplicationSystemTestLaneV1 {
  return {
    name: "postgres",
    persistence,
    registrationTarget:
      createPostgresLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeActivationTarget: () =>
      createPostgresLocatedApplicationRevisionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeDecisionUncertainTarget: () => {
      throw new Error(
        "The Standard Application system-test lane does not inject activation uncertainty.",
      );
    },
    makeSessionTarget: () =>
      createPostgresLocatedPointMutationSessionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeEpochTarget: () =>
      createPostgresLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
  };
}

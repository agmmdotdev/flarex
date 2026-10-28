import { createMigratedSplitPGlitePersistence } from "../support/databaseFixturesV1";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe } from "vitest";

import { APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS, APPLICATION_NATIVE_QUERY_CACHE_FIXTURE_OPTIONS } from
  "../../support/applicationNativeQueryHarness";
import { defineApplicationNativeQueryContract } from
  "../contracts/applicationNativeQueryContract";

describe("Application-native Standard query - PGlite", () => {
  defineApplicationNativeQueryContract({
    runScenario: scenario => scenario(async profile =>
      createApplicationNativeMutationPGliteFixtureWithPersistence(
        profile === "cacheProbe" ? APPLICATION_NATIVE_QUERY_CACHE_FIXTURE_OPTIONS : APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
        await createMigratedSplitPGlitePersistence(),
      )
    ),
  });
});

import { describe } from "vitest";
import {
  createApplicationNativeMutationPGliteFixtureWithPersistence,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS } from "../../support/applicationNativeQueryHarness";
import { defineApplicationActionAuthorityContract } from "../contracts/applicationActionAuthorityContract";
import { createMigratedSplitPGlitePersistence } from "../support/databaseFixturesV1";

describe("Application action authority - PGlite", () => {
  defineApplicationActionAuthorityContract({
    name: "pglite",
    runScenario: async scenario => scenario(await createApplicationNativeMutationPGliteFixtureWithPersistence(
      APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
      await createMigratedSplitPGlitePersistence(),
    )),
  });
});

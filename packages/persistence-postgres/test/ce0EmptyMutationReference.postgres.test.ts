import { describe, it } from "vitest";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { ce0EmptyMutationReferenceScenario } from "./ce0EmptyMutationReferenceScenario";

describe.skipIf(postgresUrl === null)(
  "zero-row request reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "cross-replays and refuses invalid authority and outcome evidence",
      () =>
        withPersistence(async (persistence) => {
          await ce0EmptyMutationReferenceScenario(
            persistence,
            makePostgresRelationalSession(persistence),
          );
        }),
      180_000,
    );
  },
);

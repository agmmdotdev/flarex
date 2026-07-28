import { Client } from "pg";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeclarativeV2VerifierProgressRepositoryV2,
} from "../src/declarativeV2VerifierProgressRepositoryV2";
import {
  createPostgresClientDeclarativeV2VerifierProgressRepositoryV2,
} from
  "@flarex/persistence-postgres/internal/postgres-client-declarative-v2-verifier-progress-v2";
import * as packageRoot from "../src";

describe("Postgres Client Declarative V2 verifier progress adapter", () => {
  it("returns only the existing repository contract", () => {
    expectTypeOf<
      ReturnType<
        typeof createPostgresClientDeclarativeV2VerifierProgressRepositoryV2
      >
    >().toEqualTypeOf<DeclarativeV2VerifierProgressRepositoryV2>();

    const repository =
      createPostgresClientDeclarativeV2VerifierProgressRepositoryV2(
        new Client(),
        {
          kind: "shared_database",
          databaseKey: "primary",
          schemaName: "public",
        },
        {
          repository: {
            claimDurationMilliseconds: 60_000,
          },
          quarantine: () => undefined,
        },
      );

    expect(repository.configuration._tag).toBe("Success");
    expect(Object.keys(repository).sort()).toEqual([
      "abandon",
      "acquire",
      "appendEvidencePage",
      "configuration",
      "createAttempt",
      "observeAttempt",
      "observeCommandDecision",
      "readEvidencePageBatch",
      "readSettledEvidencePageBatch",
      "release",
      "renew",
      "reserveCommand",
      "resumePending",
      "settleCommand",
    ]);
    for (const forbidden of [
      "client",
      "connect",
      "database",
      "drizzle",
      "end",
      "physicalLocator",
      "runTransaction",
      "transaction",
    ]) {
      expect(forbidden in repository).toBe(false);
    }
    expect(
      "createPostgresClientDeclarativeV2VerifierProgressRepositoryV2" in
        packageRoot,
    ).toBe(false);
  });
});

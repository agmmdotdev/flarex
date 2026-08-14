import { createPostgresPersistence } from "@flarex/persistence-postgres/postgres";
import { describe, expect, it } from "vitest";

import { proveConnectedApplicationAnalysis } from
  "./applicationAnalysisComposition.connected";

const databaseUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;

describe.runIf(databaseUrl !== undefined)(
  "Application Analysis connected composition on PostgreSQL",
  () => {
    it("settles, replays, and publishes through the post-retirement schema", async () => {
      if (databaseUrl === undefined) {
        throw new Error("PostgreSQL test URL was not provided.");
      }
      const persistence = await createPostgresPersistence({
        connectionString: databaseUrl,
      });
      try {
        await persistence.migrate();
        const proof = await proveConnectedApplicationAnalysis(
          persistence,
          crypto.randomUUID(),
        );

        expect(proof.replay).toEqual(proof.first);
        expect(proof.hostCalls).toBe(1);
        expect(proof.revisionCount).toBe("1");
        expect(proof.publication.revisionId).toBe(
          proof.stored.revision.revisionId,
        );
        expect(proof.runtimeTarget.target.function.path).toBe("status:get");
      } finally {
        await persistence.close();
      }
    });
  },
);

import { describe, expect, it } from "vitest";

import { runHostedExecutorOccProof } from "./hostedServiceBindingPostgresHarness";

describe(
  "hosted private executor service binding through cache-disabled Hyperdrive",
  { timeout: 180_000 },
  () => {
    it("proves stale OCC convergence and authoritative PostgreSQL state through only the public probe", async () => {
      const result = await runHostedExecutorOccProof();

      expect(result.evidence.freshTs).toBeGreaterThan(
        result.evidence.winnerTs,
      );
      expect(result.sql).toMatchObject({
        sessions: 3,
        activeSessions: 0,
        documentRevisions: 3,
        commits: 2,
        outboxEvents: 2,
        finalTs: result.evidence.freshTs,
        finalPrevTs: result.evidence.winnerTs,
        winnerState: "finished",
        staleState: "aborted",
        freshState: "finished",
        winnerObservedTs: 10,
        staleObservedTs: 10,
        freshObservedTs: result.evidence.winnerTs,
      });
    });
  },
);

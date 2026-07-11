import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { runHostedExecutorOccProof } from "../h05/hostedPostgresProof";

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
      expect(result.invocation).toMatchObject({
        unauthorizedStatus: 401,
        unauthorizedHopAbsent: true,
        authorizedResponses: 14,
        hopMarkedResponses: 14,
        noStoreResponses: 15,
        winner: { committedTs: result.evidence.winnerTs },
        fresh: { committedTs: result.evidence.freshTs },
      });
      expect(
        createHash("sha256")
          .update(result.invocationEvidenceJson)
          .digest("hex"),
      ).toBe(result.invocation.evidenceSha256);
      expect(result.cleanup).toEqual({ proofRowsRemaining: 0 });
    });
  },
);

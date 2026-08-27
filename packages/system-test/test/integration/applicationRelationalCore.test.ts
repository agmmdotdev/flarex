import { describe, expect, it } from "vitest";

import {
  expectedApplicationRelationalCoreCommits,
  proveApplicationRelationalCore,
} from
  "../../support/applicationRelationalCoreHarness";

describe("SV-R Core relational Application - PGlite", () => {
  it("crosses analysis, activation, runtime commit, R03-A, and RQ01", async () => {
    const proof = await proveApplicationRelationalCore();

    expect(proof.analysisWorkerLoads).toBe(2);
    expect(proof.missingRelationPortWorkerLoads).toBe(1);
    expect(proof.missingRelationPortFailedClosed).toBe(true);
    expect(proof.mutationWorkerLoads).toBe(10);
    expect(proof.commits).toEqual(
      expectedApplicationRelationalCoreCommits(proof),
    );
    expect(proof.targetDeleteWasRestricted).toBe(true);
    expect(proof.incomingSourceDocumentIds).toEqual([proof.postDocumentId]);
    expect(proof.finalIncomingSourceDocumentIds).toEqual([]);
    expect(proof.edgePositions).toEqual([]);
    expect(proof.sourceRelationHistory.map(row => row.authors)).toEqual([
      [proof.targetDocumentIds[0], proof.targetDocumentIds[1]],
      [proof.targetDocumentIds[1], proof.targetDocumentIds[0]],
      [proof.targetDocumentIds[1]],
      [proof.targetDocumentIds[2]],
      [],
    ]);
    expect(proof.sourceRelationHistory.map(row => row.commitSeq)).toEqual([
      4n, 5n, 6n, 7n, 8n,
    ]);
    expect(proof.adjacencyVersions).toEqual([
      { direction: "incoming", lastChangedCommitSeq: 6n },
      { direction: "incoming", lastChangedCommitSeq: 7n },
      { direction: "incoming", lastChangedCommitSeq: 8n },
      { direction: "outgoing", lastChangedCommitSeq: 8n },
    ]);
  }, 480_000);
});

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
    expect(proof.mutationWorkerLoads).toBe(11);
    expect(proof.standardQueryWorkerLoads).toBe(1);
    expect(proof.standardQuerySnapshotRevalidations).toBe(1);
    expect(proof.standardQueryIncomingRelationReads).toBe(1);
    expect(proof.commits).toEqual(
      expectedApplicationRelationalCoreCommits(proof),
    );
    expect(proof.targetDeleteWasRestricted).toBe(true);
    expect(proof.incomingSourceDocumentIds).toEqual([proof.postDocumentId]);
    expect(proof.standardIncomingSourceDocumentIds).toEqual([
      proof.postDocumentId,
    ]);
    expect(proof.ordinaryDependency).toEqual({
      kind: "appRelationIncoming",
      edgeDefinitionMatches: true,
      targetDocumentMatches: true,
    });
    expect(proof.ordinarySnapshotConflict).toEqual({
      tag: "ApplicationQuerySnapshotError",
      reason: "snapshotChanged",
      retryable: true,
    });
    expect(proof.ordinaryCumulativeBudget).toEqual({
      successfulReads: 31,
      tag: "ApplicationQuerySnapshotError",
      reason: "budgetExceeded",
    });
    expect(proof.finalIncomingSourceDocumentIds).toEqual([]);
    expect(proof.edgePositions).toEqual([]);
    expect(proof.sourceRelationHistory.map(row => row.authors)).toEqual([
      [proof.targetDocumentIds[0], proof.targetDocumentIds[1]],
      [proof.targetDocumentIds[1], proof.targetDocumentIds[0]],
      [proof.targetDocumentIds[1]],
      [proof.targetDocumentIds[2]],
      [proof.targetDocumentIds[2], proof.targetDocumentIds[0]],
      [],
    ]);
    expect(proof.sourceRelationHistory.map(row => row.commitSeq)).toEqual([
      4n, 5n, 6n, 7n, 8n, 9n,
    ]);
    expect(proof.adjacencyVersions).toEqual([
      { direction: "incoming", lastChangedCommitSeq: 7n },
      { direction: "incoming", lastChangedCommitSeq: 9n },
      { direction: "incoming", lastChangedCommitSeq: 9n },
      { direction: "outgoing", lastChangedCommitSeq: 9n },
    ]);
  }, 480_000);
});

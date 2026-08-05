import type {
  StandardApplicationAuthoritativeInspectionV1,
} from "@flarex/system-test/inspection/v1";
import { expect } from "vitest";

export function expectSinglePublicationInspectionV1(
  inspection: StandardApplicationAuthoritativeInspectionV1,
  tableName: string,
  documentId: string,
  queryRuntimeExecutions: number,
): void {
  expect(Object.isFrozen(inspection)).toBe(true);
  expect(Object.isFrozen(inspection.currentRows)).toBe(true);
  expect(Object.isFrozen(inspection.currentRows[0])).toBe(true);
  expect(inspection).toEqual({
    version: 1,
    currentRows: [{
      tableName,
      documentId,
      commitSeq: "1",
      valueState: "live",
    }],
    currentRowCount: 1,
    liveRowCount: 1,
    revisionRowCount: 1,
    commitSeqs: ["1"],
    idempotencyOutcomeCommitSeqs: ["1"],
    commitFeedCommitSeqs: ["1"],
    outboxCommitSeqs: ["1"],
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions,
  });
}

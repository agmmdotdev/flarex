import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaG } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema G", () => {
  it("fences an old-schema attempt and publishes an ordinary new-schema retry", async () => {
    await expect(proveManagedSchemaCookingSchemaG()).resolves.toEqual({
      attemptStartedUnderSchemaF: true,
      replacementActivatedBeforePublication: true,
      staleAttemptRejected: true,
      staleAttemptLeftPublicationUnchanged: true,
      staleAttemptLeftApplicationStorageUnchanged: true,
      candidateReceiptStayedExact: true,
      ordinaryRetrySelectedSchemaG: true,
      ordinaryRetryPublishedExactlyOnce: true,
      finalDocumentConformsToSchemaG: true,
      candidateHeadCount: 1,
      activationCount: 6,
      activeHeadCount: 1,
      analysisWorkerLoads: 18,
      runtimeWorkerLoads: 19,
      commitCount: 7,
      outcomeCount: 7,
      feedCount: 7,
      outboxCount: 7,
    });
  }, 480_000);
});

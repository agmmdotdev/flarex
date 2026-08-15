import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaA } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema A", () => {
  it("analyzes, activates, mutates, replays, and queries through current owners", async () => {
    await expect(proveManagedSchemaCookingSchemaA()).resolves.toEqual({
      analyzedWithTwoColdLoads: true,
      activatedSchemaA: true,
      mutationPublished: true,
      exactReplay: true,
      queryReadCommittedDocument: true,
      runtimeWorkerLoads: 2,
      commitCount: 1,
      outcomeCount: 1,
      feedCount: 1,
      outboxCount: 1,
    });
  }, 480_000);
});

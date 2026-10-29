import { describe, it } from "vitest";
import { createApplicationNativeMutationPGliteFixture } from "../applicationNativeMutationTestFixture";
import { assertQueryCacheHandoffLifecycle, QUERY_CACHE_HANDOFF_FIXTURE_OPTIONS } from "./queryCacheHandoffLifecycleScenario";

describe("query cache handoff lifecycle on PGlite", () => {
  it("preserves outcomes, overlapping snapshots and cancellation without late-read aliases", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture(QUERY_CACHE_HANDOFF_FIXTURE_OPTIONS);
    await assertQueryCacheHandoffLifecycle(fixture);
  }, 120_000);
});

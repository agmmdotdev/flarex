import { describe, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
} from "../src/pglite";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  APPLICATION_SCHEDULER_FIXTURE_OPTIONS,
  exerciseApplicationSchedulerParity,
} from "./taskSystemWakeSchedulerApplicationTestSupport";

describe("DTE05-C3 Application scheduler parity - PGlite", {
  timeout: 180_000,
}, () => {
  it("recovers persisted leases and retries with exact scope authority", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture(
      APPLICATION_SCHEDULER_FIXTURE_OPTIONS,
    );
    const located = Object.freeze({
      authority: fixture.active.basis.authority,
      target: createPGliteLocatedTaskSystemRunAttemptTargetV1(
        fixture.target,
        fixture.active.basis.authority.physicalLocator,
      ),
    });
    await exerciseApplicationSchedulerParity(fixture, located);
  });
});

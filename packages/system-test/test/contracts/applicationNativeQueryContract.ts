import { expect, it } from "vitest";

import {
  proveApplicationNativeQuery,
  type ApplicationNativeQueryFixtureFactory,
} from "../../support/applicationNativeQueryHarness";

export interface ApplicationNativeQueryContractAdapter {
  readonly runScenario: <A>(
    scenario: (createFixture: ApplicationNativeQueryFixtureFactory) => Promise<A>,
  ) => Promise<A>;
}

export function defineApplicationNativeQueryContract(
  adapter: ApplicationNativeQueryContractAdapter,
): void {
  it("opens the active snapshot and executes one fresh Application Worker", async () => {
    const proof = await adapter.runScenario(proveApplicationNativeQuery);
    expect(proof).toMatchObject({
      result: { name: "Ada" },
      freshWorkerLoads: 2,
      snapshotRevalidations: 2,
      pointDocumentReads: 2,
      sourceReads: 2,
      headMovementSelectedNewRevision: true,
    });
  }, 480_000);
}

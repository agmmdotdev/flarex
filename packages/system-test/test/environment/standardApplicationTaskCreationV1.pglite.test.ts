import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import { Effect } from "effect";
import { expect, it } from "vitest";

import {
  createMigratedSplitPGlitePersistence as createMigratedPGlitePersistence,
} from "../support/databaseFixturesV1";
import {
  readStandardApplicationTaskCreationStateV1,
  standardApplicationTaskCreationSimulationV1,
} from "./standardApplicationTaskCreationV1";

it("publishes a typed Task and replays one PGlite run exactly", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const receipt = await Effect.runPromise(runStandardApplicationSimulationV1({
    lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
    simulation: standardApplicationTaskCreationSimulationV1,
  }));

  expect(receipt.workloadProof.replay).toEqual(receipt.workloadProof.first);
  expect(receipt.workloadProof.first).toMatchObject({
    status: "created",
    version: 1,
  });
  expect(await readStandardApplicationTaskCreationStateV1(
    persistence.target,
  )).toEqual([{
    catalog_count: "1",
    definition_count: "1",
    legacy_definition_revision_count: "0",
    run_count: "1",
    request_count: "1",
    attempt_count: "0",
    pending_count: "0",
    dispatch_count: "0",
  }]);
}, 480_000);

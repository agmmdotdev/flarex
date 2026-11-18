import { createCorePGliteFixture } from "./fixture";
import { registerSnapshotFilterScenarios } from "./snapshotFilterScenarios";

registerSnapshotFilterScenarios("PGlite", createCorePGliteFixture);

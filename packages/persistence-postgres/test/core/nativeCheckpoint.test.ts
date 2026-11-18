import { createCorePGliteFixture } from "./fixture";
import { registerNativeCheckpointScenarios } from "./nativeCheckpointScenarios";
registerNativeCheckpointScenarios("PGlite source-confined native checkpoints", createCorePGliteFixture);

import { createCorePGliteFixture } from "./fixture";
import { registerCoreIndexCacheScenarios } from "./indexCacheScenarios";

registerCoreIndexCacheScenarios("PGlite connected snapshot and shared pages", createCorePGliteFixture);

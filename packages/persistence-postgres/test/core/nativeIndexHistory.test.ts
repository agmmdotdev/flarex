import { createCorePGliteFixture } from "./fixture";
import { registerNativeIndexHistoryScenarios } from "./nativeIndexHistoryScenario";
registerNativeIndexHistoryScenarios("PGlite", createCorePGliteFixture);

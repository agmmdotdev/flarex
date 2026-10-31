import { createCorePGliteFixture } from "./fixture";
import { registerNativeInitializationScenarios } from "./nativeInitializationScenarios";
registerNativeInitializationScenarios("PGlite native initialization claims", createCorePGliteFixture);

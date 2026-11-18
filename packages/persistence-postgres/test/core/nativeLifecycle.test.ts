import { createCorePGliteFixture } from "./fixture";
import { registerNativeLifecycleScenarios } from "./nativeLifecycleScenarios";
registerNativeLifecycleScenarios("PGlite native shared lifecycle", createCorePGliteFixture);

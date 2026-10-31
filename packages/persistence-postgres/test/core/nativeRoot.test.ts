import { createCorePGliteFixture } from "./fixture";
import { registerNativeRootScenarios } from "./nativeRootScenarios";
registerNativeRootScenarios("PGlite confined native roots", createCorePGliteFixture);

import { createCorePGliteFixture } from "./fixture";
import { registerNativeRootEventScenarios } from "./nativeRootEventsScenarios";
registerNativeRootEventScenarios("PGlite root-bound native event policy", createCorePGliteFixture);

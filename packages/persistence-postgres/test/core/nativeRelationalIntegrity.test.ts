import { createCorePGliteFixture } from "./fixture";
import { registerNativeRelationalIntegrityScenarios } from "./nativeRelationalIntegrityScenarios";
registerNativeRelationalIntegrityScenarios("PGlite complete Product native integrity", createCorePGliteFixture);

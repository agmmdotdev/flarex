import { createCorePGliteFixture } from "./fixture";
import { registerNativeRealPersistenceScenarios } from "./nativeRealPersistenceScenarios";
registerNativeRealPersistenceScenarios("PGlite", createCorePGliteFixture);

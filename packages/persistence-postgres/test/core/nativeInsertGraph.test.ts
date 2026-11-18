import { createCorePGliteFixture } from "./fixture";
import { registerNativeInsertGraphScenarios } from "./nativeInsertGraphScenarios";
registerNativeInsertGraphScenarios("PGlite trusted graph insert slot reads", createCorePGliteFixture);

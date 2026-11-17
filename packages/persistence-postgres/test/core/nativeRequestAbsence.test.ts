import { createCorePGliteFixture } from "./fixture";
import { registerNativeRequestAbsenceScenarios } from "./nativeRequestAbsenceScenarios";
registerNativeRequestAbsenceScenarios("PGlite request absence claims", createCorePGliteFixture);

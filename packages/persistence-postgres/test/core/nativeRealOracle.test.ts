import { createCorePGliteFixture } from "./fixture";
import { registerNativeRealOracleScenarios } from "./nativeRealOracleScenarios";
registerNativeRealOracleScenarios("PGlite", createCorePGliteFixture);

import { createCorePGliteFixture } from "./fixture";
import { registerNativeScopeExclusionScenarios } from "./nativeScopeExclusionScenario";

registerNativeScopeExclusionScenarios("PGlite native scope exclusion", createCorePGliteFixture);

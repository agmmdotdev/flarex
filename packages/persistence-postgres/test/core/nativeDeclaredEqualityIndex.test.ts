import { createCorePGliteFixture } from "./fixture";
import { registerNativeDeclaredEqualityIndexScenarios } from "./nativeDeclaredEqualityIndexScenario";
registerNativeDeclaredEqualityIndexScenarios("PGlite native declared equality index", createCorePGliteFixture);

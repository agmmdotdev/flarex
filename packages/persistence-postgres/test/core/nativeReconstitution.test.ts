import { createCorePGliteFixture } from "./fixture";
import { registerNativeReconstitutionScenarios } from "./nativeReconstitutionScenario";
registerNativeReconstitutionScenarios("PGlite native same-root reconstitution", createCorePGliteFixture);

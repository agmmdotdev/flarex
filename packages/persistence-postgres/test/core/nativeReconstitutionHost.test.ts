import { createCorePGliteFixture } from "./fixture";
import { registerNativeReconstitutionHostScenarios } from "./nativeReconstitutionHostScenario";
registerNativeReconstitutionHostScenarios("PGlite native reconstitution host", createCorePGliteFixture);

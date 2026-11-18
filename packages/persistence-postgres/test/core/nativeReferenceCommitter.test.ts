import { createCorePGliteFixture } from "./fixture";
import { registerNativeReferenceCommitterScenarios } from "./nativeReferenceCommitterScenarios";

registerNativeReferenceCommitterScenarios("PGlite native reference durability", createCorePGliteFixture);

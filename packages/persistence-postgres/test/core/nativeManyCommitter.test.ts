import { createCorePGliteFixture } from "./fixture";
import { registerNativeReferenceCommitterScenarios } from "./nativeReferenceCommitterScenarios";

registerNativeReferenceCommitterScenarios("PGlite native many membership durability", createCorePGliteFixture, "many");

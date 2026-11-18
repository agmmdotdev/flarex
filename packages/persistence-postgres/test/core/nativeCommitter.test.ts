import { createCorePGliteFixture } from "./fixture";
import { registerNativeCommitterScenarios } from "./nativeCommitterScenarios";

registerNativeCommitterScenarios("PGlite native commit acceptance", createCorePGliteFixture);

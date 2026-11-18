import { createCorePGliteFixture } from "./fixture";
import { registerNativeGeneratedSerialScenarios } from "./nativeGeneratedSerialScenario";

registerNativeGeneratedSerialScenarios("PGlite native generated serials", createCorePGliteFixture);

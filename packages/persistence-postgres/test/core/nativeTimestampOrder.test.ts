import { createCorePGliteFixture } from "./fixture";
import { registerNativeTimestampOrderScenarios } from "./nativeTimestampOrderScenario";

registerNativeTimestampOrderScenarios("PGlite native timestamp ordering", createCorePGliteFixture);

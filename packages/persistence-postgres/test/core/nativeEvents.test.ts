import { createCorePGliteFixture } from "./fixture";
import { registerNativeEventScenarios } from "./nativeEventsScenarios";
registerNativeEventScenarios("PGlite private native events", createCorePGliteFixture);

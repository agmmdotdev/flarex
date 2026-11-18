import { createCorePGliteFixture } from "./fixture";
import { registerNativeRecordedRowReplayScenarios } from "./nativeRecordedRowReplayScenario";
registerNativeRecordedRowReplayScenarios("PGlite native recorded-row replay", createCorePGliteFixture);

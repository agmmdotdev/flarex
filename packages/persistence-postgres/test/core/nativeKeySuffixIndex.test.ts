import { createCorePGliteFixture } from "./fixture";
import { registerNativeKeySuffixIndexScenarios } from "./nativeKeySuffixIndexScenario";
registerNativeKeySuffixIndexScenarios("PGlite native inferred key suffix index", createCorePGliteFixture);

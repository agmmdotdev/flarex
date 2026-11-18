import { createCorePGliteFixture } from "./fixture";
import { registerNativeTextPredicateIndexScenarios } from "./nativeTextPredicateIndexScenario";
registerNativeTextPredicateIndexScenarios("PGlite native null-and-text index", createCorePGliteFixture);

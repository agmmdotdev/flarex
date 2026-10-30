import { createCorePGliteFixture } from "./fixture";
import { registerCoreQueryScenarios } from "./queryScenarios";

registerCoreQueryScenarios("PGlite translated query stream", createCorePGliteFixture);

import { createCorePGliteFixture } from "./fixture";
import { registerCoreQueryTargetScenarios } from "./queryTargetScenarios";

registerCoreQueryTargetScenarios("PGlite fixed Application query source", createCorePGliteFixture);

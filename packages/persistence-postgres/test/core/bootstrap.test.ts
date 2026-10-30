import { createCorePGliteFixture } from "./fixture";
import { registerCoreBootstrapScenarios } from "./bootstrapScenarios";

registerCoreBootstrapScenarios("PGlite translated core", createCorePGliteFixture);

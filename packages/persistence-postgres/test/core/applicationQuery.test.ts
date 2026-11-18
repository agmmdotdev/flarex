import { createCorePGliteFixture } from "./fixture";
import { registerCoreApplicationQueryScenarios } from "./applicationQueryScenarios";

registerCoreApplicationQueryScenarios("PGlite standalone Application query", createCorePGliteFixture);

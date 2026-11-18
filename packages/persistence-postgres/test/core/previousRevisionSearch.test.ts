import { createCorePGliteFixture } from "./fixture";
import { registerPreviousRevisionSearchScenarios } from "./previousRevisionSearchScenarios";

registerPreviousRevisionSearchScenarios("PGlite", createCorePGliteFixture);

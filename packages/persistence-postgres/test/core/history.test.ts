import { createCorePGliteFixture } from "./fixture";
import { registerCoreHistoryScenarios } from "./historyScenarios";
registerCoreHistoryScenarios("PGlite", createCorePGliteFixture);

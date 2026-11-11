import { createCorePGliteFixture } from "./fixture";
import { registerCoreApplicationUpgradeScenarios } from "./applicationUpgradeScenarios";
registerCoreApplicationUpgradeScenarios("PGlite registered Application upgrades", createCorePGliteFixture);

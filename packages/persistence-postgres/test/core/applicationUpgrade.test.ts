import { registerCoreApplicationDeploymentMigrationScenarios } from "./applicationDeploymentMigrationScenarios";
import { createCorePGliteFixture } from "./fixture";
import { registerCoreApplicationUpgradeScenarios } from "./applicationUpgradeScenarios";
registerCoreApplicationUpgradeScenarios("PGlite registered Application upgrades", createCorePGliteFixture);
registerCoreApplicationDeploymentMigrationScenarios("PGlite deployment migration", createCorePGliteFixture);

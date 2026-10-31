import { registerCoreLiteralSchemaScenarios } from "./literalSchemaScenarios";
import { createCorePGliteFixture } from "./fixture";
import { registerCoreSchemaWorkerScenarios } from "./schemaWorkerScenarios";
registerCoreSchemaWorkerScenarios("PGlite schema worker lifecycle",createCorePGliteFixture);

registerCoreLiteralSchemaScenarios("PGlite exact schema literals", createCorePGliteFixture);

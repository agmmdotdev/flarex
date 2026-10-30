import { createCorePGliteFixture } from "./fixture";
import { registerCoreSchemaWorkerScenarios } from "./schemaWorkerScenarios";
registerCoreSchemaWorkerScenarios("PGlite schema worker lifecycle",createCorePGliteFixture);

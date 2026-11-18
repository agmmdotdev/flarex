import { createCorePGliteFixture } from "./fixture";
import { registerCoreSourceSchemaScenarios } from "./sourceSchemaScenarios";

registerCoreSourceSchemaScenarios("PGlite source schema roots and variants", createCorePGliteFixture);

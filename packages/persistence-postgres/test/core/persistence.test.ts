import { createCorePGliteFixture } from "./fixture";
import { registerCorePersistenceScenarios } from "./persistenceScenarios";

registerCorePersistenceScenarios("PGlite", createCorePGliteFixture);

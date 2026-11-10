import { createCorePGliteFixture } from "./fixture";
import { registerCorePersistenceScenarios } from "./persistenceScenarios";
import { registerCoreLeaseHandoffScenarios } from "./leaseHandoffScenarios";

registerCorePersistenceScenarios("PGlite", createCorePGliteFixture);
registerCoreLeaseHandoffScenarios("PGlite", createCorePGliteFixture);

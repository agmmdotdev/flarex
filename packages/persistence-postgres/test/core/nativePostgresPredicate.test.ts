import { createCorePGliteFixture } from "./fixture";
import { registerNativePostgresPredicateScenarios } from "./nativePostgresPredicateScenario";
registerNativePostgresPredicateScenarios("PGlite native PostgreSQL predicates", createCorePGliteFixture);

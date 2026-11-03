import { createCorePGliteFixture } from "./fixture";
import { registerNativePostgresPredicateScenarios } from "./nativePostgresPredicateScenario";
import { registerNativeRelatedPredicateScenarios } from "./nativeRelatedPredicateScenario";
registerNativePostgresPredicateScenarios("PGlite native PostgreSQL predicates", createCorePGliteFixture);
registerNativeRelatedPredicateScenarios("PGlite native related predicates", createCorePGliteFixture);

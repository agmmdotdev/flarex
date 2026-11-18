import { createCorePGliteFixture } from "./fixture";
import { registerNativeSchemaBundleLifecycleScenarios } from "./nativeSchemaBundleLifecycleScenarios";
registerNativeSchemaBundleLifecycleScenarios("PGlite native schema bundles", createCorePGliteFixture);

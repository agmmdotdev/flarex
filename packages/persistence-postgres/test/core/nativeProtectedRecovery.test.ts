import { createCorePGliteFixture } from "./fixture";
import { registerNativeProtectedRecoveryScenarios } from "./nativeProtectedRecoveryScenarios";
registerNativeProtectedRecoveryScenarios("PGlite protected historical outcomes", createCorePGliteFixture);

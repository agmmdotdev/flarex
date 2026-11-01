import { createCorePGliteFixture } from "./fixture";
import { registerNativeManyPolicyScenarios } from "./nativeManyPolicyScenarios";

registerNativeManyPolicyScenarios("native many policy (PGlite)", createCorePGliteFixture);

import { createCorePGliteFixture } from "./fixture";
import { registerNativeAtomicAdmissionScenarios } from "./nativeAtomicAdmissionScenario";
registerNativeAtomicAdmissionScenarios("PGlite native atomic admission", createCorePGliteFixture);

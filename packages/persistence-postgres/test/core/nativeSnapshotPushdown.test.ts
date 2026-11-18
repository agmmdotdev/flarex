import { createCorePGliteFixture } from "./fixture";
import { registerNativeSnapshotPushdownScenarios } from "./nativeSnapshotPushdownScenario";

registerNativeSnapshotPushdownScenarios("PGlite native snapshot predicate pushdown", createCorePGliteFixture);

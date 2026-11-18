import { createCorePGliteFixture } from "../core/fixture";
import { registerCoreMutationReplayScenarios } from "./coreMutationReplayScenarios";
registerCoreMutationReplayScenarios("PGlite registered source mutation replay", createCorePGliteFixture);

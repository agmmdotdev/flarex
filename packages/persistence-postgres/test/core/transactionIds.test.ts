import { createCorePGliteFixture } from "./fixture";
import { registerTransactionIdScenarios } from "./transactionIdScenarios";

registerTransactionIdScenarios("PGlite transaction-scoped Source IDs", createCorePGliteFixture);

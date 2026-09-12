import { describe } from "vitest";
import { assignmentBatchSuite } from "./frameworkPhysicalNameAssignmentBatchSuite";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

describe("bounded physical-name assignment batches (PGlite)", () => {
  assignmentBatchSuite(async run => run(await createMigratedPGlitePersistence()));
});

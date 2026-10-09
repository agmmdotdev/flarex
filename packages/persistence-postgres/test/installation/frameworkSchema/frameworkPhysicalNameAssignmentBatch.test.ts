import { describe } from "vitest";
import { assignmentBatchSuite } from "./frameworkPhysicalNameAssignmentBatchSuite";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";

describe("bounded physical-name assignment batches (PGlite)", () => {
  assignmentBatchSuite(async run => run(await createMigratedPGlitePersistence()));
});

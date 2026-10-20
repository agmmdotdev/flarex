import { describe } from "vitest";
import { assignmentBatchSuite } from "./frameworkPhysicalNameAssignmentBatchSuite";
import { useFileScopedFrameworkCoordinatorPersistence } from "./frameworkCoordinatorRepositoryTestSupport";

describe("bounded physical-name assignment batches (PGlite)", { concurrent: false }, () => {
  assignmentBatchSuite(useFileScopedFrameworkCoordinatorPersistence());
});

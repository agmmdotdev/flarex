import { describe } from "vitest";
import { postgresUrl } from "../../../../persistence-postgres/test/support/postgresHelpers";
import { registerCorePayloadFlowConformance } from "./corePayloadFlowsConformance";

describe.skipIf(postgresUrl === null)("current Payload workload construction (ordinary-role PostgreSQL)", () => {
  registerCorePayloadFlowConformance("postgres");
});

import { it } from "vitest";
import { payloadPopulationScenario } from "./payloadPopulationScenario";
it("populates bounded Payload reads in the original native CMS request", () => payloadPopulationScenario("pglite"), 180_000);

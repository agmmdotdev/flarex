import { it } from "vitest";
import { payloadRelationScenario } from "./payloadRelationScenario";
it("upgrades populated scalar content and preserves native optional-one references atomically", () => payloadRelationScenario("pglite"), 180_000);

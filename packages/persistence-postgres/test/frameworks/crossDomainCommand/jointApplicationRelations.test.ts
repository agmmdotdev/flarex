import { it } from "vitest";
import { jointApplicationRelationsScenario } from "./jointApplicationRelationsScenario";
it("maintains references in one genuine App/Payload/Currency command (PGlite)", () => jointApplicationRelationsScenario("pglite"), 180_000);

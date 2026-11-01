import { it } from "vitest";
import { payloadJoinScenario } from "./payloadJoinScenario";

it("preserves genuine reverse joins, population, authority and cold recovery", () => payloadJoinScenario("pglite"), 180_000);

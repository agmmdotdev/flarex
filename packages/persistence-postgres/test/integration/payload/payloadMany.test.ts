import { it } from "vitest";
import { payloadManyScenario, payloadManyCapacityScenario } from "./payloadManyScenario";

it("proves genuine fresh many CRUD, population, late integrity and recovery", () => payloadManyScenario("pglite"), 180_000);
it("keeps private membership work separate from business identity capacity", () => payloadManyCapacityScenario("pglite"), 180_000);

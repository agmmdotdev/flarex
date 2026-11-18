import { it } from "vitest";
import { payloadManyUpgradeScenario } from "./payloadManyUpgradeScenario";

it("refuses many upgrades of emptied scalar and optional-one owners", () => payloadManyUpgradeScenario("pglite"), 180_000);

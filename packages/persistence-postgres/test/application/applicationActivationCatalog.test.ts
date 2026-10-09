import { it } from "vitest";
import { applicationActivationCatalogScenario } from "./applicationActivationCatalogScenario";

it("borrows the split catalog lease for activation, rollback and replay (PGlite)",
  () => applicationActivationCatalogScenario(), 90_000);

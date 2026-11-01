import { it } from "vitest";
import { nativeCmsIdValidationScenario } from "./nativeCmsIdValidationScenario";

it("authenticates empty CMS ID batches through actual Core without body reads and retains refusal", () => nativeCmsIdValidationScenario("pglite"), 120_000);

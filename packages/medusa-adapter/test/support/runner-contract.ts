import type { ICurrencyModuleService } from "@medusajs/framework/types";

/** Type-only boundary for the preserved fork's compiler settings. The runner
 * implementation is checked against this same contract by the strict target build. */
export declare function moduleIntegrationTestRunner<_Service extends ICurrencyModuleService>(options: {
  moduleName: "currency";
  testSuite: (context: { service: Pick<ICurrencyModuleService, "listCurrencies" | "listAndCountCurrencies" | "retrieveCurrency"> }) => void;
}): void;

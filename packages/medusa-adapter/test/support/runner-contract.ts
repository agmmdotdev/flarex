import type { ICurrencyModuleService, IProductModuleService, IEventBusModuleService } from "@medusajs/framework/types";
export { default as MockEventBusService } from "@medusajs/test-utils/mock-event-bus-service";
export interface CurrencyRunnerOptions {
  moduleName: "currency";
  testSuite: (context: { service: Pick<ICurrencyModuleService, "listCurrencies" | "listAndCountCurrencies" | "retrieveCurrency"> }) => void;
}
export interface ProductRunnerOptions {
  moduleName: "product";
  injectedDependencies?: { event_bus: IEventBusModuleService };
  testSuite: (context: { service: IProductModuleService }) => void;
}
/** Source-test compiler boundary; the implementation checks these same overloads. */
export declare function moduleIntegrationTestRunner<_Service extends ICurrencyModuleService>(options: CurrencyRunnerOptions): void;
export declare function moduleIntegrationTestRunner<_Service extends IProductModuleService>(options: ProductRunnerOptions): void;

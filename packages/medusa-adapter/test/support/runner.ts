import { afterAll, beforeAll } from "vitest";
import { Effect, Exit, Option, Scope } from "effect";
import type { ICurrencyModuleService } from "@medusajs/framework/types";
import { currencyFixture } from "./fixture";

type CurrencyReads = Pick<ICurrencyModuleService, "listCurrencies" | "listAndCountCurrencies" | "retrieveCurrency">;

// The original suite supplies its service type parameter. This runner admits
// only Currency's read baseline and creates no global module registry.
export function moduleIntegrationTestRunner<_Service extends ICurrencyModuleService>(options: {
  moduleName: "currency";
  testSuite: (context: { service: CurrencyReads }) => void;
}): void {
  if (options.moduleName !== "currency") throw new Error("Only Currency is admitted");
  const scope = Effect.runSync(Scope.make());
  let current = Option.none<CurrencyReads>();
  const get = () => Option.getOrThrow(current);
  beforeAll(async () => {
    const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid comparison driver");
    const fixture = await Effect.runPromise(Effect.provideService(currencyFixture(driver), Scope.Scope, scope));
    current = Option.some(fixture.service);
  });
  afterAll(async () => {
    current = Option.none();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
  options.testSuite({ service: {
    listCurrencies: (...args) => get().listCurrencies(...args),
    listAndCountCurrencies: (...args) => get().listAndCountCurrencies(...args),
    retrieveCurrency: (...args) => get().retrieveCurrency(...args),
  } });
}

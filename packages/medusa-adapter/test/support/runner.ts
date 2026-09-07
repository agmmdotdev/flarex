import { afterAll, beforeAll } from "vitest";
import { Effect, Exit, Option, Scope } from "effect";
import type { ICurrencyModuleService } from "@medusajs/framework/types";
import { currencyFixture } from "./fixture";
import { liveCurrencyFixture, type LiveCurrencyFixture } from "./live-fixture";
import { registerLiveCurrencyChecks } from "./live-checks";

type CurrencyReads = Pick<ICurrencyModuleService, "listCurrencies" | "listAndCountCurrencies" | "retrieveCurrency">;

// The original suite supplies its service type parameter. This runner admits
// only Currency's read baseline and creates no global module registry.
export const moduleIntegrationTestRunner: typeof import("./runner-contract").moduleIntegrationTestRunner = (options) => {
  if (options.moduleName !== "currency") throw new Error("Only Currency is admitted");
  const scope = Effect.runSync(Scope.make());
  let current = Option.none<CurrencyReads>();
  const get = () => Option.getOrThrow(current);
  const cleanup: (() => Promise<void>)[] = [];
  let live: LiveCurrencyFixture | undefined;
  beforeAll(async () => {
    const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid comparison driver");
    const fixture = process.env.MEDUSA_CURRENCY_LANE === "flarex"
      ? (live = await liveCurrencyFixture(driver, work => cleanup.push(work)))
      : await Effect.runPromise(Effect.provideService(currencyFixture(driver), Scope.Scope, scope));
    current = Option.some(fixture.service);
  });
  afterAll(async () => {
    current = Option.none();
    const failures: unknown[] = [];
    for (const close of [() => Effect.runPromise(Scope.close(scope, Exit.void)), ...cleanup.reverse()]) {
      await close().catch(cause => { failures.push(cause); });
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Currency fixture cleanup failed");
  });
  options.testSuite({ service: {
    listCurrencies: (...args) => get().listCurrencies(...args),
    listAndCountCurrencies: (...args) => get().listAndCountCurrencies(...args),
    retrieveCurrency: (...args) => get().retrieveCurrency(...args),
  } });
  if (process.env.MEDUSA_CURRENCY_LANE === "flarex") registerLiveCurrencyChecks(() => {
    if (live === undefined) throw new Error("Live Currency fixture unavailable");
    return live;
  });
};

import { commerceHostFixture, type CommerceHostTestFixture } from "../../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";
import { currencyCommands, makeCurrencyService, type CurrencyReads } from "../../src/currency-service";
import { prepareCurrencyProfile } from "../../src/currency-contract";

export interface LiveCurrencyFixture extends CommerceHostTestFixture { readonly service: CurrencyReads; readonly observeSql?: (observer: ((text: string) => Promise<void> | void) | undefined) => void }
export async function liveCurrencyFixture(driver: "pglite" | "postgres", registerCleanup: (cleanup: () => Promise<void>) => void): Promise<LiveCurrencyFixture> {
  let observe: ((text: string) => Promise<void> | void) | undefined;
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup, observeQuery: text => observe?.(text) }) : await (async () => {
    const fixture = await createFileScopedPostgresFixture();
    registerCleanup(fixture.dispose);
    return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  const fixture = await commerceHostFixture(resource.persistence, resource.session, prepareCurrencyProfile, Object.values(currencyCommands), control);
  return { ...fixture, service: makeCurrencyService(fixture.host), ...(driver === "pglite" ? { observeSql: (observer: typeof observe) => { observe = observer; } } : {}) };
}

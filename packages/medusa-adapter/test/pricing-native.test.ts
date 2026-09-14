import { afterEach, beforeEach, describe } from "vitest";
import { Effect, Result, Schema } from "effect";
import { makeLocalPricingCommands } from "../src/pricing-service";
import { prepareProductVariantPricing } from "../src/product-variant-pricing-schema";
import { captureCommerceInput } from "../src/commerce-input";
import { registerNativePricingTests, seedPriceSetData, type NativePricingTestService } from "./support/pricing-native-tests";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let commands: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
const row = Schema.StructWithRest(Schema.Struct({ id: Schema.String, prices: Schema.optionalKey(Schema.Array(Schema.JsonObject)) }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeRow = Schema.decodeUnknownSync(row), decodeRows = Schema.decodeUnknownSync(Schema.Array(row));
const capture = (input: unknown) => Result.getOrThrow(captureCommerceInput(input));
const service: NativePricingTestService = {
  createPriceSets: async data => decodeRows(await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, capture(data)))),
  listPriceSets: async filters => decodeRows(await runEffect(fixture.host.read(commands.list, capture({ ...(filters === undefined ? {} : { filters }) })))),
  retrievePriceSet: async (id, config) => decodeRow(await runEffect(fixture.host.read(commands.retrieve, capture({ id, ...(config === undefined ? {} : { config }) })))),
};

describe("selected unchanged native Pricing tests", () => {
  beforeEach(async () => {
    const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
    const postgres = process.env.FLAREX_TEST_DRIVER === "postgres";
    const resource = postgres ? await (async () => { const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
      return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) }; })() : await createRelationalPGliteFixture({ registerCleanup });
    const control = postgres ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
    commands = await runEffect(makeLocalPricingCommands());
    const prepare = (...args: Parameters<typeof prepareProductVariantPricing>) => prepareProductVariantPricing(...args).pipe(Effect.map(value => ({ ...value, profile: value.profiles.pricing })));
    fixture = await commerceHostFixture(resource.persistence, resource.session, prepare, commands.commands, control, descriptor => commands.eventPolicy(descriptor, () => Effect.void));
    await seedPriceSetData(service);
  }, 120000);
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length) throw new AggregateError(failures, "Pricing native fixture cleanup failed");
  }, 120000);
  registerNativePricingTests(service);
});

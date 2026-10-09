import { afterEach, beforeEach, describe } from "vitest";
import { Result, Schema } from "effect";
import { captureCommerceInput } from "../src/commerce-input";
import { registerNativePricingTests, seedPriceSetData, type NativePricingTestService } from "./support/pricing-native-tests";
import { logicalPricingTestHost } from "./support/logical-pricing-test-host";
import { runEffect } from "../../persistence-postgres/test/support/effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalPricingTestHost>>;
const row = Schema.StructWithRest(Schema.Struct({ id: Schema.String, prices: Schema.optionalKey(Schema.Array(Schema.JsonObject)) }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeRow = Schema.decodeUnknownSync(row), decodeRows = Schema.decodeUnknownSync(Schema.Array(row));
const capture = (input: unknown) => Result.getOrThrow(captureCommerceInput(input));
const service: NativePricingTestService = {
  createPriceSets: async data => decodeRows(await runEffect(fixture.create(capture(data)))),
  listPriceSets: async filters => decodeRows(await runEffect(fixture.read(fixture.pricing.runtime.list, capture({ ...(filters === undefined ? {} : { filters }) })))),
  retrievePriceSet: async (id, config) => decodeRow(await runEffect(fixture.read(fixture.pricing.runtime.retrieve, capture({ id, ...(config === undefined ? {} : { config }) })))),
};

describe("selected unchanged native Pricing tests", () => {
  beforeEach(async () => {
    const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
    fixture = await logicalPricingTestHost(registerCleanup);
    await seedPriceSetData(service);
  }, 120000);
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) await close().catch(error => { failures.push(error); });
    if (failures.length) throw new AggregateError(failures, "Pricing native fixture cleanup failed");
  }, 120000);
  registerNativePricingTests(service);
});

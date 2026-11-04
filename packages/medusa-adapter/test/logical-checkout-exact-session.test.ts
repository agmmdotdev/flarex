import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { prepareCorePaymentSessions } from "./support/core-payment-session-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), id = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];

describe("native checkout exact replacement Session prerequisite", () => {
  let local: Awaited<ReturnType<typeof prepareCorePaymentSessions>>;
  beforeAll(async () => { local = await prepareCorePaymentSessions(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);
  it("creates a Session using its Collection's exact raw amount beyond Number precision", async () => {
    const before = await local.snapshot(), collections = await local.prepareCreateCollection(), collectionKey = collections.newRequestKey();
    const collection = object(await Effect.runPromise(collections.run(collectionKey, { currency_code: "usd", amount: "9007199254740993.0000" })));
    const afterCollection = await local.snapshot();
    expectCheckoutSettlement(before, afterCollection, collectionKey);
    const sessions = await local.prepareCreate(), sessionKey = sessions.newRequestKey();
    const created = object(await Effect.runPromise(sessions.run(sessionKey,
      { payment_collection_id: id(collection.id), provider_id: "pp_system_default" })));
    expect(created).toMatchObject({ amount: 9007199254740992, raw_amount: { value: "9007199254740993.0000", precision: 20 } });
    expect((await local.read()).find(row => row.id === created.id)?.amount).toBe("9007199254740993.0000");
    expectCheckoutSettlement(afterCollection, await local.snapshot(), sessionKey);
  }, 240_000);
});

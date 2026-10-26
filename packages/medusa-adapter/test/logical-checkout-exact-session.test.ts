import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareLogicalPaymentSessions } from "./support/logical-payment-session-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), id = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];

describe("native checkout exact replacement Session prerequisite", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentSessions>>;
  beforeAll(async () => { local = await prepareLogicalPaymentSessions(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);
  it("creates a Session using its Collection's exact raw amount beyond Number precision", async () => {
    const collections = await local.prepareCreateCollection(), collection = object(await Effect.runPromise(collections.run(collections.newRequestKey(),
      { currency_code: "usd", amount: "9007199254740993.0000" })));
    const sessions = await local.prepareCreate(), created = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(),
      { payment_collection_id: id(collection.id), provider_id: "pp_system_default" })));
    expect(created).toMatchObject({ amount: 9007199254740992, raw_amount: { value: "9007199254740993.0000", precision: 20 } });
  }, 240_000);
});

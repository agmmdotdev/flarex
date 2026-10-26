import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { collectionCartRows, prepareLogicalPaymentCollections } from "./support/logical-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
describe("callback child workflows borrow the existing atomic owner", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentCollections>>;
  beforeAll(async () => {
    local = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close), undefined, [...collectionCartRows,
      { table: "cart", row: { id: "cart-callback-late", currency_code: "usd" } },
      { table: "cart", row: { id: "cart-callback-caught", currency_code: "usd" } },
      { table: "cart", row: { id: "cart-callback-detached", currency_code: "usd" } },
    ]);
  }, 240_000);
  afterEach(async () => { await local.closeWorkflowHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);
  it("executes the genuine Cart collection child and replays its sole root outcome", async () => {
    const host = await local.prepareCreationProbe("callback"), key = host.newRequestKey(), input = { cart_id: "cart-unlinked" };
    const before = await local.snapshot(), result = await Effect.runPromise(host.run(key, input)), after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(after.events.length - before.events.length).toBe(2);
    await Effect.runPromise(host.close);
    const reopened = await local.prepareCreationProbe("callback");
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);
  it.each([
    ["callback-late", "cart-callback-late", "Late failure after callback-invoked native collection"],
    ["callback-caught", "cart-callback-caught", "unsupportedProfile"],
    ["callback-detached", "cart-callback-detached", "unsupportedProfile"],
  ] as const)("rolls back all native writes and events for %s", async (mode, cart_id, expected) => {
    const host = await local.prepareCreationProbe(mode), before = await local.snapshot();
    const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { cart_id }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      if (mode === "callback-late") expect(Cause.pretty(exit.cause)).toContain(expected);
      else expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
        .toEqual(expect.arrayContaining([expect.objectContaining({ reason: expected })]));
    }
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
});

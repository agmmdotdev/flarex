import { expect, it } from "vitest";
import { Effect } from "effect";
import { currencyFixture } from "./support/fixture";

it("keeps two Currency module instances and their database state independent", async () => {
  const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid comparison driver");
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const first = yield* currencyFixture(driver);
    const second = yield* currencyFixture(driver);
    expect(first.service).not.toBe(second.service);
    expect(first.internal).not.toBe(second.internal);
    expect(first.container).not.toBe(second.container);
    yield* Effect.promise(() => first.internal.update({ selector: { code: "usd" }, data: { name: "Isolated currency" } }));
    expect((yield* Effect.promise(() => first.service.retrieveCurrency("USD"))).name).toBe("Isolated currency");
    expect((yield* Effect.promise(() => second.service.retrieveCurrency("USD"))).name).toBe("US Dollar");
  })));
});

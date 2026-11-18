import { Effect, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalGraph } from "../src/local-graph/query";
import { currencyCommands, currencyGraph } from "../src/modules/currency/service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const decode = Schema.decodeUnknownEffect(Schema.Struct({ query: Schema.Json, options: Schema.optionalKey(Schema.Json) }));
const query = (code: string | readonly string[]) => ({ entity: "currency", fields: ["name"], filters: { code }, pagination: { take: 4 } });

describe("native root-key graph checks over real Currency logical storage", () => {
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  beforeAll(async () => { fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);
  it("keeps natural-key reads, partial absence, replay and ordinary absence on the same atomic owner", async () => {
    const participant = defineAtomicCommerceParticipant("queryKeyCurrency");
    const graph = Result.getOrThrow(currencyGraph.pipe(Result.flatMap(module => prepareLocalGraph([{ participant, module }]))));
    const read = defineAtomicCommerceCommand("queryKeyCurrencyRead", (ctx, input) => Effect.gen(function* () {
      const args = yield* decode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return yield* graph.bind(ctx).graph(args.query, args.options);
    }));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, commands: [read],
      participants: [{ participant, logicalStorage: fixture.hostInput.logicalStorage, commands: [currencyCommands.count] }] }));
    try {
      if (driver === "postgres") expect((await fixture.persistence.query(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
      const before = await logicalCurrencyInventory(fixture), options = { throwIfKeyNotFound: true };
      const request = host.newRequestKey(), input = { query: query(["usd", "usd"]), options };
      const value = await Effect.runPromise(host.run(request, read, input));
      expect(value).toEqual({ data: [{ name: "US Dollar" }], metadata: { count: 1, skip: 0, take: 4 } });
      expect(await Effect.runPromise(host.run(request, read, input))).toEqual(value);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), read, { query: query([]), options })))
        .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
      const missing = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), read,
        { query: query(["missing-b", "usd", "missing-a", "missing-b"]), options })));
      expect(missing).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure",
        cause: { type: "not_found", message: "Currency code not found: missing-b, missing-a" } } });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), read, { query: query("missing") })))
        .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events);
    } finally { await Effect.runPromise(host.close); }
  }, 240_000);
});

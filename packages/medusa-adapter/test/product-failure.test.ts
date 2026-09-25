import { Cause, Effect } from "effect";
import { expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner } from "./support/logical-product-runner";

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

// Inspect only the error/cause chain, never SQL text or argument values.
function hasStatementCancellation(error: unknown): boolean {
  if (Cause.isCause(error)) return error.reasons.some(reason =>
    Cause.isFailReason(reason) && hasStatementCancellation(reason.error));
  return isNonArrayRecord(error) && (error.code === "57014" || hasStatementCancellation(error.cause));
}

productIntegrationTestRunner({ moduleName: "product", testSuite: () => {
  it.each(["row", "outcome"] as const)("preserves a shared %s statement cancellation and rolls back the complete command", async stage => {
    const { currency, product, writer, root, commands } = getLogicalProductRunnerFixture();
    const schemaRows = await currency.persistence.query<{ schema: string }>("select current_schema() as schema");
    const schemaName = schemaRows.rows[0]?.schema;
    if (schemaName === undefined) throw new Error("Missing logical fixture schema");
    const schema = quote(schemaName);
    const target = schema + "." + quote(stage === "row" ? "fx_app_row_current" : "fx_system_idempotency");
    const before = await logicalCurrencyInventory(currency);
    // PostgreSQL exercises the real statement deadline. PGlite reports the
    // same server SQLSTATE without blocking its synchronous Wasm worker.
    const fail = "pool" in currency.persistence ? "perform pg_sleep(2);" : "raise exception 'injected statement cancellation' using errcode = '57014';";
    await currency.persistence.exec(`create sequence ${schema}.fx_failure_calls`);
    await currency.persistence.exec(`create function ${schema}.fx_statement_fail() returns trigger language plpgsql as $$ begin
      perform nextval('${schema}.fx_failure_calls'); ${fail} return NEW; end $$`);
    await currency.persistence.exec(`create trigger fx_statement_fail before insert on ${target} for each row execute function ${schema}.fx_statement_fail()`);
    const key = writer.newRequestKey();
    const input = { id: `failure-${stage}`, title: `Failure ${stage}` };
    const slot = commands.indexOf(product.runtime.commands.create);
    if (slot < 0) throw new Error("Missing Product create command");
    const request = { slot, input };
    try {
      const error = await Effect.runPromise(Effect.flip(writer.run(key, root, request)));
      expect(error.reason).toBe("statementFailure");
      expect(hasStatementCancellation(error)).toBe(true);
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
      // Sequences survive rollback: exactly one trigger visit proves that the
      // failed statement was not automatically replayed inside this request.
      expect((await currency.persistence.query(`select last_value::text as count, is_called from ${schema}.fx_failure_calls`)).rows).toEqual([{ count: "1", is_called: true }]);
    } finally {
      await currency.persistence.exec(`drop trigger fx_statement_fail on ${target}`);
      await currency.persistence.exec(`drop function ${schema}.fx_statement_fail()`);
      await currency.persistence.exec(`drop sequence ${schema}.fx_failure_calls`);
    }
    const created = await Effect.runPromise(writer.run(key, root, request));
    const after = await logicalCurrencyInventory(currency);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(after.events).toHaveLength(before.events.length + 1);
    expect(await Effect.runPromise(writer.run(key, root, request))).toEqual(created);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
  });
} });

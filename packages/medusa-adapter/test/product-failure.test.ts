import { Cause, Effect } from "effect";
import { expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { getProductRunnerFixture, productIntegrationTestRunner, takeProductRunnerEvents } from "./support/product-runner";

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

// Inspect only the error/cause chain, never SQL text or argument values.
function hasStatementCancellation(error: unknown): boolean {
  if (Cause.isCause(error)) return error.reasons.some(reason =>
    Cause.isFailReason(reason) && hasStatementCancellation(reason.error));
  return isNonArrayRecord(error) && (error.code === "57014" || hasStatementCancellation(error.cause));
}

productIntegrationTestRunner({ moduleName: "product", testSuite: () => {
  it.each(["product", "outcome"] as const)("preserves a %s statement cancellation and rolls back the complete command", async stage => {
    const { fixture, runtime } = getProductRunnerFixture();
    const layout = fixture.descriptor.layout.frame;
    const product = layout.tables.find(table => table.identity.tableId === "product");
    if (product === undefined) throw new Error("Missing Product table");
    const schema = quote(layout.targetNamespace.schemaName);
    const target = schema + "." + quote(stage === "product" ? product.name : "fx_system_idempotency");
    const before = await commerceInventory(fixture);
    // PostgreSQL exercises the real, unchanged statement deadline. PGlite uses
    // the same server SQLSTATE without blocking its synchronous Wasm worker.
    const fail = "pool" in fixture.persistence ? "perform pg_sleep(2);" : "raise exception 'injected statement cancellation' using errcode = '57014';";
    await fixture.persistence.exec(`create sequence ${schema}.fx_failure_calls`);
    await fixture.persistence.exec(`create function ${schema}.fx_statement_fail() returns trigger language plpgsql as $$ begin
      perform nextval('${schema}.fx_failure_calls'); ${fail} return NEW; end $$`);
    await fixture.persistence.exec(`create trigger fx_statement_fail before insert on ${target} for each row execute function ${schema}.fx_statement_fail()`);
    const key = fixture.host.newRequestKey();
    const input = { id: `failure-${stage}`, title: `Failure ${stage}` };
    try {
      const error = await Effect.runPromise(Effect.flip(fixture.host.run(key, runtime.commands.create, input)));
      expect(error.reason).toBe(stage === "product" ? "rollbackOnly" : "statementFailure");
      expect(hasStatementCancellation(error)).toBe(true);
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toEqual([]);
      expect(fixture.takeDeliveries()).toEqual([]);
      // Sequences survive rollback: exactly one trigger visit proves that the
      // failed statement was not automatically replayed inside this request.
      expect((await fixture.persistence.query(`select last_value::text as count, is_called from ${schema}.fx_failure_calls`)).rows).toEqual([{ count: "1", is_called: true }]);
    } finally {
      await fixture.persistence.exec(`drop trigger fx_statement_fail on ${target}`);
      await fixture.persistence.exec(`drop function ${schema}.fx_statement_fail()`);
      await fixture.persistence.exec(`drop sequence ${schema}.fx_failure_calls`);
    }
    const created = await Effect.runPromise(fixture.host.run(key, runtime.commands.create, input));
    expect(takeProductRunnerEvents()).toHaveLength(1);
    const after = await commerceInventory(fixture);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(await Effect.runPromise(fixture.host.run(key, runtime.commands.create, input))).toEqual(created);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
} });

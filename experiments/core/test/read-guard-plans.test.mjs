import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { Result } from "effect";
import { it, vi } from "vitest";
import { compileDefinition } from "../src/definition.ts";
import { createReadGuards } from "../src/read-guards.ts";
import * as schema from "../src/schema.ts";

it("reuses Drizzle lowering but dispatches every guard with fresh request parameters", async () => {
  // Mechanical plan witness only: this transport always returns no authority.
  // Real grants, row locks, expiry and visibility require the database suites.
  const dispatches = [];
  const database = drizzle({ query: async (query, parameters) => { dispatches.push({ text: query.text, name: query.name, parameters }); return { rows: [] }; } }, { schema });
  const definition = Result.getOrThrow(compileDefinition({ table: "tasks", tableId: 7, fields: [{ name: "name", kind: "text", unique: false }] }));
  const guards = createReadGuards(); const compilation = vi.spyOn(PgDialect.prototype, "sqlToQuery");
  try {
    for (const [scope, id] of [["shop-a", "first"], ["shop-b", "second"]]) {
      const prior = compilation.mock.calls.length;
      assert.deepEqual(await guards.authority(database, scope, [definition]), []);
      assert.deepEqual(await guards.command(database, scope, [definition], id), []);
      assert.deepEqual(await guards.snapshot(database, scope, [definition], new Date(id === "first" ? 0 : 60_000)), []);
      assert.equal(compilation.mock.calls.length - prior, id === "first" ? 3 : 0);
    }
    assert.equal(dispatches.length, 6);
    assert.ok(dispatches.every(dispatch => dispatch.name === ""), "Prepared plans keep the unnamed server protocol");
    for (const dispatch of dispatches.slice(3)) assert.ok(dispatch.parameters.includes("shop-b"));
    assert.ok(dispatches[4].parameters.includes("second"));
    assert.ok(dispatches[5].parameters.some(value => value instanceof Date && value.getTime() === 60_000));
    assert.equal(dispatches.every(dispatch => dispatch.text.includes('for share')), true);
  } finally { compilation.mockRestore(); }
});

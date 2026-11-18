import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Exit, Scope } from "effect";
import { it } from "vitest";
import { compileDefinition } from "../src/definition.ts";
import { createApplicationHost } from "../src/application.ts";
import { createApplicationStorage } from "../src/application-storage.ts";
import { scalingFunctions } from "./scaling-corpus.ts";
import { fixture } from "./fixture.ts";
import { install } from "./measurement-fixture.mjs";

it.each([1, 16, 64])("preserves the actual SDK overlay and ordinary-field control on PGlite at %s rows", async count => {
  const database = await fixture(); const scope = await Effect.runPromise(Scope.make());
  try {
    const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 7,
      fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }, { name: "note", kind: "text", unique: false }],
      indexes: [{ name: "by_priority", field: "priority" }] })));
    await install(database, [definition]);
    const host = await Effect.runPromise(createApplicationHost(definition, createApplicationStorage(database.persistence), "shop-a", scalingFunctions)
      .pipe(Effect.provideService(Scope.Scope, scope)));
    const result = await Effect.runPromise(host.mutate("overlay", randomUUID(), { count, stem: "corpus" }));
    const all = (await Effect.runPromise(host.query("range", { lower: 0, upper: 2000 }))).value;
    assert.equal(all.length, count - Math.floor((count + 1) / 4));
    assert.deepEqual(result.value.rows, all.filter(row => row.priority < count));
    for (let index = 0; index < count; index++) {
      const row = (await Effect.runPromise(host.query("point", { id: result.value.ids[index] }))).value;
      if (index % 4 === 2) assert.equal(row, null);
      else {
        assert.deepEqual(Object.keys(row).toSorted(), ["_id", "_creationTime", "name", "priority", "note"].toSorted());
        assert.equal(row.name, index % 4 === 1 ? `corpus-edited-${index}` : `corpus-${index}`);
        assert.equal(row.priority, index % 4 === 0 ? count + index : index); assert.equal(row.note, "original");
      }
    }
    const ids = all.map(row => row._id);
    await Effect.runPromise(host.mutate("edit", randomUUID(), { ids, indexed: false, stem: "plain" }));
    const ordinary = (await Effect.runPromise(host.query("range", { lower: 0, upper: 2000 }))).value;
    assert.deepEqual(ordinary, all.map((row, index) => ({ ...row, note: `plain-edited-${index}` })));
    await Effect.runPromise(host.mutate("edit", randomUUID(), { ids, indexed: true, stem: "indexed" }));
    const indexed = (await Effect.runPromise(host.query("range", { lower: 1000, upper: 1000 + ids.length }))).value;
    assert.deepEqual(indexed, ordinary.map((row, index) => ({ ...row, priority: 1000 + index })));
  } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
});

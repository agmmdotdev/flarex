import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Exit, Scope } from "effect";
import { it } from "vitest";
import { createProductHost } from "../src/medusa-product.ts";
import { createRoot } from "../src/root.ts";
import * as tables from "../src/schema.ts";
import { fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import { nativeProductFixture } from "./native-product.mjs";

it.skipIf(process.env.FLAREX_EXPERIMENT_PRODUCT_COMPARE !== "1")("compares genuine native and experimental scalar Product update", async () => {
  const postgres = await startPostgres(); const scope = await Effect.runPromise(Scope.make());
  let native, candidate, bodyFailure;
  try {
    native = await nativeProductFixture(postgres.connectionString); candidate = await fixture(postgres.connectionString);
    const host = await Effect.runPromise(createProductHost(candidate.storage, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
    const definition = host.prepared.definition;
    await candidate.admin(db => db.insert(tables.definitions).values({ table: definition.table, version: definition.version, fields: definition.fields }));
    const id = `prod_${randomUUID()}`;
    await native.product.createProducts({ id, title: "original", handle: id.replaceAll("_", "-") });
    await Effect.runPromise(Effect.gen(function* () {
      const command = yield* candidate.storage.open("shop-a", randomUUID(), "fixture", definition, randomUUID());
      const root = yield* createRoot(definition, candidate.storage, command);
      yield* root.insert(yield* host.prepared.seed(id, "original", "2026-10-27T00:00:00.000Z"));
      const frozen = yield* root.freeze(); yield* candidate.storage.settle(command, frozen.changes, frozen.dependencies, null, frozen.events);
    }));
    const reference = JSON.parse(JSON.stringify(await native.product.updateProducts(id, { title: "updated" })));
    const result = await Effect.runPromise(host.update(randomUUID(), id, { title: "updated" }));
    // Timestamps are separately validated observations, not equal clocks across
    // independent installations. Every other returned key/value must match.
    const withoutTime = value => {
      assert.equal(typeof value.created_at, "string"); assert.ok(Number.isFinite(Date.parse(value.created_at)));
      assert.equal(typeof value.updated_at, "string"); assert.ok(Number.isFinite(Date.parse(value.updated_at)));
      const { created_at: _created, updated_at: _updated, ...fields } = value; return fields;
    };
    assert.deepEqual(withoutTime(result), withoutTime(reference));
    assert.equal((await native.product.retrieveProduct(id)).title, "updated");
    assert.equal((await Effect.runPromise(candidate.storage.read("shop-a", definition, id))).title, "updated");
  } catch (cause) { bodyFailure = cause; throw cause; }
  finally {
    const results = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void)), native?.close(), candidate?.close()]);
    const closed = await Promise.allSettled([postgres.close()]);
    const failures = [...results, ...closed].filter(result => result.status === "rejected");
    if (failures.length !== 0) throw new AggregateError([...(bodyFailure === undefined ? [] : [bodyFailure]), ...failures.map(result => result.reason)], "Product comparison cleanup failed", { cause: bodyFailure });
  }
}, 600_000);

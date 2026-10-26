import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Scope } from "effect";
import { it } from "vitest";
import { createProductHost } from "../src/medusa-product.ts";
import { createRoot } from "../src/root.ts";
import { frameworkCandidate } from "../src/group-storage.ts";
import * as tables from "../src/schema.ts";
import { fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import { nativeProductFixture } from "./native-product.mjs";

it.skipIf(process.env.FLAREX_EXPERIMENT_PRODUCT_COMPARE !== "1")("compares complete genuine native and experimental Product update/retrieve/list", async () => {
  const postgres = await startPostgres(); const scope = await Effect.runPromise(Scope.make());
  let native, candidate, bodyFailure;
  try {
    native = await nativeProductFixture(postgres.connectionString); candidate = await fixture(postgres.connectionString);
    const host = await Effect.runPromise(createProductHost(candidate.persistence, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
    const definition = host.prepared.definition;
    await candidate.admin(db => db.insert(tables.definitions).values({ table: definition.table, version: definition.version, fields: definition.fields, equalities: definition.equalities }));
    const id = `prod_${randomUUID()}`;
    await native.product.createProducts({ id, title: "original", handle: id.replaceAll("_", "-") });
    await Effect.runPromise(Effect.gen(function* () {
      const command = yield* candidate.persistence.openCommand("framework", "shop-a", randomUUID(), "fixture", definition, randomUUID());
      const root = yield* createRoot(definition, candidate.storage, command);
      yield* root.insert(yield* host.prepared.seed(id, "original", "2026-10-27T00:00:00.000Z"));
      const frozen = yield* root.freeze(); yield* candidate.commands.accept(command, [frameworkCandidate(definition, frozen)], null);
    }));
    const data = { title: "updated", handle: "updated-handle", status: "published" };
    const reference = JSON.parse(JSON.stringify(await native.product.updateProducts(id, data)));
    const result = await Effect.runPromise(host.update(randomUUID(), id, data));
    // Timestamps are separately validated observations, not equal clocks across
    // independent installations. Every other returned key/value must match.
    const withoutTime = value => {
      assert.equal(typeof value.created_at, "string"); assert.ok(Number.isFinite(Date.parse(value.created_at)));
      assert.equal(typeof value.updated_at, "string"); assert.ok(Number.isFinite(Date.parse(value.updated_at)));
      const { created_at: _created, updated_at: _updated, ...fields } = value; return fields;
    };
    assert.deepEqual(withoutTime(result), withoutTime(reference));
    const referenceRead = JSON.parse(JSON.stringify(await native.product.retrieveProduct(id)));
    const read = await Effect.runPromise(host.retrieve(id));
    const referenceList = JSON.parse(JSON.stringify(await native.product.listProducts({ handle: data.handle })));
    const listed = await Effect.runPromise(host.listByHandle(data.handle));
    assert.deepEqual(withoutTime(read), withoutTime(referenceRead));
    assert.deepEqual(listed.map(withoutTime), referenceList.map(withoutTime));
    assert.deepEqual(await Effect.runPromise(host.listByHandle(id.replaceAll("_", "-"))), []);
    const next = { title: "pending-graph", handle: "pending-handle", status: "published" };
    const nextReference = JSON.parse(JSON.stringify(await native.product.updateProducts(id, next)));
    const graph = await Effect.runPromise(host.graph(randomUUID(), id, next));
    assert.deepEqual(withoutTime(graph.updated), withoutTime(nextReference));
    assert.deepEqual(withoutTime(graph.retrieved), withoutTime(JSON.parse(JSON.stringify(await native.product.retrieveProduct(id)))));
    const nextList = JSON.parse(JSON.stringify(await native.product.listProducts({ handle: next.handle })));
    assert.deepEqual(graph.listed.map(withoutTime), nextList.map(withoutTime));
    const duplicate = `prod_${randomUUID()}`;
    await native.product.createProducts({ id: duplicate, title: "other", handle: duplicate.replaceAll("_", "-") });
    await Effect.runPromise(Effect.gen(function* () {
      const command = yield* candidate.persistence.openCommand("framework", "shop-a", randomUUID(), "duplicate-fixture", definition, randomUUID());
      const pending = yield* createRoot(definition, candidate.storage, command);
      yield* pending.insert(yield* host.prepared.seed(duplicate, "other", "2026-10-27T00:00:00.000Z"));
      yield* candidate.commands.accept(command, [frameworkCandidate(definition, yield* pending.freeze())], null);
    }));
    await assert.rejects(native.product.updateProducts(duplicate, { handle: next.handle }), { type: "invalid_data" });
    const failed = await Effect.runPromiseExit(host.update(randomUUID(), duplicate, { handle: next.handle }));
    assert.ok(Exit.isFailure(failed)); const error = Cause.findErrorOption(failed.cause);
    assert.equal(error._tag, "Some"); assert.equal(error.value._tag, "NativeFailure"); assert.equal(error.value.cause.type, "invalid_data");
    assert.deepEqual(withoutTime(await Effect.runPromise(host.retrieve(duplicate))),
      withoutTime(JSON.parse(JSON.stringify(await native.product.retrieveProduct(duplicate)))));
  } catch (cause) { bodyFailure = cause; throw cause; }
  finally {
    const results = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void)), native?.close(), candidate?.close()]);
    const closed = await Promise.allSettled([postgres.close()]);
    const failures = [...results, ...closed].filter(result => result.status === "rejected");
    if (failures.length !== 0) throw new AggregateError([...(bodyFailure === undefined ? [] : [bodyFailure]), ...failures.map(result => result.reason)], "Product comparison cleanup failed", { cause: bodyFailure });
  }
}, 600_000);

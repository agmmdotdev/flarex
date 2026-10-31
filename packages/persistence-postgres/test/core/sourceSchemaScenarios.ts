import { randomBytes } from "node:crypto";
import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type { CoreDatabase, CoreSchemaProposal } from "../../src/core/api";
import { openCoreDatabase } from "../../src/core/database";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const options = { now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS };
const object = (field: string, validator: ValidatorJsonV1): ValidatorJsonV1 => ({ type: "object",
  value: { [field]: { fieldType: validator, optional: false } } });
const declaration = (documentType: ValidatorJsonV1, stagedDocumentType?: ValidatorJsonV1) => ({
  tables: [{ tableName: "items", indexes: [], documentType,
    ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }], schemaValidation: true,
});
const union: ValidatorJsonV1 = { type: "union", value: [object("value", { type: "string" }), object("other", { type: "number" })] };
const finish = Effect.fn("CoreSourceSchemaFixture.finish")(function* (database: CoreDatabase, proposal: CoreSchemaProposal) {
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if (status.state === "failed" || status.state === "validated" || status.state === "active") return status;
    yield* database.advanceSchema(proposal, { pageSize: 2, maxPages: 2 });
  }
  return yield* Effect.die(new Error("Source schema proposal did not finish within its test allowance."));
});
const idle = Effect.fn("CoreSourceSchemaFixture.idle")(function* (database: CoreDatabase) {
  for (let step = 0; step < 512; step++)
    if (!(yield* database.advanceSchemaWork({ pageSize: 2, maxPages: 2 })).hasMore) return;
  return yield* Effect.die(new Error("Source schema work did not become idle within its test allowance."));
});

export function registerCoreSourceSchemaScenarios(label: string,
  createFixture: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("walks populated object unions, retains active enforcement across cold reopen and rejects proposed-only violations", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, declaration({ type: "any" }));
        const seed = yield* database.begin();
        const first = yield* seed.insert("items", { value: "existing" });
        yield* seed.insert("items", { other: 1 });
        yield* database.commit(yield* seed.finalize());
        const proposal = yield* database.prepareSchema({ schema: declaration(union) });
        expect((yield* database.schemaStatus(proposal)).state).toBe("pending");
        expect((yield* finish(database, proposal)).state).toBe("validated");
        yield* database.activateSchema(proposal, { programs: [] });
        yield* database.close();
        const persistence = yield* Effect.promise(() => fixture.reopen());
        const reopened = yield* openCoreDatabase(persistence, options);
        const read = yield* reopened.begin();
        expect(Option.getOrThrow(yield* read.get(first))).toMatchObject({ value: "existing" });
        yield* read.abort();
        const rejected = yield* reopened.begin();
        expect(yield* Effect.result(rejected.insert("items", { absent: true })))
          .toMatchObject({ failure: { reason: "documentValidation" } });
        yield* rejected.abort();
        const narrowing = yield* reopened.prepareSchema({ schema: declaration(object("value", { type: "string" })) });
        const allowed = yield* reopened.begin();
        yield* allowed.insert("items", { other: 2 });
        yield* reopened.commit(yield* allowed.finalize());
        expect(yield* reopened.schemaStatus(narrowing)).toMatchObject({ state: "failed", tableName: "items" });
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("does not reuse a populated staged union proof after singleton normalization narrows its allowed documents", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, declaration({ type: "any" }));
        const seed = yield* database.begin();
        yield* seed.insert("items", { value: "existing" }); yield* seed.insert("items", { other: 1 });
        yield* database.commit(yield* seed.finalize());
        const wide = yield* database.prepareSchema({ schema: declaration({ type: "any" }, union) });
        yield* idle(database); yield* database.activateSchema(wide, { programs: [] });
        const singleton: ValidatorJsonV1 = { type: "union", value: [object("value", { type: "string" })] };
        const narrow = yield* database.prepareSchema({ schema: declaration({ type: "any" }, singleton) });
        yield* idle(database); yield* database.activateSchema(narrow, { programs: [] });
        const promotion = yield* database.prepareSchema({ schema: declaration(singleton) });
        expect(yield* finish(database, promotion)).toMatchObject({ state: "failed", tableName: "items" });
        const active = yield* database.begin();
        expect(Result.isSuccess(yield* Effect.result(active.insert("items", { other: 3 })))).toBe(true);
        yield* active.abort();
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("persists Function signatures and CommitTs while matching existing string and int64 values after cold reopen", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const validator: ValidatorJsonV1 = { type: "object", value: {
          handle: { fieldType: { type: "function", fnType: "query", args: object("target", { type: "id", tableName: "signatureOnly" }) }, optional: false },
          timestamp: { fieldType: { type: "commitTs" }, optional: false },
        } };
        yield* activateCoreSchema(database, declaration({ type: "any" }));
        const seed = yield* database.begin(); const target = yield* seed.insert("items", {});
        yield* database.commit(yield* seed.finalize());
        const clean = yield* database.begin(); yield* clean.delete(target); yield* database.commit(yield* clean.finalize());
        yield* activateCoreSchema(database, declaration(validator));
        const value = { handle: `function://${target}#advisory`, timestamp: 0x7fff_ffff_ffff_ffffn };
        const insert = yield* database.begin(); const id = yield* insert.insert("items", value);
        yield* database.commit(yield* insert.finalize());
        yield* database.close();
        const persistence = yield* Effect.promise(() => fixture.reopen());
        const reopened = yield* openCoreDatabase(persistence, options);
        const read = yield* reopened.begin(); expect(Option.getOrThrow(yield* read.get(id))).toMatchObject(value); yield* read.abort();
        for (const invalid of [{ ...value, timestamp: 1 }, { ...value, handle: "function://invalid" }]) {
          const rejected = yield* reopened.begin();
          expect(yield* Effect.result(rejected.insert("items", invalid))).toMatchObject({ failure: { reason: "documentValidation" } });
          yield* rejected.abort();
        }
      }))); } finally { await fixture.close(); }
    }, 60_000);
  });
}

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
const object = (fieldType: ValidatorJsonV1): ValidatorJsonV1 => ({ type: "object",
  value: { value: { fieldType, optional: false } } });
const declaration = (documentType: ValidatorJsonV1, stagedDocumentType?: ValidatorJsonV1) => ({
  tables: [{ tableName: "items", indexes: [], documentType,
    ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }], schemaValidation: true,
});
const idle = Effect.fn("CoreLiteralSchemaFixture.idle")(function* (database: CoreDatabase) {
  for (let step = 0; step < 512; step++)
    if (!(yield* database.advanceSchemaWork({ pageSize: 2, maxPages: 2 })).hasMore) return;
  return yield* Effect.die(new Error("Literal schema work exceeded its bounded test allowance."));
});
const finish = Effect.fn("CoreLiteralSchemaFixture.finish")(function* (database: CoreDatabase, proposal: CoreSchemaProposal) {
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if (status.state === "failed" || status.state === "validated" || status.state === "active") return status;
    yield* database.advanceSchema(proposal, { pageSize: 2, maxPages: 2 });
  }
  return yield* Effect.die(new Error("Literal schema proposal exceeded its bounded test allowance."));
});

export function registerCoreLiteralSchemaScenarios(label: string,
  createFixture: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("enforces exact int64/float literal values and reconstructs the schema after cold reopen", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const validator: ValidatorJsonV1 = { type: "object", value: {
          integer: { fieldType: { type: "union", value: [
            { type: "literal", value: -0x8000_0000_0000_0000n }, { type: "literal", value: 0x7fff_ffff_ffff_ffffn },
          ] }, optional: false },
          zero: { fieldType: { type: "literal", value: -0 }, optional: false },
        } };
        yield* activateCoreSchema(database, declaration(validator));
        const inserted: string[] = [];
        for (const integer of [-0x8000_0000_0000_0000n, 0x7fff_ffff_ffff_ffffn]) {
          const transaction = yield* database.begin();
          inserted.push(yield* transaction.insert("items", { integer, zero: -0 }));
          yield* database.commit(yield* transaction.finalize());
        }
        for (const body of [{ integer: 0x7fff_ffff_ffff_ffffn, zero: 0 },
          { integer: Number(0x7fff_ffff_ffff_ffffn), zero: -0 }, { integer: 1n, zero: -0 }]) {
          const transaction = yield* database.begin();
          expect(yield* Effect.result(transaction.insert("items", body)))
            .toMatchObject({ failure: { _tag: "CoreTransactionError", reason: "documentValidation" } });
          yield* transaction.abort();
        }
        yield* database.close();
        const persistence = yield* Effect.promise(() => fixture.reopen());
        const reopened = yield* openCoreDatabase(persistence, options);
        const read = yield* reopened.begin();
        for (const [index, expected] of [-0x8000_0000_0000_0000n, 0x7fff_ffff_ffff_ffffn].entries()) {
          const id = inserted[index];
          if (id === undefined) return yield* Effect.die(new Error("Missing inserted literal document ID."));
          const document = Option.getOrThrow(yield* read.get(id));
          expect(document.integer).toBe(expected);
          expect(Object.is(document.zero, -0)).toBe(true);
        }
        yield* read.abort();
        const invalid = yield* reopened.begin();
        expect(yield* Effect.result(invalid.insert("items", { integer: 0x7fff_ffff_ffff_ffffn, zero: 0 })))
          .toMatchObject({ failure: { reason: "documentValidation" } });
        yield* invalid.abort();
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("walks a signed-zero narrowing instead of treating the active schema as identical", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, declaration(object({ type: "literal", value: 0 })));
        const seed = yield* database.begin(); yield* seed.insert("items", { value: 0 });
        yield* database.commit(yield* seed.finalize());
        const proposal = yield* database.prepareSchema({ schema: declaration(object({ type: "literal", value: -0 })) });
        expect((yield* database.schemaStatus(proposal)).state).toBe("pending");
        expect(yield* finish(database, proposal)).toMatchObject({ state: "failed", tableName: "items" });
        const surviving = yield* database.begin();
        expect(Result.isSuccess(yield* Effect.result(surviving.insert("items", { value: 0 })))).toBe(true);
        yield* surviving.abort();
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("does not reuse a completed staged positive-zero proof for negative zero", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, declaration({ type: "any" }));
        const seed = yield* database.begin(); yield* seed.insert("items", { value: 0 });
        yield* database.commit(yield* seed.finalize());
        const positive = yield* database.prepareSchema({ schema: declaration({ type: "any" }, object({ type: "literal", value: 0 })) });
        yield* idle(database);
        yield* database.activateSchema(positive, { programs: [] });
        const negative = yield* database.prepareSchema({ schema: declaration({ type: "any" }, object({ type: "literal", value: -0 })) });
        yield* idle(database);
        yield* database.activateSchema(negative, { programs: [] });
        const promotion = yield* database.prepareSchema({ schema: declaration(object({ type: "literal", value: -0 })) });
        expect(yield* finish(database, promotion)).toMatchObject({ state: "failed", tableName: "items" });
      }))); } finally { await fixture.close(); }
    }, 60_000);
  });
}
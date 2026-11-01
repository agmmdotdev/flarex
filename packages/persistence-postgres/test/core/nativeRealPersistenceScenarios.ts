import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileTaxCoreDefinition } from "../../../medusa-adapter/src/modules/tax/schema";
import type { CoreDatabase, CoreDatabaseOptions } from "../../src/core/api";
import { CorePersistenceError } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "a4000000-0000-4000-8000-000000000001", epochUuid: "a4000000-0000-4000-8000-000000000002" };
const samples = Object.freeze([
  { id: "positive-midpoint", submitted: 91001.53515625, stored: 91001.53 },
  { id: "negative-midpoint", submitted: -91001.53515625, stored: -91001.53 },
  { id: "decimal-double-rounding", submitted: 1.0000000596046448, stored: 1.0000001 },
  { id: "asymmetric-interval", submitted: 1.262177448353619e-29, stored: 1.2621775e-29 },
  { id: "strict-open-boundary", submitted: 230198584, stored: 230198590 },
  { id: "integer-rounding", submitted: 16777217, stored: 16777216 },
]);

export function registerNativeRealPersistenceScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(`portable native REAL Core persistence on ${label}`, () => {
    it("stores portable values through native writes and restores them after closing the complete Core owner", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const definition = yield* compileTaxCoreDefinition(target);
          const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
          const options: CoreDatabaseOptions = { schemaBundles: [bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
            now: Effect.succeed(2_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)) };
          const table = (localName: string) => {
            const declaration = definition.tables.find(table => table.localName === localName);
            if (declaration === undefined) throw new Error("Missing genuine native REAL source table");
            return declaration.name;
          };
          const bind = (database: CoreDatabase) => database.bindNative({ definition,
            commands: [{ name: "real-store", mode: "write" }, { name: "real-read", mode: "read" }] });
          yield* Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(fixture.persistence, options), database => Effect.gen(function* () {
            const proposal = yield* database.prepareSchema({ bundle });
            let activated = false;
            for (let step = 0; step < 256; step++) {
              const status = yield* database.schemaStatus(proposal);
              if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
                yield* database.activateSchema(proposal, { programs: [], bundle }); activated = true; break;
              }
              if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`REAL schema ${status.state}`));
              yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
            }
            if (!activated) return yield* Effect.die(new Error("REAL source installation exceeded its bounded fixture work"));
            const binding = yield* bind(database);
            yield* Effect.acquireUseRelease(database.beginNative(binding, { commandName: "real-store", ...coreNativeTestBudget() }),
              operation => Effect.gen(function* () {
                yield* operation.operations.writeRows(table("tax_region"), "insert", [{ id: "region", country_code: "us" }]);
                const written = yield* operation.operations.writeRows(table("tax_rate"), "insert", samples.map(sample => ({
                  id: sample.id, code: sample.id, name: sample.id, tax_region_id: "region", rate: sample.submitted,
                })));
                expect(written.map(row => row.rate)).toEqual(samples.map(sample => sample.stored));
                yield* database.commit(yield* operation.finalize());
              }), operation => operation.abort());
            yield* Effect.acquireUseRelease(database.beginNative(binding, { commandName: "real-store", ...coreNativeTestBudget() }),
              operation => Effect.gen(function* () {
                const failed = yield* Effect.result(operation.operations.writeRows(table("tax_rate"), "insert", [{
                  id: "underflow", code: "underflow", name: "Underflow", tax_region_id: "region", rate: 1e-46,
                }]));
                expect(Result.isFailure(failed)).toBe(true);
              }), operation => operation.abort());
          }), database => database.close()));

          const persistence = yield* Effect.tryPromise({ try: () => fixture.reopen(),
            catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
          yield* Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, options), database => Effect.gen(function* () {
            const binding = yield* bind(database);
            yield* Effect.acquireUseRelease(database.beginNative(binding, { commandName: "real-read", ...coreNativeTestBudget() }),
              operation => Effect.gen(function* () {
                for (const sample of samples) {
                  const rows = yield* operation.operations.find(table("tax_rate"), { id: sample.id });
                  expect(rows).toHaveLength(1);
                  expect(rows[0]?.rate).toBe(sample.stored);
                }
                expect(yield* operation.operations.find(table("tax_rate"), { id: "underflow" })).toHaveLength(0);
                yield* operation.finishRead();
              }), operation => operation.abort());
          }), database => database.close()));
        })));
      } finally { await fixture.close(); }
    }, 120_000);
  });
}

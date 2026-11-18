import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import type { RelationalColumnDefinition, RelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileCurrencyCoreDefinition, currencySourceProvenance } from "../../../medusa-adapter/src/modules/currency/schema";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreNativeDefinition, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CoreDatabase, CoreError, CoreSchemaProposal } from "../../src/core/api";
import type { CoreDocumentLogEntry, CorePersistence } from "../../src/core/contracts";
import { readDocumentObject } from "../../src/core/registry";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";

const target = { scopeUuid: "74bd6a8e-8dd1-414b-9515-0f342e8c5762", epochUuid: "e56ca002-c0b7-4881-8105-a8d7c23cf70d" };
const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const sources = Effect.fn("NativeSchemaBundleLifecycle.sources")(function* (extra = false) {
  const application = yield* prepareApplicationSchemaSource(defineSchema({
    users: defineTable({ name: v.string() }).index("by_name", ["name"]),
  }));
  const compiled = yield* compilePayloadCollections([{ slug: "posts", fields: [
    { name: "title", type: "text", required: true }, ...(extra ? [{ name: "summary", type: "text" }] : []),
  ] }]);
  const payload = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
  const currency = yield* compileCurrencyCoreDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: application },
    { kind: "native", definition: payload }, { kind: "native", definition: currency }] });
  return { application, payload, currency, bundle };
});
const ready = Effect.fn("NativeSchemaBundleLifecycle.ready")(function* (database: CoreDatabase,
  proposal: CoreSchemaProposal, bundle: CoreSchemaBundle) {
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady)
      return yield* database.activateSchema(proposal, { programs: [], bundle });
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Bundle schema ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Bundle schema did not become ready"));
});
function failure<Value>(result: Result.Result<Value, CoreError>) { return Result.isFailure(result) ? result.failure : undefined; }

export function registerNativeSchemaBundleLifecycleScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("resumes genuine interrupted three-source installation and preserves the ready bundle on changed-source refusal", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* sources(), changed = yield* sources(true);
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence,
          { ...options, schemaBundles: [first.bundle, changed.bundle] }), db => db.close());
        const proposal = yield* database.prepareSchema({ bundle: first.bundle });
        yield* database.close();
        const rebuilt = yield* sources();
        expect(rebuilt.bundle.metadata).toBe(first.bundle.metadata);
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()),
          { ...options, schemaBundles: [rebuilt.bundle, changed.bundle] }), db => db.close());
        expect(yield* reopened.prepareSchema({ bundle: rebuilt.bundle })).toEqual(proposal);
        const active = yield* ready(reopened, proposal, rebuilt.bundle);
        expect(active.tables).toHaveLength(3);
        const before = yield* reopened.publishedTimestamp;
        expect(yield* reopened.prepareSchema({ bundle: rebuilt.bundle })).toEqual(proposal);
        yield* ready(reopened, proposal, rebuilt.bundle);
        expect(yield* reopened.publishedTimestamp).toBe(before);
        const payloadBinding = yield* reopened.bindNative({ definition: rebuilt.payload });
        expect((yield* reopened.readNativeBinding(payloadBinding)).definition.identity).toEqual(first.payload.identity);
        expect(failure(yield* Effect.result(reopened.bindNative({ definition: rebuilt.currency }))))
          .toMatchObject({ reason: "invalidValue" });
        const currencyBinding = yield* reopened.bindNative({ definition: rebuilt.currency,
          commands: [{ name: "currencyAnnouncementWrite", mode: "write" }] });
        expect((yield* reopened.readNativeBinding(currencyBinding)).tables[0]?.name).toBe(rebuilt.currency.tables[0]?.name);
        const registry = yield* readCoreFixtureRegistry(fixture, before);
        expect(registry.table("users")?.definition.nativePolicy).toBeUndefined();
        expect(registry.head("users:create")).toBeUndefined();
        expect(failure(yield* Effect.result(reopened.prepareSchema({ bundle: changed.bundle }))))
          .toMatchObject({ reason: "unsupportedCapability" });
        expect((yield* reopened.schemaStatus(proposal)).state).toBe("active");
        expect(yield* reopened.publishedTimestamp).toBe(before);
        const tables = yield* Effect.promise(() => fixture.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name", [fixture.namespace]));
        expect(tables).toEqual(["documents", "indexes", "leases", "persistence_globals", "read_only"].map(table_name => ({ table_name })));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("refuses missing cold proof and a self-consistent rehashed native-default forgery", async () => {
      const fixture = await createFixture();
      const observed = new Map<string, Readonly<{ entry: CoreDocumentLogEntry; document: DocumentObject }>>();
      try {
        const installed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const selected = yield* sources();
          const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
            yield* fixture.persistence.write(lease, batch);
            for (const entry of batch.documents) {
              if (entry.deleted) continue;
              const document = yield* Effect.fromResult(readDocumentObject(entry));
              if (typeof document.native === "string") observed.set("schema", { entry, document });
              if (document.name === selected.currency.tables[0]?.name) observed.set("currency", { entry, document });
            }
          }) };
          const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { ...options, schemaBundles: [selected.bundle] }), db => db.close());
          const proposal = yield* database.prepareSchema({ bundle: selected.bundle });
          yield* ready(database, proposal, selected.bundle);
          const binding = yield* database.bindNative({ definition: selected.currency, commands: [{ name: "currencyAnnouncementWrite", mode: "write" }] });
          const table = (yield* database.readNativeBinding(binding)).tables[0];
          if (table?.nativePolicy === undefined) return yield* Effect.die(new Error("Missing Currency policy"));
          return { ...selected, table };
        })));
        const schemaRecord = observed.get("schema"), tableRecord = observed.get("currency");
        if (schemaRecord === undefined || tableRecord === undefined || installed.table.nativePolicy === undefined)
          throw new Error("Missing durable bundle observations");
        const missing = await Effect.runPromise(Effect.scoped(Effect.result(Effect.acquireRelease(
          openCoreDatabase(await fixture.reopen(), options), database => database.close()))));
        expect(failure(missing)).toMatchObject({ reason: "corruptData" });
        const genuineReopen = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const rebuilt = yield* sources();
          const database = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()),
            { ...options, schemaBundles: [rebuilt.bundle] }), db => db.close());
          return yield* database.publishedTimestamp;
        })));
        expect(genuineReopen).toBeGreaterThan(0n);
        const forged = await Effect.runPromise(Effect.gen(function* () {
          if (installed.currency.source.definition.kind !== "relational") return yield* Effect.die(new Error("Missing relational definition"));
          const original = installed.currency.source.definition.schema;
          const schema: RelationalSchema = { ...original, tables: original.tables.map(table => ({ ...table,
            columns: table.columns.map((column): RelationalColumnDefinition => column.identity.columnId === "rounding" ? { ...column,
              default: { kind: "exactNumericLiteral", value: "9007199254740992" } } : column.identity.columnId === "raw_rounding" ? { ...column,
              default: { kind: "exactNumericRawLiteral", value: "9007199254740992", precision: 20 } } : column) })) };
          const { sourceSha256: omittedDigest, ...sourceFrame } = installed.currency.source;
          const source = yield* captureLogicalSchemaSource({ ...sourceFrame, definition: { kind: "relational", schema } });
          const currency = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: currencySourceProvenance, commands: [] });
          const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: installed.application },
            { kind: "native", definition: installed.payload }, { kind: "native", definition: currency }] });
          return { currency, bundle };
        }));
        expect(forged.currency.identity.definitionHash).not.toBe(installed.currency.identity.definitionHash);
        const mutations = [
          { record: schemaRecord, document: { ...schemaRecord.document, native: forged.bundle.metadata } },
          { record: tableRecord, document: { ...tableRecord.document, nativePolicy: {
            ...installed.table.nativePolicy, identity: forged.currency.identity } } },
        ];
        try {
          for (const mutation of mutations) await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [Result.getOrThrow(encodeDocumentValue(mutation.document)), fixture.instanceName,
            mutation.record.entry.tableId, mutation.record.entry.id, mutation.record.entry.ts.toString()]);
          const refused = await Effect.runPromise(Effect.scoped(Effect.result(Effect.acquireRelease(openCoreDatabase(await fixture.reopen(),
            { ...options, schemaBundles: [installed.bundle] }), database => database.close()))));
          expect(failure(refused)).toMatchObject({ reason: "corruptData" });
        } finally {
          for (const mutation of mutations) await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [mutation.record.entry.jsonValue, fixture.instanceName, mutation.record.entry.tableId,
            mutation.record.entry.id, mutation.record.entry.ts.toString()]);
        }
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()),
            { ...options, schemaBundles: [installed.bundle] }), db => db.close());
          expect(yield* database.publishedTimestamp).toBe(genuineReopen);
        })));
      } finally { await fixture.close(); }
    }, 90_000);
  });
}

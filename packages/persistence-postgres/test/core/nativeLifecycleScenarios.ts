import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { openCoreDatabase } from "../../src/core/database";
import { checkCoreNativeRegistryTransition, makeCoreNativeDefinition, type CoreNativeDefinition } from "../../src/core/nativePolicy";
import { issueCoreNativeBinding, type CoreDatabase, type CoreError, type CoreRequestIdentity, type CoreSchemaProposal } from "../../src/core/api";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { readDocumentObject, tableDocument } from "../../src/core/registry";
import type { CoreDocumentLogEntry, CorePersistence } from "../../src/core/contracts";
import { bootstrapCore } from "../../src/core/bootstrap";
import { CoreFinalizationVault, createCoreTransaction } from "../../src/core/transaction";
import { coreNativeTestBudget } from "./nativeTestBudget";

const options = { now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const scopeUuid = "8f5545a4-cd38-4ae0-a421-12fe85dcb727", epochUuid = "1e8aa599-efb5-45da-9b24-8e48f115f250";
const source = Effect.fn("NativeLifecycleFixture.source")(function* (extra = false) {
  const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
    { name: "title", type: "text", required: true, unique: true },
    ...(extra ? [{ name: "summary", type: "text", required: true }] : []),
  ] }]);
  return yield* makeCoreNativeDefinition({ source: compiled.sourceContract, scopeUuid, epochUuid });
});
const ready = Effect.fn("NativeLifecycleFixture.ready")(function* (database: CoreDatabase, proposal: CoreSchemaProposal,
  definition: CoreNativeDefinition) {
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady)
      return yield* database.activateSchema(proposal, { programs: [], native: definition });
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Native schema ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Native schema did not become ready"));
});
function failure<A>(result: Result.Result<A, CoreError>) { return Result.isFailure(result) ? result.failure : undefined; }
const body = (title: string) => ({ title, createdAt: "2026-10-31T00:00:00.000Z", updatedAt: "2026-10-31T00:00:00.000Z" });

export function registerNativeLifecycleScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("refuses metadata candidate and publication changes that drop authenticated native obligations", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), database = yield* openCoreDatabase(fixture.persistence, options);
        const proposal = yield* database.prepareSchema({ native: definition });
        yield* ready(database, proposal, definition);
        yield* database.close();
        const lease = yield* fixture.persistence.acquireLease(), initial = yield* bootstrapCore(fixture.persistence, lease, options);
        const table = initial.registry.table(definition.tables[0]?.name ?? "missing")?.definition;
        if (table?.nativePolicy === undefined) return yield* Effect.die(new Error("Missing native table"));
        const withoutPolicy = { ...tableDocument(table) };
        delete withoutPolicy.nativePolicy;
        const mutations = [
          tableDocument({ ...table, nativePolicy: { ...table.nativePolicy, uniqueConstraints: [] } }),
          tableDocument({ ...table, nativePolicy: { ...table.nativePolicy, applicationRead: true } }), withoutPolicy,
        ];
        for (const mutation of mutations) {
          const context = createCoreTransaction({ snapshot: yield* fixture.persistence.readSnapshot(initial.timestamp, initial.retention),
            registry: initial.registry, now: yield* options.now, newInternalId: options.newInternalId, vault: new CoreFinalizationVault() });
          yield* context.writePrivate("_tables", table.tabletId, mutation);
          const publication = checkCoreNativeRegistryTransition(context.registry, initial.registry, initial.registry);
          expect(Result.isFailure(publication) && publication.failure).toMatchObject({ reason: "corruptData" });
          expect(failure(yield* Effect.result(context.transaction.finalize()))).toMatchObject({ reason: "corruptData" });
        }
        const sourceRecord = yield* Effect.fromResult(initial.registry.schemas.nativeByState(null, "active"));
        if (sourceRecord._tag !== "Some") return yield* Effect.die(new Error("Missing native schema"));
        const context = createCoreTransaction({ snapshot: yield* fixture.persistence.readSnapshot(initial.timestamp, initial.retention),
          registry: initial.registry, now: yield* options.now, newInternalId: options.newInternalId, vault: new CoreFinalizationVault() });
        const sourceDocument = yield* context.getSystem("_schemas", sourceRecord.value.id);
        if (sourceDocument._tag !== "Some") return yield* Effect.die(new Error("Missing source document"));
        const { native: omittedSource, ...sourceOnly } = sourceDocument.value.value;
        yield* context.replaceSystem("_schemas", sourceRecord.value.id, sourceOnly);
        expect(Result.isFailure(checkCoreNativeRegistryTransition(context.registry, initial.registry, initial.registry))).toBe(true);
        expect(failure(yield* Effect.result(context.transaction.finalize()))).toMatchObject({ reason: "corruptData" });
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("rejects retained native policy corruption before Application disclosure or native binding", async () => {
      const fixture = await createFixture();
      const observed = new Map<string, Readonly<{ entry: CoreDocumentLogEntry; document: DocumentObject }>>();
      try {
        const installed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const definition = yield* source(), name = definition.tables[0]?.name ?? "missing";
          const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
            yield* fixture.persistence.write(lease, batch);
            for (const entry of batch.documents) {
              if (entry.deleted) continue;
              const document = yield* Effect.fromResult(readDocumentObject(entry));
              if (document.name === name) observed.set("table", { entry, document });
              if (typeof document.native === "string") observed.set("schema", { entry, document });
              if (document.descriptor === definition.tables[0]?.uniqueConstraints[0]?.indexName)
                observed.set("index", { entry, document });
            }
          }) };
          const database = yield* openCoreDatabase(persistence, options), proposal = yield* database.prepareSchema({ native: definition });
          yield* ready(database, proposal, definition);
          const binding = yield* database.bindNative({ definition }), create = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
          const id = yield* create.operations.insert(name, body("retained title"));
          yield* database.commit(yield* create.finalize());
          const table = (yield* database.readNativeBinding(binding)).tables[0];
          if (table?.nativePolicy === undefined) return yield* Effect.die(new Error("Missing retained native policy"));
          return { definition, table, id };
        })));
        const tableRecord = observed.get("table"), schemaRecord = observed.get("schema"), indexRecord = observed.get("index");
        if (tableRecord === undefined || schemaRecord === undefined || indexRecord === undefined || installed.table.nativePolicy === undefined)
          throw new Error("Missing retained native metadata observations");
        const policy = installed.table.nativePolicy;
        const { nativePolicy: omittedPolicy, ...unownedTable } = installed.table;
        const { native: omittedSource, ...orphanSchema } = schemaRecord.document;
        const changedIndex = { ...indexRecord.document, config: {
          type: "database", fields: ["createdAt"], onDiskState: { type: "Enabled" },
        } };
        const cases: readonly Readonly<{ record: typeof tableRecord; document: DocumentObject }>[] = [
          { record: tableRecord, document: { ...tableRecord.document,
            ...tableDocument({ ...installed.table, nativePolicy: { ...policy, uniqueConstraints: [] } }) } },
          { record: tableRecord, document: { ...tableRecord.document,
            ...tableDocument({ ...installed.table, nativePolicy: { ...policy, applicationRead: true } }) } },
          { record: tableRecord, document: { _id: tableRecord.document._id ?? null,
            _creationTime: tableRecord.document._creationTime ?? null, ...tableDocument(unownedTable) } },
          { record: schemaRecord, document: orphanSchema },
          { record: schemaRecord, document: { ...schemaRecord.document, native: `${installed.definition.metadata} ` } },
          { record: indexRecord, document: changedIndex },
        ];
        for (const tamper of cases) {
          await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [Result.getOrThrow(encodeDocumentValue(tamper.document)), fixture.instanceName,
            tamper.record.entry.tableId, tamper.record.entry.id, tamper.record.entry.ts.toString()]);
          try {
            for (const route of ["application", "native"] as const) {
              const reopened = await fixture.reopen();
              const result = await Effect.runPromise(Effect.scoped(Effect.result(Effect.gen(function* () {
                const database = yield* openCoreDatabase(reopened, options);
                if (route === "application") {
                  const app = yield* database.begin();
                  yield* app.get(installed.id);
                  yield* app.abort();
                } else {
                  const binding = yield* database.bindNative({ definition: installed.definition });
                  const create = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
                  yield* create.operations.insert(installed.table.name, body("retained title"));
                  yield* create.abort();
                }
              }))));
              expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "corruptData" });
            }
          } finally {
            await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
              WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
            [tamper.record.entry.jsonValue, fixture.instanceName, tamper.record.entry.tableId,
              tamper.record.entry.id, tamper.record.entry.ts.toString()]);
          }
        }
        const pendingMissingPolicy = { _id: tableRecord.document._id ?? null,
          _creationTime: tableRecord.document._creationTime ?? null, ...tableDocument(unownedTable) };
        await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
          WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
        [Result.getOrThrow(encodeDocumentValue(pendingMissingPolicy)), fixture.instanceName,
          tableRecord.entry.tableId, tableRecord.entry.id, tableRecord.entry.ts.toString()]);
        await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
          WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
        [Result.getOrThrow(encodeDocumentValue({ ...schemaRecord.document, state: { state: "pending" } })), fixture.instanceName,
          schemaRecord.entry.tableId, schemaRecord.entry.id, schemaRecord.entry.ts.toString()]);
        try {
          const reopened = await fixture.reopen();
          const result = await Effect.runPromise(Effect.scoped(Effect.result(Effect.gen(function* () {
            const database = yield* openCoreDatabase(reopened, options), app = yield* database.begin();
            yield* app.insert(installed.table.name, body("pending ownership bypass"));
          }))));
          expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "corruptData" });
        } finally {
          for (const record of [tableRecord, schemaRecord]) await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [record.entry.jsonValue, fixture.instanceName, record.entry.tableId, record.entry.id, record.entry.ts.toString()]);
        }
      } finally { await fixture.close(); }
    }, 60_000);

    it("reserves fresh identities through interrupted preparation, replays and reopens authentic native bindings", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), database = yield* openCoreDatabase(fixture.persistence, options);
        const proposal = yield* database.prepareSchema({ native: definition });
        expect(yield* database.prepareSchema({ native: definition })).toEqual(proposal);
        const before = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const table = before.table(definition.tables[0]?.name ?? "missing")?.definition;
        expect(table?.nativePolicy?.state).toBe("reserved");
        const app = yield* database.begin();
        expect(failure(yield* Effect.result(app.insert(table?.name ?? "missing", body("forbidden"))))).toMatchObject({ reason: "authorityRevoked" });
        yield* app.abort();
        yield* database.advanceSchema(proposal, { pageSize: 1, maxPages: 1 });
        yield* database.close();
        const reopenedPersistence = yield* Effect.promise(() => fixture.reopen());
        const reopened = yield* openCoreDatabase(reopenedPersistence, options);
        expect(yield* reopened.prepareSchema({ native: definition })).toEqual(proposal);
        const activation = yield* ready(reopened, proposal, definition);
        expect(activation.tables[0]?.tabletId).toEqual(table?.tabletId);
        const binding = yield* reopened.bindNative({ definition });
        const create = yield* reopened.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
        const id = yield* create.operations.insert(table?.name ?? "missing", body("first"));
        yield* reopened.commit(yield* create.finalize());
        const heldReplay = yield* reopened.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-update" });
        yield* heldReplay.operations.get(id);
        const heldReplayFinalized = yield* heldReplay.finalize(), priorReplayTimestamp = yield* reopened.publishedTimestamp;
        expect(yield* reopened.prepareSchema({ native: definition })).toEqual(proposal);
        yield* ready(reopened, proposal, definition);
        expect(yield* reopened.publishedTimestamp).toBe(priorReplayTimestamp);
        yield* reopened.commit(heldReplayFinalized);
        const read = yield* reopened.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-findByID" });
        expect(yield* read.operations.get(id)).toMatchObject({ _tag: "Some", value: { title: "first" } });
        yield* read.finishRead();
        yield* reopened.close();
        const cold = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options);
        expect(failure(yield* Effect.result(cold.readNativeBinding(binding)))).toMatchObject({ reason: "authorityRevoked" });
        const rebuiltDefinition = yield* source(), coldBinding = yield* cold.bindNative({ definition: rebuiltDefinition });
        const coldRead = yield* cold.beginNative(coldBinding, { ...coreNativeTestBudget(), commandName: "payload-find" });
        expect(yield* coldRead.operations.find(table?.name ?? "missing", {})).toHaveLength(1);
        yield* coldRead.finishRead();
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("uses installed native command identities and the shared durable request owner across reopen", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), database = yield* openCoreDatabase(fixture.persistence, options);
        const proposal = yield* database.prepareSchema({ native: definition });
        yield* ready(database, proposal, definition);
        const binding = yield* database.bindNative({ definition });
        const metadata = yield* database.readNativeBinding(binding);
        const command = metadata.commands.find(candidate => candidate.name === "payload-create");
        if (command === undefined) return yield* Effect.die(new Error("Missing actual native command"));
        const request: CoreRequestIdentity = { kind: "native", key: "native-durable-result", requestHash: "native-correlated-arguments",
          native: command.identity };
        expect(failure(yield* Effect.result(database.claimRequest(request)))).toMatchObject({ reason: "authorityRevoked" });
        const forgedBinding = yield* Effect.result(database.readNativeBinding(issueCoreNativeBinding()));
        expect(failure(forgedBinding)).toMatchObject({ reason: "authorityRevoked" });
        const acquired = yield* database.claimRequest(request, binding);
        if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Missing native claim"));
        const create = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: command.name, claim: acquired.claim });
        const id = yield* create.operations.insert(definition.tables[0]?.name ?? "missing", body("durable"));
        yield* database.commit(yield* create.finalize(), { claim: acquired.claim, result: { id, title: "durable" } });
        expect(yield* database.resolveRequest(request)).toMatchObject({ kind: "committed", result: { id, title: "durable" } });
        const extended = yield* database.bindNative({ definition, commands: [
          ...definition.commands.map(({ name, mode }) => ({ name, mode })), { name: "native-held-command", mode: "write" },
        ] });
        expect((yield* database.readNativeBinding(extended)).commands.at(-1)?.name).toBe("native-held-command");
        const held = yield* database.beginNative(extended, { ...coreNativeTestBudget(), commandName: "native-held-command" });
        expect(yield* held.operations.find(definition.tables[0]?.name ?? "missing", {})).toHaveLength(1);
        yield* held.abort();
        expect(failure(yield* Effect.result(database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "native-held-command" })))).toMatchObject({ reason: "authorityRevoked" });
        yield* database.close();
        const cold = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options);
        const coldBinding = yield* cold.bindNative({ definition: yield* source() });
        expect(yield* cold.claimRequest(request, coldBinding)).toMatchObject({ kind: "committed", result: { id, title: "durable" } });
        expect(yield* cold.recoverRequest(request)).toMatchObject({ kind: "committed", result: { id, title: "durable" } });
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("admits authenticated compound and nullable scalar clauses and rejects forged source evidence", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const compile = Effect.fn("NativeLifecycleFixture.unsupported")(function* (fields: unknown, indexes?: unknown) {
          const compiled = yield* compilePayloadCollections([{ slug: "news", fields, ...(indexes === undefined ? {} : { indexes }) }]);
          return yield* makeCoreNativeDefinition({ source: compiled.sourceContract, scopeUuid, epochUuid });
        });
        const nullable = yield* compile([{ name: "title", type: "text", unique: true }]);
        expect(nullable.tables[0]?.uniqueConstraints).toMatchObject([{ fields: ["title"], nullsDistinct: true }]);
        const compound = yield* compile([{ name: "title", type: "text", required: true },
          { name: "amount", type: "number", required: true }], [{ fields: ["title", "amount"], unique: true }]);
        expect(compound.tables[0]?.uniqueConstraints).toMatchObject([{ fields: ["title", "amount"], nullsDistinct: false }]);
        const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }]);
        const forged = yield* Effect.result(makeCoreNativeDefinition({ scopeUuid, epochUuid, source: {
          ...compiled.sourceContract, evidence: { ...compiled.sourceContract.evidence, provenance: {
            ...compiled.sourceContract.evidence.provenance, release: "3.87.0",
          } },
        } }));
        expect(Result.isFailure(forged) && forged.failure).toMatchObject({ reason: "unsupportedCapability" });
        const registry = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        expect([...registry.tables.values()].filter(record => !record.definition.name.startsWith("_"))).toEqual([]);
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("refuses existing Application identities and a stale implicit-create race without granting native ownership", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), name = definition.tables[0]?.name ?? "missing";
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const stale = yield* database.begin();
        yield* stale.insert(name, body("stale implicit write"));
        const finalized = yield* stale.finalize();
        const proposal = yield* database.prepareSchema({ native: definition });
        expect(failure(yield* Effect.result(database.commit(finalized)))).toMatchObject({ reason: "conflict" });
        yield* ready(database, proposal, definition);
        const binding = yield* database.bindNative({ definition }), read = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
        expect(yield* read.operations.find(name, {})).toEqual([]);
        yield* read.finishRead();
      }))); } finally { await fixture.close(); }
      const existing = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), name = definition.tables[0]?.name ?? "missing";
        const database = yield* openCoreDatabase(existing.persistence, options);
        const application = yield* database.begin(), id = yield* application.insert(name, body("deleted Application row"));
        yield* application.delete(id);
        yield* database.commit(yield* application.finalize());
        const prior = yield* readCoreFixtureRegistry(existing, yield* database.publishedTimestamp);
        expect(failure(yield* Effect.result(database.prepareSchema({ native: definition })))).toMatchObject({ reason: "unsupportedCapability" });
        const after = yield* readCoreFixtureRegistry(existing, yield* database.publishedTimestamp);
        expect(after.table(name)?.id).toEqual(prior.table(name)?.id);
        expect(after.table(name)?.definition.nativePolicy).toBeUndefined();
      }))); } finally { await existing.close(); }
    }, 60_000);

    it("blocks known-ID and lifecycle bypasses while preserving an active native combination", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), database = yield* openCoreDatabase(fixture.persistence, options);
        const proposal = yield* database.prepareSchema({ native: definition });
        const registry = yield* readCoreFixtureRegistry(fixture, yield* database.publishedTimestamp);
        const table = registry.table(definition.tables[0]?.name ?? "missing")?.definition;
        if (table === undefined) return yield* Effect.die(new Error("Missing reserved table"));
        const guessedId = yield* Effect.fromResult(encodeDocumentId(table.number, randomBytes(16)));
        for (const method of ["patch", "replace", "delete"] as const) {
          const app = yield* database.begin();
          const result = method === "delete" ? yield* Effect.result(app.delete(guessedId))
            : yield* Effect.result(app[method](guessedId, body("bypass")));
          expect(failure(result)).toMatchObject({ reason: "authorityRevoked" });
          yield* app.abort();
        }
        yield* ready(database, proposal, definition);
        const binding = yield* database.bindNative({ definition }), create = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
        const id = yield* create.operations.insert(table.name, body("retained"));
        yield* database.commit(yield* create.finalize());
        const altered = yield* source(true);
        expect(failure(yield* Effect.result(database.prepareSchema({ native: altered })))).toMatchObject({ reason: "unsupportedCapability" });
        expect(failure(yield* Effect.result(database.prepareSchema({ schema: { tables: [], schemaValidation: false } })))).toMatchObject({ reason: "unsupportedCapability" });
        expect(failure(yield* Effect.result(database.activateSchema(proposal, { programs: [] })))).toMatchObject({ reason: "unsupportedCapability" });
        expect(failure(yield* Effect.result(database.publishPrograms({ programs: [] })))).toMatchObject({ reason: "unsupportedCapability" });
        const app = yield* database.begin();
        expect(failure(yield* Effect.result(app.patch(id, { title: "bypass" })))).toMatchObject({ reason: "authorityRevoked" });
        yield* app.abort();
        const read = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-findByID" });
        expect(yield* read.operations.get(id)).toMatchObject({ _tag: "Some", value: { title: "retained" } });
        expect(failure(yield* Effect.result(read.operations.insert(table.name, body("readonly"))))).toMatchObject({ reason: "readonly" });
        yield* read.abort();
      }))); } finally { await fixture.close(); }
    }, 60_000);

    it("revokes held and fixed native operations on authority changes and closes escaped bindings", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* source(), database = yield* openCoreDatabase(fixture.persistence, options);
        const proposal = yield* database.prepareSchema({ native: definition });
        yield* ready(database, proposal, definition);
        const binding = yield* database.bindNative({ definition });
        const held = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
        yield* held.operations.insert(definition.tables[0]?.name ?? "missing", body("must not settle"));
        const finalized = yield* held.finalize();
        const fixed = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" });
        expect(yield* fixed.operations.find(definition.tables[0]?.name ?? "missing", {})).toEqual([]);
        yield* database.advanceAuthorityEpoch(1n);
        expect(failure(yield* Effect.result(fixed.operations.find(definition.tables[0]?.name ?? "missing", {})))).toMatchObject({ reason: "authorityRevoked" });
        expect(failure(yield* Effect.result(database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-find" })))).toMatchObject({ reason: "authorityRevoked" });
        expect(failure(yield* Effect.result(database.commit(finalized)))).toMatchObject({ reason: "conflict" });
        yield* fixed.abort();
        const fresh = yield* database.bindNative({ definition }), read = yield* database.beginNative(fresh, { ...coreNativeTestBudget(), commandName: "payload-find" });
        expect(yield* read.operations.find(definition.tables[0]?.name ?? "missing", {})).toEqual([]);
        yield* read.finishRead();
        yield* database.close();
        expect(failure(yield* Effect.result(database.readNativeBinding(fresh)))).toMatchObject({ reason: "closed" });
        expect(failure(yield* Effect.result(read.operations.find(definition.tables[0]?.name ?? "missing", {})))).toMatchObject({ reason: "closed" });
      }))); } finally { await fixture.close(); }
    }, 60_000);
  });
}
